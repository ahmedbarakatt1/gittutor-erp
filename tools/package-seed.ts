import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {adminDatabase,authClient,loadLocalSupabase} from '../tests/helpers/supabase';
import {fixtureId} from './db-seed';
import {catalogFixtureIds} from './catalog-seed';
type Json=Record<string,unknown>;
const sourceVersion='t05-package-seed-v2';
export const packageFixtureIds={namedPolicy:fixtureId('fixture_package_named_policy_v2'),namedOffer:fixtureId('fixture_package_named_offer_v2'),valuePolicy:fixtureId('fixture_package_value_policy_v2'),valueOffer:fixtureId('fixture_package_value_offer_v2'),namedGrant:fixtureId('fixture_package_named_bonus_policy_v2'),valueGrant:fixtureId('fixture_package_value_bonus_policy_v2')};

/** New schema2 synthetic contracts only. Original approved contracts and existing balances stay untouched. */
export async function seedPackages(){
 const database=await adminDatabase(),config=loadLocalSupabase(),admin=await authClient('admin_a'),learner=await authClient('learner_a');let transaction=false;
 try{
  await database.query("select pg_advisory_lock(hashtextextended('git-tutor:package-seed:v2',0))");
  if(!(await database.query("select to_regclass('app_private.package_purchases') as id")).rows[0].id)throw new Error('PACKAGE_MIGRATION_REQUIRED');
  const account=await admin.rpc('get_my_account');if(account.error||!account.data.roles.includes('admin'))throw new Error('PACKAGE_SEED_ADMIN_REQUIRED');
  const learnerId=(await database.query('select id from app_private.learners where account_id=$1',[config.actors.learner_a.id])).rows[0]?.id as string;if(!learnerId)throw new Error('PACKAGE_SEED_LEARNER_REQUIRED');
  const source=JSON.parse(readFileSync('contracts/policy-settings.json','utf8')) as {development_examples:{fixture_id:string;policy:Json}[]};
  const initial=structuredClone(source.development_examples.find(row=>row.fixture_id==='synthetic_group_policy_v1')!.policy);
  for(const key of ['policy_version_id','status','environment_scope','is_synthetic','approved_by','approved_at','effective_at'])delete initial[key];
  const records=[{label:'named',policyId:packageFixtureIds.namedPolicy,offerId:packageFixtureIds.namedOffer,grantId:packageFixtureIds.namedGrant,coverage:'named_entitlement_covers_eligible_occurrence',funding:'reserved_named_package_entitlement'},{label:'value',policyId:packageFixtureIds.valuePolicy,offerId:packageFixtureIds.valueOffer,grantId:packageFixtureIds.valueGrant,coverage:'allocated_value_with_explicit_top_up',funding:'reserved_eligible_package_value'}];
  await database.query('begin');transaction=true;
  const firstStart=new Date(Date.now()+14*86400000);firstStart.setUTCHours(10,0,0,0);
  const clock=(await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,'package_seed_clock_v2','package_seed',$2) on conflict(label) do update set label=excluded.label returning content",[fixtureId('package_seed_clock_v2'),{source_version:sourceVersion,effective_at:new Date(Date.now()-60000).toISOString(),first_start_at:firstStart.toISOString()}])).rows[0].content;
  if(clock.source_version!==sourceVersion)throw new Error('PACKAGE_SEED_SOURCE_CONFLICT');
  for(const record of records){
   const content=structuredClone(initial);Object.assign(content,{group_target_size:2,group_minimum_size:2,group_capacity:4,customer_pricing_version:catalogFixtureIds.group_pricing,compensation_policy_version:catalogFixtureIds.group_pricing,confirmation_funding_sources:['verified_payment_allocation',record.funding]});
   Object.assign(content.package_contract as Json,{package_policy_version_id:record.policyId,eligible_offer_ids:[record.offerId],grant_credit_quanta:3000,purchase_value_minor:150000,coverage_rule:record.coverage,purchase_activation_rule:'full_settled_charge',expiry_clock:'elapsed_24_hour_days',expiry_mode:'days_from_grant',expiry_days:90});
   const errors=(await database.query('select app_private.catalog_policy_errors($1,$2,true,$3) as errors',[content,'group',record.policyId])).rows[0].errors;if(errors.length)throw new Error('PACKAGE_SEED_POLICY_INVALID');
   const hash=(await database.query('select app_private.catalog_hash($1) as hash',[content])).rows[0].hash;
   const existing=(await database.query('select content_hash,source_manifest_version,environment_scope,is_synthetic from app_private.policy_versions where id=$1',[record.policyId])).rows[0];
   if(existing){if(existing.content_hash!==hash||existing.source_manifest_version!==sourceVersion||existing.environment_scope!=='development_test'||!existing.is_synthetic)throw new Error('PACKAGE_SEED_POLICY_CONFLICT');}
   else{
    const publicContent={...content},privateContent:Json={};for(const key of ['private_fee_rule','tutor_cancellation_compensation_rule','tutor_fee_for_delivered_session'])if(key in publicContent){privateContent[key]=publicContent[key];delete publicContent[key];}
    await database.query("insert into app_private.policy_versions(id,kind,scope,content,pricing_version_id,environment_scope,is_synthetic,content_hash,source_manifest_version,created_by) values($1,'booking','group',$2,$3,'development_test',true,$4,$5,$6)",[record.policyId,publicContent,catalogFixtureIds.group_pricing,hash,sourceVersion,config.actors.admin_a.id]);
    await database.query('insert into finance_private.policy_compensation_terms(policy_version_id,content) values($1,$2)',[record.policyId,privateContent]);
   }
   const offer=(await database.query('select * from app_private.offers where id=$1',[record.offerId])).rows[0];
   if(offer){if(offer.policy_version_id!==record.policyId||offer.pricing_version_id!==catalogFixtureIds.group_pricing||offer.subject_id!==fixtureId('subject_calculus')||offer.format!=='group'||offer.target_tier!==2||offer.capacity!==4||offer.duration_minutes!==60)throw new Error('PACKAGE_SEED_OFFER_CONFLICT');}
   else await database.query("insert into app_private.offers(id,subject_id,format,duration_minutes,capacity,target_tier,pricing_version_id,policy_version_id,created_by) values($1,$2,'group',60,4,2,$3,$4,$5)",[record.offerId,fixtureId('subject_calculus'),catalogFixtureIds.group_pricing,record.policyId,config.actors.admin_a.id]);
   const grant={name:`Synthetic ${record.label} package bonus`,eligible_package_contract_version_ids:[record.policyId],currency:'EGP',valuation_rule:'reviewed_exact_capped_subsidy',maximum_credit_quanta_per_grant:1000,maximum_carrying_value_minor_per_grant:50000};
   const previousGrant=(await database.query('select content,environment_scope,is_synthetic from app_private.package_grant_policy_versions where id=$1',[record.grantId])).rows[0];
   if(previousGrant){const equal=(await database.query('select $1::jsonb=$2::jsonb as equal',[previousGrant.content,grant])).rows[0].equal;if(!equal||previousGrant.environment_scope!=='development_test'||!previousGrant.is_synthetic)throw new Error('PACKAGE_SEED_GRANT_POLICY_CONFLICT');}
   else await database.query("insert into app_private.package_grant_policy_versions(id,content,environment_scope,is_synthetic,created_by) values($1,$2,'development_test',true,$3)",[record.grantId,grant,config.actors.admin_a.id]);
   const command=fixtureId(`package-seed-draft:${record.label}`);await database.query("insert into app_private.audit_events(id,actor_account_id,command_id,action,aggregate_id,details) values($1,$2,$3,'synthetic_package_draft_seeded',$4,$5) on conflict(id) do nothing",[fixtureId(`package-seed-audit:${record.label}`),config.actors.admin_a.id,command,record.policyId,{source_manifest_version:sourceVersion}]);
   await database.query("select app_private.enqueue_event($1,'synthetic_package_draft_seeded',$2,jsonb_build_object('policy_version_id',$2::uuid),'notifications.route')",[command,record.policyId]);
  }
  await database.query('commit');transaction=false;
  async function rpc(name:string,args:Json,client=admin){const result=await client.rpc(name,args);if(result.error)throw new Error(`PACKAGE_SEED_COMMAND_FAILED:${name}:${result.error.message}`);return result.data as Json;}
  for(const record of records){
   const policy=(await database.query('select status,version from app_private.policy_versions where id=$1',[record.policyId])).rows[0];
   if(policy.status==='draft')await rpc('approve_policy_version',{p_policy_version_id:record.policyId,p_effective_at:clock.effective_at,p_approval_note:'Explicit synthetic package activation and elapsed-day contract',p_expected_version:policy.version,p_idempotency_key:`${sourceVersion}:approve:${record.label}`});
   const offer=(await database.query('select status,version from app_private.offers where id=$1',[record.offerId])).rows[0];
   if(offer.status==='draft')await rpc('publish_offer',{p_offer_id:record.offerId,p_effective_at:clock.effective_at,p_expected_version:offer.version,p_idempotency_key:`${sourceVersion}:publish:${record.label}`});
   const grantPolicy=(await database.query('select status,version from app_private.package_grant_policy_versions where id=$1',[record.grantId])).rows[0];
   if(grantPolicy.status==='draft')await rpc('approve_package_grant_policy',{p_grant_policy_version_id:record.grantId,p_effective_at:clock.effective_at,p_approval_note:'Explicit synthetic noncash subsidy of EGP500 carrying value; no payment or purchase settlement',p_expected_version:grantPolicy.version,p_idempotency_key:`${sourceVersion}:grant-policy:${record.label}`});
   const final=(await database.query("select p.status as policy,o.status as offer,g.status as grant from app_private.policy_versions p join app_private.offers o on o.policy_version_id=p.id join app_private.package_grant_policy_versions g on g.id=$3 where p.id=$1 and o.id=$2",[record.policyId,record.offerId,record.grantId])).rows[0];if(final.policy!=='published'||final.offer!=='published'||final.grant!=='approved')throw new Error('PACKAGE_SEED_FINAL_STATE_CONFLICT');
   const contract=await rpc('get_package_contract',{p_package_contract_version_id:record.policyId,p_learner_id:learnerId},learner);
   const purchase=await rpc('purchase_package',{p_learner_id:learnerId,p_package_contract_version_id:record.policyId,p_accepted_terms_hash:contract.terms_hash,p_idempotency_key:`${sourceVersion}:purchase:${record.label}`},learner);
   const bonus=await rpc('approve_package_grant',{p_package_id:purchase.resource_id,p_grant_policy_version_id:record.grantId,p_credit_quanta:1000,p_carrying_value_minor:50000,p_currency:'EGP',p_grant_kind:'complimentary',p_source_credit_id:null,p_reason:'Canonical synthetic bonus; purchase remains independently payable',p_evidence_file_id:null,p_expected_version:1,p_idempotency_key:`${sourceVersion}:bonus:${record.label}`});
   const mapping={source_version:sourceVersion,policy_id:record.policyId,offer_id:record.offerId,grant_policy_id:record.grantId,package_purchase_id:purchase.resource_id,charge_id:purchase.charge_id,bonus_lot_id:bonus.lot_id};
   const prior=(await database.query('select content from app_private.synthetic_fixture_registry where label=$1',[`package_${record.label}_v2`])).rows[0];
   if(prior){if(!(await database.query('select $1::jsonb=$2::jsonb as equal',[prior.content,mapping])).rows[0].equal)throw new Error('PACKAGE_SEED_MAPPING_CONFLICT');}
   else await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,$2,'package_seed',$3)",[fixtureId(`package_${record.label}_v2`),`package_${record.label}_v2`,mapping]);
   const tutorId=(await database.query('select id from app_private.tutors where account_id=$1',[config.actors.tutor_a.id])).rows[0]?.id;if(!tutorId)throw new Error('PACKAGE_SEED_TUTOR_REQUIRED');
   const start=new Date(Date.parse(clock.first_start_at)+(record.label==='value'?1:0)*86400000),end=new Date(start.getTime()+3600000);
   const occurrence=await rpc('create_occurrence',{p_offer_id:record.offerId,p_tutor_id:tutorId,p_start_at:start.toISOString(),p_end_at:end.toISOString(),p_time_zone:'Africa/Cairo',p_target_tier:2,p_idempotency_key:`${sourceVersion}:occurrence:${record.label}`});
   await rpc('approve_tutor_fee',{p_occurrence_id:occurrence.resource_id,p_tutor_id:tutorId,p_fee_minor:45000,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:catalogFixtureIds.group_pricing,p_target_tier:2,p_purpose:'initial',p_reason:'Exact synthetic package session fee; no booking confirmation or settled funds asserted',p_expected_version:1,p_idempotency_key:`${sourceVersion}:fee:${record.label}`});
   const schedule={source_version:sourceVersion,occurrence_id:occurrence.resource_id,offer_id:record.offerId,start_at:start.toISOString(),end_at:end.toISOString()};
   const priorSchedule=(await database.query('select content from app_private.synthetic_fixture_registry where label=$1',[`package_${record.label}_schedule_v2`])).rows[0];
   if(priorSchedule){if(!(await database.query('select $1::jsonb=$2::jsonb as equal',[priorSchedule.content,schedule])).rows[0].equal)throw new Error('PACKAGE_SEED_SCHEDULE_CONFLICT');}
   else await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,$2,'package_seed',$3)",[fixtureId(`package_${record.label}_schedule_v2`),`package_${record.label}_schedule_v2`,schedule]);
  }
  console.log('Synthetic packages ready: two new published contracts, two approved bonus policies, two real issued purchase charges, separate bonus lots and two scheduled occurrences. Existing balances and historical policies preserved; no settled funding asserted.');
 }catch(error){if(transaction)await database.query('rollback');throw error;}
 finally{await Promise.all([admin.auth.signOut({scope:'local'}),learner.auth.signOut({scope:'local'})]);await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:package-seed:v2',0))");await database.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await seedPackages();
