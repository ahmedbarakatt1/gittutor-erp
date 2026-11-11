import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {paymentFixture} from '../helpers/payments';
test('correction preserves original posting and payer, requires new target consent, and posts a linked inverse plus replacement',async()=>{
 const f=await paymentFixture({charge:'enrollment'});try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,50000),receipt=await f.receipt(account.versionId,50000);
  const claim=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const initial=await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:claim.version,p_idempotency_key:randomUUID()},f.reviewer);
  const target=(await f.database.query('select charge_id from app_private.package_purchases where id=$1',[f.purchaseId])).rows[0].charge_id;
  const version=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[transfer.id])).rows[0].version;
  const args={p_allocation_id:(initial.allocation_ids as string[])[0],p_replacement_charge_id:target,p_amount_minor:10000,p_reason:'Exact source-owner correction',p_payment_plan_id:null as string|null,p_expected_version:version,p_idempotency_key:randomUUID()};
  expect((await f.admin.rpc('correct_allocation',args)).error?.message).toBe('CONSENT_REQUIRED');
  const plan=await f.rpc('authorize_payment_plan',{p_receipt_id:receipt.receipt_id,p_targets:[{charge_id:target,amount_minor:10000}],p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  const caseVersion=(await f.database.query('select version from app_private.review_cases where id=$1',[receipt.case_id])).rows[0].version;
  const link=await f.rpc('link_transfer_payment_plan',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_payment_plan_id:plan.payment_plan_id,p_expected_version:caseVersion,p_idempotency_key:randomUUID()},f.reviewer);
  await f.rpc('accept_transfer_payment_plan',{p_transfer_id:transfer.id,p_payment_plan_id:plan.payment_plan_id,p_plan_hash:link.plan_hash,p_expected_version:link.version,p_idempotency_key:randomUUID()},f.learner);
  const corrected=await f.rpc('correct_allocation',{...args,p_payment_plan_id:plan.payment_plan_id});
  expect((await f.rpc('correct_allocation',{...args,p_payment_plan_id:plan.payment_plan_id}))).toEqual(corrected);
  expect((await f.database.query('select amount_minor::int,payer_binding_id from finance_private.payment_allocations where id=$1',[args.p_allocation_id])).rows[0].amount_minor).toBe(50000);
  expect((await f.database.query('select replacement_allocation_id from finance_private.allocation_reversals where id=$1',[corrected.reversal_id])).rows[0].replacement_allocation_id).toBe(corrected.new_allocation_id);
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[f.chargeId])).rows[0].data).toMatchObject({allocated_cash_minor:40000,receivable_minor:10000});
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[target])).rows[0].data.allocated_cash_minor).toBe(10000);
 }finally{await f.close();}
});
