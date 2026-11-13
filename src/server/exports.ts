import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import { bookingRpc,BookingRpcError,type BookingRpcClient } from '../modules/booking/commands';
import { createPrivateObjectStore } from './files';
import { createDatabasePool,databaseUrl } from './database';
import { parseServerConfig } from './config';

const id=z.uuid(),authorization=z.union([z.object({allowed:z.literal(false)}).strict(),z.object({allowed:z.literal(true),authorization_id:id}).strict()]);
const descriptor=z.object({allowed:z.literal(true),export_id:id,object_key:z.string().regex(/^exports\/[a-f0-9-]{36}$/),size_bytes:z.number().int().positive().max(26214400),checksum_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const response=z.union([z.object({allowed:z.literal(false)}).strict(),descriptor]);
type Store={read:(input:z.infer<typeof descriptor>)=>Promise<Uint8Array|null>};
export function createExportDownloadService(database:Pick<Pool,'query'>,store:Store){return{async download(client:BookingRpcClient,exportId:string){
 if(!id.safeParse(exportId).success)throw new BookingRpcError('VALIDATION_ERROR');
 const ticket=authorization.parse((await bookingRpc(client,'authorize_export_download',{p_export_id:exportId})).data);if(!ticket.allowed)throw new BookingRpcError('NOT_FOUND');
 async function check(stage:'before_read'|'after_read'){const input=response.parse((await database.query('select app_private.prepare_export_download($1,$2,$3) result',[exportId,ticket.allowed?ticket.authorization_id:null,stage])).rows[0]?.result);if(!input.allowed||input.export_id!==exportId)throw new BookingRpcError('NOT_FOUND');return input;}
 const before=await check('before_read'),bytes=await store.read(before);if(!bytes)throw new BookingRpcError('NOT_FOUND');const after=await check('after_read');
 if(before.object_key!==after.object_key||before.checksum_sha256!==after.checksum_sha256||before.size_bytes!==after.size_bytes)throw new BookingRpcError('VERSION_CONFLICT');return bytes;
}};}
let service:ReturnType<typeof createExportDownloadService>|undefined;
export function downloadExport(client:BookingRpcClient,exportId:string){service??=createExportDownloadService(createDatabasePool(databaseUrl('worker')),createPrivateObjectStore(parseServerConfig(process.env)));return service.download(client,exportId);}
