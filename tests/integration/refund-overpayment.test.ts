import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { paymentFixture } from '../helpers/payments';
import { createVerifiedRefund } from '../helpers/refunds';
import { getMyCharge } from '../../src/modules/payments/queries';

test('a 5000 overpayment refund reduces original payer credit and cash without changing the 50000 tuition charge', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 55000), receipt = await f.receipt(account.versionId, 55000);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const chargeBefore = await getMyCharge(f.learner, f.chargeId);
    expect(chargeBefore).toMatchObject({ original_minor: 50000, net_minor: 50000, allocated_cash_minor: 50000, balance_minor: 0 });
    const tuitionPostings = (await f.database.query('select id,account_code,signed_minor from finance_private.ledger_lines where charge_id=$1 order by id', [f.chargeId])).rows;
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [transfer.id])).rows[0].data).toMatchObject({ available_minor: 5000, net_allocated_minor: 50000 });
    const refund = await createVerifiedRefund(f, 5000, transfer.id);
    const approved = await f.rpc('approve_refund', { p_refund_id: refund.refundId, p_remedy_id: null, p_destination_version_id: refund.destinationVersionId, p_amount_minor: 5000, p_reason: 'Return only original payer overpayment', p_expected_version: refund.version, p_idempotency_key: randomUUID() });
    const attempted = await f.rpc('record_refund_attempt', { p_refund_id: refund.refundId, p_external_reference: `synthetic-overpayment-${randomUUID()}`, p_expected_version: approved.version, p_idempotency_key: randomUUID() });
    const evidence = await f.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: String(attempted.attempt_id) });
    const args = { p_refund_id: refund.refundId, p_attempt_id: attempted.attempt_id, p_outcome: 'settled', p_evidence_file_id: evidence, p_external_reference: `synthetic-overpayment-settled-${randomUUID()}`, p_settled_at: new Date(Date.now() - 1000).toISOString(), p_expected_version: attempted.version, p_idempotency_key: randomUUID() };
    const settled = await f.rpc('reconcile_refund', args);
    expect(await f.rpc('reconcile_refund', args)).toEqual(settled);
    expect((await getMyCharge(f.learner, f.chargeId))).toMatchObject({ original_minor: 50000, net_minor: 50000, allocated_cash_minor: 50000, balance_minor: 0 });
    expect((await f.database.query('select id,account_code,signed_minor from finance_private.ledger_lines where charge_id=$1 order by id', [f.chargeId])).rows).toEqual(tuitionPostings);
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [transfer.id])).rows[0].data).toMatchObject({ gross_settled_minor: 55000, net_allocated_minor: 50000, refund_settled_minor: 5000, refund_reserved_minor: 0, available_minor: 0 });
    expect((await f.database.query("select sum(signed_minor)::int amount from finance_private.ledger_lines where transfer_id=$1 and account_code='channel_cash'", [transfer.id])).rows[0].amount).toBe(50000);
    expect((await f.database.query('select coalesce(sum(finance_private.finance_credit_available(id)),0)::int amount from finance_private.customer_credit_lots where transfer_id=$1', [transfer.id])).rows[0].amount).toBe(0);
    expect(JSON.stringify(await getMyCharge(f.learner, f.chargeId))).not.toMatch(/fee_minor|compensation|margin|encrypted_identifier/);
  } finally { await f.close(); }
});
