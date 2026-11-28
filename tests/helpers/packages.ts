import {randomUUID} from 'node:crypto';
import {bookingFixture} from './booking';
import {policyFixture} from '../unit/policy-vectors';
import {catalogFixtureIds} from '../../tools/catalog-seed';
import {fixtureId} from '../../tools/db-seed';

export async function packageFixture(options:{isolatedLearners?:boolean;coverageRule?:'named_entitlement_covers_eligible_occurrence'|'allocated_value_with_explicit_top_up';cancellationRefundBasisPoints?:number;groupTargetSize?:2|3|4}={}){
 const booking=await bookingFixture(options);
 await booking.availability();
 const content=policyFixture('group');
 const target=options.groupTargetSize??2;
 Object.assign(content,{group_target_size:target,group_minimum_size:2,group_capacity:4,customer_pricing_version:catalogFixtureIds.group_pricing,compensation_policy_version:catalogFixtureIds.group_pricing});
 if(options.cancellationRefundBasisPoints!==undefined)content.customer_cancellation_windows=[{minimum_minutes_before_start:0,maximum_minutes_before_start_exclusive:null,refund_basis_points:options.cancellationRefundBasisPoints}];
 const pack=content.package_contract as Record<string,unknown>;
 Object.assign(pack,{package_policy_version_id:null,eligible_offer_ids:null,grant_credit_quanta:3000,purchase_value_minor:150000,expiry_mode:'days_from_grant',expiry_days:90});
 if(options.coverageRule){pack.coverage_rule=options.coverageRule;content.confirmation_funding_sources=options.coverageRule==='named_entitlement_covers_eligible_occurrence'?['verified_payment_allocation','reserved_named_package_entitlement']:['verified_payment_allocation','reserved_eligible_package_value'];}
 const draft=await booking.rpc('create_policy_draft',{p_kind:'booking',p_scope:'group',p_content:content,p_idempotency_key:randomUUID()});
 const policyId=draft.resource_id as string;
 const offer=await booking.rpc('create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:'group',p_duration_minutes:60,p_capacity:4,p_target_tier:target,p_pricing_version_id:catalogFixtureIds.group_pricing,p_policy_version_id:policyId,p_idempotency_key:randomUUID()});
 Object.assign(pack,{package_policy_version_id:policyId,eligible_offer_ids:[offer.resource_id]});
 await booking.rpc('update_policy_draft',{p_policy_version_id:policyId,p_content:content,p_expected_version:1,p_idempotency_key:randomUUID()});
 await booking.rpc('approve_policy_version',{p_policy_version_id:policyId,p_effective_at:new Date().toISOString(),p_approval_note:'Synthetic explicit package purchase policy',p_expected_version:2,p_idempotency_key:randomUUID()});
 await booking.rpc('publish_offer',{p_offer_id:offer.resource_id,p_effective_at:new Date().toISOString(),p_expected_version:1,p_idempotency_key:randomUUID()});
 const learner=booking.students[0],learnerId=booking.learners[0];
 const contract=()=>booking.rpc('get_package_contract',{p_package_contract_version_id:policyId,p_learner_id:learnerId},learner);
 const purchase=async()=>{const view=await contract();return booking.rpc('purchase_package',{p_learner_id:learnerId,p_package_contract_version_id:policyId,p_accepted_terms_hash:view.terms_hash,p_idempotency_key:randomUUID()},learner)};
 const grantPolicy=async(value=0)=>{
  const policy=await booking.rpc('create_package_grant_policy',{p_content:{name:`Synthetic package grant ${randomUUID()}`,eligible_package_contract_version_ids:[policyId],currency:'EGP',valuation_rule:value?'reviewed_exact_capped_subsidy':'zero_value',maximum_credit_quanta_per_grant:3000,maximum_carrying_value_minor_per_grant:value},p_idempotency_key:randomUUID()});
  await booking.rpc('approve_package_grant_policy',{p_grant_policy_version_id:policy.resource_id,p_effective_at:new Date().toISOString(),p_approval_note:'Explicit synthetic promotional subsidy; no cash or settlement asserted',p_expected_version:1,p_idempotency_key:randomUUID()});return policy.resource_id as string;
 };
 const grant=async(purchaseId:string,policyId:string,value=0,quanta=3000,expected=1)=>booking.rpc('approve_package_grant',{p_package_id:purchaseId,p_grant_policy_version_id:policyId,p_credit_quanta:quanta,p_carrying_value_minor:value,p_currency:'EGP',p_grant_kind:'complimentary',p_source_credit_id:null,p_reason:'Synthetic explicitly approved bonus',p_evidence_file_id:null,p_expected_version:expected,p_idempotency_key:randomUUID()});
 const hold=async()=>{
  const times=booking.interval();const occurrence=await booking.rpc('create_occurrence',{p_offer_id:offer.resource_id,p_tutor_id:booking.tutorId,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:target,p_idempotency_key:randomUUID()});
  const seat=await booking.reserve(occurrence.resource_id as string);const quote=await booking.rpc('get_quote',{p_quote_id:seat.quote_id},learner);
  await booking.rpc('accept_quote',{p_quote_id:seat.quote_id,p_quote_hash:quote.quote_hash,p_expected_version:quote.version,p_idempotency_key:randomUUID()},learner);
  return {occurrenceId:occurrence.resource_id as string,enrollmentId:seat.enrollment_id as string,quoteId:seat.quote_id as string,quote};
 };
 // Test-only DBA fixture: immutable historical source rows, never a deployed qualification bypass.
 const historicalBonus=async(input:{purchaseId:string;grantPolicyId:string;creditQuanta?:number;valueMinor?:number;expired?:boolean})=>{
  const lotId=randomUUID(),commandId=randomUUID(),quanta=input.creditQuanta??1000,value=input.valueMinor??0;
  const adminId=(await booking.admin.auth.getUser()).data.user!.id;
  const createdAt=new Date(Date.now()-(input.expired?91:1)*86400000),expiresAt=new Date(createdAt.getTime()+90*86400000);
  const context={actor_account_id:adminId,command_id:commandId};
  await booking.database.query('begin');
  try{
   const policy=(await booking.database.query("select content from app_private.package_grant_policy_versions where id=$1 and status='approved' and is_synthetic and environment_scope='development_test'",[input.grantPolicyId])).rows[0];
   if(!policy||quanta>Number(policy.content.maximum_credit_quanta_per_grant)||value>Number(policy.content.maximum_carrying_value_minor_per_grant))throw new Error('HISTORICAL_BONUS_POLICY_REQUIRED');
   await booking.database.query('select app_private.package_lock_purchase($1)',[input.purchaseId]);
   await booking.database.query("insert into app_private.package_lots(id,purchase_id,learner_id,origin_kind,original_lot_id,grant_policy_version_id,contract_version_id,eligibility_snapshot,base_duration_minutes,coverage_rule,expires_at,grant_source_id,balances,created_at) select $1,id,learner_id,'complimentary',$1,$3,contract_version_id,contract_snapshot,(contract_snapshot->>'base_duration_minutes')::int,contract_snapshot->>'coverage_rule',$4,$5,app_private.package_empty_balance(),$6 from app_private.package_purchases where id=$2",[lotId,input.purchaseId,input.grantPolicyId,expiresAt,commandId,createdAt]);
   const movementId=(await booking.database.query('select app_private.package_append_movement($1,$2,$3,$4,$5,$6) as id',[lotId,'grant',{granted_credit_quanta:quanta,available_credit_quanta:quanta,granted_value_minor:value,available_value_minor:value},{credit_quanta:quanta,value_minor:value,to_bucket:'available',customer_reason_code:'synthetic_historical_bonus',effective_at:createdAt.toISOString()},context,`historical-grant:${lotId}`])).rows[0].id as string;
   if(value>0)await booking.database.query('select finance_private.finance_post_balanced($1,$2,$3,$4,$5,$6,$7)',[`historical-bonus:${lotId}`,'synthetic_historical_subsidy',lotId,'EGP',createdAt,JSON.stringify([{account_code:'promotional_subsidy_expense',learner_id:learnerId,package_purchase_id:input.purchaseId,lot_id:lotId,signed_minor:value},{account_code:'deferred_package_obligation',learner_id:learnerId,package_purchase_id:input.purchaseId,lot_id:lotId,signed_minor:-value}]),context]);
   await booking.database.query('commit');return {lotId,movementId,expiresAt,createdAt,creditQuanta:quanta,valueMinor:value};
  }catch(error){await booking.database.query('rollback');throw error;}
 };
 return {...booking,learner,learnerId,policyId,offerId:offer.resource_id as string,contract,purchase,grantPolicy,grant,hold,historicalBonus};
}
