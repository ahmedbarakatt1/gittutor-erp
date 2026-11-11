import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';

let f: Awaited<ReturnType<typeof paymentFixture>>;
beforeAll(async () => { f = await paymentFixture({ charge: 'enrollment' }); }, 30000);
afterAll(async () => { await f?.close(); });

test('GT-507 settled55000 funds50000 once and retains5000 for its actual payer', async () => {
  const account = await f.receiving(), transfer = await f.transfer(account.id);
  const receipt = await f.receipt(account.versionId);
  const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
  const first = await invokePaymentCommandWithStatus(f.reviewer, 'allocate_transfer', args);
  expect(first.data.allocation_ids).toHaveLength(1);
  expect(first.data.unapplied_minor).toBe(5000);
  expect(first.data.confirmation_status).toHaveLength(1);
  // Money can post while the actual required tutor agreement is still missing.
  expect(first.data.confirmation_status[0]).toMatchObject({ state: 'awaiting_requirements', reason: 'FEE_NOT_APPROVED' });
  expect((await invokePaymentCommandWithStatus(f.reviewer, 'allocate_transfer', args)).data).toEqual(first.data);
  await expect(invokePaymentCommandWithStatus(f.reviewer, 'allocate_transfer', { ...args, p_allocations: [{ charge_id: f.chargeId, amount_minor: 49999 }] })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const balance = (await f.database.query('select finance_private.finance_charge_balance($1) as data', [f.chargeId])).rows[0].data;
  expect(balance).toMatchObject({ commercial_net_minor: 50000, allocated_cash_minor: 50000, receivable_minor: 0 });
  const source = (await f.database.query('select finance_private.finance_transfer_balance($1) as data', [transfer.id])).rows[0].data;
  expect(source).toMatchObject({ gross_settled_minor: 55000, net_allocated_minor: 50000, unapplied_signed_minor: 5000, available_minor: 5000, payer_account_id: f.learnerAccountId });
  expect((await f.database.query('select count(*)::int as count from finance_private.payment_allocations where transfer_id=$1', [transfer.id])).rows[0].count).toBe(1);
  const totals = (await f.database.query("select l.account_code,sum(l.signed_minor)::text as total from finance_private.ledger_lines l where l.transfer_id=$1 group by l.account_code order by l.account_code", [transfer.id])).rows;
  expect(totals).toEqual([{ account_code: 'channel_cash', total: '55000' }, { account_code: 'receivable', total: '-50000' }, { account_code: 'unapplied_customer_funds', total: '-5000' }]);
});

test('GT-503 GT-1403 pending transfer and superseded evidence cannot post even for the current reviewer', async () => {
  const account = await f.receiving(), transfer = await f.transfer(account.id, 55000, false, true);
  const receipt = await f.receipt(account.versionId);
  const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 1 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
  expect((await f.reviewer.rpc('allocate_transfer', args)).error?.message).toBe('TRANSFER_UNSETTLED');
  const nextFile = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: f.chargeId, uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId: f.chargeId });
  await f.rpc('replace_receipt', { p_receipt_id: receipt.receipt_id, p_file_id: nextFile, p_reason: 'New synthetic proof version', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
  expect((await f.reviewer.rpc('allocate_transfer', args)).error).not.toBeNull();
  expect((await f.database.query('select count(*)::int as count from finance_private.payment_allocations where transfer_id=$1', [transfer.id])).rows[0].count).toBe(0);
});
