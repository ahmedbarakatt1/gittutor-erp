'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PackageContract, PackageDetail, PackageSummary, PackageProposalSummary } from '@/modules/packages/queries';
import type { PackageProposal } from '@/modules/packages/proposal-contract';
import { packageCopy as copy } from '@/locales/packages';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { Check, Select, money } from '../booking/shared';
import { PackageTerms } from './contract-terms';
import { PackageReadState, CreditField, creditField, credits, usePackageRecord } from './shared';
import styles from './packages.module.css';
import { packageCopy as arabicPackageCopy } from '@/locales/ar-transaction/packages';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';

const textByLanguage = {
  en: { copy },
  ar: { copy: arabicPackageCopy },
};


function ConversionChoice({ packageId, learnerId, selected, onChange }: { packageId: string; learnerId: string; selected: string; onChange: (value: string) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePagedRecords<PackageProposalSummary>(`package-proposals?learner_id=${learnerId}&state=approved`);
  return <section className={styles.section}><Select name="conversion_proposal_id" label={copy.approvedConversion} value={selected} onChange={onChange} required={false}><option value="">{copy.noConversion}</option>{records.items?.filter(row => row.kind === 'package_conversion' && row.target_id === packageId).map(row => <option key={row.proposal_id} value={row.proposal_id}>{copy.conversion} · {row.proposal_id.slice(0, 8)}</option>)}</Select><PackageReadState pending={records.items === null} {...records} /></section>;
}

export function PackageRenewal({ item }: { item: PackageSummary }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const contracts = usePagedRecords<PackageContract>(`me/package-contracts?learner_id=${item.learner.learner_id}`); const [selected, setSelected] = useState(''); const [created, setCreated] = useState(''); const [proposalId, setProposalId] = useState('');
  const proposal = usePackageRecord<PackageProposal>(proposalId ? `operation-proposals/${proposalId}?view=customer&learner_id=${item.learner.learner_id}` : null);
  const conversion = proposal.data?.kind === 'package_conversion' && proposal.data.terms.target_package_id === null ? proposal.data.terms : null;
  const contractId = conversion?.new_contract_version_id || selected;
  const exact = usePackageRecord<PackageContract>(contractId ? `package-contracts/${contractId}?learner_id=${item.learner.learner_id}` : null); const choice = exact.data;
  const choices = [...(contracts.items || []), ...(choice && !contracts.items?.some(row => row.contract_version_id === choice.contract_version_id) ? [choice] : [])];
  return <details className={styles.section}><summary>{copy.renew}</summary><p>{copy.renewDescription}</p><PackageReadState pending={contracts.items === null} {...contracts} /><ConversionChoice packageId={item.package_purchase_id} learnerId={item.learner.learner_id} selected={proposalId} onChange={setProposalId} />{proposalId && <PackageReadState pending={!proposal.data} {...proposal} />}<Select name="new_contract" label={copy.renewalTarget} value={choice?.contract_version_id || selected} onChange={setSelected}><option value="">{copy.chooseContract}</option>{choices.map(row => <option key={row.contract_version_id} value={row.contract_version_id}>{row.title} · {row.contract.base_duration_minutes} {transactionLabel(uiLanguage, "min ·")} {credits(row.contract.grant_credit_quanta, uiLanguage)} · {money(row.contract.purchase_value_minor, 'EGP', uiLanguage)} · {row.contract_version_id.slice(0, 8)}</option>)}</Select>{contractId && <PackageReadState pending={!choice} {...exact} />}{choice && <div key={`${choice.contract_version_id}-${proposalId}`}><PackageTerms contract={choice.contract} offers={choice.eligible_offers} environment={choice.environment_label} /><IdentityForm action={`packages/${item.package_purchase_id}/renew`} submitLabel={copy.renewSubmit} successMessage={copy.renewed} resettable={false} disabled={Boolean(proposalId && !conversion)} onSaved={result => setCreated(String(result.successor_package_id))} payload={form => ({ new_contract_version_id: choice.contract_version_id, transfer_credit_quanta: conversion?.source_credit_quanta ?? creditField(form, 'carryover'), accepted_terms_hash: choice.terms_hash, conversion_proposal_id: conversion ? proposalId : null, expected_version: item.version })}>{conversion ? <p>{copy.carryCredits}: <bdi dir="ltr">{credits(conversion.source_credit_quanta, uiLanguage)} → {credits(conversion.target_credit_quanta, uiLanguage)}</bdi></p> : <CreditField name="carryover" label={copy.carryCredits} defaultValue={0} max={item.usable_available_credit_quanta} allowZero />}<Check name="renewal_consent" label={copy.renewConsent} /></IdentityForm>{created && <p><Link className={styles.link} href={`/learn/packages/${created}`}>{copy.open}</Link></p>}</div>}</details>;
}

export function PackageTransferForm({ item, onSaved }: { item: PackageSummary; onSaved?: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const records = usePagedRecords<PackageSummary>(`me/packages?learner_id=${item.learner.learner_id}`); const [selected, setSelected] = useState(''); const [proposalId, setProposalId] = useState('');
  const proposal = usePackageRecord<PackageProposal>(proposalId ? `operation-proposals/${proposalId}?view=customer&learner_id=${item.learner.learner_id}` : null);
  const conversion = proposal.data?.kind === 'package_conversion' && proposal.data.terms.target_package_id ? proposal.data.terms : null;
  const targetId = conversion?.target_package_id || selected;
  const exact = usePackageRecord<PackageDetail>(targetId ? `packages/${targetId}` : null); const target = exact.data?.package;
  const choices = [...(records.items || []), ...(target && !records.items?.some(row => row.package_purchase_id === target.package_purchase_id) ? [target] : [])];
  return <details className={styles.section}><summary>{copy.transfer}</summary><p>{copy.transferDescription}</p><PackageReadState pending={records.items === null} {...records} /><ConversionChoice packageId={item.package_purchase_id} learnerId={item.learner.learner_id} selected={proposalId} onChange={setProposalId} />{proposalId && <PackageReadState pending={!proposal.data} {...proposal} />}<Select name="target_package" label={copy.targetPackage} value={target?.package_purchase_id || selected} onChange={setSelected}><option value="">{copy.chooseTarget}</option>{choices.filter(row => row.package_purchase_id !== item.package_purchase_id && row.purchase_state !== 'cancelled').map(row => <option key={row.package_purchase_id} value={row.package_purchase_id}>{row.title} · {row.package_purchase_id.slice(0, 8)}</option>)}</Select>{targetId && <PackageReadState pending={!target} {...exact} />}{target && <IdentityForm key={`${target.package_purchase_id}-${target.version}-${proposalId}`} action={`packages/${item.package_purchase_id}/transfers`} submitLabel={copy.transferSubmit} successMessage={copy.transferredSaved} resettable={false} disabled={Boolean(proposalId && !conversion)} onSaved={onSaved} payload={form => ({ target_package_id: target.package_purchase_id, credit_quanta: conversion?.source_credit_quanta ?? creditField(form, 'credits'), conversion_proposal_id: conversion ? proposalId : null, reason: String(form.get('reason')).trim(), expected_version: item.version, expected_target_version: target.version })}>{conversion ? <p>{copy.transferQuantity}: <bdi dir="ltr">{credits(conversion.source_credit_quanta, uiLanguage)} → {credits(conversion.target_credit_quanta, uiLanguage)}</bdi></p> : <CreditField name="credits" label={copy.credits} max={item.usable_available_credit_quanta} />}<TextField name="reason" label={copy.reason} maxLength={2000} /><Check name="transfer_consent" label={copy.consent} /></IdentityForm>}</details>;
}
