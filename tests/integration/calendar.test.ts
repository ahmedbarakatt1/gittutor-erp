import { randomUUID } from 'node:crypto';
import { expect,test } from 'vitest';
import { authClient,anonymousClient } from '../helpers/supabase';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { calendarFixture } from '../helpers/calendar';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { calendarHandler } from '../../src/worker/calendar';
import { createFakeCalendarAdapter,type CalendarDesired } from '../../src/server/providers/calendar';
import { getOccurrenceMeeting,getMeetingAccess } from '../../src/modules/teaching/meetings';
import { getOperationProposal } from '../../src/modules/booking/queries';
async function claimOnly(f:Awaited<ReturnType<typeof calendarFixture>>,worker:Pool,jobId:string){await f.database.query('begin');try{await f.database.query("select id from app_private.outbox_jobs where purpose='calendar.sync' and id<>$1 for update",[jobId]);const jobs=await claimJobs(worker,'calendar.sync',1,60);expect(jobs.map(job=>job.id)).toEqual([jobId]);return jobs[0];}finally{await f.database.query('rollback');}}
async function jobFor(f:Awaited<ReturnType<typeof calendarFixture>>){return (await f.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='calendar.sync' and j.state='pending' order by j.created_at desc,j.id desc limit 1",[f.occurrenceId])).rows[0].id as string;}
test('calendar connection is current-admin-only, durable and replay-safe without exposing credentials',async()=>{
 const admin=await authClient('admin_a'),student=await authClient('learner_a');
 try {const args={p_idempotency_key:randomUUID()};const created=await admin.rpc('connect_fake_calendar',args);expect(created.error).toBeNull();expect(created.data).toMatchObject({connection_id:expect.any(String),integration_state:'simulated'});expect((await admin.rpc('connect_fake_calendar',args)).data).toEqual(created.data);
 expect((await student.rpc('connect_fake_calendar',{p_idempotency_key:randomUUID()})).error?.message).toBe('FORBIDDEN');expect((await anonymousClient().rpc('get_calendar_connection')).error).not.toBeNull();const read=await admin.rpc('get_calendar_connection');expect(read.error).toBeNull();expect(read.data).toMatchObject({mode:'fake',state:'connected',integration_state:'simulated'});expect(JSON.stringify(read.data)).not.toMatch(/refresh_token|ciphertext|credential_key|fee_minor/);
 }finally{await Promise.all([admin,student].map(client=>client.auth.signOut({scope:'local'})));}
});
test('genuine funded session reconciles timeout into one room and current scoped access after lost acknowledgement',async()=>{
 const f=await calendarFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});const directory=resolve('.local/fake-calendar',randomUUID());
 try{const jobId=await jobFor(f),first=await claimOnly(f,worker,jobId);const handler=calendarHandler(worker,()=>createFakeCalendarAdapter(directory,'timeout_after_success'));
 await expect(handler.execute(first)).rejects.toThrow('CALENDAR_OUTCOME_UNKNOWN');expect((await getOccurrenceMeeting(f.learner,f.occurrenceId)).can_join).toBe(false);
 await f.database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[jobId]);const reclaimed=await claimOnly(f,worker,jobId);expect(reclaimed.attempt_count).toBe(2);expect(await executeLeasedJob(worker,reclaimed,handler)).toBe('completed');
 const customer=await getOccurrenceMeeting(f.learner,f.occurrenceId),tutor=await getOccurrenceMeeting(f.tutor,f.occurrenceId,{view:'tutor'});expect(customer).toMatchObject({meeting_status:'ready',integration_state:'simulated',can_join:true});expect(tutor.can_join).toBe(true);expect((await getMeetingAccess(f.learner,f.occurrenceId)).join_url).toBe((await getMeetingAccess(f.tutor,f.occurrenceId,{view:'tutor'})).join_url);
 await expect(getOccurrenceMeeting(f.students[1],f.occurrenceId)).rejects.toThrow('NOT_FOUND');expect(JSON.stringify(customer)).not.toMatch(/"[a-z_]*(?:fee|compensation|calendar_id|credential|tutor_email)[a-z_]*"\s*:/);expect(Object.values(customer)).not.toContain(25000);
 const retry=await f.rpc('retry_meeting_provisioning',{p_occurrence_id:f.occurrenceId,p_expected_version:customer.occurrence_version,p_idempotency_key:randomUUID()});await executeLeasedJob(worker,await claimOnly(f,worker,retry.job_id as string),handler);
 expect((await f.database.query('select count(*)::int n from app_private.calendar_events where occurrence_id=$1',[f.occurrenceId])).rows[0].n).toBe(1);expect((await f.database.query("select count(*)::int n from app_private.domain_events where aggregate_id=$1 and event_type='meeting_ready'",[f.occurrenceId])).rows[0].n).toBe(1);
 const grant=(await f.database.query("select id,version from app_private.account_roles where account_id=$1 and role='tutor' and revoked_at is null",[f.actor.id])).rows[0];await f.rpc('revoke_staff_role',{p_role_grant_id:grant.id,p_reason:'Current tutor access revocation check',p_expected_version:grant.version,p_idempotency_key:randomUUID()});await expect(getMeetingAccess(f.tutor,f.occurrenceId,{view:'tutor'})).rejects.toThrow('FORBIDDEN');expect((await getOccurrenceMeeting(f.learner,f.occurrenceId)).reason).toBe('ACCESS_REVOKED');
 }finally{await worker.end();await f.close();}
},60000);
test('reschedule during provisioning fences the old result and revoked organizer blocks current access',async()=>{
 const f=await calendarFixture(),worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});const adapter=createFakeCalendarAdapter(resolve('.local/fake-calendar',randomUUID()));
 try{const job=await claimOnly(f,worker,await jobFor(f));const prepared=(await worker.query('select app_private.prepare_calendar_sync($1,$2,$3) result',[f.occurrenceId,job.id,job.lease_token])).rows[0].result;const d=prepared.desired as CalendarDesired,oldResult=await adapter.apply(d);
 const start=new Date(Date.parse(d.start_at)+86400000).toISOString(),end=new Date(Date.parse(d.end_at)+86400000).toISOString();const proposal=await f.rpc('create_operation_proposal',{p_kind:'reschedule',p_target_id:f.occurrenceId,p_requested_terms:{target_type:'occurrence',start_at:start,end_at:end,time_zone:'Africa/Cairo',expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Current schedule changes while calendar is provisioning',p_expected_version:d.occurrence_version,p_idempotency_key:randomUUID()});
 for(const [client,view]of [[f.learner,'customer'],[f.tutor,'tutor']]as const){const terms=await getOperationProposal(client,proposal.proposal_id as string,{view});await f.rpc('accept_operation_proposal',{p_proposal_id:proposal.proposal_id,p_terms_hash:terms.terms_hash,p_expected_version:terms.version,p_idempotency_key:randomUUID()},client);}
 const review=await getOperationProposal(f.admin,proposal.proposal_id as string,{view:'admin'});await f.rpc('approve_operation_proposal',{p_proposal_id:proposal.proposal_id,p_terms_hash:review.terms_hash,p_decision:'approved',p_reason:'All affected current parties accepted',p_expected_version:review.version,p_idempotency_key:randomUUID()});await f.rpc('reschedule_occurrence',{p_occurrence_id:f.occurrenceId,p_start_at:start,p_end_at:end,p_time_zone:'Africa/Cairo',p_reason:'Apply accepted new time',p_accepted_proposal_id:proposal.proposal_id,p_expected_version:d.occurrence_version,p_idempotency_key:randomUUID()});
 expect((await worker.query('select app_private.finalize_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[d.occurrence_id,d.occurrence_version,d.connection_id,d.connection_version,d.meeting_generation,job.id,job.lease_token,JSON.stringify(oldResult)])).rows[0].result.applied).toBe(false);expect((await getOccurrenceMeeting(f.learner,f.occurrenceId)).can_join).toBe(false);
 const retry=await f.rpc('retry_meeting_provisioning',{p_occurrence_id:f.occurrenceId,p_expected_version:d.occurrence_version+1,p_idempotency_key:randomUUID()});await executeLeasedJob(worker,await claimOnly(f,worker,retry.job_id as string),calendarHandler(worker,()=>adapter));const current=await getOccurrenceMeeting(f.learner,f.occurrenceId);expect(current.can_join).toBe(true);expect(Date.parse(current.start_at)).toBe(Date.parse(start));
 await f.rpc('revoke_calendar_connection',{p_connection_id:f.connectionId,p_expected_version:1,p_idempotency_key:randomUUID()});expect((await getOccurrenceMeeting(f.learner,f.occurrenceId)).reason).toBe('AUTHORIZATION_REQUIRED');await expect(getMeetingAccess(f.learner,f.occurrenceId)).rejects.toThrow('STATE_CONFLICT');
 }finally{await worker.end();await f.close();}
},60000);
