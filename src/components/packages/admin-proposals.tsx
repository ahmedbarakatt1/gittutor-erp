'use client';

import { useState, type FormEvent } from 'react';
import type { PackageContract, PackageEnrollment, PackageSummary, CoverageOption, PackageProposalSummary } from '@/modules/packages/queries';
import type { PackageProposal } from '@/modules/packages/proposal-contract';
import { packageCopy as copy, packageAdminCopy as adminCopy } from '@/locales/packages';
import { usePagedRecords } from '../identity-workspaces';
import { useHydrated } from '../use-hydrated';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, instantField, moneyField, Select, SessionTime } from '../booking/shared';
import { CreditField, creditField, credits, PackageReadState, usePackageRecord } from './shared';
import { PackageProposalReview } from './package-proposals';
import { PackageTerms } from './contract-terms';
import styles from './packages.module.css';
import formStyles from '../auth.module.css';
import { packageCopy as arabicPackageCopy, packageAdminCopy as arabicPackageAdminCopy } from '@/locales/ar-transaction/packages';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';

const textByLanguage = {
  en: { adminCopy, copy },
  ar: { adminCopy: arabicPackageAdminCopy, copy: arabicPackageCopy },
};


export function AdminPackageProposals({ item }: { item: PackageSummary }) {
  return <><ReviewedCoverage item={item} /><ReviewedConversion item={item} /></>;
}

function ReviewedCoverage({ item }: { item: PackageSummary }) {
  const uiLanguage = useSiteLanguage();
  const { adminCopy, copy } = textByLanguage[uiLanguage];

  const hydrated = useHydrated(); const [enrollmentId, setEnrollmentId] = useState(''); const [quantity, setQuantity] = useState<number | null>(null); const [created, setCreated] = useState(''); const [replacementId, setReplacementId] = useState('');
  const enrollments = usePagedRecords<PackageEnrollment>(`package-enrollments?learner_id=${item.learner.learner_id}`);
  const proposals = usePagedRecords<PackageProposalSummary>(`package-proposals?learner_id=${item.learner.learner_id}&state=proposed`);
  const replacement = usePackageRecord<PackageProposal>(replacementId ? `operation-proposals/${replacementId}?view=admin&learner_id=${item.learner.learner_id}` : null);
  const replaced = replacement.data?.kind === 'package_coverage' && replacement.data.terms.package_purchase_id === item.package_purchase_id ? replacement.data : null;
  const selectedId = replaced?.terms.enrollment_id || enrollmentId; const enrollment = enrollments.items?.find(row => row.enrollment_id === selectedId);
  const requested = quantity ?? replaced?.terms.reserved_credit_quanta;
  const options = usePackageRecord<{ enrollment: { version: number }; items: CoverageOption[] }>(selectedId ? `enrollments/${selectedId}/package-options?package_id=${item.package_purchase_id}${requested === undefined ? '' : `&credit_quanta=${requested}`}` : null); const choice = options.data?.items[0];
  function preview(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; setQuantity(creditField(new FormData(event.currentTarget), 'credits')); setCreated(''); }
  return <details className={styles.section}><summary>{adminCopy.reviewCoverage}</summary><PackageReadState pending={enrollments.items === null} {...enrollments} /><Select name="enrollment" label={adminCopy.enrollment} value={selectedId} onChange={value => { setEnrollmentId(value); setQuantity(null); setReplacementId(''); }}><option value="">{adminCopy.chooseEnrollment}</option>{enrollments.items?.filter(row => !row.is_provisional && ['held', 'confirmed'].includes(row.state)).map(row => <option key={row.enrollment_id} value={row.enrollment_id}>{row.title} · {new Date(row.start_at).toLocaleString(uiLanguage === 'ar' ? 'ar-EG' : "en-GB", { timeZone: 'Africa/Cairo' })}</option>)}</Select><PackageReadState pending={proposals.items === null} {...proposals} /><Select name="replace_request" label={adminCopy.replaceRequest} value={replacementId} required={false} onChange={value => { setReplacementId(value); setQuantity(null); }}><option value="">{adminCopy.newProposal}</option>{proposals.items?.filter(row => row.kind === 'package_coverage' && (!selectedId || row.target_id === selectedId)).map(row => <option key={row.proposal_id} value={row.proposal_id}>{row.learner.display_name} · {row.proposal_id.slice(0, 8)}</option>)}</Select>{replacementId && <PackageReadState pending={!replacement.data} {...replacement} />}{selectedId && <PackageReadState pending={!options.data} {...options} />}{enrollment && <p><SessionTime start={enrollment.start_at} end={enrollment.end_at} /></p>}{choice && <div key={`${choice.package_purchase_id}-${choice.version}-${choice.requested_credit_quanta}`}><form className={formStyles.form} aria-label={copy.preview} onSubmit={preview}><fieldset className={formStyles.formFields} disabled={!hydrated}><CreditField name="credits" label={copy.requestedCredits} defaultValue={choice.requested_credit_quanta} max={choice.required_credit_quanta} /><button type="submit" className={formStyles.signout}>{copy.preview}</button></fieldset></form><p>{copy.reasons[choice.reason]}</p><IdentityForm action="operation-proposals" submitLabel={adminCopy.createCoverage} successMessage={copy.reviewSaved} resettable={false} disabled={Boolean(replacementId && !replaced)} onSaved={data => setCreated(String(data.proposal_id))} payload={form => ({ kind: 'package_coverage', target_id: selectedId, expected_version: options.data!.enrollment.version, reason: String(form.get('reason')).trim(), requested_terms: { target_type: 'enrollment', package_purchase_id: item.package_purchase_id, expected_package_version: choice.version, credit_quanta: choice.requested_credit_quanta, remaining_service_price_minor: choice.coverage_rule === 'named_entitlement_covers_eligible_occurrence' && choice.requested_credit_quanta < choice.required_credit_quanta ? moneyField(form, 'remaining_price') : null, expires_at: instantField(form, 'expires_at'), ...(replaced ? { replaces_proposal_id: replaced.proposal_id, expected_replaced_version: replaced.version } : {}) } })}>{choice.coverage_rule === 'named_entitlement_covers_eligible_occurrence' && choice.requested_credit_quanta < choice.required_credit_quanta && <TextField name="remaining_price" label={adminCopy.reviewedPrice} hint={adminCopy.reviewedPriceHint} pattern="[0-9]+(\.[0-9]{1,2})?" />}<CairoInput name="expires_at" label={adminCopy.proposalExpiry} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>{created && <PackageProposalReview id={created} learnerId={item.learner.learner_id} view="admin" />}</div>}</details>;
}

function ReviewedConversion({ item }: { item: PackageSummary }) {
  const uiLanguage = useSiteLanguage();
  const { copy, adminCopy } = textByLanguage[uiLanguage];

  const packages = usePagedRecords<PackageSummary>(`admin/packages?learner_id=${item.learner.learner_id}`); const contracts = usePagedRecords<PackageContract>(`me/package-contracts?learner_id=${item.learner.learner_id}`); const [targetId, setTargetId] = useState(''); const [contractId, setContractId] = useState(''); const [created, setCreated] = useState('');
  const target = packages.items?.find(row => row.package_purchase_id === targetId);
  const selectedContractId = target?.contract_version_id || contractId;
  const selectedContract = usePackageRecord<PackageContract>(selectedContractId ? `package-contracts/${selectedContractId}?learner_id=${item.learner.learner_id}` : null); const contract = selectedContract.data;
  return <details className={styles.section}><summary>{copy.conversion}</summary><p>{copy.conversionDescription}</p><PackageReadState pending={packages.items === null} {...packages} /><Select name="target_package" label={copy.targetPackage} value={targetId} onChange={setTargetId} required={false}><option value="">{adminCopy.newPurchase}</option>{packages.items?.filter(row => row.package_purchase_id !== item.package_purchase_id).map(row => <option key={row.package_purchase_id} value={row.package_purchase_id}>{row.title} · {row.package_purchase_id.slice(0, 8)}</option>)}</Select><PackageReadState pending={contracts.items === null} {...contracts} />{!target && <Select name="new_contract" label={copy.renewalTarget} value={contractId} onChange={setContractId}><option value="">{copy.chooseContract}</option>{contracts.items?.map(row => <option key={row.contract_version_id} value={row.contract_version_id}>{row.title} · {row.contract.base_duration_minutes} {transactionLabel(uiLanguage, "min ·")} {row.contract_version_id.slice(0, 8)}</option>)}</Select>}{selectedContractId && <PackageReadState pending={!contract} {...selectedContract} />}{contract && <PackageTerms contract={contract.contract} offers={contract.eligible_offers} />}{contract && <IdentityForm key={`${targetId}-${contract.contract_version_id}`} action="operation-proposals" submitLabel={copy.createConversion} successMessage={copy.conversionCreated} resettable={false} onSaved={result => setCreated(String(result.proposal_id))} payload={form => ({ kind: 'package_conversion', target_id: item.package_purchase_id, expected_version: item.version, reason: String(form.get('reason')).trim(), requested_terms: { target_type: 'package_purchase', target_package_id: target?.package_purchase_id || null, new_contract_version_id: contract.contract_version_id, expected_target_version: target?.version || null, source_credit_quanta: creditField(form, 'source_credits'), target_credit_quanta: creditField(form, 'target_credits'), expires_at: instantField(form, 'expires_at') } })}><p>{copy.available}: {credits(item.usable_available_credit_quanta, uiLanguage)}</p><p>{copy.creditBasis(contract.contract.base_duration_minutes)}</p><CreditField name="source_credits" label={copy.transferQuantity} max={item.usable_available_credit_quanta} allowZero={!target} /><CreditField name="target_credits" label={copy.convertedCredits} allowZero={!target} /><CairoInput name="expires_at" label={adminCopy.proposalExpiry} /><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}{created && <PackageProposalReview id={created} learnerId={item.learner.learner_id} view="admin" />}</details>;
}
