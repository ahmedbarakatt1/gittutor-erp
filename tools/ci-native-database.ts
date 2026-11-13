import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {Client} from 'pg';
const execute=promisify(execFile);
if(process.env.CI!=='true')throw new Error('DISPOSABLE_CI_REQUIRED');
await mkdir('.local',{recursive:true});
if(await access('.local/database.json').then(()=>true,()=>false))throw new Error('EXISTING_LOCAL_DATABASE_PRESERVED');
const password=randomBytes(16).toString('hex'),workerPassword=randomBytes(16).toString('hex');
await execute('docker',['run','--detach','--name','gittutor-ci-postgres','--publish','127.0.0.1:55432:5432','--env',`POSTGRES_PASSWORD=${password}`,'postgres:17.12'],{timeout:180000});
for(let attempt=0;;attempt++){
 const db=new Client({host:'127.0.0.1',port:55432,user:'postgres',password,database:'postgres',connectionTimeoutMillis:1500});
 try{await db.connect();await db.query('create database gittutor_dev');await db.query('create database gittutor_test');await db.end();break;}
 catch(error){await db.end().catch(()=>{});if(attempt>=29)throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
}
await writeFile('.local/database.json',JSON.stringify({marker:'git-tutor-disposable-v1',port:55432,password,worker_password:workerPassword}),{flag:'wx',mode:0o600});
console.log('Created isolated CI foundation database; credentials remain private.');
