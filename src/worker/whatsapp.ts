import {z} from 'zod';
import type {Pool} from 'pg';
import type {Job} from './claims';
import type {JobHandler} from './execute';
import {whatsappObservation,type WhatsAppAdapter,type WhatsAppScenario} from '../server/providers/whatsapp';
const id=z.uuid(),prepared=z.discriminatedUnion('state',[
 z.object({state:z.literal('complete'),message_id:id}).strict(),
 z.object({state:z.literal('ready'),message_id:id,attempt_state:z.enum(['queued','unknown']),destination:z.string(),text:z.string().nullable(),template:z.object({name:z.string(),language:z.string(),parameters:z.array(z.string())}).strict().nullable(),scenario:z.enum(['success','timeout_after_success','failure'])}).strict(),
]);
export function whatsappSendHandler(pool:Pick<Pool,'connect'|'query'>,factory:(scenario:WhatsAppScenario)=>WhatsAppAdapter,mode:'fake'|'cloud'='fake',phoneNumberId?:string):JobHandler{
 if(mode==='cloud'&&!phoneNumberId)throw Error('WHATSAPP_CONFIGURATION_REQUIRED');
 function validate(job:Job){if(job.purpose!=='support.whatsapp_send'||job.event_type!=='support_whatsapp_dispatch'||!z.object({message_id:id}).strict().safeParse(job.payload).success||job.aggregate_id!==job.payload.message_id)throw Error('WHATSAPP_JOB_INVALID');}
 async function finish(job:Job,input:unknown,database:Pick<Pool,'query'>=pool){const value=whatsappObservation.parse(input);if(value.outcome==='absent')throw Error('WHATSAPP_OBSERVATION_INVALID');await database.query('select app_private.finalize_whatsapp_send($1,$2,$3,$4::jsonb)',[job.aggregate_id,job.id,job.lease_token,JSON.stringify(value)]);return value;}
 return {
  async execute(job){validate(job);const connection=await pool.connect();try{await connection.query('begin');const ready=prepared.parse((await connection.query('select app_private.prepare_whatsapp_send($1,$2,$3,$4,$5) result',[job.aggregate_id,job.id,job.lease_token,mode,phoneNumberId??null])).rows[0].result);if(ready.state==='complete'){await connection.query('commit');return job.aggregate_id;}
   const adapter=factory(ready.scenario);let result;if(ready.attempt_state==='unknown'){result=await adapter.reconcile(job.aggregate_id);if(result.outcome==='absent')result={outcome:'unknown' as const,provider_message_id:null,safe_error_code:'WHATSAPP_RECONCILIATION_REQUIRED'};}else result=await adapter.send({message_id:ready.message_id,destination:ready.destination,text:ready.text,template:ready.template});
   await finish(job,result,connection);await connection.query('commit');if(result.outcome==='unknown')throw Error('WHATSAPP_OUTCOME_UNKNOWN');return job.aggregate_id;
  }catch(error){await connection.query('rollback');if(!(error instanceof Error&&error.message==='LEASE_LOST')){await finish(job,{outcome:'unknown',provider_message_id:null,safe_error_code:'WHATSAPP_OUTCOME_UNKNOWN'},connection);}throw error;}finally{connection.release();}},
  async reconcile(job){validate(job);
   // An expired lease may have sent before its database commit. Reconcile the stable
   // identity before checking changed ownership, consent or service-window conditions.
   const result=await factory('success').reconcile(job.aggregate_id);if(result.outcome==='absent')return {outcome:'not_sent'};await finish(job,result);return result.outcome==='unknown'?{outcome:'unknown'}:{outcome:'completed',reference:job.aggregate_id};},
 };
}
