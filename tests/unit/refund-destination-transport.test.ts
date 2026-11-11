import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createIdentifierCipher } from '../../src/server/private-identifiers';
import { createRefundDestinationTransport, type PrivateDestinationPort } from '../../src/server/refund-destination-transport';
import { PaymentRpcError } from '../../src/modules/payments/commands';

function fixture() {
  const actor = { account_id: randomUUID(), session_id: randomUUID() }, owner = randomUUID();
  const cipher = createIdentifierCipher({ currentKeyId: 'test-v1', currentKey: 'a'.repeat(64) });
  const input = { p_refund_id: randomUUID(), p_channel: 'instapay', p_identifier: 'synthetic-owner@instapay', p_payee_name: 'Synthetic Owner', p_source_evidence_file_id: randomUUID(), p_expected_version: 1, p_idempotency_key: randomUUID() };
  let prior: Record<string, unknown> | null = null;
  const prepare = vi.fn(async () => ({ payer_account_id: owner, prior_request: prior }));
  const read = vi.fn<PrivateDestinationPort['read']>();
  const issue = vi.fn<PrivateDestinationPort['issue']>();
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>): Promise<{ data: unknown; status: number; error: null }> => {
    if (name !== 'propose_refund_destination' || !args) throw new Error('unexpected command');
    prior = args;
    return { data: { command_id: randomUUID(), resource_id: args.p_destination_id, version: 1, destination_id: args.p_destination_id, masked_identifier: args.p_masked_identifier, verification_status: 'unverified' }, status: 201, error: null };
  });
  const port: PrivateDestinationPort = { prepare, read, issue };
  const transport = createRefundDestinationTransport({ cipher, port, client: { rpc } });
  const row = () => {
    if (!prior) throw new Error('create first');
    return { destination_id: prior.p_destination_id, refund_id: input.p_refund_id, payer_account_id: owner, channel: input.p_channel, identifier_version: 1, version: 2, encrypted_identifier: prior.p_encrypted_identifier, ciphertext_digest: 'b'.repeat(64), masked_identifier: prior.p_masked_identifier, identifier_fingerprint: prior.p_identifier_fingerprint, verification_status: 'unverified', destination_version_id: null };
  };
  return { actor, owner, cipher, input, prepare, read, issue, rpc, port, transport, row, prior: () => prior, setPrior: (value: Record<string, unknown>) => { prior = value; } };
}

test('destination creation derives owner privately and sends only authenticated ciphertext to the user RPC', async () => {
  const f = fixture();
  const result = await f.transport.propose(f.actor, f.input);
  expect(f.prepare).toHaveBeenCalledWith(f.actor, f.input.p_refund_id, f.input.p_idempotency_key);
  expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(f.input.p_identifier);
  expect(JSON.stringify(result)).not.toMatch(/encrypted_identifier|fingerprint|instapay/);
  expect(f.cipher.open(f.prior()!.p_encrypted_identifier, { purpose: 'refund_destination', parent_id: f.input.p_refund_id, destination_id: String(f.prior()!.p_destination_id), channel: 'instapay', owner_account_id: f.owner, identifier_version: 1 }).identifier).toBe(f.input.p_identifier);
});

test('lost acknowledgement reuses the exact original randomized envelope for normalized identical input', async () => {
  const f = fixture(); await f.transport.propose(f.actor, f.input);
  const original = structuredClone(f.prior());
  await f.transport.propose(f.actor, { ...f.input, p_identifier: ` ${f.input.p_identifier} ` });
  expect(f.rpc.mock.calls[1][1]).toEqual(original);
  for (const change of [{ p_identifier: 'different-owner@instapay' }, { p_payee_name: 'Different Owner' }, { p_expected_version: 2 }, { p_source_evidence_file_id: randomUUID() }, { p_channel: 'vodafone_cash' }]) {
    await expect(f.transport.propose(f.actor, { ...f.input, ...change })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  }
  expect(f.rpc).toHaveBeenCalledTimes(2);
});

test('concurrent first-write conflict rereads once and adopts only an identical committed winner', async () => {
  const f = fixture(); await f.transport.propose(f.actor, f.input); const winner = structuredClone(f.prior());
  f.prepare.mockResolvedValueOnce({ payer_account_id: f.owner, prior_request: null });
  f.rpc.mockRejectedValueOnce(new PaymentRpcError('IDEMPOTENCY_CONFLICT'));
  await f.transport.propose(f.actor, f.input);
  expect(f.rpc.mock.calls[2][1]).toEqual(winner);
  expect(f.prepare).toHaveBeenCalledTimes(3);
  f.prepare.mockResolvedValueOnce({ payer_account_id: f.owner, prior_request: null });
  f.rpc.mockRejectedValueOnce(new PaymentRpcError('IDEMPOTENCY_CONFLICT'));
  await expect(f.transport.propose(f.actor, { ...f.input, p_identifier: 'other@instapay' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect(f.rpc).toHaveBeenCalledTimes(4);
});

test('validation and current private authority failures happen before any public mutation', async () => {
  const f = fixture();
  for (const args of [{ ...f.input, p_payer_account_id: f.owner }, { ...f.input, p_identifier: 'x\u202Ey' }, { ...f.input, p_expected_version: 0 }]) {
    await expect(f.transport.propose(f.actor, args)).rejects.toThrow('VALIDATION_ERROR');
  }
  expect(f.prepare).not.toHaveBeenCalled();
  f.prepare.mockRejectedValueOnce(new PaymentRpcError('SESSION_REVOKED'));
  await expect(f.transport.propose(f.actor, f.input)).rejects.toThrow('SESSION_REVOKED');
  expect(f.rpc).not.toHaveBeenCalled();
});

test('verification decrypts immutable identity and requests a server artifact with the original approval version', async () => {
  const f = fixture(); await f.transport.propose(f.actor, f.input);
  const row = { ...f.row(), version: 8, verification_status: 'verified', destination_version_id: randomUUID() };
  f.read.mockResolvedValue(row);
  const artifact = randomUUID();
  f.issue.mockResolvedValue({ validation_artifact_id: artifact, approval_request_hash: 'c'.repeat(64), expires_at: '2026-01-01T00:00:00Z' });
  f.rpc.mockImplementationOnce(async () => ({ data: { command_id: randomUUID(), resource_id: row.destination_id, version: 2, destination_version_id: row.destination_version_id, verification_status: 'verified' }, status: 200, error: null }));
  const approval = { p_destination_id: row.destination_id, p_evidence_file_id: randomUUID(), p_decision: 'verified', p_reason: 'Independent evidence checked', p_expected_version: 1, p_idempotency_key: randomUUID() };
  const result = await f.transport.verify(f.actor, approval);
  expect(f.issue).toHaveBeenCalledWith(f.actor, expect.objectContaining({ destination_version: 1, ciphertext_digest: row.ciphertext_digest, approval_request: { destination_id: approval.p_destination_id, expected_version: approval.p_expected_version, evidence_file_id: approval.p_evidence_file_id, decision: approval.p_decision, reason: approval.p_reason, idempotency_key: approval.p_idempotency_key } }));
  expect(f.rpc.mock.calls[1]).toEqual(['verify_refund_destination', { ...approval, p_validation_artifact_id: artifact }]);
  expect(result.status).toBe(200);
});

test('tampered ciphertext or stored masked metadata cannot obtain an artifact', async () => {
  const f = fixture(); await f.transport.propose(f.actor, f.input);
  const approval = { p_destination_id: f.row().destination_id, p_evidence_file_id: randomUUID(), p_decision: 'verified', p_reason: 'Independent evidence checked', p_expected_version: 2, p_idempotency_key: randomUUID() };
  for (const row of [{ ...f.row(), masked_identifier: 'full-private-value' }, { ...f.row(), payer_account_id: randomUUID() }, { ...f.row(), destination_id: randomUUID() }]) {
    f.read.mockResolvedValueOnce(row);
    await expect(f.transport.verify(f.actor, approval)).rejects.toThrow('PRIVATE_IDENTIFIER_UNAVAILABLE');
  }
  expect(f.issue).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledTimes(1);
});

test('private reveal requires an attempt, reason and exact audited context before returning one plaintext identifier', async () => {
  const f = fixture(); await f.transport.propose(f.actor, f.input);
  const destination = String(f.row().destination_id), attempt = randomUUID(); f.read.mockResolvedValue(f.row());
  await expect(f.transport.reveal(f.actor, { destination_id: destination, refund_attempt_id: attempt, reason: '' })).rejects.toThrow('VALIDATION_ERROR');
  expect(f.read).not.toHaveBeenCalled();
  const result = await f.transport.reveal(f.actor, { destination_id: destination, refund_attempt_id: attempt, reason: 'Process this approved refund' });
  expect(f.read).toHaveBeenCalledWith(f.actor, destination, 'reveal_for_attempt', attempt, 'Process this approved refund');
  expect(result).toEqual({ identifier: f.input.p_identifier });
  f.read.mockRejectedValueOnce(new PaymentRpcError('FORBIDDEN'));
  await expect(f.transport.reveal(f.actor, { destination_id: destination, refund_attempt_id: attempt, reason: 'Process this approved refund' })).rejects.toThrow('FORBIDDEN');
});
