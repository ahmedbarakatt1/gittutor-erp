'use client';

import { useState, type FormEvent } from 'react';
import type { CoverageOption, PackageCoverage } from '@/modules/packages/queries';
import { packageCopy as copy } from '@/locales/packages';
import { IdentityForm, TextField } from '../identity-form';
import { useHydrated } from '../use-hydrated';
import { Check, Select, CairoInput, instantField, money } from '../booking/shared';
import { PackageReadState, CreditField, creditField, credits, usePackageRecord } from './shared';
import { PackageProposalReview } from './package-proposals';
import { CoverageRecord } from './package-detail';
import styles from './packages.module.css';
import formStyles from '../auth.module.css';
import { packageCopy as arabicPackageCopy } from '@/locales/ar-transaction/packages';
import { useSiteLanguage } from '@/components/site-language';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPackageCopy },
};


type Options = { enrollment: { enrollment_id: string; version: number; learner_id: string; quote_id: string; quote_version: number; quote_hash: string }; current_coverage: PackageCoverage | null; items: CoverageOption[]; next_cursor: string | null };

export function BookingPackageCoverage({ enrollmentId }: { enrollmentId: string }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const hydrated = useHydrated();
  const [selected, setSelected] = useState(''); const [quantity, setQuantity] = useState<number | null>(null); const [cursor, setCursor] = useState(''); const [created, setCreated] = useState('');
  const params = new URLSearchParams(); if (selected) params.set('package_id', selected); if (quantity !== null) params.set('credit_quanta', String(quantity)); if (cursor) params.set('cursor', cursor);
  const record = usePackageRecord<Options>(`enrollments/${enrollmentId}/package-options${params.size ? `?${params}` : ''}`); const result = record.data; const choice = result?.items.find(row => row.package_purchase_id === selected);
  function preview(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; try { setQuantity(creditField(new FormData(event.currentTarget), 'credits')); setCreated(''); } catch { event.currentTarget.reportValidity(); } }
  return <section className={styles.section} id="package-coverage"><h2>{copy.coverageTitle}</h2><p>{copy.coverageDescription}</p><PackageReadState pending={!result} {...record} />{result?.current_coverage ? <CoverageRecord item={result.current_coverage} onSaved={record.reload} /> : result && <><Select name="package_id" label={copy.selectPackage} value={selected} onChange={value => { setSelected(value); setQuantity(null); setCursor(''); setCreated(''); }}><option value="">{copy.choosePackage}</option>{result.items.map(item => <option key={item.package_purchase_id} value={item.package_purchase_id}>{item.title} · {credits(item.available_credit_quanta, uiLanguage)} · {item.package_purchase_id.slice(0, 8)}</option>)}</Select>{!result.items.length && <p>{copy.noOptions}</p>}{result.next_cursor && !selected && <button type="button" className={formStyles.signout} onClick={() => setCursor(result.next_cursor!)}>{copy.more}</button>}{choice && <div key={`${choice.package_purchase_id}-${choice.version}-${choice.requested_credit_quanta}`}><form className={formStyles.form} aria-label={copy.preview} onSubmit={preview}><fieldset className={formStyles.formFields} disabled={!hydrated}><CreditField name="credits" label={copy.requestedCredits} defaultValue={choice.requested_credit_quanta} max={choice.required_credit_quanta} /><button type="submit" className={formStyles.signout}>{copy.preview}</button></fieldset></form><h3>{copy.serverPreview}</h3><p>{copy.reasons[choice.reason]}</p><dl className={styles.facts}><div><dt>{copy.quantity}</dt><dd><bdi dir="auto">{credits(choice.requested_credit_quanta, uiLanguage)}</bdi></dd></div><div><dt>{copy.appliedValue}</dt><dd><bdi dir="auto">{choice.carrying_value_minor === null ? copy.unavailable : money(choice.carrying_value_minor, 'EGP', uiLanguage)}</bdi></dd></div><div><dt>{copy.referencePrice}</dt><dd><bdi dir="auto">{money(choice.standalone_reference_price_minor, 'EGP', uiLanguage)}</bdi></dd></div><div><dt>{copy.agreedTopUp}</dt><dd><bdi dir="auto">{choice.agreed_top_up_minor === null ? copy.unknownPrice : money(choice.agreed_top_up_minor, 'EGP', uiLanguage)}</bdi></dd></div></dl>{choice.coverage_rule === 'named_entitlement_covers_eligible_occurrence' && choice.requested_credit_quanta === choice.required_credit_quanta && <p>{copy.fullNamed}</p>}
      {choice.requires_proposal && !choice.coverage_proposal_id ? <><p>{copy.reviewRequired}</p>{choice.requires_admin_review && <p>{copy.adminReviewRequired}</p>}<IdentityForm action="operation-proposals" submitLabel={copy.requestReview} successMessage={copy.reviewSaved} resettable={false} onSaved={data => setCreated(String(data.proposal_id))} payload={form => ({ kind: 'package_coverage', target_id: enrollmentId, expected_version: result.enrollment.version, reason: String(form.get('reason')).trim(), requested_terms: { target_type: 'enrollment', package_purchase_id: choice.package_purchase_id, expected_package_version: choice.version, credit_quanta: choice.requested_credit_quanta, remaining_service_price_minor: null, expires_at: instantField(form, 'expires_at') } })}><CairoInput name="expires_at" label={copy.expires} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm></> : <IdentityForm action={`packages/${choice.package_purchase_id}/reserve`} submitLabel={copy.reserve} successMessage={copy.reservedSaved} resettable={false} disabled={!choice.eligible} onSaved={record.reload} payload={() => ({ enrollment_id: enrollmentId, credit_quanta: choice.requested_credit_quanta, coverage_proposal_id: choice.coverage_proposal_id, expected_version: choice.version })}><Check name="package_reservation_consent" label={copy.reserveConsent} /></IdentityForm>}
      {created && <PackageProposalReview id={created} learnerId={result.enrollment.learner_id} view="customer" onSaved={record.reload} />}
    </div>}</>}</section>;
}
