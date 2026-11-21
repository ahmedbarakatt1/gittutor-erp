import type { Pool } from 'pg';
import { z } from 'zod';
import type { CalendarAdapter,CalendarDesired,CalendarObservation } from '../server/providers/calendar';
import type { Job } from './claims';
import type { JobHandler } from './execute';
const id=z.uuid(),version=z.number().int().positive(),instant=z.iso.datetime({offset:true});
const desired=z.object({occurrence_id:id,occurrence_version:version,connection_id:id,connection_version:version,credential_version:id.nullable(),calendar_id:z.string().min(1).max(500),provider_event_id:z.string().regex(/^gt[a-f0-9]{32}$/),meeting_generation:version,conference_request_id:id,action:z.enum(['upsert','cancel']),start_at:instant,end_at:instant,tutor_email:z.email().max(254),title:z.string().max(200)}).strict();
const prepared=z.discriminatedUnion('state',[z.object({state:z.literal('suppressed'),reason:z.string().regex(/^[A-Z_]{1,80}$/)}).strict(),z.object({state:z.literal('ready'),mode:z.enum(['fake','google']),desired}).strict()]);
const observed=z.object({outcome:z.enum(['absent','pending','ready','failed','unknown','revoked']),provider_event_id:z.string().regex(/^gt[a-f0-9]{32}$/),etag:z.string().max(1000).nullable(),join_url:z.url().max(2000).nullable(),safe_error_code:z.string().regex(/^[A-Z_]{1,80}$/).nullable(),observed_at:instant,matches_desired:z.boolean()}).strict();
export type CalendarPrepared={mode:'fake'|'google';desired:CalendarDesired};
export type CalendarAdapterFactory=(input:CalendarPrepared,job:Job)=>Promise<CalendarAdapter>|CalendarAdapter;
export function calendarHandler(database:Pick<Pool,'query'>,factory:CalendarAdapterFactory):JobHandler{
 async function prepare(job:Job){if(job.purpose!=='calendar.sync'||job.payload.occurrence_id!==job.aggregate_id||!id.safeParse(job.aggregate_id).success)throw new Error('CALENDAR_JOB_INVALID');const response=await database.query('select app_private.prepare_calendar_sync($1,$2,$3) result',[job.aggregate_id,job.id,job.lease_token]);const parsed=prepared.safeParse(response.rows[0]?.result);if(!parsed.success||(parsed.data.state==='ready'&&parsed.data.desired.occurrence_id!==job.aggregate_id))throw new Error('CALENDAR_JOB_RESULT_INVALID');return parsed.data;}
 async function finish(job:Job,d:CalendarDesired,result:CalendarObservation){const parsed=observed.safeParse(result);if(!parsed.success||result.provider_event_id!==d.provider_event_id)throw new Error('CALENDAR_PROVIDER_RESULT_INVALID');const safe=result.outcome==='ready'&&!result.matches_desired?{...result,outcome:'pending' as const,join_url:null,safe_error_code:'CALENDAR_VERSION_MISMATCH'}:result;const response=await database.query('select app_private.finalize_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[d.occurrence_id,d.occurrence_version,d.connection_id,d.connection_version,d.meeting_generation,job.id,job.lease_token,JSON.stringify(safe)]);if(!z.object({applied:z.boolean(),outcome:observed.shape.outcome}).strict().safeParse(response.rows[0]?.result).success)throw new Error('CALENDAR_FINALIZATION_INVALID');return safe;}
 return {
  async execute(job){const p=await prepare(job);if(p.state==='suppressed')return `suppressed:${p.reason}`;const adapter=await factory(p,job);const result=await finish(job,p.desired,await adapter.apply(p.desired));if(result.outcome==='unknown')throw new Error('CALENDAR_OUTCOME_UNKNOWN');return `${p.desired.provider_event_id}:${p.desired.meeting_generation}`;},
  async reconcile(job){const p=await prepare(job);if(p.state==='suppressed')return {outcome:'completed',reference:`suppressed:${p.reason}`};const result=await(await factory(p,job)).reconcile(p.desired);
   // A missing Google event can still have an older insertion in flight. Record the
   // observation so the database retains its slot and schedules cancellation checks.
   const cancellingGoogle = p.mode==='google' && p.desired.action==='cancel';
   if((result.outcome==='absent'&&!cancellingGoogle)||((result.outcome==='ready'||result.outcome==='pending')&&!result.matches_desired))return {outcome:'not_sent'};
   await finish(job,p.desired,result);if(result.outcome==='unknown')return {outcome:'unknown'};return {outcome:'completed',reference:`${p.desired.provider_event_id}:${p.desired.meeting_generation}`};},
 };
}
