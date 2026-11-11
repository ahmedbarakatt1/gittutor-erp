import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {paymentFixture} from '../helpers/payments';
import {createVerifiedRefund} from '../helpers/refunds';
import {raceBookingCalls} from '../helpers/booking';

test('competing partial refunds cannot share one approved remedy reservation',async()=>{
 const f=await paymentFixture({charge:'enrollment'});try{
  const receiving=await f.receiving(),transfer=await f.transfer(receiving.id,50000),receipt=await f.receipt(receiving.versionId,50000);
  const claim=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const allocation=await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:claim.version,p_idempotency_key:randomUUID()},f.reviewer);
  await f.database.query("select finance_private.finance_adjust_charge($1,-50000,'commercial','synthetic_guarded_remedy',$2,now(),'Historical approved charge remedy',$3,'review-credit')",[f.chargeId,randomUUID(),{command_id:randomUUID(),actor_account_id:f.adminId}]);
  const plan=randomUUID(),policy=(await f.database.query('select accepted_contract_version_id from finance_private.charges where id=$1',[f.chargeId])).rows[0].accepted_contract_version_id;
  await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'charge',$2,$3,$4,0,50000,'cash',repeat('e',64),$5,$6)",[plan,f.chargeId,policy,f.adminId,{allocation_ids:allocation.allocation_ids},randomUUID()]);
  const refunds=[await createVerifiedRefund(f,25000,transfer.id),await createVerifiedRefund(f,25000,transfer.id)];
  const calls=refunds.map(refund=>({client:f.admin,name:'approve_refund',args:{p_refund_id:refund.refundId,p_remedy_id:plan,p_destination_version_id:refund.destinationVersionId,p_amount_minor:25000,p_reason:'One exclusive approved benefit reservation',p_expected_version:refund.version,p_idempotency_key:randomUUID()}}));
  const results=await raceBookingCalls(calls);
  for(let i=0;i<results.length;i++)if(results[i].error==='RETRYABLE_CONFLICT'){
   const retry=await f.admin.rpc('approve_refund',calls[i].args);results[i]={data:retry.data,error:retry.error?.message??null};
  }
  expect(results.filter(result=>!result.error)).toHaveLength(1);
  expect(results.find(result=>result.error)?.error).toBe('REMEDY_RESERVED');
  const winner=results.findIndex(result=>!result.error),loser=1-winner;
  expect(await f.rpc('approve_refund',calls[winner].args)).toEqual(results[winner].data);
  expect((await f.database.query('select count(distinct refund_id)::int owners,sum(amount_minor)::int money from finance_private.refund_source_reservations where remedy_reservation_id in(select id from app_private.remedy_reservations where remedy_id=$1)',[plan])).rows[0]).toEqual({owners:1,money:25000});
  expect((await f.database.query('select state from finance_private.refunds where id=$1',[refunds[loser].refundId])).rows[0].state).toBe('requested');
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[transfer.id])).rows[0].data).toMatchObject({refund_reserved_minor:25000,available_minor:25000,refund_settled_minor:0});
 }finally{await f.close();}
},30000);
