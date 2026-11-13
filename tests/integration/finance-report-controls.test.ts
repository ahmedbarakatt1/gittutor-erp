import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { paymentFixture } from '../helpers/payments';
import { completionFixture } from '../helpers/completion';
import { approvePayrollEarning, settleTutorPayout } from '../helpers/payroll';
import { getFinanceSummary, invokeFinanceCommand, listCashReconciliations, listTutorObligations } from '../../src/modules/analytics/finance';
import { cairoDate } from '../../src/modules/shared/primitives';

test('GT-807 cash variance remains owned and open until referenced settled-source postings reconcile its original control', async () => {
  const f = await paymentFixture(); try {
    const account = await f.receiving(), evidence = await f.evidence({ purpose: 'cash_reconciliation', parentType: 'receiving_account', parentId: account.id }), balanceAt = new Date().toISOString();
    const compared = (await invokeFinanceCommand(f.admin, 'record_cash_reconciliation', { p_receiving_account_id: account.id, p_observed_balance_minor: 10000, p_balance_at: balanceAt, p_evidence_file_id: evidence, p_reason: 'Synthetic unexplained daily close difference', p_idempotency_key: randomUUID() })).data;
    const before = await listCashReconciliations(f.admin, { p_receiving_account_id: account.id });
    expect(before.items[0]).toMatchObject({ reconciliation_id: compared.resource_id, owner_account_id: f.adminId, state: 'open', current_difference_minor: 10000 });
    const args = { p_reconciliation_id: compared.resource_id, p_correction_transaction_ids: [randomUUID()], p_evidence_file_id: evidence, p_reason: 'Attempt to close without actual corrected source', p_expected_version: 1, p_idempotency_key: randomUUID() };
    await expect(invokeFinanceCommand(f.admin, 'resolve_cash_reconciliation', args)).rejects.toThrow();
    const transfer = await f.transfer(account.id, 10000, true, false);
    const transaction = (await f.database.query("select distinct t.id from finance_private.ledger_transactions t join finance_private.ledger_lines l on l.transaction_id=t.id where l.receiving_account_id=$1 and l.account_code='channel_cash'and l.signed_minor=10000 order by t.id", [account.id])).rows[0].id;
    const resolvedArgs = { ...args, p_correction_transaction_ids: [transaction], p_reason: 'Independently reconciled settled transfer now accounts for variance', p_idempotency_key: randomUUID() };
    const resolved = await invokeFinanceCommand(f.admin, 'resolve_cash_reconciliation', resolvedArgs);
    expect((await invokeFinanceCommand(f.admin, 'resolve_cash_reconciliation', resolvedArgs)).data).toEqual(resolved.data);
    const after = await listCashReconciliations(f.admin, { p_receiving_account_id: account.id });
    expect(after.items[0]).toMatchObject({ state: 'resolved', difference_minor: 10000, current_difference_minor: 0, observed_balance_minor: 10000, ledger_balance_minor: 0, owner_account_id: f.adminId });
    expect(after.items[0].resolution?.correction_transaction_ids).toEqual([transaction]);
    expect(transfer.id).toBeTruthy();
    await expect(invokeFinanceCommand(f.reviewer, 'resolve_cash_reconciliation', { ...resolvedArgs, p_idempotency_key: randomUUID() })).rejects.toThrow('FORBIDDEN');
    await expect(f.database.query('update finance_private.cash_reconciliations set difference_minor=0 where id=$1', [compared.resource_id])).rejects.toThrow();
  } finally { await f.close(); }
}, 60000);

test('GT-1506 tutor advance10000 and another tutor payable45000 remain gross with exact ledger reconciliation', async () => {
  const a = await completionFixture(), b = await completionFixture(); try {
    const range = () => ({ p_from: '2000-01-01', p_to: cairoDate(new Date()), p_as_of: new Date().toISOString() });
    const before = await getFinanceSummary(a.admin, range()), ae = await approvePayrollEarning(a), be = await approvePayrollEarning(b);
    const adjust = async (f: typeof a, earning: string, delta: number, version: number) => f.rpc('adjust_tutor_earning', { p_earning_id: earning, p_delta_minor: delta, p_effective_at: new Date().toISOString(), p_evidence_file_id: await f.evidence({ purpose: 'earning_adjustment', parentType: 'tutor_earning', parentId: earning }), p_reason: 'Explicit synthetic reviewed compensation correction', p_expected_version: version, p_idempotency_key: randomUUID() });
    await adjust(a, ae, 47500, 1); await adjust(b, be, 20000, 1);
    await a.transfer(a.receivingAccount.id, 25000, true, false); await settleTutorPayout(a, ae, 72500); await adjust(a, ae, -10000, 2);
    const after = await getFinanceSummary(a.admin, range()), delta = (x: number | string, y: number | string) => Number(BigInt(x) - BigInt(y));
    expect(delta(after.balances.gross_tutor_payable_minor, before.balances.gross_tutor_payable_minor)).toBe(45000);
    expect(delta(after.balances.tutor_advance_minor, before.balances.tutor_advance_minor)).toBe(10000);
    expect(delta(after.balances.tutor_payable_minor, before.balances.tutor_payable_minor)).toBe(35000);
    const rows = await listTutorObligations(a.admin, { ...range(), p_tutor_id: a.tutorId });
    expect(rows.items[0]).toMatchObject({ tutor_id: a.tutorId, net_payable_minor: -10000, payable_minor: 0, advance_minor: 10000 });
    expect((await listTutorObligations(a.admin, { ...range(), p_tutor_id: b.tutorId })).items[0]).toMatchObject({ payable_minor: 45000, advance_minor: 0 });
    await expect(listTutorObligations(a.learner, range())).rejects.toThrow('FORBIDDEN');
  } finally { await a.close(); await b.close(); }
}, 90000);
