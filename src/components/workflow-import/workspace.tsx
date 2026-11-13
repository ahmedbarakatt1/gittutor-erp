'use client';

import { useEffect, useMemo, useState } from 'react';
import { workflowImportSchema, type WorkflowImport } from '@/modules/workflow-import/queries';
import type { WorkflowTable } from '@/modules/workflow-import/model';
import styles from './workspace.module.css';

const tabs: { id: WorkflowTable; label: string }[] = [
  { id: 'sessions', label: 'Sessions' }, { id: 'packages', label: 'Packages' },
  { id: 'students', label: 'Students' }, { id: 'tutors', label: 'Tutors' },
  { id: 'marketing', label: 'Marketing' }, { id: 'distributions', label: 'Distributions' }, { id: 'balances', label: 'Balances' },
];
const visible: Record<WorkflowTable, string[]> = {
  sessions: ['col_a', 'col_c', 'col_e', 'col_f', 'col_h', 'col_i'],
  packages: ['col_a', 'col_b', 'col_d', 'col_e', 'col_r', 'col_w'],
  students: ['col_a', 'col_b', 'col_d', 'col_e'], tutors: ['col_a', 'col_b', 'col_c'],
  marketing: ['col_a', 'col_b', 'col_c', 'col_d', 'col_e'], distributions: ['col_a', 'col_b', 'col_c', 'col_d'],
  balances: ['label', 'reported_amount_minor', 'reported_count'],
};
const statusColumn: Partial<Record<WorkflowTable, string>> = { sessions: 'col_i', packages: 'col_d', marketing: 'col_e' };
const money = new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 });
function display(value: string | number | boolean | null | undefined, kind: string, label = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') return money.format(value / 100);
  if (kind === 'number' && typeof value === 'number' && /percentage|%/i.test(label)) return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 }).format(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function issueText(issue: string, columns: { key: string; label: string }[]) {
  const [code, ...parts] = issue.split(':');
  const field = columns.find(column => column.key === parts.at(-1))?.label;
  const reasons: Record<string, string> = {
    missing_date: 'The date is missing.', missing_course: 'The course is missing.',
    missing_start_time: 'The start time is missing.', missing_end_time: 'The end time is missing.',
    ambiguous_person: 'This label does not identify a single student. Confirm the learner or group members.',
    invalid_session_interval: 'The end time is not later than the start time. Confirm the session interval.',
    formula_cache_missing: 'The workbook has no saved result for this formula.', source_error: 'The workbook contains an error in this field.',
  };
  return `${field ? `${field}: ` : ''}${reasons[code] || code.replaceAll('_', ' ')}`;
}

export function WorkflowWorkspace() {
  const [data, setData] = useState<WorkflowImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<WorkflowTable>('sessions');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/workflow-import', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Your records could not be loaded.');
      setData(body.data === null ? null : workflowImportSchema.parse(body.data)); setError('');
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your records could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const table = data?.snapshot.tables[tab];
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const filtered = (table?.rows ?? []).filter(row => (!search || Object.values(row.values).some(value => value !== null && String(value).toLocaleLowerCase().includes(search)))
      && (!status || String(row.values[statusColumn[tab] || '']) === status) && (!issuesOnly || row.issues.length > 0));
    return tab === 'sessions' ? filtered.sort((a, b) => String(b.values.col_a || '').localeCompare(String(a.values.col_a || '')) || b.source_row - a.source_row) : filtered;
  }, [table, query, status, issuesOnly, tab]);
  const columns = table?.columns.filter(column => visible[tab].includes(column.key)) ?? [];
  const chosen = table?.rows.find(row => row.source_row === selected);
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const statuses = Array.from(new Set((table?.rows ?? []).map(row => row.values[statusColumn[tab] || '']).filter(value => typeof value === 'string' && value))).sort();
  if (loading) return <p role="status">Loading your actual records…</p>;
  if (error) return <div role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setRevision(revision + 1); }}>Try again</button></div>;
  if (!data || !table) return <section className={styles.notice}><h2>No workbook linked to this account</h2><p>Sign in with your private records account to see the imported workbook. Demonstration accounts do not have access to real records.</p></section>;
  const issueCount = Object.values(data.snapshot.tables).reduce((sum, value) => sum + value.rows.filter(row => row.issues.length > 0).length, 0);
  return <div className={styles.workspace}>
    <section className={styles.notice} aria-label="Source of these records">
      <strong>{data.snapshot.source_name}</strong>
      <p>Imported {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(data.imported_at))} · Cairo time · Private to your records account</p>
      <p>These are the workbook&apos;s reported figures. Paid and completed labels preserve its history; importing them does not verify settlement or create new financial postings.</p>
    </section>
    <dl className={styles.metrics}>
      <div><dt>Session records</dt><dd>{data.snapshot.tables.sessions.rows.length}</dd></div>
      <div><dt>Packages</dt><dd>{data.snapshot.tables.packages.rows.length}</dd></div>
      <div><dt>Student profiles</dt><dd>{data.snapshot.tables.students.rows.length}</dd></div>
      <div><dt>Records to review</dt><dd>{issueCount}</dd></div>
    </dl>
    <nav className={styles.tabs} aria-label="Workbook sections">{tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setQuery(''); setStatus(''); setIssuesOnly(false); setPage(0); setSelected(null); }}>{item.label}<span>{data.snapshot.tables[item.id].rows.length}</span></button>)}</nav>
    <section aria-labelledby="records-heading" className={styles.records}>
      <div className={styles.heading}><h2 id="records-heading">{tabs.find(item => item.id === tab)?.label}</h2><p>{rows.length} matching records</p></div>
      <div className={styles.filters}>
        <label>Search this section<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Name, course or reference" /></label>
        {statusColumn[tab] && <label>Reported status<select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option>{statuses.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select></label>}
        <label className={styles.checkbox}><input type="checkbox" checked={issuesOnly} onChange={event => { setIssuesOnly(event.target.checked); setPage(0); }} />Needs review only</label>
      </div>
      {rows.length ? <div className={styles.tableScroll} role="region" aria-label={`${tab} records`} tabIndex={0}><table><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}<th scope="col">Details</th></tr></thead>
        <tbody>{rows.slice(currentPage * 12, (currentPage + 1) * 12).map(row => <tr key={row.source_row}>{columns.map(column => <td key={column.key}>{display(row.values[column.key], column.type, column.label)}</td>)}<td><button type="button" aria-expanded={selected === row.source_row} onClick={() => setSelected(selected === row.source_row ? null : row.source_row)}>Row {row.source_row}{row.issues.length > 0 && <span className={styles.reviewFlag}>Review</span>}</button></td></tr>)}</tbody></table></div> : <p className={styles.empty}>No records match these filters.</p>}
      <div className={styles.pagination}><button disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelected(null); }}>Previous</button><span aria-live="polite">Page {currentPage + 1} of {pages}</span><button disabled={currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setSelected(null); }}>Next</button></div>
    </section>
    {chosen && <section className={styles.detail} aria-labelledby="row-heading"><div className={styles.heading}><h2 id="row-heading">Source row {chosen.source_row}</h2><button onClick={() => setSelected(null)}>Close details</button></div>
      {chosen.issues.length > 0 && <div className={styles.review}><h3>Check this record</h3><ul>{chosen.issues.map((issue, index) => <li key={index}>{issueText(issue, table.columns)}</li>)}</ul></div>}
      <dl className={styles.details}>{table.columns.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{display(chosen.values[column.key], column.type, column.label)}</dd></div>)}</dl>
    </section>}
  </div>;
}
