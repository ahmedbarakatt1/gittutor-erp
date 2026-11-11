import {randomUUID} from 'node:crypto';
import {fixtureId} from '../../tools/db-seed';
import {policyFixture,pricingFixture} from '../unit/policy-vectors';
import type {packageFixture} from './packages';

/** Genuine approved synthetic commercial versions, never a direct row or funding bypass. */
export async function additionalPackageContract(f:Awaited<ReturnType<typeof packageFixture>>,durationMinutes=90){
 const pricing=pricingFixture('group');pricing.customer_pricing.duration_minutes=durationMinutes;
 const price=await f.rpc('create_pricing_draft',{p_scope:'group',p_customer_pricing:pricing.customer_pricing,p_compensation:pricing.compensation,p_idempotency_key:randomUUID()});
 await f.rpc('approve_pricing_version',{p_pricing_version_id:price.resource_id,p_effective_at:new Date().toISOString(),p_approval_note:'Synthetic explicit changed-duration commercial contract',p_expected_version:1,p_idempotency_key:randomUUID()});
 const content=policyFixture('group');Object.assign(content,{duration_minutes:durationMinutes,group_target_size:2,group_minimum_size:2,group_capacity:4,customer_pricing_version:price.resource_id,compensation_policy_version:price.resource_id});
 const pack=content.package_contract as Record<string,unknown>;Object.assign(pack,{package_policy_version_id:null,eligible_offer_ids:null,base_duration_minutes:durationMinutes,grant_credit_quanta:3000,purchase_value_minor:150000,expiry_mode:'days_from_grant',expiry_days:90});
 const draft=await f.rpc('create_policy_draft',{p_kind:'booking',p_scope:'group',p_content:content,p_idempotency_key:randomUUID()});
 const offer=await f.rpc('create_offer',{p_subject_id:fixtureId('subject_calculus'),p_format:'group',p_duration_minutes:durationMinutes,p_capacity:4,p_target_tier:2,p_pricing_version_id:price.resource_id,p_policy_version_id:draft.resource_id,p_idempotency_key:randomUUID()});
 Object.assign(pack,{package_policy_version_id:draft.resource_id,eligible_offer_ids:[offer.resource_id]});
 await f.rpc('update_policy_draft',{p_policy_version_id:draft.resource_id,p_content:content,p_expected_version:1,p_idempotency_key:randomUUID()});
 await f.rpc('approve_policy_version',{p_policy_version_id:draft.resource_id,p_effective_at:new Date().toISOString(),p_approval_note:'Synthetic explicit service-duration conversion target',p_expected_version:2,p_idempotency_key:randomUUID()});
 await f.rpc('publish_offer',{p_offer_id:offer.resource_id,p_effective_at:new Date().toISOString(),p_expected_version:1,p_idempotency_key:randomUUID()});
 const contract=await f.rpc('get_package_contract',{p_package_contract_version_id:draft.resource_id,p_learner_id:f.learnerId},f.learner);
 return{policyId:draft.resource_id as string,offerId:offer.resource_id as string,contract};
}
