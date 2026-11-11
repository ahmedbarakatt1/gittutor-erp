import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { getMyPackage } from '../../src/modules/packages/queries';

test('only full actual settled allocation activates one purchased grant, with preserved source ancestry and no duplicate deferred obligation', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving();
    const original = await getMyPackage(f.learner, f.purchaseId);
    const price = original.package.purchase_value_minor;
    expect(original.package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0 });
    const allocate = async (amount: number) => {
      const transfer = await f.transfer(account.id, amount), receipt = await f.receipt(account.versionId, amount);
      const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
      const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: amount }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
      const result = await f.rpc('allocate_transfer', args, f.reviewer);
      return { args, result, transfer };
    };
    const first = await allocate(price - 1);
    expect((await getMyPackage(f.learner, f.purchaseId)).package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0 });
    const last = await allocate(1);
    const activated = await getMyPackage(f.learner, f.purchaseId);
    expect(activated.package).toMatchObject({ purchase_state: 'activated', purchased_granted_credit_quanta: original.package.purchased_credit_quanta, charge: { net_minor: price, allocated_minor: price, balance_minor: 0, funding_integration_state: 'ready' } });
    expect(await f.rpc('allocate_transfer', last.args, f.reviewer)).toEqual(last.result);
    const lots = (await f.database.query("select id from app_private.package_lots where purchase_id=$1 and origin_kind='purchase'", [f.purchaseId])).rows;
    expect(lots).toHaveLength(1);
    const ancestry = (await f.database.query('select transfer_id,amount_minor from finance_private.package_funding_sources where original_lot_id=$1 order by amount_minor', [lots[0].id])).rows;
    expect(ancestry).toEqual([{ transfer_id: last.transfer.id, amount_minor: '1' }, { transfer_id: first.transfer.id, amount_minor: String(price - 1) }]);
    expect((await f.database.query("select sum(signed_minor)::text total from finance_private.ledger_lines where package_purchase_id=$1 and account_code='deferred_package_obligation'", [f.purchaseId])).rows[0].total).toBe(String(-price));
  } finally { await f.close(); }
});
