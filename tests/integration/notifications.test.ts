import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect,test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { notificationSendHandler } from '../../src/worker/notifications';
import { createLocalEmailAdapter } from '../../src/server/providers/email';
import { mkdtemp,readdir,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('durable email recovers lost acknowledgement, preserves callback order and blocks unsafe resend',async()=>{
 const f=await bookingFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 const claim=async(purpose:string,target:string)=>{await f.database.query('begin');try{await f.database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update',[purpose,target]);const jobs=await claimJobs(worker,purpose,1,60);expect(jobs).toHaveLength(1);expect(jobs[0].id).toBe(target);return jobs[0];}finally{await f.database.query('rollback');}};
 try{await f.availability();const occurrence=await f.occurrence(),enrollment=await f.reserve(occurrence.occurrence_id as string);
  const source=(await f.database.query("select j.id,e.id event_id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and e.event_type='booking_reserve_enrollment'and j.purpose='notifications.route'",[enrollment.enrollment_id])).rows[0];
  const route=await claim('notifications.route',source.id);await worker.query('select app_private.route_notification_event($1,$2)',[route.id,route.lease_token]);
  const recipient=(await f.students[0].auth.getUser()).data.user!.id;
  const delivery=(await f.database.query("select d.id,j.id job_id from app_private.notification_deliveries d join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch'join app_private.outbox_jobs j on j.event_id=e.id where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'",[source.event_id,recipient])).rows[0];
  await f.database.query("insert into app_private.notification_fake_scenarios(delivery_id,scenario)values($1,'timeout_after_success')",[delivery.id]);
  const directory=await mkdtemp(join(tmpdir(),'git-tutor-delivery-')),handler=notificationSendHandler(worker,scenario=>createLocalEmailAdapter(directory,true,scenario),'http://localhost:3000');
  expect(await executeLeasedJob(worker,await claim('notifications.send',delivery.job_id),handler)).toBe('reconciliation');
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
