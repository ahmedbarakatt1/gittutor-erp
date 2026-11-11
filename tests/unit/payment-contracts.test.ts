import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { invokePaymentCommandWithStatus, paymentCommands } from '../../src/modules/payments/commands';

const id = () => randomUUID();
const receipt = () => ({ p_enrollment_id: null, p_charge_id: id(), p_file_id: id(), p_receiving_account_version_id: id(), p_channel: 'instapay', p_transferred_amount_minor: 55000, p_currency: 'EGP', p_reference: 'SYNTHETIC-CLAIM', p_transferred_at: null, p_idempotency_key: id() });

test('customer payment reports cannot assert settlement, actor, evidence safety or payer verification', () => {
  expect(paymentCommands.submit_receipt.input.safeParse(receipt()).success).toBe(true);
  for (const extra of [{ p_actor_id: id() }, { p_state: 'settled' }, { p_scan_state: 'clean' }, { p_payer_account_id: id() }]) {
    expect(paymentCommands.submit_receipt.input.safeParse({ ...receipt(), ...extra }).success).toBe(false);
  }
  expect(paymentCommands.submit_receipt.input.safeParse({ ...receipt(), p_transferred_amount_minor: 0.5 }).success).toBe(false);
  expect(paymentCommands.submit_receipt.input.safeParse({ ...receipt(), p_transferred_amount_minor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(paymentCommands.submit_receipt.input.safeParse({ ...receipt(), p_receiving_account_version_id: undefined }).success).toBe(false);
});

test('allocation plans require explicit distinct positive targets and do not accept customer consent assertions', () => {
  const charge = id(), base = { p_receipt_id: id(), p_targets: [{ charge_id: charge, amount_minor: 50000 }], p_expected_version: 1, p_idempotency_key: id() };
  expect(paymentCommands.authorize_payment_plan.input.safeParse(base).success).toBe(true);
  expect(paymentCommands.authorize_payment_plan.input.safeParse({ ...base, p_targets: [...base.p_targets, ...base.p_targets] }).success).toBe(false);
  expect(paymentCommands.authorize_payment_plan.input.safeParse({ ...base, p_targets: [{ charge_id: charge, amount_minor: 0 }] }).success).toBe(false);
  expect(paymentCommands.authorize_payment_plan.input.safeParse({ ...base, p_payer_accepted: true }).success).toBe(false);
  expect(paymentCommands.authorize_payment_plan.input.safeParse({ ...base, p_targets: [{ ...base.p_targets[0], conditional_amendment_id: id() }] }).success).toBe(true);
});

test('refund outcomes require actual attempt and evidence and keep unknown separate from settled time', () => {
  const base = { p_refund_id: id(), p_attempt_id: id(), p_outcome: 'unknown', p_evidence_file_id: id(), p_external_reference: 'MANUAL-SYNTHETIC', p_settled_at: null, p_expected_version: 1, p_idempotency_key: id() };
  expect(paymentCommands.reconcile_refund.input.safeParse(base).success).toBe(true);
  expect(paymentCommands.reconcile_refund.input.safeParse({ ...base, p_outcome: 'settled' }).success).toBe(false);
  expect(paymentCommands.reconcile_refund.input.safeParse({ ...base, p_settled_at: '2026-11-11T12:00:00Z' }).success).toBe(false);
  expect(paymentCommands.reconcile_refund.input.safeParse({ ...base, p_outcome: 'settled', p_settled_at: '2026-11-11T12:00:00Z' }).success).toBe(true);
  expect(paymentCommands.reconcile_refund.input.safeParse({ ...base, p_evidence_file_id: null }).success).toBe(false);
});

test('typed payment boundary rejects confidential or malformed results instead of passing arbitrary JSON', async () => {
  const result = { command_id: id(), resource_id: id(), version: 1, receipt_id: id(), case_id: id(), evidence_state: 'ready_for_review' };
  const client = (data: unknown, status = 201) => ({ rpc: async () => ({ data, status, error: null }) });
  expect((await invokePaymentCommandWithStatus(client(result), 'submit_receipt', receipt())).status).toBe(201);
  await expect(invokePaymentCommandWithStatus(client({ ...result, fee_minor: 45000 }), 'submit_receipt', receipt())).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(invokePaymentCommandWithStatus(client(result, 204), 'submit_receipt', receipt())).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(invokePaymentCommandWithStatus({ rpc: async () => ({ data: null, error: { message: 'SQL private source detail' } }) }, 'submit_receipt', receipt())).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
