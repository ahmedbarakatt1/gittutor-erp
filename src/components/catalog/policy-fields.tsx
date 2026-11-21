'use client';

import { useId, useState } from 'react';
import { parseScaledIntegerInput, scaledIntegerInput } from '@/modules/shared/format';
import { policyFields, policyCopy as copy } from '@/locales/catalog-policy';
import { catalogCopy } from '@/locales/catalog';
import type { AdminOffer } from '@/modules/catalog/queries';
import styles from './catalog.module.css';
import formStyles from '../auth.module.css';
import { policyFields as arabicPolicyFields, policyCopy as arabicPolicyCopy } from '@/locales/ar-transaction/catalog-policy';
import { catalogCopy as arabicCatalogCopy } from '@/locales/ar-transaction/catalog';
import { useSiteLanguage } from '@/components/site-language';


export type PolicyContent = Record<string, unknown>;
type FieldKey = keyof typeof policyFields;
type Field = { label: string; min?: number; max?: number; options?: Record<string, string>; numeric?: boolean; boolean?: boolean; basisPoints?: boolean };
const fields: Record<FieldKey, Field> = policyFields;
const textByLanguage = {
  en: { fields, copy, catalogCopy },
  ar: { fields: arabicPolicyFields as Record<FieldKey, Field>, copy: arabicPolicyCopy, catalogCopy: arabicCatalogCopy },
};

export const basics: FieldKey[] = ['hold_minutes', 'confirmation_deadline_minutes_before_start', 'deposit_basis_points', 'deposit_rounding'];
export const groups: FieldKey[] = ['group_target_size', 'group_capacity', 'group_minimum_size', 'formation_failure_action', 'amendment_acceptance_minutes', 'latest_amendment_minutes_before_start', 'post_confirmation_dropout_price_guarantee'];
export const delivery: FieldKey[] = ['learner_no_show_rule', 'individual_early_departure_rule', 'partial_class_remedy_rule', 'partial_class_rounding'];

function PolicyField({ name, value }: { name: FieldKey; value: unknown }) {
  const uiLanguage = useSiteLanguage();
  const { fields, copy } = textByLanguage[uiLanguage];

  const id = useId(); const definition = fields[name];
  const initial = value === null || value === undefined ? '' : definition.basisPoints ? scaledIntegerInput(Number(value), 2) : String(value);
  return <div className={formStyles.field}><label htmlFor={id}>{definition.label}</label>{definition.options ? <select id={id} name={name} defaultValue={initial} required><option value="">{copy.choose}</option>{Object.entries(definition.options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select> : <input id={id} name={name} type="number" step={definition.basisPoints ? '0.01' : '1'} min={definition.min} max={definition.max} defaultValue={initial} required />}</div>;
}

type Window = { minimum_minutes_before_start: number | null; maximum_minutes_before_start_exclusive: number | null; refund_basis_points: number | null };
export function PolicyFields({ content, scope, offers }: { content: PolicyContent; scope: 'group' | 'private'; offers: AdminOffer[] }) {
  const uiLanguage = useSiteLanguage();
  const { catalogCopy, copy } = textByLanguage[uiLanguage];

  const initial = Array.isArray(content.customer_cancellation_windows) ? content.customer_cancellation_windows as Window[] : [{ minimum_minutes_before_start: 0, maximum_minutes_before_start_exclusive: null, refund_basis_points: null }];
  const [windows, setWindows] = useState(initial.map((value, index) => ({ value, key: index })));
  const [nextWindow, setNextWindow] = useState(initial.length);
  const refundOptions = Array.isArray(content.allowed_refund_remedies) ? content.allowed_refund_remedies : [];
  const funding = Array.isArray(content.confirmation_funding_sources) ? content.confirmation_funding_sources : [];
  const [packageEnabled, setPackageEnabled] = useState(content.package_enabled === true);
  const contract = typeof content.package_contract === 'object' && content.package_contract !== null ? content.package_contract as PolicyContent : {};
  const [expiry, setExpiry] = useState(String(contract.expiry_mode || 'none'));
  const eligible = Array.isArray(contract.eligible_offer_ids) ? contract.eligible_offer_ids : [];
  const formats = Array.isArray(contract.eligible_formats) ? contract.eligible_formats : [];
  const prefix = useId();
  return <>
    <fieldset className={styles.editorGroup}><legend>{catalogCopy.admin.termsGroups.basics}</legend><div className={styles.formGrid}>{basics.map(name => <PolicyField key={name} name={name} value={content[name]} />)}</div><fieldset className={formStyles.checkGroup}><legend>{copy.funding}</legend>{Object.entries(copy.package.fundingOptions).filter(([key]) => packageEnabled || key === 'verified_payment_allocation').map(([key, text]) => <label key={key}><input type="checkbox" name="confirmation_funding_sources" value={key} defaultChecked={funding.includes(key)} />{text}</label>)}</fieldset><p className={formStyles.hint}>{copy.fundingNote}</p></fieldset>
    {scope === 'group' && <fieldset className={styles.editorGroup}><legend>{catalogCopy.admin.termsGroups.group}</legend><div className={styles.formGrid}>{groups.map(name => <PolicyField key={name} name={name} value={content[name]} />)}</div><p className={formStyles.hint}>{copy.groupAcceptance}</p></fieldset>}
    <fieldset className={styles.editorGroup}><legend>{copy.cancellationWindows}</legend><p className={formStyles.hint}>{copy.cancellationHint}</p>{windows.map(({ value, key }, index) => <div className={styles.windowRow} key={key}>
      <div className={formStyles.field}><label htmlFor={`window-min-${key}`}>{copy.minimum}</label><input id={`window-min-${key}`} name={`window_min_${index}`} type="number" min="0" step="1" required defaultValue={value.minimum_minutes_before_start ?? ''} /></div>
      <div className={formStyles.field}><label htmlFor={`window-max-${key}`}>{copy.maximum}</label><input id={`window-max-${key}`} name={`window_max_${index}`} type="number" min="1" step="1" defaultValue={value.maximum_minutes_before_start_exclusive ?? ''} /></div>
      <div className={formStyles.field}><label htmlFor={`window-refund-${key}`}>{copy.refund}</label><input id={`window-refund-${key}`} name={`window_refund_${index}`} type="number" min="0" max="100" step="0.01" required defaultValue={typeof value.refund_basis_points === 'number' ? scaledIntegerInput(value.refund_basis_points, 2) : ''} /></div>
      {windows.length > 1 && <button type="button" className={formStyles.signout} onClick={() => setWindows(items => items.filter(item => item.key !== key))}>{copy.removeWindow}</button>}
    </div>)}<input type="hidden" name="window_count" value={windows.length} /><button type="button" className={formStyles.signout} onClick={() => { setWindows(items => [...items, { key: nextWindow, value: { minimum_minutes_before_start: 0, maximum_minutes_before_start_exclusive: null, refund_basis_points: null } }]); setNextWindow(value => value + 1); }}>{copy.addWindow}</button><p className={formStyles.hint}>{copy.platformCancellation}</p>
      <fieldset className={formStyles.checkGroup}><legend>{copy.remedies}</legend><label><input type="checkbox" name="allowed_refund_remedies" value="cash_refund" defaultChecked={refundOptions.includes('cash_refund')} />{copy.cash}</label><label><input type="checkbox" name="allowed_refund_remedies" value="monetary_account_credit" defaultChecked={refundOptions.includes('monetary_account_credit')} />{copy.credit}</label>{packageEnabled && <label><input type="checkbox" name="allowed_refund_remedies" value="package_entitlement_restoration" defaultChecked={refundOptions.includes('package_entitlement_restoration')} />{copy.package.restore}</label>}</fieldset>
    </fieldset>
    <fieldset className={styles.editorGroup}><legend>{catalogCopy.admin.termsGroups.delivery}</legend><div className={styles.formGrid}>{delivery.map(name => <PolicyField key={name} name={name} value={content[name]} />)}</div></fieldset>
    <fieldset className={styles.editorGroup}><legend>{copy.package.title}</legend><label><input type="checkbox" name="package_enabled" checked={packageEnabled} onChange={event => setPackageEnabled(event.target.checked)} /> {copy.package.enabled}</label>
      {packageEnabled && <><fieldset className={formStyles.checkGroup}><legend>{copy.package.eligibleOffers}</legend><p className={formStyles.hint}>{copy.package.eligibleHint}</p>{offers.length ? offers.map(offer => <label key={offer.offer_id}><input type="checkbox" name="eligible_offer_ids" value={offer.offer_id} defaultChecked={eligible.includes(offer.offer_id)} />{offer.title} · {offer.status} · {offer.offer_id.slice(0, 8)}</label>) : <p>{copy.package.noOffers}</p>}</fieldset>
        <div className={styles.formGrid}><div className={formStyles.field}><label htmlFor={`${prefix}-grant`}>{copy.package.grant}</label><input id={`${prefix}-grant`} name="package_grant" type="number" min="0.001" step="0.001" required defaultValue={typeof contract.grant_credit_quanta === 'number' ? scaledIntegerInput(contract.grant_credit_quanta, 3) : ''} /></div><div className={formStyles.field}><label htmlFor={`${prefix}-duration`}>{copy.package.duration}</label><input id={`${prefix}-duration`} name="package_duration" type="number" min="1" step="1" required defaultValue={typeof contract.base_duration_minutes === 'number' ? contract.base_duration_minutes : ''} /></div><div className={formStyles.field}><label htmlFor={`${prefix}-value`}>{copy.package.value}</label><input id={`${prefix}-value`} name="package_value" type="number" min="0" step="0.01" required defaultValue={typeof contract.purchase_value_minor === 'number' ? scaledIntegerInput(contract.purchase_value_minor, 2) : ''} /></div></div>
        <fieldset className={formStyles.checkGroup}><legend>{copy.package.formats}</legend>{(['group', 'private'] as const).map(format => <label key={format}><input type="checkbox" name="eligible_formats" value={format} defaultChecked={formats.includes(format)} />{catalogCopy.formats[format]}</label>)}</fieldset>
        <div className={formStyles.field}><label htmlFor={`${prefix}-coverage`}>{copy.package.coverage}</label><select id={`${prefix}-coverage`} name="coverage_rule" required defaultValue={String(contract.coverage_rule || '')}><option value="">{copy.choose}</option>{Object.entries(copy.package.coverageOptions).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
        <div className={styles.formGrid}><div className={formStyles.field}><label htmlFor={`${prefix}-activation`}>{copy.package.activation}</label><select id={`${prefix}-activation`} name="purchase_activation_rule" required defaultValue={String(contract.purchase_activation_rule || '')}><option value="">{copy.choose}</option>{Object.entries(copy.package.activationOptions).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div><div className={formStyles.field}><label htmlFor={`${prefix}-clock`}>{copy.package.expiryClock}</label><select id={`${prefix}-clock`} name="expiry_clock" required defaultValue={String(contract.expiry_clock || '')}><option value="">{copy.choose}</option>{Object.entries(copy.package.expiryClockOptions).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div></div>
        <div className={formStyles.field}><label htmlFor={`${prefix}-expiry`}>{copy.package.expiry}</label><select id={`${prefix}-expiry`} name="expiry_mode" value={expiry} onChange={event => setExpiry(event.target.value)}>{Object.entries(copy.package.expiryOptions).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>{expiry === 'days_from_grant' && <div className={formStyles.field}><label htmlFor={`${prefix}-days`}>{copy.package.days}</label><input id={`${prefix}-days`} name="expiry_days" type="number" min="1" step="1" required defaultValue={typeof contract.expiry_days === 'number' ? contract.expiry_days : ''} /></div>}<p className={formStyles.hint}>{copy.package.rules}</p>
      </>}
    </fieldset>
    <fieldset className={styles.editorGroup}><legend>{catalogCopy.admin.termsGroups.compensation}</legend><p className={formStyles.hint}>{copy.compensationRules}</p></fieldset>
  </>;
}

export function readPolicyFields(form: FormData, scope: 'group' | 'private'): PolicyContent {
  const result: PolicyContent = {};
  for (const name of [...basics, ...delivery, ...(scope === 'group' ? groups : [])]) {
    const field = fields[name]; const value = String(form.get(name) ?? '');
    result[name] = field.boolean ? value === 'true' : field.basisPoints ? parseScaledIntegerInput(value, 2) : field.numeric || !field.options ? Number(value) : value;
  }
  result.customer_cancellation_windows = Array.from({ length: Number(form.get('window_count')) }, (_, index) => ({ minimum_minutes_before_start: Number(form.get(`window_min_${index}`)), maximum_minutes_before_start_exclusive: form.get(`window_max_${index}`) === '' ? null : Number(form.get(`window_max_${index}`)), refund_basis_points: parseScaledIntegerInput(String(form.get(`window_refund_${index}`) ?? ''), 2) }));
  result.allowed_refund_remedies = form.getAll('allowed_refund_remedies');
  if (!(result.allowed_refund_remedies as string[]).length) throw new Error('Choose at least one refund remedy.');
  const funding = form.getAll('confirmation_funding_sources');
  if (!funding.length) throw new Error('Choose confirmation funding');
  const packageEnabled = form.get('package_enabled') === 'on';
  Object.assign(result, { confirmation_funding_sources: funding, package_enabled: packageEnabled, package_contract: null, tutor_cancellation_compensation_rule: 'reviewed_exact_adjustment', platform_or_tutor_cancellation_remedy: 'full_customer_value_resolution', tutor_fee_for_delivered_session: 'agreed_fee_subject_to_approved_adjustments' });
  if (packageEnabled) {
    const eligible = form.getAll('eligible_offer_ids'); const formats = form.getAll('eligible_formats');
    if (!eligible.length || !formats.length) throw new Error('Choose package eligibility');
    result.package_contract = { eligible_offer_ids: eligible, credit_quanta_per_session: 1000, grant_credit_quanta: parseScaledIntegerInput(String(form.get('package_grant') ?? ''), 3), base_duration_minutes: Number(form.get('package_duration')), eligible_formats: formats, purchase_value_minor: parseScaledIntegerInput(String(form.get('package_value') ?? ''), 2), currency: 'EGP', purchase_activation_rule: form.get('purchase_activation_rule'), expiry_clock: form.get('expiry_clock'), coverage_rule: form.get('coverage_rule'), expiry_mode: form.get('expiry_mode'), ...(form.get('expiry_mode') === 'days_from_grant' ? { expiry_days: Number(form.get('expiry_days')) } : {}), expired_value_accounting_rule: 'reviewed_contractual_resolution', restoration_expiry_rule: 'preserve_original_lot_terms', carryover_rule: 'transfer_available_units_and_actual_value', rounding_rule: 'largest_remainder_batches_and_final_residual_sequentially', partial_consumption_rule: 'reviewed_exact_credit_quanta_and_value', refund_remedy_rule: 'exclusive_or_value_bounded_split_of_cash_credit_restoration' };
  }
  if (scope === 'group') Object.assign(result, { amendment_acceptance_rule: 'all_affected_authorized_bookers_and_assigned_tutor', below_minimum_group_action: 'admin_proposal_with_customer_acceptance' });
  return result;
}
