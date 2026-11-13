import{randomUUID}from'node:crypto';
import{expect,test}from'vitest';
import{paymentFixture}from'../helpers/payments';
import{getFinanceSummary,invokeFinanceCommand,listExpenses,listFinanceEntries,listFinanceCashAccounts}from'../../src/modules/analytics/finance';
import{cairoDate}from'../../src/modules/shared/primitives';
import{raceBookingCalls}from'../helpers/booking';
const delta=(a:number|string,b:number|string)=>Number(BigInt(a)-BigInt(b));
test('expense accrual and partial cash settlement remain distinct, auditable and admin-only',async()=>{const f=await paymentFixture();try{
 const range=()=>({p_from:cairoDate(new Date(Date.now()-86400000)),p_to:cairoDate(new Date(Date.now()+86400000)),p_as_of:new Date().toISOString()});
 const before=await getFinanceSummary(f.admin,range()),account=await f.receiving(),evidence=await f.evidence({purpose:'expense_evidence',parentType:'expense',parentId:null});
 const args={p_category:'software',p_amount_minor:5000,p_currency:'EGP',p_incurred_at:new Date(Date.now()-60000).toISOString(),p_description:'Synthetic operating cost',p_evidence_file_id:evidence,p_idempotency_key:randomUUID()};
 const made=(await invokeFinanceCommand(f.admin,'record_expense',args)).data;expect((await invokeFinanceCommand(f.admin,'record_expense',args)).data).toEqual(made);
 const accrued=await getFinanceSummary(f.admin,range());expect(delta(accrued.period.operating_expense_minor,before.period.operating_expense_minor)).toBe(5000);expect(delta(accrued.balances.expense_payable_minor,before.balances.expense_payable_minor)).toBe(5000);expect(delta(accrued.balances.cash_minor,before.balances.cash_minor)).toBe(0);
 const expenseId=made.resource_id,settlementEvidence=await f.evidence({purpose:'expense_settlement',parentType:'expense',parentId:expenseId}),paidArgs={p_expense_id:expenseId,p_amount_minor:3000,p_receiving_account_id:account.id,p_external_reference:`synthetic-expense-${randomUUID()}`,p_settled_at:new Date().toISOString(),p_evidence_file_id:settlementEvidence,p_expected_version:1,p_idempotency_key:randomUUID()};
 const paid=(await invokeFinanceCommand(f.admin,'record_expense_settlement',paidArgs)).data;expect(paid).toMatchObject({remaining_payable_minor:2000});expect((await invokeFinanceCommand(f.admin,'record_expense_settlement',paidArgs)).data).toEqual(paid);
 const current=await getFinanceSummary(f.admin,range());expect(delta(current.balances.cash_minor,before.balances.cash_minor)).toBe(-3000);expect(delta(current.balances.expense_payable_minor,before.balances.expense_payable_minor)).toBe(2000);expect(delta(current.period.operating_expense_minor,before.period.operating_expense_minor)).toBe(5000);expect(current.ledger_balanced).toBe(true);
 await expect(getFinanceSummary(f.learner,range())).rejects.toThrow('FORBIDDEN');await expect(getFinanceSummary(f.tutor,range())).rejects.toThrow('FORBIDDEN');await expect(invokeFinanceCommand(f.admin,'record_expense_settlement',{...paidArgs,p_amount_minor:2001,p_expected_version:paid.version,p_idempotency_key:randomUUID(),p_external_reference:`excess-${randomUUID()}`})).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
 const expenses=await listExpenses(f.admin,{p_limit:100,p_cursor:null});expect(expenses.items.find(row=>row.expense_id===expenseId)).toMatchObject({amount_minor:5000,paid_minor:3000,payable_minor:2000,state:'partially_paid'});
 const lines=await listFinanceEntries(f.admin,{...range(),p_account_codes:['operating_expense'],p_limit:100,p_cursor:null});expect(lines.items.some(row=>row.source_id===expenseId&&row.signed_minor===5000)).toBe(true);
 expect((await listFinanceCashAccounts(f.admin)).items.find(row=>row.receiving_account_id===account.id)?.balance_minor).toBe(-3000);
 const proof=await f.evidence({purpose:'cash_reconciliation',parentType:'receiving_account',parentId:account.id});const reconciliation=(await invokeFinanceCommand(f.admin,'record_cash_reconciliation',{p_receiving_account_id:account.id,p_observed_balance_minor:-2500,p_balance_at:new Date().toISOString(),p_evidence_file_id:proof,p_reason:'Synthetic unmatched independent statement',p_idempotency_key:randomUUID()})).data;expect(reconciliation).toMatchObject({ledger_balance_minor:-3000,difference_minor:500,state:'difference'});expect((await getFinanceSummary(f.admin,range())).balances.cash_minor).toBe(current.balances.cash_minor);
 }finally{await f.close();}},60000);

test('independent expense settlements cannot overpay one accrued source and snapshots retain recorded cutoff',async()=>{const f=await paymentFixture();try{
 const account=await f.receiving(),proof=await f.evidence({purpose:'expense_evidence',parentType:'expense',parentId:null}),cutoff=new Date().toISOString();
 const made=(await invokeFinanceCommand(f.admin,'record_expense',{p_category:'other',p_amount_minor:5000,p_currency:'EGP',p_incurred_at:new Date(Date.now()-86400000).toISOString(),p_description:'Synthetic concurrency cost',p_evidence_file_id:proof,p_idempotency_key:randomUUID()})).data;
 const evidence=await f.evidence({purpose:'expense_settlement',parentType:'expense',parentId:made.resource_id});const args={p_expense_id:made.resource_id,p_amount_minor:3000,p_receiving_account_id:account.id,p_external_reference:`race-${randomUUID()}`,p_settled_at:new Date().toISOString(),p_evidence_file_id:evidence,p_expected_version:1,p_idempotency_key:randomUUID()};
 const results=await raceBookingCalls([args,{...args,p_external_reference:`race-${randomUUID()}`,p_idempotency_key:randomUUID()}].map(args=>({client:f.admin,name:'record_expense_settlement',args})));
 expect(results.filter(r=>!r.error)).toHaveLength(1);expect(['VERSION_CONFLICT','RETRYABLE_CONFLICT']).toContain(results.find(r=>r.error)?.error);
 expect((await f.database.query('select sum(amount_minor)::int total,count(*)::int count from finance_private.expense_settlements where expense_id=$1',[made.resource_id])).rows[0]).toEqual({total:3000,count:1});
 const range={p_from:cairoDate(new Date(Date.now()-172800000)),p_to:cairoDate(new Date()),p_account_codes:['operating_expense'],p_limit:100};
 expect((await listFinanceEntries(f.admin,{...range,p_as_of:cutoff})).items.some(row=>row.source_id===made.resource_id)).toBe(false);
 expect((await listFinanceEntries(f.admin,{...range,p_as_of:new Date().toISOString()})).items.some(row=>row.source_id===made.resource_id)).toBe(true);
 }finally{await f.close();}},60000);
