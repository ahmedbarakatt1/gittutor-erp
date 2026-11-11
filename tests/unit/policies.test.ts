import { describe, expect, test } from 'vitest';
import { policyContentSchema, validatePolicyContent, validatePricingContent, validatePublicationProvenance } from '../../src/modules/catalog/policies';
import { policyFixture, policyId, policyVectors, pricingFixture, pricingVectors } from './policy-vectors';
import { getPublicTutor, projectCustomerPolicy } from '../../src/modules/catalog/queries';
import { invokeCatalogCommandWithStatus } from '../../src/modules/catalog/commands';
import schemas from '../../contracts/runtime/catalog-schemas.json';

describe('T03 typed editable commercial policy', () => {
  test('the shared schema stays within the experimentally verified Zod/PostgreSQL dialect', () => {
    const supported=new Set(['$schema','type','properties','additionalProperties','required','anyOf','items','minItems','maxItems','uniqueItems','minimum','maximum','minLength','maxLength','pattern','enum','const']);
    function inspect(node:Record<string,unknown>) {
      for(const key of Object.keys(node)) expect(supported.has(key),`unsupported schema keyword ${key}`).toBe(true);
      if(node.type==='array') expect(node).toHaveProperty('items');
      if(Object.hasOwn(node,'enum') || Object.hasOwn(node,'const')) expect(Object.keys(node)).toHaveLength(1);
      if(node.type==='object') expect(node.additionalProperties).toBe(false);
      if(node.properties) for(const value of Object.values(node.properties as object)) inspect(value);
      if(node.items) inspect(node.items as Record<string,unknown>);
      if(node.anyOf) for(const value of node.anyOf as Record<string,unknown>[]) inspect(value);
    }
    inspect(schemas.policy_content); inspect(schemas.customer_pricing); inspect(schemas.compensation);
  });
  test('drafts retain missing/null and zero/false without accepting server provenance', () => {
    expect(policyContentSchema.safeParse({ duration_minutes: null, deposit_basis_points: 0, package_enabled: false }).success).toBe(true);
    expect(policyContentSchema.safeParse({ approved_by: policyId }).success).toBe(false);
    expect(policyContentSchema.safeParse({ package_contract: { grant_credit_quanta: 1.1 } }).success).toBe(false);
  });
  test.each(policyVectors())('$name', ({scope,content,valid}) => {
    expect(validatePolicyContent(content, { scope, complete: true, policyId }).length === 0).toBe(valid);
  });
  test.each(['group','private'] as const)('complete %s pricing matches canonical amounts', scope => {
    const pricing = pricingFixture(scope);
    expect(validatePricingContent(pricing.customer_pricing, pricing.compensation, { scope, complete: true })).toEqual([]);
  });
  test.each(pricingVectors())('pricing vector $name', vector => {
    expect(validatePricingContent(vector.customer_pricing,vector.compensation,{scope:vector.scope,complete:true}).length===0).toBe(vector.valid);
  });
  test('rejects fractional, unsafe, duplicate and reversed pricing bands', () => {
    const pricing = pricingFixture('group');
    expect(validatePricingContent({ ...pricing.customer_pricing, group_tiers: [{tier_id:'group_2',group_size:2,seat_price_minor:1.5}] },pricing.compensation,{scope:'group',complete:true}).length).toBeGreaterThan(0);
    expect(validatePricingContent(pricing.customer_pricing,{...pricing.compensation,group_fee_bands:[{tier_id:'group_2',fee_min_minor:45000,fee_max_minor:44000}]},{scope:'group',complete:true}).length).toBeGreaterThan(0);
  });
  test('missing required common settings block approval individually', () => {
    const base = policyFixture('private');
    for (const field of ['currency','pricing_unit','duration_minutes','hold_minutes','deposit_basis_points','package_enabled','allowed_refund_remedies','partial_class_rounding']) {
      const changed = {...base}; delete changed[field];
      expect(validatePolicyContent(changed,{scope:'private',complete:true,policyId}),field).not.toEqual([]);
    }
  });
  test('live publication rejects synthetic or development provenance; isolated publication accepts it', () => {
    const record = { status:'approved', environment_scope:'development_test',is_synthetic:true,approved_by:policyId,approved_at:'2026-11-11T09:00:00Z',effective_at:'2026-12-01T00:00:00Z' };
    expect(validatePublicationProvenance(record,'production')).not.toEqual([]);
    expect(validatePublicationProvenance(record,'development_test')).toEqual([]);
    expect(validatePublicationProvenance({...record,is_synthetic:false},'development_test')).not.toEqual([]);
    expect(validatePublicationProvenance({...record,environment_scope:'production',is_synthetic:false},'production')).toEqual([]);
  });
  test('public policy projection rejects incomplete material terms and excludes every compensation field', () => {
    const complete = policyFixture('group');
    const projected = projectCustomerPolicy({...complete,private_fee_rule:{fee_min_minor:62500,secret:'PRIVATE_MARKER'},internal_notes:'PRIVATE_MARKER'});
    expect(JSON.stringify(projected)).not.toMatch(/private_fee_rule|compensation_policy_version|tutor_fee|tutor_cancellation_compensation|PRIVATE_MARKER|internal_notes/);
    expect(() => projectCustomerPolicy({...complete,duration_minutes:null})).toThrow('POLICY_INCOMPLETE');
    expect(() => projectCustomerPolicy({...complete,package_contract:{...(complete.package_contract as object),private_note:'PRIVATE_MARKER'}})).toThrow('POLICY_INCOMPLETE');
  });
  test('catalog boundaries reject extra authority fields before RPC and private response/error fields after RPC', async () => {
    let calls=0;
    const noCall={rpc:async()=>{calls++;return {data:{},error:null,status:200};}};
    await expect(invokeCatalogCommandWithStatus(noCall,'create_policy_draft',{p_kind:'booking',p_scope:'group',p_content:{is_synthetic:false},p_idempotency_key:'test'})).rejects.toThrow('VALIDATION_ERROR');
    expect(calls).toBe(0);
    const leaked={rpc:async()=>({data:{tutor_id:policyId,display_name:'Synthetic tutor',bio:'Approved public bio',subjects:[],photo_reference:null,private_fee_minor:62500},error:null,status:200})};
    await expect(getPublicTutor(leaked,policyId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    const failed={rpc:async()=>({data:null,error:{message:'PRIVATE_MARKER credentials in provider failure'},status:500})};
    await expect(getPublicTutor(failed,policyId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  });
});
