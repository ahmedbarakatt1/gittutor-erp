import { z } from 'zod';

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const groupSize = z.union([z.literal(2),z.literal(3),z.literal(4)]);
const tier = z.object({ tier_id:z.enum(['group_2','group_3','group_4']), group_size:groupSize, seat_price_minor:minor });
const customer = z.object({ currency:z.literal('EGP'), pricing_unit:z.literal('per_occurrence'), duration_minutes:z.number().int().positive(), group_tiers:z.array(tier).min(1) });
const compensation = z.object({ currency:z.literal('EGP'), group_fee_bands:z.array(z.object({tier_id:z.enum(['group_2','group_3','group_4']),fee_min_minor:minor,fee_max_minor:minor})).min(1) });
function invalid(): never { throw new Error('VALIDATION_ERROR'); }
function safe(value:number):number { if (!Number.isSafeInteger(value)) throw new Error('AMOUNT_OUT_OF_RANGE'); return value; }
function chosenTier(input:unknown,size:unknown) {
  const parsed=customer.safeParse(input); const count=groupSize.safeParse(size);
  if (!parsed.success || !count.success) return invalid();
  const matches=parsed.data.group_tiers.filter(item=>item.group_size===count.data);
  if(matches.length!==1 || matches[0].tier_id!==`group_${count.data}`) return invalid();
  return { pricing:parsed.data,tier:matches[0] };
}
/** Pure privileged calculation: callers supply authorized compensation; no manifest is imported. */
export function validateExactFee(input:unknown,size:unknown,fee:unknown):number {
  const parsed=compensation.safeParse(input); const count=groupSize.safeParse(size); const exact=minor.safeParse(fee);
  if(!parsed.success || !count.success || !exact.success) return invalid();
  const matches=parsed.data.group_fee_bands.filter(band=>band.tier_id===`group_${count.data}`);
  if(matches.length!==1 || matches[0].fee_min_minor>matches[0].fee_max_minor || exact.data<matches[0].fee_min_minor || exact.data>matches[0].fee_max_minor) return invalid();
  return exact.data;
}
export function calculateGroupPricing(pricing:unknown,compensation:unknown,size:unknown,fee:unknown) {
  const chosen=chosenTier(pricing,size); const exact=validateExactFee(compensation,size,fee);
  const total=safe(chosen.tier.group_size*chosen.tier.seat_price_minor);
  return { customer_tuition_total_minor:total,approved_tutor_fee_minor:exact,internal_contribution_minor:safe(total-exact) };
}
/** Shared customer projection for JSON, receipt/email templates and customer exports. */
export function projectCustomerPricing(pricing:unknown,size:unknown,policyVersionId:string,pricingVersionId:string) {
  const chosen=chosenTier(pricing,size);
  if(!z.uuid().safeParse(policyVersionId).success || !z.uuid().safeParse(pricingVersionId).success) return invalid();
  return { contract_id:'git_tutor_customer_pricing' as const,version:pricingVersionId,currency:chosen.pricing.currency,pricing_unit:chosen.pricing.pricing_unit,duration_minutes:chosen.pricing.duration_minutes,
    tier_id:chosen.tier.tier_id,group_size:chosen.tier.group_size,seat_price_minor:chosen.tier.seat_price_minor,
    commercial_policy_version_id:policyVersionId };
}
