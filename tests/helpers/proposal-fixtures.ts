import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from './supabase';
import { fixtureId } from '../../tools/db-seed';
import { policyFixture, pricingFixture } from '../unit/policy-vectors';

export async function proposalFixture(){
  const database=await adminDatabase(),admin=await authClient('admin_a'),config=loadLocalSupabase();
  const provider=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const clients:Record<string,ReturnType<typeof anonymousClient>>={admin};const accountIds:Record<string,string>={},learnerIds:Record<string,string>={};
  async function rpc(client:ReturnType<typeof anonymousClient>,name:string,args:Record<string,unknown>={}){
    const response=await client.rpc(name,args);if(response.error)throw new Error(`${name}:${response.error.message}`);return response.data as Record<string,unknown>;
  }
  for(const name of ['learner','sibling','guardian','tutor','stranger']){
    const email=`proposal.${name}.${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
    const created=await provider.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error||!created.data.user)throw new Error('PROPOSAL_AUTH_FIXTURE_FAILED');
    const client=anonymousClient();if((await client.auth.signInWithPassword({email,password})).error)throw new Error('PROPOSAL_SIGNIN_FAILED');
    clients[name]=client;accountIds[name]=created.data.user.id;
    learnerIds[name]=((await rpc(client,'get_my_account')).authorized_learner_ids as string[])[0];
  }
  await rpc(admin,'grant_staff_role',{p_account_id:accountIds.tutor,p_role:'tutor',p_reason:'Synthetic proposal tutor',p_idempotency_key:randomUUID()});
  let tutor=(await database.query('select id,contact_id,version from app_private.tutors where account_id=$1',[accountIds.tutor])).rows[0];
  await rpc(clients.tutor,'update_tutor_profile',{p_display_name:'Synthetic proposal tutor',p_bio:'Approved teaching profile for isolated proposal checks.',p_subject_ids:[fixtureId('subject_calculus')],p_contact_id:tutor.contact_id,p_locale:'en',p_expected_version:tutor.version,p_idempotency_key:randomUUID()});
  tutor=(await database.query('select id,version,draft_profile_version_id from app_private.tutors where account_id=$1',[accountIds.tutor])).rows[0];
  await rpc(admin,'approve_tutor_profile',{p_tutor_id:tutor.id,p_profile_version_id:tutor.draft_profile_version_id,p_decision:'approved',p_reason:'Isolated review',p_expected_version:tutor.version,p_idempotency_key:randomUUID()});
  await rpc(admin,'set_availability',{p_tutor_id:tutor.id,p_weekly_intervals:Array.from({length:7},(_,index)=>({weekday:index+1,start_local:'08:00',end_local:'22:00'})),p_dated_exceptions:[],p_reason:'Synthetic full week availability',p_expected_version:0,p_idempotency_key:randomUUID()});
  const pricingIds:Record<string,string>={},policyIds:Record<string,string>={},offerIds:Record<string,string>={};
  const effective=new Date(Date.now()-60000).toISOString();
  for(const scope of ['private','group'] as const){
    const price=pricingFixture(scope);
    const created=await rpc(admin,'create_pricing_draft',{p_scope:scope,p_customer_pricing:price.customer_pricing,p_compensation:price.compensation,p_idempotency_key:randomUUID()});
    pricingIds[scope]=created.resource_id as string;
    await rpc(admin,'approve_pricing_version',{p_pricing_version_id:created.resource_id,p_effective_at:effective,p_approval_note:'Synthetic fixture tariff',p_expected_version:1,p_idempotency_key:randomUUID()});
  }
  async function makePolicy(scope:'private'|'group',target:number|null){
    const content=policyFixture(scope);Object.assign(content,{customer_pricing_version:pricingIds[scope],compensation_policy_version:pricingIds[scope],package_enabled:false,package_contract:null,confirmation_funding_sources:['verified_payment_allocation'],learner_no_show_rule:'retain_charge',allowed_refund_remedies:['cash_refund','monetary_account_credit']});
    if(scope==='group')Object.assign(content,{group_target_size:target,group_capacity:4,group_minimum_size:2});
    const created=await rpc(admin,'create_policy_draft',{p_kind:'booking',p_scope:scope,p_content:content,p_idempotency_key:randomUUID()});
    await rpc(admin,'approve_policy_version',{p_policy_version_id:created.resource_id,p_effective_at:effective,p_approval_note:'Synthetic fixture terms',p_expected_version:1,p_idempotency_key:randomUUID()});
    return created.resource_id as string;
  }
  for(const [scope,target] of [['private',null],['group',2]] as const){
    policyIds[scope]=await makePolicy(scope,target);
    const offer=await rpc(admin,'create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:scope,p_duration_minutes:60,p_capacity:scope==='private'?1:4,p_target_tier:target,p_pricing_version_id:pricingIds[scope],p_policy_version_id:policyIds[scope],p_idempotency_key:randomUUID()});
    offerIds[scope]=offer.resource_id as string;
    await rpc(admin,'publish_offer',{p_offer_id:offer.resource_id,p_effective_at:effective,p_expected_version:1,p_idempotency_key:randomUUID()});
  }
  let nextDay=7;
  async function occurrence(scope:'private'|'group'='private',target:2|3|4=2){
    let offerId=offerIds[scope];
    if(scope==='group'&&target!==2){
      const policy=await makePolicy('group',target);
      const offer=await rpc(admin,'create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:scope,p_duration_minutes:60,p_capacity:4,p_target_tier:target,p_pricing_version_id:pricingIds.group,p_policy_version_id:policy,p_idempotency_key:randomUUID()});
      offerId=offer.resource_id as string;
      await rpc(admin,'publish_offer',{p_offer_id:offerId,p_effective_at:effective,p_expected_version:1,p_idempotency_key:randomUUID()});
    }
    nextDay+=3;const date=new Date(Date.now()+nextDay*86400000);date.setUTCHours(10,0,0,0);const start=date.toISOString(),end=new Date(date.getTime()+3600000).toISOString();
    const created=await rpc(admin,'create_occurrence',{p_offer_id:offerId,p_tutor_id:tutor.id,p_start_at:start,p_end_at:end,p_time_zone:'Africa/Cairo',p_target_tier:scope==='private'?null:target,p_idempotency_key:randomUUID()});
    const fee=await rpc(admin,'approve_tutor_fee',{p_occurrence_id:created.resource_id,p_tutor_id:tutor.id,p_fee_minor:scope==='private'?25000:target===2?45000:target===3?62500:72500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:pricingIds[scope],p_target_tier:scope==='private'?null:target,p_purpose:'initial',p_reason:'Synthetic exact agreement',p_expected_version:1,p_idempotency_key:randomUUID()});
    const row=(await database.query('select * from app_private.occurrences where id=$1',[created.resource_id])).rows[0];
    return {id:row.id as string,version:row.version as number,start,end,feeId:fee.fee_agreement_id as string};
  }
  async function hold(occurrenceId:string,name='learner'){
    return rpc(clients[name],'reserve_enrollment',{p_occurrence_id:occurrenceId,p_learner_id:learnerIds[name],p_idempotency_key:randomUUID()});
  }
  async function link(name='learner'){
    const contacts=await rpc(clients.guardian,'get_my_verified_contacts');const contact=(contacts.items as {contact_id:string}[])[0];
    const invitation=await rpc(clients[name],'create_guardian_invitation',{p_contact_id:contact.contact_id,p_scopes:['booking'],p_expires_at:new Date(Date.now()+86400000).toISOString(),p_idempotency_key:randomUUID()});
    const event=(await database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1",[invitation.invitation_id])).rows[0];
    return rpc(clients.guardian,'accept_guardian_invitation',{p_invitation_id:invitation.invitation_id,p_single_use_token:event.payload.single_use_token,p_expected_version:1,p_idempotency_key:randomUUID()});
  }
  return {database,clients,accountIds,learnerIds,tutorId:tutor.id as string,rpc,occurrence,hold,link,makePolicy,pricingIds,policyIds,offerIds,close:async()=>{await Promise.all(Object.values(clients).map(client=>client.auth.signOut({scope:'local'})));await database.end()}};
}
