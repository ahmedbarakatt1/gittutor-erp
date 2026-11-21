import { expectSignedInAccount } from '../helpers/browser-auth';
import {expect,test,type Page} from '@playwright/test';
import {Pool} from 'pg';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bookingFixture} from '../helpers/booking';
import {loadLocalSupabase} from '../helpers/supabase';
import {claimJobs} from '../../src/worker/claims';
import {executeLeasedJob} from '../../src/worker/execute';
import {notificationSendHandler} from '../../src/worker/notifications';
import {createLocalEmailAdapter} from '../../src/server/providers/email';
async function login(page:Page,label:string){const actor=loadLocalSupabase().actors[label];await page.goto('/login');await page.getByLabel('Email address',{exact:true}).fill(actor.email);await page.getByLabel('Password',{exact:true}).fill(actor.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expectSignedInAccount(page, actor.id);}
test('customer updates stay confidential and admin retries a definite failed send once',async({browser},info)=>{
 test.setTimeout(90000);const f=await bookingFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url}),contexts=await Promise.all([0,1].map(()=>browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:info.project.use.viewport}))),directory=await mkdtemp(join(tmpdir(),'git-tutor-notice-browser-'));
 const claim=async(purpose:string,target:string)=>{await f.database.query('begin');try{await f.database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update',[purpose,target]);const jobs=await claimJobs(worker,purpose,1,60);expect(jobs[0]?.id).toBe(target);return jobs[0];}finally{await f.database.query('rollback');}};
 try{
  await f.availability();const occurrence=await f.occurrence(),enrollment=await f.reserve(occurrence.occurrence_id as string);
  const source=(await f.database.query("select j.id,e.id event_id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and e.event_type='booking_reserve_enrollment'and j.purpose='notifications.route'",[enrollment.enrollment_id])).rows[0];const route=await claim('notifications.route',source.id);await worker.query('select app_private.route_notification_event($1,$2)',[route.id,route.lease_token]);
  const d=(await f.database.query("select d.id,j.id job_id from app_private.notification_deliveries d join app_private.domain_events e on e.aggregate_id=d.id and e.event_type='notification_dispatch'join app_private.outbox_jobs j on j.event_id=e.id where d.event_id=$1 and d.recipient_account_id=$2 and d.channel='email'",[source.event_id,loadLocalSupabase().actors.learner_a.id])).rows[0];
  await f.database.query("insert into app_private.notification_fake_scenarios(delivery_id,scenario)values($1,'transient_failure')",[d.id]);
  await executeLeasedJob(worker,await claim('notifications.send',d.job_id),notificationSendHandler(worker,scenario=>createLocalEmailAdapter(directory,true,scenario),'http://localhost:3000'));
  const customer=await contexts[0].newPage(),admin=await contexts[1].newPage(),errors:string[]=[];customer.on('pageerror',e=>errors.push(e.message));admin.on('pageerror',e=>errors.push(e.message));
  await login(customer,'learner_a');const noticeResponse=customer.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/notifications'&&r.request().method()==='GET');await customer.goto('/learn/notifications');const payload=await(await noticeResponse).json();expect(payload.data.items.some((x:{event_id:string})=>x.event_id===source.event_id)).toBe(true);expect(JSON.stringify(payload)).not.toMatch(/tutor_fee|compensation|margin_minor|encrypted_identifier|private_notes/);await expect(customer.getByRole('heading',{name:'Your booking has an update'}).first()).toBeVisible();
  await login(admin,'admin_a');await admin.goto('/admin/notifications-operations');await admin.getByLabel('Delivery status',{exact:true}).selectOption('failed');const card=admin.getByRole('listitem').filter({has:admin.getByRole('heading',{name:'booking reserve enrollment',exact:true})}).first();await expect(card).toBeVisible();await card.getByText('Retry failed delivery',{exact:true}).click();await card.getByLabel('Reason for this action',{exact:true}).fill('Confirmed provider rejection; retry authorized');
  const response=admin.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/notifications/deliveries/${d.id}/retry`&&r.request().method()==='POST');await card.getByRole('button',{name:'Queue retry',exact:true}).click();expect((await response).status()).toBe(200);
  const job=(await f.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='notifications.send'and j.state='pending'order by j.created_at desc limit 1",[d.id])).rows[0];await executeLeasedJob(worker,await claim('notifications.send',job.id),notificationSendHandler(worker,()=>createLocalEmailAdapter(directory,true),'http://localhost:3000'));expect((await f.database.query('select state from app_private.notification_deliveries where id=$1',[d.id])).rows[0].state).toBe('sent');
  for(const page of [customer,admin])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await mkdir('.local/screenshots',{recursive:true});await customer.screenshot({path:`.local/screenshots/t09-notifications-${info.project.name}.png`,fullPage:true});
 }finally{await Promise.all(contexts.map(c=>c.close()));await worker.end();await f.close();}
});
