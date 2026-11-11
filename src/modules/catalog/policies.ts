import { z } from 'zod';
import schemas from '../../../contracts/runtime/catalog-schemas.json';

export type CatalogScope = 'group' | 'private';
export type JsonObject = Record<string, unknown>;
type JsonSchema = Parameters<typeof z.fromJSONSchema>[0];
// The committed schema uses only the converter's tested subset. No defaults or coercions.
export const policyContentSchema = z.fromJSONSchema(schemas.policy_content as JsonSchema) as z.ZodType<JsonObject>;
export const customerPricingSchema = z.fromJSONSchema(schemas.customer_pricing as JsonSchema) as z.ZodType<JsonObject>;
export const compensationSchema = z.fromJSONSchema(schemas.compensation as JsonSchema) as z.ZodType<JsonObject>;
export const catalogSchemaVersion = schemas.schema_version;

export const policyRequiredCommon = ['offer_format','currency','pricing_unit','duration_minutes','customer_pricing_version','compensation_policy_version',
  'hold_minutes','confirmation_deadline_minutes_before_start','deposit_basis_points','deposit_rounding','confirmation_funding_sources',
  'customer_cancellation_windows','tutor_cancellation_compensation_rule','platform_or_tutor_cancellation_remedy','learner_no_show_rule',
  'tutor_fee_for_delivered_session','individual_early_departure_rule','partial_class_remedy_rule','partial_class_rounding','allowed_refund_remedies','package_enabled'] as const;
export const policyRequiredGroup = ['group_target_size','group_capacity','group_minimum_size','formation_failure_action','amendment_acceptance_rule',
  'amendment_acceptance_minutes','latest_amendment_minutes_before_start','post_confirmation_dropout_price_guarantee','below_minimum_group_action'] as const;
export const packageRequired = ['package_policy_version_id','eligible_offer_ids','credit_quanta_per_session','grant_credit_quanta','base_duration_minutes',
  'eligible_formats','purchase_value_minor','currency','coverage_rule','expiry_mode','expired_value_accounting_rule','restoration_expiry_rule','carryover_rule',
  'rounding_rule','partial_consumption_rule','refund_remedy_rule'] as const;
const feeRequired = ['currency','fee_min_minor','fee_max_minor','exact_occurrence_approval_required'];
const present = (value: unknown) => value !== null && value !== undefined;
const object = (value: unknown): JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const number = (value: unknown) => typeof value === 'number' ? value : NaN;
function required(value: JsonObject, names: readonly string[], errors: string[], prefix = '') {
  for (const name of names) if (!present(value[name])) errors.push(`${prefix}${name}`);
}
function structural(schema: z.ZodType, content: unknown, prefix = '') {
  const parsed = schema.safeParse(content);
  return parsed.success ? [] : [...new Set(parsed.error.issues.map(issue => `${prefix}${issue.path.join('.') || '$'}`))];
}
function feeErrors(value: unknown, errors: string[], prefix: string) {
  const fee = object(value); required(fee, feeRequired, errors, prefix);
  if (number(fee.fee_min_minor) > number(fee.fee_max_minor)) errors.push(`${prefix}fee_max_minor`);
}

export function validatePricingContent(customer: unknown, compensation: unknown, options: { scope: CatalogScope; complete: boolean }): string[] {
  const errors = [...structural(customerPricingSchema, customer, 'customer_pricing.'), ...structural(compensationSchema, compensation, 'compensation.')];
  if (errors.length || !options.complete) return errors;
  const c = object(customer); const f = object(compensation);
  required(c, ['currency','pricing_unit','duration_minutes'], errors, 'customer_pricing.');
  required(f, ['currency'], errors, 'compensation.');
  if (options.scope === 'private') {
    required(c, ['private_seat_price_minor'], errors, 'customer_pricing.');
    required(f, ['private_fee_rule'], errors, 'compensation.');
    feeErrors(f.private_fee_rule, errors, 'compensation.private_fee_rule.');
    if (present(c.group_tiers) || present(f.group_fee_bands)) errors.push('scope');
  } else {
    const tiers = array(c.group_tiers).map(object); const bands = array(f.group_fee_bands).map(object);
    if (tiers.length !== 3 || new Set(tiers.map(t => t.tier_id)).size !== 3 || new Set(tiers.map(t => t.group_size)).size !== 3) errors.push('customer_pricing.group_tiers');
    if (bands.length !== 3 || new Set(bands.map(t => t.tier_id)).size !== 3) errors.push('compensation.group_fee_bands');
    for (const [index,tier] of tiers.entries()) {
      required(tier, ['tier_id','group_size','seat_price_minor'], errors, `customer_pricing.group_tiers.${index}.`);
      if (tier.tier_id !== `group_${tier.group_size}`) errors.push(`customer_pricing.group_tiers.${index}.tier_id`);
      if (!Number.isSafeInteger(number(tier.group_size) * number(tier.seat_price_minor))) errors.push(`customer_pricing.group_tiers.${index}.seat_price_minor`);
    }
    for (const [index,band] of bands.entries()) {
      required(band, ['tier_id','fee_min_minor','fee_max_minor'], errors, `compensation.group_fee_bands.${index}.`);
      if (number(band.fee_min_minor) > number(band.fee_max_minor)) errors.push(`compensation.group_fee_bands.${index}.fee_max_minor`);
    }
    if (present(c.private_seat_price_minor) || present(f.private_fee_rule)) errors.push('scope');
  }
  return [...new Set(errors)];
}

export function validatePolicyContent(content: unknown, options: {
  scope: CatalogScope; complete: boolean; policyId?: string;
  pricing?: { pricing_version_id: string; scope: CatalogScope; customer_pricing: unknown; compensation: unknown };
}): string[] {
  const errors = structural(policyContentSchema, content);
  if (errors.length || !options.complete) return errors;
  const p = object(content);
  required(p, policyRequiredCommon, errors);
  if (p.offer_format !== options.scope) errors.push('offer_format');
  if (p.customer_pricing_version !== p.compensation_policy_version) errors.push('compensation_policy_version');
  if (options.scope === 'group') {
    required(p, policyRequiredGroup, errors);
    if (!(number(p.group_minimum_size) <= number(p.group_target_size) && number(p.group_target_size) <= number(p.group_capacity)) || number(p.group_capacity) > 4) errors.push('group_capacity');
    if (present(p.private_seat_price_minor) || present(p.private_fee_rule)) errors.push('scope');
  } else {
    required(p, ['private_seat_price_minor','private_fee_rule'], errors); feeErrors(p.private_fee_rule, errors, 'private_fee_rule.');
    if (policyRequiredGroup.some(field => present(p[field]))) errors.push('scope');
  }
  const windows = array(p.customer_cancellation_windows).map(object).sort((a,b) => number(a.minimum_minutes_before_start)-number(b.minimum_minutes_before_start));
  let expected = 0;
  if (!windows.length) errors.push('customer_cancellation_windows');
  for (const [index,window] of windows.entries()) {
    required(window, ['minimum_minutes_before_start','refund_basis_points'], errors, `customer_cancellation_windows.${index}.`);
    if (!Object.hasOwn(window,'maximum_minutes_before_start_exclusive') || window.minimum_minutes_before_start !== expected) errors.push('customer_cancellation_windows');
    const upper = window.maximum_minutes_before_start_exclusive;
    if (upper === null) {
      if (index !== windows.length-1) errors.push('customer_cancellation_windows');
      expected = Infinity;
    } else {
      if (!(number(upper) > number(window.minimum_minutes_before_start))) errors.push('customer_cancellation_windows');
      expected = number(upper);
    }
  }
  if (expected !== Infinity) errors.push('customer_cancellation_windows');
  const funding = array(p.confirmation_funding_sources);
  const remedies = array(p.allowed_refund_remedies);
  if (p.package_enabled === false) {
    if (present(p.package_contract)) errors.push('package_contract');
    if (funding.some(value => value !== 'verified_payment_allocation')) errors.push('confirmation_funding_sources');
    if (remedies.includes('package_entitlement_restoration')) errors.push('allowed_refund_remedies');
    if (p.learner_no_show_rule === 'retain_charge_consume_reserved_entitlement') errors.push('learner_no_show_rule');
  } else if (p.package_enabled === true) {
    const pack = object(p.package_contract); required(pack, packageRequired, errors, 'package_contract.');
    if (options.policyId && pack.package_policy_version_id !== options.policyId) errors.push('package_contract.package_policy_version_id');
    if (!array(pack.eligible_formats).includes(options.scope)) errors.push('package_contract.eligible_formats');
    if (pack.currency !== p.currency) errors.push('package_contract.currency');
    if (pack.expiry_mode === 'days_from_grant' && !present(pack.expiry_days)) errors.push('package_contract.expiry_days');
    if (pack.expiry_mode === 'none' && present(pack.expiry_days)) errors.push('package_contract.expiry_days');
    const named = pack.coverage_rule === 'named_entitlement_covers_eligible_occurrence';
    const matching = named ? 'reserved_named_package_entitlement' : 'reserved_eligible_package_value';
    const opposite = named ? 'reserved_eligible_package_value' : 'reserved_named_package_entitlement';
    if (!funding.includes(matching) || funding.includes(opposite)) errors.push('confirmation_funding_sources');
  }
  if (p.partial_class_remedy_rule === 'approved_duration_proration' && p.partial_class_rounding !== 'largest_remainder_minor_unit') errors.push('partial_class_rounding');
  if (options.pricing) {
    const pricing = options.pricing; const c = object(pricing.customer_pricing); const f = object(pricing.compensation);
    if (pricing.scope !== options.scope || pricing.pricing_version_id !== p.customer_pricing_version) errors.push('customer_pricing_version');
    for (const field of ['currency','pricing_unit','duration_minutes']) if (c[field] !== p[field]) errors.push(field);
    if (options.scope === 'private') {
      if (p.private_seat_price_minor !== c.private_seat_price_minor) errors.push('private_seat_price_minor');
      const configured = object(f.private_fee_rule); const requested = object(p.private_fee_rule);
      if (feeRequired.some(field => configured[field] !== requested[field])) errors.push('private_fee_rule');
    }
    errors.push(...validatePricingContent(c,f,{scope:options.scope,complete:true}));
  }
  return [...new Set(errors)];
}

export function validatePublicationProvenance(record: unknown, deployment: 'production'|'development_test'): string[] {
  const schema = z.object({ status:z.enum(['approved','published']), environment_scope:z.enum(['production','development_test']), is_synthetic:z.boolean(),
    approved_by:z.uuid(), approved_at:z.iso.datetime({offset:true}), effective_at:z.iso.datetime({offset:true}) });
  const parsed = schema.safeParse(record);
  if (!parsed.success) return ['approval'];
  if (parsed.data.environment_scope !== deployment || parsed.data.is_synthetic !== (deployment === 'development_test')) return ['environment_scope'];
  return [];
}
