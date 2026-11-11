import { expect,test } from 'vitest';
import { packageCommands,invokePackageCommandWithStatus } from '../../src/modules/packages/commands';
import { customerPackageContractSchema,listMyPackages,packageGrantPolicyContentSchema } from '../../src/modules/packages/queries';
import { packageProposalInputSchema } from '../../src/modules/packages/proposal-contract';
import { policyFixture } from './policy-vectors';
const id='50a7291f-829f-439a-9719-f8b3225ed77f';
test('purchase input contains contract consent and learner identity, never funded or grant assertions',async()=>{
 const args={p_learner_id:id,p_package_contract_version_id:id,p_accepted_terms_hash:'a'.repeat(64),p_idempotency_key:'key'};
 expect(packageCommands.purchase_package.input.safeParse(args).success).toBe(true);
 let called=false;await expect(invokePackageCommandWithStatus({rpc:async()=>{called=true;return{data:null,error:null,status:200}}},'purchase_package',{...args,p_funded:true})).rejects.toThrow('VALIDATION_ERROR');expect(called).toBe(false);
});
test('customer contract has explicit activation and elapsed expiry but rejects compensation fields',()=>{
 const contract={...policyFixture('group').package_contract as Record<string,unknown>,purchase_activation_rule:'full_settled_charge',expiry_clock:'elapsed_24_hour_days'};
 expect(customerPackageContractSchema.safeParse(contract).success).toBe(true);
 expect(customerPackageContractSchema.safeParse({...contract,fee_minor:62500}).success).toBe(false);
 expect(customerPackageContractSchema.safeParse({...contract,purchase_activation_rule:undefined}).success).toBe(false);
});
test('grant policy cannot grant implicit positive carrying value under zero valuation',()=>{
 const policy={name:'Synthetic zero bonus',eligible_package_contract_version_ids:[id],currency:'EGP',valuation_rule:'zero_value',maximum_credit_quanta_per_grant:1000,maximum_carrying_value_minor_per_grant:0};
 expect(packageGrantPolicyContentSchema.safeParse(policy).success).toBe(true);
 expect(packageGrantPolicyContentSchema.safeParse({...policy,maximum_carrying_value_minor_per_grant:1}).success).toBe(false);
 expect(packageGrantPolicyContentSchema.safeParse({...policy,approved_by:id}).success).toBe(false);
});
test('package filters reject unsupported role/view authority without contacting RPC',()=>{
 let called=false;const client={rpc:async()=>{called=true;return{data:null,error:null,status:200}}};
 expect(()=>listMyPackages(client,{learner_id:id,view:'admin'} as never)).toThrow('VALIDATION_ERROR');expect(called).toBe(false);
});
test('coverage proposal terms require current package version and reject caller-calculated carrying value',()=>{
 const body={p_kind:'package_coverage',p_target_id:id,p_expected_version:1,p_reason:'Explicit package review',p_idempotency_key:'key',p_requested_terms:{target_type:'enrollment',package_purchase_id:id,expected_package_version:1,credit_quanta:1000,remaining_service_price_minor:null,expires_at:'2026-12-01T10:00:00Z'}};
 expect(packageProposalInputSchema.safeParse(body).success).toBe(true);
 expect(packageProposalInputSchema.safeParse({...body,p_requested_terms:{...body.p_requested_terms,carrying_value_minor:50000}}).success).toBe(false);
});
test('new purchase consent supports zero carryover without permitting zero or one-sided transfers',()=>{
 const body={p_kind:'package_conversion',p_target_id:id,p_expected_version:1,p_reason:'Exact renewal purchase consent',p_idempotency_key:'key',p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:id,expected_target_version:null,source_credit_quanta:0,target_credit_quanta:0,expires_at:'2026-12-01T10:00:00Z'}};
 expect(packageProposalInputSchema.safeParse(body).success).toBe(true);
 expect(packageProposalInputSchema.safeParse({...body,p_requested_terms:{...body.p_requested_terms,target_credit_quanta:1}}).success).toBe(false);
 expect(packageProposalInputSchema.safeParse({...body,p_requested_terms:{...body.p_requested_terms,target_package_id:id,expected_target_version:1}}).success).toBe(false);
});
test('admin replacement of a partial named request binds the original proposal version',()=>{
 const body={p_kind:'package_coverage',p_target_id:id,p_expected_version:1,p_reason:'Reviewed remaining service terms',p_idempotency_key:'key',p_requested_terms:{target_type:'enrollment',package_purchase_id:id,expected_package_version:1,credit_quanta:500,remaining_service_price_minor:12345,replaces_proposal_id:id,expected_replaced_version:1,expires_at:'2026-12-01T10:00:00Z'}};
 expect(packageProposalInputSchema.safeParse(body).success).toBe(true);
 expect(packageProposalInputSchema.safeParse({...body,p_requested_terms:{...body.p_requested_terms,expected_replaced_version:null}}).success).toBe(false);
});

test('approved source-credit grants require an exact payer intent and a distinct source-credit valuation policy',()=>{
 const policy={name:'Reviewed cash credit conversion',eligible_package_contract_version_ids:[id],currency:'EGP',valuation_rule:'reviewed_exact_source_credit',maximum_credit_quanta_per_grant:2000,maximum_carrying_value_minor_per_grant:100000};
 expect(packageGrantPolicyContentSchema.safeParse(policy).success).toBe(true);
 const args={p_package_id:id,p_credit_quanta:1000,p_carrying_value_minor:50000,p_currency:'EGP',p_grant_kind:'approved_credit',p_grant_policy_version_id:id,p_source_credit_id:id,p_credit_conversion_intent_id:id,p_reason:'Actual source owner consent',p_evidence_file_id:null,p_expected_version:1,p_idempotency_key:'credit-intent'};
 expect(packageCommands.approve_package_grant.input.safeParse(args).success).toBe(true);
 expect(packageCommands.approve_package_grant.input.safeParse({...args,p_credit_conversion_intent_id:null}).success).toBe(false);
 expect(packageCommands.approve_package_grant.input.safeParse({...args,p_grant_kind:'complimentary',p_source_credit_id:null}).success).toBe(false);
});
