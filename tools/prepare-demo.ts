/** Local-only, additive walkthrough setup. Never run against a live environment. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { completionFixture } from '../tests/helpers/completion';
import { runFileScan } from '../tests/helpers/files';
import { adminDatabase, loadLocalSupabase } from '../tests/helpers/supabase';
import { catalogFixtureIds } from './catalog-seed';
import { fixtureId } from './db-seed';
import { parseServerConfig } from '../src/server/config';
import { invokeFileCommandWithStatus } from '../src/modules/files/commands';
import { getFile } from '../src/modules/files/queries';
import { invokePayrollCommandWithStatus } from '../src/modules/tutor_pay/payroll';

const manifestPath = resolve('.local/demo/manifest.json');
type Actor = { id: string; email: string; password: string };
export type DemoSlot = {
  occurrenceId: string; offerId: string; start: string; end: string; bookingUrl: string;
  transferId: string; externalId: string; observedAt: string; settlementFileId: string; ownershipFileId: string;
  enrollmentId?: string; chargeId?: string; receiptId?: string; caseId?: string; materialFileId?: string;
};
export type DemoManifest = {
  marker: 'git-tutor-guided-demo-v1'; runId: string; createdAt: string; state: 'preparing' | 'ready';
  actors: Record<'learner' | 'guardian' | 'tutor' | 'service' | 'admin', Actor>;
  tutorId: string; learnerId: string; receivingId: string; receivingVersionId: string;
  personal?: DemoSlot; verified?: DemoSlot;
  historical: { occurrenceId: string; enrollmentId: string; actualStart: string; actualEnd: string; earningId?: string; payoutId?: string };
  browser?: { verifiedAt: string; result: string };
};

// A small, readable one-page PDF with a real cross-reference table. No customer content.
export function demoPdf(lines: string[]): Buffer {
  const escaped = lines.map(line => line.replace(/[\\()]/g, '\\$&'));
  const stream = `BT /F1 13 Tf 48 780 Td ${escaped.map((line, index) => `${index ? '0 -24 Td ' : ''}(${line}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

export async function readDemo(): Promise<DemoManifest> {
  const value = JSON.parse(await readFile(manifestPath, 'utf8')) as DemoManifest;
  assert.equal(value.marker, 'git-tutor-guided-demo-v1');
  assert(Object.values(value.actors).every(actor => actor.email.endsWith('@example.test')));
  return value;
}
export async function saveDemo(value: DemoManifest) {
  await writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function writeDemoHandoff(manifest: DemoManifest) {
  const baseUrl = new URL(process.env.DEMO_BASE_URL || 'http://127.0.0.1:3000');
  assert(!baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === '/');
  assert(baseUrl.protocol === 'https:' || baseUrl.origin === 'http://127.0.0.1:3000', 'Use the authorized HTTPS preview or the local demo origin.');
  const slot = manifest.personal!;
  const cairo = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
  const credentials = Object.entries(manifest.actors).map(([role, actor]) => `| ${role} | ${actor.email} | ${actor.password} |`).join('\n');
  await writeFile(resolve('.local/demo/START-HERE.md'), `# Your Git Tutor demo\n\nSynthetic local records only. Sign in at http://127.0.0.1:3000/login. Use separate browser profiles for the roles.\n\n| Role | Email | Password |\n|---|---|---|\n${credentials}\n\n## Your untouched booking\n\n${cairo(slot.start)} to ${cairo(slot.end)}. EGP 500 private tuition. Tutor: Git Tutor guided demo ${manifest.runId}.\n\n[Start this exact booking](${slot.bookingUrl})\n\nUpload [demo-receipt.pdf](./demo-receipt.pdf). Transfer reference: **${slot.externalId}**. Amount: **EGP 500**. Choose the collection account with version ID **${manifest.receivingVersionId}** (the account ending shown on the receipt).\n\n[Independent incoming transfer](http://127.0.0.1:3000/service/payments/transfers/${slot.transferId})\n\nVerified settlement time (Cairo): **${cairo(slot.observedAt)}**. Choose prepared evidence **${slot.settlementFileId}** to verify settlement; choose ownership evidence **${slot.ownershipFileId}** when binding the learner email above.\n\n[Admin session](http://127.0.0.1:3000/admin/schedule?occurrence=${slot.occurrenceId}) · [Tutor session](http://127.0.0.1:3000/tutor/schedule?occurrence=${slot.occurrenceId})\n\n## Completed example\n\nSame learner, same tutor. Historical admission was explicitly seeded; factual attendance, approval, earning and payout used genuine authorized commands.\n\n[Learner record](http://127.0.0.1:3000/learn/bookings/${manifest.historical.enrollmentId}) · [Tutor delivery](http://127.0.0.1:3000/tutor/schedule?occurrence=${manifest.historical.occurrenceId}) · [Admin delivery](http://127.0.0.1:3000/admin/schedule?occurrence=${manifest.historical.occurrenceId}) · [Tutor earnings](http://127.0.0.1:3000/tutor/pay) · [Admin payroll](http://127.0.0.1:3000/admin/pay)\n\nExpected: EGP 250 earned, EGP 150 settled payout, EGP 100 still payable. No real money moved.\n\n## Browser-verified example\n\n${manifest.browser ? `${manifest.browser.result} at ${manifest.browser.verifiedAt}.` : 'Not yet browser-verified; do not infer a pass from setup.'}\n\n${manifest.verified?.enrollmentId ? `[Open verified booking](http://127.0.0.1:3000/learn/bookings/${manifest.verified.enrollmentId})` : 'The second session is reserved for the bounded verification run.'}\n\nFull instructions: [DEMO-WALKTHROUGH.md](../../docs/DEMO-WALKTHROUGH.md). This private file contains synthetic passwords; do not commit it.\n`, { mode: 0o600 });
  if (baseUrl.origin !== 'http://127.0.0.1:3000') {
    const handoff = resolve('.local/demo/START-HERE.md');
    await writeFile(handoff, (await readFile(handoff, 'utf8')).replaceAll('http://127.0.0.1:3000', baseUrl.origin), { mode: 0o600 });
  }
}

async function main() {
  const local = loadLocalSupabase();
  const server = parseServerConfig(process.env);
  assert(['development', 'test'].includes(server.environment));
  assert.equal(server.supabase_url, local.url);
  assert.deepEqual(server.providers, { email: 'fake', calendar: 'fake', whatsapp: 'fake', file_scan: 'fake', payments: 'manual' });
  assert(server.secret_encryption_key, 'Use the existing local encryption key, never a one-off fixture key.');
  await mkdir(resolve('.local/demo'), { recursive: true });
  const lock = await adminDatabase();
  let acquired = false;
  try {
    acquired = Boolean((await lock.query("select pg_try_advisory_lock(hashtextextended('git-tutor:guided-demo:v1',0)) locked")).rows[0].locked);
    assert(acquired, 'Another demo preparation is running.');
    let prior: DemoManifest | undefined;
    try { prior = await readDemo(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (prior) {
      assert.equal(prior.state, 'ready', 'An interrupted preparation is retained. Inspect the saved manifest before creating another example.');
      await writeDemoHandoff(prior);
      console.log(`Existing demo preserved: ${resolve('.local/demo/START-HERE.md')}`);
      return;
    }
    const [{ approvePayrollEarning }, { createFileContentService }, { createIdentifierCipher }, { createPayoutDestinationTransport }, { privatePayoutDestinationPort }] = await Promise.all([
      import('../tests/helpers/payroll'), import('../src/server/files'), import('../src/server/private-identifiers'),
      import('../src/server/payout-destination-transport'), import('../src/server/payout-destination-server'),
    ]);
    // This existing guarded helper seeds historical admission only. It never fabricates delivery or payroll.
    const f = await completionFixture();
    const worker = new Pool({ connectionString: local.worker_database_url });
    const content = createFileContentService(worker, server);
    const runId = new Date().toISOString().slice(0, 10) + '-' + randomUUID().slice(0, 6);
    const manifest: DemoManifest = {
      marker: 'git-tutor-guided-demo-v1', runId, createdAt: new Date().toISOString(), state: 'preparing',
      actors: { learner: local.actors.learner_a, guardian: local.actors.guardian_a, tutor: f.actor, service: local.actors.cs_a, admin: local.actors.admin_a },
      tutorId: f.tutorId, learnerId: f.learnerId, receivingId: f.receivingAccount.id, receivingVersionId: f.receivingAccount.versionId,
      historical: { occurrenceId: f.occurrenceId, enrollmentId: f.enrollmentId, actualStart: f.actualStart, actualEnd: f.actualEnd },
    };
    await saveDemo(manifest);
    async function upload(client: typeof f.admin, purpose: string, parent: string | null, action: string | null, filename: string, lines: string[]) {
      const bytes = demoPdf(['GIT TUTOR - SYNTHETIC LOCAL DEMO', ...lines, 'No actual customer, payment or provider delivery is represented.']);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      const made = await invokeFileCommandWithStatus(client, 'create_file_upload', { p_purpose: purpose, p_parent_id: parent, p_evidence_action: action, p_filename: filename, p_declared_type: 'application/pdf', p_size_bytes: bytes.length, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
      await content.upload(client, made.data.file_id, bytes);
      const done = await invokeFileCommandWithStatus(client, 'finalize_file_upload', { p_file_id: made.data.file_id, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
      assert.equal(await runFileScan(done.data.scan_job_id), 'completed');
      assert.equal((await getFile(client, made.data.file_id)).can_download, true);
      return made.data.file_id;
    }
    try {
      const profile = (await f.database.query('select contact_id,version from app_private.tutors where id=$1', [f.tutorId])).rows[0];
      await f.rpc('update_tutor_profile', { p_display_name: `Git Tutor guided demo ${runId}`, p_bio: 'Synthetic tutor for the guided local walkthrough.', p_subject_ids: [fixtureId('subject_calculus')], p_contact_id: profile.contact_id, p_locale: 'en', p_expected_version: profile.version, p_idempotency_key: randomUUID() }, f.tutor);
      const draft = (await f.database.query('select version,draft_profile_version_id from app_private.tutors where id=$1', [f.tutorId])).rows[0];
      await f.rpc('approve_tutor_profile', { p_tutor_id: f.tutorId, p_profile_version_id: draft.draft_profile_version_id, p_decision: 'approved', p_reason: 'Guided synthetic demo', p_expected_version: draft.version, p_idempotency_key: randomUUID() });
      manifest.historical.earningId = await approvePayrollEarning(f);
      await saveDemo(manifest);
      const cipher = createIdentifierCipher({ currentKeyId: server.secret_encryption_key_id, currentKey: server.secret_encryption_key!, previousKeys: server.secret_encryption_previous_keys });
      const port = privatePayoutDestinationPort(worker);
      const actor = async (client: typeof f.admin) => { const result = await client.auth.getClaims(); assert.equal(result.error, null); return { account_id: result.data!.claims.sub, session_id: String(result.data!.claims.session_id) }; };
      await invokePayrollCommandWithStatus(f.admin, 'set_tutor_payout_methods', { p_tutor_id: f.tutorId, p_channels: ['instapay'], p_expected_version: 1, p_idempotency_key: randomUUID() });
      const proposed = await createPayoutDestinationTransport({ client: f.tutor, cipher, port }).submit(await actor(f.tutor), { p_channel: 'instapay', p_identifier: `demo-${runId}@instapay`, p_payee_name: 'Synthetic guided demo tutor', p_idempotency_key: randomUUID() });
      const destination = proposed.data as { destination_id: string; version: number };
      const proof = await upload(f.admin, 'review_evidence', destination.destination_id, 'verify_payout_destination', 'demo-payout-ownership.pdf', ['Independent synthetic tutor destination ownership.']);
      const approved = await createPayoutDestinationTransport({ client: f.admin, cipher, port }).verify(await actor(f.admin), { p_destination_id: destination.destination_id, p_evidence_file_id: proof, p_decision: 'verified', p_reason: 'Synthetic independent ownership proof', p_expected_version: destination.version, p_idempotency_key: randomUUID() });
      const paid = await invokePayrollCommandWithStatus(f.admin, 'authorize_payout', { p_tutor_id: f.tutorId, p_destination_version_id: (approved.data as { destination_version_id: string }).destination_version_id, p_allocations: [{ earning_id: manifest.historical.earningId, amount_minor: 15000 }], p_idempotency_key: randomUUID() });
      const payout = paid.data as { payout_attempt_id: string; version: number };
      await invokePayrollCommandWithStatus(f.admin, 'reconcile_payout', { p_payout_attempt_id: payout.payout_attempt_id, p_outcome: 'settled', p_receiving_account_id: f.receivingAccount.id, p_external_reference: `demo-payout-${runId}`, p_evidence_file_id: await upload(f.admin, 'review_evidence', payout.payout_attempt_id, 'reconcile_payout', 'demo-payout-settlement.pdf', ['Independently observed synthetic payout: EGP 150.00.']), p_settled_at: new Date().toISOString(), p_expected_version: payout.version, p_idempotency_key: randomUUID() });
      manifest.historical.payoutId = payout.payout_attempt_id;
      await saveDemo(manifest);
      await f.rpc('connect_fake_calendar', { p_idempotency_key: randomUUID() });
      const identifier = (await f.database.query('select collection_identifier from finance_private.receiving_account_versions where id=$1', [manifest.receivingVersionId])).rows[0].collection_identifier as string;
      for (const [index, kind] of (['personal', 'verified'] as const).entries()) {
        const times = f.interval(4 + index), occurrence = await f.occurrence('private', times), id = occurrence.occurrence_id as string;
        await f.rpc('approve_tutor_fee', { p_occurrence_id: id, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: `Guided demo ${kind} approved agreement`, p_expected_version: occurrence.version, p_idempotency_key: randomUUID() });
        const externalId = `demo-${kind}-${runId}`, observedAt = new Date(Date.now() - 120000).toISOString();
        const statement = await upload(f.reviewer, 'statement_evidence', manifest.receivingId, 'record_manual_transfer', `demo-${kind}-statement.pdf`, ['Independent synthetic receiving account statement.', `Reference: ${externalId}`, `Amount: EGP 500.00. Destination: ${identifier}`, `Observed UTC: ${observedAt}`]);
        const transfer = await f.rpc('record_manual_transfer', { p_receiving_account_id: manifest.receivingId, p_channel: 'instapay', p_external_id: externalId, p_amount_minor: 50000, p_currency: 'EGP', p_observed_at: observedAt, p_statement_evidence_file_id: statement, p_idempotency_key: randomUUID() }, f.reviewer);
        const transferId = transfer.transfer_id as string;
        const settlementFileId = await upload(f.reviewer, 'statement_evidence', transferId, 'verify_transfer_settlement', `demo-${kind}-settlement.pdf`, ['Independent synthetic settled-entry confirmation.', `Reference: ${externalId}. Amount: EGP 500.00.`, `Settlement UTC: ${observedAt}`]);
        const ownershipFileId = await upload(f.reviewer, 'review_evidence', transferId, 'bind_transfer_payer', `demo-${kind}-payer.pdf`, ['Independent synthetic source ownership confirmation.', `Payer: ${manifest.actors.learner.email}`, `Reference: ${externalId}`]);
        manifest[kind] = { occurrenceId: id, offerId: catalogFixtureIds.private_offer, start: times.start_at, end: times.end_at, bookingUrl: `http://127.0.0.1:3000/learn/bookings?offer=${catalogFixtureIds.private_offer}&occurrence=${id}`, transferId, externalId, observedAt, settlementFileId, ownershipFileId };
        await writeFile(resolve(`.local/demo/${kind === 'personal' ? 'demo-receipt' : 'verification-receipt'}.pdf`), demoPdf(['GIT TUTOR - SYNTHETIC CUSTOMER RECEIPT', `Reference: ${externalId}`, 'Amount: EGP 500.00', `Collection: ${identifier}`, `Payer: ${manifest.actors.learner.email}`, 'Customer evidence only; staff must independently verify settlement.']));
        await saveDemo(manifest);
      }
      await writeFile(resolve('.local/demo/demo-material.pdf'), demoPdf(['GIT TUTOR - DEMO CALCULUS PREPARATION', 'Topic: derivatives and rates of change.', '1. Find the derivative of x squared.', '2. Explain how a derivative describes a slope.', 'Synthetic local exercise only.']));
      manifest.state = 'ready'; await saveDemo(manifest); await writeDemoHandoff(manifest);
      console.log(`Demo prepared. Personal slot untouched. Private handoff: ${resolve('.local/demo/START-HERE.md')}`);
      console.log('Historical delivery: EGP 250 earning, EGP 150 settled payout, EGP 100 remaining payable.');
    } finally { await worker.end(); await f.close(); }
  } finally {
    if (acquired) await lock.query("select pg_advisory_unlock(hashtextextended('git-tutor:guided-demo:v1',0))");
    await lock.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'DEMO_PREPARATION_FAILED'); process.exitCode = 1; });
}
