import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { encodeCsv } from '../modules/crm/exports';
import { exportKindSchema } from '../modules/crm/commands';
import type { Job } from './claims';
import type { JobHandler } from './execute';

const id=z.uuid(),ready=z.object({blocked:z.literal(false),export_id:id,kind:exportKindSchema,columns:z.array(z.string()),rows:z.array(z.record(z.string(),z.unknown())).max(10000),object_key:z.string().regex(/^exports\/[a-f0-9-]{36}$/),completed:z.boolean()}).strict();
const prepared=z.union([z.object({blocked:z.literal(true)}).strict(),ready]);
type Store={put:(object:{object_key:string;size_bytes:number;checksum_sha256:string;detected_type:string},bytes:Uint8Array)=>Promise<void>};
/** Immutable deterministic object keys allow an interrupted write to be adopted on replay. */
export function exportRenderHandler(database:Pick<Pool,'query'>,store:Store):JobHandler{
 async function process(job:Job){
  if(job.purpose!=='exports.render'||job.event_type!=='export_requested'||!z.object({export_id:id}).strict().safeParse(job.payload).success||job.payload.export_id!==job.aggregate_id)throw new Error('EXPORT_JOB_INVALID');
  const input=prepared.parse((await database.query('select app_private.prepare_export_render($1,$2,$3) result',[job.aggregate_id,job.id,job.lease_token])).rows[0]?.result);
  if(input.blocked)return `export:blocked:${job.aggregate_id}`;
  if(input.export_id!==job.aggregate_id)throw new Error('EXPORT_JOB_INVALID');
  const reference=`export:${input.export_id}`;if(input.completed)return reference;
  const bytes=new TextEncoder().encode(encodeCsv(input.kind,input.columns,input.rows));
  const descriptor={object_key:input.object_key,size_bytes:bytes.byteLength,checksum_sha256:createHash('sha256').update(bytes).digest('hex'),detected_type:'text/csv'};
  await store.put(descriptor,bytes);
  const result=z.union([z.object({blocked:z.literal(true)}).strict(),z.object({blocked:z.literal(false),export_id:id,state:z.literal('ready')}).strict()]).parse((await database.query('select app_private.finalize_export_render($1,$2,$3,$4,$5) result',[input.export_id,job.id,job.lease_token,descriptor.size_bytes,descriptor.checksum_sha256])).rows[0]?.result);
  if(!result.blocked&&result.export_id!==input.export_id)throw new Error('EXPORT_RESULT_INVALID');return reference;
 }
 return{execute:process,reconcile:async job=>({outcome:'completed',reference:await process(job)})};
}
