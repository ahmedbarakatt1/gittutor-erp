import{randomUUID}from'node:crypto';import{NextRequest,NextResponse}from'next/server';import{z}from'zod';
import { sessionView } from '@/server/session-view';
import{requestSupabase}from'@/server/supabase';import{allowedOrigin,DomainError,readJson,safeError}from'@/server/http';import{getConversation,listConversations,invokeSupportCommand,getSupportOptions,issueConversationChallenge,registerWhatsAppTemplate,revokeWhatsAppTemplate,setSupportHours,type supportCommands}from'@/modules/support/commands';
export const runtime='nodejs';
const actions:Record<string,keyof typeof supportCommands>={messages:'submit_message',handoff:'request_handoff',claim:'claim_conversation',reply:'reply_to_conversation',transfer:'transfer_conversation',escalate:'escalate_conversation',return:'return_conversation',resolve:'resolve_conversation',notes:'add_conversation_note',link:'link_conversation_account',reconcile:'reconcile_whatsapp_message','withdraw-consent':'withdraw_whatsapp_consent'};
async function handle(request:NextRequest,context:{params:Promise<{path?:string[]}>}){let scoped:ReturnType<typeof requestSupabase>|undefined;const requestId=randomUUID();try{
 scoped=requestSupabase(request);const path=(await context.params).path||[],claims=await scoped.client.auth.getClaims();let data:unknown;
 if(request.method==='POST'&&path.join('/')==='session'){
  if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');
  if(!claims.data?.claims.sub){
    const created=await scoped.client.auth.signInAnonymously();
    if(created.error||!created.data.session)throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const guest=await scoped.client.auth.getClaims(created.data.session.access_token);
    if(guest.error||!guest.data?.claims.session_id)throw new DomainError('DEPENDENCY_UNAVAILABLE');
    return scoped.finish(NextResponse.json({data:{ready:true},request_id:requestId},{headers:{'x-git-tutor-new-view':sessionView(guest.data.claims.session_id),'x-git-tutor-guest':'1'}}));
  }
  if (claims.data.claims.is_anonymous === true) {
    return scoped.finish(NextResponse.json({data:{ready:true},request_id:requestId},{headers:{'x-git-tutor-guest':'1'}}));
  }
  data={ready:true};
 }else{
  if(claims.error||!claims.data?.claims.sub)throw new DomainError('AUTH_REQUIRED');
  if(request.method==='GET'){
   const params=request.nextUrl.searchParams,allowed=['state','channel','owner_id','cursor','limit'];if([...params.keys()].some(k=>!allowed.includes(k)||params.getAll(k).length!==1))throw new DomainError('VALIDATION_ERROR');
   if(path.length===0||path.join('/')==='queue')data=await listConversations(scoped.client,path.length>0,{p_state:params.get('state'),p_channel:params.get('channel'),p_owner_id:params.get('owner_id'),p_cursor:params.get('cursor'),p_limit:params.has('limit')?Number(params.get('limit')):25});
   else if(path.join('/')==='options'&&params.size===0)data=await getSupportOptions(scoped.client);else if(path.length===1&&params.size===0)data=await getConversation(scoped.client,path[0]);else throw new DomainError('NOT_FOUND');
  }else{
   if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');if(request.nextUrl.searchParams.size)throw new DomainError('VALIDATION_ERROR');const key=request.headers.get('Idempotency-Key');if(!key)throw new DomainError('VALIDATION_ERROR');
   const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body))throw new DomainError('VALIDATION_ERROR');const args=Object.fromEntries(Object.entries(body).map(([k,v])=>[`p_${k}`,v]));if('p_idempotency_key'in args||'p_conversation_id'in args)throw new DomainError('VALIDATION_ERROR');
   if(scoped.config.providers.whatsapp==='manual'){
    const action=path.length===2?path[1]:null;
    if(path.join('/')==='templates'||path.join('/')==='template-revocations'||action==='reconcile')throw new DomainError('WHATSAPP_MANUAL_CONTACT_ONLY');
    if(action==='reply'&&(await getConversation(scoped.client,path[0])).channel==='whatsapp')throw new DomainError('WHATSAPP_MANUAL_CONTACT_ONLY');
   }
   args.p_idempotency_key=key;if(path.join('/')==='templates')data=await registerWhatsAppTemplate(scoped.client,args);else if(path.join('/')==='template-revocations')data=await revokeWhatsAppTemplate(scoped.client,args);else if(path.join('/')==='hours')data=await setSupportHours(scoped.client,args);else if(path.length===2&&path[1]==='challenge'){args.p_conversation_id=path[0];data=await issueConversationChallenge(scoped.client,args);}else{const name=path.length===0?'start_conversation':path.length===2?actions[path[1]]:null;if(!name)throw new DomainError('NOT_FOUND');if(path.length)args.p_conversation_id=path[0];data=(await invokeSupportCommand(scoped.client,name,args)).data;}
  }
 }
 return scoped.finish(NextResponse.json({data,request_id:requestId},{headers:{'Cache-Control':'private, no-store'}}));
 }catch(error){const safe=safeError(error instanceof z.ZodError?new DomainError('VALIDATION_ERROR'):error),response=NextResponse.json({...safe,request_id:requestId},{status:safe.status,headers:{'Cache-Control':'private, no-store'}});return scoped?scoped.finish(response):response;}}
export const GET=handle;export const POST=handle;
