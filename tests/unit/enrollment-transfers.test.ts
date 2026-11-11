import { expect, test } from 'vitest';
import { enrollmentTransferCommands, enrollmentTransferConsentSchema, getEnrollmentTransferProposal, listMyEnrollmentTransferConsents, invokeEnrollmentTransferCommand } from '../../src/modules/booking/enrollment-transfers';
import { customerReturnPath } from '../../src/modules/identity/return-path';

const id = '50a7291f-829f-439a-9719-f8b3225ed77f';
const instant = '2026-11-11T10:00:00Z';
const consent = { consent_id: id, version: 1, proposal_id: id, state: 'awaiting_acceptance', source_booking_reference: 'Source session', destination_booking_reference: 'Replacement session', destination_charge_id: id, destination_quote_id: id, sources: [{ transfer_id: id, channel: 'instapay', amount_minor: 50000 }], carryover_minor: 50000, currency: 'EGP', terms_hash: 'a'.repeat(64), expires_at: instant, accepted_at: null, can_accept: true };

test('payer carryover login continuation accepts only the exact UUID detail path', () => {
  const path = `/learn/payments/enrollment-transfer-consents/${id}`;
  expect(customerReturnPath(path)).toBe(path);
  for (const invalid of [`${path}?redirect=https://example.test`, `${path}/approve`, path.replace(id, 'all'), `https://example.test${path}`]) expect(customerReturnPath(invalid)).toBeUndefined();
});

test('original-payer carryover excludes learner and confidential teaching information', () => {
  expect(enrollmentTransferConsentSchema.safeParse(consent).success).toBe(true);
  for (const field of ['learner', 'payer_account_id', 'fee_minor', 'compensation_policy_version', 'statement_evidence_id', 'internal_notes']) expect(enrollmentTransferConsentSchema.safeParse({ ...consent, [field]: 'private' }).success).toBe(false);
  expect(enrollmentTransferConsentSchema.safeParse({ ...consent, carryover_minor: 49999 }).success).toBe(false);
  expect(enrollmentTransferConsentSchema.safeParse({ ...consent, sources: [...consent.sources, ...consent.sources] }).success).toBe(false);
});

test('review rejects duplicate source allocations, forged authority and unsafe amounts', () => {
  const input = { p_proposal_id: id, p_source_tutor_fee_minor: 10000, p_carryover_allocations: [{ allocation_id: id, amount_minor: 50000 }], p_source_package_disposition: null, p_reason: 'Reviewed exact terms', p_expected_version: 1, p_idempotency_key: 'logical-review' };
  const schema = enrollmentTransferCommands.review_enrollment_transfer_proposal.input;
  expect(schema.safeParse(input).success).toBe(true);
  expect(schema.safeParse({ ...input, p_actor_id: id }).success).toBe(false);
  expect(schema.safeParse({ ...input, p_carryover_allocations: [...input.p_carryover_allocations, ...input.p_carryover_allocations] }).success).toBe(false);
  expect(schema.safeParse({ ...input, p_source_tutor_fee_minor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
});

test('scoped reads bind requested view and reject widening payloads', async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return { data: { items: [consent], next_cursor: null }, error: null }; } };
  expect((await listMyEnrollmentTransferConsents(client)).items).toHaveLength(1);
  expect(calls).toEqual([['list_my_enrollment_transfer_consents', { p_cursor: null, p_limit: 25 }]]);
  await expect(getEnrollmentTransferProposal({ rpc: async () => ({ data: { view: 'admin', fee_minor: 10000 }, error: null }) }, id, { view: 'customer', learner_id: id })).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});

test('carryover consent is exact hash/version and review preserves created/replayed status', async () => {
  const args = { p_consent_id: id, p_terms_hash: 'a'.repeat(64), p_expected_version: 1, p_idempotency_key: 'same-operation' };
  expect(enrollmentTransferCommands.accept_enrollment_transfer_consent.input.safeParse({ ...args, p_amount_minor: 1 }).success).toBe(false);
  const review = { p_proposal_id: id, p_source_tutor_fee_minor: 0, p_carryover_allocations: [], p_reason: 'No carryover', p_expected_version: 1, p_idempotency_key: 'review' };
  const data = { command_id: id, resource_id: id, version: 1, proposal_id: id, new_enrollment_id: id, destination_quote_id: id, replaces_proposal_id: id };
  for (const status of [201, 200]) expect((await invokeEnrollmentTransferCommand({ rpc: async () => ({ data, status, error: null }) }, 'review_enrollment_transfer_proposal', review)).status).toBe(status);
});
