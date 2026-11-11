import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {adminDatabase,authClient,loadLocalSupabase} from '../tests/helpers/supabase';
import {fixtureId} from './db-seed';

type Json=Record<string,unknown>;
const sourceVersion='t06-payment-seed-v1';

/** Disposable local synthetic metadata and genuine authorized financial commands; no uploaded-byte attestation. */
export async function seedPayments(){
 const database=await adminDatabase(),config=loadLocalSupabase(),admin=await authClient('admin_a'),learner=await authClient('learner_a');
 try{
  await database.query("select pg_advisory_lock(hashtextextended('git-tutor:payment-seed:v1',0))");
  const current=await admin.rpc('get_my_account');if(current.error||!current.data.roles.includes('admin'))throw new Error('PAYMENT_SEED_ADMIN_REQUIRED');
  const source=(await database.query("select content from app_private.synthetic_fixture_registry where label='package_named_v2'")).rows[0]?.content as Json|undefined;if(!source)throw new Error('PAYMENT_SEED_PACKAGE_REQUIRED');
  const chargeId=source.charge_id as string,learnerId=(await database.query('select learner_id from finance_private.charges where id=$1',[chargeId])).rows[0]?.learner_id as string;if(!learnerId)throw new Error('PAYMENT_SEED_CHARGE_REQUIRED');
  const clock=(await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,'payment_seed_clock_v1','payment_seed',$2) on conflict(label) do update set label=excluded.label returning content",[fixtureId('payment_seed_clock_v1'),{source_version:sourceVersion,observed_at:new Date(Date.now()-60000).toISOString()}])).rows[0].content;
  if(clock.source_version!==sourceVersion)throw new Error('PAYMENT_SEED_SOURCE_CONFLICT');
  async function rpc(name:string,args:Json,client=admin){const result=await client.rpc(name,args);if(result.error)throw new Error(`PAYMENT_SEED_COMMAND_FAILED:${name}:${result.error.message}`);return result.data as Json;}
  async function evidence(label:string,purpose:string,parentType:string,parentId:string|null,customer=false){
   const id=fixtureId(`payment_seed_file:${label}`),mapping={uploader_account_id:customer?config.actors.learner_a.id:config.actors.admin_a.id,learner_id:customer?learnerId:null,charge_id:customer?chargeId:null,parent_type:parentType,parent_id:parentId,purpose,object_key:`synthetic-payment-metadata/${label}`,object_version:sourceVersion,checksum_sha256:createHash('sha256').update(`${sourceVersion}:${label}`).digest('hex'),detected_mime:'application/pdf',byte_size:512,scan_state:'clean',source_provenance:'synthetic_development_metadata_no_bytes'};
   const prior=(await database.query("select to_jsonb(f)-array['id','created_at'] data from app_private.files f where id=$1",[id])).rows[0]?.data;
   if(prior){if(!(await database.query('select $1::jsonb @> $2::jsonb equal',[prior,mapping])).rows[0].equal)throw new Error('PAYMENT_SEED_EVIDENCE_CONFLICT');}
   else await database.query('insert into app_private.files(id,uploader_account_id,learner_id,charge_id,parent_type,parent_id,purpose,object_key,object_version,checksum_sha256,detected_mime,byte_size,scan_state,source_provenance) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,mapping.uploader_account_id,mapping.learner_id,mapping.charge_id,parentType,parentId,purpose,mapping.object_key,sourceVersion,mapping.checksum_sha256,mapping.detected_mime,512,'clean',mapping.source_provenance]);
   return id;
  }
  const ownership=await evidence('receiving','receiving_ownership','receiving_account',null);
  const receiving=await rpc('create_receiving_account',{p_channel:'instapay',p_collection_identifier:'synthetic-git-tutor@instapay',p_display_instructions:'Synthetic local demonstration only. Do not send real money.',p_ownership_evidence_file_id:ownership,p_idempotency_key:`${sourceVersion}:receiving`});
  await rpc('approve_receiving_account',{p_receiving_account_id:receiving.resource_id,p_enabled:true,p_verification_note:'Synthetic metadata fixture; live collection ownership is not asserted',p_expected_version:1,p_idempotency_key:`${sourceVersion}:receiving-approve`});
  const receivingVersion=(await database.query('select current_version_id from finance_private.receiving_accounts where id=$1',[receiving.resource_id])).rows[0].current_version_id as string;
  const statement=await evidence('statement','statement','receiving_account',receiving.resource_id as string);
  const transfer=await rpc('record_manual_transfer',{p_receiving_account_id:receiving.resource_id,p_channel:'instapay',p_external_id:sourceVersion,p_amount_minor:55000,p_currency:'EGP',p_observed_at:clock.observed_at,p_statement_evidence_file_id:statement,p_idempotency_key:`${sourceVersion}:transfer`});
  await rpc('verify_transfer_settlement',{p_transfer_id:transfer.resource_id,p_statement_evidence_id:statement,p_external_id:sourceVersion,p_settled_at:clock.observed_at,p_amount_minor:55000,p_currency:'EGP',p_verification_note:'Synthetic isolated settlement scenario backed by declared metadata fixture',p_expected_version:1,p_idempotency_key:`${sourceVersion}:settlement`});
  const payerEvidence=await evidence('payer','payer_ownership','transfer',transfer.resource_id as string);
  await rpc('bind_transfer_payer',{p_transfer_id:transfer.resource_id,p_payer_account_id:config.actors.learner_a.id,p_evidence_file_id:payerEvidence,p_reason:'Synthetic verified source owner',p_expected_version:2,p_idempotency_key:`${sourceVersion}:payer`});
  const receiptFile=await evidence('receipt','payment_receipt','charge',chargeId,true);
  const receipt=await rpc('submit_receipt',{p_enrollment_id:null,p_charge_id:chargeId,p_file_id:receiptFile,p_receiving_account_version_id:receivingVersion,p_channel:'instapay',p_transferred_amount_minor:50000,p_currency:'EGP',p_reference:sourceVersion,p_transferred_at:clock.observed_at,p_idempotency_key:`${sourceVersion}:receipt`},learner);
  await rpc('claim_review_case',{p_case_id:receipt.case_id,p_expected_version:1,p_idempotency_key:`${sourceVersion}:claim`});
  const allocation=await rpc('allocate_transfer',{p_case_id:receipt.case_id,p_transfer_id:transfer.resource_id,p_evidence_version:1,p_payment_plan_id:null,p_allocations:[{charge_id:chargeId,amount_minor:50000}],p_expected_version:2,p_idempotency_key:`${sourceVersion}:allocation`});
  const mapping={source_version:sourceVersion,receiving_account_id:receiving.resource_id,transfer_id:transfer.resource_id,receipt_id:receipt.resource_id,case_id:receipt.case_id,charge_id:chargeId,allocation_ids:allocation.allocation_ids};
  const prior=(await database.query("select content from app_private.synthetic_fixture_registry where label='payment_installment_v1'")).rows[0]?.content;
  if(prior){if(!(await database.query('select $1::jsonb=$2::jsonb equal',[prior,mapping])).rows[0].equal)throw new Error('PAYMENT_SEED_MAPPING_CONFLICT');}
  else await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,'payment_installment_v1','payment_seed',$2)",[fixtureId('payment_installment_v1'),mapping]);
  console.log('Synthetic payment fixture initialized or preserved: verified local collection, EGP550 source, EGP500 package installment, original-payer credit, and completed installment review. Evidence remains metadata-only until T07.');
 }finally{await Promise.all([admin.auth.signOut({scope:'local'}),learner.auth.signOut({scope:'local'})]);await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:payment-seed:v1',0))");await database.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await seedPayments();
