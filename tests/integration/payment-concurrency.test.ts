import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {paymentFixture} from '../helpers/payments';
import {raceBookingCalls} from '../helpers/booking';
test('GT-1408 independent allocation transactions cannot spend one settled source twice',async()=>{
 const f=await paymentFixture({charge:'enrollment'});try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,50000);
  const first=await f.receipt(account.versionId,40000);
  const purchaseCharge=(await f.database.query('select charge_id from app_private.package_purchases where id=$1',[f.purchaseId])).rows[0].charge_id;
  const file=await f.evidence({purpose:'payment_receipt',parentType:'charge',parentId:purchaseCharge,uploaderId:f.learnerAccountId,learnerId:f.learnerId,chargeId:purchaseCharge});
  const second=await f.rpc('submit_receipt',{p_enrollment_id:null,p_charge_id:purchaseCharge,p_file_id:file,p_receiving_account_version_id:account.versionId,p_channel:'instapay',p_transferred_amount_minor:40000,p_currency:'EGP',p_reference:`synthetic-${randomUUID()}`,p_transferred_at:null,p_idempotency_key:randomUUID()},f.learner);
  const cases=[first,second];const claims=await Promise.all(cases.map(receipt=>f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer)));
  const charges=[f.chargeId,purchaseCharge];
  const results=await raceBookingCalls(cases.map((receipt,index)=>({client:f.reviewer,name:'allocate_transfer',args:{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:JSON.stringify([{charge_id:charges[index],amount_minor:40000}]),p_expected_version:claims[index].version,p_idempotency_key:randomUUID()}})));
  expect(results.filter(row=>!row.error)).toHaveLength(1);expect(results.filter(row=>row.error)).toHaveLength(1);expect(['AMOUNT_OUT_OF_RANGE','INSUFFICIENT_FUNDS','RETRYABLE_CONFLICT']).toContain(results.find(row=>row.error)!.error);
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[transfer.id])).rows[0].data).toMatchObject({gross_settled_minor:50000,net_allocated_minor:40000,available_minor:10000});
  expect((await f.database.query('select count(*)::int count from finance_private.payment_allocations where transfer_id=$1',[transfer.id])).rows[0].count).toBe(1);
 }finally{await f.close();}
});
