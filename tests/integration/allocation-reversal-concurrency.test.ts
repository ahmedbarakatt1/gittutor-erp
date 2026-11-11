import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {paymentFixture} from '../helpers/payments';
import {adminDatabase} from '../helpers/supabase';

for(const firstOperation of ['allocation','reversal'] as const)test(`GT-1412 ${firstOperation} commits first while the independent competing connection is demonstrably blocked`,async()=>{
 const f=await paymentFixture({charge:'enrollment'}),connections=await Promise.all([adminDatabase(),adminDatabase()]);
 try{
  const account=await f.receiving(),transfer=await f.transfer(account.id,50000),receipt=await f.receipt(account.versionId,50000);
  const claim=await f.rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:randomUUID()},f.reviewer);
  const evidence=await f.evidence({purpose:'transfer_reversal',parentType:'transfer',parentId:transfer.id});
  const bankSql='select api.record_transfer_reversal($1,$2,$3,$4,$5,$6,$7) data',allocationSql='select api.allocate_transfer($1,$2,$3,$4,$5,$6,$7) data';
  const bankArgs=[transfer.id,randomUUID(),50000,new Date(Date.now()-1000).toISOString(),evidence,transfer.version+(firstOperation==='allocation'?1:0),randomUUID()];
  const allocationArgs=[receipt.case_id,transfer.id,1,null,JSON.stringify([{charge_id:f.chargeId,amount_minor:50000}]),claim.version,randomUUID()];
  const order=firstOperation==='allocation'?['allocation','reversal']:['reversal','allocation'];
  const pids:number[]=[];
  for(let i=0;i<2;i++){
   const client=order[i]==='allocation'?f.reviewer:f.admin,token=(await client.auth.getSession()).data.session!.access_token;
   await connections[i].query('begin');pids.push((await connections[i].query('select pg_backend_pid() pid')).rows[0].pid);
   await connections[i].query("select set_config('request.jwt.claims',$1,true)",[Buffer.from(token.split('.')[1],'base64url').toString()]);await connections[i].query('set local role authenticated');
  }
  const execute=(i:number)=>connections[i].query(order[i]==='allocation'?allocationSql:bankSql,order[i]==='allocation'?allocationArgs:bankArgs).then(result=>({data:result.rows[0].data,error:null as string|null}),error=>({data:null,error:(error as Error).message}));
  const first=await execute(0);expect(first.error).toBeNull();
  const secondPromise=execute(1);let observed=false;
  for(let attempt=0;attempt<100;attempt++){
   const blockers=(await f.database.query('select pg_blocking_pids($1) ids',[pids[1]])).rows[0].ids as number[];
   if(blockers.includes(pids[0])){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(observed).toBe(true);await connections[0].query('commit');let second=await secondPromise;
  if(second.error)await connections[1].query('rollback');else await connections[1].query('commit');
  if(firstOperation==='allocation'&&second.error==='RETRYABLE_CONFLICT'){
   // Allocation attached a new charge graph after discovery. The rejected transaction posted nothing;
   // explicitly retry the identical command with a newly discovered graph and unchanged key.
   expect((await f.database.query('select count(*)::int count from finance_private.transfer_reversals where transfer_id=$1',[transfer.id])).rows[0].count).toBe(0);
   const retried=await f.admin.rpc('record_transfer_reversal',{p_transfer_id:bankArgs[0],p_external_reversal_id:bankArgs[1],p_amount_minor:bankArgs[2],p_effective_at:bankArgs[3],p_evidence_file_id:bankArgs[4],p_expected_version:bankArgs[5],p_idempotency_key:bankArgs[6]});
   second={data:retried.data,error:retried.error?.message??null};
  }
  const reversed=firstOperation==='reversal'?first.data:second.data;
  if(firstOperation==='reversal')expect(second.error).toBe('TRANSFER_UNSETTLED');else expect(second.error).toBeNull();
  const allocation=firstOperation==='allocation'?first.data.allocation_ids[0]:null;
  const currentVersion=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[transfer.id])).rows[0].version;
  const resolved=await f.rpc('resolve_transfer_reversal',{p_reversal_id:reversed.reversal_id,p_allocations:allocation?[{allocation_id:allocation,amount_minor:50000}]:[],p_unapplied_minor:allocation?0:50000,p_reason:'Exact ordered source loss attribution',p_expected_version:currentVersion,p_idempotency_key:randomUUID()});expect(resolved.remaining_unresolved_minor).toBe(0);
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[transfer.id])).rows[0].data).toMatchObject({gross_settled_minor:50000,reversed_minor:50000,net_allocated_minor:0,available_minor:0,unapplied_signed_minor:0,recovery_exposure_minor:0,reconciliation_state:'clear'});
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[f.chargeId])).rows[0].data).toMatchObject({allocated_cash_minor:0,receivable_minor:50000});
  expect((await f.database.query("select sum(signed_minor)::int total from finance_private.ledger_lines where transfer_id=$1 and account_code='channel_cash'",[transfer.id])).rows[0].total).toBe(0);
 }finally{await Promise.all(connections.map(async connection=>{await connection.query('rollback');await connection.end();}));await f.close();}
},30000);
