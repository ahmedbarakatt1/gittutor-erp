import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { packageFixture } from '../helpers/packages';
import { authClient } from '../helpers/supabase';

describe('T06 real charge and settlement boundaries', () => {
  let f: Awaited<ReturnType<typeof packageFixture>>;
  let other: Awaited<ReturnType<typeof authClient>>;
  let purchaseId: string, chargeId: string;
  beforeAll(async () => {
    f = await packageFixture(); other = await authClient('learner_d');
    const purchase = await f.purchase(); purchaseId = purchase.resource_id as string; chargeId = purchase.charge_id as string;
  }, 30000);
  afterAll(async () => { await other?.auth.signOut({ scope: 'local' }); await f?.close(); });

  test('actual issued package charges expose scoped customer balances without fabricating settlement', async () => {
    const result = await f.learner.rpc('get_my_charge', { p_charge_id: chargeId });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ charge_id: chargeId, charge_type: 'package_purchase', package_purchase_id: purchaseId, original_minor: 150000, net_minor: 150000, allocated_cash_minor: 0, balance_minor: 150000, reconciliation_state: 'clear' });
    expect(JSON.stringify(result.data)).not.toMatch(/tutor_fee|compensation|ledger_lines|payer_binding|ciphertext|private_fee/);
    expect((await other.rpc('get_my_charge', { p_charge_id: chargeId })).error?.message).toBe('NOT_FOUND');
  });

  test('new enrollment issuance uses deferred tuition and persists distinct financial version', async () => {
    const hold = await f.hold();
    const actor = (await f.learner.auth.getUser()).data.user!.id;
    const source = (await f.database.query('select q.policy_version_id,q.terms_hash,q.customer_price_minor from app_private.quotes q where q.id=$1', [hold.quoteId])).rows[0];
    // Guarded private-kernel exercise uses an actual customer acceptance, never an invented funded state.
    const issued = (await f.database.query("select finance_private.finance_issue_charge('enrollment',$1,$2,null,$3,$4,$5,$6,$7) as id", [f.learnerId, actor, hold.enrollmentId, source.policy_version_id, source.terms_hash, source.customer_price_minor, { actor_account_id: actor, command_id: randomUUID() }])).rows[0].id;
    const postings = (await f.database.query("select l.account_code,l.signed_minor::text from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where t.source_type='charge_issued' and t.source_id=$1 order by l.account_code", [issued])).rows;
    expect(postings).toEqual([{ account_code: 'deferred_tuition', signed_minor: '-57500' }, { account_code: 'receivable', signed_minor: '57500' }]);
    expect((await f.database.query('select version,commitment_state from finance_private.charge_accounts where charge_id=$1', [issued])).rows[0]).toEqual({ version: 1, commitment_state: 'ordinary' });
  });

  test('primary charge balance keeps posted obligations separate from package funding preview', async () => {
    const balance = (await f.database.query('select finance_private.finance_charge_balance($1) as data', [chargeId])).rows[0].data;
    expect(balance).toMatchObject({ charge_id: chargeId, original_minor: 150000, adjustments_minor: 0, commercial_net_minor: 150000, allocated_cash_minor: 0, allocated_package_value_minor: 0, receivable_minor: 150000, refund_reserved_minor: 0, refunded_minor: 0 });
    expect((await f.database.query("select count(*)::int as count from app_private.package_lots where purchase_id=$1 and origin_kind='purchase'", [purchaseId])).rows[0].count).toBe(0);
  });

  test('referenced charge corrections preserve original issuance and one exact balanced posting', async () => {
    const context = { actor_account_id: (await f.admin.auth.getUser()).data.user!.id, command_id: randomUUID() };
    const args = [chargeId, -50000, 'commercial', 'synthetic_authorized_charge_credit', f.policyId, new Date().toISOString(), 'Guarded private kernel regression', context, 'one-credit'];
    const first = (await f.database.query('select finance_private.finance_adjust_charge($1,$2,$3,$4,$5,$6,$7,$8,$9) as result', args)).rows[0].result;
    expect(first).toMatchObject({ commercial_net_minor: 100000, charge_version: 2, allocation_reversal_ids: [], released_credit_lot_ids: [] });
    expect((await f.database.query('select finance_private.finance_adjust_charge($1,$2,$3,$4,$5,$6,$7,$8,$9) as result', args)).rows[0].result).toEqual(first);
    const original = (await f.database.query('select amount_minor::text,state,version from finance_private.charges where id=$1', [chargeId])).rows[0];
    expect(original).toEqual({ amount_minor: '150000', state: 'issued', version: 1 });
    const lines = (await f.database.query("select count(*)::int as count,sum(l.signed_minor)::text as total from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where t.source_type='charge_adjustment' and t.source_id=$1", [first.adjustment_id])).rows[0];
    expect(lines).toEqual({ count: 2, total: '0' });
    await expect(f.database.query('select finance_private.finance_adjust_charge($1,$2,$3,$4,$5,$6,$7,$8,$9)', [chargeId, -100001, ...args.slice(2, 7), { ...context, command_id: randomUUID() }, 'too-much'])).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
    expect((await f.database.query('select finance_private.finance_charge_balance($1) as result', [chargeId])).rows[0].result.commercial_net_minor).toBe(100000);
  });
});
