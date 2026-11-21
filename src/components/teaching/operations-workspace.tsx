'use client';

import { useStaffCopy } from '@/components/ar-staff-label';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Availability, AdminOccurrence } from '@/modules/booking/queries';
import type { AdminTutor } from '@/modules/catalog/queries';
import type { UnavailabilityCase, SeriesSummary, OccurrenceSeries, SeriesChangeSet } from '@/modules/teaching/operations';
import { formatCairoInstant } from '@/modules/booking/scheduling';
import { operationsCopy as copy } from '@/locales/teaching-operations';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, instantField, Select, SessionTime } from '../booking/shared';
import { PaymentReadState, usePaymentList, usePaymentRecord } from '../payments/shared';
import { TutorReassignments } from './tutor-reassignment';
import styles from '../files/files.module.css';
import formStyles from '../auth.module.css';

type Owner = { account_id: string; display_name: string; role: string };
export function TeachingOperations({ view, initialChangeSet }: { view: 'tutor' | 'admin'; initialChangeSet?: string }) {
  const copyUi = useStaffCopy(copy);

  const tutors = usePaymentList<AdminTutor>(view === 'admin' ? 'tutors?active=true' : null), [tutorId, setTutorId] = useState('');
  const [state, setState] = useState('open'), cases = usePaymentList<UnavailabilityCase>(`unavailability-cases?state=${state}`);
  return <><section className={styles.section}><h2>{copyUi.report}</h2>{view === 'admin' && <><Select name="report_tutor" label={copyUi.tutor} value={tutorId} onChange={setTutorId}><option value="">{copyUi.choose}</option>{tutors.items?.map(tutor => <option key={tutor.tutor_id} value={tutor.tutor_id}>{tutor.display_name}</option>)}</Select><PaymentReadState pending={!tutors.items} {...tutors} /></>}{(view === 'tutor' || tutorId) && <UnavailabilityReport key={tutorId || 'self'} tutorId={tutorId || undefined} onSaved={cases.reload} />}</section><section className={styles.section}><h2>{copyUi.cases}</h2><Select name="case_state" label={copyUi.state} value={state} onChange={setState}><option value="open">{copyUi.open}</option><option value="resolved">{copyUi.resolved}</option></Select><PaymentReadState pending={!cases.items} {...cases} />{cases.items?.length === 0 && <p>{copyUi.noCases}</p>}<ul className={styles.list}>{cases.items?.map(item => <li key={item.case_id}><SessionTime start={item.start_at} end={item.end_at} /><p>{copyUi.owner}: <strong>{item.owner.display_name}</strong> · {item.status === 'open' ? copyUi.open : copyUi.resolved}</p><p><Link href={`/${view === 'admin' ? 'admin' : 'tutor'}/schedule?occurrence=${item.occurrence_id}`}>{copyUi.reviewSession}</Link></p>{view === 'admin' && <CaseActions key={item.version} item={item} onSaved={cases.reload} />}</li>)}</ul></section><TutorReassignments view={view} />{view === 'admin' && <SeriesWorkspace initialChangeSet={initialChangeSet} />}</>;
}
function UnavailabilityReport({ tutorId, onSaved }: { tutorId?: string; onSaved: () => void }) {
  const copyUi = useStaffCopy(copy);

  const current = usePaymentRecord<Availability>(tutorId ? `tutors/${tutorId}/availability` : 'tutor/availability');
  return <><PaymentReadState pending={!current.data} {...current} />{current.data && <IdentityForm key={current.data.version} action="tutor-unavailability" submitLabel={copyUi.report} successMessage={copyUi.reported} resettable={false} onSaved={() => { current.reload(); onSaved(); }} payload={form => ({ tutor_id: current.data!.tutor_id, from_at: instantField(form, 'from_at'), to_at: instantField(form, 'to_at'), reason: String(form.get('reason')).trim(), expected_version: current.data!.version })}><CairoInput name="from_at" label={copyUi.from} /><CairoInput name="to_at" label={copyUi.to} /><TextField name="reason" label={copyUi.reason} multiline maxLength={2000} /></IdentityForm>}</>;
}
function CaseActions({ item, onSaved }: { item: UnavailabilityCase; onSaved: () => void }) {
  const copyUi = useStaffCopy(copy);

  const owners = usePaymentList<Owner>(item.can_assign ? 'staff-role-grants' : null), [owner, setOwner] = useState(item.owner.account_id);
  return <>{item.can_assign && <details><summary>{copyUi.assign}</summary><IdentityForm action={`unavailability-cases/${item.case_id}/assign`} submitLabel={copyUi.assign} successMessage={copyUi.assigned} resettable={false} onSaved={onSaved} disabled={!owners.items?.some(row => row.role === 'admin' && row.account_id === owner)} payload={() => ({ owner_account_id: owner, expected_version: item.version })}><Select name="owner" label={copyUi.owner} value={owner} onChange={setOwner}><option value="">{copyUi.choose}</option>{owners.items?.filter(row => row.role === 'admin').map(row => <option key={row.account_id} value={row.account_id}>{row.display_name}</option>)}</Select><PaymentReadState pending={!owners.items} {...owners} /></IdentityForm></details>}{item.status === 'open' && <p>{copyUi.resolution}</p>}{item.can_resolve && <IdentityForm action={`unavailability-cases/${item.case_id}/resolve`} submitLabel={copyUi.resolve} successMessage={copyUi.closed} resettable={false} onSaved={onSaved} payload={form => ({ resolution_proposal_id: item.resolution_proposal_id, reason: String(form.get('reason')).trim(), expected_version: item.version })}><TextField name="reason" label={copyUi.reason} maxLength={2000} /></IdentityForm>}</>;
}
function SeriesWorkspace({ initialChangeSet }: { initialChangeSet?: string }) {
  const copyUi = useStaffCopy(copy);

  const router = useRouter(), sessions = usePaymentList<AdminOccurrence>('occurrences'), series = usePaymentList<SeriesSummary>('occurrence-series'), [seriesId, setSeriesId] = useState('');
  return <section className={styles.section}><h2>{copyUi.series}</h2><p>{copyUi.seriesIntro}</p><details><summary>{copyUi.create}</summary><IdentityForm action="occurrence-series" submitLabel={copyUi.create} successMessage={copyUi.created} onSaved={result => { setSeriesId(String(result.series_id)); series.reload(); }} payload={form => ({ title: String(form.get('title')).trim(), occurrence_ids: form.getAll('occurrence_id') })}><TextField name="title" label={copyUi.titleLabel} maxLength={120} /><p>{copyUi.max}</p><PaymentReadState pending={!sessions.items} {...sessions} /><fieldset><legend>{copyUi.selected}</legend>{sessions.items?.filter(item => ['forming', 'confirmed', 'draft'].includes(item.occurrence.state)).map(item => <label className={styles.notice} key={item.occurrence.occurrence_id}><input type="checkbox" name="occurrence_id" value={item.occurrence.occurrence_id} /><SessionTime start={item.occurrence.start_at} end={item.occurrence.end_at} /> · {item.occurrence.tutor.display_name}</label>)}</fieldset></IdentityForm></details><Select name="series" label={copyUi.series} value={seriesId} onChange={setSeriesId}><option value="">{copyUi.selectSeries}</option>{series.items?.map(item => <option key={item.series_id} value={item.series_id}>{item.title}</option>)}</Select><PaymentReadState pending={!series.items} {...series} />{seriesId && <SeriesEditor key={seriesId} seriesId={seriesId} onSaved={id => router.push(`/admin/teaching?change_set=${id}`)} />}{initialChangeSet && <ChangeSet key={initialChangeSet} id={initialChangeSet} />}</section>;
}
function SeriesEditor({ seriesId, onSaved }: { seriesId: string; onSaved: (id: string) => void }) {
  const copyUi = useStaffCopy(copy);

  const members = usePaymentList<OccurrenceSeries['items'][number]>(`occurrence-series/${seriesId}`), [selected, setSelected] = useState<string[]>([]), [mode, setMode] = useState('selected'), [cutoff, setCutoff] = useState('');
  const eligible = members.items?.filter(row => ['draft', 'forming', 'confirmed'].includes(row.state)) || [];
  const changes = mode === 'from' ? eligible.filter(row => cutoff && Date.parse(row.start_at) >= Date.parse(cutoff)) : eligible.filter(row => selected.includes(row.occurrence_id));
  return <><PaymentReadState pending={!members.items} {...members} />{members.items && <IdentityForm action={`occurrence-series/${seriesId}/changes`} submitLabel={copyUi.propose} successMessage={copyUi.proposed} resettable={false} disabled={!changes.length || changes.length > 100 || (mode === 'from' && Boolean(members.cursor))} onSaved={result => onSaved(String(result.change_set_id))} payload={form => ({ selection: mode === 'from' ? { mode: 'from', from_at: instantField(form, 'cutoff') } : { mode: 'selected', occurrence_ids: changes.map(row => row.occurrence_id) }, changes: changes.map(row => { const start_at = instantField(form, `start-${row.occurrence_id}`); return { occurrence_id: row.occurrence_id, expected_version: row.version, start_at, end_at: new Date(Date.parse(start_at) + Date.parse(row.end_at) - Date.parse(row.start_at)).toISOString() }; }), expires_at: instantField(form, 'expires_at'), reason: String(form.get('reason')).trim() })}><Select name="selection" label={copyUi.selection} value={mode} onChange={setMode}><option value="selected">{copyUi.selectedOnly}</option><option value="from">{copyUi.futureFrom}</option></Select>{mode === 'from' ? <><CairoInput name="cutoff" label={copyUi.cutoff} onChange={setCutoff} />{members.cursor && <p role="status">{copyUi.incomplete}</p>}</> : <fieldset><legend>{copyUi.selected}</legend>{eligible.map(row => <label className={styles.notice} key={row.occurrence_id}><input type="checkbox" checked={selected.includes(row.occurrence_id)} onChange={event => setSelected(items => event.target.checked ? [...items, row.occurrence_id] : items.filter(id => id !== row.occurrence_id))} /><SessionTime start={row.start_at} end={row.end_at} /></label>)}</fieldset>}{!eligible.length && <p>{copyUi.noMembers}</p>}{changes.map(row => { const local = formatCairoInstant(row.start_at); return <fieldset key={row.occurrence_id}><legend><SessionTime start={row.start_at} end={row.end_at} /></legend><CairoInput name={`start-${row.occurrence_id}`} label={copyUi.newStart} initial={`${local.local_date}T${local.local_time}`} /></fieldset>; })}<CairoInput name="expires_at" label={copyUi.expires} /><TextField name="reason" label={copyUi.reason} multiline maxLength={2000} /><p>{copyUi.max}</p></IdentityForm>}</>;
}
function ChangeSet({ id }: { id: string }) {
  const copyUi = useStaffCopy(copy);

  const data = usePaymentList<SeriesChangeSet['items'][number]>(`series-change-sets/${id}`);
  return <section className={styles.section}><h3>{copyUi.changes}</h3><p>{copyUi.pending}</p><PaymentReadState pending={!data.items} {...data} /><ul className={styles.list}>{data.items?.map(row => <li key={row.occurrence_id}><p>{row.state === 'committed' ? copyUi.changed : row.state === 'declined' || row.state === 'expired' ? row.state : copyUi.waiting}</p><Link className={formStyles.signout} href={`/admin/schedule?occurrence=${row.occurrence_id}`}>{copyUi.inspect}</Link></li>)}</ul></section>;
}
