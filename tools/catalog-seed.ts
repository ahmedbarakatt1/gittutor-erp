import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { adminDatabase, authClient, loadLocalSupabase } from '../tests/helpers/supabase';
import { fixtureId } from './db-seed';

type Json = Record<string, unknown>;
const source = JSON.parse(readFileSync('contracts/policy-settings.json','utf8')) as { version:string; development_examples:{fixture_id:string;policy?:Json}[] };
const manifest = JSON.parse(readFileSync('contracts/pricing-policy.json','utf8')) as { version:string;customer_pricing:{group_tiers:unknown[]};internal_compensation:{group_fee_bands:unknown[]} };
const sourceVersion = `catalog-seed-v1:${source.version}`;
const catalogSubjects = [
  { label:'computer_science',slug:'computer-science',title:'Computer Science' },
  { label:'engineering',slug:'engineering',title:'Engineering' },
  { label:'business',slug:'business',title:'Business' },
  { label:'business_intelligence',slug:'business-intelligence',title:'Business Intelligence' },
];
const tutorProfile = { display_name:'TutorA · Calculus',bio:'Clear explanations, practical examples and time to work through difficult questions. This is a synthetic development tutor profile.',subject_ids:[fixtureId('subject_calculus')] };
// Canonical fixture labels map to the same UUIDs across independent disposable databases.
export const catalogFixtureIds = {
  group_pricing: fixtureId('2026-11-11.1'), private_pricing: fixtureId('fixture_private_customer_pricing_v1'),
  group2_policy: fixtureId('fixture_policy_group2_v1'), group3_policy: fixtureId('fixture_policy_group3_v1'),
  group4_policy: fixtureId('fixture_policy_group_v1'), private_policy: fixtureId('fixture_policy_private_v1'),
  group2_offer: fixtureId('fixture_group2_60_minute_offer'), group3_offer: fixtureId('fixture_group3_60_minute_offer'),
  group4_offer: fixtureId('fixture_group4_60_minute_offer'), private_offer: fixtureId('fixture_private_60_minute_offer'),
};

function editablePolicy(scope:'group'|'private',pricingId:string):Json {
  const result=structuredClone(source.development_examples.find(item=>item.fixture_id===(scope==='group'?'synthetic_group_policy_v1':'synthetic_private_booking_policy_v1'))!.policy!);
  for(const key of ['policy_version_id','status','environment_scope','is_synthetic','approved_by','approved_at','effective_at']) delete result[key];
  result.customer_pricing_version=pricingId; result.compensation_policy_version=pricingId;
  return result;
}

/** Inserts deterministic local drafts only; all approval and publication uses genuine actor RPCs. */
export async function seedCatalog() {
  const config=loadLocalSupabase();
  const database=await adminDatabase();
  const admin=await authClient('admin_a');
  let tutor:Awaited<ReturnType<typeof authClient>>|undefined;
  let inTransaction=false;
  const adminId=config.actors.admin_a.id;
  try {
    await database.query("select pg_advisory_lock(hashtextextended('git-tutor:catalog-seed:v1',0))");
    const ready=await database.query("select to_regclass('app_private.policy_versions') as id");
    if(!ready.rows[0].id) throw new Error('CATALOG_MIGRATION_REQUIRED');
    const current=await admin.rpc('get_my_account');
    if(current.error||!current.data.roles.includes('admin')) throw new Error('CATALOG_SEED_ADMIN_REQUIRED');
    await database.query('begin');
    inTransaction=true;
    const seedClock=(await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,'catalog_seed_clock_v1','catalog_seed',jsonb_build_object('effective_at',now()-interval '1 minute','source_version',$2::text)) on conflict(label) do update set label=excluded.label returning content",[fixtureId('catalog_seed_clock_v1'),sourceVersion])).rows[0].content as {effective_at:string;source_version:string};
    if(seedClock.source_version!==sourceVersion) throw new Error('CATALOG_SEED_SOURCE_CONFLICT');
    const effectiveAt=seedClock.effective_at;
    const customerGroup={currency:'EGP',pricing_unit:'per_occurrence',duration_minutes:60,group_tiers:manifest.customer_pricing.group_tiers,private_seat_price_minor:null};
    const feeGroup={currency:'EGP',group_fee_bands:manifest.internal_compensation.group_fee_bands,private_fee_rule:null};
    const privatePolicy=editablePolicy('private',catalogFixtureIds.private_pricing);
    const customerPrivate={currency:'EGP',pricing_unit:'per_occurrence',duration_minutes:60,group_tiers:null,private_seat_price_minor:privatePolicy.private_seat_price_minor};
    const feePrivate={currency:'EGP',group_fee_bands:null,private_fee_rule:privatePolicy.private_fee_rule};
    async function audit(label:string,id:string) {
      const event=fixtureId(`catalog-seed-event:${label}`);
      await database.query("insert into app_private.audit_events(id,actor_account_id,command_id,action,aggregate_id,details) values($1,$2,$3,'synthetic_catalog_draft_seeded',$4,jsonb_build_object('source_manifest_version',$5::text,'fixture_label',$6::text)) on conflict(id) do nothing",[fixtureId(`catalog-seed-audit:${label}`),adminId,event,id,sourceVersion,label]);
      await database.query("select app_private.enqueue_event($1,'synthetic_catalog_draft_seeded',$2,jsonb_build_object('resource_id',$2::uuid,'fixture_label',$3::text),'notifications.route')",[event,id,label]);
    }
    for(const subject of catalogSubjects) {
      const id=fixtureId(`subject_${subject.label}`);
      const existing=(await database.query('select slug,title,active from app_private.subjects where id=$1',[id])).rows[0];
      if(existing) {
        if(existing.slug!==subject.slug||existing.title!==subject.title||!existing.active) throw new Error('CATALOG_SEED_SUBJECT_CONFLICT');
      } else {
        await database.query('insert into app_private.subjects(id,slug,title) values($1,$2,$3)',[id,subject.slug,subject.title]);
        await audit(`subject_${subject.label}`,id);
      }
    }
    for(const [scope,id,customer,compensation] of [['group',catalogFixtureIds.group_pricing,customerGroup,feeGroup],['private',catalogFixtureIds.private_pricing,customerPrivate,feePrivate]] as const) {
      const valid=await database.query('select app_private.catalog_pricing_errors($1,$2,$3,true) as errors',[customer,compensation,scope]);
      if(valid.rows[0].errors.length) throw new Error('CATALOG_FIXTURE_PRICING_INVALID');
      const existing=await database.query('select environment_scope,is_synthetic,source_manifest_version,content_hash from app_private.pricing_versions where id=$1',[id]);
      const hash=(await database.query("select app_private.catalog_hash(jsonb_build_object('customer_pricing',$1::jsonb,'compensation',$2::jsonb)) as hash",[customer,compensation])).rows[0].hash;
      if(existing.rowCount) {
        const row=existing.rows[0];
        if(row.environment_scope!=='development_test'||!row.is_synthetic||row.source_manifest_version!==sourceVersion||row.content_hash!==hash) throw new Error('CATALOG_SEED_PRICING_CONFLICT');
      } else {
        await database.query("insert into app_private.pricing_versions(id,scope,customer_pricing,environment_scope,is_synthetic,content_hash,source_manifest_version,created_by) values($1,$2,$3,'development_test',true,$4,$5,$6)",[id,scope,customer,hash,sourceVersion,adminId]);
        await database.query('insert into finance_private.pricing_compensation(pricing_version_id,content) values($1,$2)',[id,compensation]);
        await audit(`pricing_${scope}`,id);
      }
    }
    const group=editablePolicy('group',catalogFixtureIds.group_pricing);
    const records:{label:string;scope:'group'|'private';subjectId:string;policyId:string;offerId:string;pricingId:string;content:Json;target:number|null;capacity:number}[]=[];
    for(const size of [2,3,4] as const) {
      const content=structuredClone(group); content.group_target_size=size;
      const policyId=catalogFixtureIds[`group${size}_policy`],offerId=catalogFixtureIds[`group${size}_offer`];
      if(size===4) Object.assign(content.package_contract as Json,{package_policy_version_id:policyId,eligible_offer_ids:[offerId]});
      else Object.assign(content,{package_enabled:false,package_contract:null,confirmation_funding_sources:['verified_payment_allocation'],allowed_refund_remedies:['cash_refund','monetary_account_credit'],learner_no_show_rule:'retain_charge'});
      records.push({label:`group${size}`,scope:'group',subjectId:fixtureId('subject_calculus'),policyId,offerId,pricingId:catalogFixtureIds.group_pricing,content,target:size,capacity:4});
    }
    records.push({label:'private',scope:'private',subjectId:fixtureId('subject_calculus'),policyId:catalogFixtureIds.private_policy,offerId:catalogFixtureIds.private_offer,pricingId:catalogFixtureIds.private_pricing,content:privatePolicy,target:null,capacity:1});
    for(const subject of catalogSubjects) records.push({label:`${subject.label}_private`,scope:'private',subjectId:fixtureId(`subject_${subject.label}`),policyId:catalogFixtureIds.private_policy,offerId:fixtureId(`fixture_${subject.label}_private_60_minute_offer`),pricingId:catalogFixtureIds.private_pricing,content:privatePolicy,target:null,capacity:1});
    for(const record of records) {
      const {policyId,offerId,pricingId,content,scope,label,target,capacity,subjectId}=record;
      const hash=(await database.query('select app_private.catalog_hash($1) as hash',[content])).rows[0].hash;
      const existing=await database.query('select environment_scope,is_synthetic,source_manifest_version,content_hash,status from app_private.policy_versions where id=$1',[policyId]);
      // Published fixture content is immutable historical evidence. New drafts must pass today's complete gate.
      if (!existing.rowCount || existing.rows[0].status !== 'published') {
        const valid=await database.query('select app_private.catalog_policy_errors($1,$2,true,$3) as errors',[content,scope,policyId]);
        if(valid.rows[0].errors.length) throw new Error('CATALOG_FIXTURE_POLICY_INVALID');
      }
      if(existing.rowCount) {
        const row=existing.rows[0]; if(row.environment_scope!=='development_test'||!row.is_synthetic||row.source_manifest_version!==sourceVersion||row.content_hash!==hash) throw new Error('CATALOG_SEED_POLICY_CONFLICT');
      } else {
        const publicContent={...content},privateContent:Json={};
        for(const key of ['private_fee_rule','tutor_cancellation_compensation_rule','tutor_fee_for_delivered_session']) { if(key in publicContent) { privateContent[key]=publicContent[key]; delete publicContent[key]; } }
        await database.query("insert into app_private.policy_versions(id,kind,scope,content,pricing_version_id,environment_scope,is_synthetic,content_hash,source_manifest_version,created_by) values($1,'booking',$2,$3,$4,'development_test',true,$5,$6,$7)",[policyId,scope,publicContent,pricingId,hash,sourceVersion,adminId]);
        await database.query('insert into finance_private.policy_compensation_terms(policy_version_id,content) values($1,$2)',[policyId,privateContent]);
        await audit(`policy_${label}`,policyId);
      }
      const existingOffer=await database.query('select subject_id,format,duration_minutes,capacity,target_tier,pricing_version_id,policy_version_id,created_by from app_private.offers where id=$1',[offerId]);
      if(existingOffer.rowCount) {
        const row=existingOffer.rows[0];
        if(row.subject_id!==subjectId||row.format!==scope||row.duration_minutes!==60||row.capacity!==capacity||row.target_tier!==target||row.pricing_version_id!==pricingId||row.policy_version_id!==policyId||row.created_by!==adminId) throw new Error('CATALOG_SEED_OFFER_CONFLICT');
      } else {
        await database.query('insert into app_private.offers(id,subject_id,format,duration_minutes,capacity,target_tier,pricing_version_id,policy_version_id,created_by) values($1,$2,$3,60,$4,$5,$6,$7,$8)',[offerId,subjectId,scope,capacity,target,pricingId,policyId,adminId]);
        await audit(`offer_${label}`,offerId);
      }
    }
    await database.query('commit');
    inTransaction=false;
    async function rpc(name:string,args:Json) {
      const result=await admin.rpc(name,args);
      if(result.error) throw new Error(`CATALOG_SEED_COMMAND_FAILED:${name}:${result.error.code}`);
      return result.data as Json;
    }
    for(const scope of ['group','private'] as const) {
      const id=catalogFixtureIds[`${scope}_pricing`];
      const row=(await database.query('select status,version from app_private.pricing_versions where id=$1',[id])).rows[0];
      if(row.status==='draft') await rpc('approve_pricing_version',{p_pricing_version_id:id,p_effective_at:effectiveAt,p_approval_note:'Approved synthetic development fixture; not a live commercial approval.',p_expected_version:row.version,p_idempotency_key:`catalog-seed-v1:approve-price:${scope}`});
    }
    for(const record of records) {
      const policy=(await database.query('select status,version from app_private.policy_versions where id=$1',[record.policyId])).rows[0];
      if(policy.status==='draft') await rpc('approve_policy_version',{p_policy_version_id:record.policyId,p_effective_at:effectiveAt,p_approval_note:'Approved synthetic development fixture; not a live commercial approval.',p_expected_version:policy.version,p_idempotency_key:`catalog-seed-v1:approve-policy:${record.label}`});
      const offer=(await database.query('select status,version from app_private.offers where id=$1',[record.offerId])).rows[0];
      if(offer.status==='draft') await rpc('publish_offer',{p_offer_id:record.offerId,p_effective_at:effectiveAt,p_expected_version:offer.version,p_idempotency_key:`catalog-seed-v1:publish-offer:${record.label}`});
    }
    tutor=await authClient('tutor_a');
    let teacher=(await database.query('select id,contact_id,version,draft_profile_version_id,approved_profile_version_id from app_private.tutors where account_id=$1',[config.actors.tutor_a.id])).rows[0];
    if(!teacher.approved_profile_version_id) {
      if(!teacher.draft_profile_version_id) {
        const updated=await tutor.rpc('update_tutor_profile',{p_display_name:tutorProfile.display_name,p_bio:tutorProfile.bio,p_subject_ids:tutorProfile.subject_ids,p_contact_id:teacher.contact_id,p_locale:'en',p_expected_version:teacher.version,p_idempotency_key:'catalog-seed-v1:tutor-profile'});
        if(updated.error) throw new Error('CATALOG_SEED_TUTOR_PROFILE_FAILED');
        teacher=(await database.query('select id,version,draft_profile_version_id from app_private.tutors where account_id=$1',[config.actors.tutor_a.id])).rows[0];
      }
      const draft=(await database.query('select display_name,bio,subject_ids,created_by,state from app_private.tutor_profile_versions where id=$1 and tutor_id=$2',[teacher.draft_profile_version_id,teacher.id])).rows[0];
      if(!draft||draft.display_name!==tutorProfile.display_name||draft.bio!==tutorProfile.bio||JSON.stringify(draft.subject_ids)!==JSON.stringify(tutorProfile.subject_ids)||draft.created_by!==config.actors.tutor_a.id||draft.state!=='draft') throw new Error('CATALOG_SEED_TUTOR_DRAFT_CONFLICT: existing noncanonical draft preserved without approval');
      await rpc('approve_tutor_profile',{p_tutor_id:teacher.id,p_profile_version_id:teacher.draft_profile_version_id,p_decision:'approved',p_reason:'Reviewed synthetic development teaching profile.',p_expected_version:teacher.version,p_idempotency_key:'catalog-seed-v1:approve-tutor-profile'});
    }
    const final=(await database.query("select (select count(*) from app_private.pricing_versions where id=any($1::uuid[]) and status='published')::int as pricing,(select count(*) from app_private.policy_versions where id=any($2::uuid[]) and status='published')::int as policies,(select count(*) from app_private.offers where id=any($3::uuid[]) and status='published')::int as offers,(select count(*) from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id and p.state='approved' where t.id=$4)::int as tutors",[[catalogFixtureIds.group_pricing,catalogFixtureIds.private_pricing],[...new Set(records.map(record=>record.policyId))],records.map(record=>record.offerId),teacher.id])).rows[0];
    if(final.pricing!==2||final.policies!==4||final.offers!==8||final.tutors!==1) throw new Error('CATALOG_SEED_FINAL_STATE_CONFLICT: retired or altered records preserved');
    console.log('Synthetic catalog ready: 2 published pricing bundles, 4 published policies, 8 published offers across 5 subjects, approved tutor profile. Existing records preserved.');
  } catch(error) { if(inTransaction) await database.query('rollback'); throw error; }
  finally { await Promise.all([admin.auth.signOut({scope:'local'}),tutor?.auth.signOut({scope:'local'})]); await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:catalog-seed:v1',0))"); await database.end(); }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await seedCatalog();
