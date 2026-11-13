import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {calendarFixture} from '../helpers/calendar';
import {renderNotification} from '../../src/modules/notifications/templates';

test('confirmation schedules versioned reminders once; reschedule and cancellation suppress stale recipients',async()=>{
 const f=await calendarFixture();try{
  const original=(await f.database.query('select * from app_private.notification_reminder_schedules where occurrence_id=$1 order by due_at',[f.occurrenceId])).rows;
  expect(original).toHaveLength(2);
  for(const item of original){const jobs=(await f.database.query('select available_at from app_private.outbox_jobs where event_id=$1 and purpose=$2',[item.event_id,'notifications.route'])).rows;expect(jobs).toHaveLength(1);expect(jobs[0].available_at).toEqual(item.due_at);}
  const people=(await f.database.query('select * from app_private.notification_recipients($1)',[original[0].event_id])).rows;expect(people.some(x=>x.audience==='customer')).toBe(true);expect(people.some(x=>x.audience==='tutor')).toBe(true);
  for(const person of people)expect(JSON.stringify(renderNotification(person.content,'http://localhost:3000'))).not.toMatch(/tutor_fee|compensation|encrypted_identifier|margin_minor/);
  // The fixture changes the schedule at the database boundary to isolate trigger/version fencing.
  await f.database.query("update app_private.occurrences set start_at=start_at+interval '1 day',end_at=end_at+interval '1 day',version=version+1 where id=$1",[f.occurrenceId]);
  expect((await f.database.query('select * from app_private.notification_recipients($1)',[original[0].event_id])).rows).toEqual([]);
  const revised=(await f.database.query('select * from app_private.notification_reminder_schedules where occurrence_id=$1 and occurrence_version=(select version from app_private.occurrences where id=$1)',[f.occurrenceId])).rows;expect(revised).toHaveLength(2);
  await f.database.query('select app_private.schedule_occurrence_reminders($1)',[f.occurrenceId]);expect((await f.database.query('select count(*)::integer count from app_private.notification_reminder_schedules where occurrence_id=$1',[f.occurrenceId])).rows[0].count).toBe(4);
  await f.database.query("update app_private.occurrences set state='cancelled',version=version+1 where id=$1",[f.occurrenceId]);expect((await f.database.query('select * from app_private.notification_recipients($1)',[revised[0].event_id])).rows).toEqual([]);
 }finally{await f.close();}
},60000);

test('current routing recognizes completion and payout aliases without sending private categories to customers',async()=>{
 const f=await calendarFixture();try{
  for(const [event,kind] of [['submit_completion','completion'],['completion_amended','completion'],['transfer_allocated','payment'],['tutor_profile_reviewed','tutor_review'],['payout_authorized','payout'],['payout_reversed','payout'],['support_transferred','support'],['export_ready','export']])expect((await f.database.query('select app_private.notification_kind($1) kind',[event])).rows[0].kind).toBe(kind);
  const event=randomUUID();await f.database.query("select app_private.enqueue_event($1,'payout_authorized',$2,$3,'notifications.route')",[event,f.tutorId,JSON.stringify({tutor_id:f.tutorId})]);const recipients=(await f.database.query('select * from app_private.notification_recipients($1)',[event])).rows;expect(recipients.some(x=>x.audience==='tutor'&&x.content.action_path==='/tutor/pay')).toBe(true);expect(recipients.some(x=>x.audience==='customer')).toBe(false);
  const completion=randomUUID();await f.database.query("select app_private.enqueue_event($1,'submit_completion',$2,$3,'notifications.route')",[completion,f.occurrenceId,JSON.stringify({occurrence_id:f.occurrenceId})]);expect((await f.database.query('select * from app_private.notification_recipients($1)',[completion])).rows.every(x=>x.audience==='staff')).toBe(true);
 }finally{await f.close();}
},60000);
