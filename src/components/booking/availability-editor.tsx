'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Availability, AdminOccurrence, TutorOccurrence } from '@/modules/booking/queries';
import { bookingStaffCopy as copy } from '@/locales/booking-staff';
import { bookingCopy } from '@/locales/booking';
import { IdentityForm, TextField } from '../identity-form';
import { ReadState, Select, SessionTime, useBookingRecord } from './shared';
import styles from './booking.module.css';
import formStyles from '../auth.module.css';

export function AvailabilityEditor({ tutorId }: { tutorId?: string }) {
  const record = useBookingRecord<Availability>(tutorId ? `tutors/${tutorId}/availability` : 'tutor/availability');
  return <section className={styles.section} id="availability"><h2>{copy.availability}</h2><p>{copy.availabilityDescription}</p><p>{copy.commitments}</p><ReadState pending={!record.data} {...record} />{record.data && <AvailabilityForm key={`${record.data.tutor_id}-${record.data.version}`} availability={record.data} admin={Boolean(tutorId)} onSaved={record.reload} />}</section>;
}
function AvailabilityForm({ availability, admin, onSaved }: { availability: Availability; admin: boolean; onSaved: () => void }) {
  const [weekly, setWeekly] = useState(availability.weekly_intervals);
  const [exceptions, setExceptions] = useState(availability.dated_exceptions);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const updateWeekly = (index: number, field: string, value: string | number) => setWeekly(rows => rows.map((row, at) => at === index ? { ...row, [field]: value } : row));
  return <><IdentityForm action="availability" submitLabel={copy.saveAvailability} successMessage={copy.availabilitySaved} resettable={false} onSaved={onSaved} onFailure={result => setConflicts((result.field_errors?.conflicting_occurrence_ids || []).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100))} payload={form => ({ tutor_id: availability.tutor_id, expected_version: availability.version, weekly_intervals: weekly, dated_exceptions: exceptions, reason: String(form.get('reason')).trim() })}>
    <fieldset className={styles.group}><legend>{copy.weekly}</legend>{!weekly.length && <p>{copy.noHours}</p>}{weekly.map((row, index) => <div className={styles.interval} key={index}><Select name={`weekday_${index}`} label={`${copy.weekday} ${index + 1}`} value={String(row.weekday)} onChange={value => updateWeekly(index, 'weekday', Number(value))}>{copy.days.map((day, at) => <option value={at + 1} key={day}>{day}</option>)}</Select><label className={formStyles.field}>{copy.start} {index + 1}<input type="time" required value={row.start_local} onChange={event => updateWeekly(index, 'start_local', event.target.value)} /></label><label className={formStyles.field}>{copy.end} {index + 1}<input type="time" required value={row.end_local} onChange={event => updateWeekly(index, 'end_local', event.target.value)} /></label><button type="button" className={formStyles.signout} aria-label={`${copy.remove} ${copy.weekday.toLowerCase()} ${index + 1}`} onClick={() => setWeekly(rows => rows.filter((_, at) => at !== index))}>{copy.remove}</button></div>)}<button type="button" className={formStyles.signout} disabled={weekly.length >= 70} onClick={() => setWeekly(rows => [...rows, { weekday: 1, start_local: '09:00', end_local: '17:00' }])}>{copy.addInterval}</button></fieldset>
    <fieldset className={styles.group}><legend>{copy.exceptions}</legend>{exceptions.map((exception, index) => <div className={styles.detail} key={index}><label className={formStyles.field}>{copy.date} {index + 1}<input type="date" required value={exception.local_date} onChange={event => setExceptions(rows => rows.map((row, at) => at === index ? { ...row, local_date: event.target.value } : row))} /></label>{!exception.intervals.length && <p>{copy.timeOff}</p>}{exception.intervals.map((interval, at) => <div className={styles.interval} key={at}>{(['start_local', 'end_local'] as const).map(field => <label className={formStyles.field} key={field}>{field === 'start_local' ? copy.start : copy.end} {index + 1}.{at + 1}<input type="time" required value={interval[field]} onChange={event => setExceptions(rows => rows.map((row, ri) => ri === index ? { ...row, intervals: row.intervals.map((item, ii) => ii === at ? { ...item, [field]: event.target.value } : item) } : row))} /></label>)}<button type="button" className={formStyles.signout} onClick={() => setExceptions(rows => rows.map((row, ri) => ri === index ? { ...row, intervals: row.intervals.filter((_, ii) => ii !== at) } : row))}>{copy.remove}</button></div>)}<div className={styles.rowActions}><button type="button" className={formStyles.signout} disabled={exception.intervals.length >= 10} onClick={() => setExceptions(rows => rows.map((row, at) => at === index ? { ...row, intervals: [...row.intervals, { start_local: '09:00', end_local: '17:00' }] } : row))}>{copy.addExceptionInterval}</button><button type="button" className={formStyles.signout} onClick={() => setExceptions(rows => rows.filter((_, at) => at !== index))}>{copy.removeDate}</button></div></div>)}<button type="button" className={formStyles.signout} disabled={exceptions.length >= 366} onClick={() => setExceptions(rows => [...rows, { local_date: '', intervals: [] }])}>{copy.addException}</button></fieldset>
    <TextField name="reason" label={bookingCopy.reason} maxLength={2000} />
  </IdentityForm>{conflicts.length > 0 && <section className={styles.notice} aria-label={copy.conflicting}><h3>{copy.conflicting}</h3>{conflicts.map(id => <ConflictingSession key={id} id={id} admin={admin} />)}</section>}</>;
}

function ConflictingSession({ id, admin }: { id: string; admin: boolean }) {
  const record = useBookingRecord<{ items: (AdminOccurrence | TutorOccurrence)[] }>(`${admin ? 'occurrences' : 'tutor/occurrences'}?occurrence_id=${id}`);
  const occurrence = record.data?.items[0]?.occurrence;
  return <div className={styles.detail}>{occurrence ? <><SessionTime start={occurrence.start_at} end={occurrence.end_at} /><p><Link className={styles.link} href={`/${admin ? 'admin' : 'tutor'}/schedule?occurrence=${id}`}>{copy.inspectSession}</Link></p></> : <ReadState pending={!record.data} {...record} />}</div>;
}
