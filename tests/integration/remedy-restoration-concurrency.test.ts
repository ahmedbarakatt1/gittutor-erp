import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { paymentFixture } from '../helpers/payments';
import { createVerifiedRefund } from '../helpers/refunds';
import { raceBookingCalls } from '../helpers/booking';

test('independent cash approval and restoration cannot claim the same historical funded benefit', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 150000), receipt = await f.receipt(account.versionId, 150000);
    const claimed = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const allocated = await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 150000 }], p_expected_version: claimed.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const held = await f.hold(), purchaseVersion = (await f.database.query('select version from app_private.package_purchases where id=$1', [f.purchaseId])).rows[0].version;
    const reserved = await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: held.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: purchaseVersion, p_idempotency_key: randomUUID() }, f.learner);
    const allocation = (await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1', [reserved.resource_id])).rows[0].id;
    // Guarded historical domain inputs isolate T06's shared remedy boundary.
    // This fixture does not attest T08 attendance, delivery qualification or choice authoring.
    const consumed = (await f.database.query('select app_private.package_consume_allocation_kernel($1,1000,$2) data', [allocation, { command_id: randomUUID() }])).rows[0].data;
    await f.database.query("select finance_private.finance_adjust_charge($1,-50000,'commercial','synthetic_historical_remedy',$2,now(),'Guarded historical source credit',$3,'remedy-credit')", [f.chargeId, consumed.movement_id, { command_id: randomUUID(), actor_account_id: f.adminId }]);
    const cashPlan = randomUUID(), restorationPlan = randomUUID();
    for (const [id, mode] of [[cashPlan, 'cash'], [restorationPlan, 'restoration']]) {
      await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,consumption_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'package_consumption',$2,$2,$3,$4,1000,50000,$5,repeat('e',64),$6,$7)", [id, consumed.movement_id, f.policyId, f.adminId, mode, { allocation_ids: allocated.allocation_ids }, randomUUID()]);
    }
    const refund = await createVerifiedRefund(f, 50000, transfer.id);
    const version = (await f.database.query('select version from app_private.package_purchases where id=$1', [f.purchaseId])).rows[0].version;
    const calls = [
      { client: f.admin, name: 'approve_refund', args: { p_refund_id: refund.refundId, p_remedy_id: cashPlan, p_destination_version_id: refund.destinationVersionId, p_amount_minor: 50000, p_reason: 'Competing original-source cash remedy', p_expected_version: refund.version, p_idempotency_key: randomUUID() } },
      { client: f.admin, name: 'restore_package_credit', args: { p_consumption_id: consumed.movement_id, p_credit_quanta: 1000, p_remedy_id: restorationPlan, p_reason: 'Competing original-service restoration', p_expected_version: version, p_idempotency_key: randomUUID() } },
    ];
    const results = await raceBookingCalls(calls);
    // An expanded graph is a documented whole-command rollback; retry the exact body/key only.
    for (let index = 0; index < results.length; index++) if (results[index].error === 'RETRYABLE_CONFLICT') results[index] = (await raceBookingCalls([calls[index]]))[0];
    expect(results.filter(row => !row.error)).toHaveLength(1);
    const winner = results.findIndex(row => !row.error), loser = 1 - winner;
    expect(results[loser].error).toBe('REMEDY_RESERVED');
    expect(await f.rpc(calls[winner].name, calls[winner].args)).toEqual(results[winner].data);
    const benefit = (await f.database.query("select r.mode,r.state,r.credit_quanta,r.value_minor from app_private.remedy_reservations r join finance_private.remedy_sources s on s.id=r.source_id where s.consumption_id=$1 and r.state in('reserved','consumed')", [consumed.movement_id])).rows;
    expect(benefit).toEqual([{ mode: winner === 0 ? 'cash' : 'restoration', state: winner === 0 ? 'reserved' : 'consumed', credit_quanta: '1000', value_minor: '50000' }]);
    expect((await f.database.query('select state from finance_private.refunds where id=$1', [refund.refundId])).rows[0].state).toBe(winner === 0 ? 'approved' : 'requested');
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [transfer.id])).rows[0].data).toMatchObject({ gross_settled_minor: 150000, refund_reserved_minor: winner === 0 ? 50000 : 0, refund_settled_minor: 0 });
    expect((await f.database.query('select app_private.package_balance($1) data', [f.purchaseId])).rows[0].data).toMatchObject({ available_credit_quanta: winner === 0 ? 2000 : 3000, consumed_credit_quanta: winner === 0 ? 1000 : 0 });
    expect((await f.database.query("select count(*)::int n from finance_private.ledger_lines where account_code='channel_cash' and transfer_id=$1", [transfer.id])).rows[0].n).toBe(1);
  } finally { await f.close(); }
});
