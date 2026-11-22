import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect,test,vi } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs, claimWorkerJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { notificationSendHandler } from '../../src/worker/notifications';
import { createLocalEmailAdapter,createResendEmailAdapter } from '../../src/server/providers/email';
import { mkdtemp,readdir,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {calendarFixture} from '../helpers/calendar';

test('notification routing deduplicates real booking recipients and denies unrelated accounts',async()=>{
 const f=await bookingFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 try{await f.availability();const occurrence=await f.occurrence();const enrollment=await f.reserve(occurrence.occurrence_id as string);const event=(await f.database.query("select e.id from app_private.domain_events e where e.aggregate_id=$1 and e.event_type='booking_reserve_enrollment' order by created_at desc limit1".replace('limit1','limit 1'),[enrollment.enrollment_id])).rows[0];expect(event).toBeTruthy();
  await f.database.query('begin');let job;try{await f.database.query("select id from app_private.outbox_jobs where purpose='notifications.route' and event_id<>$1 for update",[event.id]);job=(await claimJobs(worker,'notifications.route',1,60))[0];}finally{await f.database.query('rollback');}expect(job.event_id).toBe(event.id);
  const routed=(await worker.query('select app_private.route_notification_event($1,$2) result',[job.id,job.lease_token])).rows[0].result;expect(routed.created).toBeGreaterThanOrEqual(2);expect((await worker.query('select app_private.route_notification_event($1,$2) result',[job.id,job.lease_token])).rows[0].result.created).toBe(0);
  const own=await f.students[0].rpc('list_my_notifications',{p_limit:100,p_cursor:null});expect(own.error).toBeNull();expect(own.data.items.some((row:{event_id:string})=>row.event_id===event.id)).toBe(true);expect(JSON.stringify(own.data)).not.toMatch(/tutor_fee|compensation|margin|destination|encrypted|provider_message/);
  const unrelated=await f.students[1].rpc('list_my_notifications',{p_limit:100,p_cursor:null});expect(unrelated.data.items.some((row:{event_id:string})=>row.event_id===event.id)).toBe(false);
  const foreignId=own.data.items[0].delivery_id;expect((await f.students[1].rpc('retry_notification',{p_delivery_id:foreignId,p_reason:'Synthetic unauthorized retry',p_idempotency_key:randomUUID()})).error?.message).toBe('FORBIDDEN');
 }finally{await worker.end();await f.close();}
});

test('guardian consent revoked after queuing suppresses the real send and removes in-app visibility',async()=>{
 const f=await calendarFixture(),g=await bookingFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url}),guardian=g.tutor;
 const directory=await mkdtemp(join(tmpdir(),'git-tutor-revoked-notice-'));
 const claim=async(purpose:string,target:string)=>{await f.database.query('begin');try{await f.database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update',[purpose,target]);const jobs=await claimJobs(worker,purpose,1,60);expect(jobs[0]?.id).toBe(target);return jobs[0];}finally{await f.database.query('rollback');}};
 try{
  const contacts=await f.rpc('get_my_verified_contacts',{},guardian),accountId=(await guardian.auth.getUser()).data.user!.id;
  const invitation=await f.rpc('create_guardian_invitation',{p_contact_id:(contacts.items as {contact_id:string}[])[0].contact_id,p_scopes:['booking','notifications'],p_expires_at:new Date(Date.now()+86400000).toISOString(),p_idempotency_key:randomUUID()},f.learner);
  const token=(await f.database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created'and aggregate_id=$1",[invitation.invitation_id])).rows[0].payload.single_use_token;
  const link=await f.rpc('accept_guardian_invitation',{p_invitation_id:invitation.invitation_id,p_single_use_token:token,p_expected_version:1,p_idempotency_key:randomUUID()},guardian);
  const event=randomUUID(),routeId=(await f.database.query("select app_private.enqueue_event($1,'occurrence_rescheduled',$2,$3,'notifications.route') id",[event,f.occurrenceId,JSON.stringify({occurrence_id:f.occurrenceId})])).rows[0].id;
  const route=await claim('notifications.route',routeId);await worker.query('select app_private.route_notification_event($1,$2)',[route.id,route.lease_token]);
  const d=(await f.database.query("select d.id,j.id job_id from app_private.notification_deliveries d join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch'join app_private.outbox_jobs j on j.event_id=e.id where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'",[event,accountId])).rows[0];expect(d).toBeTruthy();
  await f.rpc('revoke_guardian_link',{p_guardian_link_id:link.guardian_link_id,p_expected_version:1,p_reason:'Withdraw queued notification authority',p_idempotency_key:randomUUID()},f.learner);
  expect(await executeLeasedJob(worker,await claim('notifications.send',d.job_id),notificationSendHandler(worker,()=>createLocalEmailAdapter(directory,true),'http://localhost:3000'))).toBe('completed');
  expect((await f.database.query('select state,safe_error_code from app_private.notification_deliveries where id=$1',[d.id])).rows[0]).toEqual({state:'suppressed',safe_error_code:'CURRENT_AUTHORITY_REQUIRED'});expect(await readdir(directory)).toEqual([]);
  const inbox=await guardian.rpc('list_my_notifications',{p_limit:100});expect(inbox.error).toBeNull();expect(inbox.data.items.some((item:{event_id:string})=>item.event_id===event)).toBe(false);
 }finally{await worker.end();await g.close();await f.close();}
},60000);

test('durable email recovers lost acknowledgement, preserves callback order and blocks unsafe resend',async()=>{
 const f=await bookingFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 const claim=async(purpose:string,target:string)=>{await f.database.query('begin');try{await f.database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update',[purpose,target]);const jobs=await claimWorkerJobs(worker,purpose,'fake');expect(jobs).toHaveLength(1);expect(jobs[0].id).toBe(target);return jobs[0];}finally{await f.database.query('rollback');}};
 try{await f.availability();const occurrence=await f.occurrence(),enrollment=await f.reserve(occurrence.occurrence_id as string);
  const source=(await f.database.query("select j.id,e.id event_id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and e.event_type='booking_reserve_enrollment'and j.purpose='notifications.route'",[enrollment.enrollment_id])).rows[0];
  const route=await claim('notifications.route',source.id);await worker.query('select app_private.route_notification_event($1,$2)',[route.id,route.lease_token]);
  const recipient=(await f.students[0].auth.getUser()).data.user!.id;
  const delivery=(await f.database.query("select d.id,j.id job_id from app_private.notification_deliveries d join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch'join app_private.outbox_jobs j on j.event_id=e.id where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'",[source.event_id,recipient])).rows[0];
  await f.database.query("insert into app_private.notification_fake_scenarios(delivery_id,scenario)values($1,'timeout_after_success')",[delivery.id]);
  const directory=await mkdtemp(join(tmpdir(),'git-tutor-delivery-')),handler=notificationSendHandler(worker,scenario=>createLocalEmailAdapter(directory,true,scenario),'http://localhost:3000');
  const untouched = await claim('notifications.send', delivery.job_id);
  await f.database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [untouched.id]);
  const sending = await claim('notifications.send', delivery.job_id);
  expect(sending.requires_reconciliation).toBe(false);
  expect(await executeLeasedJob(worker,sending,handler)).toBe('reconciliation');
  expect((await f.database.query('select dispatch_started from app_private.job_attempts where id=$1', [sending.lease_token])).rows[0].dispatch_started).toBe(true);
  expect((await f.database.query('select state from app_private.notification_deliveries where id=$1',[delivery.id])).rows[0].state).toBe('unknown');
  expect((await f.admin.rpc('retry_notification',{p_delivery_id:delivery.id,p_reason:'Cannot retry uncertain send',p_idempotency_key:randomUUID()})).error?.message).toBe('STATE_CONFLICT');
  const recovery=await f.admin.rpc('reconcile_notification',{p_delivery_id:delivery.id,p_reason:'Reconcile the existing provider identity',p_idempotency_key:randomUUID()});expect(recovery.error).toBeNull();
  expect(await executeLeasedJob(worker,await claim('notifications.send',recovery.data.job_id),handler)).toBe('completed');
  const attempt=(await f.database.query('select * from app_private.notification_attempts where delivery_id=$1',[delivery.id])).rows[0];expect(attempt.state).toBe('sent');expect(await readdir(directory)).toHaveLength(1);const artifact=JSON.parse(await readFile(join(directory,`${attempt.id}.json`),'utf8'));expect(artifact.message.text).not.toMatch(/tutor_fee|compensation|margin|encrypted_identifier/);expect(artifact.message.html).not.toMatch(/tutor_fee|compensation|margin_minor|encrypted_identifier/);
  const callback=randomUUID(),now=new Date().toISOString();const observed=await worker.query('select app_private.record_email_callback($1,$2,$3,$4,$5) result',[attempt.id,attempt.provider_message_id,callback,'delivered',now]);expect(observed.rows[0].result.state).toBe('delivered');
  await worker.query('select app_private.record_email_callback($1,$2,$3,$4,$5)',[attempt.id,attempt.provider_message_id,callback,'delivered',now]);await worker.query('select app_private.record_email_callback($1,$2,$3,$4,$5)',[attempt.id,attempt.provider_message_id,randomUUID(),'sent',now]);expect((await f.database.query('select state from app_private.notification_deliveries where id=$1',[delivery.id])).rows[0].state).toBe('delivered');
  await worker.query('select app_private.record_email_callback($1,$2,$3,$4,$5)',[attempt.id,attempt.provider_message_id,randomUUID(),'bounced',now]);expect((await f.database.query('select count(*)::integer count from app_private.notification_contact_tasks where delivery_id=$1',[delivery.id])).rows[0].count).toBe(1);
 }finally{await worker.end();await f.close();}
});

test.each([
  { outcome: 'failed', code: 'EMAIL_REJECTED', callbackFirst: false, httpStatus: 200 },
  { outcome: 'failed', code: 'EMAIL_REJECTED', callbackFirst: true, httpStatus: 200 },
  { outcome: 'suppressed', code: 'EMAIL_SUPPRESSED', callbackFirst: false, httpStatus: 200 },
  { outcome: 'suppressed', code: 'EMAIL_SUPPRESSED', callbackFirst: true, httpStatus: 503 },
])('retains signed $outcome across worker HTTP $httpStatus with callbackFirst=$callbackFirst', async ({
  outcome, code, callbackFirst, httpStatus,
}) => {
  const f = await bookingFixture();
  const local = loadLocalSupabase();
  const worker = new Pool({ connectionString: local.worker_database_url });
  const callbackWorker = new Pool({ connectionString: local.worker_database_url });
  async function claim(purpose: string, target: string) {
    await f.database.query('begin');
    try {
      await f.database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update', [purpose, target]);
      const jobs = await claimJobs(worker, purpose, 1, 60);
      expect(jobs[0]?.id).toBe(target);
      return jobs[0];
    } finally {
      await f.database.query('rollback');
    }
  }
  try {
    await f.availability();
    const occurrence = await f.occurrence();
    const enrollment = await f.reserve(occurrence.occurrence_id as string);
    const source = (await f.database.query(
      "select j.id,e.id event_id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and e.event_type='booking_reserve_enrollment' and j.purpose='notifications.route'",
      [enrollment.enrollment_id],
    )).rows[0];
    const route = await claim('notifications.route', source.id);
    await worker.query('select app_private.route_notification_event($1,$2)', [route.id, route.lease_token]);
    const delivery = (await f.database.query(
      "select d.id,a.id attempt_id,j.id job_id from app_private.notification_deliveries d join app_private.notification_attempts a on a.delivery_id=d.id join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch' join app_private.outbox_jobs j on j.event_id=e.id where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'",
      [source.event_id, local.actors.learner_a.id],
    )).rows[0];
    const providerId = randomUUID();
    const terminalId = randomUUID();
    const now = new Date().toISOString();
    const callback = (state: string, id = randomUUID()) => callbackWorker.query(
      'select app_private.record_email_callback($1,$2,$3,$4,$5)',
      [delivery.attempt_id, providerId, id, state, now],
    );

    // This callback uses an independent worker connection while the send awaits its HTTP response.
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (callbackFirst) await callback(outcome, terminalId);
      return Response.json(httpStatus === 200 ? { id: providerId } : {}, { status: httpStatus });
    });
    const adapter = createResendEmailAdapter({ api_key: 're_synthetic', from: 'test@example.test' }, fetcher);
    const handler = notificationSendHandler(worker, () => adapter, 'http://localhost:3000');
    expect(await executeLeasedJob(worker, await claim('notifications.send', delivery.job_id), handler)).toBe('completed');
    if (!callbackFirst) await callback(outcome, terminalId);

    await callback(outcome, terminalId);
    await callback('sent');
    expect((await f.database.query(
      'select d.state,d.safe_error_code,a.state attempt_state,a.provider_message_id from app_private.notification_deliveries d join app_private.notification_attempts a on a.delivery_id=d.id where d.id=$1',
      [delivery.id],
    )).rows[0]).toEqual({ state: outcome, safe_error_code: code, attempt_state: outcome, provider_message_id: providerId });
    expect((await f.database.query(
      'select count(*)::integer count from app_private.notification_observations where attempt_id=$1 and outcome=$2',
      [delivery.attempt_id, outcome],
    )).rows[0].count).toBe(1);

    const listed = await f.rpc('list_notification_deliveries', { p_limit: 100, p_state: outcome });
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ delivery_id: delivery.id, can_retry: outcome === 'failed', can_reconcile: false }),
    ]));
    const tasks = (await f.database.query(
      'select t.state,t.contact_id=a.contact_id as matching_contact from app_private.notification_contact_tasks t join app_private.notification_attempts a on a.delivery_id=t.delivery_id where t.delivery_id=$1',
      [delivery.id],
    )).rows;
    expect(tasks).toEqual(outcome === 'suppressed' ? [{ state: 'open', matching_contact: true }] : []);

    const duplicate = (await f.database.query(
      "select app_private.enqueue_event($1,'notification_dispatch',$2,$3,'notifications.send') id",
      [randomUUID(), delivery.id, { delivery_id: delivery.id }],
    )).rows[0].id;
    expect(await executeLeasedJob(worker, await claim('notifications.send', duplicate), handler)).toBe('completed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await f.database.query(
      'select count(*)::integer count from app_private.notification_attempts where delivery_id=$1',
      [delivery.id],
    )).rows[0].count).toBe(1);

    await callback('delivered');
    await callback('failed');
    expect((await f.database.query(
      'select state,safe_error_code from app_private.notification_deliveries where id=$1', [delivery.id],
    )).rows[0]).toEqual({ state: 'delivered', safe_error_code: null });
    await callback('bounced');
    await callback('delivered');
    expect((await f.database.query(
      'select state,safe_error_code from app_private.notification_deliveries where id=$1', [delivery.id],
    )).rows[0]).toEqual({ state: 'bounced', safe_error_code: 'EMAIL_BOUNCED' });
  } finally {
    await Promise.all([worker.end(), callbackWorker.end(), f.close()]);
  }
});
