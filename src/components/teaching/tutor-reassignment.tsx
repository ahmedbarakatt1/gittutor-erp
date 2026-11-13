'use client';

import { useEffect, useState } from 'react';
import type { TutorReassignment, ReassignmentTutorTerms } from '@/modules/teaching/operations';
import type { AdminOccurrence } from '@/modules/booking/queries';
import type { AdminOffer, AdminTutor } from '@/modules/catalog/queries';
import { reassignmentCopy as copy } from '@/locales/tutor-reassignment';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, CairoTimestamp, Check, instantField, money, Select, SessionTime } from '../booking/shared';
import { AmountField, amountField, PaymentReadState, usePaymentClock, usePaymentList } from '../payments/shared';
import styles from '../files/files.module.css';

export function TutorReassignments({ occurrenceId, learnerId, view, revision = 0, onSaved }: { occurrenceId?: string; learnerId?: string; view: 'tutor' | 'admin'; revision?: number; onSaved?: () => void }) {
  const path = `tutor-reassignments?view=${view}${occurrenceId ? `&occurrence_id=${occurrenceId}` : ''}${learnerId ? `&learner_id=${learnerId}` : ''}`;
  return <ReassignmentRecords key={`${path}-${revision}`} path={path} view={view} onSaved={onSaved} />;
}
function ReassignmentRecords({ path, view, onSaved }: { path: string; view: 'tutor' | 'admin'; onSaved?: () => void }) {
  const records = usePaymentList<TutorReassignment>(path), now = usePaymentClock();
  return <section className={styles.section}><h2>{copy.title}</h2><PaymentReadState pending={!records.items} {...records} />{records.items?.length === 0 && <p>{copy.noChanges}</p>}{records.items?.filter(item => item.view === view).map(item => <details className={styles.section} key={`${item.proposal_id}-${item.version}`} data-reassignment-id={item.proposal_id}><summary>{item.old_tutor.display_name} → {item.new_tutor.display_name} · {copy.state[item.state]}</summary><SessionTime start={item.start_at} end={item.end_at} /><p>{copy.from}: {item.old_tutor.display_name}</p><p>{copy.to}: {item.new_tutor.display_name}</p>{['proposed', 'accepted', 'approved'].includes(item.state) && <p>{copy.intro}</p>}<p>{copy.expires}: <CairoTimestamp value={item.expires_at} /></p>{item.required_actions.map(action => <p className={styles.notice} key={action}>{copy.actions[action]}</p>)}
    {item.view === 'tutor' && <TeachingTerms terms={item.terms} />}
    {item.view === 'admin' && <><h3>{copy.previous}</h3><TeachingTerms terms={item.terms.previous_tutor} /><h3>{copy.replacementRole}</h3><TeachingTerms terms={item.terms.replacement_tutor} /><h3>{copy.pending}</h3><ul>{item.required_acceptances.map(row => <li key={`${row.kind}-${row.participant_id}`}>{row.kind === 'learner' ? copy.learner : row.kind === 'previous_tutor' ? item.old_tutor.display_name : item.new_tutor.display_name}: {row.current && row.accepted_at ? copy.current : copy.missing}</li>)}</ul></>}
    {item.can_accept && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/accept`} submitLabel={copy.accept} successMessage={copy.accepted} resettable={false} disabled={!now || now >= Date.parse(item.expires_at)} onSaved={() => { records.reload(); onSaved?.(); }} payload={() => ({ terms_hash: item.terms_hash, expected_version: item.version })}><Check name="consent" label={copy.consent} /></IdentityForm>}
    {item.view === 'admin' && item.can_approve && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/approve`} submitLabel={copy.approve} successMessage={copy.approved} resettable={false} onSaved={records.reload} payload={() => ({ terms_hash: item.terms_hash, expected_version: item.version })}><Check name="reviewed" label={copy.confirmAdmin} /></IdentityForm>}
    {item.view === 'admin' && item.can_commit && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/commit`} submitLabel={copy.commit} successMessage={copy.committed} resettable={false} onSaved={() => { records.reload(); onSaved?.(); }} payload={() => ({ expected_version: item.version })}><p>{copy.confirmAdmin}</p></IdentityForm>}
    {item.can_decline && <IdentityForm action={`tutor-reassignments/${item.proposal_id}/decline`} submitLabel={copy.decline} successMessage={copy.declined} resettable={false} onSaved={records.reload} payload={form => ({ reason: String(form.get('reason')).trim(), expected_version: item.version })}><TextField name="reason" label={copy.reason} maxLength={2000} /></IdentityForm>}
  </details>)}</section>;
}
function TeachingTerms({ terms }: { terms: ReassignmentTutorTerms }) { return <aside className={styles.notice}><p>{copy.private}</p><p>{terms.amount_kind === 'teaching_fee' ? copy.teachingFee : copy.releaseFee}: <strong>{money(terms.amount_minor, terms.currency)}</strong></p></aside>; }

export function ProposeTutorReassignment({ item, onSaved }: { item: AdminOccurrence; onSaved: () => void }) {
  const offers = usePaymentList<AdminOffer>('offers'), offer = offers.items?.find(row => row.offer_id === item.occurrence.offer_id);
  useEffect(() => { if (offers.items && !offer && offers.cursor && !offers.loadingMore && !offers.error) void offers.loadMore(); }, [offers, offer]);
  const tutors = usePaymentList<AdminTutor>(offer ? `tutors?active=true&subject_id=${offer.subject.subject_id}` : null), [selected, setSelected] = useState('');
  if (!['forming', 'confirmed'].includes(item.occurrence.state)) return null;
  return <details className={styles.section}><summary>{copy.propose}</summary><PaymentReadState pending={!offer} {...offers} />{offer && <IdentityForm action={`occurrences/${item.occurrence.occurrence_id}/tutor-reassignments`} submitLabel={copy.propose} successMessage={copy.proposed} resettable={false} disabled={!selected || !item.fee_agreement} onSaved={onSaved} payload={form => ({ new_tutor_id: selected, new_fee_minor: amountField(form, 'new_fee', { allowZero: true }), old_tutor_compensation_minor: amountField(form, 'old_fee', { allowZero: true }), expires_at: instantField(form, 'expires_at'), reason: String(form.get('reason')).trim(), expected_version: item.occurrence.version })}><p>{copy.private}</p><Select name="new_tutor" label={copy.replacement} value={selected} onChange={setSelected}><option value="">{copy.choose}</option>{tutors.items?.filter(tutor => tutor.tutor_id !== item.occurrence.tutor.tutor_id && tutor.approved_profile_version_id).map(tutor => <option key={tutor.tutor_id} value={tutor.tutor_id}>{tutor.display_name}</option>)}</Select><PaymentReadState pending={!tutors.items} {...tutors} /><AmountField name="new_fee" label={copy.newFee} value={item.fee_agreement?.fee_minor} allowZero /><AmountField name="old_fee" label={copy.oldFee} allowZero /><CairoInput name="expires_at" label={copy.expires} /><TextField name="reason" label={copy.reason} multiline maxLength={2000} /></IdentityForm>}</details>;
}
