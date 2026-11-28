import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { calendarFixture } from '../helpers/calendar';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { notificationSendHandler } from '../../src/worker/notifications';
import { createLocalEmailAdapter } from '../../src/server/providers/email';

test('confirmation and both rescheduled reminders reach the isolated learner email inbox', async () => {
  const f = await calendarFixture();
  const config = loadLocalSupabase();
  const worker = new Pool({connectionString: config.worker_database_url});
  const directory = await mkdtemp(join(tmpdir(),'git-tutor-confirm-remind-'));
  const handler = notificationSendHandler(worker, () => createLocalEmailAdapter(directory,true), 'http://localhost:3000');
  // Move only this fixture's job to the front, leaving all other schedules and leases untouched.
  const claim = async (jobId:string, purpose:string) => {
    await f.database.query("update app_private.outbox_jobs set available_at='1970-01-01' where id=$1 and state='pending'",[jobId]);
    const jobs = await claimJobs(worker,purpose,1,60);
    expect(jobs[0]?.id).toBe(jobId);
    return jobs[0];
  };
  try {
    const confirmation = (await f.database.query(`select e.id from app_private.domain_events e join app_private.outbox_jobs j on j.event_id=e.id
      where e.aggregate_id=$1 and app_private.notification_kind(e.event_type)='session' and e.event_type in ('occurrence_confirmed','booking_confirm_occurrence') and j.purpose='notifications.route'`,[f.occurrenceId])).rows[0];
    expect(confirmation).toBeDefined();
    const reminders = async () => (await f.database.query(`select s.event_id,s.lead_minutes, o.start_at-s.due_at = make_interval(mins=>s.lead_minutes) correct_due
      from app_private.notification_reminder_schedules s join app_private.occurrences o on o.id=s.occurrence_id and o.version=s.occurrence_version
      where o.id=$1 order by s.lead_minutes desc`,[f.occurrenceId])).rows;
    const old = await reminders();
    expect(old.map(r=>[r.lead_minutes,r.correct_due])).toEqual([[1440,true],[60,true]]);
    async function deliver(eventId:string) {
      const routeId=(await f.database.query("select id from app_private.outbox_jobs where event_id=$1 and purpose='notifications.route'",[eventId])).rows[0].id;
      const route=await claim(routeId,'notifications.route');
      await worker.query('select app_private.route_notification_event($1,$2)',[route.id,route.lease_token]);
      const delivery=(await f.database.query(`select j.id job_id,a.id attempt_id from app_private.notification_deliveries d join app_private.notification_attempts a on a.delivery_id=d.id
        join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch' join app_private.outbox_jobs j on j.event_id=e.id
        where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'`,[eventId,config.actors.learner_a.id])).rows[0];
      expect(delivery).toBeDefined();
      expect(await executeLeasedJob(worker,await claim(delivery.job_id,'notifications.send'),handler)).toBe('completed');
      const {message} = JSON.parse(await readFile(join(directory,`${delivery.attempt_id}.json`),'utf8'));
      expect(message.to).toBe(config.actors.learner_a.email);
      expect(message.text).toMatch(/http:\/\/localhost:3000\/learn\//);
      expect(Object.keys(message).sort()).toEqual(['attempt_id','html','subject','text','to']);
      expect(message.text + message.html).not.toMatch(/tutor_fee|compensation|private_notes|margin_minor/);
    }
    await deliver(confirmation.id);
    await f.database.query("update app_private.occurrences set start_at=start_at+interval '1 day',end_at=end_at+interval '1 day',version=version+1 where id=$1",[f.occurrenceId]);
    for(const reminder of old) expect((await f.database.query('select * from app_private.notification_recipients($1)',[reminder.event_id])).rows).toHaveLength(0);
    const revised = await reminders();
    expect(revised.map(r=>[r.lead_minutes,r.correct_due])).toEqual([[1440,true],[60,true]]);
    for(const reminder of revised) await deliver(reminder.event_id);
  } finally { await worker.end(); await f.close(); }
},120000);
