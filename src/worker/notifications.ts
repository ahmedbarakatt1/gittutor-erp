import { z } from 'zod';
import type { Pool } from 'pg';
import { notificationContentSchema,renderNotification } from '../modules/notifications/templates';
import { emailObservationSchema,type EmailAdapter } from '../server/providers/email';
import type { JobHandler } from './execute';
import type { Job } from './claims';
const id=z.uuid();
const prepared=z.discriminatedUnion('state',[
 z.object({state:z.literal('complete'),delivery_id:id,attempt_id:id}).strict(),
 z.object({state:z.literal('ready'),delivery_id:id,attempt_id:id,destination:z.email(),content:notificationContentSchema,scenario:z.enum(['success','timeout_after_success','transient_failure','permanent_failure']),attempt_state:z.enum(['pending','unknown','failed','sent','delivered','bounced','suppressed'])}).strict(),
]);
export function notificationRouteHandler(database:Pick<Pool,'query'>):JobHandler{
 async function route(job:Job){if(job.purpose!=='notifications.route')throw new Error('NOTIFICATION_JOB_INVALID');const response=await database.query('select app_private.route_notification_event($1,$2) result',[job.id,job.lease_token]);z.object({created:z.number().int().nonnegative(),supported:z.boolean(),recipient_count:z.number().int().nonnegative()}).strict().parse(response.rows[0]?.result);return `routed:${job.event_id}`;}
 return {execute:route,reconcile:async job=>({outcome:'completed',reference:await route(job)})};
}
export function notificationSendHandler(database:Pick<Pool,'query'>,factory:(scenario:'success'|'timeout_after_success'|'transient_failure'|'permanent_failure')=>EmailAdapter,baseUrl:string):JobHandler{
 async function prepare(job:Job){if(job.purpose!=='notifications.send'||job.event_type!=='notification_dispatch'||!z.object({delivery_id:id}).strict().safeParse(job.payload).success||job.aggregate_id!==job.payload.delivery_id)throw new Error('NOTIFICATION_JOB_INVALID');const value=prepared.parse((await database.query('select app_private.prepare_notification_delivery($1,$2,$3) result',[job.aggregate_id,job.id,job.lease_token])).rows[0]?.result);if(value.delivery_id!==job.aggregate_id)throw new Error('NOTIFICATION_JOB_INVALID');return value;}
 async function finish(job:Job,attempt:string,input:unknown){const observed=emailObservationSchema.parse(input);if(observed.outcome==='absent')throw new Error('NOTIFICATION_OBSERVATION_INVALID');const value=(await database.query('select app_private.finalize_notification_delivery($1,$2,$3,$4,$5::jsonb) result',[job.aggregate_id,attempt,job.id,job.lease_token,JSON.stringify(observed)])).rows[0]?.result;return z.object({delivery_id:id,state:z.enum(['queued','sent','delivered','bounced','suppressed','failed','unknown'])}).strict().parse(value).state;}
 return {async execute(job){const ready=await prepare(job);if(ready.state==='complete')return ready.attempt_id;const adapter=factory(ready.scenario);if(ready.attempt_state==='unknown'){const previous=await adapter.reconcile(ready.attempt_id);if(previous.outcome!=='absent'){if(await finish(job,ready.attempt_id,previous)==='unknown')throw new Error('EMAIL_OUTCOME_UNKNOWN');return ready.attempt_id;}}const state=await finish(job,ready.attempt_id,await adapter.send({attempt_id:ready.attempt_id,to:ready.destination,...renderNotification(ready.content,baseUrl)}));if(state==='unknown')throw new Error('EMAIL_OUTCOME_UNKNOWN');return ready.attempt_id;},
 async reconcile(job){const ready=await prepare(job);if(ready.state==='complete')return {outcome:'completed',reference:ready.attempt_id};const observed=await factory(ready.scenario).reconcile(ready.attempt_id);if(observed.outcome==='absent')return {outcome:'not_sent'};const state=await finish(job,ready.attempt_id,observed);return state==='unknown'?{outcome:'unknown'}:{outcome:'completed',reference:ready.attempt_id};}};
}
