import{createHash}from'node:crypto';
import{Pool}from'pg';
import{createClient}from'@supabase/supabase-js';
import{adminDatabase,loadLocalSupabase}from'./supabase';
import{claimJobs}from'../../src/worker/claims';
import{executeLeasedJob}from'../../src/worker/execute';
import{exportRenderHandler}from'../../src/worker/exports';
/** Browser evidence uses actual private Storage and a targeted restricted worker lease. */
export async function runBrowserExport(jobId:string){const local=loadLocalSupabase(),database=await adminDatabase(),worker=new Pool({connectionString:local.worker_database_url}),client=createClient(local.url,local.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});try{
 await database.query('begin');let jobs;try{await database.query("select id from app_private.outbox_jobs where purpose='exports.render'and id<>$1 for update",[jobId]);jobs=await claimJobs(worker,'exports.render',1,60);}finally{await database.query('rollback');}if(jobs.length!==1||jobs[0].id!==jobId)throw new Error('EXPORT_TEST_JOB_NOT_CLAIMED');
 const handler=exportRenderHandler(worker,{async put(descriptor,bytes){const result=await client.storage.from('git-tutor-private').upload(descriptor.object_key,bytes,{upsert:false,contentType:'text/csv'});if(result.error&&!['400','409'].includes(String(result.error.statusCode)))throw new Error('EXPORT_STORAGE_FAILED');const download=await client.storage.from('git-tutor-private').download(descriptor.object_key);if(download.error||!download.data)throw new Error('EXPORT_STORAGE_FAILED');const actual=new Uint8Array(await download.data.arrayBuffer());if(actual.length!==descriptor.size_bytes||createHash('sha256').update(actual).digest('hex')!==descriptor.checksum_sha256)throw new Error('EXPORT_STORAGE_MISMATCH');}});
 return await executeLeasedJob(worker,jobs[0],handler);
 }finally{await worker.end();await database.end();}}
