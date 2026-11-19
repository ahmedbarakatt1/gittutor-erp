import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';
import type { CalendarDesired } from '../../src/server/providers/calendar';

type Grant = { request_id:string; connection_id:string; version:number; credential:string };
type Job = { occurrence:string; id:string; token:string };

/** All production-mode state and synthetic credentials live inside a rolled-back
 * transaction on the marked local database. No adapter or Google client runs. */
export async function exerciseVerifiedCalendarCapacity(db:Client, claims:object) {
  const migration=await readFile('supabase/migrations/20261119173000_calendar_verified_capacity.sql','utf8');
  const backfill=migration.match(/^update app_private\.calendar_events m set legacy_schedule_unknown=true[\s\S]*?;/m)?.[0];
  assert.ok(backfill,'The actual upgrade backfill is part of this regression.');
  const envelope={v:1,alg:'A256GCM',kid:'test',nonce:'A'.repeat(16),tag:'A'.repeat(22),ciphertext:'AA'};
  const obtain=async(email:string):Promise<Grant>=>{
    await db.query('set local role authenticated');
    const {rows:[{r}]}=await db.query('select api.create_calendar_connection_request($1) r',[randomUUID()]);
    await db.query('reset role');
    const credential=randomUUID();
    const {rows:[{result:grant}]}=await db.query('select app_private.record_calendar_organizer($1,$2,$3,$4,$5,$6,$7,$8) result',
      [r.request_id,r.connection_id,credential,email,'primary',envelope,'test',randomUUID()]);
    assert.equal(grant.verification_allowed,true);
    assert.equal(grant.calendar_id,'primary');
    return {...r,version:grant.version,credential};
  };
  const verify=(g:Grant)=>db.query('select app_private.verify_calendar_organizer($1,$2,$3,$4) r',
    [g.request_id,g.connection_id,g.version,g.credential]);
  const reject=async(action:()=>Promise<unknown>,reason:RegExp)=>{
    await db.query('savepoint denied_verification');
    await assert.rejects(action,reason);
    await db.query('rollback to savepoint denied_verification');
  };
  const lease=async(occurrence:string):Promise<Job>=>{
    const {rows:[{id}]}=await db.query(`select app_private.enqueue_event(gen_random_uuid(),'calendar_sync_requested',$1,
      jsonb_build_object('occurrence_id',$1::uuid),'calendar.sync') id`,[occurrence]);
    const token=randomUUID();
    await db.query("update app_private.outbox_jobs set state='leased',lease_token=$2,lease_expires_at=now()+interval '2 minutes' where id=$1",[id,token]);
    return {occurrence,id,token};
  };
  const prepare=async(j:Job)=>(await db.query('select app_private.prepare_calendar_sync($1,$2,$3) r',[j.occurrence,j.id,j.token])).rows[0].r;
  const observe=async(j:Job,d:CalendarDesired,outcome:string,code:string|null=null)=>(await db.query(
    'select app_private.finalize_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8) r',[d.occurrence_id,d.occurrence_version,d.connection_id,
      d.connection_version,d.meeting_generation,j.id,j.token,{provider_event_id:d.provider_event_id,outcome,safe_error_code:code,
        join_url:outcome==='ready'?'https://meet.google.com/xxx-xxxx-xxx':null}])).rows[0].r;
  const wakeCount=async(id:string)=>(await db.query("select count(*)::int n from app_private.domain_events where aggregate_id=$1 and event_type='calendar_connection_changed'",[id])).rows[0].n;
  await db.query('begin');
  try {
    const marker=(await db.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    assert.deepEqual(marker,{environment:'test',fixture_marker:'git-tutor-supabase-local-v1'});
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    // Other tests may have synthetic connected rows. This transaction sees only its own eligible grants.
    await db.query("update app_private.provider_connections set state='revoked' where mode='google' and state='connected'");
    await db.query("update app_private.environment_metadata set environment='production' where singleton");
    const tutor=(await db.query(`select t.id,u.email from app_private.tutors t cross join lateral app_private.auth_account(t.account_id) u
      where app_private.has_role(t.account_id,'tutor') and app_private.payment_verified_account(t.account_id)
      and not exists(select 1 from app_private.provider_connections c where c.mode='google' and lower(c.organizer_email)=lower(u.email)) limit 1`)).rows[0];
    const slot=async(days:number)=>{
      const {rows:[{id}]}=await db.query(`insert into app_private.occurrences
        (id,offer_id,tutor_id,format,capacity,duration_minutes,start_at,end_at,time_zone,
        policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at,state)
        select gen_random_uuid(),offer_id,$1,'private',1,60,'2074-04-10 10:00Z'::timestamptz+make_interval(days=>$2),
          '2074-04-10 11:00Z'::timestamptz+make_interval(days=>$2),time_zone,policy_version_id,pricing_version_id,
          availability_version,'2074-03-01Z'::timestamptz,'confirmed' from app_private.occurrences limit 1 returning id`,[tutor.id,days]);
      return id as string;
    };
    const id=await slot(0);
    const unverified=await obtain(tutor.email);
    const approved=await obtain(`approved.${randomUUID()}@example.test`);
    const initialJob=await lease(id);
    assert.equal((await prepare(initialJob)).reason,'CALENDAR_CONNECTION_REQUIRED');
    assert.equal(await wakeCount(id),0);
    await reject(()=>verify({...approved,version:approved.version+1}),/VERSION_CONFLICT/);
    await reject(()=>verify({...approved,credential:unverified.credential}),/VERSION_CONFLICT/);
    await reject(()=>verify({...approved,request_id:unverified.request_id}),/AUTH_REQUIRED/);
    await reject(async()=>{
      await db.query('set local role authenticated');
      return verify(approved);
    },/permission denied/);
    await db.query('savepoint revoked_admin');
    await db.query("update app_private.account_roles set revoked_at=now() where role='admin' and account_id=$1 and revoked_at is null",[(claims as {sub:string}).sub]);
    await reject(()=>verify(approved),/FORBIDDEN/);
    await db.query('rollback to savepoint revoked_admin');
    const audit=async()=>(await db.query("select count(*)::int n from app_private.audit_events where aggregate_id=$1 and action='calendar_organizer_verified'",[approved.connection_id])).rows[0].n;
    assert.equal((await verify(approved)).rows[0].r.integration_state,'verified');
    assert.equal(await wakeCount(id),1);
    assert.equal(await audit(),1);
    await verify(approved);
    assert.equal(await audit(),1);
    assert.equal(await wakeCount(id),1);
    const desired=(await prepare(initialJob)).desired as CalendarDesired;
    assert.equal(desired.connection_id,approved.connection_id);
    // First create is still in flight. No negative lookup, including an older
    // worker's unqualified "revoked", permits reuse of the organizer.
    await db.query("update app_private.occurrences set state='cancelled',version=version+1 where id=$1",[id]);
    const nextSlot=await slot(0), waiting=await lease(nextSlot);
    for(const seen of ['absent','revoked']){
      const cancel=await lease(id), d=(await prepare(cancel)).desired;
      assert.equal((await observe(cancel,d,seen)).outcome,'absent');
      assert.equal((await prepare(waiting)).reason,'CALENDAR_ORGANIZER_CAPACITY');
    }
    assert.equal((await observe(initialJob,desired,'ready')).applied,false);
    const deletion=await lease(id);
    assert.equal((await observe(deletion,(await prepare(deletion)).desired,'revoked','CALENDAR_DELETION_CONFIRMED')).applied,true);
    const nextRoom=(await prepare(waiting)).desired;
    assert.equal(nextRoom.connection_id,approved.connection_id);
    await observe(waiting,nextRoom,'ready');

    const oldRoom=await slot(6), stale=await lease(oldRoom), historical=(await prepare(stale)).desired;
    await observe(stale,historical,'ready');
    await db.query("update app_private.occurrences set start_at=start_at+interval '30 days',end_at=end_at+interval '30 days',version=version+1 where id=$1",[oldRoom]);
    // Reproduce the deployed pool migration's old-current-time-only backfill.
    await db.query(`update app_private.calendar_events m set reserved_slots=tstzmultirange(tstzrange(o.start_at,o.end_at,'[)'))
      from app_private.occurrences o where m.occurrence_id=$1 and o.id=m.occurrence_id`,[oldRoom]);
    await db.query(backfill);
    const oldInterval=await lease(await slot(6));
    assert.equal((await prepare(oldInterval)).reason,'CALENDAR_ORGANIZER_CAPACITY');
    const reconciliation=await lease(oldRoom);
    const d=(await prepare(reconciliation)).desired;
    assert.equal(d.connection_id,approved.connection_id);
    assert.equal(d.provider_event_id,historical.provider_event_id);
    await observe(reconciliation,d,'ready');
    assert.equal((await prepare(oldInterval)).desired.connection_id,approved.connection_id);
  } finally { await db.query('rollback'); }
}
