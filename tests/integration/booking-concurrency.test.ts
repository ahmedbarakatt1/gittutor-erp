import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,test } from 'vitest';
import { bookingFixture,raceBookingCalls } from '../helpers/booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { invokeBookingCommandWithStatus } from '../../src/modules/booking/commands';
import { anonymousClient } from '../helpers/supabase';
import { bookingFixtureIds,seedBooking } from '../../tools/booking-seed';
import { fixtureId } from '../../tools/db-seed';

describe('T04 independent booking foundation on real Supabase',()=>{
  let fixture:Awaited<ReturnType<typeof bookingFixture>>;
  beforeAll(async()=>{fixture=await bookingFixture();});
  afterAll(async()=>{await fixture?.close();});
  beforeEach(async context=>{if(!context.task.name.includes('absent availability')) await fixture.availability();});

  test('an absent availability aggregate has version zero and an authenticated empty schedule',async()=>{
    const result=await fixture.tutor.rpc('get_tutor_availability');
    expect(result.error?.message).toBeUndefined();
    expect(result.data).toMatchObject({tutor_id:fixture.tutorId,version:0,time_zone:'Africa/Cairo',weekly_intervals:[],dated_exceptions:[],committed_occurrence_ids:[]});
    await fixture.availability();
  });

  test('GT-202 foundation independent authenticated connections race the last ordinary group seat',async()=>{
    const occurrence=await fixture.occurrence('group');await fixture.reserve(occurrence.occurrence_id as string);
    const calls=[1,2].map(index=>({client:fixture.students[index],name:'reserve_enrollment',args:{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[index],p_idempotency_key:randomUUID()}}));
    const result=await raceBookingCalls(calls);
    expect(result.filter(row=>row.data)).toHaveLength(1);expect(result.find(row=>row.error)?.error).toBe('CAPACITY_CONFLICT');
    const rows=await fixture.database.query("select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and state='held'",[occurrence.occurrence_id]);expect(rows.rows[0].count).toBe(2);
  });

  test('GT-203 foundation same learner same key returns one seat and changed body is rejected',async()=>{
    const occurrence=await fixture.occurrence(),key=randomUUID();
    const args={p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[0],p_idempotency_key:key};
    const result=await raceBookingCalls([0,1].map(()=>({client:fixture.students[0],name:'reserve_enrollment',args})));
    expect(result.every(row=>!row.error)).toBe(true);expect(result[0].data).toEqual(result[1].data);
    const changed=await fixture.students[0].rpc('reserve_enrollment',{...args,p_occurrence_id:randomUUID()});expect(changed.error).not.toBeNull();
    expect((await fixture.database.query('select count(*)::int as count from app_private.enrollments where occurrence_id=$1',[occurrence.occurrence_id])).rows[0].count).toBe(1);
  });

  test('GT-204 foundation two overlapping tutor occurrences serialize and adjacency remains legal',async()=>{
    const times=fixture.interval();
    const args={p_offer_id:catalogFixtureIds.private_offer,p_tutor_id:fixture.tutorId,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:null};
    const result=await raceBookingCalls([0,1].map(()=>({client:fixture.admin,name:'create_occurrence',args:{...args,p_idempotency_key:randomUUID()}})));
    expect(result.filter(row=>row.data)).toHaveLength(1);expect(result.find(row=>row.error)?.error).toBe('SCHEDULE_CONFLICT');
    await fixture.occurrence('private',{start_at:times.end_at,end_at:new Date(Date.parse(times.end_at)+3600000).toISOString()});
  });

  test('customer quotes exclude compensation and acceptance remains current after capacity-only edits',async()=>{
    const occurrence=await fixture.occurrence('group');const held=await fixture.reserve(occurrence.occurrence_id as string);
    const quote=await fixture.rpc('get_quote',{p_quote_id:held.quote_id},fixture.students[0]);
    expect(JSON.stringify(quote)).not.toMatch(/fee_agreement|fee_minor|compensation|tutor_fee|margin/);
    await fixture.rpc('change_occurrence_capacity',{p_occurrence_id:occurrence.occurrence_id,p_capacity:3,p_reason:'Preserve customer terms',p_expected_version:1,p_idempotency_key:randomUUID()});
    await fixture.rpc('accept_quote',{p_quote_id:held.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()},fixture.students[0]);
    const hidden=await fixture.students[1].rpc('get_quote',{p_quote_id:held.quote_id});expect(hidden.error?.message).toBe('NOT_FOUND');
  });

  test('GT-1609 foundation availability edits preserve scheduled commitments',async()=>{
    const before=await fixture.rpc('get_admin_tutor_availability',{p_tutor_id:fixture.tutorId});
    const result=await fixture.admin.rpc('set_availability',{p_tutor_id:fixture.tutorId,p_weekly_intervals:[],p_dated_exceptions:[],p_reason:'Forbidden removal of commitments',p_expected_version:before.version,p_idempotency_key:randomUUID()});
    expect(result.error?.message).toBe('SCHEDULE_CONFLICT');
    expect(await fixture.rpc('get_admin_tutor_availability',{p_tutor_id:fixture.tutorId})).toEqual(before);
  });

  test('exact fee is immutable and prospective amendment fee cannot replace the current agreement',async()=>{
    const occurrence=await fixture.occurrence('group');
    const args={p_occurrence_id:occurrence.occurrence_id,p_tutor_id:fixture.tutorId,p_fee_minor:45000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.group_pricing,p_target_tier:2,p_purpose:'initial',p_reason:'Exact initial synthetic agreement',p_expected_version:1,p_idempotency_key:randomUUID()};
    const initial=await fixture.rpc('approve_tutor_fee',args);
    await expect(fixture.database.query('update finance_private.tutor_fee_agreements set fee_minor=45001 where id=$1',[initial.fee_agreement_id])).rejects.toThrow('IMMUTABLE_RECORD');
    await fixture.rpc('approve_tutor_fee',{...args,p_fee_minor:62500,p_target_tier:3,p_purpose:'amendment',p_expected_version:initial.version,p_idempotency_key:randomUUID()});
    expect((await fixture.database.query('select current_fee_agreement_id from app_private.occurrences where id=$1',[occurrence.occurrence_id])).rows[0].current_fee_agreement_id).toBe(initial.fee_agreement_id);
    const customer=await fixture.students[0].rpc('list_admin_fee_agreements',{p_occurrence_id:occurrence.occurrence_id});expect(customer.error).not.toBeNull();
  });

  test('confirmation cannot succeed before actual T06 funding exists',async()=>{
    const occurrence=await fixture.occurrence(),held=await fixture.reserve(occurrence.occurrence_id as string);
    const quote=await fixture.rpc('get_quote',{p_quote_id:held.quote_id},fixture.students[0]);
    await fixture.rpc('accept_quote',{p_quote_id:held.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:1,p_idempotency_key:randomUUID()},fixture.students[0]);
    const fee=await fixture.rpc('approve_tutor_fee',{p_occurrence_id:occurrence.occurrence_id,p_tutor_id:fixture.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.private_pricing,p_target_tier:null,p_purpose:'initial',p_reason:'Exact synthetic private fee',p_expected_version:1,p_idempotency_key:randomUUID()});
    const result=await fixture.admin.rpc('confirm_occurrence',{p_occurrence_id:occurrence.occurrence_id,p_expected_version:fee.version,p_idempotency_key:randomUUID()});
    expect(result.error?.message).toBe('DEPENDENCY_UNAVAILABLE');
    const record=await fixture.rpc('get_enrollment',{p_enrollment_id:held.enrollment_id},fixture.students[0]);expect(record.state).toBe('held');expect(record.funding).toMatchObject({integration_state:'awaiting_T06_integration',eligible:false,net_charge_minor:null});
  });

  test('exact occurrence reads resolve beyond the default window and retain actor and offer scope',async()=>{
    const occurrence=await fixture.occurrence('private',fixture.interval(110));
    const admin=await fixture.rpc('list_admin_occurrences',{p_occurrence_id:occurrence.occurrence_id});
    expect((admin.items as {occurrence:{occurrence_id:string}}[]).map(row=>row.occurrence.occurrence_id)).toEqual([occurrence.occurrence_id]);
    const own=await fixture.rpc('list_tutor_occurrences',{p_occurrence_id:occurrence.occurrence_id},fixture.tutor);expect(own.items).toHaveLength(1);
    const customer=await fixture.rpc('list_offer_occurrences',{p_offer_id:catalogFixtureIds.private_offer,p_occurrence_id:occurrence.occurrence_id},fixture.students[0]);expect(customer.items).toHaveLength(1);
    const mismatch=await fixture.rpc('list_offer_occurrences',{p_offer_id:catalogFixtureIds.group2_offer,p_occurrence_id:occurrence.occurrence_id},fixture.students[0]);expect(mismatch.items).toEqual([]);
    const window=await fixture.rpc('list_admin_occurrences',{p_occurrence_id:occurrence.occurrence_id,p_from:new Date().toISOString(),p_to:new Date(Date.now()+86400000).toISOString()});expect(window.items).toEqual([]);
  });

  test('duplicate seats and incompatible prospective fees retain documented transport errors',async()=>{
    const occurrence=await fixture.occurrence('group');await fixture.reserve(occurrence.occurrence_id as string);
    await expect(invokeBookingCommandWithStatus(fixture.students[0],'reserve_enrollment',{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[0],p_idempotency_key:randomUUID()})).rejects.toThrow('STATE_CONFLICT');
    const wrong=await fixture.admin.rpc('approve_tutor_fee',{p_occurrence_id:occurrence.occurrence_id,p_tutor_id:fixture.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.private_pricing,p_target_tier:null,p_purpose:'amendment',p_reason:'Wrong format must reject',p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(wrong.error?.message).toBe('VALIDATION_ERROR');
  });

  test('availability canonical order is stable across an identical-key replay',async()=>{
    const current=await fixture.rpc('get_admin_tutor_availability',{p_tutor_id:fixture.tutorId});
    const args={p_tutor_id:fixture.tutorId,p_weekly_intervals:fixture.weekly,p_dated_exceptions:[],p_reason:'Canonical availability order',p_expected_version:current.version,p_idempotency_key:randomUUID()};
    const first=await fixture.rpc('set_availability',args);
    expect(await fixture.rpc('set_availability',{...args,p_weekly_intervals:[...fixture.weekly].reverse()})).toEqual(first);
  });

  test('prospective fee approval rejects a private pricing bundle for a group occurrence',async()=>{
    const occurrence=await fixture.occurrence('group');
    const wrong=await fixture.admin.rpc('approve_tutor_fee',{p_occurrence_id:occurrence.occurrence_id,p_tutor_id:fixture.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.private_pricing,p_target_tier:null,p_purpose:'amendment',p_reason:'Wrong format must reject',p_expected_version:1,p_idempotency_key:randomUUID()});
    expect(wrong.error?.message).toBe('VALIDATION_ERROR');
  });

  test('direct RPC rejects unknown nested exception fields and preserves the schedule',async()=>{
    const before=await fixture.rpc('get_admin_tutor_availability',{p_tutor_id:fixture.tutorId});
    const result=await fixture.admin.rpc('set_availability',{p_tutor_id:fixture.tutorId,p_weekly_intervals:fixture.weekly,p_dated_exceptions:[{local_date:'2028-01-10',intervals:[{weekday:1,start_local:'10:00',end_local:'12:00'}]}],p_reason:'Malformed exception',p_expected_version:before.version,p_idempotency_key:randomUUID()});
    expect(result.error?.message).toBe('VALIDATION_ERROR');
    expect(await fixture.rpc('get_admin_tutor_availability',{p_tutor_id:fixture.tutorId})).toEqual(before);
  });

  test('GT-1609 foundation a date exception races occurrence creation on a fresh scheduling resource',async()=>{
    const other=await bookingFixture();
    try{
      const availability=await other.availability(),times=other.interval();
      const results=await raceBookingCalls([
        {client:other.admin,name:'set_availability',args:{p_tutor_id:other.tutorId,p_weekly_intervals:other.weekly,p_dated_exceptions:[{local_date:times.start_at.slice(0,10),intervals:[]}],p_reason:'Race time off',p_expected_version:availability.version,p_idempotency_key:randomUUID()}},
        {client:other.admin,name:'create_occurrence',args:{p_offer_id:catalogFixtureIds.private_offer,p_tutor_id:other.tutorId,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:null,p_idempotency_key:randomUUID()}},
      ]);
      expect(results.filter(result=>!result.error)).toHaveLength(1);expect(results.find(result=>result.error)?.error).toBe('SCHEDULE_CONFLICT');
      const reserved=(await other.database.query('select count(*)::int as count from app_private.tutor_reservations where tutor_id=$1 and active',[other.tutorId])).rows[0].count;
      const current=await other.rpc('get_admin_tutor_availability',{p_tutor_id:other.tutorId});
      expect(reserved+(current.dated_exceptions as unknown[]).length).toBe(1);
    }finally{await other.close();}
  });

  test('capacity reduction and ordinary admission serialize without exceeding the new capacity',async()=>{
    const occurrence=await fixture.occurrence('group');await fixture.reserve(occurrence.occurrence_id as string);
    const results=await raceBookingCalls([
      {client:fixture.admin,name:'change_occurrence_capacity',args:{p_occurrence_id:occurrence.occurrence_id,p_capacity:2,p_reason:'Reduce unused physical capacity',p_expected_version:1,p_idempotency_key:randomUUID()}},
      {client:fixture.students[1],name:'reserve_enrollment',args:{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[1],p_idempotency_key:randomUUID()}},
    ]);
    expect(results.every(result=>!result.error)).toBe(true);
    const row=(await fixture.database.query("select o.capacity,(select count(*)::int from app_private.enrollments e where e.occurrence_id=o.id and e.state in('held','confirmed')) as occupied from app_private.occurrences o where o.id=$1",[occurrence.occurrence_id])).rows[0];expect(row).toEqual({capacity:2,occupied:2});
  });

  test('same learner racing different keys obtains only one active enrollment',async()=>{
    const occurrence=await fixture.occurrence('group');
    const results=await raceBookingCalls([0,1].map(()=>({client:fixture.students[0],name:'reserve_enrollment',args:{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[0],p_idempotency_key:randomUUID()}})));
    expect(results.filter(result=>!result.error)).toHaveLength(1);expect(results.find(result=>result.error)?.error).toBe('STATE_CONFLICT');
    expect((await fixture.database.query('select count(*)::int as count from app_private.enrollments where occurrence_id=$1',[occurrence.occurrence_id])).rows[0].count).toBe(1);
  });

  test('revoked assigned tutor disappears from discovery and cannot be reserved or confirmed',async()=>{
    const times=fixture.interval(130),occurrence=await fixture.occurrence('private',times);
    const query={p_offer_id:catalogFixtureIds.private_offer,p_occurrence_id:occurrence.occurrence_id};
    expect((await fixture.rpc('list_offer_occurrences',query,fixture.students[0])).items).toHaveLength(1);
    const grants=(await fixture.database.query("select id,revoked_at from app_private.account_roles where account_id=$1 and role='tutor' and revoked_at is null",[fixture.actor.id])).rows;
    try{
      await fixture.database.query('update app_private.account_roles set revoked_at=now() where id=any($1::uuid[])',[grants.map(row=>row.id)]);
      expect((await fixture.rpc('list_offer_occurrences',query,fixture.students[0])).items).toEqual([]);
      const publicResult=await anonymousClient().rpc('list_public_offers',{p_offer_id:catalogFixtureIds.private_offer,p_from:times.start_at,p_to:times.end_at});
      expect(publicResult.error).toBeNull();
      const offers=publicResult.data.items as {availability:{next_occurrences:{occurrence_id:string}[]}}[];
      expect(offers.flatMap(offer=>offer.availability.next_occurrences).some(item=>item.occurrence_id===occurrence.occurrence_id)).toBe(false);
      expect((await fixture.admin.rpc('confirm_occurrence',{p_occurrence_id:occurrence.occurrence_id,p_expected_version:1,p_idempotency_key:randomUUID()})).error?.message).toBe('FORBIDDEN');
      expect((await fixture.students[0].rpc('reserve_enrollment',{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[0],p_idempotency_key:randomUUID()})).error?.message).toBe('FORBIDDEN');
    }finally{for(const grant of grants) await fixture.database.query('update app_private.account_roles set revoked_at=$2 where id=$1',[grant.id,grant.revoked_at]);}
  });

  test('a group deadline creates one durable formation decision without confirming or cancelling money',async()=>{
    const occurrence=await fixture.occurrence('group');
    const queued=await fixture.database.query("select count(*)::int as count from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='booking.process_due'",[occurrence.occurrence_id]);
    expect(queued.rows[0].count).toBe(1);
    await fixture.database.query("update app_private.occurrences set confirmation_deadline_at=now()-interval '1 second' where id=$1",[occurrence.occurrence_id]);
    await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2)',[occurrence.occurrence_id,`formation:${randomUUID()}`]);
    await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2)',[occurrence.occurrence_id,`formation:${randomUUID()}`]);
    const read=await fixture.rpc('list_admin_occurrences',{p_occurrence_id:occurrence.occurrence_id});
    const record=(read.items as {formation_resolution:unknown;occurrence:{state:string}}[])[0];
    expect(record.formation_resolution).toMatchObject({action:'offer_revised_quote_or_cancel'});expect(record.occurrence.state).toBe('forming');
    expect((await fixture.database.query('select count(*)::int as count from app_private.booking_formation_decisions where occurrence_id=$1',[occurrence.occurrence_id])).rows[0].count).toBe(1);
    expect((await fixture.database.query('select active from app_private.tutor_reservations where occurrence_id=$1',[occurrence.occurrence_id])).rows[0].active).toBe(true);
  });

  test('retired offers reject new direct admission while existing enrollment history stays readable',async()=>{
    const offer=await fixture.rpc('create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:'private',p_duration_minutes:60,p_capacity:1,p_target_tier:null,p_pricing_version_id:catalogFixtureIds.private_pricing,p_policy_version_id:catalogFixtureIds.private_policy,p_idempotency_key:randomUUID()});
    await fixture.rpc('publish_offer',{p_offer_id:offer.resource_id,p_effective_at:new Date().toISOString(),p_expected_version:1,p_idempotency_key:randomUUID()});
    const times=fixture.interval(150);
    const occurrence=await fixture.rpc('create_occurrence',{p_offer_id:offer.resource_id,p_tutor_id:fixture.tutorId,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:null,p_idempotency_key:randomUUID()});
    const historyTimes=fixture.interval(151);
    const historical=await fixture.rpc('create_occurrence',{p_offer_id:offer.resource_id,p_tutor_id:fixture.tutorId,p_start_at:historyTimes.start_at,p_end_at:historyTimes.end_at,p_time_zone:'Africa/Cairo',p_target_tier:null,p_idempotency_key:randomUUID()});
    const held=await fixture.reserve(historical.resource_id as string);
    await fixture.database.query("update app_private.offers set status='retired' where id=$1",[offer.resource_id]);
    const args={p_occurrence_id:occurrence.resource_id,p_learner_id:fixture.learners[0],p_idempotency_key:randomUUID()};
    expect((await fixture.students[0].rpc('reserve_enrollment',args)).error?.message).toBe('NOT_FOUND');
    expect((await fixture.students[0].rpc('join_waitlist',{...args,p_idempotency_key:randomUUID()})).error?.message).toBe('NOT_FOUND');
    expect((await fixture.students[0].rpc('list_offer_occurrences',{p_offer_id:offer.resource_id})).error?.message).toBe('NOT_FOUND');
    expect((await fixture.rpc('get_enrollment',{p_enrollment_id:held.enrollment_id},fixture.students[0])).enrollment_id).toBe(held.enrollment_id);
  });

  test('GT-1604 booking seed is idempotent and never creates a confirmed fixture',async()=>{
    await seedBooking();
    const snapshot=async()=>(await fixture.database.query('select id,state,version,quote_terms_version,start_at,end_at,current_fee_agreement_id from app_private.occurrences where id=any($1::uuid[]) order by id',[Object.values(bookingFixtureIds)])).rows;
    const before=await snapshot();expect(before).toHaveLength(4);expect(before.every(row=>row.state==='forming')).toBe(true);
    const audit=(await fixture.database.query("select count(*)::int as count from app_private.audit_events where action='synthetic_booking_seeded'")).rows[0].count;
    await seedBooking();expect(await snapshot()).toEqual(before);
    expect((await fixture.database.query("select count(*)::int as count from app_private.audit_events where action='synthetic_booking_seeded'")).rows[0].count).toBe(audit);
  });

  test('forming schedule moves reject an elapsed formation cutoff and queue a new valid deadline',async()=>{
    const occurrence=await fixture.occurrence();
    const imminent=new Date(Date.now()+3600000);imminent.setUTCSeconds(0,0);
    await expect(fixture.database.query('select app_private.booking_apply_schedule($1,$2,$3,$4,$5)',[occurrence.occurrence_id,imminent,new Date(imminent.getTime()+3600000),(await fixture.admin.auth.getUser()).data.user!.id,randomUUID()])).rejects.toThrow('WINDOW_CLOSED');
    const moved=fixture.interval(140);
    await fixture.database.query('select app_private.booking_apply_schedule($1,$2,$3,$4,$5)',[occurrence.occurrence_id,moved.start_at,moved.end_at,(await fixture.admin.auth.getUser()).data.user!.id,randomUUID()]);
    const jobs=await fixture.database.query("select count(*)::int as count from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id join app_private.occurrences o on o.id=e.aggregate_id where o.id=$1 and j.purpose='booking.process_due' and j.available_at=o.confirmation_deadline_at",[occurrence.occurrence_id]);
    expect(jobs.rows[0].count).toBe(1);
  });

  test('eligible queue priority prevents direct admission and fills two vacancies in separate due runs',async()=>{
    const occurrence=await fixture.occurrence('group');
    const first=await fixture.rpc('join_waitlist',{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[0],p_idempotency_key:randomUUID()},fixture.students[0]);
    const second=await fixture.rpc('join_waitlist',{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[1],p_idempotency_key:randomUUID()},fixture.students[1]);
    const direct=await fixture.students[2].rpc('reserve_enrollment',{p_occurrence_id:occurrence.occurrence_id,p_learner_id:fixture.learners[2],p_idempotency_key:randomUUID()});expect(direct.error?.message).toBe('CAPACITY_CONFLICT');
    const run=(await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2) as result',[occurrence.occurrence_id,`priority:${randomUUID()}`])).rows[0].result;
    expect(run.promoted_waitlist_entry_id).toBe(first.waitlist_entry_id);expect(Date.parse(run.next_due_at)).toBeLessThanOrEqual(Date.now()+1000);
    const next=(await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2) as result',[occurrence.occurrence_id,`priority:${randomUUID()}`])).rows[0].result;
    expect(next.promoted_waitlist_entry_id).toBe(second.waitlist_entry_id);
    expect((await fixture.database.query("select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and state='held' and hold_expires_at>now()",[occurrence.occurrence_id])).rows[0].count).toBe(2);
  });
});
