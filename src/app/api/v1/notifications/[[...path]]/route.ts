import {randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requestSupabase} from '@/server/supabase';
import {allowedOrigin,DomainError,readJson,safeError} from '@/server/http';
import {listNotifications,listDeliveries,getNotificationPreferences,invokeNotificationCommand} from '@/modules/notifications/events';
import {identityRpc} from '@/modules/identity/commands';
export const runtime='nodejs';
type Context={params:Promise<{path?:string[]}>};
const queueSchema=z.object({items:z.array(z.object({queue:z.enum(['general','payments','completion']),account_id:z.uuid().nullable(),version:z.number().int().nonnegative()}).strict())}).strict();
async function handle(request:NextRequest,context:Context){let scoped:ReturnType<typeof requestSupabase>|undefined;const requestId=randomUUID();try{
 scoped=requestSupabase(request);const claims=await scoped.client.auth.getClaims();if(claims.error||!claims.data?.claims.sub)throw new DomainError('AUTH_REQUIRED');const path=(await context.params).path?.join('/')||'';let data:unknown;
 if(request.method==='GET'){
  const query=request.nextUrl.searchParams,allowed=path==='deliveries'?['limit','cursor','state']:path===''?['limit','cursor']:[];
  if([...query.keys()].some(key=>!allowed.includes(key))||[...query.keys()].some(key=>query.getAll(key).length!==1))throw new DomainError('VALIDATION_ERROR');
  const args={p_limit:query.has('limit')?Number(query.get('limit')):25,p_cursor:query.get('cursor')};
  if(path==='')data=await listNotifications(scoped.client,args);else if(path==='preferences')data=await getNotificationPreferences(scoped.client);else if(path==='deliveries')data=await listDeliveries(scoped.client,{...args,p_state:query.get('state')});else if(path==='queues')data=queueSchema.parse(await identityRpc(scoped.client,'list_notification_queues'));else throw new DomainError('NOT_FOUND');
 }else{
  if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');if(request.nextUrl.searchParams.size)throw new DomainError('VALIDATION_ERROR');
  const key=request.headers.get('Idempotency-Key');if(!key||key.length>200)throw new DomainError('VALIDATION_ERROR');const body=await readJson(request);if(body===null||typeof body!=='object'||Array.isArray(body))throw new DomainError('VALIDATION_ERROR');
  const retry=/^deliveries\/([^/]+)\/(retry|reconcile)$/.exec(path);const name=path==='preferences'?'set_notification_preferences':path==='queues'?'assign_notification_queue':retry?(retry[2]==='reconcile'?'reconcile_notification':'retry_notification'):null;if(!name)throw new DomainError('NOT_FOUND');
  const args=Object.fromEntries(Object.entries(body).map(([field,value])=>[`p_${field}`,value]));if('p_idempotency_key'in args||'p_delivery_id'in args)throw new DomainError('VALIDATION_ERROR');if(retry)args.p_delivery_id=retry[1];args.p_idempotency_key=key;
  data=(await invokeNotificationCommand(scoped.client,name,args)).data;
 }
 return scoped.finish(NextResponse.json({data,request_id:requestId},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
 }catch(error){const safe=error instanceof z.ZodError?safeError(new DomainError('VALIDATION_ERROR')):safeError(error);const result=NextResponse.json({...safe,request_id:requestId},{status:safe.status,headers:{'Cache-Control':'private, no-store'}});return scoped?scoped.finish(result):result;}}
export const GET=handle;
export const POST=handle;
