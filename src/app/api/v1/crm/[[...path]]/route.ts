import{randomUUID}from'node:crypto';
import{NextRequest,NextResponse}from'next/server';
import{requestSupabase}from'@/server/supabase';
import{allowedOrigin,DomainError,readJson,safeError}from'@/server/http';
import{listCustomers,getCustomer,listFollowUps,listCrmOwners,listCrmSessions,listIdentityMatches,listCustomerContacts}from'@/modules/crm/queries';
import{invokeCrmCommandWithStatus,type CrmCommandName}from'@/modules/crm/commands';
export const runtime='nodejs';
async function handle(request:NextRequest,context:{params:Promise<{path?:string[]}>}){let scoped:ReturnType<typeof requestSupabase>|undefined;try{
 scoped=requestSupabase(request);const claims=await scoped.client.auth.getClaims();if(claims.error||!claims.data?.claims.sub)throw new DomainError('AUTH_REQUIRED');const path=(await context.params).path||[],query=request.nextUrl.searchParams;let data:unknown;let status=200;
 if(request.method==='GET'){
  const allowed=path.join('/')==='customers'?['q','archived','owner_id','has_balance','cursor','limit']:path.join('/')==='follow-ups'?['learner_id','owner_id','state','cursor','limit']:path.join('/')==='sessions'?['from','to','state','tutor_id','cursor','limit']:path.join('/')==='identity-matches'?['learner_id','state','cursor','limit']:path.join('/')==='owners'?[]:['cursor','limit'];
  if([...query.keys()].some(k=>!allowed.includes(k)||query.getAll(k).length!==1))throw new DomainError('VALIDATION_ERROR');const args:Record<string,unknown>=Object.fromEntries(query);if(query.has('limit'))args.limit=Number(query.get('limit'));for(const key of['archived','has_balance'])if(query.has(key)){if(!['true','false'].includes(query.get(key)!))throw new DomainError('VALIDATION_ERROR');args[key]=query.get(key)==='true';}
  if(path.join('/')==='customers')data=await listCustomers(scoped.client,args);
  else if(path[0]==='customers'&&path.length===2)data=await getCustomer(scoped.client,path[1],args);
  else if(path[0]==='customers'&&path.length===3&&path[2]==='contacts')data=await listCustomerContacts(scoped.client,path[1],args);
  else if(path.join('/')==='follow-ups')data=await listFollowUps(scoped.client,args);
  else if(path.join('/')==='owners')data=await listCrmOwners(scoped.client);
  else if(path.join('/')==='sessions')data=await listCrmSessions(scoped.client,args);
  else if(path.join('/')==='identity-matches')data=await listIdentityMatches(scoped.client,args);
  else throw new DomainError('NOT_FOUND');
 }else{
  if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');if(query.size)throw new DomainError('VALIDATION_ERROR');const key=request.headers.get('Idempotency-Key');if(!key)throw new DomainError('VALIDATION_ERROR');const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body))throw new DomainError('VALIDATION_ERROR');const args=Object.fromEntries(Object.entries(body).map(([k,v])=>[`p_${k}`,v]));if(['p_idempotency_key','p_learner_id','p_follow_up_id','p_match_id'].some(k=>k in args))throw new DomainError('VALIDATION_ERROR');args.p_idempotency_key=key;let name:CrmCommandName;
  if(path[0]==='customers'&&path.length===3&&['follow-ups','archive','contacts'].includes(path[2])){args.p_learner_id=path[1];name=path[2]==='archive'?'set_customer_archived':path[2]==='contacts'?'record_customer_contact':'assign_follow_up';}
  else if(path[0]==='follow-ups'&&path.length===3&&path[2]==='complete'){args.p_follow_up_id=path[1];name='complete_follow_up';}
  else if(path[0]==='identity-matches'&&path.length===3&&path[2]==='review'){args.p_match_id=path[1];name='review_identity_match';}
  else throw new DomainError('NOT_FOUND');const result=await invokeCrmCommandWithStatus(scoped.client,name,args);data=result.data;status=result.status;
 }
 return scoped.finish(NextResponse.json({data,request_id:randomUUID()},{status,headers:{'Cache-Control':'private, no-store'}}));
 }catch(error){const safe=safeError(error),response=NextResponse.json({...safe,request_id:randomUUID()},{status:safe.status,headers:{'Cache-Control':'private, no-store'}});return scoped?scoped.finish(response):response;}}
export const GET=handle;export const POST=handle;
