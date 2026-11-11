import { randomUUID } from 'node:crypto';
import { paymentFixture } from './payments';
import { settleEnrollment } from './financial-booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { getEnrollmentTransferProposal, getEnrollmentTransferConsent } from '../../src/modules/booking/enrollment-transfers';
import {createClient} from '@supabase/supabase-js';
import {anonymousClient,loadLocalSupabase} from './supabase';

/** Real Auth and public commands; only files use declared synthetic T06 metadata. */
export async function enrollmentTransferFixture(options:{carryoverMinor?:number;review?:boolean;feeApproverIsTutor?:boolean;sourcePayerWithoutRoles?:boolean}={}) {
 const f=await paymentFixture({charge:'enrollment'}),sourceId=f.enrollmentId!;
 if(options.feeApproverIsTutor)await f.rpc('grant_staff_role',{p_account_id:f.actor.id,p_role:'admin',p_reason:'Fresh isolated fee approver',p_idempotency_key:randomUUID()});
 const fee=async(id:string)=>f.rpc('approve_tutor_fee',{p_occurrence_id:id,p_tutor_id:f.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.private_pricing,p_target_tier:null,p_purpose:'initial',p_reason:'Exact transfer fixture assignment',p_expected_version:1,p_idempotency_key:randomUUID()},options.feeApproverIsTutor?f.tutor:f.admin);
 const sourceOccurrence=(await f.database.query('select occurrence_id from app_private.enrollments where id=$1',[sourceId])).rows[0].occurrence_id as string;
 await fee(sourceOccurrence);const receiving=await f.receiving();let paid:Awaited<ReturnType<typeof settleEnrollment>>,payer=f.learner;
 if(options.sourcePayerWithoutRoles){
  const config=loadLocalSupabase(),provider=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`transfer.payer.${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
  const created=await provider.auth.admin.createUser({email,password,email_confirm:true});if(created.error||!created.data.user)throw new Error('SYNTHETIC_PAYER_CREATION_FAILED');
  payer=anonymousClient();if((await payer.auth.signInWithPassword({email,password})).error)throw new Error('SYNTHETIC_PAYER_LOGIN_FAILED');
  // Only this fresh synthetic account: no deployed role bypass or shared actor mutation.
  await f.database.query("update app_private.account_roles set revoked_at=now(),version=version+1,reason='Guarded isolated zero-role payer fixture' where account_id=$1 and revoked_at is null",[created.data.user.id]);
  const transfer=await f.transfer(receiving.id,50000,true,false),ownership=await f.evidence({purpose:'payer_ownership',parentType:'transfer',parentId:transfer.id});
  await f.rpc('bind_transfer_payer',{p_transfer_id:transfer.id,p_payer_account_id:created.data.user.id,p_evidence_file_id:ownership,p_reason:'Independent verified payer, no beneficiary role',p_expected_version:transfer.version,p_idempotency_key:randomUUID()},f.reviewer);
  const receipt=await f.receipt(receiving.versionId,50000),claim=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const plan=await f.rpc('authorize_payment_plan',{p_receipt_id:receipt.receipt_id,p_targets:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  const link=await f.rpc('link_transfer_payment_plan',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_payment_plan_id:plan.payment_plan_id,p_expected_version:claim.version,p_idempotency_key:randomUUID()},f.reviewer);
  await f.rpc('accept_transfer_payment_plan',{p_transfer_id:transfer.id,p_payment_plan_id:plan.payment_plan_id,p_plan_hash:link.plan_hash,p_expected_version:link.version,p_idempotency_key:randomUUID()},payer);
  const version=(await f.database.query('select version from app_private.review_cases where id=$1',[receipt.case_id])).rows[0].version;
  const allocation=await f.rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_evidence_version:1,p_payment_plan_id:plan.payment_plan_id,p_allocations:[{charge_id:f.chargeId,amount_minor:50000}],p_expected_version:version,p_idempotency_key:randomUUID()},f.reviewer);
  paid={chargeId:f.chargeId,transferId:transfer.id,allocation};
 }else paid=await settleEnrollment(f,sourceId,0,50000,receiving);
 const destination=await f.occurrence('private');await fee(destination.occurrence_id as string);
 const sourceVersion=(await f.database.query('select version from app_private.enrollments where id=$1',[sourceId])).rows[0].version as number;
 const requested=await f.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:sourceId,p_requested_terms:{target_type:'enrollment',destination_occurrence_id:destination.occurrence_id,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Real isolated transfer request',p_expected_version:sourceVersion,p_idempotency_key:randomUUID()},f.learner);
 const amount=options.carryoverMinor??50000;
 const reviewArgs={p_proposal_id:requested.proposal_id,p_source_tutor_fee_minor:10000,p_carryover_allocations:amount?[{allocation_id:(paid.allocation.allocation_ids as string[])[0],amount_minor:amount}]:[],p_source_package_disposition:null,p_reason:'Exact source consequence and carryover',p_expected_version:1,p_idempotency_key:randomUUID()};
 const reviewed=options.review===false?null:await f.rpc('review_enrollment_transfer_proposal',reviewArgs);
 const proposalId=reviewed?.proposal_id as string,destinationId=reviewed?.new_enrollment_id as string;
 const applyArgs={p_enrollment_id:sourceId,p_destination_occurrence_id:destination.occurrence_id,p_accepted_proposal_id:proposalId,p_expected_version:sourceVersion,p_idempotency_key:randomUUID()};
 async function acceptLearner(client=f.learner){
  const view=await getEnrollmentTransferProposal(client,proposalId,{view:'customer',learner_id:f.learnerId});
  await f.rpc('accept_operation_proposal',{p_proposal_id:proposalId,p_terms_hash:view.terms_hash,p_expected_version:view.version,p_idempotency_key:randomUUID()},client);
 }
 async function acceptTutorAndApprove(){
  const teacher=await getEnrollmentTransferProposal(f.tutor,proposalId,{view:'tutor'});
  await f.rpc('accept_operation_proposal',{p_proposal_id:proposalId,p_terms_hash:teacher.terms_hash,p_expected_version:teacher.version,p_idempotency_key:randomUUID()},f.tutor);
  const admin=await getEnrollmentTransferProposal(f.admin,proposalId,{view:'admin'});
  await f.rpc('approve_operation_proposal',{p_proposal_id:proposalId,p_terms_hash:admin.terms_hash,p_decision:'approved',p_reason:'Exact accepted transfer',p_expected_version:admin.version,p_idempotency_key:randomUUID()});
 }
 async function acceptPayer(client=f.learner){
  const account=(await client.auth.getUser()).data.user!.id;
  const id=(await f.database.query('select id from app_private.enrollment_transfer_consents where proposal_id=$1 and payer_account_id=$2',[proposalId,account])).rows[0].id as string;
  const intent=await getEnrollmentTransferConsent(client,id);
  await f.rpc('accept_enrollment_transfer_consent',{p_consent_id:id,p_terms_hash:intent.terms_hash,p_expected_version:intent.version,p_idempotency_key:randomUUID()},client);return intent;
 }
 const close=async()=>{if(payer!==f.learner)await payer.auth.signOut({scope:'local'});await f.close();};
 return {...f,payer,sourceId,sourceOccurrence,sourceVersion,receivingAccount:receiving,paid,destinationOccurrenceId:destination.occurrence_id as string,requested,reviewArgs,reviewed,proposalId,destinationId,applyArgs,acceptLearner,acceptTutorAndApprove,acceptPayer,close};
}
