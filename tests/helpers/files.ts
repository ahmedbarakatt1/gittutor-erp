import { Pool,type Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase,loadLocalSupabase } from './supabase';
import { fileScanHandler } from '../../src/worker/file-scan';
import { createFakeScanAdapter, type ScanScenario, type ScanAdapter } from '../../src/server/providers/file-scan';
import { executeLeasedJob } from '../../src/worker/execute';
import { claimJobs } from '../../src/worker/claims';
export const syntheticPdf=Buffer.from('%PDF-1.4\n% Synthetic preparation fixture\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
/** Restricts only this claim transaction; never drains or edits unrelated durable jobs. */
export async function claimFileScan(database:Client,worker:Pool,jobId:string){
 await database.query('begin');try{await database.query("select id from app_private.outbox_jobs where purpose='files.scan' and id<>$1 for update",[jobId]);const jobs=await claimJobs(worker,'files.scan',1,60);if(jobs.length!==1||jobs[0].id!==jobId)throw new Error('FILE_TEST_JOB_NOT_CLAIMED');return jobs[0];}finally{await database.query('rollback');}
}
export async function runFileScan(jobId:string, factory: (scenario: ScanScenario) => ScanAdapter = scenario => createFakeScanAdapter(scenario,true)){const config=loadLocalSupabase(),database=await adminDatabase(),worker=new Pool({connectionString:config.worker_database_url}),storage=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});try{const handler=fileScanHandler(worker,async file=>{const response=await storage.storage.from('git-tutor-private').download(file.object_key);if(response.error||!response.data)throw new Error('SYNTHETIC_SCAN_OBJECT_MISSING');if(response.data.size>26214400)throw new Error('FILE_TOO_LARGE');return new Uint8Array(await response.data.arrayBuffer());},factory);return await executeLeasedJob(worker,await claimFileScan(database,worker,jobId),handler);}finally{await worker.end();await database.end();}}
