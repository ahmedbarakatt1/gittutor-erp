import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createIdentifierCipher } from '../../src/server/private-identifiers';
import { privateDestinationPort } from '../../src/server/refund-destination-server';
import { createRefundDestinationTransport } from '../../src/server/refund-destination-transport';
import { paymentFixture } from '../helpers/payments';
import { anonymousClient, loadLocalSupabase } from '../helpers/supabase';
import { getRefund, listRefundDestinations } from '../../src/modules/payments/queries';

async function actor(client: ReturnType<typeof anonymousClient>) {
  const result = await client.auth.getClaims();
  if (result.error || !result.data?.claims.sub || typeof result.data.claims.session_id !== 'string') throw new Error('REAL_VERIFIED_SESSION_REQUIRED');
  return { account_id: result.data.claims.sub, session_id: result.data.claims.session_id };
}
async function setup() {
  const f = await paymentFixture(), worker = new Pool({ connectionString: loadLocalSupabase().worker_database_url });
  const account = await f.receiving(), transfer = await f.transfer(account.id);
  const refund = await f.rpc('request_refund', { p_source_type: 'unapplied_credit', p_source_id: transfer.id, p_payer_account_id: null, p_amount_minor: 5000, p_reason: 'Synthetic owned surplus', p_idempotency_key: randomUUID() }, f.learner);
  const cipher = createIdentifierCipher({ currentKeyId: 'private-test-v1', currentKey: randomBytes(32).toString('hex') }), port = privateDestinationPort(worker);
  const evidence = await f.evidence({ purpose: 'refund_destination', parentType: 'refund', parentId: String(refund.refund_id), uploaderId: f.learnerAccountId });
  const input = { p_refund_id: refund.refund_id, p_channel: 'instapay', p_identifier: `synthetic-${randomUUID()}@instapay`, p_payee_name: 'Synthetic refund owner', p_source_evidence_file_id: evidence, p_expected_version: 1, p_idempotency_key: randomUUID() };
  return { f, worker, port, cipher, input, close: async () => { await worker.end(); await f.close(); } };
}

test('independent encrypted creation requests adopt one logically identical winner and reject another plaintext', async () => {
  const s = await setup();
  try {
    const user = await actor(s.f.learner), first = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.learner });
    const second = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.learner });
    const results = await Promise.all([first.propose(user, s.input), second.propose(user, s.input)]);
    expect(results[0].data).toEqual(results[1].data);
    expect((await s.f.database.query('select count(*)::int as count from finance_private.refund_destinations where refund_id=$1', [s.input.p_refund_id])).rows[0].count).toBe(1);
    await expect(second.propose(user, { ...s.input, p_identifier: 'different-synthetic@instapay' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(s.port.prepare(await actor(s.f.students[1]), String(s.input.p_refund_id), s.input.p_idempotency_key)).rejects.toThrow(/NOT_FOUND|FORBIDDEN/);
    expect(JSON.stringify(results)).not.toContain(s.input.p_identifier);
  } finally { await s.close(); }
});

test('completed approval replays after real artifact expiry in a new verified session, but revoked and demoted actors are denied', async () => {
  const s = await setup(), fresh = anonymousClient();
  try {
    // This fresh fixture account is independent of canonical shared admin roles.
    const grant = await s.f.rpc('grant_staff_role', { p_account_id: s.f.actor.id, p_role: 'admin', p_reason: 'Synthetic isolated destination approver', p_idempotency_key: randomUUID() });
    const originalAdmin = await actor(s.f.tutor);
    const payer = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.learner });
    const proposed = await payer.propose(await actor(s.f.learner), s.input);
    const ownership = await s.f.evidence({ purpose: 'refund_destination_verification', parentType: 'refund_destination', parentId: proposed.data.destination_id, uploaderId: s.f.actor.id });
    const approval = { p_destination_id: proposed.data.destination_id, p_evidence_file_id: ownership, p_decision: 'verified', p_reason: 'Synthetic independently reviewed source ownership', p_expected_version: 1, p_idempotency_key: randomUUID() };
    const admin = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.tutor });
    const committed = await admin.verify(originalAdmin, approval);
    const artifact = (await s.f.database.query('select expires_at from finance_private.destination_validation_artifacts where destination_id=$1 and consumed_at is not null', [proposed.data.destination_id])).rows[0];
    await s.f.tutor.auth.signOut({ scope: 'local' });
    await expect(s.port.read(originalAdmin, proposed.data.destination_id, 'verify_candidate', null, null)).rejects.toThrow(/SESSION_REVOKED|AUTH_REQUIRED/);
    const signedIn = await fresh.auth.signInWithPassword({ email: s.f.actor.email, password: s.f.actor.password });
    if (signedIn.error) throw new Error('SYNTHETIC_NEW_SESSION_FAILED');
    const newActor = await actor(fresh); expect(newActor.session_id).not.toBe(originalAdmin.session_id);
    const newAdmin = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: fresh });
    // Exercise real database time; do not rewrite immutable artifact expiry or weaken its five-minute policy.
    const remaining = Math.max(0, new Date(artifact.expires_at).getTime() - Date.now() + 500);
    if (remaining > 301_000) throw new Error('ARTIFACT_EXPIRY_OUT_OF_BOUNDS');
    await wait(remaining);
    expect((await s.f.database.query('select expires_at<now() as expired from finance_private.destination_validation_artifacts where destination_id=$1 and consumed_at is not null', [proposed.data.destination_id])).rows[0].expired).toBe(true);
    expect((await newAdmin.verify(newActor, approval)).data).toEqual(committed.data);
    await expect(newAdmin.verify(newActor, { ...approval, p_reason: 'Changed decision record' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect((await s.f.database.query('select count(*)::int as count from finance_private.refund_destination_versions where destination_id=$1', [proposed.data.destination_id])).rows[0].count).toBe(1);
    await s.f.rpc('revoke_staff_role', { p_role_grant_id: grant.role_grant_id, p_reason: 'Synthetic approver duty ended', p_expected_version: 1, p_idempotency_key: randomUUID() });
    await expect(newAdmin.verify(newActor, approval)).rejects.toThrow('FORBIDDEN');
    await expect(s.port.read(newActor, proposed.data.destination_id, 'verify_candidate', null, null)).rejects.toThrow('FORBIDDEN');
  } finally { await fresh.auth.signOut({ scope: 'local' }); await s.close(); }
}, 360_000);

test('private reveal requires the exact pinned pending or unknown attempt, current admin authority and an audited reason', async () => {
  const s = await setup();
  try {
    const payer = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.learner });
    const admin = createRefundDestinationTransport({ cipher: s.cipher, port: s.port, client: s.f.admin });
    const payerActor = await actor(s.f.learner), adminActor = await actor(s.f.admin);
    const first = await payer.propose(payerActor, s.input);
    const verify = async (destinationId: string) => {
      const evidence = await s.f.evidence({ purpose: 'refund_destination_verification', parentType: 'refund_destination', parentId: destinationId });
      return admin.verify(adminActor, { p_destination_id: destinationId, p_evidence_file_id: evidence, p_decision: 'verified', p_reason: 'Synthetic independently reviewed destination', p_expected_version: 1, p_idempotency_key: randomUUID() });
    };
    const verified = await verify(first.data.destination_id);
    const second = await payer.propose(payerActor, { ...s.input, p_identifier: `second-synthetic-${randomUUID()}@instapay`, p_expected_version: 2, p_idempotency_key: randomUUID() });
    await verify(second.data.destination_id);
    await expect(admin.reveal(adminActor, { destination_id: first.data.destination_id, refund_attempt_id: randomUUID(), reason: 'No authorized transfer attempt exists' })).rejects.toThrow('FORBIDDEN');
    const approved = await s.f.rpc('approve_refund', { p_refund_id: s.input.p_refund_id, p_remedy_id: null, p_destination_version_id: verified.data.destination_version_id, p_amount_minor: 5000, p_reason: 'Synthetic original payer surplus', p_expected_version: 3, p_idempotency_key: randomUUID() });
    const attempt = await s.f.rpc('record_refund_attempt', { p_refund_id: s.input.p_refund_id, p_external_reference: `synthetic-private-${randomUUID()}`, p_expected_version: approved.version, p_idempotency_key: randomUUID() });
    const reveal = { destination_id: first.data.destination_id, refund_attempt_id: String(attempt.attempt_id), reason: 'Prepare the already recorded synthetic refund attempt' };
    await expect(payer.reveal(payerActor, reveal)).rejects.toThrow('FORBIDDEN');
    await expect(admin.reveal(await actor(s.f.reviewer), reveal)).rejects.toThrow('FORBIDDEN');
    await expect(admin.reveal(adminActor, { ...reveal, reason: '' })).rejects.toThrow('VALIDATION_ERROR');
    await expect(admin.reveal(adminActor, { ...reveal, destination_id: second.data.destination_id })).rejects.toThrow('FORBIDDEN');
    expect(await admin.reveal(adminActor, reveal)).toEqual({ identifier: s.input.p_identifier });
    const evidence = await s.f.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: String(attempt.attempt_id) });
    const unknown = await s.f.rpc('reconcile_refund', { p_refund_id: s.input.p_refund_id, p_attempt_id: attempt.attempt_id, p_outcome: 'unknown', p_evidence_file_id: evidence, p_external_reference: `synthetic-unknown-${randomUUID()}`, p_settled_at: null, p_expected_version: attempt.version, p_idempotency_key: randomUUID() });
    expect(await admin.reveal(adminActor, { ...reveal, reason: 'Reconcile the existing uncertain attempt; no new send' })).toEqual({ identifier: s.input.p_identifier });
    await expect(s.f.rpc('record_refund_attempt', { p_refund_id: s.input.p_refund_id, p_external_reference: `synthetic-invalid-retry-${randomUUID()}`, p_expected_version: unknown.version, p_idempotency_key: randomUUID() })).rejects.toThrow('STATE_CONFLICT');
    const audits = (await s.f.database.query("select actor_account_id,details from app_private.audit_events where action='refund_identifier_accessed' and aggregate_id=$1 and details->>'purpose'='reveal_for_attempt' order by recorded_at,id", [first.data.destination_id])).rows;
    expect(audits).toHaveLength(2);
    expect(audits.every(row => row.actor_account_id === adminActor.account_id && row.details.attempt_id === attempt.attempt_id && typeof row.details.reason === 'string')).toBe(true);
    const customer = [await getRefund(s.f.learner, String(s.input.p_refund_id)), await listRefundDestinations(s.f.learner, String(s.input.p_refund_id))];
    expect(JSON.stringify(customer)).not.toContain(s.input.p_identifier);
    expect(JSON.stringify(customer)).not.toMatch(/encrypted_identifier|identifier_fingerprint|ciphertext|nonce/);
    expect(JSON.stringify(audits)).not.toContain(s.input.p_identifier);
    await s.f.rpc('reconcile_refund', { p_refund_id: s.input.p_refund_id, p_attempt_id: attempt.attempt_id, p_outcome: 'settled', p_evidence_file_id: evidence, p_external_reference: `synthetic-settled-${randomUUID()}`, p_settled_at: new Date(Date.now() - 1000).toISOString(), p_expected_version: unknown.version, p_idempotency_key: randomUUID() });
    await expect(admin.reveal(adminActor, reveal)).rejects.toThrow('FORBIDDEN');
  } finally { await s.close(); }
});
