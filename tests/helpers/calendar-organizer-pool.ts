import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import type { Client, Pool } from 'pg';
import type { CalendarDesired } from '../../src/server/providers/calendar';

type Job = { occurrence: string; id: string; token: string };
type Prepared = { state: 'ready'; desired: CalendarDesired } | { state:'suppressed'; reason:string };
type Connection = { connection_id:string; version:number };

export async function exerciseCalendarOrganizerPool(db:Client, worker:Pool, claims:object, source:string, tutors:{id:string;email:string}[]) {
  const actorQuery = async (query:string, values:unknown[] = []) => {
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
      await db.query('set local role authenticated');
      const result = await db.query(query,values);
      await db.query('commit');
      return result.rows[0].r;
    } catch (error) { await db.query('rollback'); throw error; }
  };
  const add = (key:string):Promise<Connection> => actorQuery('select api.add_fake_calendar_organizer($1) r',[key]);
  const revoke = (c:Connection) => actorQuery('select api.revoke_calendar_connection($1,$2,$3) r',[c.connection_id,c.version,randomUUID()]);
  assert.equal(tutors.length,2);
  const start = new Date(Date.UTC(2080,0,1) + randomInt(0,3650*86400)*1000);
  const end = new Date(+start+3600000);
  const makeSlot = async (index:number, shift=0) => {
    const occurrence = randomUUID();
    await db.query(`insert into app_private.occurrences
      (id,offer_id,tutor_id,format,capacity,duration_minutes,start_at,end_at,time_zone,
       policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at,state)
      select $1,offer_id,$2,'private',1,60,$3,$4,time_zone,policy_version_id,pricing_version_id,
        availability_version,$3::timestamptz-interval '1 day','confirmed'
      from app_private.occurrences where id=$5`,[occurrence,tutors[index%2].id,new Date(+start+shift),new Date(+end+shift),source]);
    return occurrence;
  };
  const lease = async (occurrence:string):Promise<Job> => {
    const {rows} = await db.query(`select app_private.enqueue_event(gen_random_uuid(),'calendar_sync_requested',$1,
      jsonb_build_object('occurrence_id',$1::uuid),'calendar.sync') id`,[occurrence]);
    const token = randomUUID();
    await db.query("update app_private.outbox_jobs set state='leased',lease_token=$2,lease_expires_at=now()+interval '2 minutes' where id=$1",[rows[0].id,token]);
    return {occurrence,id:rows[0].id,token};
  };
  const prepare = async (job:Job):Promise<Prepared> => (await worker.query('select app_private.prepare_calendar_sync($1,$2,$3) r',[job.occurrence,job.id,job.token])).rows[0].r;
  const desired = (p:Prepared):CalendarDesired => { assert.equal(p.state,'ready'); return p.desired; };
  const observe = async (job:Job,d:CalendarDesired, result:'ready'|'unknown'|'revoked') =>
    (await worker.query('select app_private.finalize_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8) r',[
      d.occurrence_id,d.occurrence_version,d.connection_id,d.connection_version,d.meeting_generation,job.id,job.token,
      {outcome:result,provider_event_id:d.provider_event_id,join_url:result==='ready'?`https://meet.example.test/${d.occurrence_id}/${d.meeting_generation}`:null},
    ])).rows[0].r;
  const view = (id:string) => actorQuery("select api.get_occurrence_meeting($1,'admin') r",[id]);

  const key=randomUUID();
  const first=await add(key), second=await add(randomUUID());
  try {
    assert.deepEqual(await add(key),first);
    // Synthetic organizer identities reflect the two tutors' verified logins.
    await db.query("update app_private.provider_connections set organizer_email=$2 where id=$1 and mode='fake'",[first.connection_id,tutors[0].email]);
    await db.query("update app_private.provider_connections set organizer_email=$2 where id=$1 and mode='fake'",[second.connection_id,tutors[1].email]);
    const rows=await actorQuery('select api.list_calendar_connections() r');
    assert.ok(rows.some((c:Connection)=>c.connection_id===first.connection_id));
    assert.doesNotMatch(JSON.stringify(rows),/"(?:encrypted_credentials|credential_version|google_subject|calendar_id|organizer_email)"/);
    const count=(await db.query(`select count(*)::int n from app_private.provider_connections pc where pc.mode='fake' and pc.state='connected'
      and app_private.has_role(pc.approved_by,'admin') and app_private.payment_verified_account(pc.approved_by)`)).rows[0].n;
    const jobs:Job[]=[];
    for(let i=0;i<count;i++) jobs.push(await lease(await makeSlot(i)));
    // Explicit independent PostgreSQL sessions, with both transactions open
    // before either asks for its assignment.
    const clients=await Promise.all([worker.connect(),worker.connect()]);
    let pair:CalendarDesired[];
    try {
      await Promise.all(clients.map(client=>client.query('begin')));
      pair=await Promise.all(clients.map(async(client,i)=>{
        const job=jobs[i];
        const prepared=await client.query('select app_private.prepare_calendar_sync($1,$2,$3) r',[job.occurrence,job.id,job.token]);
        await client.query('commit');
        return desired(prepared.rows[0].r);
      }));
    } finally { await Promise.all(clients.map(async client=>{try {await client.query('rollback');} finally {client.release();}})); }
    assert.deepEqual(pair.map(d=>d.connection_id),[first.connection_id,second.connection_id]);
    await Promise.all(pair.map((d,i)=>observe(jobs[i],d,'ready')));
    const all=[...pair,...await Promise.all(jobs.slice(2).map(async j=>desired(await prepare(j))))];
    assert.equal(new Set(all.map(d=>d.connection_id)).size,count);
    assert.equal(new Set(all.map(d=>d.provider_event_id)).size,count);
    assert.equal(new Set(all.map(d=>d.conference_request_id)).size,count);
    assert.equal((await view(jobs[0].occurrence)).can_join,true);
    const retry=desired(await prepare(await lease(jobs[0].occurrence)));
    assert.deepEqual(retry,pair[0]);
    await assert.rejects(prepare({...jobs[0],token:randomUUID()}),/LEASE_LOST/);
    await assert.rejects(observe(jobs[1],{...pair[1],connection_id:first.connection_id},'ready'),/STATE_CONFLICT/);

    const overflow=await lease(await makeSlot(1,1800000));
    assert.deepEqual(await prepare(overflow),{state:'suppressed',reason:'CALENDAR_ORGANIZER_CAPACITY'});
    assert.equal((await view(overflow.occurrence)).reason,'CALENDAR_ORGANIZER_CAPACITY');
    await assert.rejects(actorQuery("select api.get_meeting_access($1,'admin') r",[overflow.occurrence]),/STATE_CONFLICT/);

    // Adjacent half-open intervals share one organizer. An in-flight move into
    // the existing booking's time must keep the established room pinned.
    const adjacent=await lease(await makeSlot(0,3600000));
    const original=desired(await prepare(adjacent));
    assert.equal(original.connection_id,first.connection_id);
    await db.query("update app_private.occurrences set start_at=start_at-interval '30 minutes',end_at=end_at-interval '30 minutes',version=version+1 where id=$1",[adjacent.occurrence]);
    const moved=await lease(adjacent.occurrence);
    assert.equal((await prepare(moved)).state,'suppressed');
    assert.equal((await observe(adjacent,original,'ready')).applied,false);
    await db.query("update app_private.occurrences set state='cancelled',version=version+1 where id=$1",[jobs[0].occurrence]);
    const cancelledJob=await lease(jobs[0].occurrence);
    const cancelled=desired(await prepare(cancelledJob));
    assert.equal(cancelled.action,'cancel');
    assert.equal(cancelled.connection_id,first.connection_id);
    await observe(cancelledJob,cancelled,'unknown');
    assert.equal((await prepare(moved)).state,'suppressed');
    const confirmedDelete=await lease(cancelledJob.occurrence);
    await observe(confirmedDelete,desired(await prepare(confirmedDelete)),'revoked');
    assert.ok((await db.query(`select 1 from app_private.outbox_jobs j join app_private.domain_events e on j.event_id=e.id
      where e.aggregate_id=$1 and j.state='pending' and j.purpose='calendar.sync'`,[moved.occurrence])).rowCount);
    const rescheduled=desired(await prepare(moved));
    assert.equal(rescheduled.connection_id,original.connection_id);
    assert.equal(rescheduled.provider_event_id,original.provider_event_id);
    await observe(moved,rescheduled,'ready');
    await revoke(first);
    assert.equal((await view(adjacent.occurrence)).can_join,false);
    assert.equal((await view(jobs[1].occurrence)).can_join,true);
  } finally {
    for(const c of [first,second]) {
      const row=(await db.query('select state,version from app_private.provider_connections where id=$1',[c.connection_id])).rows[0];
      if(row.state==='connected')await revoke({...c,version:row.version});
    }
  }
}
