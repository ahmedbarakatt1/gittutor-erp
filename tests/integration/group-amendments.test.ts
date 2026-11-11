import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { proposalFixture } from '../helpers/proposal-fixtures';
import { invokeBookingCommandWithStatus } from '../../src/modules/booking/commands';
import { getEnrollment, getGroupAmendment } from '../../src/modules/booking/queries';
import { authClient } from '../helpers/supabase';

describe('scoped group amendment consent and funding prerequisites',()=>{
  let fixture:Awaited<ReturnType<typeof proposalFixture>>;
  beforeAll(async()=>{fixture=await proposalFixture()},120000);afterAll(async()=>{await fixture?.close()});
  async function prepare(expiryMs=600000){
    const occurrence=await fixture.occurrence('group');const first=await fixture.hold(occurrence.id),second=await fixture.hold(occurrence.id,'sibling');
    const replacement=await fixture.makePolicy('group',3);
    const fee=await invokeBookingCommandWithStatus(fixture.clients.admin,'approve_tutor_fee',{p_occurrence_id:occurrence.id,p_tutor_id:fixture.tutorId,p_fee_minor:62500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:fixture.pricingIds.group,p_target_tier:3,p_purpose:'amendment',p_reason:'Synthetic prospective agreement',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()});
    const args={p_occurrence_id:occurrence.id,p_add_learner_ids:[fixture.learnerIds.stranger],p_remove_enrollment_ids:[],p_target_tier:3,p_fee_agreement_id:(fee.data as {fee_agreement_id:string}).fee_agreement_id,p_replacement_policy_version_id:replacement,p_expires_at:new Date(Date.now()+expiryMs).toISOString(),p_reason:'Synthetic two to three proposal',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()};
    return {occurrence,first,second,args};
  }
  test('accepted revised quotes and exact future fee cannot commit without funding or rewrite the current roster',async()=>{
    const fixtureCase=await prepare();
    const before=await getEnrollment(fixture.clients.learner,fixtureCase.first.resource_id as string);
    const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',fixtureCase.args);
    expect(created.status).toBe(201);const id=created.data.resource_id;
    for(const who of ['learner','sibling','stranger','tutor']){
      const proposal=await getGroupAmendment(fixture.clients[who],id,{view:who==='tutor'?'tutor':'customer'});
      expect(proposal.can_accept).toBe(true);
      if(proposal.view==='customer'){expect(proposal.terms.customer_price_minor).toBe(55000);expect(JSON.stringify(proposal)).not.toMatch(/fee_minor|fee_agreement|compensation|62500/);}
      if(proposal.view==='tutor')expect(proposal.terms.fee_minor).toBe(62500);
      await invokeBookingCommandWithStatus(fixture.clients[who],'accept_group_amendment',{p_amendment_id:id,p_terms_hash:proposal.terms_hash,p_expected_version:proposal.version,p_idempotency_key:randomUUID()});
    }
    const proposed=await getGroupAmendment(fixture.clients.admin,id,{view:'admin'});expect(proposed.state).toBe('accepted');
    await expect(invokeBookingCommandWithStatus(fixture.clients.admin,'commit_group_amendment',{p_amendment_id:id,p_expected_version:proposed.version,p_idempotency_key:randomUUID()})).rejects.toThrow('INSUFFICIENT_FUNDS');
    const after=await getEnrollment(fixture.clients.learner,fixtureCase.first.resource_id as string);expect(after.quote).toEqual(before.quote);
    const row=(await fixture.database.query('select target_tier,current_fee_agreement_id,policy_version_id from app_private.occurrences where id=$1',[fixtureCase.occurrence.id])).rows[0];
    expect(row.target_tier).toBe(2);expect(row.current_fee_agreement_id).toBe(fixtureCase.occurrence.feeId);expect(row.policy_version_id).toBe(fixture.policyIds.group);
  });
  test('declining releases only the proposed additional hold and dual-role customer views remain customer scoped',async()=>{
    const fixtureCase=await prepare();const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',fixtureCase.args);const id=created.data.resource_id;
    await fixture.rpc(fixture.clients.admin,'grant_staff_role',{p_account_id:fixture.accountIds.learner,p_role:'admin',p_reason:'Synthetic dual-role boundary',p_idempotency_key:randomUUID()});
    const own=await getGroupAmendment(fixture.clients.learner,id);expect(own.view).toBe('customer');expect(JSON.stringify(own)).not.toMatch(/fee_minor|62500/);
    await invokeBookingCommandWithStatus(fixture.clients.sibling,'decline_group_amendment',{p_amendment_id:id,p_reason:'Decline revised time and price',p_expected_version:own.version,p_idempotency_key:randomUUID()});
    const rows=(await fixture.database.query('select learner_id,state,hold_kind from app_private.enrollments where occurrence_id=$1',[fixtureCase.occurrence.id])).rows;
    expect(rows.find(row=>row.learner_id===fixture.learnerIds.learner).state).toBe('held');
    expect(rows.find(row=>row.learner_id===fixture.learnerIds.sibling).state).toBe('held');
    expect(rows.find(row=>row.learner_id===fixture.learnerIds.stranger).state).toBe('cancelled');
  });
  test('a real due command expires a short proposal once and releases provisional capacity',async()=>{
    const fixtureCase=await prepare(3000);const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',fixtureCase.args);
    await new Promise(resolve=>setTimeout(resolve,3200));
    const key=randomUUID();const first=await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2) as result',[fixtureCase.occurrence.id,key]);
    const replay=await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2) as result',[fixtureCase.occurrence.id,key]);
    expect(replay.rows).toEqual(first.rows);
    const proposal=await getGroupAmendment(fixture.clients.admin,created.data.resource_id,{view:'admin'});expect(proposal.state).toBe('expired');expect(proposal.can_accept).toBe(false);
    const rows=(await fixture.database.query('select state from app_private.enrollments where occurrence_id=$1 and hold_kind=$2',[fixtureCase.occurrence.id,'amendment'])).rows;
    expect(rows.every(row=>['expired','cancelled'].includes(row.state))).toBe(true);
  });
  test('three to four proposes 50000 customer price and the selected exact fee without changing current 55000 quotes',async()=>{
    const occurrence=await fixture.occurrence('group',3);
    const seats=await Promise.all(['learner','sibling','stranger'].map(name=>fixture.hold(occurrence.id,name)));
    const replacement=await fixture.makePolicy('group',4);
    const fee=await fixture.rpc(fixture.clients.admin,'approve_tutor_fee',{p_occurrence_id:occurrence.id,p_tutor_id:fixture.tutorId,p_fee_minor:72500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:fixture.pricingIds.group,p_target_tier:4,p_purpose:'amendment',p_reason:'Synthetic four-person exact fee',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()});
    const args={p_occurrence_id:occurrence.id,p_add_learner_ids:[fixture.learnerIds.guardian],p_remove_enrollment_ids:[],p_target_tier:4,p_fee_agreement_id:fee.fee_agreement_id,p_replacement_policy_version_id:replacement,p_expires_at:new Date(Date.now()+600000).toISOString(),p_reason:'Three to four review',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()};
    const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',args);
    for(const who of ['learner','sibling','stranger','guardian']){
      const proposal=await getGroupAmendment(fixture.clients[who],created.data.resource_id);
      if(proposal.view!=='customer')throw new Error('Unexpected privileged view');
      expect(proposal.terms.customer_price_minor).toBe(50000);
      expect(proposal.terms.customer_adjustment_minor).toBe(who==='guardian'?50000:-5000);
      expect(JSON.stringify(proposal)).not.toMatch(/72500|fee_minor|compensation/);
    }
    const tutor=await getGroupAmendment(fixture.clients.tutor,created.data.resource_id,{view:'tutor'});
    if(tutor.view!=='tutor')throw new Error('Missing tutor view');expect(tutor.terms.fee_minor).toBe(72500);
    expect((await getEnrollment(fixture.clients.learner,seats[0].resource_id as string)).quote.customer_price_minor).toBe(55000);
    await expect(invokeBookingCommandWithStatus(fixture.clients.tutor,'reserve_enrollment',{p_occurrence_id:occurrence.id,p_learner_id:fixture.learnerIds.tutor,p_idempotency_key:randomUUID()})).rejects.toThrow('CAPACITY_CONFLICT');
  });
  test('replacement proposals cannot overbook provisional capacity even when removing a current member later',async()=>{
    const occurrence=await fixture.occurrence('group',3);const first=await fixture.hold(occurrence.id);await fixture.hold(occurrence.id,'sibling');await fixture.hold(occurrence.id,'stranger');
    const replacement=await fixture.makePolicy('group',4);
    const fee=await fixture.rpc(fixture.clients.admin,'approve_tutor_fee',{p_occurrence_id:occurrence.id,p_tutor_id:fixture.tutorId,p_fee_minor:72500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:fixture.pricingIds.group,p_target_tier:4,p_purpose:'amendment',p_reason:'Capacity regression fee',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()});
    await expect(invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',{p_occurrence_id:occurrence.id,p_add_learner_ids:[fixture.learnerIds.guardian,fixture.learnerIds.tutor],p_remove_enrollment_ids:[first.resource_id],p_target_tier:4,p_fee_agreement_id:fee.fee_agreement_id,p_replacement_policy_version_id:replacement,p_expires_at:new Date(Date.now()+600000).toISOString(),p_reason:'Five physical seats must fail',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()})).rejects.toThrow('CAPACITY_CONFLICT');
    expect((await fixture.database.query('select count(*)::int as n from app_private.enrollments where occurrence_id=$1',[occurrence.id])).rows[0].n).toBe(3);
  });
  test('a changed operational version invalidates the amendment and due processing releases only its extra seat',async()=>{
    const prepared=await prepare();const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',prepared.args);
    await invokeBookingCommandWithStatus(fixture.clients.admin,'change_occurrence_capacity',{p_occurrence_id:prepared.occurrence.id,p_capacity:3,p_reason:'Change invalidates pending aggregate',p_expected_version:prepared.occurrence.version,p_idempotency_key:randomUUID()});
    const stale=await getGroupAmendment(fixture.clients.sibling,created.data.resource_id);expect(stale.can_accept).toBe(false);
    await expect(invokeBookingCommandWithStatus(fixture.clients.sibling,'accept_group_amendment',{p_amendment_id:created.data.resource_id,p_terms_hash:stale.terms_hash,p_expected_version:stale.version,p_idempotency_key:randomUUID()})).rejects.toThrow('VERSION_CONFLICT');
    await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2)',[prepared.occurrence.id,randomUUID()]);
    expect((await getGroupAmendment(fixture.clients.admin,created.data.resource_id,{view:'admin'})).state).toBe('expired');
    expect((await getEnrollment(fixture.clients.sibling,prepared.second.resource_id as string)).state).toBe('held');
  });
  test('a newly reserved ordinary seat invalidates the exact roster fingerprint even when occurrence version is unchanged',async()=>{
    const occurrence=await fixture.occurrence('group');await fixture.hold(occurrence.id);
    const fee=await fixture.rpc(fixture.clients.admin,'approve_tutor_fee',{p_occurrence_id:occurrence.id,p_tutor_id:fixture.tutorId,p_fee_minor:45000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:fixture.pricingIds.group,p_target_tier:2,p_purpose:'amendment',p_reason:'Roster fingerprint scenario',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()});
    const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',{p_occurrence_id:occurrence.id,p_add_learner_ids:[fixture.learnerIds.stranger],p_remove_enrollment_ids:[],p_target_tier:2,p_fee_agreement_id:fee.fee_agreement_id,p_replacement_policy_version_id:fixture.policyIds.group,p_expires_at:new Date(Date.now()+600000).toISOString(),p_reason:'One ordinary and one provisional seat',p_expected_version:occurrence.version,p_idempotency_key:randomUUID()});
    const before=await getGroupAmendment(fixture.clients.stranger,created.data.resource_id);expect(before.can_accept).toBe(true);
    await fixture.hold(occurrence.id,'sibling');
    expect((await fixture.database.query('select version from app_private.occurrences where id=$1',[occurrence.id])).rows[0].version).toBe(occurrence.version);
    await expect(invokeBookingCommandWithStatus(fixture.clients.stranger,'accept_group_amendment',{p_amendment_id:created.data.resource_id,p_terms_hash:before.terms_hash,p_expected_version:before.version,p_idempotency_key:randomUUID()})).rejects.toThrow('VERSION_CONFLICT');
    await expect(getGroupAmendment(fixture.clients.stranger,created.data.resource_id,{view:'admin'})).rejects.toThrow('FORBIDDEN');
  });
  test('a provisional current quote cannot substitute ordinary quote consent for scoped amendment consent',async()=>{
    const prepared=await prepare();const created=await invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',prepared.args);
    const added=(await fixture.database.query('select id,current_quote_id from app_private.enrollments where amendment_id=$1',[created.data.resource_id])).rows[0];
    const quote=(await fixture.database.query('select version,terms_hash from app_private.quotes where id=$1',[added.current_quote_id])).rows[0];
    const response=await fixture.clients.stranger.rpc('accept_quote',{p_quote_id:added.current_quote_id,p_quote_hash:quote.terms_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()});
    expect(response.error?.message).toBe('STATE_CONFLICT');
    expect((await fixture.database.query('select count(*)::int as n from app_private.quote_acceptances where quote_id=$1',[added.current_quote_id])).rows[0].n).toBe(0);
    const enrollment=await getEnrollment(fixture.clients.stranger,added.id);expect(enrollment).toMatchObject({is_provisional:true});
    const proposal=await getGroupAmendment(fixture.clients.stranger,created.data.resource_id);
    await invokeBookingCommandWithStatus(fixture.clients.stranger,'accept_group_amendment',{p_amendment_id:created.data.resource_id,p_terms_hash:proposal.terms_hash,p_expected_version:proposal.version,p_idempotency_key:randomUUID()});
    expect((await fixture.database.query('select terms_hash from app_private.operation_proposal_acceptances where proposal_id=$1 and participant_id=$2',[created.data.resource_id,fixture.learnerIds.stranger])).rows[0].terms_hash).toBe(proposal.terms_hash);
  });
  test('independent authenticated requests serialize one amendment and one extra hold under a tutor row lock',async()=>{
    const prepared=await prepare(),other=await authClient('admin_a');
    await fixture.database.query('begin');await fixture.database.query('select id from app_private.tutors where id=$1 for update',[fixture.tutorId]);
    const attempts=[invokeBookingCommandWithStatus(fixture.clients.admin,'propose_group_amendment',prepared.args),invokeBookingCommandWithStatus(other,'propose_group_amendment',{...prepared.args,p_idempotency_key:randomUUID()})];
    const settled=Promise.allSettled(attempts);
    try{
      let blocked=0;const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        blocked=(await fixture.database.query('with recursive blocked(pid) as (select pid from pg_stat_activity where pg_backend_pid()=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join blocked b on b.pid=any(pg_blocking_pids(a.pid))) select count(distinct pid)::int as n from blocked')).rows[0].n;
        if(blocked>=2)break;await new Promise(resolve=>setTimeout(resolve,25));
      }
      expect(blocked).toBeGreaterThanOrEqual(2);
    }finally{await fixture.database.query('rollback')}
    try{
      const results=await settled;expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
      const failure=results.find(result=>result.status==='rejected');expect(failure?.status==='rejected'&&failure.reason.message).toBe('STATE_CONFLICT');
      expect((await fixture.database.query("select count(*)::int as n from app_private.enrollments where occurrence_id=$1 and hold_kind='amendment'",[prepared.occurrence.id])).rows[0].n).toBe(1);
    }finally{await other.auth.signOut({scope:'local'})}
  });
});
