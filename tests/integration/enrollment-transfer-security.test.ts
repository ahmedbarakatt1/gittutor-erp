import{randomUUID}from'node:crypto';
import{expect,test}from'vitest';
import{enrollmentTransferFixture}from'../helpers/enrollment-transfer';
import{adminDatabase,authClient}from'../helpers/supabase';
import{getEnrollmentTransferProposal,getEnrollmentTransferConsent}from'../../src/modules/booking/enrollment-transfers';

test('only the verified original payer can carry funds even when that payer has zero learner or guardian roles',async()=>{
 const f=await enrollmentTransferFixture({sourcePayerWithoutRoles:true});
 try{
  const payerId=(await f.payer.auth.getUser()).data.user!.id;
  expect((await f.database.query('select count(*)::int n from app_private.account_roles where account_id=$1 and revoked_at is null',[payerId])).rows[0].n).toBe(0);
  await f.acceptLearner();await f.acceptTutorAndApprove();
  const consentId=(await f.database.query('select id from app_private.enrollment_transfer_consents where proposal_id=$1',[f.proposalId])).rows[0].id;
  const intent=await getEnrollmentTransferConsent(f.payer,consentId);
  expect(JSON.stringify(intent)).not.toMatch(/learner_id|display_name|fee_minor|allocation_id|payer_account_id/);
  expect((await f.learner.rpc('accept_enrollment_transfer_consent',{p_consent_id:consentId,p_terms_hash:intent.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()})).error?.message).toBe('NOT_FOUND');
  expect((await f.payer.rpc('get_my_charge',{p_charge_id:intent.destination_charge_id})).error?.message).toBe('NOT_FOUND');
  await f.acceptPayer(f.payer);const result=await f.rpc('transfer_enrollment',f.applyArgs);expect(result.state).toBe('cancelled');
  expect((await f.database.query('select b.payer_account_id from finance_private.payment_allocations a join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id where a.enrollment_transfer_consent_id=$1',[consentId])).rows[0].payer_account_id).toBe(payerId);
 }finally{await f.close();}
},30000);

test('revoked guardian payment scope blocks current transfer reads, committed replay intent and financial application',async()=>{
 const f=await enrollmentTransferFixture();
 try{
  const contacts=await f.rpc('get_my_verified_contacts',{},f.tutor);
  const invite=await f.rpc('create_guardian_invitation',{p_contact_id:(contacts.items as {contact_id:string}[])[0].contact_id,p_scopes:['booking','payments'],p_expires_at:new Date(Date.now()+86400000).toISOString(),p_idempotency_key:randomUUID()},f.learner);
  const event=(await f.database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1",[invite.invitation_id])).rows[0].payload;
  const link=await f.rpc('accept_guardian_invitation',{p_invitation_id:invite.invitation_id,p_single_use_token:event.single_use_token,p_expected_version:1,p_idempotency_key:randomUUID()},f.tutor);
  const terms=await getEnrollmentTransferProposal(f.tutor,f.proposalId,{view:'customer',learner_id:f.learnerId});
  const accepted={p_proposal_id:f.proposalId,p_terms_hash:terms.terms_hash,p_expected_version:terms.version,p_idempotency_key:randomUUID()};
  await f.rpc('accept_operation_proposal',accepted,f.tutor);await f.acceptTutorAndApprove();await f.acceptPayer();
  await f.rpc('revoke_guardian_link',{p_guardian_link_id:link.guardian_link_id,p_reason:'Revoke only isolated explicit relationship',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  expect((await f.tutor.rpc('get_enrollment_transfer_proposal',{p_proposal_id:f.proposalId,p_view:'customer',p_learner_id:f.learnerId})).error?.message).toBe('NOT_FOUND');
  expect((await f.tutor.rpc('accept_operation_proposal',accepted)).error?.message).toBe('NOT_FOUND');
  expect((await f.admin.rpc('transfer_enrollment',f.applyArgs)).error?.message).toBe('CONSENT_REQUIRED');
  expect(await getEnrollmentTransferProposal(f.admin,f.proposalId,{view:'admin'})).toMatchObject({can_apply:false});
  expect((await f.database.query('select state from app_private.enrollments where id=$1',[f.sourceId])).rows[0].state).toBe('confirmed');
 }finally{await f.close();}
},30000);

for(const firstOperation of ['transfer','reversal'] as const)test(`independent ${firstOperation}-first source-loss race preserves cash and charge lineage`,async()=>{
 const f=await enrollmentTransferFixture(),connections=await Promise.all([adminDatabase(),adminDatabase()]),other=await authClient('admin_a');
 try{
  await f.acceptLearner();await f.acceptTutorAndApprove();await f.acceptPayer();
  const evidence=await f.evidence({purpose:'transfer_reversal',parentType:'transfer',parentId:f.paid.transferId});
  const version=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[f.paid.transferId])).rows[0].version as number;
  const bankArgs=[f.paid.transferId,randomUUID(),50000,new Date().toISOString(),evidence,version+(firstOperation==='transfer'?2:0),randomUUID()];
  const order=firstOperation==='transfer'?['transfer','reversal']:['reversal','transfer'];
  const pids:number[]=[];
  for(let i=0;i<2;i++){
   const token=(await(i===0?f.admin:other).auth.getSession()).data.session!.access_token;
   await connections[i].query('begin');pids.push((await connections[i].query('select pg_backend_pid() pid')).rows[0].pid);
   await connections[i].query("select set_config('request.jwt.claims',$1,true)",[Buffer.from(token.split('.')[1],'base64url').toString()]);await connections[i].query('set local role authenticated');
  }
  const execute=(i:number)=>connections[i].query(order[i]==='transfer'?'select api.transfer_enrollment($1,$2,$3,$4,$5) data':'select api.record_transfer_reversal($1,$2,$3,$4,$5,$6,$7) data',order[i]==='transfer'?Object.values(f.applyArgs):bankArgs).then(result=>({data:result.rows[0].data,error:null as string|null}),error=>({data:null,error:(error as Error).message}));
  const first=await execute(0);expect(first.error).toBeNull();
  const pending=execute(1);let blocked=false;
  for(let i=0;i<100;i++){const ids=(await f.database.query('select pg_blocking_pids($1) ids',[pids[1]])).rows[0].ids as number[];if(ids.includes(pids[0])){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  expect(blocked).toBe(true);await connections[0].query('commit');let second=await pending;
  await connections[1].query(second.error?'rollback':'commit');
  if(firstOperation==='transfer'&&second.error==='RETRYABLE_CONFLICT'){
   const retry=await other.rpc('record_transfer_reversal',{p_transfer_id:bankArgs[0],p_external_reversal_id:bankArgs[1],p_amount_minor:bankArgs[2],p_effective_at:bankArgs[3],p_evidence_file_id:bankArgs[4],p_expected_version:bankArgs[5],p_idempotency_key:bankArgs[6]});second={data:retry.data,error:retry.error?.message??null};
  }
  if(firstOperation==='transfer')expect(second.error).toBeNull();else expect(second.error).toBe('CONSENT_REQUIRED');
  const reversal=firstOperation==='reversal'?first.data:second.data;
  const active=(await f.database.query('select a.id,a.charge_id from finance_private.payment_allocations a where transfer_id=$1 and amount_minor>coalesce((select sum(amount_minor) from finance_private.allocation_reversals where allocation_id=a.id),0)',[f.paid.transferId])).rows;
  expect(active).toHaveLength(1);
  const current=(await f.database.query('select version from finance_private.incoming_transfers where id=$1',[f.paid.transferId])).rows[0].version;
  await f.rpc('resolve_transfer_reversal',{p_reversal_id:reversal.reversal_id,p_allocations:[{allocation_id:active[0].id,amount_minor:50000}],p_unapplied_minor:0,p_reason:'Exact current original source attribution after ordered race',p_expected_version:current,p_idempotency_key:randomUUID()});
  expect((await f.database.query('select finance_private.finance_transfer_balance($1) data',[f.paid.transferId])).rows[0].data).toMatchObject({gross_settled_minor:50000,reversed_minor:50000,net_allocated_minor:0,available_minor:0,unapplied_signed_minor:0,recovery_exposure_minor:0});
  expect((await f.database.query('select finance_private.finance_charge_balance($1) data',[active[0].charge_id])).rows[0].data).toMatchObject({receivable_minor:50000,allocated_cash_minor:0});
  expect((await f.database.query("select sum(signed_minor)::int n from finance_private.ledger_lines where transfer_id=$1 and account_code='channel_cash'",[f.paid.transferId])).rows[0].n).toBe(0);
 }finally{await Promise.all(connections.map(async c=>{await c.query('rollback');await c.end();}));await other.auth.signOut({scope:'local'});await f.close();}
},30000);
