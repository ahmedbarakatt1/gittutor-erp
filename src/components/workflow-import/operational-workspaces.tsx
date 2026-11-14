'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { workflowOperationsSchema, type WorkflowOperationsData, type WorkflowOperationsRecord, type WorkflowOperationsSection } from '@/modules/workflow-import/operational-model';
import { formatFinanceAmount } from '@/modules/shared/format';
import { IdentityForm, TextField } from '../identity-form';
import { usePaymentRecord } from '../payments/shared';
import styles from './operational-workspaces.module.css';

type EnabledData = Extract<WorkflowOperationsData, { enabled: true }>;
type View = WorkflowOperationsSection['key'];
type Field = WorkflowOperationsRecord['fields'][number];

export const OperationalWorkspace = WorkflowOperationsWorkspace;

/** Imported facts are read through the same current-role boundary as their workspace. */
export function WorkflowOperationsWorkspace({ view, children, collapsed = false }: { view: View; children?: ReactNode; collapsed?: boolean }) {
  const record = usePaymentRecord<unknown>('workflow-operations');
  const parsed = record.data === undefined ? null : workflowOperationsSchema.safeParse(record.data);
  const data = parsed?.success && parsed.data.enabled ? parsed.data : null;
  const section = data?.sections.find(item => item.key === view);
  const invalid = parsed && !parsed.success;
  const history = section && data ? <WorkflowSection key={view} section={section} data={data} onSaved={record.reload} /> : null;
  return <>{record.error || invalid ? <div className={styles.notice} role="alert"><p>Workbook records could not be loaded.</p><button className={styles.button} type="button" onClick={record.reload}>Try again</button></div> : history ? collapsed ? <details className={styles.history}><summary>Workbook history</summary>{history}</details> : history : record.data === undefined ? <p className={styles.empty} role="status">Loading your records…</p> : null}
    {/* Keep the workflow subtree mounted when the independent history read changes state. */}
    {children && <section className={section ? styles.newActivity : undefined} id="new-activity">{section && <header><h2>{view === 'finance' ? 'Verified financial activity' : 'New activity and current workflows'}</h2><p className={styles.description}>{view === 'finance' ? 'Posted transactions and reconciled balances are shown separately from workbook reports.' : 'Continue with the linked people and the usual booking, review and delivery controls.'}</p><p className={styles.description}>Imported history stays separate from activity recorded here.</p></header>}{children}</section>}
  </>;
}

function WorkflowSection({ section, data, onSaved }: { section: WorkflowOperationsSection; data: EnabledData; onSaved: () => void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [reviewOnly, setReviewOnly] = useState(false), [page, setPage] = useState(0);
  const id = useId(), statuses = [...new Set(section.records.flatMap(row => row.reported_status ? [row.reported_status] : []))].sort();
  const normalized = query.trim().toLocaleLowerCase();
  const rows = section.records.filter(row => (!status || row.reported_status === status) && (!reviewOnly || row.review.state === 'needs_review') && (!normalized || [row.title, row.subtitle, row.date, row.reported_status, ...row.fields.map(field => field.value)].join(' ').toLocaleLowerCase().includes(normalized))).sort((left, right) => sourceTime(right.date) - sourceTime(left.date) || left.source_row - right.source_row || left.source_table.localeCompare(right.source_table) || left.id.localeCompare(right.id));
  const pageSize = section.key === 'overview' ? 4 : 8, pageCount = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pageCount - 1), visible = rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  return <section className={styles.workspace} aria-label={section.title} data-workflow-view={section.key} data-workflow-operations>
    <header className={styles.header}><div><h2>{section.key === 'overview' ? 'At a glance' : section.title}</h2></div><button className={styles.button} type="button" onClick={onSaved}>Refresh records</button></header>
    <p className={styles.notice}>These figures come from your workbook. Historical payments and completed lessons await independent verification; new activity is recorded separately.</p>
    {section.metrics.length > 0 && <dl className={styles.metrics}>{section.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.value === null ? 'Not recorded' : metric.unit === 'money' ? formatFinanceAmount(metric.value) : `${metric.value.toLocaleString('en-GB')}${metric.unit === 'hours' ? ' h' : ''}`}</dd></div>)}</dl>}
    {section.records.length > 0 && <div className={styles.filters}><label className={styles.search} htmlFor={`${id}-search`}>Search records<input id={`${id}-search`} type="search" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Name, course or reference" /></label>{statuses.length > 0 && <label htmlFor={`${id}-status`}>Reported status<select id={`${id}-status`} value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}<label htmlFor={`${id}-review`}>Review filter<select id={`${id}-review`} value={reviewOnly ? 'review' : 'all'} onChange={event => { setReviewOnly(event.target.value === 'review'); setPage(0); }}><option value="all">All records</option><option value="review">Needs mapping review</option></select></label></div>}
    <p className={styles.source}>{rows.length} {rows.length === 1 ? 'record' : 'records'}{normalized || status || reviewOnly ? ` matching your filters · ${section.records.length} total` : ''}{section.metrics.length > 0 ? ' · Totals cover the full view' : ''}</p>
    {visible.length ? <ul className={styles.records}>{visible.map(row => <li key={`${row.id}-${row.review.version}`} className={styles.card}><WorkflowCard row={row} view={section.key} data={data} onSaved={onSaved} /></li>)}</ul> : <p className={styles.empty}>{section.records.length ? 'No records match these filters.' : 'No workbook records are available for this view.'}</p>}
    {pageCount > 1 && <nav className={styles.pagination} aria-label={`${section.title} pages`}><button className={styles.button} type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className={styles.button} type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
  </section>;
}

function sourceTime(value: string | null) { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : -Infinity; }

function WorkflowCard({ row, view, data, onSaved }: { row: WorkflowOperationsRecord; view: View; data: EnabledData; onSaved: () => void }) {
  const fields = view === 'payments' || view === 'tutor_pay' ? [...row.fields].sort((left, right) => Number(right.type === 'money') - Number(left.type === 'money')) : row.fields;
  const primaryCount = view === 'overview' ? 2 : 6, primaryFields = fields.slice(0, primaryCount), remainingFields = fields.slice(primaryCount);
  return <><header><h3>{row.title}</h3>{row.subtitle && <p className={styles.subtitle}>{row.subtitle}</p>}</header><div className={styles.badges}>{row.reported_status && <span className={styles.badge}>{row.reported_status} · reported</span>}<span className={styles.badge}>{row.review.state === 'needs_review' ? 'Needs mapping review' : row.review.state === 'linked' ? 'Linked record' : 'Mapping reviewed'}</span>{row.date && <span className={styles.badge}>{formatValue({ key: 'date', label: 'Date', type: 'date', value: row.date })}</span>}</div>
    {primaryFields.length > 0 && <Fields fields={primaryFields} />}
    {row.actions.length > 0 && <div className={styles.actions}>{row.actions.map(action => <Link key={`${action.label}-${action.href}`} href={action.href}>{action.label}</Link>)}</div>}
    {(remainingFields.length > 0 || row.issues.length > 0) && <details className={styles.details}><summary>Details{row.issues.length > 0 ? ` and ${row.issues.length} source ${row.issues.length === 1 ? 'issue' : 'issues'}` : ''}</summary>{remainingFields.length > 0 && <Fields fields={remainingFields} />}{row.issues.length > 0 && <ul>{row.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue.replaceAll('_', ' ').replaceAll(':', ' · ')}</li>)}</ul>}</details>}
    {row.review.can_review && data.role === 'owner' && <MappingReview row={row} options={data.mapping_options} onSaved={onSaved} />}
    <p className={styles.source}>Source: {row.source_table} · row {row.source_row}</p>
  </>;
}

function Fields({ fields }: { fields: Field[] }) { return <dl className={styles.fields}>{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(field)}</dd></div>)}</dl>; }
function formatValue(field: Field) {
  if (field.value === null) return 'Not recorded';
  if (field.type === 'money' && typeof field.value === 'number') return formatFinanceAmount(field.value);
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (field.type === 'date' && typeof field.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(field.value)) {
    const date = new Date(`${field.value}T12:00:00Z`);
    if (Number.isFinite(date.getTime())) return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }).format(date);
  }
  return String(field.value);
}

function MappingReview({ row, options, onSaved }: { row: WorkflowOperationsRecord; options: EnabledData['mapping_options']; onSaved: () => void }) {
  const [learner, setLearner] = useState(row.links.learner_id || ''), [tutor, setTutor] = useState(row.links.tutor_id || ''), id = useId();
  const showLearner = ['sessions', 'packages', 'students'].includes(row.source_table), showTutor = ['sessions', 'tutors'].includes(row.source_table);
  return <details className={styles.details}><summary>Review record links</summary><p className={styles.description}>Confirm the people linked to this source row. Payment and delivery figures remain reported after this review.</p><IdentityForm action="workflow-operations" payload={form => ({ link_id: row.id, expected_version: row.review.version, review_state: 'reviewed', links: { ...(showLearner ? { learner_id: learner || null } : {}), ...(showTutor ? { tutor_id: tutor || null } : {}) }, reason: String(form.get('reason')).trim() })} submitLabel="Save mapping review" successMessage="Mapping review saved. Historical financial and delivery claims remain reported." resettable={false} onSaved={onSaved}>
    {showLearner && <div className={styles.filters}><label htmlFor={`${id}-learner`}>Linked learner<select id={`${id}-learner`} value={learner} onChange={event => setLearner(event.target.value)}><option value="">Unresolved learner</option>{options.learners.map(option => <option key={option.id} value={option.id}>{option.display_name}</option>)}</select></label></div>}
    {showTutor && <div className={styles.filters}><label htmlFor={`${id}-tutor`}>Linked tutor<select id={`${id}-tutor`} value={tutor} onChange={event => setTutor(event.target.value)}><option value="">Unresolved tutor</option>{options.tutors.map(option => <option key={option.id} value={option.id}>{option.display_name}</option>)}</select></label></div>}
    <TextField name="reason" label="Review evidence and reason" maxLength={2000} multiline />
  </IdentityForm></details>;
}
