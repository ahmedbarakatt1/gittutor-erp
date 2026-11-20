'use client';

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { workflowOperationsSchema, type WorkflowOperationsData, type WorkflowOperationsRecord, type WorkflowOperationsSection } from '@/modules/workflow-import/operational-model';
import { formatFinanceAmount } from '@/modules/shared/format';
import { IdentityForm, TextField } from '../identity-form';
import { usePaymentRecord } from '../payments/shared';
import { workbookCharts, workbookDateTime } from './record-insights';
import { WorkbookCharts, type ChartSelection } from './workbook-charts';
import styles from './operational-workspaces.module.css';

type EnabledData = Extract<WorkflowOperationsData, { enabled: true }>;
type View = WorkflowOperationsSection['key'];
type Field = WorkflowOperationsRecord['fields'][number];

export const OperationalWorkspace = WorkflowOperationsWorkspace;

/** Imported facts are read through the same current-role boundary as their workspace. */
export function WorkflowOperationsWorkspace({ view, children, collapsed = false, initialData, overviewAction }: {
  view: View; children?: ReactNode; collapsed?: boolean; initialData?: EnabledData; overviewAction?: ReactNode;
}) {
  const [refreshRequested, setRefreshRequested] = useState(false);
  const useInitialRead = initialData !== undefined && !refreshRequested;
  const record = usePaymentRecord<unknown>(useInitialRead ? null : 'workflow-operations');
  const response = useInitialRead ? initialData : record.data;
  const parsed = useMemo(() => response === undefined ? null : workflowOperationsSchema.safeParse(response), [response]);
  const data = parsed?.success && parsed.data.enabled ? parsed.data : null;
  const section = data?.sections.find(item => item.key === view);
  const invalid = parsed && !parsed.success;
  function reload() {
    if (useInitialRead) setRefreshRequested(true);
    else record.reload();
  }
  const history = section && data ? <WorkflowSection key={view} section={section} data={data} onSaved={reload} hasWorkflow={Boolean(children)} overviewAction={overviewAction} /> : null;
  return <>{!history && overviewAction && <div className={styles.tools}>{overviewAction}</div>}
    {record.error || invalid ? <div className={styles.notice} role="alert"><p>Workbook records could not be loaded.</p><button className={styles.button} type="button" onClick={reload}>Try again</button></div> : history ? collapsed ? <details className={styles.history}><summary>Workbook history</summary>{history}</details> : history : response === undefined ? <p className={styles.empty} role="status">Loading your records…</p> : null}
    {/* Keep the workflow subtree mounted when the independent history read changes state. */}
    {children && <section className={section ? styles.newActivity : undefined} id="new-activity">{section && <header><h2>{view === 'finance' ? 'Verified financial activity' : 'New activity and current workflows'}</h2><p className={styles.description}>Imported history stays separate from activity recorded here.</p></header>}{children}</section>}
  </>;
}

const overviewLabels: Record<string, string> = {
  source_sessions: 'Sessions', scheduled_sessions: 'Scheduled', completed_sessions: 'Completed',
  source_packages: 'Packages', source_students: 'Learners', source_tutors: 'Tutors',
};

function WorkflowSection({ section, data, onSaved, hasWorkflow, overviewAction }: { section: WorkflowOperationsSection; data: EnabledData; onSaved: () => void; hasWorkflow: boolean; overviewAction?: ReactNode }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [table, setTable] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ChartSelection | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const registrySummary = useRef<HTMLElement>(null);
  const id = useId();
  const charts = useMemo(() => workbookCharts(section.key, section.records), [section]);
  const chart = charts.find(item => item.key === selected?.chart);
  const group = chart?.groups.find(item => item.key === selected?.group);
  const groupIds = useMemo(() => group ? new Set(group.ids) : null, [group]);
  const statuses = [...new Set(section.records.flatMap(row => row.reported_status ? [row.reported_status] : []))].sort();
  const tables = [...new Set(section.records.map(row => row.source_table))].sort();
  const normalized = query.trim().toLocaleLowerCase();
  const advancedFilterCount = Number(Boolean(table)) + Number(Boolean(status)) + Number(reviewOnly);
  const filtered = Boolean(normalized || status || table || reviewOnly || group);
  const rows = section.records.filter(row =>
    (!groupIds || groupIds.has(row.id)) && (!table || row.source_table === table) &&
    (!status || row.reported_status === status) && (!reviewOnly || row.review.state === 'needs_review') &&
    (!normalized || [row.title, row.subtitle, row.date, row.source_table, row.source_row, row.reported_status, ...row.fields.map(field => field.value)].join(' ').toLocaleLowerCase().includes(normalized))
  ).sort((left, right) => (workbookDateTime(right.date) ?? -Infinity) - (workbookDateTime(left.date) ?? -Infinity) || left.source_row - right.source_row || left.source_table.localeCompare(right.source_table) || left.id.localeCompare(right.id));
  const pageSize = section.key === 'overview' ? 4 : 8;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function resetFilters() {
    setSelected(null); setQuery(''); setStatus(''); setTable(''); setReviewOnly(false); setPage(0);
  }
  function openRegister() {
    setRegisterOpen(true);
    requestAnimationFrame(() => registrySummary.current?.focus());
  }
  function drillDown(next: ChartSelection) {
    resetFilters();
    if (next.chart !== selected?.chart || next.group !== selected.group) setSelected(next);
    openRegister();
  }
  const summaryMetrics = section.metrics.filter(metric => metric.key !== 'source_records');
  const metrics = <dl className={styles.metrics} aria-label={overviewAction ? 'Workbook figures' : undefined}>{summaryMetrics.map(metric => <div key={metric.key}>
    <dt>{overviewAction ? overviewLabels[metric.key] ?? metric.label : metric.label}</dt>
    <dd>{metric.value === null ? 'Not recorded' : metric.unit === 'money' ? formatFinanceAmount(metric.value) : metric.value.toLocaleString('en-GB') + (metric.unit === 'hours' ? ' h' : '')}</dd>
  </div>)}</dl>;
  return <section className={styles.workspace} aria-label={section.title} data-workflow-view={section.key} data-workflow-operations>
    {overviewAction ? <header className={styles.overviewToolbar}>
      <h2 className={styles.visuallyHidden}>Workbook overview</h2>
      {overviewAction}
      <button type="button" onClick={openRegister} aria-controls={id + '-register'}>Browse records</button>
      <button type="button" className={styles.refresh} onClick={onSaved} title="Refresh records">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></svg>
        <span>Refresh records</span>
      </button>
    </header> : <header className={styles.header}>
      <div><h2>{section.key === 'overview' ? 'Workbook overview' : section.title}</h2>
        <p className={styles.description}>Payments and completions are reported by the workbook.{charts.length > 0 && ' Select a chart value to see its source records.'}</p></div>
      <div className={styles.tools}>{hasWorkflow && <a href="#new-activity">Current workflow</a>}
        {section.key === 'overview' && <button className={styles.button} type="button" onClick={openRegister} aria-controls={id + '-register'}>Browse records</button>}
        <button className={styles.button} type="button" onClick={onSaved}>Refresh records</button></div>
    </header>}
    {summaryMetrics.length > 0 && (section.key === 'finance' ? <details className={styles.balanceFigures}><summary>Reported balance figures <span>{summaryMetrics.length}</span></summary>{metrics}</details> : metrics)}
    <WorkbookCharts charts={charts} selected={selected} onSelect={drillDown} recordsId={id + '-register'} compactOverview={Boolean(overviewAction)} />
    <details id={id + '-register'} className={styles.register} open={registerOpen} onToggle={event => setRegisterOpen(event.currentTarget.open)}>
      <summary ref={registrySummary}><span className={styles.chevron} aria-hidden="true" /><span>Source records</span><span className={styles.recordCount} aria-live="polite">{filtered ? rows.length + ' of ' : ''}{section.records.length}</span></summary>
      {(!overviewAction || registerOpen) && <div className={styles.registerBody}>
        {section.records.length > 0 && <div className={styles.filters} data-compact-filters={overviewAction ? true : undefined}>
          <label className={styles.search}>Search records<input type="search" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Name, course or reference" /></label>
          {overviewAction && <button className={styles.button} type="button" aria-expanded={filtersOpen} aria-controls={id + '-filters'} onClick={() => setFiltersOpen(!filtersOpen)}>Filters{advancedFilterCount > 0 && ' (' + advancedFilterCount + ')'}</button>}
          <div id={id + '-filters'} className={overviewAction ? styles.advancedFilters : styles.inlineFilters} hidden={Boolean(overviewAction) && !filtersOpen}>
          {tables.length > 1 && <label><span id={id + '-source-label'}>Source</span><select aria-labelledby={id + '-source-label'} value={table} onChange={event => { setTable(event.target.value); setPage(0); }}><option value="">All sources</option>{tables.map(value => <option key={value} value={value}>{tableLabels[value]}</option>)}</select></label>}
          {statuses.length > 0 && <label><span id={id + '-status-label'}>Reported status</span><select aria-labelledby={id + '-status-label'} value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
          <label className={styles.check}><input type="checkbox" checked={reviewOnly} onChange={event => { setReviewOnly(event.target.checked); setPage(0); }} />Needs mapping review</label>
          </div>
        </div>}
        {filtered && <div className={styles.activeFilter}><span role="status">{group && chart ? chart.title + ' · ' + group.label + ' · ' : ''}{rows.length} matching {rows.length === 1 ? 'record' : 'records'}</span><button type="button" onClick={resetFilters}>Clear filters</button></div>}
        {visible.length ? <ul className={styles.records}>{visible.map(row => <li key={row.id + '-' + row.review.version}>
          <WorkflowRow row={row} view={section.key} data={data} onSaved={onSaved} groupName={id + '-row'} />
        </li>)}</ul> : <p className={styles.empty}>{section.records.length ? 'No records match these filters.' : 'No workbook records are available for this view.'}</p>}
        {pageCount > 1 && <nav className={styles.pagination} aria-label={section.title + ' pages'}><button className={styles.button} type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span aria-live="polite">Page {currentPage + 1} of {pageCount}</span><button className={styles.button} type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
      </div>}
    </details>
  </section>;
}

const tableLabels: Record<WorkflowOperationsRecord['source_table'], string> = {
  sessions: 'Sessions', packages: 'Packages', students: 'Students', tutors: 'Tutors', marketing: 'Marketing', distributions: 'Distributions', balances: 'Balances',
};

const summaryFieldKeys: Partial<Record<View, string[]>> = {
  payments: ['student_balance_minor'], tutor_pay: ['tutor_fee_balance_minor'], packages: ['sessions_remaining'],
  finance: ['amount_minor', 'count'], campaigns: ['amount_minor'],
};

function WorkflowRow({ row, view, data, onSaved, groupName }: { row: WorkflowOperationsRecord; view: View; data: EnabledData; onSaved: () => void; groupName: string }) {
  const fields = view === 'payments' || view === 'tutor_pay' ? [...row.fields].sort((left, right) => Number(right.type === 'money') - Number(left.type === 'money')) : row.fields;
  const summaryFields = fields.filter(field => summaryFieldKeys[view]?.includes(field.key));
  const highlight = summaryFields.find(field => field.value !== null) ?? summaryFields[0];
  return <details name={groupName} className={styles.record}>
    <summary>
      <span className={styles.rowIdentity}><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}{highlight && row.reported_status && <small>{row.reported_status} · reported</small>}</span>
      <span className={styles.rowStatus}>{highlight ? <><small>{highlight.label}</small><b>{formatValue(highlight)}</b></> : row.reported_status ? row.reported_status + ' · reported' : tableLabels[row.source_table]}</span>
      <span className={styles.rowDate}>{row.date ? formatValue({ key: 'date', label: 'Date', type: 'date', value: row.date }) : 'Undated'}</span>
      <span className={styles.chevron} aria-hidden="true" />
    </summary>
    <div className={styles.recordDetail}>
      <p className={styles.source}>{tableLabels[row.source_table]} · row {row.source_row} · {row.review.state === 'needs_review' ? 'Needs mapping review' : row.review.state === 'linked' ? 'Linked record' : 'Mapping reviewed'}</p>
      {row.actions.length > 0 && <div className={styles.actions}>{row.actions.map(action => <Link key={action.label + '-' + action.href} href={action.href}>{action.label}</Link>)}</div>}
      {fields.length > 0 && <Fields fields={fields} />}
      {row.issues.length > 0 && <details className={styles.details}><summary>Source issues ({row.issues.length})</summary><ul>{row.issues.map((issue, index) => <li key={issue + '-' + index}>{issue.replaceAll('_', ' ').replaceAll(':', ' · ')}</li>)}</ul></details>}
      {row.review.can_review && data.role === 'owner' && <MappingReview row={row} options={data.mapping_options} onSaved={onSaved} />}
    </div>
  </details>;
}

function Fields({ fields }: { fields: Field[] }) { return <dl className={styles.fields}>{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(field)}</dd></div>)}</dl>; }
function formatValue(field: Field) {
  if (field.value === null) return 'Not recorded';
  if (field.type === 'money' && typeof field.value === 'number') return formatFinanceAmount(field.value);
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (field.type === 'date' && typeof field.value === 'string') {
    const date = workbookDateTime(field.value);
    if (date === null) return field.value + ' (invalid date)';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }).format(date);
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
