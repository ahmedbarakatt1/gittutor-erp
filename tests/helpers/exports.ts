import{Pool,type Client}from'pg';
import{loadLocalSupabase}from'./supabase';
import{parseServerConfig}from'../../src/server/config';
import{createPrivateObjectStore}from'../../src/server/files';
import{createExportDownloadService}from'../../src/server/exports';
import{claimJobs}from'../../src/worker/claims';
import{executeLeasedJob}from'../../src/worker/execute';
import{exportRenderHandler}from'../../src/worker/exports';
export function exportInfrastructure(){const local=loadLocalSupabase(),worker=new Pool({connectionString:local.worker_database_url}),config=parseServerConfig({APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:local.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.publishable_key,SUPABASE_SECRET_KEY:local.secret_key}),store=createPrivateObjectStore(config);return{worker,store,download:createExportDownloadService(worker,store),close:()=>worker.end()};}
export async function claimExport(database:Client,worker:Pool,jobId:string){await database.query('begin');try{await database.query("select id from app_private.outbox_jobs where purpose='exports.render'and id<>$1 for update",[jobId]);const jobs=await claimJobs(worker,'exports.render',1,60);if(jobs.length!==1||jobs[0].id!==jobId)throw new Error('EXPORT_TEST_JOB_NOT_CLAIMED');return jobs[0];}finally{await database.query('rollback');}}
export async function renderExport(database:Client,jobId:string){const infra=exportInfrastructure();try{return await executeLeasedJob(infra.worker,await claimExport(database,infra.worker,jobId),exportRenderHandler(infra.worker,infra.store));}finally{await infra.close();}}
