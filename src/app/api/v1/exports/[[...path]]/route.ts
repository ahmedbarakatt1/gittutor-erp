import{randomUUID}from'node:crypto';
import{NextRequest,NextResponse}from'next/server';
import{requestSupabase}from'@/server/supabase';
import{allowedOrigin,DomainError,readJson,safeError}from'@/server/http';
import{getExport,listMyExports}from'@/modules/crm/queries';
import{invokeCrmCommandWithStatus}from'@/modules/crm/commands';
import{downloadExport}from'@/server/exports';
export const runtime='nodejs';
async function handle(request:NextRequest,{params}:{params:Promise<{path?:string[]}>}){let scoped:ReturnType<typeof requestSupabase>|undefined;try{
 scoped=requestSupabase(request);const claims=await scoped.client.auth.getClaims();if(claims.error||!claims.data?.claims.sub)throw new DomainError('AUTH_REQUIRED');const path=(await params).path||[],query=request.nextUrl.searchParams;let data:unknown;let status=200;
 if(request.method==='GET'){
  if(path.length===0){if([...query.keys()].some(k=>!['cursor','limit'].includes(k)||query.getAll(k).length!==1))throw new DomainError('VALIDATION_ERROR');data=await listMyExports(scoped.client,{...(query.has('cursor')?{cursor:query.get('cursor')}:{}),...(query.has('limit')?{limit:Number(query.get('limit'))}:{})});}
  else{if(query.size)throw new DomainError('VALIDATION_ERROR');if(path.length===1)data=await getExport(scoped.client,path[0]);else if(path.length===2&&path[1]==='content'){const bytes=new Uint8Array(await downloadExport(scoped.client,path[0]));return scoped.finish(new NextResponse(bytes,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Length':String(bytes.byteLength),'Content-Disposition':'attachment; filename="git-tutor-export.csv"','Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}}));}else throw new DomainError('NOT_FOUND');}
 }else{
  if(path.length||query.size)throw new DomainError('NOT_FOUND');if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');const key=request.headers.get('Idempotency-Key'),body=await readJson(request);if(!key||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['kind','filters','columns','as_of'].includes(k)))throw new DomainError('VALIDATION_ERROR');const result=await invokeCrmCommandWithStatus(scoped.client,'request_export',{...Object.fromEntries(Object.entries(body).map(([k,v])=>[`p_${k}`,v])),p_idempotency_key:key});data=result.data;status=result.status;
 }
 return scoped.finish(NextResponse.json({data,request_id:randomUUID()},{status,headers:{'Cache-Control':'private, no-store'}}));
 }catch(error){const safe=safeError(error),response=NextResponse.json({...safe,request_id:randomUUID()},{status:safe.status,headers:{'Cache-Control':'private, no-store'}});return scoped?scoped.finish(response):response;}}
export const GET=handle;export const POST=handle;
