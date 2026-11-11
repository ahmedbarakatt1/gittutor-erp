import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {packageFixture} from '../helpers/packages';
import {paymentFixture} from '../helpers/payments';
import {createVerifiedRefund} from '../helpers/refunds';
import {vi} from 'vitest';
vi.mock('server-only',()=>({}));

test('historical consumed benefit requires an exact approved remedy and restoration exhausts the shared original source',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),policy=await f.grantPolicy(50001);await f.grant(purchase.resource_id as string,policy,50001,1000);const hold=await f.hold();
  const reserved=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const allocation=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reserved.resource_id])).rows[0].id;
  // Explicit disposable historical mechanics only; this is not a delivery qualification.
  const consumption=(await f.database.query('select app_private.package_consume_allocation_kernel($1,1000,$2) data',[allocation,{command_id:randomUUID()}])).rows[0].data;
  const adminId=(await f.admin.auth.getUser()).data.user!.id,plan=randomUUID();
  await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,consumption_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'package_consumption',$2,$2,$3,$4,1000,50001,'restoration',repeat('a',64),'{}',$5)",[plan,consumption.movement_id,f.policyId,adminId,randomUUID()]);
  const version=(await f.database.query('select version from app_private.package_purchases where id=$1',[purchase.resource_id])).rows[0].version;
  const args={p_consumption_id:consumption.movement_id,p_credit_quanta:1000,p_remedy_id:plan,p_reason:'Synthetic historical approved restoration',p_expected_version:version,p_idempotency_key:randomUUID()};
  const restored=await f.admin.rpc('restore_package_credit',args);expect(restored.error).toBeNull();expect(restored.data).toMatchObject({restored_credit_quanta:1000,restored_value_minor:50001});expect((await f.admin.rpc('restore_package_credit',args)).data).toEqual(restored.data);
  const cash=randomUUID();await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,consumption_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'package_consumption',$2,$2,$3,$4,1000,50001,'cash',repeat('b',64),'{}',$5)",[cash,consumption.movement_id,f.policyId,adminId,randomUUID()]);
  await expect(f.database.query("select finance_private.finance_reserve_remedy($1,'package_consumption',$2,1000,50001,'cash',$3)",[cash,consumption.movement_id,{command_id:randomUUID(),actor_account_id:adminId}])).rejects.toThrow(/REMEDY_RESERVED|INSUFFICIENT_FUNDS/);
  expect((await f.database.query('select app_private.package_balance($1) data',[purchase.resource_id])).rows[0].data).toMatchObject({available_credit_quanta:1000,available_value_minor:50001,consumed_credit_quanta:0,consumed_value_minor:0});
 }finally{await f.close();}
});

test('released teaching cash requires an approved original-charge remedy and commits it only on evidenced settlement',async()=>{
 const f=await paymentFixture({charge:'enrollment'});try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,50000),receipt=await f.receipt(account.versionId,50000);
  const claimed=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const allocated=await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:claimed.version,p_idempotency_key:randomUUID()},f.reviewer);
  const allocationId=(allocated.allocation_ids as string[])[0];
  await f.database.query("select finance_private.finance_adjust_charge($1,-50000,'commercial','synthetic_guarded_cancel',$2,now(),'Guarded historical cancellation outcome',$3,'cancel')",[f.chargeId,randomUUID(),{command_id:randomUUID(),actor_account_id:f.adminId}]);
  const r=await createVerifiedRefund(f,50000,transfer.id),plan=randomUUID();
  const approvedPolicy=(await f.database.query('select accepted_contract_version_id from finance_private.charges where id=$1',[f.chargeId])).rows[0].accepted_contract_version_id;
  await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'charge',$2,$3,$4,0,50000,'cash',repeat('c',64),$5,$6)",[plan,f.chargeId,approvedPolicy,f.adminId,{allocation_ids:[allocationId]},randomUUID()]);
  expect((await f.admin.rpc('approve_refund',{p_refund_id:r.refundId,p_remedy_id:null,p_destination_version_id:r.destinationVersionId,p_amount_minor:50000,p_reason:'Remedy required',p_expected_version:r.version,p_idempotency_key:randomUUID()})).error?.message).toBe('REMEDY_REQUIRED');
  const approved=await f.rpc('approve_refund',{p_refund_id:r.refundId,p_remedy_id:plan,p_destination_version_id:r.destinationVersionId,p_amount_minor:50000,p_reason:'Exact approved original-charge cash remedy',p_expected_version:r.version,p_idempotency_key:randomUUID()});
  expect((await f.database.query('select state from app_private.remedy_reservations where remedy_id=$1',[plan])).rows).toEqual([{state:'reserved'}]);
  const attempt=await f.rpc('record_refund_attempt',{p_refund_id:r.refundId,p_external_reference:randomUUID(),p_expected_version:approved.version,p_idempotency_key:randomUUID()});
  const evidence=await f.evidence({purpose:'refund_outcome',parentType:'refund_attempt',parentId:attempt.attempt_id as string});
  await f.rpc('reconcile_refund',{p_refund_id:r.refundId,p_attempt_id:attempt.attempt_id,p_outcome:'settled',p_evidence_file_id:evidence,p_external_reference:randomUUID(),p_settled_at:new Date(Date.now()-1000).toISOString(),p_expected_version:attempt.version,p_idempotency_key:randomUUID()});
  expect((await f.database.query('select state from app_private.remedy_reservations where remedy_id=$1',[plan])).rows).toEqual([{state:'consumed'}]);
 }finally{await f.close();}
});

test('cash remedy extinguishes original funded consumed service with a signed adjustment and no reusable restoration',async()=>{
 const f=await paymentFixture();try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,150000),receipt=await f.receipt(account.versionId,150000);
  const claimed=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const allocated=await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:f.chargeId,amount_minor:150000}],p_expected_version:claimed.version,p_idempotency_key:randomUUID()},f.reviewer);
  const hold=await f.hold(),purchaseVersion=(await f.database.query('select version from app_private.package_purchases where id=$1',[f.purchaseId])).rows[0].version;
  const reserve=await f.rpc('reserve_package_credit',{p_package_id:f.purchaseId,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:purchaseVersion,p_idempotency_key:randomUUID()},f.learner);
  const source=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reserve.resource_id])).rows[0].id;
  const consumed=(await f.database.query('select app_private.package_consume_allocation_kernel($1,1000,$2) data',[source,{command_id:randomUUID()}])).rows[0].data;
  // Guarded historical approved domain outcome; actual delivery qualification remains a T08 responsibility.
  await f.database.query("select finance_private.finance_adjust_charge($1,-50000,'commercial','synthetic_consumed_remedy',$2,now(),'Historical approved consumed-service refund',$3,'remedy-credit')",[f.chargeId,consumed.movement_id,{command_id:randomUUID(),actor_account_id:f.adminId}]);
  const plan=randomUUID();await f.database.query("insert into finance_private.financial_remedy_plans(id,source_type,source_id,consumption_id,policy_version_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values($1,'package_consumption',$2,$2,$3,$4,1000,50000,'cash',repeat('d',64),$5,$6)",[plan,consumed.movement_id,f.policyId,f.adminId,{allocation_ids:allocated.allocation_ids},randomUUID()]);
  const r=await createVerifiedRefund(f,50000,transfer.id),approved=await f.rpc('approve_refund',{p_refund_id:r.refundId,p_remedy_id:plan,p_destination_version_id:r.destinationVersionId,p_amount_minor:50000,p_reason:'Original funded service cash remedy',p_expected_version:r.version,p_idempotency_key:randomUUID()});
  const attempt=await f.rpc('record_refund_attempt',{p_refund_id:r.refundId,p_external_reference:randomUUID(),p_expected_version:approved.version,p_idempotency_key:randomUUID()}),evidence=await f.evidence({purpose:'refund_outcome',parentType:'refund_attempt',parentId:attempt.attempt_id as string});
  await f.rpc('reconcile_refund',{p_refund_id:r.refundId,p_attempt_id:attempt.attempt_id,p_outcome:'settled',p_evidence_file_id:evidence,p_external_reference:randomUUID(),p_settled_at:new Date(Date.now()-1000).toISOString(),p_expected_version:attempt.version,p_idempotency_key:randomUUID()});
  expect((await f.database.query('select app_private.package_balance($1) data',[f.purchaseId])).rows[0].data).toMatchObject({available_credit_quanta:2000,available_value_minor:100000,consumed_credit_quanta:0,consumed_value_minor:0});
  const lot=(await f.database.query('select balances from app_private.package_lots where purchase_id=$1',[f.purchaseId])).rows[0].balances;expect(lot).toMatchObject({adjustment_credit_quanta:-1000,adjustment_value_minor:-50000});
  expect((await f.database.query("select coalesce(sum(signed_minor),0)::int value from finance_private.ledger_lines where package_purchase_id=$1 and account_code='tuition_revenue'",[f.purchaseId])).rows[0].value).toBe(0);
 }finally{await f.close();}
});
