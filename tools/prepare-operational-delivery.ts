/** Explicit fictional historical admission for preview delivery practice; never imports historical transactions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { refreshOperationalCairoHandoff, writeOperationalHandoff, type OperationalPreviewManifest } from './import-operational-workflow';
import { operationalPreviewMarker, practiceSourceTerms, previewCairoTime, previewPdf, stablePreviewId } from './operational-preview-data';
import { workflowSnapshotSchema } from '../src/modules/workflow-import/model';
import { parseServerConfig } from '../src/server/config';
import { createFileContentService } from '../src/server/files';
import { invokeFileCommandWithStatus } from '../src/modules/files/commands';
import { getFile } from '../src/modules/files/queries';
import { claimJobs } from '../src/worker/claims';
import { executeLeasedJob } from '../src/worker/execute';
import { fileScanHandler } from '../src/worker/file-scan';
import { createFakeScanAdapter } from '../src/server/providers/file-scan';
import { createIdentifierCipher } from '../src/server/private-identifiers';
import { createPayoutDestinationTransport } from '../src/server/payout-destination-transport';
import { privatePayoutDestinationPort } from '../src/server/payout-destination-server';
import { invokePayrollCommandWithStatus } from '../src/modules/tutor_pay/payroll';

type Json = Record<string, unknown>;
type Step = { name: string; args: Json; requestHash: string; result: Json };
type HistoricalSlot = { occurrenceId: string; enrollmentId: string; quoteId: string; acceptanceId: string; start: string; end: string; funded?: boolean; chargeId?: string; transferId?: string; receiptId?: string; earningId?: string; payoutAttemptId?: string; payoutSettledAt?: string };
type DeliveryManifest = { marker: typeof operationalPreviewMarker; sourceHash: string; sourceEnrollmentId: string; createdAt: string; state: 'preparing' | 'ready' | 'verified'; provenance: 'fictional_preview_admission_only'; personal: HistoricalSlot; supersededPersonal?: HistoricalSlot; verified: HistoricalSlot; steps: Record<string, Step>; correctedTerms?: { version: 2; feeMinor: number; pricingId: string; policyId: string; offerId: string }; correctedFutureId?: string };
const folder = resolve('.local/operational-preview'), path = resolve(folder, 'delivery-manifest.json');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const save = async (manifest: DeliveryManifest) => writeFile(path, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

async function main() {
  const config = JSON.parse(await readFile(resolve(folder, 'config.json'), 'utf8')) as { marker: string; url: string; database_url: string; worker_database_url: string; publishable_key: string; secret_key: string; secret_encryption_key: string };
  const source = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8')) as OperationalPreviewManifest;
  const workbook = workflowSnapshotSchema.parse(JSON.parse(await readFile(resolve('.local/workflow-import/workflow-snapshot.json'), 'utf8')));
  assert.equal(workbook.source_sha256, source.sourceHash, 'SOURCE_HASH_CHANGED');
  const correctedTerms = practiceSourceTerms(workbook); assert(correctedTerms.tutorFeeMinor > 0, 'EXPLICIT_POSITIVE_PREVIEW_RATE_REQUIRED');
  const browser = JSON.parse(await readFile(resolve(folder, 'verification-state.json'), 'utf8')) as { enrollmentId: string };
  assert.equal(config.marker, operationalPreviewMarker); assert.equal(source.marker, operationalPreviewMarker);
  assert.equal(config.url, 'http://127.0.0.1:54331');
  for (const connection of [config.database_url, config.worker_database_url]) { const address = new URL(connection); assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.port, '54332'); }
  const database = new Client({ connectionString: config.database_url }); await database.connect();
  const worker = new Pool({ connectionString: config.worker_database_url });
  const makeClient = () => createClient(config.url, config.publishable_key, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } });
  type ApiClient = ReturnType<typeof makeClient>;
  const clients: ApiClient[] = [];
  let locked = false;
  try {
    const marker = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    assert.equal(marker?.environment, 'development'); assert.equal(marker?.fixture_marker, operationalPreviewMarker);
    locked = Boolean((await database.query("select pg_try_advisory_lock(hashtextextended('git-tutor:operational-delivery:v1',0)) locked")).rows[0].locked); assert(locked, 'DELIVERY_PREPARATION_ALREADY_RUNNING');
    const original = (await database.query(`select o.*,e.id as enrollment_id,e.current_quote_id,e.learner_id,e.booker_account_id,e.state as enrollment_state,q.customer_price_minor,fee.fee_minor from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id join app_private.quotes q on q.id=e.current_quote_id join finance_private.tutor_fee_agreements fee on fee.id=o.current_fee_agreement_id where e.id=$1`, [browser.enrollmentId])).rows[0];
    assert(original && original.learner_id === source.learnerId && original.tutor_id === source.tutorId && original.enrollment_state === 'confirmed' && original.state === 'confirmed' && original.id === source.verified?.occurrenceId, 'CONFIRMED_BROWSER_VERIFICATION_REQUIRED');
    let manifest: DeliveryManifest;
    try { manifest = JSON.parse(await readFile(path, 'utf8')) as DeliveryManifest; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const createdAt = new Date().toISOString();
      const slot = (label: string, daysAgo: number): HistoricalSlot => {
        const start = new Date(createdAt); start.setUTCDate(start.getUTCDate() - daysAgo); start.setUTCHours(10, 0, 0, 0);
        return { occurrenceId: stablePreviewId(source.sourceHash, `historical:${label}:occurrence`), enrollmentId: stablePreviewId(source.sourceHash, `historical:${label}:enrollment`), quoteId: stablePreviewId(source.sourceHash, `historical:${label}:quote`), acceptanceId: stablePreviewId(source.sourceHash, `historical:${label}:acceptance`), start: start.toISOString(), end: new Date(start.getTime() + original.duration_minutes * 60000).toISOString() };
      };
      manifest = { marker: operationalPreviewMarker, sourceHash: source.sourceHash, sourceEnrollmentId: browser.enrollmentId, createdAt, state: 'preparing', provenance: 'fictional_preview_admission_only', personal: slot('personal', 1), verified: slot('verified', 2), steps: {} }; await save(manifest);
    }
    assert.equal(manifest.marker, operationalPreviewMarker); assert.equal(manifest.sourceHash, source.sourceHash); assert.equal(manifest.sourceEnrollmentId, browser.enrollmentId);
    async function login(key: string) {
      const actor = source.actors[key]; assert(actor.email.endsWith('@preview.gittutor.invalid'));
      const client = makeClient(), result = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
      assert(!result.error, 'DELIVERY_LOGIN_FAILED'); clients.push(client); return client;
    }
    const admin = await login('owner'), learner = await login('student:5'), tutor = await login('tutor:5'), service = await login('service');
    async function step(label: string, name: string, args: Json, client = admin): Promise<Json> {
      const request = { ...args, p_idempotency_key: `operational-delivery-v1:${source.sourceHash.slice(0, 12)}:${label}` }, requestHash = hash(JSON.stringify(request)), previous = manifest.steps[label];
      if (previous) assert(previous.name === name && previous.requestHash === requestHash, 'DELIVERY_STEP_CONFLICT');
      const result = await client.rpc(name, request);
      if (result.error) { await writeFile(resolve(folder, 'delivery-rpc-error.json'), JSON.stringify({ name, error: result.error }, null, 2), { mode: 0o600 }); throw new Error(`DELIVERY_COMMAND_FAILED:${name}:${result.error.code}:${/^[A-Z_]+$/.test(result.error.message) ? result.error.message : 'REDACTED'}`); }
      manifest.steps[label] = { name, args: request, requestHash, result: result.data as Json }; await save(manifest); return result.data as Json;
    }
    const server = parseServerConfig({ APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishable_key, SUPABASE_SECRET_KEY: config.secret_key, WORKER_DATABASE_URL: config.worker_database_url, SECRET_ENCRYPTION_KEY: config.secret_encryption_key });
    const content = createFileContentService(worker, server), storage = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    async function upload(label: string, client: ApiClient, purpose: string, parent: string | null, action: string, lines: string[]) {
      const bytes = previewPdf(['FICTIONAL HISTORICAL PRACTICE. Not a workbook transaction.', ...lines]), checksum = hash(bytes);
      const made = await step(`${label}:upload`, 'create_file_upload', { p_purpose: purpose, p_parent_id: parent, p_evidence_action: action, p_filename: `delivery-${label}.pdf`, p_declared_type: 'application/pdf', p_size_bytes: bytes.length, p_checksum_sha256: checksum }, client);
      const fileId = made.file_id as string, existing = await getFile(client, fileId).catch(() => null);
      if (!existing?.can_download) {
        await content.upload(client, fileId, bytes);
        const finalized = await invokeFileCommandWithStatus(client, 'finalize_file_upload', { p_file_id: fileId, p_checksum_sha256: checksum, p_idempotency_key: `operational-delivery-v1:${label}:finalize` });
        await database.query('begin'); let job;
        try { await database.query("select id from app_private.outbox_jobs where purpose='files.scan' and id<>$1 for update", [finalized.data.scan_job_id]); const jobs = await claimJobs(worker, 'files.scan', 1, 60); assert(jobs.length === 1 && jobs[0].id === finalized.data.scan_job_id, 'DELIVERY_SCAN_JOB_UNAVAILABLE'); job = jobs[0]; }
        finally { await database.query('rollback'); }
        const handler = fileScanHandler(worker, async file => { const result = await storage.storage.from('git-tutor-private').download(file.object_key); assert(!result.error && result.data && result.data.size <= 25 * 1024 * 1024, 'DELIVERY_FILE_MISSING'); return new Uint8Array(await result.data.arrayBuffer()); }, scenario => createFakeScanAdapter(scenario, true));
        assert.equal(await executeLeasedJob(worker, job, handler), 'completed'); assert((await getFile(client, fileId)).can_download);
      }
      return fileId;
    }
    // Version 2 corrects the fee input from the state-derived due balance to the stated
    // source rate. Published versions and original postings remain immutable.
    const priorPrice = (await database.query('select customer_pricing from app_private.pricing_versions where id=$1', [original.pricing_version_id])).rows[0].customer_pricing;
    const feeRule = { currency: 'EGP', fee_min_minor: correctedTerms.tutorFeeMinor, fee_max_minor: correctedTerms.tutorFeeMinor, exact_occurrence_approval_required: true };
    const priceV2 = await step('v2:pricing', 'create_pricing_draft', { p_scope: 'private', p_customer_pricing: priorPrice, p_compensation: { currency: 'EGP', group_fee_bands: null, private_fee_rule: feeRule } });
    const approval = 'Preview terms revision 2: use the explicit source session Instructor Rate, not its historical Fee Due balance. Original versions retained; preview only.';
    await step('v2:pricing-approve', 'approve_pricing_version', { p_pricing_version_id: priceV2.resource_id, p_effective_at: manifest.createdAt, p_approval_note: approval, p_expected_version: 1 });
    const policyContent = (await database.query('select app_private.policy_content($1) content', [original.policy_version_id])).rows[0].content;
    Object.assign(policyContent, { customer_pricing_version: priceV2.resource_id, compensation_policy_version: priceV2.resource_id, private_fee_rule: feeRule });
    const policyV2 = await step('v2:policy', 'create_policy_draft', { p_kind: 'booking', p_scope: 'private', p_content: policyContent });
    await step('v2:policy-approve', 'approve_policy_version', { p_policy_version_id: policyV2.resource_id, p_effective_at: manifest.createdAt, p_approval_note: approval, p_expected_version: 1 });
    const subjectId = (await database.query('select subject_id from app_private.offers where id=$1', [original.offer_id])).rows[0].subject_id;
    const offerV2 = await step('v2:offer', 'create_offer', { p_subject_id: subjectId, p_format: 'private', p_duration_minutes: original.duration_minutes, p_capacity: 1, p_target_tier: null, p_pricing_version_id: priceV2.resource_id, p_policy_version_id: policyV2.resource_id });
    await step('v2:publish', 'publish_offer', { p_offer_id: offerV2.resource_id, p_effective_at: manifest.createdAt, p_expected_version: 1 });
    manifest.correctedTerms = { version: 2, feeMinor: correctedTerms.tutorFeeMinor, pricingId: priceV2.resource_id as string, policyId: policyV2.resource_id as string, offerId: offerV2.resource_id as string };
    const priorPersonal = source.supersededPersonal ?? source.personal!;
    await step('v2:cancel-empty-superseded-future', 'cancel_occurrence', { p_occurrence_id: priorPersonal.occurrenceId, p_reason: 'Superseded empty Preview practice by approved fee-input correction revision 2; no historical workbook record changed', p_remedy_proposal_id: null, p_expected_version: 2 });
    const futureV2 = await step('v2:future', 'create_occurrence', { p_offer_id: offerV2.resource_id, p_tutor_id: original.tutor_id, p_start_at: priorPersonal.start, p_end_at: priorPersonal.end, p_time_zone: 'Africa/Cairo', p_target_tier: null });
    await step('v2:future-fee', 'approve_tutor_fee', { p_occurrence_id: futureV2.occurrence_id, p_tutor_id: original.tutor_id, p_fee_minor: correctedTerms.tutorFeeMinor, p_currency: 'EGP', p_duration_minutes: original.duration_minutes, p_compensation_policy_version_id: priceV2.resource_id, p_target_tier: null, p_purpose: 'initial', p_reason: approval, p_expected_version: 1 });
    await step('v2:future-series', 'create_occurrence_series', { p_title: 'Preview practice — your untouched session (terms revision 2)', p_occurrence_ids: [futureV2.occurrence_id] });
    manifest.correctedFutureId = futureV2.occurrence_id as string;
    source.supersededPersonal = priorPersonal; source.termsVersion = 2; source.privateOfferId = offerV2.resource_id as string; source.pricingId = priceV2.resource_id as string;
    source.personal = { ...priorPersonal, occurrenceId: manifest.correctedFutureId, offerId: source.privateOfferId, bookingUrl: `${(await readFile(resolve(folder, 'public-url.txt'), 'utf8')).trim()}/learn/bookings?offer=${source.privateOfferId}&occurrence=${manifest.correctedFutureId}` };
    await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(source, null, 2) + '\n', { mode: 0o600 });
    if (!manifest.supersededPersonal) {
      manifest.supersededPersonal = manifest.personal;
      const start = new Date(manifest.personal.start); start.setUTCHours(13, 0, 0, 0);
      manifest.personal = { occurrenceId: stablePreviewId(source.sourceHash, 'historical:personal-v2:occurrence'), enrollmentId: stablePreviewId(source.sourceHash, 'historical:personal-v2:enrollment'), quoteId: stablePreviewId(source.sourceHash, 'historical:personal-v2:quote'), acceptanceId: stablePreviewId(source.sourceHash, 'historical:personal-v2:acceptance'), start: start.toISOString(), end: new Date(start.getTime() + original.duration_minutes * 60000).toISOString() };
    }
    await save(manifest);
    for (const kind of ['personal-v2', 'verified'] as const) {
      const slot = kind === 'personal-v2' ? manifest.personal : manifest.verified;
      if (slot.funded) continue;
      const model = kind === 'personal-v2' ? { ...original, offer_id: manifest.correctedTerms.offerId, pricing_version_id: manifest.correctedTerms.pricingId, policy_version_id: manifest.correctedTerms.policyId, fee_minor: manifest.correctedTerms.feeMinor } : original;
      await database.query('begin');
      try {
        const existing = (await database.query('select offer_id,tutor_id,start_at,end_at from app_private.occurrences where id=$1', [slot.occurrenceId])).rows[0];
        if (existing) assert(existing.offer_id === model.offer_id && existing.tutor_id === original.tutor_id && existing.start_at.toISOString() === slot.start && existing.end_at.toISOString() === slot.end, 'DELIVERY_PRACTICE_CONFLICT');
        else {
          // Explicitly authorized fictional admission setup only. All downstream facts use normal commands.
          await database.query(`insert into app_private.occurrences select(jsonb_populate_record(null::app_private.occurrences,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'start_at',$3::timestamptz,'end_at',$4::timestamptz,'confirmation_deadline_at',$3::timestamptz-interval '1 hour','state','forming','current_fee_agreement_id',null,'version',1,'quote_terms_version',1,'meeting_status','not_requested','offer_id',$5::uuid,'policy_version_id',$6::uuid,'pricing_version_id',$7::uuid))).* from app_private.occurrences o where id=$1`, [original.id, slot.occurrenceId, slot.start, slot.end, model.offer_id, model.policy_version_id, model.pricing_version_id]);
          await database.query('insert into app_private.tutor_assignments(occurrence_id,tutor_id) values($1,$2)', [slot.occurrenceId, original.tutor_id]);
          await database.query('insert into app_private.tutor_reservations(occurrence_id,tutor_id,start_at,end_at) values($1,$2,$3,$4)', [slot.occurrenceId, original.tutor_id, slot.start, slot.end]);
        }
        await database.query('commit');
      } catch (error) { await database.query('rollback'); throw error; }
      await step(`${kind}:fee`, 'approve_tutor_fee', { p_occurrence_id: slot.occurrenceId, p_tutor_id: original.tutor_id, p_fee_minor: Number(model.fee_minor), p_currency: 'EGP', p_duration_minutes: original.duration_minutes, p_compensation_policy_version_id: model.pricing_version_id, p_target_tier: original.target_tier, p_purpose: 'initial', p_reason: `Fictional historical Preview practice ${kind}; copied explicit approved preview fee; not historical workbook service`, p_expected_version: 1 });
      await database.query('begin');
      try {
        if (!(await database.query('select id from app_private.enrollments where id=$1', [slot.enrollmentId])).rowCount) {
          const acceptedAt = new Date(Date.parse(slot.start) - 86400000).toISOString();
          await database.query("insert into app_private.enrollments(id,occurrence_id,learner_id,booker_account_id,state) values($1,$2,$3,$4,'confirmed')", [slot.enrollmentId, slot.occurrenceId, original.learner_id, original.booker_account_id]);
          await database.query(`with original as(select q.*,q.customer_terms||jsonb_build_object('quote_id',$2::uuid,'enrollment_id',$3::uuid,'occurrence_id',$4::uuid,'start_at',$5::timestamptz,'end_at',$6::timestamptz,'expires_at',$5::timestamptz-interval '1 hour','policy_version_id',$8::uuid,'pricing_version_id',$9::uuid,'customer_policy',app_private.customer_policy_summary($8::uuid)) terms from app_private.quotes q where id=$1) insert into app_private.quotes(id,enrollment_id,occurrence_id,version,base_occurrence_version,base_terms_version,policy_version_id,pricing_version_id,target_tier,customer_price_minor,currency,expires_at,customer_terms,terms_hash,created_at) select $2,$3,$4,1,2,1,$8,$9,target_tier,customer_price_minor,currency,$5::timestamptz-interval '1 hour',terms,app_private.catalog_hash(terms),$7 from original`, [original.current_quote_id, slot.quoteId, slot.enrollmentId, slot.occurrenceId, slot.start, slot.end, acceptedAt, model.policy_version_id, model.pricing_version_id]);
          await database.query('update app_private.enrollments set current_quote_id=$2 where id=$1', [slot.enrollmentId, slot.quoteId]);
          await database.query('insert into app_private.quote_acceptances(id,quote_id,actor_account_id,learner_id,terms_hash,accepted_at) select $1,id,$3,$4,terms_hash,$5 from app_private.quotes where id=$2', [slot.acceptanceId, slot.quoteId, original.booker_account_id, original.learner_id, acceptedAt]);
          await database.query("update app_private.occurrences set state='confirmed' where id=$1", [slot.occurrenceId]);
          await database.query("insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values($1,$2,'fictional_preview_historical_admission',$3,$4)", [source.actors.owner.id, stablePreviewId(source.sourceHash, `historical:${kind}:audit-command`), slot.occurrenceId, { provenance: 'fictional_preview_admission_only', source_future_enrollment_id: original.enrollment_id, imported_workbook_history_changed: false, actual_attendance_asserted: false, financial_postings_seeded: false }]);
        }
        await database.query('commit');
      } catch (error) { await database.query('rollback'); throw error; }
      // The normal series API correctly refuses past dates. The immutable admission audit and
      // private handoff label these fictional exercises; do not rewrite their date to pass that gate.
      const charge = await step(`${kind}:charge`, 'prepare_enrollment_charge', { p_enrollment_id: slot.enrollmentId, p_expected_version: 1 }, learner); slot.chargeId = charge.charge_id as string;
      const amount = Number(original.customer_price_minor), reference = `preview-delivery-${kind}-${source.sourceHash.slice(0, 8)}`;
      const statement = await upload(`${kind}-statement`, service, 'statement_evidence', source.receivingId!, 'record_manual_transfer', [`Generated fake incoming transfer: ${reference}`, `Amount minor units: ${amount}`, `Observed UTC: ${manifest.createdAt}`]);
      const transfer = await step(`${kind}:transfer`, 'record_manual_transfer', { p_receiving_account_id: source.receivingId, p_channel: 'instapay', p_external_id: reference, p_amount_minor: amount, p_currency: 'EGP', p_observed_at: manifest.createdAt, p_statement_evidence_file_id: statement }, service); slot.transferId = transfer.transfer_id as string;
      const settlementEvidence = await upload(`${kind}-settlement`, service, 'statement_evidence', slot.transferId, 'verify_transfer_settlement', [`Independent generated fake settled entry: ${reference}`, `Amount minor units: ${amount}`]);
      const settled = await step(`${kind}:settle`, 'verify_transfer_settlement', { p_transfer_id: slot.transferId, p_statement_evidence_id: settlementEvidence, p_external_id: reference, p_settled_at: manifest.createdAt, p_amount_minor: amount, p_currency: 'EGP', p_verification_note: 'Generated independent fake evidence for fictional preview practice, not a real payment', p_expected_version: transfer.version }, service);
      const ownership = await upload(`${kind}-ownership`, service, 'review_evidence', slot.transferId, 'bind_transfer_payer', [`Generated fake ownership for ${reference}`, `Payer alias: ${source.actors['student:5'].email}`]);
      await step(`${kind}:payer`, 'bind_transfer_payer', { p_transfer_id: slot.transferId, p_payer_account_id: original.booker_account_id, p_evidence_file_id: ownership, p_reason: 'Generated fake payer ownership for fictional preview practice only', p_expected_version: settled.version }, service);
      const receiptFile = await upload(`${kind}-receipt`, learner, 'receipt', slot.chargeId, 'submit_receipt', [`Generated fake CUSTOMER receipt: ${reference}`, `Amount minor units: ${amount}`, 'Independent staff review required.']);
      const receipt = await step(`${kind}:receipt`, 'submit_receipt', { p_enrollment_id: slot.enrollmentId, p_charge_id: slot.chargeId, p_file_id: receiptFile, p_receiving_account_version_id: source.receivingVersionId, p_channel: 'instapay', p_transferred_amount_minor: amount, p_currency: 'EGP', p_reference: reference, p_transferred_at: null }, learner); slot.receiptId = receipt.receipt_id as string;
      const claim = await step(`${kind}:claim`, 'claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1 }, service);
      await step(`${kind}:allocate`, 'allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: slot.transferId, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: slot.chargeId, amount_minor: amount }], p_expected_version: claim.version }, service);
      slot.funded = true; await save(manifest);
    }
    manifest.state = manifest.state === 'verified' ? 'verified' : 'ready'; await save(manifest);
    if (process.argv.includes('--verify-delivery')) {
      const slot = manifest.verified;
      if (!slot.earningId) {
        const started = await step('verify:start', 'start_occurrence', { p_occurrence_id: slot.occurrenceId, p_actual_start_at: slot.start, p_expected_version: 2 }, tutor);
        const attendance = await step('verify:attendance', 'record_attendance', { p_occurrence_id: slot.occurrenceId, p_actual_start_at: slot.start, p_actual_end_at: slot.end, p_entries: [{ enrollment_id: slot.enrollmentId, attendance: 'present', attended_seconds: original.duration_minutes * 60, reason: 'Explicit fictional Preview practice attendance; no real delivery asserted' }], p_expected_version: started.version }, tutor);
        const completion = await step('verify:completion', 'submit_completion', { p_occurrence_id: slot.occurrenceId, p_attendance_version: attendance.attendance_version, p_topic_summary: 'Fictional Preview practice verification of attendance, completion and payroll. This is not real historical delivery.', p_delivery_exception_ids: [], p_expected_version: attendance.version }, tutor);
        const approved = await step('verify:approve', 'approve_completion', { p_occurrence_id: slot.occurrenceId, p_completion_version: 1, p_approved_remedy_ids: [], p_expected_version: completion.version }); slot.earningId = approved.base_earning_id as string; await save(manifest);
      }
      if (correctedTerms.tutorFeeMinor !== Number(original.fee_minor)) {
        const correctionEvidence = await upload('earning-correction-v2', admin, 'review_evidence', slot.earningId, 'adjust_tutor_earning', ['Privileged preview correction evidence.', 'Original zero base earning retained. Use source session row 79 stated Instructor Rate, not status-derived Fee Due.', `Exact corrected practice fee minor units: ${correctedTerms.tutorFeeMinor}`, `Source SHA-256: ${source.sourceHash}`]);
        await step('v2:earning-adjustment', 'adjust_tutor_earning', { p_earning_id: slot.earningId, p_delta_minor: correctedTerms.tutorFeeMinor - Number(original.fee_minor), p_effective_at: manifest.createdAt, p_reason: 'Preview fee-input correction: source session row 79 stated Instructor Rate replaces the erroneously selected zero Fee Due balance. Original approved earning retained and referenced; not real historical payroll.', p_evidence_file_id: correctionEvidence, p_expected_version: 1 });
      }
      const cipher = createIdentifierCipher({ currentKeyId: server.secret_encryption_key_id, currentKey: server.secret_encryption_key!, previousKeys: server.secret_encryption_previous_keys }), port = privatePayoutDestinationPort(worker);
      const actorClaims = async (client: ApiClient) => { const result = await client.auth.getClaims(); assert(!result.error && result.data); return { account_id: result.data.claims.sub, session_id: String(result.data.claims.session_id) }; };
      await step('verify:payout-method', 'set_tutor_payout_methods', { p_tutor_id: original.tutor_id, p_channels: ['instapay'], p_expected_version: 1 });
      const proposed = await createPayoutDestinationTransport({ client: tutor, cipher, port }).submit(await actorClaims(tutor), { p_channel: 'instapay', p_identifier: `preview-delivery-${source.sourceHash.slice(0, 8)}@instapay`, p_payee_name: 'Fictional preview tutor destination', p_idempotency_key: `operational-delivery-v1:${source.sourceHash.slice(0, 12)}:destination` });
      const destination = proposed.data as { destination_id: string; version: number };
      const ownership = await upload('payout-ownership', admin, 'review_evidence', destination.destination_id, 'verify_payout_destination', ['Generated independent fake tutor destination ownership.']);
      const verified = await createPayoutDestinationTransport({ client: admin, cipher, port }).verify(await actorClaims(admin), { p_destination_id: destination.destination_id, p_evidence_file_id: ownership, p_decision: 'verified', p_reason: 'Generated fake ownership for explicitly fictional preview payout', p_expected_version: destination.version, p_idempotency_key: `operational-delivery-v1:${source.sourceHash.slice(0, 12)}:verify-destination` });
      const payout = await step('verify:payout', 'authorize_payout', { p_tutor_id: original.tutor_id, p_destination_version_id: (verified.data as { destination_version_id: string }).destination_version_id, p_allocations: [{ earning_id: slot.earningId, amount_minor: correctedTerms.tutorFeeMinor }] });
      slot.payoutAttemptId = payout.payout_attempt_id as string;
      slot.payoutSettledAt ??= new Date().toISOString(); await save(manifest);
      const proof = await upload('payout-settlement', admin, 'review_evidence', slot.payoutAttemptId, 'reconcile_payout', ['Generated independent fake payout settlement. No money was sent.']);
      await invokePayrollCommandWithStatus(admin, 'reconcile_payout', { p_payout_attempt_id: slot.payoutAttemptId, p_outcome: 'settled', p_receiving_account_id: source.receivingId, p_external_reference: `preview-delivery-payout-${source.sourceHash.slice(0, 12)}`, p_evidence_file_id: proof, p_settled_at: slot.payoutSettledAt, p_expected_version: payout.version, p_idempotency_key: `operational-delivery-v1:${source.sourceHash.slice(0, 12)}:reconcile-payout` });
      manifest.state = 'verified'; await save(manifest);
    }
    const base = (await readFile(resolve(folder, 'public-url.txt'), 'utf8')).trim();
    process.env.PREVIEW_BASE_URL = base; await writeOperationalHandoff(source); await refreshOperationalCairoHandoff(source);
    await writeFile(resolve(folder, 'DELIVERY-PRACTICE.md'), `# Fictional historical delivery practice\n\nThese two explicitly labelled practice sessions use the imported learner/tutor identities and approved preview terms. Their historical admission/quote acceptance was deliberately prepared for exercise; no workbook history was changed. Fake payments use uploaded, scanned generated evidence and ordinary authorized reconciliation commands.\n\n## Your tutor exercise\n\n[Tutor practice session](${base}/tutor/schedule?occurrence=${manifest.personal.occurrenceId}) · [Admin practice session](${base}/admin/schedule?occurrence=${manifest.personal.occurrenceId}) · [Learner booking](${base}/learn/bookings/${manifest.personal.enrollmentId})\n\nUse UTC actual start ${manifest.personal.start} and end ${manifest.personal.end}; the UI displays Africa/Cairo. This session is funded and remains ready for your tutor start, attendance and completion exercise.\n\n## Verification example\n\n[Verified tutor session](${base}/tutor/schedule?occurrence=${manifest.verified.occurrenceId}) · [Tutor statement](${base}/tutor/pay) · [Admin payroll](${base}/admin/pay)\n\nState: ${manifest.state}. ${manifest.state === 'verified' ? 'Fictional attendance, completion approval, earning and fake settled payout executed through production commands with generated evidence.' : 'No completion, earning or payout has been asserted yet.'}\n\nIDs and command evidence: [delivery-manifest.json](./delivery-manifest.json). Credentials remain in [START-HERE.md](./START-HERE.md).\n`, { mode: 0o600 });
    await refreshDeliveryCairoHandoff(manifest);
    console.log(JSON.stringify({ historical_practice_examples: 2, state: manifest.state, untouched_tutor_exercise: true, imported_history_changed: false, handoff: '.local/operational-preview/DELIVERY-PRACTICE.md' }));
  } finally { await Promise.allSettled(clients.map(client => client.auth.signOut({ scope: 'local' }))); if (locked) await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:operational-delivery:v1',0))"); await worker.end(); await database.end(); }
}
export async function refreshDeliveryCairoHandoff(manifest: DeliveryManifest) {
  const handoff = resolve(folder, 'DELIVERY-PRACTICE.md');
  const existing = (await readFile(handoff, 'utf8')).split('\n## Cairo inputs for your tutor exercise')[0];
  const start = previewCairoTime(manifest.personal.start), end = previewCairoTime(manifest.personal.end);
  const base = (await readFile(resolve(folder, 'public-url.txt'), 'utf8')).trim();
  await writeFile(handoff, `${existing}\n## Cairo inputs for your tutor exercise\n\nUse the tutor alias from START-HERE, then [open your corrected historical practice session](${base}/tutor/schedule?occurrence=${manifest.personal.occurrenceId}).\n\nStart: **${start.label}** — date/time input **${start.input}**.\n\nEnd: **${end.label}** — date/time input **${end.input}**.\n\nThese are Africa/Cairo local values. Mark the fictional learner present for **${(Date.parse(manifest.personal.end) - Date.parse(manifest.personal.start)) / 60000} minutes**, submit completion with a clear Preview practice topic summary, then sign in as owner and [approve this session](${base}/admin/schedule?occurrence=${manifest.personal.occurrenceId}). Use [Tutor pay](${base}/tutor/pay) and [Admin payroll](${base}/admin/pay) to inspect the resulting exact private agreement and payable amount.\n\nThis prepared historical exercise has no recorded attendance or completion yet. The separate verified example demonstrates the complete fake payout path. All superseded examples remain preserved in the private manifests.\n`, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(async error => { await writeFile(resolve(folder, 'delivery-error.json'), JSON.stringify({ name: error?.name, code: error?.code, message: error?.message, stack: error?.stack }, null, 2), { mode: 0o600 }); console.error(error instanceof Error && (/^[A-Z0-9_: -]+$/.test(error.message) || /^DELIVERY_COMMAND_FAILED:[a-z_]+:[A-Z0-9]+:[A-Z_]+$/.test(error.message)) ? error.message : 'DELIVERY_PREPARATION_FAILED_PRIVATE_DIAGNOSTIC_SAVED'); process.exitCode = 1; });
