import type { Pool } from 'pg';
import type { PrivateDestinationPort } from '../../src/server/refund-destination-transport';

export function databaseDestinationPort(worker:Pool):PrivateDestinationPort {
 const query=async(sql:string,args:unknown[])=>(await worker.query(sql,args)).rows[0].data;
 return {
  prepare:(actor,refund,key)=>query('select app_private.prepare_refund_destination_context($1,$2,$3,$4) data',[actor.account_id,actor.session_id,refund,key]),
  read:(actor,destination,purpose,attempt,reason)=>query('select app_private.read_refund_destination_for_server($1,$2,$3,$4,$5,$6) data',[actor.account_id,actor.session_id,destination,purpose,attempt,reason]),
  issue:(actor,input)=>query('select app_private.issue_destination_validation_artifact($1,$2,$3,$4,$5,$6,$7,$8,$9) data',[actor.account_id,actor.session_id,input.destination_id,input.destination_version,input.ciphertext_digest,input.masked_identifier,input.identifier_fingerprint,input.purpose,input.approval_request]),
 };
}


/** Genuine local source-owned request plus independently verified encrypted candidate; no monetary approval. */
export async function createVerifiedRefund(f:Awaited<ReturnType<typeof import('./payments').paymentFixture>>,amount=5000,existingTransferId?:string){
 const {randomBytes,randomUUID}=await import('node:crypto');
 const {createIdentifierCipher}=await import('../../src/server/private-identifiers');
 const {createRefundDestinationTransport}=await import('../../src/server/refund-destination-transport');
 const {Pool}=await import('pg');const {loadLocalSupabase}=await import('./supabase');
 const worker=new Pool({connectionString:loadLocalSupabase().worker_database_url});
 try{
  const transferId=existingTransferId??(await f.transfer((await f.receiving()).id,55000)).id;
  const request=await f.rpc('request_refund',{p_source_type:'unapplied_credit',p_source_id:transferId,p_payer_account_id:null,p_amount_minor:amount,p_reason:'Synthetic actual payer surplus refund',p_idempotency_key:randomUUID()},f.learner);
  const actor=async(client:typeof f.learner)=>{const session=(await client.auth.getSession()).data.session!;return {account_id:session.user.id,session_id:JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()).session_id as string};};
  const cipher=createIdentifierCipher({currentKeyId:'test-v1',currentKey:randomBytes(32).toString('hex')}),port=databaseDestinationPort(worker);
  const sourceEvidence=await f.evidence({purpose:'refund_destination',parentType:'refund',parentId:request.refund_id as string,uploaderId:f.learnerAccountId});
  const proposed=await createRefundDestinationTransport({cipher,port,client:f.learner}).propose(await actor(f.learner),{p_refund_id:request.refund_id,p_channel:'instapay',p_identifier:`synthetic-${randomUUID()}@instapay`,p_payee_name:'Synthetic source owner',p_source_evidence_file_id:sourceEvidence,p_expected_version:1,p_idempotency_key:randomUUID()});
  const evidence=await f.evidence({purpose:'refund_destination_verification',parentType:'refund_destination',parentId:proposed.data.destination_id});
  const verified=await createRefundDestinationTransport({cipher,port,client:f.admin}).verify(await actor(f.admin),{p_destination_id:proposed.data.destination_id,p_evidence_file_id:evidence,p_decision:'verified',p_reason:'Independent synthetic ownership evidence',p_expected_version:1,p_idempotency_key:randomUUID()});
  return {refundId:request.refund_id as string,transferId,destinationId:proposed.data.destination_id,destinationVersionId:verified.data.destination_version_id!,version:2};
 }finally{await worker.end();}
}
