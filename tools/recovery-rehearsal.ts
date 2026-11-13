import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {Client,Pool} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {adminDatabase,authClient,loadLocalSupabase} from '../tests/helpers/supabase';
import {claimJobs,completeJob} from '../src/worker/claims';
import {executeLeasedJob} from '../src/worker/execute';

// This rehearsal only accepts the explicitly marked loopback synthetic project.
// It preserves the source, creates a new database/private bucket, and retains its
// ignored recovery directory. It never restores into an existing target.
const started=new Date(),run=randomUUID(),suffix=run.replaceAll('-','').slice(0,12);
const restoredName=`gittutor_restore_${suffix}`,bucket=`git-tutor-restore-${suffix}`;
const directory=resolve('.local/recovery',run),container='supabase_db_GitTutor_System';
const config=loadLocalSupabase(),execute=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
await mkdir(directory,{recursive:true});
async function docker(args:string[]){try{return(await execute('docker',args,{timeout:240000,maxBuffer:8*1024*1024})).stdout;}catch(error){await writeFile(resolve(directory,'command-failure.log'),String((error as {stderr?:string}).stderr||'Docker operation failed'),{mode:0o600});throw Error('RECOVERY_DOCKER_COMMAND_FAILED');}}
async function controls(db:Client){
 const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in('api','app_private','finance_private') order by schemaname,tablename")).rows;
 const result:Record<string,{count:string;hash:string}>={};
 for(const t of tables){if(!/^[a-z_]+$/.test(t.schemaname)||!/^[a-z_0-9]+$/.test(t.tablename))throw Error('UNEXPECTED_TABLE');result[`${t.schemaname}.${t.tablename}`]=(await db.query(`select count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from ${t.schemaname}.${t.tablename} t`)).rows[0];}
 return result;
}
const source=await adminDatabase(),learner=await authClient('learner_a');
const service=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});
let restored:Client|undefined,worker:Pool|undefined;
try{
 const labels=JSON.parse(await docker(['inspect',container,'--format','{{json .Config.Labels}}']));assert.equal(labels['com.supabase.cli.project'],'GitTutor_System');
 const token=(await learner.auth.getSession()).data.session!.access_token,claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
 const jobPurpose=`recovery:${run}`,event=randomUUID();await source.query("select app_private.enqueue_event($1,'recovery_rehearsal',$1,'{}',$2)",[event,jobPurpose]);
 await source.query('begin isolation level repeatable read read only');
 const snapshot=(await source.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
 const before=await controls(source),migration=(await source.query('select max(version) version from supabase_migrations.schema_migrations')).rows[0].version;
 const objects=(await source.query("select id,bucket_id,name from storage.objects where bucket_id='git-tutor-private' order by id")).rows as {id:string;bucket_id:string;name:string}[];
 assert.ok(objects.length>0,'Actual private objects required');
 const remote=`/tmp/gittutor-recovery-${run}.dump`;
 await docker(['exec',container,'pg_dump','--username=postgres','--dbname=postgres','--format=custom',`--snapshot=${snapshot}`,'--schema=api','--schema=app_private','--schema=finance_private','--schema=auth','--schema=storage','--schema=extensions','--schema=supabase_migrations',`--file=${remote}`]);
 await docker(['cp',`${container}:${remote}`,resolve(directory,'database.dump')]);
 await source.query('commit');
 // Creating a new named database is deliberate; no DROP/clean/overwrite flags.
 assert.match(restoredName,/^gittutor_restore_[a-f0-9]{12}$/);
 await source.query(`create database ${restoredName} template template0`);
 await docker(['exec',container,'pg_restore','--username=supabase_admin',`--dbname=${restoredName}`,'--section=pre-data','--exit-on-error',remote]);
 // Schema-selective archives omit extension installation. Restore the same local
 // prerequisites before their constraints and application validation functions.
 await docker(['exec',container,'psql','--username=supabase_admin',`--dbname=${restoredName}`,'--set=ON_ERROR_STOP=1','--command','create extension if not exists pgcrypto with schema extensions; create extension if not exists btree_gist with schema extensions; create extension if not exists pg_jsonschema with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create extension if not exists pg_stat_statements with schema extensions;']);
 await docker(['exec',container,'pg_restore','--username=supabase_admin',`--dbname=${restoredName}`,'--section=data','--section=post-data','--exit-on-error',remote]);
 const restoredUrl=new URL(config.database_url);restoredUrl.pathname=`/${restoredName}`;
 restored=new Client({connectionString:restoredUrl.toString()});await restored.connect();
 assert.deepEqual(await controls(restored),before,'Every business table must match the backup snapshot');
 const broken=(await restored.query("select count(*)::integer count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('api','app_private','finance_private') and c.relkind='r'and(not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))")).rows[0].count;assert.equal(broken,0);
 await restored.query('begin');await restored.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);await restored.query('set local role authenticated');
 const account=(await restored.query('select api.get_my_account() result')).rows[0].result;assert.equal(account.account_id,claims.sub);await restored.query('rollback');
 await restored.query('begin');await restored.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);await restored.query('set local role authenticated');
 await assert.rejects(restored.query('select api.list_payout_tutors()'),/FORBIDDEN/);await restored.query('rollback');
 const created=await service.storage.createBucket(bucket,{public:false,fileSizeLimit:26214400});assert.equal(created.error,null);
 const files=[];
 for(const object of objects){
  const input=await service.storage.from(object.bucket_id).download(object.name);assert.equal(input.error,null);assert.ok(input.data);
  const bytes=new Uint8Array(await input.data.arrayBuffer()),checksum=sha(bytes);await writeFile(resolve(directory,`${object.id}.bin`),bytes,{flag:'wx',mode:0o600});
  const saved=await service.storage.from(bucket).upload(object.name,bytes,{contentType:input.data.type||'application/octet-stream',upsert:false});assert.equal(saved.error,null);
  const output=await service.storage.from(bucket).download(object.name);assert.equal(output.error,null);assert.equal(sha(new Uint8Array(await output.data!.arrayBuffer())),checksum);
  files.push({source_bucket:object.bucket_id,name:object.name,backup_file:`${object.id}.bin`,bytes:bytes.byteLength,sha256:checksum});
 }
 const publicResponse=await fetch(`${config.url}/storage/v1/object/public/${bucket}/${objects[0].name}`);assert.equal(publicResponse.ok,false);
 const workerUrl=new URL(config.worker_database_url!);workerUrl.pathname=`/${restoredName}`;worker=new Pool({connectionString:workerUrl.toString()});
 const first=(await claimJobs(worker,jobPurpose,1,60))[0];assert.ok(first);await restored.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second'where id=$1",[first.id]);
 const recovered=(await claimJobs(worker,jobPurpose,1,60))[0];let sends=0;
 const result=await executeLeasedJob(worker,recovered,{execute:async()=>{sends++;return'fake:duplicate';},reconcile:async()=>({outcome:'completed',reference:`fake:restored:${event}`})});assert.equal(result,'completed');assert.equal(sends,0);
 const afterReplay=await controls(restored);for(const [table,value]of Object.entries(before))if(!['app_private.outbox_jobs','app_private.job_attempts','app_private.job_observations'].includes(table))assert.deepEqual(afterReplay[table],value,`Replay changed ${table}`);
 const sourceWorker=new Pool({connectionString:config.worker_database_url});try{const checkpoint=(await claimJobs(sourceWorker,jobPurpose,1,60))[0];assert.ok(checkpoint);await completeJob(sourceWorker,checkpoint,`recovery:verified:${run}`);}finally{await sourceWorker.end();}
 const report={schema_version:1,run_id:run,started_at:started.toISOString(),finished_at:new Date().toISOString(),elapsed_seconds:(Date.now()-started.getTime())/1000,provider_mode:'fake',source:'marked loopback synthetic Supabase',restored_database:restoredName,restored_private_bucket:bucket,migration_version:migration,database_dump_sha256:sha(await readFile(resolve(directory,'database.dump'))),business_tables_verified:Object.keys(before).length,private_objects_verified:files.length,private_bytes_verified:files.reduce((n,f)=>n+f.bytes,0),restored_current_authorization:true,public_file_access_denied:true,replayed_without_redispatch:true,controls:before,files};
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({run_id:run,database:restoredName,business_tables_verified:report.business_tables_verified,private_objects_verified:files.length,elapsed_seconds:report.elapsed_seconds,result:'passed',manifest:resolve(directory,'manifest.json')}));
}catch(error){await source.query('rollback').catch(()=>{});await writeFile(resolve(directory,'failure.json'),JSON.stringify({run_id:run,started_at:started.toISOString(),failed_at:new Date().toISOString(),error:error instanceof Error?error.message:'RECOVERY_FAILED'}),{mode:0o600});throw error;}
finally{await worker?.end();await restored?.end();await learner.auth.signOut({scope:'local'});await source.end();}
