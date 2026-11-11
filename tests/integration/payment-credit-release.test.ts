import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';

test('referenced tuition credit releases proportional original-payer cash with exact remainder and replay', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const receiving = await f.receiving();
    const transfers = [await f.transfer(receiving.id, 30000), await f.transfer(receiving.id, 20000)];
    const receipt = await f.receipt(receiving.versionId, 50000);
    let version = (await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer)).version;
    for (const transfer of transfers) {
      version = (await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: transfer.amount }], p_expected_version: version, p_idempotency_key: randomUUID() }, f.reviewer)).version;
    }
    const context = { command_id: randomUUID(), actor_account_id: f.adminId }, source = randomUUID(), at = new Date().toISOString();
    const args = [f.chargeId, -10001, source, at, context];
    const query = "select finance_private.finance_adjust_charge($1,$2,'commercial','synthetic_guarded_credit',$3,$4,'Explicit synthetic tuition correction',$5,'credit') as data";
    const result = (await f.database.query(query, args)).rows[0].data;
    expect(result).toMatchObject({ commercial_net_minor: 39999 });
    expect(result.allocation_reversal_ids).toHaveLength(2);
    expect(result.released_credit_lot_ids).toHaveLength(2);
    expect((await f.database.query(query, args)).rows[0].data).toEqual(result);
    const releases = (await f.database.query('select l.original_minor::int value,l.payer_account_id,l.source_allocation_id,a.amount_minor::int original from finance_private.customer_credit_lots l join finance_private.payment_allocations a on a.id=l.source_allocation_id where l.id=any($1) order by a.amount_minor desc', [result.released_credit_lot_ids])).rows;
    expect(releases.map(row => row.value)).toEqual([6001, 4000]);
    expect(releases.every(row => row.payer_account_id === f.learnerAccountId)).toBe(true);
    const balance = (await f.database.query('select finance_private.finance_charge_balance($1) as data', [f.chargeId])).rows[0].data;
    expect(balance).toMatchObject({ commercial_net_minor: 39999, allocated_cash_minor: 39999, receivable_minor: 0 });
    const sums = (await f.database.query("select account_code,sum(signed_minor)::int total from finance_private.ledger_lines where transfer_id=any($1) group by account_code order by account_code", [transfers.map(row => row.id)])).rows;
    expect(sums).toEqual([{ account_code: 'channel_cash', total: 50000 }, { account_code: 'receivable', total: -39999 }, { account_code: 'unapplied_customer_funds', total: -10001 }]);
  } finally { await f.close(); }
});
