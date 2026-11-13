'use client';

import Link from 'next/link';
import layoutStyles from '../auth.module.css';
import { useEffect, useState } from 'react';
import type { PackageContract, PackageSummary, PackageProposalSummary } from '@/modules/packages/queries';
import { packageCopy as copy } from '@/locales/packages';
import { IdentityForm } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { Check, Select, CairoTimestamp, money } from '../booking/shared';
import { PackageTerms } from './contract-terms';
import { PackageReadState, credits, usePackageRecord } from './shared';
import { PackageProposalReview } from './package-proposals';
import styles from './packages.module.css';

export type PackageLearner = { learner_id: string; display_name: string };

export function CustomerPackages({ initialLearner, initialContract }: { initialLearner?: string; initialContract?: string }) {
  const records = usePagedRecords<PackageLearner>('me/package-learners'); const [selected, setSelected] = useState(initialLearner || '');
  const learner = records.items?.find(row => row.learner_id === selected) || (records.items?.length === 1 ? records.items[0] : undefined);
  useEffect(() => { if (selected && records.items && !records.items.some(row => row.learner_id === selected) && records.cursor && !records.failed && !records.loadingMore) void records.loadMore(); }, [selected, records]);
  return <><section className={styles.section}><Select name="learner_id" label={copy.learner} value={learner?.learner_id || ''} onChange={setSelected}><option value="">{copy.chooseLearner}</option>{records.items?.map(row => <option key={row.learner_id} value={row.learner_id}>{row.display_name}</option>)}</Select><PackageReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p>{copy.noLearners}</p>}</section>{learner && <LearnerPackages key={learner.learner_id} learner={learner} initialContract={initialContract} />}</>;
}

function LearnerPackages({ learner, initialContract }: { learner: PackageLearner; initialContract?: string }) {
  const purchases = usePagedRecords<PackageSummary>(`me/packages?learner_id=${learner.learner_id}`);
  return <><section className={styles.section} aria-labelledby="purchases-heading"><h2 id="purchases-heading">{learner.display_name}</h2><PackageReadState pending={purchases.items === null} {...purchases} />{purchases.items?.length === 0 && <p className={styles.empty}>{copy.empty}</p>}<ul className={`${styles.list} ${layoutStyles.recordGrid}`}>{purchases.items?.map(item => <li key={item.package_purchase_id}><h3>{item.title}</h3><p>{copy.states[item.purchase_state]}</p><dl className={styles.facts}><div><dt>{copy.available}</dt><dd><bdi dir="auto">{credits(item.usable_available_credit_quanta)}</bdi></dd></div><div><dt>{copy.purchasedCredits}</dt><dd><bdi dir="auto">{credits(item.purchased_credit_quanta)}</bdi></dd></div><div><dt>{copy.created}</dt><dd><bdi dir="auto"><CairoTimestamp value={item.created_at} /></bdi></dd></div></dl><Link className={styles.link} href={`/learn/packages/${item.package_purchase_id}`}>{copy.open}</Link></li>)}</ul></section><PurchasePackage learner={learner} initialContract={initialContract} onSaved={purchases.reload} /><LearnerPackageProposals learnerId={learner.learner_id} /></>;
}

export function PurchasePackage({ learner, initialContract, onSaved }: { learner: PackageLearner; initialContract?: string; onSaved?: () => void }) {
  const records = usePagedRecords<PackageContract>(`me/package-contracts?learner_id=${learner.learner_id}`); const [selected, setSelected] = useState(initialContract || ''); const [created, setCreated] = useState('');
  const exact = usePackageRecord<PackageContract>(selected ? `package-contracts/${selected}?learner_id=${learner.learner_id}` : null);
  const choices = records.items ? [...records.items, ...(exact.data && !records.items.some(row => row.contract_version_id === exact.data!.contract_version_id) ? [exact.data] : [])] : [];
  const choice = exact.data;
  return <section className={styles.section} aria-label={copy.contracts}><h2>{copy.contracts}</h2><PackageReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p>{copy.noContracts}</p>}<Select name="contract_version_id" label={copy.chooseContract} value={selected} onChange={value => { setSelected(value); setCreated(''); }}><option value="">{copy.chooseContract}</option>{choices.map(row => <option key={row.contract_version_id} value={row.contract_version_id}>{row.title} · {credits(row.contract.grant_credit_quanta)} · {money(row.contract.purchase_value_minor)} · {row.contract_version_id.slice(0, 8)}</option>)}</Select>{selected && <PackageReadState pending={!exact.data} {...exact} />}{choice && <div key={choice.contract_version_id}><PackageTerms contract={choice.contract} offers={choice.eligible_offers} environment={choice.environment_label} /><IdentityForm action="packages" submitLabel={copy.buy} successMessage={copy.bought} resettable={false} payload={() => ({ learner_id: learner.learner_id, package_contract_version_id: choice.contract_version_id, accepted_terms_hash: choice.terms_hash })} onSaved={result => { setCreated(String(result.package_purchase_id)); onSaved?.(); }}><Check name="package_consent" label={copy.buyConsent} /></IdentityForm>{created && <p><Link className={styles.link} href={`/learn/packages/${created}`}>{copy.open}</Link></p>}</div>}</section>;
}

export function LearnerPackageProposals({ learnerId, admin = false }: { learnerId: string; admin?: boolean }) {
  const records = usePagedRecords<PackageProposalSummary>(`package-proposals?learner_id=${learnerId}`);
  return <section className={styles.section}><h2>{copy.proposals}</h2><PackageReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p>{copy.noProposals}</p>}{records.items?.map(item => <PackageProposalReview key={item.proposal_id} id={item.proposal_id} learnerId={learnerId} view={admin ? 'admin' : 'customer'} />)}</section>;
}
