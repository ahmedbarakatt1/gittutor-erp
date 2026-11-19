import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';

/** Runs in the caller's rollback-only transaction. No provider or real attendee is contacted. */
export async function exerciseCalendarBookingPilot(db: Client, sourceId: string, learner: string, tutor: string, account: string, grant: string, learnerClaims: object, anotherGrant?: string) {
  const occurrence = randomUUID();
  await db.query(`insert into app_private.occurrences
    (id,offer_id,tutor_id,format,capacity,duration_minutes,start_at,end_at,time_zone,policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at)
    select $1,offer_id,$2,'private',1,90,now()+interval '6 days',now()+interval '6 days 90 minutes',time_zone,
      policy_version_id,pricing_version_id,availability_version,now()+interval '5 days'
    from app_private.occurrences where id=$3`, [occurrence,tutor,sourceId]);
  await db.query(`insert into app_private.calendar_booking_pilots
      (occurrence_id,learner_id,tutor_id,connection_id,connection_version,start_at,end_at,tutor_google_email)
    select o.id,$2,o.tutor_id,c.id,c.version,o.start_at,o.end_at,'pilot-tutor@example.test'
    from app_private.occurrences o cross join app_private.provider_connections c where o.id=$1 and c.id=$3`, [occurrence,learner,grant]);
  const modes = async (id: string) => (await db.query(`select distinct pc.mode from app_private.provider_connections pc
    where app_private.calendar_connection_in_scope(pc,$1) order by pc.mode`, [id])).rows.map(row => row.mode);
  assert.deepEqual(await modes(sourceId), ['fake']);
  assert.deepEqual(await modes(occurrence), []);
  const unrelated = (await db.query('select id from app_private.learners where id<>$1 limit 1',[learner])).rows[0].id;
  for (const sql of [
    'insert into app_private.enrollments (occurrence_id,learner_id,booker_account_id) values ($1,$2,$3)',
    'insert into app_private.waitlist_entries (occurrence_id,learner_id,requested_by) values ($1,$2,$3)',
  ]) {
    await db.query('savepoint rejected_roster');
    await assert.rejects(db.query(sql,[occurrence,unrelated,account]), /NOT_FOUND/);
    await db.query('rollback to savepoint rejected_roster');
  }
  await db.query("insert into app_private.enrollments (occurrence_id,learner_id,booker_account_id,state) values ($1,$2,$3,'confirmed')",[occurrence,learner,account]);
  await db.query("update app_private.occurrences set state='confirmed' where id=$1",[occurrence]);
  assert.deepEqual(await modes(occurrence), ['google']);
  const job = (await db.query("select app_private.enqueue_event(gen_random_uuid(),'calendar_sync_requested',$1,jsonb_build_object('occurrence_id',$1::uuid),'calendar.sync') id",[occurrence])).rows[0].id;
  const lease = randomUUID();
  await db.query("update app_private.outbox_jobs set state='leased',lease_token=$2,lease_expires_at=now()+interval '1 minute' where id=$1",[job,lease]);
  const ready = (await db.query('select app_private.prepare_calendar_sync($1,$2,$3) r',[occurrence,job,lease])).rows[0].r;
  assert.equal(ready.mode,'google');
  assert.equal(ready.desired.tutor_email,'pilot-tutor@example.test');
  assert.equal(ready.desired.connection_id,grant);
  assert.equal(ready.desired.occurrence_id,occurrence);
  assert.equal((await db.query("select (app_private.get_calendar_credentials($1,$2,$3,$4)->>'connection_id')=$1::text ok",
    [grant,ready.desired.connection_version,job,lease])).rows[0].ok,true);
  if (anotherGrant) {
    await db.query('savepoint denied_cross_account');
    await assert.rejects(db.query('select app_private.get_calendar_credentials($1,1,$2,$3)',[anotherGrant,job,lease]),/STATE_CONFLICT/);
    await db.query('rollback to savepoint denied_cross_account');
  }
  const observed = {outcome:'ready',provider_event_id:ready.desired.provider_event_id,join_url:'https://meet.google.com/xxx-xxxx-xxx'};
  const result = await db.query('select app_private.finalize_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8) r',
    [occurrence,ready.desired.occurrence_version,grant,ready.desired.connection_version,ready.desired.meeting_generation,job,lease,observed]);
  assert.equal(result.rows[0].r.applied,true);
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(learnerClaims)]);
  const view = (await db.query("select api.get_occurrence_meeting($1,'customer',$2) r",[occurrence,learner])).rows[0].r;
  assert.equal(view.can_join,true);
  assert.equal(view.integration_state,'verified');
  assert.equal(view.join_url,undefined);
  assert.equal((await db.query("select api.get_meeting_access($1,'customer',$2)->>'join_url' url",[occurrence,learner])).rows[0].url,observed.join_url);
  await db.query('savepoint denied_join');
  await assert.rejects(db.query("select api.get_meeting_access($1,'customer',$2)",[occurrence,unrelated]),/NOT_FOUND|FORBIDDEN/);
  await db.query('rollback to savepoint denied_join');
  await db.query('reset role');
  await db.query('savepoint reschedule');
  await db.query("update app_private.occurrences set start_at=start_at+interval '1 minute' where id=$1",[occurrence]);
  assert.deepEqual(await modes(occurrence), []);
  await db.query('rollback to savepoint reschedule');
  await db.query("update app_private.enrollments set state='cancelled' where occurrence_id=$1",[occurrence]);
  assert.deepEqual(await modes(occurrence), []);
  await db.query("update app_private.occurrences set state='cancelled' where id=$1",[occurrence]);
  assert.deepEqual(await modes(occurrence), ['google']);
  await db.query("update app_private.provider_connections set state='revoked' where id=$1",[grant]);
  assert.deepEqual(await modes(occurrence), []);
  assert.deepEqual(await modes(sourceId), ['fake']);
}
