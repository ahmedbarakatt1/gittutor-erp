'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StaffSessionMaterials } from '../files/materials';
import { MeetingPanel } from '../teaching/meeting-panel';
import { DeliveryPanel } from '../teaching/delivery-panel';
import { ProposeTutorReassignment, TutorReassignments } from '../teaching/tutor-reassignment';
import type { AdminOccurrence, FeeAgreement } from '@/modules/booking/queries';
import type { AdminOffer, AdminPolicy, AdminPricing, AdminTutor } from '@/modules/catalog/queries';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { scaledIntegerInput } from '@/modules/shared/format';
import { bookingCopy } from '@/locales/booking';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { AvailabilityEditor } from './availability-editor';
import { CreateOperationProposal, StaffProposal } from './staff-proposals';
import { GroupAmendmentForm } from './group-amendment';
import { CairoInput, ReadState, Select, SessionTime, cairoTime, instantField, money, moneyField } from './shared';
import styles from './booking.module.css';
import { AdminConfirmation } from '../payments/booking-funding';
import formStyles from '../auth.module.css';

type Records<T> = ReturnType<typeof usePagedRecords<T>>;
export function AdminSchedule({ initialOccurrence }: { initialOccurrence?: string }) {
  const offers = usePagedRecords<AdminOffer>('offers?status=published'); const tutors = usePagedRecords<AdminTutor>('tutors?active=true');
  const pricing = usePagedRecords<AdminPricing>('pricing-versions'); const policies = usePagedRecords<AdminPolicy>('policies');
  const sessions = usePagedRecords<AdminOccurrence>(initialOccurrence ? `occurrences?occurrence_id=${initialOccurrence}` : 'occurrences'); const [selected, setSelected] = useState(initialOccurrence || ''); const [availabilityTutor, setAvailabilityTutor] = useState('');
  const current = sessions.items?.find(item => item.occurrence.occurrence_id === selected);
  return <>{initialOccurrence && <Link className={styles.link} href="/admin/schedule">{copy.allSessions}</Link>}<section className={styles.section} id="schedule-create"><h2>{copy.create}</h2><section aria-label={copy.offer}><ReadState pending={offers.items === null} {...offers} /></section><section aria-label={copy.tutor}><ReadState pending={tutors.items === null} {...tutors} /></section><CreateSession offers={offers.items || []} tutors={tutors.items || []} onSaved={result => { setSelected(String(result.occurrence_id)); sessions.reload(); }} /></section>
    <section className={styles.section} id="sessions"><h2>{copy.schedule}</h2><ReadState pending={sessions.items === null} {...sessions} /><div className={styles.columns}><ul className={styles.recordList}>{sessions.items?.map(item => <li key={item.occurrence.occurrence_id}><button type="button" aria-pressed={selected === item.occurrence.occurrence_id} onClick={() => setSelected(item.occurrence.occurrence_id)}><SessionTime start={item.occurrence.start_at} end={item.occurrence.end_at} /><span>{item.occurrence.tutor.display_name} · {bookingCopy.states[item.occurrence.state] || item.occurrence.state}</span><span>{item.occurrence.format === 'group' ? bookingCopy.group : bookingCopy.private} · {item.roster.length} {copy.roster.toLowerCase()}</span><span className={styles.reference}>{item.occurrence.occurrence_id.slice(0, 8)}</span></button></li>)}</ul><div>{current ? <SessionOperations key={`${current.occurrence.occurrence_id}-${current.occurrence.version}`} item={current} pricing={pricing} policies={policies} onSaved={sessions.reload} /> : <p>{sessions.items?.length === 0 ? copy.empty : copy.chooseSession}</p>}</div></div></section>
    <section className={styles.section}><h2>{copy.availability}</h2><Select name="availability_tutor" label={copy.tutor} value={availabilityTutor} onChange={setAvailabilityTutor}><option value="">{copy.chooseTutor}</option>{tutors.items?.map(item => <option key={item.tutor_id} value={item.tutor_id}>{item.display_name}</option>)}</Select>{availabilityTutor && <AvailabilityEditor key={availabilityTutor} tutorId={availabilityTutor} />}</section>
  </>;
}

function CreateSession({ offers, tutors, onSaved }: { offers: AdminOffer[]; tutors: AdminTutor[]; onSaved: (result: Record<string, unknown>) => void }) {
  const [offerId, setOfferId] = useState(''); const [tutorId, setTutorId] = useState(''); const [start, setStart] = useState('');
  const offer = offers.find(item => item.offer_id === offerId);
  return <IdentityForm action="occurrences" submitLabel={copy.create} successMessage={copy.scheduled} onSaved={onSaved} payload={form => {
    if (!offer || !tutorId) throw new Error('CHOOSE_APPROVED_RECORDS'); const start_at = instantField(form, 'start_at');
    return { offer_id: offer.offer_id, tutor_id: tutorId, start_at, end_at: new Date(Date.parse(start_at) + offer.duration_minutes * 60_000).toISOString(), time_zone: 'Africa/Cairo', target_tier: offer.target_tier };
  }}><Select name="offer_id" label={copy.offer} value={offerId} onChange={value => { setOfferId(value); setTutorId(''); }}><option value="">{copy.chooseOffer}</option>{offers.map(item => <option key={item.offer_id} value={item.offer_id}>{item.title} · {item.duration_minutes} min · {item.offer_id.slice(0, 8)}</option>)}</Select><Select name="tutor_id" label={copy.tutor} value={tutorId} onChange={setTutorId}><option value="">{copy.chooseTutor}</option>{tutors.filter(item => offer && item.approved_profile_version_id && item.approved_subject_ids.includes(offer.subject.subject_id)).map(item => <option key={item.tutor_id} value={item.tutor_id}>{item.display_name}</option>)}</Select><CairoInput name="start_at" label={copy.startAt} onChange={setStart} />{offer && <p>{copy.duration}: {offer.duration_minutes} min. {copy.durationNote}{start && <> {copy.endAt}: {cairoTime(new Date(Date.parse(start) + offer.duration_minutes * 60_000).toISOString())} {bookingCopy.timezone}.</>}</p>}</IdentityForm>;
}

function SessionOperations({ item, pricing, policies, onSaved }: { item: AdminOccurrence; pricing: Records<AdminPricing>; policies: Records<AdminPolicy>; onSaved: () => void }) {
  const [reassignmentRevision, setReassignmentRevision] = useState(0);
  const occurrence = item.occurrence; const fees = usePagedRecords<FeeAgreement>(`occurrences/${occurrence.occurrence_id}/fee-agreements`);
  useEffect(() => {
    if (pricing.items && !pricing.items.some(record => record.pricing_version_id === occurrence.pricing_version_id) && pricing.cursor && !pricing.loadingMore && !pricing.failed) void pricing.loadMore();
  }, [pricing, occurrence.pricing_version_id]);
  const names = Object.fromEntries([...item.roster.map(learner => [learner.learner_id, learner.display_name]), [occurrence.tutor.tutor_id, occurrence.tutor.display_name]]);
  const activeRoster = item.roster.filter(learner => ['held', 'confirmed'].includes(learner.state));
  return <div className={styles.detail}>{item.formation_resolution && <section className={styles.notice}><h3>{copy.formationTitle}</h3><p>{copy.formationActions[item.formation_resolution.action]}</p></section>}<h3>{copy.roster}</h3><SessionTime start={occurrence.start_at} end={occurrence.end_at} />{item.roster.length ? <ul className={styles.list}>{item.roster.map(learner => <li key={learner.enrollment_id}><strong>{learner.display_name}</strong><p>{bookingCopy.states[learner.state] || learner.state} · {learner.quote_accepted_at ? copy.accepted : copy.awaitingQuote}</p>{learner.hold_expires_at && <p>{copy.heldUntil}: {cairoTime(learner.hold_expires_at)} {bookingCopy.timezone}</p>}{learner.provisional_amendment_id && <p>{copy.provisional}</p>}</li>)}</ul> : <p>{copy.noRoster}</p>}
    <DeliveryPanel occurrenceId={occurrence.occurrence_id} view="admin" /><MeetingPanel occurrenceId={occurrence.occurrence_id} view="admin" /><StaffSessionMaterials occurrenceId={occurrence.occurrence_id} roster={item.roster} />
    <AdminConfirmation item={item} onSaved={onSaved} /><ProposeTutorReassignment item={item} onSaved={() => setReassignmentRevision(value => value + 1)} /><TutorReassignments occurrenceId={occurrence.occurrence_id} view="admin" revision={reassignmentRevision} onSaved={onSaved} />
    {['draft', 'forming', 'confirmed'].includes(occurrence.state) && <details className={styles.section}><summary>{copy.capacity}</summary><p>{copy.capacityHint}</p><IdentityForm action={`occurrences/${occurrence.occurrence_id}/capacity`} submitLabel={copy.saveCapacity} successMessage={copy.capacitySaved} resettable={false} onSaved={onSaved} payload={form => ({ capacity: Number(form.get('capacity')), reason: String(form.get('reason')).trim(), expected_version: occurrence.version })}><TextField name="capacity" label={copy.capacity} type="number" min={occurrence.target_tier || 1} defaultValue={occurrence.capacity} /><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm></details>}
    <section className={styles.private}><h3>{copy.privateTerms}</h3><p>{copy.privateNotice}</p>{item.fee_agreement ? <p>{copy.approvedFee}: <strong>{money(item.fee_agreement.fee_minor)}</strong></p> : <p>{copy.feePending}</p>}<ReadState pending={pricing.items === null} {...pricing} /><ExactFeeForm key={`${occurrence.occurrence_id}-${occurrence.version}`} item={item} pricing={pricing.items || []} onSaved={() => { fees.reload(); onSaved(); }} /><h3>{copy.feeHistory}</h3><ReadState pending={fees.items === null} {...fees} /><ul className={styles.list}>{fees.items?.map(fee => <li key={fee.fee_agreement_id}>{money(fee.fee_minor)} · {fee.target_tier || 1} · {fee.is_current ? copy.active : copy.proposedFee}<p className={styles.reference}>{fee.fee_agreement_id.slice(0, 8)}</p></li>)}</ul></section>
    {occurrence.format === 'group' && <GroupAmendmentForm item={item} policies={policies} agreements={fees.items || []} onSaved={onSaved} />}
    <h3>{copy.proposals}</h3>{item.pending_proposals.map(ref => <StaffProposal key={ref.proposal_id} id={ref.proposal_id} kind={ref.kind} view="admin" names={names} onSaved={onSaved} />)}<CreateOperationProposal occurrence={occurrence} onSaved={onSaved} />
    {activeRoster.length === 0 && !['completed', 'cancelled', 'in_progress'].includes(occurrence.state) && <><details className={styles.section}><summary>{copy.move}</summary><p>{copy.moveDescription}</p><IdentityForm action={`occurrences/${occurrence.occurrence_id}/reschedule`} submitLabel={copy.moveSubmit} successMessage={copy.moved} resettable={false} onSaved={onSaved} payload={form => { const start_at = instantField(form, 'start_at'); return { start_at, end_at: new Date(Date.parse(start_at) + Date.parse(occurrence.end_at) - Date.parse(occurrence.start_at)).toISOString(), time_zone: 'Africa/Cairo', reason: String(form.get('reason')).trim(), accepted_proposal_id: null, expected_version: occurrence.version }; }}><CairoInput name="start_at" label={copy.startAt} /><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm></details><details className={styles.section}><summary>{copy.cancel}</summary><p>{copy.cancelDescription}</p><IdentityForm action={`occurrences/${occurrence.occurrence_id}/cancel`} submitLabel={copy.cancel} successMessage={copy.cancelled} resettable={false} onSaved={onSaved} payload={form => ({ reason: String(form.get('reason')).trim(), remedy_proposal_id: null, expected_version: occurrence.version })}><TextField name="reason" label={bookingCopy.reason} maxLength={2000} /></IdentityForm></details></>}
  </div>;
}

function ExactFeeForm({ item, pricing, onSaved }: { item: AdminOccurrence; pricing: AdminPricing[]; onSaved: () => void }) {
  const occurrence = item.occurrence; const [purpose, setPurpose] = useState(item.fee_agreement ? 'amendment' : 'initial'); const [tier, setTier] = useState(String(occurrence.target_tier || '')); const [pricingId, setPricingId] = useState(occurrence.pricing_version_id);
  const choice = pricing.find(record => record.pricing_version_id === pricingId); const duration = (Date.parse(occurrence.end_at) - Date.parse(occurrence.start_at)) / 60_000;
  const feeData = choice?.compensation; const bands = Array.isArray(feeData?.group_fee_bands) ? feeData.group_fee_bands as { tier_id: string; fee_min_minor: number; fee_max_minor: number }[] : [];
  const bounds = occurrence.format === 'group' ? bands.find(band => band.tier_id === `group_${tier}`) : feeData?.private_fee_rule as { fee_min_minor: number; fee_max_minor: number } | undefined;
  return <IdentityForm action={`occurrences/${occurrence.occurrence_id}/fee-agreements`} submitLabel={copy.approveFee} successMessage={copy.feeSaved} resettable={false} disabled={!choice || !bounds} onSaved={onSaved} payload={form => ({ tutor_id: occurrence.tutor.tutor_id, fee_minor: moneyField(form, 'fee_minor'), currency: 'EGP', duration_minutes: duration, compensation_policy_version_id: pricingId, target_tier: occurrence.format === 'group' ? Number(tier) : null, purpose, reason: String(form.get('reason')).trim(), expected_version: occurrence.version })}>
    <Select name="purpose" label={copy.feePurpose} value={purpose} onChange={value => { setPurpose(value); if (value === 'initial') { setTier(String(occurrence.target_tier || '')); setPricingId(occurrence.pricing_version_id); } }}>{!item.fee_agreement && <option value="initial">{copy.initial}</option>}<option value="amendment">{copy.amendment}</option></Select>
    {occurrence.format === 'group' && <Select name="target_tier" label={copy.tier} value={tier} onChange={setTier}>{[2, 3, 4].filter(size => purpose === 'amendment' || size === occurrence.target_tier).map(size => <option value={size} key={size}>{size}</option>)}</Select>}
    <Select name="pricing_id" label={copy.pricing} value={pricingId} onChange={setPricingId}>{pricing.filter(record => ['approved', 'published'].includes(record.status) && record.scope === occurrence.format && Number(record.customer_pricing.duration_minutes) === duration && (purpose === 'amendment' || record.pricing_version_id === occurrence.pricing_version_id)).map(record => <option key={record.pricing_version_id} value={record.pricing_version_id}>{record.scope} · {duration} min · {record.pricing_version_id.slice(0, 8)}</option>)}</Select>{bounds && <p>{copy.feeBounds}: {money(bounds.fee_min_minor)}–{money(bounds.fee_max_minor)}</p>}<label className={formStyles.field}>{copy.fee}<input type="number" name="fee_minor" min={bounds ? scaledIntegerInput(bounds.fee_min_minor, 2) : 0} max={bounds ? scaledIntegerInput(bounds.fee_max_minor, 2) : undefined} step="0.01" inputMode="decimal" required /></label><TextField name="reason" label={copy.feeReason} maxLength={2000} />
  </IdentityForm>;
}
