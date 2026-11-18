'use client';

import { CustomerTutorReassignments } from '../teaching/customer-tutor-reassignment';

import Link from 'next/link';
import { SessionMaterials } from '../files/materials';
import { LearningRecordPanel } from '../teaching/learning-records';
import { MeetingPanel } from '../teaching/meeting-panel';
import { useState, type ReactNode } from 'react';
import type { CustomerEnrollment, PublicOccurrence } from '@/modules/booking/queries';
import { bookingCopy as copy } from '@/locales/booking';
import { IdentityForm, TextField } from '../identity-form';
import { usePagedRecords } from '../identity-workspaces';
import { OfferTerms } from '../catalog/offer-terms';
import { Check, ReadState, Select, SessionTime, CairoTimestamp, money, useBookingRecord } from './shared';
import { CustomerChangeRequest, CustomerProposal } from './customer-proposals';
import { transferCopy } from '@/locales/enrollment-transfers';
import { BookingPackageCoverage } from '../packages/booking-coverage';
import styles from './booking.module.css';
import detail from './reservation.module.css';
import { BookingFunding } from '../payments/booking-funding';
import formStyles from '../auth.module.css';

type Learner = { learner_id: string; display_name: string };
type Waitlist = { waitlist_entry_id: string; version: number; learner_id: string; occurrence: PublicOccurrence; state: string; position: number | null; offered_enrollment_id: string | null; offer_expires_at: string | null };

export function CustomerBookings({ offerId, initialOccurrence }: { offerId?: string; initialOccurrence?: string }) {
  const learners = usePagedRecords<Learner>('me/learners'); const [selected, setSelected] = useState('');
  const learner = learners.items?.find(item => item.learner_id === selected) || (learners.items?.length === 1 ? learners.items[0] : undefined);
  return <><section className={styles.section}><div className={styles.tools}><Select name="learner_id" label={copy.learner} value={learner?.learner_id || ''} onChange={setSelected}><option value="">{copy.chooseLearner}</option>{learners.items?.map(item => <option key={item.learner_id} value={item.learner_id}>{item.display_name}</option>)}</Select><Link className={styles.link} href="/learn/requests">Request a new session</Link></div><ReadState pending={learners.items === null} {...learners} />{learners.items?.length === 0 && <p>{copy.noLearners}</p>}</section>
    {learner && <div key={learner.learner_id}>{offerId && <ReserveSession key={`${offerId}-${learner.learner_id}`} offerId={offerId} learner={learner} initialOccurrence={initialOccurrence} />}<EnrollmentList learner={learner} /><WaitlistList learner={learner} /></div>}
  </>;
}

function ReserveSession({ offerId, learner, initialOccurrence }: { offerId: string; learner: Learner; initialOccurrence?: string }) {
  const records = usePagedRecords<PublicOccurrence>(`booking/occurrences?offer_id=${encodeURIComponent(offerId)}${initialOccurrence ? `&occurrence_id=${encodeURIComponent(initialOccurrence)}` : ''}`);
  const [selected, setSelected] = useState(initialOccurrence || ''); const [enrollment, setEnrollment] = useState(''); const [capacityChanged, setCapacityChanged] = useState(false);
  const occurrence = records.items?.find(item => item.occurrence_id === selected);
  return <section className={styles.section} id="reserve"><h2>{copy.schedule}</h2><p>{copy.allTimes}</p><p>{copy.availabilityNotice}</p>{capacityChanged && <p className={styles.notice} role="status">{copy.capacityChanged}</p>}<ReadState pending={records.items === null} {...records} /><ul className={styles.recordList}>{records.items?.map(item => <li key={item.occurrence_id}><button type="button" aria-pressed={selected === item.occurrence_id} onClick={() => { setSelected(item.occurrence_id); setEnrollment(''); }}><SessionTime start={item.start_at} end={item.end_at} /><span>{copy.withTutor} {item.tutor.display_name} · {money(item.customer_price_minor)}</span><span>{copy.seats(item.available_seats)}</span></button></li>)}</ul>{records.items?.length === 0 && <p>{copy.noSchedule}</p>}
    {occurrence && <div className={styles.detail} key={`${occurrence.occurrence_id}-${occurrence.version}`}><h3>{copy.holdTitle}</h3><p>{copy.holdDescription}</p><p><Link className={styles.link} href={`/offers/${offerId}#offer-terms`}>{copy.terms}</Link></p><dl className={styles.facts}><div><dt>{copy.learnerName}</dt><dd>{learner.display_name}</dd></div><div><dt>{copy.time}</dt><dd><SessionTime start={occurrence.start_at} end={occurrence.end_at} /></dd></div><div><dt>{copy.tuition}</dt><dd>{money(occurrence.customer_price_minor)}</dd></div></dl>
      {occurrence.available_seats > 0 ? <IdentityForm action={`occurrences/${occurrence.occurrence_id}/holds`} payload={() => ({ learner_id: learner.learner_id })} submitLabel={copy.hold} successMessage={copy.held} resettable={false} onSaved={result => setEnrollment(String(result.enrollment_id))} onFailure={result => { if (result.code === 'CAPACITY_CONFLICT') { setCapacityChanged(true); records.reload(); } }}><Check name="terms_reviewed" label={copy.holdConsent} /></IdentityForm> : <><p>{copy.noSeats}</p>{occurrence.waitlist_available && <><h3>{copy.waitlistTitle}</h3><p>{copy.waitlistDescription}</p><IdentityForm action={`occurrences/${occurrence.occurrence_id}/waitlist`} payload={() => ({ learner_id: learner.learner_id })} submitLabel={copy.join} successMessage={copy.joined} resettable={false}><Check name="waitlist_consent" label={copy.waitlistConsent} /></IdentityForm></>}</>}
      {enrollment && <p><Link className={styles.link} href={`/learn/bookings/${enrollment}`}>{copy.openReservation}</Link></p>}
    </div>}
  </section>;
}

function EnrollmentList({ learner }: { learner: Learner }) {
  const records = usePagedRecords<CustomerEnrollment>(`me/enrollments?learner_id=${learner.learner_id}`);
  return <section className={styles.section}><h2>{copy.upcoming}</h2><ReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p className={styles.empty}>{copy.empty}</p>}<ul className={styles.list}>{records.items?.map(item => <li key={item.enrollment_id} className={styles.sessionRow}><div><SessionTime start={item.occurrence.start_at} end={item.occurrence.end_at} /><p>{copy.withTutor} {item.occurrence.tutor.display_name}</p><p className={styles.status}>{copy.states[item.state] || item.state}</p></div><Link className={styles.link} href={`/learn/bookings/${item.enrollment_id}`}>{copy.openReservation}</Link></li>)}</ul></section>;
}

function WaitlistList({ learner }: { learner: Learner }) { return <><WaitlistRecords learner={learner} state="offered" /><WaitlistRecords learner={learner} state="waiting" /></>; }
function WaitlistRecords({ learner, state }: { learner: Learner; state: 'offered' | 'waiting' }) {
  const records = usePagedRecords<Waitlist>(`me/waitlist?learner_id=${learner.learner_id}&state=${state}`);
  return <section className={styles.section}><h2>{state === 'offered' ? copy.offered : copy.waitlist}</h2><ReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p>{copy.waitlistEmpty}</p>}<ul className={styles.list}>{records.items?.map(item => <li key={`${item.waitlist_entry_id}-${item.version}`}><SessionTime start={item.occurrence.start_at} end={item.occurrence.end_at} /><p>{copy.withTutor} {item.occurrence.tutor.display_name} · {copy.states[item.state] || item.state}</p>{item.position !== null && <p>{copy.position}: {item.position}</p>}{item.offered_enrollment_id && <><p><Link className={styles.link} href={`/learn/bookings/${item.offered_enrollment_id}`}>{copy.offered}</Link></p>{item.offer_expires_at && <p>{copy.offerExpires}: <CairoTimestamp value={item.offer_expires_at} /></p>}</>}{['waiting', 'offered'].includes(item.state) && <IdentityForm action={`waitlist/${item.waitlist_entry_id}/leave`} payload={() => ({ expected_version: item.version })} submitLabel={copy.leave} successMessage={copy.left} resettable={false} onSaved={records.reload}><Check name="leave_consent" label={copy.leave} /></IdentityForm>}</li>)}</ul></section>;
}

export function CustomerBookingDetail({ enrollmentId }: { enrollmentId: string }) {
  const record = useBookingRecord<CustomerEnrollment>(`enrollments/${enrollmentId}`);
  const item = record.data;
  const offer = useBookingRecord<{ items: { offer_id: string; title: string }[] }>(item ? `public/offers?offer_id=${item.occurrence.offer_id}&limit=1` : null);

  return <>
    <div className={detail.toolbar}>
      <Link className={styles.link} href="/learn/bookings">{copy.back}</Link>
      <button type="button" className={detail.quietButton} onClick={record.reload}>{copy.refresh}</button>
    </div>
    {record.failed ? <p role="alert" className={formStyles.error}>{copy.failed}</p> : !item ? <p role="status">{copy.loading}</p> :
      <Reservation key={`${item.enrollment_id}-${item.version}-${item.quote.quote_id}-${item.quote.accepted_at}`} item={item}
        title={offer.data?.items.find(row => row.offer_id === item.occurrence.offer_id)?.title} onSaved={record.reload} />}
  </>;
}

function Reservation({ item, title, onSaved }: { item: CustomerEnrollment; title?: string; onSaved: () => void }) {
  const { occurrence, learner, quote, transfer_link: transfer } = item;
  const pendingTransfer = transfer?.role === 'destination' && transfer.stage !== 'committed';
  const held = item.state === 'held';
  const confirmed = item.state === 'confirmed';
  const showRoomFirst = confirmed && occurrence.state !== 'completed' && occurrence.state !== 'cancelled';
  const showQuoteFirst = item.is_provisional || (held && !quote.accepted_at);
  const format = occurrence.format === 'group' ? copy.groupCapacity(occurrence.capacity) : copy.private;
  const terms = <OfferTerms terms={quote.customer_policy} policyId={quote.policy_version_id} />;
  const room = <MeetingPanel occurrenceId={occurrence.occurrence_id} learnerId={learner.learner_id} displayedSchedule={{ start: occurrence.start_at, end: occurrence.end_at }} />;
  const details = <QuoteDetails item={item} pendingTransfer={pendingTransfer} />;

  return <div className={detail.reservation}>
    <header className={detail.overview}>
      <div className={detail.titleLine}>
        <h2>{title || format}</h2>
        <span className={detail.state} data-confirmed={confirmed}>{item.is_provisional ? copy.provisional : copy.states[item.state] || item.state}</span>
      </div>
      <p className={detail.people}>{copy.learnerName} <strong>{learner.display_name}</strong><span aria-hidden="true"> · </span>{copy.tutor} <strong>{occurrence.tutor.display_name}</strong>{title && <><span aria-hidden="true"> · </span>{format}</>}</p>
      <div className={detail.titleLine}>
        <SessionTime start={occurrence.start_at} end={occurrence.end_at} />
        <details className={detail.reference}><summary>{copy.reference} <bdi>{item.enrollment_id.slice(0, 8)}</bdi></summary><bdi>{item.enrollment_id}</bdi></details>
      </div>
      {held && item.hold_expires_at && <p className={detail.deadline}>{copy.holdExpires} <strong><CairoTimestamp value={item.hold_expires_at} /></strong></p>}
      {held && quote.accepted_at && <p role="status">{copy.accepted}: <CairoTimestamp value={quote.accepted_at} /></p>}
    </header>

    {transfer && <p className={styles.notice}>
      {transfer.stage === 'committed' ? transferCopy.applied : transfer.stage === 'closed' ? transferCopy.actions.closed : transfer.stage === 'awaiting_review' ? transferCopy.noSeat : transferCopy.held}
      {transfer.other_enrollment_id && <><br /><Link className={styles.link} href={`/learn/bookings/${transfer.other_enrollment_id}`}>{transfer.role === 'source' ? transferCopy.openBooking : transferCopy.openOriginal}</Link></>}
    </p>}
    {showRoomFirst && room}
    {showQuoteFirst && <section className={detail.quote} aria-labelledby="quote-heading">
      {details}
      <Disclosure label={copy.bookingTerms}>{terms}</Disclosure>
      {!item.is_provisional && !pendingTransfer && held && quote.is_current && !quote.accepted_at &&
        <IdentityForm action={`quotes/${quote.quote_id}/accept`} payload={() => ({ quote_hash: quote.quote_hash, expected_version: quote.version })}
          submitLabel={copy.accept} successMessage={copy.acceptSaved} resettable={false} onSaved={onSaved}>
          <Check name="quote_consent" label={copy.acceptConsent} />
        </IdentityForm>}
    </section>}
    {item.pending_proposals.length > 0 && <section className={detail.proposals}>
      <h2>{copy.changes}</h2>
      {item.pending_proposals.map(ref => <CustomerProposal key={ref.proposal_id} id={ref.proposal_id} kind={ref.kind} learnerId={learner.learner_id} />)}
    </section>}
    {transfer && !item.pending_proposals.some(ref => ref.proposal_id === transfer.proposal_id) &&
      <CustomerProposal id={transfer.proposal_id} kind="enrollment_transfer" learnerId={learner.learner_id} />}
    {occurrence.state === 'completed' && <LearningRecordPanel occurrenceId={occurrence.occurrence_id} learnerId={learner.learner_id} view="customer" />}
    <BookingFunding item={item} onSaved={onSaved} />
    <div className={detail.sections}>
      <Disclosure label={copy.materials}>
        <SessionMaterials enrollmentId={item.enrollment_id} occurrenceId={occurrence.occurrence_id} allowPreparationUpload />
      </Disclosure>
      {!item.is_provisional && !pendingTransfer && (held || confirmed) && <Disclosure label={copy.packageCredits}>
        <BookingPackageCoverage enrollmentId={item.enrollment_id} />
      </Disclosure>}
      {!showQuoteFirst && <Disclosure label={copy.quoteAndTerms}>{details}{terms}</Disclosure>}
      {!showRoomFirst && <Disclosure label={copy.meeting}>{room}</Disclosure>}
      <CustomerTutorReassignments occurrenceId={occurrence.occurrence_id} learnerId={learner.learner_id} />
      {!item.is_provisional && !pendingTransfer && (!transfer || ['closed', 'committed'].includes(transfer.stage)) && <CustomerChangeRequest enrollment={item} />}
      {held && !item.is_provisional && !pendingTransfer && <details><summary>{copy.cancelTitle}</summary>
        <p>{item.funding.integration_state === 'ready' ? copy.cancelDescription : copy.releaseUnavailable}</p>
        <IdentityForm action={`enrollments/${item.enrollment_id}/cancel`} payload={form => ({ reason: String(form.get('reason')).trim(), remedy_proposal_id: null, expected_version: item.version })}
          disabled={item.funding.integration_state !== 'ready'} submitLabel={copy.cancel} successMessage={copy.cancelled} resettable={false} onSaved={onSaved}>
          <TextField name="reason" label={copy.reason} maxLength={2000} />
        </IdentityForm>
      </details>}
    </div>
  </div>;
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [visited, setVisited] = useState(false);
  return <details className={detail.disclosure} onToggle={event => { if (event.currentTarget.open) setVisited(true); }}>
    <summary>{label}</summary>{visited && children}
  </details>;
}

function QuoteDetails({ item, pendingTransfer }: { item: CustomerEnrollment; pendingTransfer: boolean }) {
  const { quote } = item;
  return <>
    <div className={detail.titleLine}><h2 id="quote-heading">{item.is_provisional ? copy.provisionalQuote : copy.quote}</h2>
      <strong className={detail.price}>{money(quote.customer_price_minor)}</strong></div>
    <dl className={detail.quoteFacts}>
      <div><dt>{copy.deposit}</dt><dd>{money(item.funding.required_for_confirmation_minor)}</dd></div>
      <div><dt>{copy.quoteExpires}</dt><dd><CairoTimestamp value={quote.expires_at} /></dd></div>
      {quote.accepted_at && <div><dt>{copy.accepted}</dt><dd><CairoTimestamp value={quote.accepted_at} /></dd></div>}
    </dl>
    {pendingTransfer ? <p>{item.transfer_link?.stage === 'closed' ? transferCopy.actions.closed : transferCopy.held}</p> :
      item.is_provisional ? <p>{copy.provisionalDescription}</p> :
      !quote.accepted_at && !(quote.is_current && item.state === 'held') && <p>{copy.expired}</p>}
  </>;
}
