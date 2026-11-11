import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {enrollmentTransferFixture} from '../helpers/enrollment-transfer';
import {paymentFixture} from '../helpers/payments';
import {getEnrollmentTransferProposal} from '../../src/modules/booking/enrollment-transfers';
import {catalogFixtureIds} from '../../tools/catalog-seed';
import {settleEnrollment,prepareAmendmentReceipt} from '../helpers/financial-booking';
import {raceBookingCalls} from '../helpers/booking';
import {Pool} from 'pg';
import {loadLocalSupabase} from '../helpers/supabase';

test('current fee approver revocation removes the apply action and denies committing accepted transfer terms',async()=>{
 const f=await enrollmentTransferFixture({feeApproverIsTutor:true});
 try{
  await f.acceptLearner();await f.acceptTutorAndApprove();await f.acceptPayer();
  const grant=(await f.database.query("select id,version from app_private.account_roles where account_id=$1 and role='admin' and revoked_at is null",[f.actor.id])).rows[0];
  await f.rpc('revoke_staff_role',{p_role_grant_id:grant.id,p_expected_version:grant.version,p_reason:'Revoke only fresh isolated fee approver',p_idempotency_key:randomUUID()});
  expect((await f.admin.rpc('transfer_enrollment',f.applyArgs)).error?.message).toBe('CONSENT_REQUIRED');
  expect(await getEnrollmentTransferProposal(f.admin,f.proposalId,{view:'admin'})).toMatchObject({can_apply:false});
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.sourceId])).rows[0].state).toBe('confirmed');
 }finally{await f.close();}
},30000);

test.each(['decline','expiry'] as const)('conditional %s preserves real new funds, the original booking and immutable quote while freeing its destination',async(action)=>{
 const f=await enrollmentTransferFixture({carryoverMinor:10000});
 try{
  await f.acceptLearner();const newPaid=await settleEnrollment(f,f.destinationId,0,40000,f.receivingAccount);
  expect(newPaid.allocation).toMatchObject({confirmation_status:[{reason:'TRANSFER_PENDING'}]});
  const excessive=await prepareAmendmentReceipt(f,f.destinationId,0,1,f.receivingAccount);
  expect((await f.reviewer.rpc('allocate_transfer',{p_case_id:excessive.receipt.case_id,p_transfer_id:excessive.transfer.id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:excessive.chargeId,amount_minor:1}],p_expected_version:excessive.claim.version,p_idempotency_key:randomUUID()})).error?.message).toBe('AMOUNT_OUT_OF_RANGE');
  if(action==='decline')await f.rpc('decline_operation_proposal',{p_proposal_id:f.proposalId,p_reason:'Decline conditional transfer',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  else{
   // Guarded mutable hold deadline for this fresh fixture only; immutable quote/consent history is unchanged.
   await f.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1",[f.destinationId]);
   const worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
   try{await worker.query('select app_private.process_occurrence_booking_due($1,$2)',[f.destinationOccurrenceId,randomUUID()]);}finally{await worker.end();}
  }
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.sourceId])).rows[0].state).toBe('confirmed');
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.destinationId])).rows[0].state).toBe(action==='decline'?'cancelled':'expired');
  expect((await f.database.query('select commitment_state from finance_private.charge_accounts where charge_id=$1',[newPaid.chargeId])).rows[0].commitment_state).toBe('resolution_required');
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[newPaid.transferId])).rows[0].data).toMatchObject({gross_settled_minor:40000,net_allocated_minor:40000,available_minor:0});
  expect((await f.database.query('select state from finance_private.enrollment_transfer_carryovers where proposal_id=$1',[f.proposalId])).rows[0].state).toBe('released');
  expect((await f.database.query("select count(*)::int n from app_private.booking_financial_resolutions where enrollment_id=$1 and state='open'",[f.destinationId])).rows[0].n).toBeGreaterThan(0);
 }finally{await f.close();}
},30000);

test('a changed source financial snapshot blocks even a zero-carryover fully funded destination',async()=>{
 const f=await enrollmentTransferFixture({carryoverMinor:0});
 try{
  await f.acceptLearner();await f.acceptTutorAndApprove();await settleEnrollment(f,f.destinationId,0,50000,f.receivingAccount);
  const evidence=await f.evidence({purpose:'transfer_reversal',parentType:'transfer',parentId:f.paid.transferId});
  const version=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[f.paid.transferId])).rows[0].version;
  const reversal=await f.rpc('record_transfer_reversal',{p_transfer_id:f.paid.transferId,p_external_reversal_id:randomUUID(),p_amount_minor:1,p_effective_at:new Date().toISOString(),p_evidence_file_id:evidence,p_expected_version:version,p_idempotency_key:randomUUID()});
  await f.rpc('resolve_transfer_reversal',{p_reversal_id:reversal.reversal_id,p_allocations:[{allocation_id:(f.paid.allocation.allocation_ids as string[])[0],amount_minor:1}],p_unapplied_minor:0,p_reason:'Exact one-minor-unit source loss',p_expected_version:reversal.version,p_idempotency_key:randomUUID()});
  expect((await f.admin.rpc('transfer_enrollment',f.applyArgs)).error?.message).toBe('VERSION_CONFLICT');
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.sourceId])).rows[0].state).toBe('confirmed');
 }finally{await f.close();}
},30000);

test('review races a real independent reservation for the sole destination seat',async()=>{
 const f=await enrollmentTransferFixture({review:false});
 try{
  const results=await raceBookingCalls([{client:f.admin,name:'review_enrollment_transfer_proposal',args:{...f.reviewArgs,p_carryover_allocations:JSON.stringify(f.reviewArgs.p_carryover_allocations)}},{client:f.students[1],name:'reserve_enrollment',args:{p_occurrence_id:f.destinationOccurrenceId,p_learner_id:f.learners[1],p_idempotency_key:randomUUID()}}]);
  expect(results.filter(r=>r.error===null)).toHaveLength(1);expect(results.filter(r=>r.error!==null).map(r=>r.error)).toEqual(['CAPACITY_CONFLICT']);
  expect((await f.database.query("select count(*)::int n from app_private.enrollments where occurrence_id=$1 and state='held'",[f.destinationOccurrenceId])).rows[0].n).toBe(1);
 }finally{await f.close();}
},30000);

test('a final outbox failure rolls back source adjustment, carryover and destination confirmation before exact retry',async()=>{
 const f=await enrollmentTransferFixture();
 try{
  await f.acceptLearner();await f.acceptTutorAndApprove();await f.acceptPayer();
  const token=(await f.admin.auth.getSession()).data.session!.access_token;
  await f.database.query('begin');
  try{
   await f.database.query("create function pg_temp.fail_transfer_outbox() returns trigger language plpgsql as $$begin if exists(select 1 from app_private.domain_events where id=new.event_id and event_type='enrollment_transferred' and aggregate_id=TG_ARGV[0]::uuid) then if not exists(select 1 from app_private.enrollments where id=TG_ARGV[1]::uuid and state='confirmed') then raise exception 'SYNTHETIC_WRONG_FAILURE_POINT';end if;raise exception 'SYNTHETIC_TRANSFER_ROLLBACK';end if;return new;end $$");
   await f.database.query(`create trigger synthetic_transfer_outbox_failure before insert on app_private.outbox_jobs for each row execute function pg_temp.fail_transfer_outbox('${f.sourceId}','${f.destinationId}')`);
   await f.database.query("select set_config('request.jwt.claims',$1,true)",[Buffer.from(token.split('.')[1],'base64url').toString()]);await f.database.query('set local role authenticated');
   await expect(f.database.query('select api.transfer_enrollment($1,$2,$3,$4,$5)',Object.values(f.applyArgs))).rejects.toThrow('SYNTHETIC_TRANSFER_ROLLBACK');
  }finally{await f.database.query('rollback');}
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.sourceId])).rows[0].state).toBe('confirmed');
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.destinationId])).rows[0].state).toBe('held');
  expect((await f.database.query('select count(*)::int n from app_private.enrollment_transfer_commits where proposal_id=$1',[f.proposalId])).rows[0].n).toBe(0);
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[f.paid.chargeId])).rows[0].data).toMatchObject({commercial_net_minor:50000,allocated_cash_minor:50000});
  const result=await f.rpc('transfer_enrollment',f.applyArgs);expect(await f.rpc('transfer_enrollment',f.applyArgs)).toEqual(result);
  expect((await f.database.query('select count(*)::int n from app_private.enrollment_transfer_commits where proposal_id=$1',[f.proposalId])).rows[0].n).toBe(1);
 }finally{await f.close();}
},30000);

test('an initial partial-package transfer loads without inventing a disposition, then reviews explicit exact units',async()=>{
 const f=await paymentFixture({cancellationRefundBasisPoints:5000});
 try{
  const grant=await f.grant(f.purchaseId,await f.grantPolicy(50001),50001,1000),held=await f.hold();
  const approve=async(id:string)=>f.rpc('approve_tutor_fee',{p_occurrence_id:id,p_tutor_id:f.tutorId,p_fee_minor:45000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.group_pricing,p_target_tier:2,p_purpose:'initial',p_reason:'Package transfer exact fee',p_expected_version:1,p_idempotency_key:randomUUID()});
  await approve(held.occurrenceId);
  await f.rpc('reserve_package_credit',{p_package_id:f.purchaseId,p_enrollment_id:held.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const times=f.interval(),destination=await f.rpc('create_occurrence',{p_offer_id:f.offerId,p_tutor_id:f.tutorId,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:2,p_idempotency_key:randomUUID()});await approve(destination.occurrence_id as string);
  const source=(await f.database.query('select version from app_private.enrollments where id=$1',[held.enrollmentId])).rows[0];
  const initial=await f.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:held.enrollmentId,p_requested_terms:{target_type:'enrollment',destination_occurrence_id:destination.occurrence_id,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Explicit partial package transfer',p_expected_version:source.version,p_idempotency_key:randomUUID()},f.learner);
  const before=await getEnrollmentTransferProposal(f.admin,initial.proposal_id as string,{view:'admin'});
  expect(before).toMatchObject({customer:{terms:null,destination:null},carryover_page:{items:[]},can_apply:false});
  const reviewed=await f.rpc('review_enrollment_transfer_proposal',{p_proposal_id:initial.proposal_id,p_source_tutor_fee_minor:10000,p_carryover_allocations:[],p_source_package_disposition:{released_credit_quanta:500,extinguished_credit_quanta:500},p_reason:'Exact units, original value, no silent package move',p_expected_version:1,p_idempotency_key:randomUUID()});
  expect(await getEnrollmentTransferProposal(f.learner,reviewed.proposal_id as string,{view:'customer'})).toMatchObject({terms:{source_customer_price_minor:0,source_retained_charge_minor:0,source_package_disposition:{released_credit_quanta:500,extinguished_credit_quanta:500,released_value_minor:25000,extinguished_value_minor:25001}}});
  expect((await f.database.query('select balances from app_private.package_lots where id=$1',[grant.lot_id])).rows[0].balances).toMatchObject({reserved_credit_quanta:1000,available_credit_quanta:0,consumed_credit_quanta:0});
 }finally{await f.close();}
},30000);
