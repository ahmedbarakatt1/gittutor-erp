import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentFixture } from './payments';
import { settleEnrollment } from './financial-booking';
import { Pool,type Client } from 'pg';
import { resolve } from 'node:path';
import { loadLocalSupabase,type anonymousClient } from './supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { calendarHandler } from '../../src/worker/calendar';
import { createFakeCalendarAdapter } from '../../src/server/providers/calendar';
import { getOccurrenceMeeting,invokeMeetingCommandWithStatus } from '../../src/modules/teaching/meetings';
/** Genuine verified quote, source payment, exact fee and confirmed booking; provider alone is fake. */
export async function calendarFixture(options: {isolatedLearners?: boolean} = {}){const f=await paymentFixture({charge:'enrollment',...options});try{
 const connection=await f.rpc('add_fake_calendar_organizer',{p_idempotency_key:randomUUID()});
 // Fixtures often use the same hour. Give this generated tutor a dedicated fake
 // identity, so parallel lessons exercise the same organizer preference as Google.
 await f.database.query("update app_private.provider_connections set organizer_email=$2 where id=$1 and mode='fake'",[connection.connection_id,f.actor.email]);
 const row=(await f.database.query('select o.* from app_private.occurrences o join app_private.enrollments e on e.occurrence_id=o.id where e.id=$1',[f.enrollmentId])).rows[0];
 await f.rpc('approve_tutor_fee',{p_occurrence_id:row.id,p_tutor_id:f.tutorId,p_fee_minor:25000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:row.pricing_version_id,p_target_tier:null,p_purpose:'initial',p_reason:'Synthetic calendar exact agreement',p_expected_version:row.version,p_idempotency_key:randomUUID()});
 const receiving=await f.receiving();await settleEnrollment(f,f.enrollmentId!,0,50000,receiving);
 const current=(await f.database.query('select state,version from app_private.occurrences where id=$1',[row.id])).rows[0];if(current.state!=='confirmed')await f.rpc('confirm_occurrence',{p_occurrence_id:row.id,p_expected_version:current.version,p_idempotency_key:randomUUID()});
 assert.equal((await f.database.query('select state from app_private.occurrences where id=$1',[row.id])).rows[0].state,'confirmed');
 const close=async()=>{try{
   const current=(await f.database.query('select state,version from app_private.provider_connections where id=$1',[connection.connection_id])).rows[0];
   if(current.state==='connected')await f.rpc('revoke_calendar_connection',{p_connection_id:connection.connection_id,p_expected_version:current.version,p_idempotency_key:randomUUID()});
 }finally{await f.close();}};
 return {...f,close,occurrenceId:row.id as string,connectionId:connection.connection_id as string};
 }catch(error){await f.close();throw error;}}

/** Only the real admin RPC and restricted leased worker make this meeting ready. */
export async function provisionFakeMeeting(f:{database:Client;admin:ReturnType<typeof anonymousClient>},occurrenceId:string){
 const worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 try{const current=await getOccurrenceMeeting(f.admin,occurrenceId,{view:'admin'});const requested=await invokeMeetingCommandWithStatus(f.admin,'retry_meeting_provisioning',{p_occurrence_id:occurrenceId,p_expected_version:current.occurrence_version,p_idempotency_key:randomUUID()});const jobId=(requested.data as {job_id:string}).job_id;
 await f.database.query('begin');let jobs;try{await f.database.query("select id from app_private.outbox_jobs where purpose='calendar.sync' and id<>$1 for update",[jobId]);jobs=await claimJobs(worker,'calendar.sync',1,60);}finally{await f.database.query('rollback');}
 assert.equal(jobs.length,1);assert.equal(jobs[0].id,jobId);assert.equal(await executeLeasedJob(worker,jobs[0],calendarHandler(worker,()=>createFakeCalendarAdapter(resolve('.local/fake-calendar',randomUUID())))),'completed');return getOccurrenceMeeting(f.admin,occurrenceId,{view:'admin'});
 }finally{await worker.end();}
}
