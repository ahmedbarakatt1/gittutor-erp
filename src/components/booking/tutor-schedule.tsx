'use client';

import Link from 'next/link';
import type { TutorOccurrence } from '@/modules/booking/queries';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { bookingCopy } from '@/locales/booking';
import { usePagedRecords } from '../identity-workspaces';
import { AvailabilityEditor } from './availability-editor';
import { CreateOperationProposal, StaffProposal } from './staff-proposals';
import { ReadState, SessionTime, money } from './shared';
import styles from './booking.module.css';

export function TutorSchedule({ initialOccurrence }: { initialOccurrence?: string }) {
  const records = usePagedRecords<TutorOccurrence>(initialOccurrence ? 'tutor/occurrences?occurrence_id=' + initialOccurrence : 'tutor/occurrences');
  return <>{initialOccurrence && <Link className={styles.link} href="/tutor/schedule">{copy.allSessions}</Link>}<section className={styles.section}><h2>{copy.assigned}</h2><p>{bookingCopy.allTimes}</p><ReadState pending={records.items === null} {...records} />{records.items?.length === 0 && <p>{copy.empty}</p>}<ul className={styles.list}>{records.items?.map(item => <li key={item.occurrence.occurrence_id}><SessionTime start={item.occurrence.start_at} end={item.occurrence.end_at} /><p>{bookingCopy.states[item.occurrence.state] || item.occurrence.state} · {item.occurrence.format === 'group' ? bookingCopy.group : bookingCopy.private}</p><h3>{copy.roster}</h3>{item.roster.length ? <ul>{item.roster.map(learner => <li key={learner.enrollment_id}>{learner.display_name} · {bookingCopy.states[learner.state] || learner.state}</li>)}</ul> : <p>{copy.noRoster}</p>}<div className={styles.private}><h3>{copy.privateTerms}</h3><p>{copy.privateNotice}</p>{item.fee_agreement ? <p>{copy.approvedFee}: <strong>{money(item.fee_agreement.fee_minor)}</strong></p> : <p>{copy.feePending}</p>}</div>{item.pending_proposals.map(ref => <StaffProposal key={ref.proposal_id} id={ref.proposal_id} kind={ref.kind} view="tutor" />)}{['forming', 'confirmed'].includes(item.occurrence.state) && <CreateOperationProposal occurrence={item.occurrence} view="tutor" onSaved={records.reload} />}</li>)}</ul></section><AvailabilityEditor /></>;
}
