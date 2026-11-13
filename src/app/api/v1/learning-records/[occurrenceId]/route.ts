import {randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requestSupabase} from '@/server/supabase';
import {allowedOrigin,DomainError,readJson,safeError} from '@/server/http';
import {getLearningRecords,publishLearningRecord} from '@/modules/teaching/learning-records';
export const runtime='nodejs';
async function handle(request:NextRequest,context:{params:Promise<{occurrenceId:string}>}){let scoped:ReturnType<typeof requestSupabase>|undefined;const requestId=randomUUID();try{scoped=requestSupabase(request);const claims=await scoped.client.auth.getClaims();if(claims.error||!claims.data?.claims.sub)throw new DomainError('AUTH_REQUIRED');const{occurrenceId}=await context.params;let data;
 if(request.method==='GET'){const params=request.nextUrl.searchParams;if([...params.keys()].some(k=>!['view','learner_id'].includes(k)||params.getAll(k).length!==1))throw new DomainError('VALIDATION_ERROR');data=await getLearningRecords(scoped.client,occurrenceId,z.enum(['customer','tutor','admin']).parse(params.get('view')),params.get('learner_id'));}
 else{if(!allowedOrigin(request.headers.get('origin'),scoped.config.app_base_url,scoped.config.isolated))throw new DomainError('FORBIDDEN');if(request.nextUrl.searchParams.size)throw new DomainError('VALIDATION_ERROR');const key=request.headers.get('Idempotency-Key');if(!key)throw new DomainError('VALIDATION_ERROR');const body=z.object({learner_id:z.uuid().nullable(),content:z.string(),expected_version:z.number()}).strict().parse(await readJson(request));data=await publishLearningRecord(scoped.client,{p_occurrence_id:occurrenceId,p_learner_id:body.learner_id,p_content:body.content,p_expected_version:body.expected_version,p_idempotency_key:key});}
 return scoped.finish(NextResponse.json({data,request_id:requestId},{headers:{'Cache-Control':'private, no-store'}}));}catch(error){const safe=safeError(error instanceof z.ZodError?new DomainError('VALIDATION_ERROR'):error);const response=NextResponse.json({...safe,request_id:requestId},{status:safe.status,headers:{'Cache-Control':'private, no-store'}});return scoped?scoped.finish(response):response;}}
export const GET=handle;export const POST=handle;
