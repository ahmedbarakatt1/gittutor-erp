import source from '../../contracts/policy-settings.json';
import price from '../../contracts/pricing-policy.json';

export const policyId = '9d9a5658-a7e2-42d2-8195-4cb1a18d56f0';
export const pricingId = 'f0fb79a4-1e58-4775-b927-c3de9567b795';
export const offerId = 'c86be09f-a1bd-4e17-b5db-a5d866f5bb94';
export function policyFixture(scope: 'group'|'private'): Record<string, unknown> {
  const fixture = source.development_examples.find(example => example.fixture_id === (scope === 'group' ? 'synthetic_group_policy_v1' : 'synthetic_private_booking_policy_v1'))!;
  const content = structuredClone(fixture.policy!) as Record<string, unknown>;
  for (const key of ['policy_version_id','status','environment_scope','is_synthetic','approved_by','approved_at','effective_at']) delete content[key];
  content.customer_pricing_version = pricingId; content.compensation_policy_version = pricingId;
  if (content.package_contract) Object.assign(content.package_contract, { package_policy_version_id: policyId, eligible_offer_ids: [offerId] });
  return content;
}
export function pricingFixture(scope: 'group'|'private') {
  return {
    customer_pricing: { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: 60, group_tiers: scope === 'group' ? structuredClone(price.customer_pricing.group_tiers) : null, private_seat_price_minor: scope === 'private' ? 50000 : null },
    compensation: { currency: 'EGP', group_fee_bands: scope === 'group' ? structuredClone(price.internal_compensation.group_fee_bands) : null, private_fee_rule: scope === 'private' ? { currency: 'EGP', fee_min_minor: 25000, fee_max_minor: 25000, exact_occurrence_approval_required: true } : null },
  };
}
export function pricingVectors() {
  const baseline=pricingFixture('group');
  const privateBaseline=pricingFixture('private');
  type Vector={name:string;scope:'group'|'private';customer_pricing:Record<string,unknown>;compensation:Record<string,unknown>;valid:boolean};
  const vectors:Vector[]=[
    {name:'canonical group',scope:'group',...baseline,valid:true},
    {name:'canonical private',scope:'private',...privateBaseline,valid:true},
    {name:'zero private tariff',scope:'private',...privateBaseline,customer_pricing:{...privateBaseline.customer_pricing,private_seat_price_minor:0},valid:true},
    {name:'new approved contract amounts',scope:'group',...baseline,customer_pricing:{...baseline.customer_pricing,group_tiers:baseline.customer_pricing.group_tiers!.map(tier=>({...tier,seat_price_minor:tier.seat_price_minor+1000}))},valid:true},
    {name:'mismatched format fields',scope:'group',...privateBaseline,valid:false},
    {name:'unsafe group total',scope:'group',...baseline,customer_pricing:{...baseline.customer_pricing,group_tiers:baseline.customer_pricing.group_tiers!.map(tier=>({...tier,seat_price_minor:Number.MAX_SAFE_INTEGER}))},valid:false},
    {name:'fractional private tariff',scope:'private',...privateBaseline,customer_pricing:{...privateBaseline.customer_pricing,private_seat_price_minor:0.5},valid:false},
    {name:'unknown price metadata',scope:'group',...baseline,customer_pricing:{...baseline.customer_pricing,approved_by:policyId},valid:false},
    {name:'duplicate tier identity',scope:'group',...baseline,customer_pricing:{...baseline.customer_pricing,group_tiers:[baseline.customer_pricing.group_tiers![0],{...baseline.customer_pricing.group_tiers![0],seat_price_minor:60000},baseline.customer_pricing.group_tiers![2]]},valid:false},
    {name:'reversed compensation band',scope:'group',...baseline,compensation:{...baseline.compensation,group_fee_bands:baseline.compensation.group_fee_bands!.map(band=>({...band,fee_min_minor:band.fee_max_minor+1}))},valid:false},
    {name:'private fee exact approval false',scope:'private',...privateBaseline,compensation:{...privateBaseline.compensation,private_fee_rule:{...privateBaseline.compensation.private_fee_rule,exact_occurrence_approval_required:false}},valid:false},
  ];
  for(const field of ['currency','pricing_unit','duration_minutes','group_tiers']){
    const pricing=structuredClone(baseline) as {customer_pricing:Record<string,unknown>;compensation:Record<string,unknown>};delete pricing.customer_pricing[field];
    vectors.push({name:`required pricing ${field}`,scope:'group',...pricing,valid:false});
  }
  return vectors;
}
export type PolicyVector = { name: string; scope: 'group'|'private'; content: Record<string, unknown>; valid: boolean };
export function policyVectors(): PolicyVector[] {
  const group = policyFixture('group');
  const variant = (name: string, change: Record<string, unknown>, valid = false): PolicyVector => ({ name, scope: 'group', content: { ...structuredClone(group), ...change }, valid });
  const vectors: PolicyVector[] = [
    variant('complete group', {}, true),
    { name: 'complete private', scope: 'private', content: policyFixture('private'), valid: true },
    variant('zero deposit and false guarantee', { deposit_basis_points: 0, post_confirmation_dropout_price_guarantee: false }, true),
    variant('fractional money', { deposit_basis_points: 0.5 }),
    variant('unknown top-level provenance', { is_synthetic: false }),
    variant('missing applicable field', { duration_minutes: null }),
    variant('group ordering', { group_target_size: 2, group_minimum_size: 3 }),
    variant('unapproved capacity', { group_capacity: 5 }),
    variant('safe integer capacity beyond PostgreSQL integer', { group_capacity: Number.MAX_SAFE_INTEGER }),
    variant('safe integer minimum beyond PostgreSQL integer', { group_minimum_size: Number.MAX_SAFE_INTEGER }),
    variant('pricing refs differ', { compensation_policy_version: offerId }),
    variant('package disabled with funding', { package_enabled: false, package_contract: null }),
    variant('wrong coverage funding', { confirmation_funding_sources: ['reserved_eligible_package_value'] }),
    variant('noninteger quanta', { package_contract: { ...(group.package_contract as object), grant_credit_quanta: 1.5 } }),
    variant('wrong standard quanta', { package_contract: { ...(group.package_contract as object), credit_quanta_per_session: 500 } }),
    variant('expiry missing days', { package_contract: { ...(group.package_contract as object), expiry_mode: 'days_from_grant', expiry_days: null } }),
    variant('unknown nested rule', { package_contract: { ...(group.package_contract as object), refund_remedy_rule: 'double_benefit' } }),
    variant('nested unknown property', { package_contract: { ...(group.package_contract as object), approved_by: 'forged' } }),
    variant('wrong nested identity', { package_contract: { ...(group.package_contract as object), package_policy_version_id: offerId } }),
    variant('cancellation gap', { customer_cancellation_windows: [{ minimum_minutes_before_start: 1, maximum_minutes_before_start_exclusive: null, refund_basis_points: 10000 }] }),
    variant('cancellation overlap', { customer_cancellation_windows: [{ minimum_minutes_before_start: 0, maximum_minutes_before_start_exclusive: 20, refund_basis_points: 0 }, { minimum_minutes_before_start: 10, maximum_minutes_before_start_exclusive: null, refund_basis_points: 10000 }] }),
    variant('cancellation unbounded missing', { customer_cancellation_windows: [{ minimum_minutes_before_start: 0, maximum_minutes_before_start_exclusive: 20, refund_basis_points: 0 }] }),
    variant('zero threshold cancellation', { customer_cancellation_windows: [{ minimum_minutes_before_start: 0, maximum_minutes_before_start_exclusive: null, refund_basis_points: 0 }] }, true),
  ];
  const metadata = new Set(['policy_version_id','environment_scope','is_synthetic','approved_by','approved_at','effective_at']);
  for (const field of [...source.publication_gate.required_fields_common,...source.publication_gate.required_fields_for_group].filter(field=>!metadata.has(field))) {
    const content=structuredClone(group); delete content[field];
    vectors.push({name:`required group ${field}`,scope:'group',content,valid:false});
  }
  for (const field of source.field_contracts.package_contract.required_fields) {
    const content=structuredClone(group); delete (content.package_contract as Record<string,unknown>)[field];
    vectors.push({name:`required package ${field}`,scope:'group',content,valid:false});
  }
  for (const field of source.publication_gate.required_fields_for_private) {
    const content=policyFixture('private'); delete content[field];
    vectors.push({name:`required private ${field}`,scope:'private',content,valid:false});
  }
  return vectors;
}
