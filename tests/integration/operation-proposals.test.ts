import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { authClient } from '../helpers/supabase';
import { proposalFixture } from '../helpers/proposal-fixtures';
import { invokeBookingCommandWithStatus } from '../../src/modules/booking/commands';
import { getEnrollment, getOperationProposal } from '../../src/modules/booking/queries';

test('T04 operation commands exist and fail closed for a missing scoped target', async()=>{
  const client=await authClient('admin_a');
  try{
    const response=await client.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:randomUUID(),p_requested_terms:{target_type:'occurrence',start_at:'2027-01-20T10:00:00Z',end_at:'2027-01-20T11:00:00Z',time_zone:'Africa/Cairo',expires_at:'2027-01-19T10:00:00Z'},p_reason:'Synthetic missing target regression',p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(response.error?.message).toBe('NOT_FOUND');
  }finally{await client.auth.signOut({scope:'local'})}
});

describe('T04 actual scoped operation proposal lifecycle',()=>{
  let fixture:Awaited<ReturnType<typeof proposalFixture>>;
  beforeAll(async()=>{fixture=await proposalFixture()},120000);
  afterAll(async()=>{await fixture?.close()});
  async function reschedule(occ:Awaited<ReturnType<typeof fixture.occurrence>>){
    const start=new Date(Date.parse(occ.start)+86400000).toISOString(),end=new Date(Date.parse(occ.end)+86400000).toISOString();
    const args={p_kind:'reschedule',p_target_id:occ.id,p_requested_terms:{target_type:'occurrence',start_at:start,end_at:end,time_zone:'Africa/Cairo',expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Synthetic schedule request',p_expected_version:occ.version,p_idempotency_key:randomUUID()};
    const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'create_operation_proposal',args);
    expect(created.status).toBe(201);
    expect((await invokeBookingCommandWithStatus(fixture.clients.admin,'create_operation_proposal',args)).status).toBe(200);
    return {id:created.data.resource_id,start,end,args};
  }
  async function accept(id:string,who:string,learnerId?:string){
    const proposal=await getOperationProposal(fixture.clients[who],id,{view:who==='tutor'?'tutor':'customer',...(learnerId?{learner_id:learnerId}:{})});
    expect(proposal.can_accept).toBe(true);
    const args={p_proposal_id:id,p_terms_hash:proposal.terms_hash,p_expected_version:proposal.version,p_idempotency_key:randomUUID()};
    await invokeBookingCommandWithStatus(fixture.clients[who],'accept_operation_proposal',args);return args;
  }
  test('schedule-only acceptance preserves private fees, replaces only the same meeting and retains historical quote evidence',async()=>{
    const occ=await fixture.occurrence(),seat=await fixture.hold(occ.id);
    const before=await getEnrollment(fixture.clients.learner,seat.resource_id as string);
    const proposal=await reschedule(occ);
    const customer=await getOperationProposal(fixture.clients.learner,proposal.id);
    expect(JSON.stringify(customer)).not.toMatch(/fee_minor|fee_agreement|compensation|private_fee|62500/);
    await expect(getOperationProposal(fixture.clients.stranger,proposal.id)).rejects.toThrow('NOT_FOUND');
    await accept(proposal.id,'learner');await accept(proposal.id,'tutor');
    const admin=await getOperationProposal(fixture.clients.admin,proposal.id,{view:'admin'});
    expect(admin.state).toBe('accepted');
    await invokeBookingCommandWithStatus(fixture.clients.admin,'approve_operation_proposal',{p_proposal_id:proposal.id,p_terms_hash:admin.terms_hash,p_decision:'approved',p_reason:'All scoped terms accepted',p_expected_version:admin.version,p_idempotency_key:randomUUID()});
    const applied=await invokeBookingCommandWithStatus(fixture.clients.admin,'reschedule_occurrence',{p_occurrence_id:occ.id,p_start_at:proposal.start,p_end_at:proposal.end,p_time_zone:'Africa/Cairo',p_reason:'Commit accepted schedule',p_accepted_proposal_id:proposal.id,p_expected_version:occ.version,p_idempotency_key:randomUUID()});
    expect(applied.status).toBe(200);
    const after=await getEnrollment(fixture.clients.learner,seat.resource_id as string);
    expect(after.occurrence.occurrence_id).toBe(occ.id);expect(Date.parse(after.occurrence.start_at)).toBe(Date.parse(proposal.start));
    expect(after.quote.quote_id).not.toBe(before.quote.quote_id);expect(after.quote.customer_price_minor).toBe(before.quote.customer_price_minor);
    expect(after.quote.accepted_at).not.toBeNull();expect(after.funding.eligible).toBe(false);
    const original=(await fixture.database.query('select terms_hash from app_private.quotes where id=$1',[before.quote.quote_id])).rows[0];expect(original.terms_hash).toBe(before.quote.quote_hash);
    expect((await getOperationProposal(fixture.clients.admin,proposal.id,{view:'admin'})).state).toBe('committed');
  });
  test('one guardian accepts two distinct learner hashes and revoked scope blocks replay and administrative consumption',async()=>{
    const firstLink=await fixture.link('learner');await fixture.link('sibling');
    const occ=await fixture.occurrence('group');await fixture.hold(occ.id);await fixture.hold(occ.id,'sibling');
    const proposal=await reschedule(occ);
    const first=await getOperationProposal(fixture.clients.guardian,proposal.id,{learner_id:fixture.learnerIds.learner});
    const second=await getOperationProposal(fixture.clients.guardian,proposal.id,{learner_id:fixture.learnerIds.sibling});
    expect(first.terms_hash).not.toBe(second.terms_hash);expect(JSON.stringify(first)).not.toContain(fixture.learnerIds.sibling);
    const replay=await accept(proposal.id,'guardian',fixture.learnerIds.learner);await accept(proposal.id,'guardian',fixture.learnerIds.sibling);await accept(proposal.id,'tutor');
    await fixture.rpc(fixture.clients.learner,'revoke_guardian_link',{p_guardian_link_id:firstLink.guardian_link_id,p_reason:'Withdraw proposal authorization',p_expected_version:1,p_idempotency_key:randomUUID()});
    await expect(invokeBookingCommandWithStatus(fixture.clients.guardian,'accept_operation_proposal',replay)).rejects.toThrow('NOT_FOUND');
    const admin=await getOperationProposal(fixture.clients.admin,proposal.id,{view:'admin'});
    await expect(invokeBookingCommandWithStatus(fixture.clients.admin,'approve_operation_proposal',{p_proposal_id:proposal.id,p_terms_hash:admin.terms_hash,p_decision:'approved',p_reason:'Must recheck revoked party',p_expected_version:admin.version,p_idempotency_key:randomUUID()})).rejects.toThrow('CONSENT_REQUIRED');
  });
  test('unchanged quote terms survive capacity edits but old operation proposals cannot authorize a changed aggregate',async()=>{
    const occ=await fixture.occurrence('group'),seat=await fixture.hold(occ.id),proposal=await reschedule(occ);
    const quote=(await getEnrollment(fixture.clients.learner,seat.resource_id as string)).quote;
    await invokeBookingCommandWithStatus(fixture.clients.admin,'change_occurrence_capacity',{p_occurrence_id:occ.id,p_capacity:3,p_reason:'Safe capacity edit',p_expected_version:occ.version,p_idempotency_key:randomUUID()});
    await expect(invokeBookingCommandWithStatus(fixture.clients.learner,'accept_quote',{p_quote_id:quote.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()})).resolves.toBeTruthy();
    const stale=await getOperationProposal(fixture.clients.learner,proposal.id);expect(stale.can_accept).toBe(false);
    await expect(invokeBookingCommandWithStatus(fixture.clients.learner,'accept_operation_proposal',{p_proposal_id:proposal.id,p_terms_hash:stale.terms_hash,p_expected_version:stale.version,p_idempotency_key:randomUUID()})).rejects.toThrow('VERSION_CONFLICT');
  });
  test('financial remedy proposals are inspectable but cannot collect final consent or mutate funds before T06',async()=>{
    const occ=await fixture.occurrence(),seat=await fixture.hold(occ.id);
    const created=await invokeBookingCommandWithStatus(fixture.clients.learner,'create_operation_proposal',{p_kind:'cancellation_remedy',p_target_id:seat.resource_id,p_requested_terms:{target_type:'enrollment',remedy:'cash_refund',expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Synthetic cancellation review request',p_expected_version:1,p_idempotency_key:randomUUID()});
    const proposal=await getOperationProposal(fixture.clients.learner,created.data.resource_id);
    expect(proposal.can_accept).toBe(false);
    const tutor=await getOperationProposal(fixture.clients.tutor,created.data.resource_id,{view:'tutor'});
    expect(tutor.can_accept).toBe(false);
    if(tutor.view!=='tutor')throw new Error('Missing tutor terms');
    expect(tutor.terms).toMatchObject({fee_minor:null,fee_agreement_id:null,fee_agreement_state:'pending_approval'});
    await expect(invokeBookingCommandWithStatus(fixture.clients.tutor,'accept_operation_proposal',{p_proposal_id:created.data.resource_id,p_terms_hash:tutor.terms_hash,p_expected_version:tutor.version,p_idempotency_key:randomUUID()})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    await expect(invokeBookingCommandWithStatus(fixture.clients.learner,'accept_operation_proposal',{p_proposal_id:created.data.resource_id,p_terms_hash:proposal.terms_hash,p_expected_version:proposal.version,p_idempotency_key:randomUUID()})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    await expect(invokeBookingCommandWithStatus(fixture.clients.learner,'cancel_enrollment',{p_enrollment_id:seat.resource_id,p_reason:'Cannot invent settled remedy',p_remedy_proposal_id:created.data.resource_id,p_expected_version:1,p_idempotency_key:randomUUID()})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect((await getEnrollment(fixture.clients.learner,seat.resource_id as string)).state).toBe('held');
  });
  test('direct RPC rejects unknown nested terms rather than trusting browser validation',async()=>{
    const occ=await fixture.occurrence();
    const response=await fixture.clients.admin.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:occ.id,p_requested_terms:{target_type:'occurrence',start_at:occ.start,end_at:occ.end,time_zone:'Africa/Cairo',expires_at:new Date(Date.now()+600000).toISOString(),fee_minor:62500},p_reason:'Malformed nested authority',p_expected_version:occ.version,p_idempotency_key:randomUUID()});
    expect(response.error?.message).toBe('VALIDATION_ERROR');
  });
  test('forming schedule proposals reject a start whose saved confirmation cutoff has already passed',async()=>{
    const occ=await fixture.occurrence('group');const date=new Date();date.setUTCHours(10,0,0,0);if(date.getTime()<=Date.now())date.setUTCDate(date.getUTCDate()+1);
    const response=await fixture.clients.admin.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:occ.id,p_requested_terms:{target_type:'occurrence',start_at:date.toISOString(),end_at:new Date(date.getTime()+3600000).toISOString(),time_zone:'Africa/Cairo',expires_at:new Date(Date.now()+60000).toISOString()},p_reason:'Formation cutoff must remain actionable',p_expected_version:occ.version,p_idempotency_key:randomUUID()});
    expect(response.error?.message).toBe('WINDOW_CLOSED');
    expect((await fixture.database.query('select count(*)::int as n from app_private.operation_proposals where occurrence_id=$1',[occ.id])).rows[0].n).toBe(0);
  });
  test('cancelling an empty meeting also cancels its waiting queue atomically',async()=>{
    const occ=await fixture.occurrence();
    await invokeBookingCommandWithStatus(fixture.clients.learner,'join_waitlist',{p_occurrence_id:occ.id,p_learner_id:fixture.learnerIds.learner,p_idempotency_key:randomUUID()});
    const args={p_occurrence_id:occ.id,p_reason:'Empty meeting cancelled',p_remedy_proposal_id:null,p_expected_version:occ.version,p_idempotency_key:randomUUID()};
    const cancelled=await invokeBookingCommandWithStatus(fixture.clients.admin,'cancel_occurrence',args);
    expect(cancelled.data).toMatchObject({state:'cancelled',affected_enrollment_ids:[]});
    expect((await invokeBookingCommandWithStatus(fixture.clients.admin,'cancel_occurrence',args)).data).toEqual(cancelled.data);
    expect((await fixture.database.query('select state from app_private.waitlist_entries where occurrence_id=$1',[occ.id])).rows).toEqual([{state:'cancelled'}]);
    expect((await fixture.database.query('select active from app_private.tutor_reservations where occurrence_id=$1',[occ.id])).rows[0].active).toBe(false);
  });
  test('proposal terms and acceptance evidence cannot be rewritten through browser roles or the command owner',async()=>{
    const occ=await fixture.occurrence();await fixture.hold(occ.id);const proposal=await reschedule(occ);await accept(proposal.id,'learner');
    await fixture.database.query('begin');
    try{
      await fixture.database.query('set local role git_tutor_commands');
      await expect(fixture.database.query("update app_private.operation_proposals set requested_terms='{}' where id=$1",[proposal.id])).rejects.toThrow('IMMUTABLE_VERSION');
    }finally{await fixture.database.query('rollback')}
    const privileges=(await fixture.database.query("select has_table_privilege('authenticated','app_private.operation_customer_terms','SELECT') as customer,has_table_privilege('authenticated','finance_private.operation_tutor_terms','SELECT') as tutor,has_function_privilege('authenticated','app_private.booking_proposal_command(text,jsonb,text)','EXECUTE') as dispatcher")).rows[0];
    expect(privileges).toEqual({customer:false,tutor:false,dispatcher:false});
    const acceptance=(await fixture.database.query("select terms_hash from app_private.operation_proposal_acceptances where proposal_id=$1 and participant_type='learner'",[proposal.id])).rows[0];
    expect(acceptance.terms_hash).toBe((await getOperationProposal(fixture.clients.learner,proposal.id)).terms_hash);
  });
  test('an enrollment proposal refreshes the seat version after waiting for the occurrence lock',async()=>{
    const occ=await fixture.occurrence(),seat=await fixture.hold(occ.id);
    await fixture.database.query('begin');await fixture.database.query('select id from app_private.tutors where id=$1 for update',[fixture.tutorId]);
    const request=fixture.clients.learner.rpc('create_operation_proposal',{p_kind:'cancellation_remedy',p_target_id:seat.resource_id,p_requested_terms:{target_type:'enrollment',remedy:'cash_refund',expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Concurrent seat revision',p_expected_version:1,p_idempotency_key:randomUUID()}).then(response=>response);
    try{
      let blocked=0;const deadline=Date.now()+5000;
      while(Date.now()<deadline){blocked=(await fixture.database.query('select count(*)::int as n from pg_stat_activity where pg_backend_pid()=any(pg_blocking_pids(pid))')).rows[0].n;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,25))}
      expect(blocked).toBeGreaterThan(0);
      // This guarded synthetic fixture transaction models the enrollment revision committed by the lock holder.
      await fixture.database.query('update app_private.enrollments set version=version+1 where id=$1',[seat.resource_id]);await fixture.database.query('commit');
    }catch(error){await fixture.database.query('rollback');await request;throw error}
    const response=await request;expect(response.error?.message).toBe('VERSION_CONFLICT');
    expect((await fixture.database.query('select count(*)::int as n from app_private.operation_proposals where target_id=$1',[seat.resource_id])).rows[0].n).toBe(0);
  });
});
