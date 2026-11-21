'use client';

import { useEffect, useState } from 'react';
import type { AdminOccurrence, FeeAgreement, Quote } from '@/modules/booking/queries';
import type { AdminPolicy } from '@/modules/catalog/queries';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { bookingCopy } from '@/locales/booking';
import { groupChangeCopy } from '@/locales/group-changes';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { StaffProposal } from './staff-proposals';
import { CairoInput, ReadState, Select, instantField, money, useBookingRecord } from './shared';
import { CreditField, creditField, credits } from '../packages/shared';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';
import { bookingStaffCopy as arabicBookingStaffCopy } from '@/locales/ar-transaction/booking-staff';
import { bookingCopy as arabicBookingCopy } from '@/locales/ar-transaction/booking';
import { groupChangeCopy as arabicGroupChangeCopy } from '@/locales/ar-transaction/group-changes';
import { useSiteLanguage } from '@/components/site-language';
import { transactionLabel } from '@/locales/ar-transaction/labels';

const textByLanguage = {
  en: { copy, groupChangeCopy, bookingCopy },
  ar: { copy: arabicBookingStaffCopy, groupChangeCopy: arabicGroupChangeCopy, bookingCopy: arabicBookingCopy },
};

type Learner = { learner_id: string; display_name: string };
export function GroupAmendmentForm({ item, policies, agreements, onSaved }: { item: AdminOccurrence; policies: ReturnType<typeof usePagedRecords<AdminPolicy>>; agreements: FeeAgreement[]; onSaved: () => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy, groupChangeCopy, bookingCopy } = textByLanguage[uiLanguage];

  const occurrence = item.occurrence; const [target, setTarget] = useState(String(occurrence.target_tier)); const [policyId, setPolicyId] = useState(''); const [feeId, setFeeId] = useState('');
  const [added, setAdded] = useState<Learner[]>([]); const [removed, setRemoved] = useState<string[]>([]); const [created, setCreated] = useState('');
  const [removedRemedy, setRemovedRemedy] = useState('policy_default');
  const duration = (Date.parse(occurrence.end_at) - Date.parse(occurrence.start_at)) / 60_000;
  const activeRoster = item.roster.filter(row => ['held', 'confirmed'].includes(row.state));
  const currentQuote = useBookingRecord<Quote>(activeRoster[0] ? `quotes/${activeRoster[0].quote_id}` : null);
  const retainCurrent = occurrence.state === 'confirmed' && currentQuote.data?.customer_policy.post_confirmation_dropout_price_guarantee === true && removed.length > 0 && added.length === 0 && Number(target) === activeRoster.length - removed.length;
  const retainedAgreement = retainCurrent && item.fee_agreement?.is_current ? item.fee_agreement : null;
  const reservedRemovals = activeRoster.filter(row => removed.includes(row.enrollment_id) && (row.funding.reserved_credit_quanta ?? 0) > 0);
  const policy = policies.items?.find(row => row.policy_version_id === policyId);
  const eligibleAgreements = [...agreements.filter(row => row.purpose === 'amendment' && row.target_tier === Number(target)), ...(retainedAgreement ? [retainedAgreement] : [])];
  const compatiblePolicies = policies.items?.filter(row => ['approved', 'published'].includes(row.status) && row.scope === 'group' && row.content.duration_minutes === duration && row.content.group_target_size === Number(target) && eligibleAgreements.some(fee => fee.compensation_policy_version_id === row.content.compensation_policy_version)) || [];
  useEffect(() => { if (eligibleAgreements.length && policies.items && !compatiblePolicies.length && policies.cursor && !policies.failed && !policies.loadingMore) void policies.loadMore(); }, [policies, compatiblePolicies.length, eligibleAgreements.length]);
  return <details className={styles.section}><summary>{copy.groupChange}</summary><p>{copy.groupChangeDescription}</p><ReadState pending={policies.items === null} {...policies} />
    <IdentityForm key={`${occurrence.occurrence_id}-${occurrence.version}`} action={`occurrences/${occurrence.occurrence_id}/amendments`} submitLabel={copy.createAmendment} successMessage={copy.amendmentSaved} resettable={false} onSaved={result => { setCreated(String(result.amendment_id)); onSaved(); }} payload={form => {
      if (!policy || !eligibleAgreements.some(row => row.fee_agreement_id === feeId && row.compensation_policy_version_id === policy.content.compensation_policy_version)) throw new Error('CHOOSE_APPROVED_RECORDS');
      const package_dispositions = reservedRemovals.map(row => {
        const released_credit_quanta = creditField(form, `return_${row.enrollment_id}`);
        const extinguished_credit_quanta = row.funding.reserved_credit_quanta! - released_credit_quanta;
        if (extinguished_credit_quanta < 0) throw new Error('INVALID_CREDIT_QUANTITY');
        return { enrollment_id: row.enrollment_id, released_credit_quanta, extinguished_credit_quanta };
      });
      return { add_learner_ids: added.map(learner => learner.learner_id), remove_enrollment_ids: removed, target_tier: Number(target), fee_agreement_id: feeId, replacement_policy_version_id: policyId, ...(removed.length ? { removed_remedy: removedRemedy } : {}), ...(package_dispositions.length ? { package_dispositions } : {}), expires_at: instantField(form, 'expires_at'), reason: String(form.get('reason')).trim(), expected_version: occurrence.version };
    }}>
      <Select name="target_tier" label={copy.target} value={target} onChange={value => { setTarget(value); setPolicyId(''); setFeeId(''); }}>{[2, 3, 4].filter(size => size <= occurrence.capacity).map(size => <option key={size} value={size}>{size}</option>)}</Select><Select name="replacement_policy" label={copy.replacementPolicy} value={policyId} onChange={value => { setPolicyId(value); setFeeId(''); }}><option value="">{copy.choosePolicy}</option>{compatiblePolicies.map(row => <option key={row.policy_version_id} value={row.policy_version_id}>{String(row.content.group_target_size)} · {duration} {transactionLabel(uiLanguage, "min ·")} {row.policy_version_id.slice(0, 8)}</option>)}</Select><Select name="fee_agreement" label={copy.feeAgreement} value={feeId} onChange={setFeeId}><option value="">{copy.chooseAgreement}</option>{eligibleAgreements.filter(row => policy && row.compensation_policy_version_id === policy.content.compensation_policy_version).map(row => <option key={row.fee_agreement_id} value={row.fee_agreement_id}>{row.fee_agreement_id === retainedAgreement?.fee_agreement_id ? `${groupChangeCopy.keepCurrentAgreement} · ` : ''}{money(row.fee_minor, 'EGP', uiLanguage)} · {row.fee_agreement_id.slice(0, 8)}</option>)}</Select>{retainedAgreement && <p className={styles.notice}>{groupChangeCopy.guaranteeNotice}</p>}
      <fieldset className={styles.group}><legend>{copy.addLearners}</legend><LearnerSearch selected={added} excluded={activeRoster.map(row => row.learner_id)} onChange={values => { setAdded(values); setFeeId(''); }} /></fieldset>
      <fieldset className={styles.group}><legend>{copy.removeLearners}</legend>{activeRoster.map(row => <label key={row.enrollment_id} className={styles.choice}><input type="checkbox" checked={removed.includes(row.enrollment_id)} onChange={event => { setRemoved(values => event.target.checked ? [...values, row.enrollment_id] : values.filter(value => value !== row.enrollment_id)); setFeeId(''); }} />{row.display_name}</label>)}</fieldset>
      {removed.length > 0 && <Select name="removed_remedy" label={groupChangeCopy.removedRemedy} value={removedRemedy} onChange={setRemovedRemedy}>{Object.entries(bookingCopy.remedies).filter(([value]) => value !== 'none').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}
      {reservedRemovals.length > 0 && <fieldset className={styles.group}><legend>{groupChangeCopy.packageDisposition}</legend><p>{groupChangeCopy.packageDescription}</p>{reservedRemovals.map(row => <div key={row.enrollment_id}><h4>{row.display_name}</h4><p>{groupChangeCopy.currentlyReserved}: {credits(row.funding.reserved_credit_quanta!, uiLanguage)}</p><CreditField name={`return_${row.enrollment_id}`} label={`${groupChangeCopy.creditsToReturn} · ${row.display_name}`} max={row.funding.reserved_credit_quanta!} allowZero /></div>)}</fieldset>}
      <CairoInput name="expires_at" label={copy.expiry} /><TextField name="reason" label={bookingCopy.reason} maxLength={2000} />
    </IdentityForm>{created && <StaffProposal id={created} kind="amendment" view="admin" names={Object.fromEntries([...item.roster.map(row => [row.learner_id, row.display_name]), ...added.map(row => [row.learner_id, row.display_name])])} />}
  </details>;
}

function LearnerSearch({ selected, excluded, onChange }: { selected: Learner[]; excluded: string[]; onChange: (values: Learner[]) => void }) {
  const uiLanguage = useSiteLanguage();
  const { copy } = textByLanguage[uiLanguage];

  const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  return <><div className={styles.tools}><label className={formStyles.field}>{copy.search}<input type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={120} /></label><button type="button" className={formStyles.signout} onClick={() => setSearch(query.trim())}>{copy.searchAction}</button></div>{selected.length > 0 && <><h4>{copy.selectedLearners}</h4><ul className={styles.list}>{selected.map(learner => <li key={learner.learner_id}><span>{learner.display_name}</span> <button type="button" className={formStyles.signout} onClick={() => onChange(selected.filter(item => item.learner_id !== learner.learner_id))}>{copy.remove}</button></li>)}</ul></>}<LearnerResults key={search} query={search} selected={selected} excluded={excluded} onChange={onChange} /></>;
}
function LearnerResults({ query, selected, excluded, onChange }: { query: string; selected: Learner[]; excluded: string[]; onChange: (values: Learner[]) => void }) {
  const records = usePagedRecords<Learner>(`booking/learners${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  return <><ReadState pending={records.items === null} {...records} /><ul className={styles.list}>{records.items?.filter(row => !excluded.includes(row.learner_id)).map(row => <li key={row.learner_id}><label className={styles.choice}><input type="checkbox" checked={selected.some(item => item.learner_id === row.learner_id)} onChange={event => onChange(event.target.checked ? [...selected, row] : selected.filter(item => item.learner_id !== row.learner_id))} />{row.display_name}</label></li>)}</ul></>;
}
