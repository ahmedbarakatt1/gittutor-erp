/** Explicit owner-authorized import into the separately marked private operational preview. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Client, Pool } from 'pg';
import { workflowSnapshotSchema } from '../src/modules/workflow-import/model';
import { mapSourceEntities, normalizedSourceName, operationalPreviewMarker, practiceSourceTerms, previewCairoTime, previewPdf, stablePreviewId } from './operational-preview-data';
import { parseServerConfig } from '../src/server/config';
import { createFileContentService } from '../src/server/files';
import { invokeFileCommandWithStatus } from '../src/modules/files/commands';
import { getFile } from '../src/modules/files/queries';
import { fileScanHandler } from '../src/worker/file-scan';
import { createFakeScanAdapter } from '../src/server/providers/file-scan';
import { claimJobs } from '../src/worker/claims';
import { executeLeasedJob } from '../src/worker/execute';
import { assertHostedOperationalTarget, type HostedOperationalTarget } from './hosted-operational-target';

type Json = Record<string, unknown>;
type Actor = { id: string; email: string; password: string; displayName: string; learnerId?: string; tutorId?: string };
type Step = { name: string; args: Json; hash: string; result: Json };
type Slot = { occurrenceId: string; offerId: string; start: string; end: string; bookingUrl: string; externalId: string; observedAt: string; transferId: string; settlementFileId: string; ownershipFileId: string; enrollmentId?: string; chargeId?: string; receiptId?: string; caseId?: string; materialFileId?: string };
export type OperationalPreviewManifest = {
  marker: typeof operationalPreviewMarker; sourceHash: string; contentHash: string; createdAt: string; effectiveAt: string;
  state: 'preparing' | 'canonical_ready' | 'ready'; actors: Record<string, Actor>; steps: Record<string, Step>;
  batchId?: string; subjectIds: string[]; tutorId?: string; learnerId?: string; pricingId?: string; privateOfferId?: string;
  receivingId?: string; receivingVersionId?: string; personal?: Slot; verified?: Slot;
  practiceSourceRow: number; historicalRecordsAreUnverified: true; guardianConsentImported: false;
  termsVersion?: 2; supersededPersonal?: Slot;
};
type Config = HostedOperationalTarget & { publishable_key: string; secret_key: string; secret_encryption_key: string };
const folder = resolve('.local/operational-preview');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw new Error(code); };
function createPreviewClient(config: Config) { return createClient(config.url, config.publishable_key, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } }); }
type ApiClient = ReturnType<typeof createPreviewClient>;

export async function writeOperationalHandoff(manifest: OperationalPreviewManifest, folder = resolve('.local/operational-preview')) {
  const base = new URL(process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:3000');
  assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'PREVIEW_ORIGIN_INVALID');
  const actors = ['owner', 'student:5', 'tutor:5', 'service'].map(key => { const actor = manifest.actors[key]; return `| ${key} | ${actor.email} | ${actor.password} |`; }).join('\n');
  const slot = manifest.personal;
  const practice = slot ? `\n## Untouched practice booking\n\n[Book this session](${base.origin}/learn/bookings?offer=${slot.offerId}&occurrence=${slot.occurrenceId})\n\nUTC start: ${slot.start}; end: ${slot.end}. The website displays Africa/Cairo time.\n\nUpload [practice-receipt.pdf](./practice-receipt.pdf). Reference: ${slot.externalId}.\n\nThe receipt is generated fake evidence; the independently prepared transfer remains pending until you explicitly verify it.\n\n[Review independent transfer](${base.origin}/service/payments/transfers/${slot.transferId})\n\nSettlement evidence: ${slot.settlementFileId}\n\nPayer ownership evidence: ${slot.ownershipFileId}\n\nCollection account version: ${manifest.receivingVersionId}\n\n[Tutor workspace](${base.origin}/tutor/schedule?occurrence=${slot.occurrenceId}) · [Admin workspace](${base.origin}/admin/schedule?occurrence=${slot.occurrenceId})\n\nA second practice session is reserved for verification. Neither practice session changes the historical workbook date or asserts real delivery, settlement, earnings or payout.\n` : '';
  await writeFile(resolve(folder, 'START-HERE.md'), `# Private Git Tutor operational preview\n\n[Sign in](${base.origin}/login). These aliases access real imported names and private workbook records. Keep this file private.\n\n| Role/source profile | Email | Password |\n|---|---|---|\n${actors}\n\nAll role credentials and imported profile IDs are in [manifest.json](./manifest.json). Source contacts are unverified; login aliases do not contact real people. No guardian consent or guardian relationship has been inferred.\n\n[Student bookings](${base.origin}/learn/bookings) · [Tutor schedule](${base.origin}/tutor/schedule) · [Payment service](${base.origin}/service/payments) · [Customer register](${base.origin}/admin/customers) · [Imported source records](${base.origin}/admin/workflow)\n\nHistorical workbook values remain reported, unverified observations. Exact full-name matches are linked; ambiguous/first-name records require review. New preview commercial policies are explicitly approved for development only and are not live commercial approval.\n${practice}\nImport source SHA-256: ${manifest.sourceHash}\n\nImport batch: ${manifest.batchId}\n\nPreparation status: ${manifest.state}. Browser verification is recorded separately by the verification operator.\n`, { mode: 0o600 });
}

export async function refreshOperationalCairoHandoff(manifest: OperationalPreviewManifest, folder = resolve('.local/operational-preview')) {
  if (!manifest.personal) return;
  const path = resolve(folder, 'START-HERE.md');
  const existing = (await readFile(path, 'utf8')).split('\n## Cairo practice times')[0];
  const start = previewCairoTime(manifest.personal.start), end = previewCairoTime(manifest.personal.end);
  await writeFile(path, `${existing}\n## Cairo practice times\n\nYour corrected future practice booking: **${start.label} to ${end.label}**, Africa/Cairo.\n\nExact local date/time inputs, if needed: start **${start.input}**, end **${end.input}**.\n\n[Start this exact untouched booking](${manifest.personal.bookingUrl})\n\n[Practice tutor delivery now](./DELIVERY-PRACTICE.md) uses a separately prepared historical fictional session, so you can try attendance, completion and payroll without waiting for the future appointment.\n`, { mode: 0o600 });
}

export async function importOperationalWorkflow(preparePractice = true, hostedPreview = false) {
  const folder = resolve(hostedPreview ? '.local/hosted-preview' : '.local/operational-preview');
  const manifestPath = resolve(folder, 'manifest.json');
  const save = async (manifest: OperationalPreviewManifest) => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const config = JSON.parse(await readFile(resolve(folder, 'config.json'), 'utf8')) as Config;
  assert.equal(config.marker, operationalPreviewMarker, 'PREVIEW_CONFIG_MARKER_REQUIRED');
  if (!hostedPreview) {
    assert.equal(new URL(config.url).origin, 'http://127.0.0.1:54331', 'PREVIEW_API_TARGET_REQUIRED');
    for (const connection of [config.database_url, config.worker_database_url]) {
      const address = new URL(connection); assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.port, '54332');
    }
  }
  const snapshot = workflowSnapshotSchema.parse(JSON.parse(await readFile(resolve('.local/workflow-import/workflow-snapshot.json'), 'utf8')));
  if (hostedPreview) assertHostedOperationalTarget(config, snapshot.source_sha256, process.env.APP_ENV);
  const mapped = mapSourceEntities(snapshot), terms = practiceSourceTerms(snapshot), content = JSON.stringify(snapshot), contentHash = hash(content);
  const database = new Client({ connectionString: config.database_url }); await database.connect();
  const worker = new Pool({ connectionString: config.worker_database_url });
  const auth = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const clients: ApiClient[] = [];
  let locked = false;
  try {
    const marker = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    assert.equal(marker?.environment, 'development', 'PREVIEW_DATABASE_ENVIRONMENT_REQUIRED');
    assert.equal(marker?.fixture_marker, operationalPreviewMarker, 'PREVIEW_DATABASE_MARKER_REQUIRED');
    locked = Boolean((await database.query("select pg_try_advisory_lock(hashtextextended('git-tutor:operational-preview:v1',0)) locked")).rows[0].locked);
    assert(locked, 'PREVIEW_IMPORT_ALREADY_RUNNING');
    await mkdir(folder, { recursive: true });
    let manifest: OperationalPreviewManifest;
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as OperationalPreviewManifest; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const previousOwner = hostedPreview ? null : JSON.parse(await readFile(resolve('.local/workflow-import/owner.json'), 'utf8')) as Actor;
      const createdAt = new Date().toISOString();
      const actor = (label: string, displayName: string): Actor => ({ id: stablePreviewId(snapshot.source_sha256, `account:${label}`), email: `operational-${label.replace(/:/g, '-')}-${snapshot.source_sha256.slice(0, 8)}@preview.gittutor.invalid`, password: randomBytes(24).toString('base64url'), displayName });
      const owner = actor('owner', 'Git Tutor private records owner');
      if (previousOwner) Object.assign(owner, { email: previousOwner.email, password: previousOwner.password });
      manifest = { marker: operationalPreviewMarker, sourceHash: snapshot.source_sha256, contentHash, createdAt, effectiveAt: new Date(Date.parse(createdAt) - 60000).toISOString(), state: 'preparing', actors: { owner, service: actor('service', 'Git Tutor preview customer service') }, steps: {}, subjectIds: mapped.courses.map(item => item.id), practiceSourceRow: terms.sourceRow, historicalRecordsAreUnverified: true, guardianConsentImported: false };
      for (const entity of [...mapped.students, ...mapped.tutors]) manifest.actors[entity.label] = actor(entity.label, entity.name);
      await save(manifest);
    }
    assert.equal(manifest.marker, operationalPreviewMarker); assert.equal(manifest.sourceHash, snapshot.source_sha256, 'PREVIEW_SOURCE_CHANGED'); assert.equal(manifest.contentHash, contentHash, 'PREVIEW_CONTENT_CHANGED');
    if (manifest.termsVersion === 2 && manifest.state === 'ready') {
      const current = (await database.query("select b.content_sha256,app_private.has_role(b.owner_account_id,'admin') allowed from app_private.workflow_import_batches b where b.id=$1 and b.source_sha256=$2", [manifest.batchId, manifest.sourceHash])).rows[0];
      assert(current?.allowed && current.content_sha256 === contentHash, 'PREVIEW_APPROVED_REVISION_CONFLICT');
      await writeOperationalHandoff(manifest, folder); await refreshOperationalCairoHandoff(manifest, folder);
      console.log('Existing operational preview terms revision 2 preserved; private handoff refreshed.'); return;
    }
    for (const actor of Object.values(manifest.actors)) {
      assert(actor.email.endsWith('@preview.gittutor.invalid') && actor.password.length >= 24, 'PREVIEW_ALIAS_REQUIRED');
      const existing = (await database.query('select email from auth.users where id=$1', [actor.id])).rows[0];
      if (existing) assert.equal(existing.email, actor.email, 'PREVIEW_ACCOUNT_CONFLICT');
      else {
        assert.equal(manifest.state, 'preparing', 'PREVIEW_ACCOUNT_REMOVED');
        const result = await auth.auth.admin.createUser({ id: actor.id, email: actor.email, password: actor.password, email_confirm: true, user_metadata: { display_name: actor.displayName, operational_preview: true } });
        if (result.error) fail(`PREVIEW_AUTH_CREATE_FAILED:${result.error.status}`);
      }
    }
    await database.query('begin');
    try {
      const existingBatch = (await database.query('select id,content_sha256 from app_private.workflow_import_batches where owner_account_id=$1 and source_sha256=$2', [manifest.actors.owner.id, snapshot.source_sha256])).rows[0];
      if (existingBatch) {
        assert.equal(existingBatch.content_sha256, contentHash, 'PREVIEW_SOURCE_BATCH_CONFLICT');
        assert((await database.query("select exists(select 1 from app_private.account_roles where account_id=$1 and role='admin' and revoked_at is null) allowed", [manifest.actors.owner.id])).rows[0].allowed, 'PREVIEW_OWNER_REVOKED');
        manifest.batchId = existingBatch.id;
      } else {
        await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','Explicit owner-authorized private operational preview import') on conflict do nothing", [manifest.actors.owner.id]);
        manifest.batchId = (await database.query("insert into app_private.workflow_import_batches(owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$3,'real',$4::jsonb) returning id", [manifest.actors.owner.id, snapshot.source_sha256, contentHash, content])).rows[0].id;
      }
      for (const course of mapped.courses) {
        const existing = (await database.query('select slug,title,active from app_private.subjects where id=$1', [course.id])).rows[0];
        if (existing) assert(existing.slug === course.slug && existing.title === course.name && existing.active, 'PREVIEW_SUBJECT_CONFLICT');
        else await database.query('insert into app_private.subjects(id,slug,title) values($1,$2,$3)', [course.id, course.slug, course.name]);
      }
      for (const actor of Object.values(manifest.actors)) actor.learnerId = (await database.query('select id from app_private.learners where account_id=$1', [actor.id])).rows[0]?.id;
      await database.query('commit');
    } catch (error) { await database.query('rollback'); throw error; }
    await save(manifest);
    async function login(actor: Actor) {
      const client = createPreviewClient(config);
      const result = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
      if (result.error) fail('PREVIEW_LOGIN_FAILED'); clients.push(client); return client;
    }
    const admin = await login(manifest.actors.owner), service = await login(manifest.actors.service);
    async function step(label: string, name: string, args: Json, client = admin): Promise<Json> {
      const key = `operational-v1:${snapshot.source_sha256.slice(0, 16)}:${label}`;
      const request = { ...args, p_idempotency_key: key }, requestHash = hash(JSON.stringify(request)), previous = manifest.steps[label];
      if (previous) assert(previous.name === name && previous.hash === requestHash, `PREVIEW_STEP_CONFLICT:${label}`);
      const result = await client.rpc(name, request);
      if (result.error) {
        await writeFile(resolve(folder, 'rpc-error.json'), JSON.stringify({ function: name, error: result.error }, null, 2), { mode: 0o600 });
        fail(`PREVIEW_COMMAND_FAILED:${name}:${result.error.code}:${/^[A-Z_]+$/.test(result.error.message) ? result.error.message : 'REDACTED'}`);
      }
      manifest.steps[label] = { name, args: request, hash: requestHash, result: result.data as Json }; await save(manifest); return result.data as Json;
    }
    for (const [label, actor] of Object.entries(manifest.actors)) if (!label.startsWith('student:')) {
      await step(`${label}:archive-auto-learner`, 'set_customer_archived', { p_learner_id: actor.learnerId, p_archived: true, p_reason: 'Automatically created staff/tutor login learner is not a workbook student; preserve identity and exclude from active customer register', p_expected_version: 1 });
    }
    for (const entity of mapped.students) {
      const source = snapshot.tables.students.rows.find(row => row.source_row === entity.sourceRow)!;
      let version = 1;
      for (const [field, meaning] of [['col_e', 'student contact'], ['col_f', 'reported parent/main contact; no guardian consent or ownership established']] as const) {
        const destination = typeof source.values[field] === 'string' ? source.values[field].trim() : '';
        const normalized = destination.replace(/[ ()-]/g, '');
        const channel = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination) ? 'email' : /^\+[1-9][0-9]{7,14}$/.test(normalized) ? 'phone' : null;
        if (!channel) continue; // Retain malformed/local-only literals in the original snapshot; never infer a country code.
        const recorded = await step(`${entity.label}:contact:${field}`, 'record_customer_contact', { p_learner_id: manifest.actors[entity.label].learnerId, p_channel: channel, p_destination: destination, p_evidence_note: `Unverified workbook source observation, students row ${entity.sourceRow}, ${meaning}. Not a verified contact and not notification authority.`, p_expected_version: version });
        version = recorded.version as number;
      }
    }
    await step('service-role', 'grant_staff_role', { p_account_id: manifest.actors.service.id, p_role: 'customer_service', p_reason: 'Private operational preview alias; fake providers only' });
    for (const entity of mapped.tutors) {
      const actor = manifest.actors[entity.label];
      await step(`${entity.label}:role`, 'grant_staff_role', { p_account_id: actor.id, p_role: 'tutor', p_reason: 'Owner-authorized exact workbook tutor profile; alias contact only' });
      const profile = (await database.query('select id,contact_id from app_private.tutors where account_id=$1', [actor.id])).rows[0]; actor.tutorId = profile.id;
      const subjectIds = [...new Set(mapped.links.filter(link => link.exactTutor && link.tutorLabel === entity.label && link.subjectId).map(link => link.subjectId!))];
      if (!subjectIds.length) continue;
      const tutor = await login(actor);
      const updated = await step(`${entity.label}:profile`, 'update_tutor_profile', { p_display_name: entity.name, p_bio: 'Imported workbook teaching identity. Subject associations are exact source observations. Preview access uses an alias; real contact ownership remains unverified.', p_subject_ids: subjectIds, p_contact_id: profile.contact_id, p_locale: 'en', p_expected_version: 1 }, tutor);
      const draft = (await database.query('select draft_profile_version_id,approved_profile_version_id from app_private.tutors where id=$1', [profile.id])).rows[0];
      await step(`${entity.label}:approve`, 'approve_tutor_profile', { p_tutor_id: profile.id, p_profile_version_id: draft.draft_profile_version_id ?? draft.approved_profile_version_id, p_decision: 'approved', p_reason: 'Preview-only approval of exact workbook teaching associations; not verification of external identity or credentials', p_expected_version: updated.version });
    }
    manifest.learnerId = manifest.actors[`student:${terms.studentRow}`].learnerId;
    manifest.tutorId = manifest.actors[`tutor:${terms.tutorRow}`].tutorId;
    assert(manifest.learnerId && manifest.tutorId, 'PRACTICE_CANONICAL_IDENTITIES_REQUIRED');
    await save(manifest);
    // The source mapping migration owns table shape and safe role projections.
    await linkSourceRows(database, manifest, mapped, snapshot);
    manifest.state = manifest.state === 'ready' ? 'ready' : 'canonical_ready'; await save(manifest);
    if (!preparePractice) { await writeOperationalHandoff(manifest, folder); console.log('Canonical operational import ready; private handoff saved.'); return; }

    const policySource = JSON.parse(await readFile(resolve('contracts/policy-settings.json'), 'utf8')) as { development_examples: { fixture_id: string; policy?: Json }[] };
    const groupSource = JSON.parse(await readFile(resolve('contracts/pricing-policy.json'), 'utf8')) as { customer_pricing: { group_tiers: unknown[] }; internal_compensation: { group_fee_bands: unknown[] } };
    const exactFee = { currency: 'EGP', fee_min_minor: terms.tutorFeeMinor, fee_max_minor: terms.tutorFeeMinor, exact_occurrence_approval_required: true };
    const approval = 'Explicit preview practice commercial policy approved by the private preview owner. Development only; not a live business approval.';
    async function catalog(scope: 'private' | 'group') {
      const isPrivate = scope === 'private', duration = isPrivate ? terms.durationMinutes : 60;
      const pricing = await step(`${scope}:pricing`, 'create_pricing_draft', { p_scope: scope, p_customer_pricing: { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: duration, group_tiers: isPrivate ? null : groupSource.customer_pricing.group_tiers, private_seat_price_minor: isPrivate ? terms.tuitionMinor : null }, p_compensation: { currency: 'EGP', group_fee_bands: isPrivate ? null : groupSource.internal_compensation.group_fee_bands, private_fee_rule: isPrivate ? exactFee : null } });
      await step(`${scope}:pricing-approve`, 'approve_pricing_version', { p_pricing_version_id: pricing.resource_id, p_effective_at: manifest.effectiveAt, p_approval_note: approval, p_expected_version: 1 });
      const policy = structuredClone(policySource.development_examples.find(item => item.fixture_id === (isPrivate ? 'synthetic_private_booking_policy_v1' : 'synthetic_group_policy_v1'))!.policy!);
      for (const key of ['policy_version_id', 'status', 'environment_scope', 'is_synthetic', 'approved_by', 'approved_at', 'effective_at']) delete policy[key];
      Object.assign(policy, { duration_minutes: duration, customer_pricing_version: pricing.resource_id, compensation_policy_version: pricing.resource_id, package_enabled: false, package_contract: null, confirmation_funding_sources: ['verified_payment_allocation'], allowed_refund_remedies: ['cash_refund', 'monetary_account_credit'], learner_no_show_rule: 'retain_charge' });
      if (isPrivate) Object.assign(policy, { private_seat_price_minor: terms.tuitionMinor, private_fee_rule: exactFee });
      const draft = await step(`${scope}:policy`, 'create_policy_draft', { p_kind: 'booking', p_scope: scope, p_content: policy });
      await step(`${scope}:policy-approve`, 'approve_policy_version', { p_policy_version_id: draft.resource_id, p_effective_at: manifest.effectiveAt, p_approval_note: approval, p_expected_version: 1 });
      return { pricingId: pricing.resource_id as string, policyId: draft.resource_id as string, duration };
    }
    const group = await catalog('group'), privateCatalog = await catalog('private');
    for (const course of mapped.courses) {
      const offer = await step(`group-offer:${course.id}`, 'create_offer', { p_subject_id: course.id, p_format: 'group', p_duration_minutes: group.duration, p_capacity: 4, p_target_tier: 4, p_pricing_version_id: group.pricingId, p_policy_version_id: group.policyId });
      await step(`group-publish:${course.id}`, 'publish_offer', { p_offer_id: offer.resource_id, p_effective_at: manifest.effectiveAt, p_expected_version: 1 });
    }
    const practiceCourse = mapped.courses.find(course => normalizedSourceName(course.name) === normalizedSourceName(terms.courseName)); assert(practiceCourse, 'PRACTICE_COURSE_REQUIRED');
    const offer = await step('private-offer', 'create_offer', { p_subject_id: practiceCourse.id, p_format: 'private', p_duration_minutes: privateCatalog.duration, p_capacity: 1, p_target_tier: null, p_pricing_version_id: privateCatalog.pricingId, p_policy_version_id: privateCatalog.policyId });
    await step('private-publish', 'publish_offer', { p_offer_id: offer.resource_id, p_effective_at: manifest.effectiveAt, p_expected_version: 1 });
    manifest.privateOfferId = offer.resource_id as string; manifest.pricingId = privateCatalog.pricingId;
    await step('practice-availability', 'set_availability', { p_tutor_id: manifest.tutorId, p_weekly_intervals: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, start_local: '06:00', end_local: '23:00' })), p_dated_exceptions: [], p_reason: 'Explicit preview practice availability only; not imported real commitments', p_expected_version: 0 });
    await step('fake-calendar', 'connect_fake_calendar', {});
    const server = parseServerConfig({ APP_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishable_key, SUPABASE_SECRET_KEY: config.secret_key, WORKER_DATABASE_URL: config.worker_database_url, SECRET_ENCRYPTION_KEY: config.secret_encryption_key, EMAIL_ADAPTER: 'fake', CALENDAR_ADAPTER: 'fake', WHATSAPP_ADAPTER: 'fake', FILE_SCAN_ADAPTER: 'fake', PAYMENT_RECONCILIATION_ADAPTER: 'manual' });
    const files = createFileContentService(worker, server);
    async function upload(label: string, client: ApiClient, purpose: string, parent: string | null, action: string, lines: string[]) {
      const bytes = previewPdf(lines), actualChecksum = createHash('sha256').update(bytes).digest('hex');
      const result = await step(`${label}:file`, 'create_file_upload', { p_purpose: purpose, p_parent_id: parent, p_evidence_action: action, p_filename: `${label}.pdf`, p_declared_type: 'application/pdf', p_size_bytes: bytes.length, p_checksum_sha256: actualChecksum }, client);
      const fileId = result.file_id as string;
      const existing = await getFile(client, fileId).catch(() => null);
      if (!existing?.can_download) {
        await files.upload(client, fileId, bytes);
        const done = await invokeFileCommandWithStatus(client, 'finalize_file_upload', { p_file_id: fileId, p_checksum_sha256: actualChecksum, p_idempotency_key: `operational-v1:${label}:finalize` });
        await database.query('begin');
        let job;
        try {
          await database.query("select id from app_private.outbox_jobs where purpose='files.scan' and id<>$1 for update", [done.data.scan_job_id]);
          const jobs = await claimJobs(worker, 'files.scan', 1, 60); assert(jobs.length === 1 && jobs[0].id === done.data.scan_job_id, 'PREVIEW_SCAN_JOB_UNAVAILABLE'); job = jobs[0];
        } finally { await database.query('rollback'); }
        const handler = fileScanHandler(worker, async file => {
          const response = await auth.storage.from('git-tutor-private').download(file.object_key);
          assert(!response.error && response.data && response.data.size <= 25 * 1024 * 1024, 'PREVIEW_FILE_BYTES_UNAVAILABLE');
          return new Uint8Array(await response.data.arrayBuffer());
        }, scenario => createFakeScanAdapter(scenario, true));
        assert.equal(await executeLeasedJob(worker, job, handler), 'completed', 'PREVIEW_FILE_SCAN_FAILED');
        assert((await getFile(client, fileId)).can_download, 'PREVIEW_FILE_NOT_CLEAN');
      }
      return fileId;
    }
    const collection = `preview-only-${snapshot.source_sha256.slice(0, 8)}@instapay`;
    const ownership = await upload('collection-ownership', admin, 'review_evidence', null, 'create_receiving_account', ['Generated independent ownership evidence for the fake collection destination.', `Destination: ${collection}`]);
    const receiving = await step('receiving-account', 'create_receiving_account', { p_channel: 'instapay', p_collection_identifier: collection, p_display_instructions: 'PREVIEW PRACTICE ONLY. Do not send money. Use the supplied generated practice receipt.', p_ownership_evidence_file_id: ownership });
    await step('receiving-approve', 'approve_receiving_account', { p_receiving_account_id: receiving.receiving_account_id, p_enabled: true, p_verification_note: 'Generated preview ownership only; no real account or payment requested', p_expected_version: 1 });
    manifest.receivingId = receiving.receiving_account_id as string;
    manifest.receivingVersionId = (await database.query('select current_version_id from finance_private.receiving_accounts where id=$1', [manifest.receivingId])).rows[0].current_version_id;
    for (const [index, kind] of (['personal', 'verified'] as const).entries()) {
      const start = new Date(manifest.createdAt); start.setUTCDate(start.getUTCDate() + 7 + index); start.setUTCHours(10, 0, 0, 0);
      const end = new Date(start.getTime() + terms.durationMinutes * 60000);
      const occurrence = await step(`${kind}:occurrence`, 'create_occurrence', { p_offer_id: manifest.privateOfferId, p_tutor_id: manifest.tutorId, p_start_at: start.toISOString(), p_end_at: end.toISOString(), p_time_zone: 'Africa/Cairo', p_target_tier: null });
      const occurrenceId = occurrence.occurrence_id as string;
      await step(`${kind}:fee`, 'approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: manifest.tutorId, p_fee_minor: terms.tutorFeeMinor, p_currency: 'EGP', p_duration_minutes: terms.durationMinutes, p_compensation_policy_version_id: privateCatalog.pricingId, p_target_tier: null, p_purpose: 'initial', p_reason: `Preview practice ${kind}; explicit source session row ${terms.sourceRow} fee; no historical delivery asserted`, p_expected_version: 1 });
      await step(`${kind}:series`, 'create_occurrence_series', { p_title: `Preview practice — ${kind === 'personal' ? 'your untouched session' : 'verification session'}`, p_occurrence_ids: [occurrenceId] });
      const externalId = `preview-${kind}-${snapshot.source_sha256.slice(0, 12)}`, observedAt = manifest.effectiveAt;
      const statement = await upload(`${kind}-statement`, service, 'statement_evidence', manifest.receivingId!, 'record_manual_transfer', ['Generated independent fake statement, pending review.', `Reference: ${externalId}`, `Amount minor units: ${terms.tuitionMinor}`, `Observed UTC: ${observedAt}`]);
      const transfer = await step(`${kind}:transfer`, 'record_manual_transfer', { p_receiving_account_id: manifest.receivingId, p_channel: 'instapay', p_external_id: externalId, p_amount_minor: terms.tuitionMinor, p_currency: 'EGP', p_observed_at: observedAt, p_statement_evidence_file_id: statement }, service);
      const transferId = transfer.transfer_id as string;
      const settlementFileId = await upload(`${kind}-settlement`, service, 'statement_evidence', transferId, 'verify_transfer_settlement', ['Generated independent fake settlement evidence for practice review.', `Reference: ${externalId}`, `Amount minor units: ${terms.tuitionMinor}`, `Observed UTC: ${observedAt}`]);
      const ownershipFileId = await upload(`${kind}-payer`, service, 'review_evidence', transferId, 'bind_transfer_payer', ['Generated fake payer ownership evidence for practice.', `Payer alias: ${manifest.actors[`student:${terms.studentRow}`].email}`, `Reference: ${externalId}`]);
      manifest[kind] = { ...manifest[kind], occurrenceId, offerId: manifest.privateOfferId, start: start.toISOString(), end: end.toISOString(), bookingUrl: `${config.base_url || 'http://127.0.0.1:3000'}/learn/bookings?offer=${manifest.privateOfferId}&occurrence=${occurrenceId}`, externalId, observedAt, transferId, settlementFileId, ownershipFileId };
      await writeFile(resolve(folder, `${kind === 'personal' ? 'practice' : 'verification'}-receipt.pdf`), previewPdf(['Generated CUSTOMER receipt; staff must independently verify its facts.', `Reference: ${externalId}`, `Amount: EGP ${(terms.tuitionMinor / 100).toFixed(2)}`, `Collection: ${collection}`, `Payer: ${manifest.actors[`student:${terms.studentRow}`].email}`]), { mode: 0o600 });
      await save(manifest);
    }
    await writeFile(resolve(folder, 'practice-material.pdf'), previewPdf(['Preview practice lesson preparation.', 'Write your learning goals and one topic to discuss.']), { mode: 0o600 });
    manifest.state = 'ready'; await save(manifest); await writeOperationalHandoff(manifest, folder); await refreshOperationalCairoHandoff(manifest, folder);
    console.log(JSON.stringify({ canonical_students: mapped.students.length, canonical_tutors: mapped.tutors.length, canonical_courses: mapped.courses.length, preview_practice_occurrences: 2, status: 'ready', handoff: `${hostedPreview ? '.local/hosted-preview' : '.local/operational-preview'}/START-HERE.md` }));
  } finally {
    await Promise.allSettled(clients.map(client => client.auth.signOut({ scope: 'local' })));
    if (locked) await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:operational-preview:v1',0))");
    await worker.end(); await database.end();
  }
}

async function linkSourceRows(database: Client, manifest: OperationalPreviewManifest, mapped: ReturnType<typeof mapSourceEntities>, snapshot: ReturnType<typeof workflowSnapshotSchema.parse>) {
  assert((await database.query("select to_regclass('app_private.operational_workbook_links') present")).rows[0].present, 'OPERATIONAL_MAPPING_MIGRATION_REQUIRED');
  await database.query('begin');
  try {
    for (const table of ['students', 'tutors', 'sessions', 'packages', 'marketing', 'distributions', 'balances'] as const) for (const row of snapshot.tables[table].rows) {
      const mapping = mapped.links.find(link => link.table === table && link.sourceRow === row.source_row);
      const learnerId = table === 'students' ? manifest.actors[`student:${row.source_row}`].learnerId : mapping?.exactStudent && mapping.studentLabel ? manifest.actors[mapping.studentLabel].learnerId : null;
      const tutorId = table === 'tutors' ? manifest.actors[`tutor:${row.source_row}`].tutorId : mapping?.exactTutor && mapping.tutorLabel ? manifest.actors[mapping.tutorLabel].tutorId : null;
      const state = table === 'students' || table === 'tutors' || (table === 'packages' && learnerId) || (table === 'sessions' && learnerId && tutorId) ? 'linked' : 'needs_review';
      await database.query('insert into app_private.operational_workbook_links(batch_id,source_table,source_row,learner_id,tutor_id,review_state) values($1,$2,$3,$4,$5,$6) on conflict(batch_id,source_table,source_row) do nothing', [manifest.batchId, table, row.source_row, learnerId ?? null, tutorId ?? null, state]);
    }
    await database.query("insert into app_private.operational_workbook_access(batch_id,account_id,access_scope,created_by) values($1,$2,'customer_service',$3) on conflict(batch_id,account_id) do nothing", [manifest.batchId, manifest.actors.service.id, manifest.actors.owner.id]);
    const eventId = stablePreviewId(manifest.sourceHash, 'canonical-import-event');
    await database.query("insert into app_private.audit_events(id,actor_account_id,command_id,action,aggregate_id,details) values($1,$2,$3,'operational_workbook_canonical_import',$4,$5) on conflict(id) do nothing", [stablePreviewId(manifest.sourceHash, 'canonical-import-audit'), manifest.actors.owner.id, eventId, manifest.batchId, { source_sha256: manifest.sourceHash, content_sha256: manifest.contentHash, student_profiles: mapped.students.length, tutor_profiles: mapped.tutors.length, courses: mapped.courses.length, contact_authority: 'unverified_source_only', guardian_consent_imported: false, historical_financial_postings_created: false }]);
    await database.query('commit');
  } catch (error) { await database.query('rollback'); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const hostedPreview = process.argv.includes('--hosted-preview');
  importOperationalWorkflow(!process.argv.includes('--canonical-only'), hostedPreview).catch(async error => {
    // Full diagnostic stays in the ignored private workspace; stdout never prints source values or credentials.
    await writeFile(resolve(hostedPreview ? '.local/hosted-preview' : folder, 'import-error.json'), JSON.stringify({ name: error?.name, code: error?.code, message: error?.message, stack: error?.stack }, null, 2), { mode: 0o600 });
    console.error(error instanceof Error && (/^[A-Z0-9_: -]+$/.test(error.message) || /^PREVIEW_COMMAND_FAILED:[a-z_]+:[A-Z0-9]+:[A-Z_]+$/.test(error.message)) ? error.message : `OPERATIONAL_PREVIEW_PREPARATION_FAILED:${typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'PRIVATE_DIAGNOSTIC_SAVED'}`); process.exitCode = 1;
  });
}
