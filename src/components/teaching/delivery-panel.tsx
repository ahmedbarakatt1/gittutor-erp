'use client';

import { useStaffCopy } from '@/components/ar-staff-label';
import { useState } from 'react';
import { LearningRecordPanel } from './learning-records';
import type { OccurrenceDelivery } from '@/modules/teaching/queries';
import { formatCairoInstant } from '@/modules/booking/scheduling';
import { scaledIntegerInput } from '@/modules/shared/format';
import { deliveryCopy as copy } from '@/locales/delivery';
import { IdentityForm, TextField } from '../identity-form';
import { CairoInput, CairoTimestamp, Check, instantField, money } from '../booking/shared';
import { AmountField, amountField, EvidenceSelect, PaymentReadState, usePaymentRecord } from '../payments/shared';
import { creditField } from '../packages/shared';
import styles from '../files/files.module.css';
import formStyles from '../auth.module.css';

function localTime(value: string | null) { if (!value) return ''; const time = formatCairoInstant(value); return `${time.local_date}T${time.local_time}`; }
function attendance(form: FormData, data: OccurrenceDelivery) {
  return data.roster.map(row => ({ enrollment_id: row.enrollment_id, attendance: String(form.get(`attendance-${row.enrollment_id}`)), attended_seconds: Number(form.get(`seconds-${row.enrollment_id}`)), reason: String(form.get(`reason-${row.enrollment_id}`) || '').trim() || null }));
}
function AttendanceFields({ data }: { data: OccurrenceDelivery }) {
  const copyUi = useStaffCopy(copy);

  return <>{data.roster.map(row => <fieldset key={row.enrollment_id}><legend>{row.learner.display_name}</legend><div className={formStyles.field}><label htmlFor={`attendance-${row.enrollment_id}`}>{copyUi.status}</label><select id={`attendance-${row.enrollment_id}`} name={`attendance-${row.enrollment_id}`} defaultValue={row.attendance} required>{Object.entries(copyUi.states).filter(([key]) => ['unmarked', 'present', 'absent', 'excused'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className={formStyles.field}><label htmlFor={`seconds-${row.enrollment_id}`}>{copyUi.seconds}</label><input id={`seconds-${row.enrollment_id}`} name={`seconds-${row.enrollment_id}`} type="number" min="0" max="86400" step="1" defaultValue={row.attended_seconds} required /></div><TextField name={`reason-${row.enrollment_id}`} label={copyUi.reason} required={false} maxLength={2000} defaultValue={row.reason || ''} /></fieldset>)}</>;
}

export function DeliveryPanel({ occurrenceId, view }: { occurrenceId: string; view: 'tutor' | 'admin' }) {
  const copyUi = useStaffCopy(copy);

  const record = usePaymentRecord<OccurrenceDelivery>(`occurrences/${occurrenceId}/delivery?view=${view}`), data = record.data;
  return <section className={styles.section} aria-label={copyUi.title}><h2>{copyUi.title}</h2><p>{copyUi.intro}</p><PaymentReadState pending={!data} {...record} />{data && <div key={`${data.version}-${data.attendance_version}-${data.completion?.version || 0}`}>
    {data.required_actions.map(action => <p key={action} className={styles.notice}>{copyUi.actions[action] || copyUi.remaining}</p>)}
    {data.actual_start_at && <p>{copyUi.startAt}: <CairoTimestamp value={data.actual_start_at} /></p>}{data.actual_end_at && <p>{copyUi.endAt}: <CairoTimestamp value={data.actual_end_at} /></p>}
    {data.can_start && <IdentityForm action={`occurrences/${occurrenceId}/start`} submitLabel={copyUi.start} successMessage={copyUi.started} onSaved={record.reload} resettable={false} payload={form => ({ actual_start_at: instantField(form, 'actual_start_at'), expected_version: data.version })}><CairoInput name="actual_start_at" label={copyUi.startAt} /></IdentityForm>}
    {data.can_record_attendance && <details><summary>{copyUi.attendance}</summary><IdentityForm action={`occurrences/${occurrenceId}/attendance`} submitLabel={copyUi.record} successMessage={copyUi.recorded} onSaved={record.reload} resettable={false} payload={form => ({ actual_start_at: instantField(form, 'actual_start_at'), actual_end_at: instantField(form, 'actual_end_at'), entries: attendance(form, data), expected_version: data.version })}><p>{copyUi.attendanceIntro}</p><CairoInput name="actual_start_at" label={copyUi.startAt} initial={localTime(data.actual_start_at)} /><CairoInput name="actual_end_at" label={copyUi.endAt} initial={localTime(data.actual_end_at)} /><AttendanceFields data={data} /></IdentityForm></details>}
    <ul className={styles.list}>{data.roster.map(row => <li key={row.enrollment_id}><strong>{row.learner.display_name}</strong><p>{copyUi.states[row.attendance]} · {row.attended_seconds} {copyUi.seconds.toLowerCase()}</p>{row.reason && <p>{row.reason}</p>}</li>)}</ul>
    {data.completion && <section><h3>{copyUi.states[data.completion.state]}</h3><p>{data.completion.topic_summary}</p><CairoTimestamp value={data.completion.approved_at || data.completion.submitted_at} /></section>}
    {view === 'admin' && data.review_context && data.attendance_version > 0 && !data.completion?.approved_at && <ReviewDelivery data={data} onSaved={record.reload} />}
    {data.can_submit && <IdentityForm action={`occurrences/${occurrenceId}/completion`} submitLabel={copyUi.submit} successMessage={copyUi.submitted} onSaved={record.reload} resettable={false} payload={form => ({ attendance_version: data.attendance_version, topic_summary: String(form.get('topic_summary')).trim(), delivery_exception_ids: form.getAll('delivery_exception_id'), expected_version: data.version })}><TextField name="topic_summary" label={copyUi.topic} multiline maxLength={5000} /><h3>{copyUi.exceptions}</h3>{data.delivery_exceptions.length ? data.delivery_exceptions.map(item => <label key={item.delivery_exception_id} className={styles.notice}><input type="checkbox" name="delivery_exception_id" value={item.delivery_exception_id} />{copyUi.includeDecision}: {item.reason}</label>) : <p>{copyUi.noExceptions}</p>}</IdentityForm>}
    {view === 'admin' && data.can_approve && data.completion && <IdentityForm action={`occurrences/${occurrenceId}/completion/approve`} submitLabel={copyUi.approve} successMessage={copyUi.approved} onSaved={record.reload} resettable={false} payload={() => ({ completion_version: data.completion!.version, approved_remedy_ids: data.approved_remedy_ids, expected_version: data.version })}><Check name="reviewed" label={copyUi.approvalConfirm} /></IdentityForm>}
    {data.earning && <aside className={styles.notice}><h3>{copyUi.earning}</h3><p>{copyUi.privateNotice}</p><strong>{money(data.earning.amount_minor, data.earning.currency)}</strong><p><CairoTimestamp value={data.earning.posted_at} /></p></aside>}
    {view === 'admin' && data.can_amend && data.completion && <AmendDelivery data={data} onSaved={record.reload} />}
    {data.state === 'completed' && <LearningRecordPanel occurrenceId={occurrenceId} view={view} />}
  </div>}</section>;
}

function ReviewDelivery({ data, onSaved }: { data: OccurrenceDelivery; onSaved: () => void }) {
  const copyUi = useStaffCopy(copy);

  const [evidence, setEvidence] = useState(''), context = data.review_context!;
  return <details><summary>{copyUi.review}</summary><IdentityForm action={`occurrences/${data.occurrence_id}/delivery-review`} submitLabel={copyUi.saveReview} successMessage={copyUi.reviewed} onSaved={onSaved} resettable={false} disabled={!evidence} payload={form => ({ attendance_version: data.attendance_version, tutor_fee_minor: amountField(form, 'tutor_fee', { allowZero: true }), enrollment_outcomes: context.enrollments.map(row => ({ enrollment_id: row.enrollment_id, retained_charge_minor: amountField(form, `retained-${row.enrollment_id}`, { allowZero: true }), consume_credit_quanta: creditField(form, `consumed-${row.enrollment_id}`), remedy_mode: String(form.get(`remedy-${row.enrollment_id}`)) })), reason: String(form.get('reason')).trim(), evidence_file_id: evidence, expected_version: data.version })}><p>{copyUi.reviewIntro}</p><p>{copyUi.privateNotice}</p><AmountField name="tutor_fee" label={copyUi.tutorFee} value={context.agreed_tutor_fee_minor} allowZero />{context.enrollments.map(row => <fieldset key={row.enrollment_id}><legend>{data.roster.find(learner => learner.enrollment_id === row.enrollment_id)?.learner.display_name}</legend><AmountField name={`retained-${row.enrollment_id}`} label={copyUi.retained} value={row.commercial_net_minor} allowZero /><div className={formStyles.field}><label htmlFor={`consumed-${row.enrollment_id}`}>{copyUi.consumed}</label><input id={`consumed-${row.enrollment_id}`} name={`consumed-${row.enrollment_id}`} type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" defaultValue={scaledIntegerInput(row.reserved_credit_quanta, 3)} required /></div><div className={formStyles.field}><label htmlFor={`remedy-${row.enrollment_id}`}>{copyUi.remedy}</label><select id={`remedy-${row.enrollment_id}`} name={`remedy-${row.enrollment_id}`} required defaultValue=""><option value="">—</option>{Object.entries(copyUi.remedies).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></fieldset>)}<TextField name="reason" label={copyUi.reviewReason} multiline maxLength={2000} /><EvidenceSelect action="review_delivery_exception" targetId={data.occurrence_id} value={evidence} onChange={setEvidence} label={copyUi.reviewEvidence} /></IdentityForm></details>;
}
function AmendDelivery({ data, onSaved }: { data: OccurrenceDelivery; onSaved: () => void }) {
  const copyUi = useStaffCopy(copy);

  const [evidence, setEvidence] = useState('');
  return <details><summary>{copyUi.amend}</summary><IdentityForm action={`completions/${data.completion!.completion_id}/amend`} submitLabel={copyUi.amend} successMessage={copyUi.corrected} onSaved={onSaved} disabled={!evidence} resettable={false} payload={form => ({ corrected_facts: { actual_start_at: instantField(form, 'actual_start_at'), actual_end_at: instantField(form, 'actual_end_at'), topic_summary: String(form.get('topic_summary')).trim(), attendance_corrections: attendance(form, data) }, evidence_file_id: evidence, reason: String(form.get('reason')).trim(), expected_version: data.completion!.version })}><p>{copyUi.amendIntro}</p><CairoInput name="actual_start_at" label={copyUi.startAt} initial={localTime(data.actual_start_at)} /><CairoInput name="actual_end_at" label={copyUi.endAt} initial={localTime(data.actual_end_at)} /><TextField name="topic_summary" label={copyUi.correctedTopic} defaultValue={data.completion!.topic_summary} multiline maxLength={5000} /><AttendanceFields data={data} /><TextField name="reason" label={copyUi.correctionReason} multiline maxLength={2000} /><EvidenceSelect action="amend_completion" targetId={data.completion!.completion_id} value={evidence} onChange={setEvidence} label={copyUi.correctionEvidence} /></IdentityForm></details>;
}
