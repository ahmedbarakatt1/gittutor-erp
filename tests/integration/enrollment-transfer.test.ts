import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { getEnrollmentTransferProposal, getEnrollmentTransferConsent, listMyEnrollmentTransferConsents } from '../../src/modules/booking/enrollment-transfers';
import { getEnrollment } from '../../src/modules/booking/queries';

test('review stages a distinct destination while keeping the funded source and its original charge active', async () => {
 const f=await paymentFixture({charge:'enrollment'});
 try {
  const sourceId=f.enrollmentId!,sourceOccurrence=(await f.database.query('select occurrence_id from app_private.enrollments where id=$1',[sourceId])).rows[0].occurrence_id;
  const fee=async(occurrenceId:string)=>f.rpc('approve_tutor_fee',{p_occurrence_id:occurrenceId,p_tutor_id:f.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.private_pricing,p_target_tier:null,p_purpose:'initial',p_reason:'Exact source and destination assignment',p_expected_version:1,p_idempotency_key:randomUUID()});
  await fee(sourceOccurrence);
  const account=await f.receiving(),paid=await settleEnrollment(f,sourceId,0,50000,account);
  const destination=await f.occurrence('private');await fee(destination.occurrence_id as string);
  const version=(await f.database.query('select version from app_private.enrollments where id=$1',[sourceId])).rows[0].version;
  const request=await f.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:sourceId,p_requested_terms:{target_type:'enrollment',destination_occurrence_id:destination.occurrence_id,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Request reviewed same-offer transfer',p_expected_version:version,p_idempotency_key:randomUUID()},f.learner);
  expect((await f.database.query('select count(*)::int n from app_private.enrollments where occurrence_id=$1',[destination.occurrence_id])).rows[0].n).toBe(0);
  const args={p_proposal_id:request.proposal_id,p_source_tutor_fee_minor:10000,p_carryover_allocations:[{allocation_id:(paid.allocation.allocation_ids as string[])[0],amount_minor:50000}],p_source_package_disposition:null,p_reason:'Exact source outcome and destination terms',p_expected_version:1,p_idempotency_key:randomUUID()};
  const reviewed=await f.rpc('review_enrollment_transfer_proposal',args);
  expect(reviewed).toMatchObject({replaces_proposal_id:request.proposal_id,new_enrollment_id:expect.any(String),destination_quote_id:expect.any(String)});
  expect(reviewed.proposal_id).not.toBe(request.proposal_id);expect(reviewed.new_enrollment_id).not.toBe(sourceId);
  expect(await f.rpc('review_enrollment_transfer_proposal',args)).toEqual(reviewed);
  expect((await f.database.query('select state,version from app_private.enrollments where id=$1',[sourceId])).rows[0]).toEqual({state:'confirmed',version});
  expect((await f.database.query('select count(*)::int n from finance_private.charges where enrollment_id=$1',[reviewed.new_enrollment_id])).rows[0].n).toBe(0);
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[paid.chargeId])).rows[0].data).toMatchObject({allocated_cash_minor:50000,commercial_net_minor:50000});
  const view=await getEnrollmentTransferProposal(f.learner,reviewed.proposal_id as string,{view:'customer',learner_id:f.learnerId});
  if(view.view!=='customer')throw new Error('CUSTOMER_VIEW_REQUIRED');
  expect(view).toMatchObject({can_accept:true,terms:{source_cash_release_minor:50000,planned_carryover_minor:50000}});
  expect(JSON.stringify(view)).not.toMatch(/fee_minor|compensation|source_fee_agreement|payer_account_id|allocation_id/);
  const newSeat=await getEnrollment(f.learner,reviewed.new_enrollment_id as string);
  expect(newSeat).toMatchObject({is_provisional:false,transfer_link:{proposal_id:reviewed.proposal_id,role:'destination'},funding:{eligible:false,reason:'TRANSFER_PENDING'}});
  expect((await f.learner.rpc('accept_quote',{p_quote_id:newSeat.quote!.quote_id,p_quote_hash:newSeat.quote!.quote_hash,p_expected_version:1,p_idempotency_key:randomUUID()})).error?.message).toBe('STATE_CONFLICT');
  const learnerAccept={p_proposal_id:reviewed.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:view.version,p_idempotency_key:randomUUID()};
  await f.rpc('accept_operation_proposal',learnerAccept,f.learner);
  const teacher=await getEnrollmentTransferProposal(f.tutor,reviewed.proposal_id as string,{view:'tutor'});
  expect(teacher).toMatchObject({can_accept:true,source_teaching_terms:{old_fee_minor:25000,reviewed_fee_minor:10000}});
  expect(JSON.stringify(teacher)).not.toMatch(/destination_fee|allocation_id|payer_account/);
  await f.rpc('accept_operation_proposal',{p_proposal_id:reviewed.proposal_id,p_terms_hash:teacher.terms_hash,p_expected_version:teacher.version,p_idempotency_key:randomUUID()},f.tutor);
  const admin=await getEnrollmentTransferProposal(f.admin,reviewed.proposal_id as string,{view:'admin'});
  await f.rpc('approve_operation_proposal',{p_proposal_id:reviewed.proposal_id,p_terms_hash:admin.terms_hash,p_decision:'approved',p_reason:'Exact source and destination consent',p_expected_version:admin.version,p_idempotency_key:randomUUID()});
  const consentId=(await f.database.query('select id from app_private.enrollment_transfer_consents where proposal_id=$1',[reviewed.proposal_id])).rows[0].id;
  const intent=await getEnrollmentTransferConsent(f.learner,consentId);
  expect(intent).toMatchObject({state:'awaiting_acceptance',carryover_minor:50000,can_accept:true});
  expect(JSON.stringify(intent)).not.toMatch(/learner_id|display_name|fee_minor|allocation_id/);
  expect((await f.admin.rpc('accept_enrollment_transfer_consent',{p_consent_id:consentId,p_terms_hash:intent.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()})).error?.message).toBe('NOT_FOUND');
  expect((await listMyEnrollmentTransferConsents(f.learner,{state:'awaiting_acceptance',limit:100})).items.some(item=>item.consent_id===consentId)).toBe(true);
  const apply={p_enrollment_id:sourceId,p_destination_occurrence_id:destination.occurrence_id,p_accepted_proposal_id:reviewed.proposal_id,p_expected_version:version,p_idempotency_key:randomUUID()};
  expect((await f.admin.rpc('transfer_enrollment',apply)).error?.message).toBe('CONSENT_REQUIRED');
  const payerAccept={p_consent_id:consentId,p_terms_hash:intent.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()};
  const accepted=await f.rpc('accept_enrollment_transfer_consent',payerAccept,f.learner);expect(await f.rpc('accept_enrollment_transfer_consent',payerAccept,f.learner)).toEqual(accepted);
  expect(await getEnrollmentTransferProposal(f.admin,reviewed.proposal_id as string,{view:'admin'})).toMatchObject({can_apply:true,blockers:[]});
  const committed=await f.rpc('transfer_enrollment',apply);expect(committed).toMatchObject({state:'cancelled',new_enrollment_id:reviewed.new_enrollment_id});
  expect(await f.rpc('transfer_enrollment',apply)).toEqual(committed);
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[paid.chargeId])).rows[0].data).toMatchObject({commercial_net_minor:0,allocated_cash_minor:0,receivable_minor:0});
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[intent.destination_charge_id])).rows[0].data).toMatchObject({commercial_net_minor:50000,allocated_cash_minor:50000,receivable_minor:0});
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[paid.transferId])).rows[0].data).toMatchObject({gross_settled_minor:50000,net_allocated_minor:50000,available_minor:0});
  expect(await getEnrollment(f.learner,reviewed.new_enrollment_id as string)).toMatchObject({state:'confirmed',transfer_link:{stage:'committed'}});
  expect(await getEnrollmentTransferProposal(f.learner,reviewed.proposal_id as string,{view:'customer'})).toMatchObject({funding:{posted_additional_minor:0,accepted_carryover_minor:50000,additional_required_minor:0,can_receive_additional_payment:false}});
  expect((await f.database.query('select count(*)::int n from finance_private.payment_allocations where enrollment_transfer_consent_id=$1',[consentId])).rows[0].n).toBe(1);
  expect((await f.database.query('select acceptance_basis,source_terms_hash from app_private.quote_acceptances where quote_id=$1',[reviewed.destination_quote_id])).rows[0]).toEqual({acceptance_basis:'operation_proposal',source_terms_hash:view.terms_hash});
  // A later current schedule must not rewrite the historical terms shown for this committed transfer.
  await f.database.query('begin');
  try{
   await f.database.query("update app_private.occurrences set start_at=start_at+interval '1 hour',end_at=end_at+interval '1 hour' where id=$1",[destination.occurrence_id]);
   const token=(await f.learner.auth.getSession()).data.session!.access_token;
   await f.database.query("select set_config('request.jwt.claims',$1,true)",[Buffer.from(token.split('.')[1],'base64url').toString()]);await f.database.query('set local role authenticated');
   const historical=(await f.database.query("select api.get_enrollment_transfer_proposal($1,'customer',$2) data",[reviewed.proposal_id,f.learnerId])).rows[0].data;
   expect(historical.destination.start_at).toBe(view.destination!.start_at);expect(historical.destination.end_at).toBe(view.destination!.end_at);
  }finally{await f.database.query('rollback');}
  // Lost-ack proposal replay must not turn the committed charge conditional again.
  await f.rpc('accept_operation_proposal',learnerAccept,f.learner);
  expect((await f.database.query('select commitment_state from finance_private.charge_accounts where charge_id=$1',[intent.destination_charge_id])).rows[0].commitment_state).toBe('committed');
 } finally {await f.close();}
},30000);
