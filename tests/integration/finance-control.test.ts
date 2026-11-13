import{randomUUID}from'node:crypto';import{expect,test,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{authClient}from'../helpers/supabase';import{completionFixture}from'../helpers/completion';import{approvePayrollEarning,settleTutorPayout}from'../helpers/payroll';
import{getFinanceSummary,invokeFinanceCommand}from'../../src/modules/analytics/finance';import{cairoDate}from'../../src/modules/shared/primitives';
test('actual delivered50000 earning25000 settled payout15000 and paid expense5000 reconcile to profit20000 cash30000 payable10000',async()=>{
 const admin=await authClient('admin_a'),range=()=>({p_from:'2000-01-01',p_to:cairoDate(new Date()),p_as_of:new Date().toISOString()}),before=await getFinanceSummary(admin,range()),f=await completionFixture();try{
 const earning=await approvePayrollEarning(f);await settleTutorPayout(f,earning,15000);
 const expense=(await invokeFinanceCommand(f.admin,'record_expense',{p_category:'software',p_amount_minor:5000,p_currency:'EGP',p_incurred_at:new Date(Date.now()-30000).toISOString(),p_description:'Synthetic exact finance control',p_evidence_file_id:await f.evidence({purpose:'expense_evidence',parentType:'expense',parentId:null}),p_idempotency_key:randomUUID()})).data;
 await invokeFinanceCommand(f.admin,'record_expense_settlement',{p_expense_id:expense.resource_id,p_amount_minor:5000,p_receiving_account_id:f.receivingAccount.id,p_external_reference:`synthetic-control-${randomUUID()}`,p_settled_at:new Date().toISOString(),p_evidence_file_id:await f.evidence({purpose:'expense_settlement',parentType:'expense',parentId:expense.resource_id}),p_expected_version:expense.version,p_idempotency_key:randomUUID()});
 const after=await getFinanceSummary(f.admin,range()),delta=(a:number|string,b:number|string)=>Number(BigInt(a)-BigInt(b));
 expect(delta(after.period.earned_revenue_minor,before.period.earned_revenue_minor)).toBe(50000);expect(delta(after.period.tutor_expense_minor,before.period.tutor_expense_minor)).toBe(25000);expect(delta(after.period.operating_profit_minor,before.period.operating_profit_minor)).toBe(20000);expect(delta(after.balances.cash_minor,before.balances.cash_minor)).toBe(30000);expect(delta(after.balances.tutor_payable_minor,before.balances.tutor_payable_minor)).toBe(10000);expect(after.ledger_balanced).toBe(true);
 }finally{await f.close();await admin.auth.signOut({scope:'local'});}
},60000);
