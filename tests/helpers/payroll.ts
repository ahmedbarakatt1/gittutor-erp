import assert from'node:assert/strict';
import{createHash,randomUUID}from'node:crypto';
import{Pool}from'pg';
import{completionFixture}from'./completion';
import{loadLocalSupabase}from'./supabase';
import{syntheticPdf,runFileScan}from'./files';
import{createFileContentService}from'../../src/server/files';
import{parseServerConfig}from'../../src/server/config';
import{createIdentifierCipher}from'../../src/server/private-identifiers';
import{createPayoutDestinationTransport}from'../../src/server/payout-destination-transport';
import{privatePayoutDestinationPort}from'../../src/server/payout-destination-server';
import{invokeFileCommandWithStatus}from'../../src/modules/files/commands';
import{invokePayrollCommandWithStatus}from'../../src/modules/tutor_pay/payroll';
type Fixture=Awaited<ReturnType<typeof completionFixture>>;
export async function approvePayrollEarning(f:Fixture){const s=await f.rpc('start_occurrence',{p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_expected_version:2,p_idempotency_key:randomUUID()},f.tutor);const a=await f.rpc('record_attendance',{p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_actual_end_at:f.actualEnd,p_entries:[{enrollment_id:f.enrollmentId,attendance:'present',attended_seconds:3600,reason:null}],p_expected_version:s.version,p_idempotency_key:randomUUID()},f.tutor);const c=await f.rpc('submit_completion',{p_occurrence_id:f.occurrenceId,p_attendance_version:a.attendance_version,p_topic_summary:'Genuine synthetic approved delivery for payroll',p_delivery_exception_ids:[],p_expected_version:a.version,p_idempotency_key:randomUUID()},f.tutor);return(await f.rpc('approve_completion',{p_occurrence_id:f.occurrenceId,p_completion_version:1,p_approved_remedy_ids:[],p_expected_version:c.version,p_idempotency_key:randomUUID()})).base_earning_id as string;}
type PayoutFixture = Pick<Fixture, 'admin' | 'database' | 'tutorId' | 'tutor'>;
export async function payrollTools(f:PayoutFixture){const local=loadLocalSupabase(),worker=new Pool({connectionString:local.worker_database_url});const config=parseServerConfig({APP_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:local.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.publishable_key,SUPABASE_SECRET_KEY:local.secret_key}),content=createFileContentService(worker,config),cipher=createIdentifierCipher({currentKeyId:'synthetic-payroll',currentKey:'87'.repeat(32)}),port=privatePayoutDestinationPort(worker);
 const transport=(client:Fixture['admin'])=>createPayoutDestinationTransport({client,cipher,port});
 async function actor(client:Fixture['admin']){const result=await client.auth.getClaims();assert.equal(result.error,null);const claims=result.data!.claims;return{account_id:claims.sub,session_id:String(claims.session_id)};}
 async function evidence(action:'verify_payout_destination'|'reconcile_payout'|'record_payout_reversal', parent:string,
   bytes:Buffer = syntheticPdf, filename = 'synthetic-payout-evidence.pdf') {
   const checksum = createHash('sha256').update(bytes).digest('hex');
   const made = await invokeFileCommandWithStatus(f.admin, 'create_file_upload', {
     p_purpose:'review_evidence', p_evidence_action:action, p_parent_id:parent, p_filename:filename,
     p_declared_type:'application/pdf', p_size_bytes:bytes.length, p_checksum_sha256:checksum, p_idempotency_key:randomUUID(),
   });
   await content.upload(f.admin, made.data.file_id, bytes);
   const finalized = await invokeFileCommandWithStatus(f.admin, 'finalize_file_upload', {
     p_file_id:made.data.file_id, p_checksum_sha256:checksum, p_idempotency_key:randomUUID(),
   });
   assert.equal(await runFileScan(finalized.data.scan_job_id), 'completed');
   return made.data.file_id;
 }
 async function destination(){const setting=(await f.database.query('select version from finance_private.tutor_payout_settings where tutor_id=$1',[f.tutorId])).rows[0];await invokePayrollCommandWithStatus(f.admin,'set_tutor_payout_methods',{p_tutor_id:f.tutorId,p_channels:['instapay','vodafone_cash'],p_expected_version:setting?.version??1,p_idempotency_key:randomUUID()});const submit={p_channel:'instapay',p_identifier:`synthetic-${randomUUID()}@instapay`,p_payee_name:'Synthetic tutor payout',p_idempotency_key:randomUUID()};const made=await transport(f.tutor).submit(await actor(f.tutor),submit);assert.deepEqual((await transport(f.tutor).submit(await actor(f.tutor),submit)).data,made.data);const d=made.data as{destination_id:string;version:number};const verified=await transport(f.admin).verify(await actor(f.admin),{p_destination_id:d.destination_id,p_evidence_file_id:await evidence('verify_payout_destination',d.destination_id),p_decision:'verified',p_reason:'Actual scanned synthetic ownership evidence',p_expected_version:d.version,p_idempotency_key:randomUUID()});return{destinationId:d.destination_id,versionId:(verified.data as{destination_version_id:string}).destination_version_id};}
 return{worker,transport,actor,evidence,destination,close:()=>worker.end()};}
/** Real encrypted destination, evidence scan, authorization and settled posting; no direct payroll row writes. */
export async function settleTutorPayout(f:PayoutFixture & Pick<Fixture, 'receivingAccount'>,earningId:string,amountMinor=15000,receivingAccountId=f.receivingAccount.id){const tools=await payrollTools(f);try{const destination=await tools.destination();const made=await invokePayrollCommandWithStatus(f.admin,'authorize_payout',{p_tutor_id:f.tutorId,p_destination_version_id:destination.versionId,p_allocations:[{earning_id:earningId,amount_minor:amountMinor}],p_idempotency_key:randomUUID()});const attempt=made.data as{payout_attempt_id:string;version:number};const args={p_payout_attempt_id:attempt.payout_attempt_id,p_outcome:'settled',p_receiving_account_id:receivingAccountId,p_external_reference:`synthetic-payout-${randomUUID()}`,p_evidence_file_id:await tools.evidence('reconcile_payout',attempt.payout_attempt_id),p_settled_at:new Date().toISOString(),p_expected_version:attempt.version,p_idempotency_key:randomUUID()};const result=await invokePayrollCommandWithStatus(f.admin,'reconcile_payout',args);assert.deepEqual(await invokePayrollCommandWithStatus(f.admin,'reconcile_payout',args),result);return{...destination,attemptId:attempt.payout_attempt_id,result};}finally{await tools.close();}}
