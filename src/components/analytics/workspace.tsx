'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import type { AnalyticsInquiry, Campaign, CohortReport, WorkloadReport } from '@/modules/analytics/queries';
import { cairoDate } from '@/modules/shared/primitives';
import { IdentityForm, TextField, uuidPattern } from '../identity-form';
import { EvidenceSelect, PaymentReadState, usePaymentList, usePaymentRecord } from '../payments/shared';
import { CairoTimestamp, money } from '../booking/shared';
import { useHydrated } from '../use-hydrated';
import { CohortCharts, WorkloadCharts, duration } from './report-charts';
import styles from '../files/files.module.css';
import forms from '../auth.module.css';
import ui from './workspace.module.css';

type Range = { from: string; to: string; as_of: string; observation_days: string; campaign_id: string; source: string; format: string };
type View = 'campaigns' | 'students' | 'team';
const views = { campaigns: 'Campaigns', students: 'Student progression', team: 'Team workload' } as const;
function Select({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) { const id = useId(); return <div className={forms.field}><label htmlFor={id}>{label}</label><select id={id} name={name}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
const label = (value: string) => value.replaceAll('_', ' ');
const field = (form: FormData, name: string) => String(form.get(name) || '').trim();

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [visited, setVisited] = useState(false);
  return <details className={ui.disclosure} onToggle={event => { if (event.currentTarget.open) setVisited(true); }}>
    <summary>{title}</summary>{visited && <div className={ui.body}>{children}</div>}
  </details>;
}

export function AnalyticsWorkspace({ view, asOf }: { view: View; asOf: string }) {
  const today = cairoDate(asOf), hydrated = useHydrated();
  const [range, setRange] = useState<Range>({ from: today.slice(0, 8) + '01', to: today, as_of: asOf, observation_days: '30', campaign_id: '', source: '', format: '' });
  const [mountedAt] = useState(() => performance.now());
  const [filterError, setFilterError] = useState('');
  const campaigns = usePaymentList<Campaign>(view === 'team' ? null : 'analytics/campaigns');
  // Keep later reads on the server's clock even if this device runs ahead.
  const snapshot = () => new Date(Date.parse(asOf) + performance.now() - mountedAt).toISOString();
  const refresh = () => setRange({ ...range, as_of: snapshot() });

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const from = field(data, 'from'), to = field(data, 'to'), days = field(data, 'observation_days') || '30';
    const length = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    const maxDays = view === 'team' ? 94 : 366;
    if (length < 1 || length > maxDays) { setFilterError(`Choose an inclusive date range of 1 to ${maxDays} days.`); return; }
    if (Number(days) > 365) { setFilterError('Choose an observation window of 1 to 365 days.'); return; }
    setRange({ from, to, as_of: snapshot(), observation_days: days, campaign_id: field(data, 'campaign_id'), source: field(data, 'source'), format: field(data, 'format') });
    setFilterError('');
    const disclosure = form.closest('details');
    if (disclosure) { disclosure.open = false; disclosure.querySelector('summary')?.focus(); }
  }

  const campaignName = campaigns.items?.find(item => item.campaign_id === range.campaign_id)?.name;
  const applied = [campaignName || (range.campaign_id && 'Selected campaign'), label(range.source), label(range.format)].filter(Boolean);
  return <div className={ui.workspace}>
    <nav className={ui.tabs} aria-label="Analytics views">{(Object.keys(views) as View[]).map(key =>
      <Link key={key} href={`/admin/${key}`} aria-current={key === view ? 'page' : undefined}>{views[key]}</Link>)}</nav>
    <details className={ui.disclosure}>
      <summary><strong>Report filters</strong><span className={ui.range}>{range.from} – {range.to} · Cairo{applied.length > 0 && ` · ${applied.join(' · ')}`}</span></summary>
      <form className={forms.form} onSubmit={apply}>
        <fieldset className={`${forms.formFields} ${forms.filterFields}`} disabled={!hydrated}>
          <TextField name="from" label="From (Cairo date)" type="date" defaultValue={range.from} />
          <TextField name="to" label="To (Cairo date, inclusive)" type="date" defaultValue={range.to} />
          {view !== 'team' && <>
            <TextField name="observation_days" label="Observation window in days" type="number" min={1} defaultValue={30} />
            <Select name="campaign_id" label="Campaign" options={[{ value: '', label: 'All campaigns and sources' }, ...(campaigns.items || []).map(row => ({ value: row.campaign_id, label: row.name }))]} />
            <Select name="source" label="Verified attribution" options={[{ value: '', label: 'All attribution' }, { value: 'verified_campaign', label: 'Verified campaign' }, { value: 'verified_organic', label: 'Verified organic' }, { value: 'unknown', label: 'Unknown source' }]} />
            <Select name="format" label="Progression format" options={[{ value: '', label: 'All formats' }, { value: 'private', label: 'Private' }, { value: 'group', label: 'Group' }]} />
            <section aria-label="Campaign choices"><PaymentReadState pending={!campaigns.items} {...campaigns} /></section>
          </>}
          {filterError && <p className={forms.error} role="alert">{filterError}</p>}
          <button className={forms.primary} type="submit">Show report</button>
        </fieldset>
      </form>
    </details>
    {view === 'team' ? <Workload key={range.as_of} range={range} refresh={refresh} /> : <Cohorts key={range.as_of} range={range} refresh={refresh} />}
    {view === 'campaigns' && <>
      <CampaignManagement campaigns={campaigns.items || []} reload={campaigns.reload} />
      <Disclosure title="Source observations"><InquiryManagement campaigns={campaigns.items || []} /></Disclosure>
    </>}
  </div>;
}

function PageStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div className={ui.actions}><p role="alert">{error}</p><button type="button" onClick={retry}>Retry page</button></div> :
    <p role="status">Loading records…</p>;
}

function ReportHeading({ title, pending, error, refresh }: { title: string; pending: boolean; error?: string; refresh: () => void }) {
  return <>
    <header className={ui.heading}><h2>{title}</h2><button className={forms.signout} type="button" onClick={refresh}>Refresh report</button></header>
    {error ? <p role="alert" className={forms.error}>{error}</p> : pending && <p role="status">Loading report…</p>}
  </>;
}

function Cohorts({ range, refresh }: { range: Range; refresh: () => void }) {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, value]) => value))).toString();
  const [cursor, setCursor] = useState<string | null>(null), [exportError, setExportError] = useState(''), [exporting, setExporting] = useState(false);
  const report = usePaymentRecord<CohortReport>(`analytics/cohorts?${query}`);
  const nextPage = usePaymentRecord<CohortReport>(cursor ? `analytics/cohorts?${query}&cursor=${cursor}` : null);
  const data = report.data, page = cursor ? nextPage.data : data;
  async function download() {
    setExporting(true); setExportError('');
    try { const response = await fetch(`/api/v1/analytics/cohorts/export?${query}`, { method: 'POST', credentials: 'same-origin' }); if (!response.ok) throw new Error('The export could not be reconciled. Refresh the report and try again.'); const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = `cohort-${range.from}-${range.to}.csv`; a.click(); URL.revokeObjectURL(url); } catch (error) { setExportError(error instanceof Error ? error.message : 'Export unavailable.'); } finally { setExporting(false); }
  }

  return <section className={ui.report}>
    <ReportHeading title="Acquisition and progression" pending={!data} error={report.error} refresh={refresh} />
    {data && <>
      <p className={ui.note}>{data.observation_days}-day observation window from each learner’s first lifetime inquiry · As of <CairoTimestamp value={data.as_of} /> · Policy {data.policy_version}.</p>
      <CohortCharts report={data} />
      {data.summary.learners === 0 && <p className={ui.empty}>No verified learner links match this cohort.</p>}
      <p className={ui.note}>{data.unlinked_inquiries} unlinked inquiry observations in the date range are excluded from conversion.</p>
      {data.spend.state === 'not_applicable' ? <p className={ui.note}>Select a campaign to see dated spend and acquisition cost.</p> :
        <div className={ui.spend}>
          <p><strong>Campaign spend</strong> · {label(data.spend.state)}{data.spend.amount_minor !== null && ` · ${money(data.spend.amount_minor, data.spend.currency)}`}</p>
          <p><strong>Cost per newly taught learner</strong> · {data.spend.cac_minor === null ? 'Not calculable' : money(data.spend.cac_minor, data.spend.currency)}</p>
          <p className={ui.note}>Acquisition cost requires complete spend for the dates and a newly taught learner. Format and subject subsets are excluded.</p>
        </div>}
      {data.spend.entries.length > 0 && <Disclosure title="Spend sources and corrections">
        <ul className={styles.list}>{data.spend.entries.map(entry => <li className={styles.file} key={entry.spend_entry_id}>{entry.from} – {entry.to} · {money(entry.amount_minor, data.spend.currency)} · revision {entry.version}
          {entry.expense_id && <p>Linked expense {entry.expense_id}, counted once in Finance.</p>}<SpendCorrection entry={entry} reload={refresh} /></li>)}</ul>
      </Disclosure>}
    </>}
    {data && data.summary.learners > 0 && <Disclosure title="Learner records">
      {cursor && !page && <PageStatus error={nextPage.error} retry={nextPage.reload} />}
      {page && <>
        <ul className={ui.records}>{page.items.map(row => <li key={row.learner_id}>
          <Disclosure title={`${row.learner_name} · ${row.cohort_date}`}>
            <p>{label(row.attribution)} · History {label(row.history_status)} · {row.provisional ? 'Provisional' : 'Window complete'}</p>
            <p>{row.interactions} interactions · Accepted booking {row.booked ? 'Yes' : 'No'} · Settled payment {row.paid ? 'Yes' : 'No'} · Approved attendance {row.attended ? 'Yes' : 'No'} · Newly taught {row.newly_taught ? 'Yes' : 'No'}</p>
            <p>First inquiry {row.first_inquiry_id}. Window ends <CairoTimestamp value={row.window_end} />.</p>
            {row.first_occurrence_id && row.first_attendance_at && <p>First approved attendance <CairoTimestamp value={row.first_attendance_at} /> · Occurrence {row.first_occurrence_id}</p>}
            <Link href={`/admin/customers?learner_id=${row.learner_id}`}>Open customer follow-up</Link>
            <HistoryReview learnerId={row.learner_id} version={row.history_version} />
          </Disclosure>
        </li>)}</ul>
        {page.items.length === 0 && <p>No more learners on this page.</p>}
      </>}
      <div className={ui.actions}>{cursor && <button type="button" onClick={() => setCursor(null)}>First page</button>}
        {page?.next_cursor && <button type="button" onClick={() => setCursor(page.next_cursor)}>Next learners</button>}</div>
    </Disclosure>}
    {data && <div className={ui.actions}><button className={forms.signout} type="button" disabled={exporting} onClick={download}>{exporting ? 'Preparing reconciled export…' : 'Export this complete cohort'}</button>
      {exportError && <p role="alert">{exportError}</p>}</div>}
  </section>;
}
function CampaignManagement({ campaigns, reload }: { campaigns: Campaign[]; reload: () => void }) {
  const [evidence, setEvidence] = useState('');
  return <><Disclosure title="Create campaign"><IdentityForm action="analytics/create_campaign" submitLabel="Create campaign" successMessage="Campaign identity saved." onSaved={reload} payload={form => ({ source: field(form, 'source'), external_campaign_id: field(form, 'external_campaign_id'), name: field(form, 'name'), active_from: field(form, 'active_from'), active_to: field(form, 'active_to') })}><TextField name="name" label="Campaign name" maxLength={200} /><TextField name="source" label="Source platform" maxLength={100} /><TextField name="external_campaign_id" label="External campaign identifier" maxLength={200} /><TextField name="active_from" label="Active from" type="date" /><TextField name="active_to" label="Active through" type="date" /></IdentityForm></Disclosure>
    <Disclosure title="Record campaign spend"><IdentityForm action="analytics/record_campaign_spend" submitLabel="Record evidenced spend" successMessage="Dated spend saved without an additional expense posting." disabled={!evidence || !campaigns.length} payload={form => ({ campaign_id: field(form, 'campaign_id'), from: field(form, 'from'), to: field(form, 'to'), amount_minor: Number(field(form, 'amount_minor')), currency: 'EGP', evidence_file_id: evidence, expense_id: field(form, 'expense_id') || null })}><Select name="campaign_id" label="Campaign" options={campaigns.map(row => ({ value: row.campaign_id, label: row.name }))} /><TextField name="from" label="Spend period from" type="date" /><TextField name="to" label="Spend period through" type="date" /><TextField name="amount_minor" label="Spend (EGP piastres)" type="number" min={0} hint="100 piastres = EGP 1. Record an evidenced zero when spend is confirmed zero." /><TextField name="expense_id" label="Existing marketing expense ID (optional)" required={false} pattern={uuidPattern} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label="Spend evidence" /><p>Upload the approved source report. Periods for one campaign cannot overlap; correct an existing entry from its report instead.</p></IdentityForm></Disclosure>
  </>;
}
function SpendCorrection({ entry, reload }: { entry: CohortReport['spend']['entries'][number]; reload: () => void }) {
  const [evidence, setEvidence] = useState(''); return <Disclosure title="Correct this spend entry"><IdentityForm action="analytics/correct_campaign_spend" submitLabel="Save spend correction" successMessage="Correction appended. Original spend retained." onSaved={reload} disabled={!evidence} payload={form => ({ spend_entry_id: entry.spend_entry_id, amount_minor: Number(field(form, 'amount_minor')), reason: field(form, 'reason'), evidence_file_id: evidence, expected_version: entry.version })}><TextField name="amount_minor" label="Corrected spend (EGP piastres)" type="number" min={0} defaultValue={entry.amount_minor} /><TextField name="reason" label="Correction reason" maxLength={2000} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label="Correction evidence" /></IdentityForm></Disclosure>;
}
function InquiryManagement({ campaigns }: { campaigns: Campaign[] }) {
  const inquiries = usePaymentList<AnalyticsInquiry>('analytics/inquiries');
  return <section className={styles.section} aria-label="Inquiry observations"><p>Client source tokens are observed claims. Review independent evidence before assigning campaign or organic credit. Shared contacts stay unlinked until the learner is verified.</p><PaymentReadState pending={!inquiries.items} {...inquiries} /><ul className={styles.list}>{inquiries.items?.map(row => <li className={styles.file} key={row.inquiry_id}><h3>{label(row.source)}</h3><p><CairoTimestamp value={row.observed_at} /> · {label(row.attribution)} · {row.learner_ids.length} learner links</p>{row.observed_source_token && <p>Observed source claim: {row.observed_source_token}</p>}<p>Inquiry {row.inquiry_id}</p><InquiryReview row={row} campaigns={campaigns} reload={inquiries.reload} /></li>)}</ul>{inquiries.cursor && <button type="button" onClick={inquiries.loadMore}>Load more observations</button>}</section>;
}
function InquiryReview({ row, campaigns, reload }: { row: AnalyticsInquiry; campaigns: Campaign[]; reload: () => void }) {
  const [evidence, setEvidence] = useState(''); return <Disclosure title="Review attribution or learner link"><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label="Independent source / identity evidence" />
    <IdentityForm action="analytics/review_attribution" submitLabel="Save attribution review" successMessage="Review appended and cohort credit recalculated." onSaved={reload} payload={form => ({ inquiry_id: row.inquiry_id, attribution: field(form, 'attribution'), campaign_id: field(form, 'attribution') === 'verified_campaign' ? field(form, 'campaign_id') : null, evidence_file_id: evidence || null, reason: field(form, 'reason'), expected_version: row.version })}><Select name="attribution" label="Attribution decision" options={[{ value: 'unknown', label: 'Unknown / unverified' }, { value: 'verified_organic', label: 'Verified organic' }, { value: 'verified_campaign', label: 'Verified campaign' }]} /><Select name="campaign_id" label="Campaign for verified paid touch" options={[{ value: '', label: 'Choose campaign' }, ...campaigns.map(c => ({ value: c.campaign_id, label: c.name }))]} /><TextField name="reason" label="Evidence review reason" maxLength={2000} /></IdentityForm>
    <IdentityForm action="analytics/link_inquiry_learner" submitLabel="Link verified learner" successMessage="Verified learner linked; original observations retained." onSaved={reload} disabled={!evidence} payload={form => ({ inquiry_id: row.inquiry_id, learner_id: field(form, 'learner_id'), evidence_file_id: evidence, reason: field(form, 'reason') })}><TextField name="learner_id" label="Verified learner ID" pattern={uuidPattern} /><TextField name="reason" label="Identity verification reason" maxLength={2000} /></IdentityForm>
    {row.links.map(link => <IdentityForm key={link.learner_id} action="analytics/review_inquiry_link" submitLabel={link.active ? 'Reject this learner link' : 'Restore this learner link'} successMessage="Link review appended. Earlier identity evidence is retained." onSaved={reload} disabled={!evidence} payload={form => ({ inquiry_id: row.inquiry_id, learner_id: link.learner_id, active: !link.active, evidence_file_id: evidence, reason: field(form, 'reason'), expected_version: link.version })}><p>Learner {link.learner_id} · {link.active ? 'Included in acquisition' : 'Excluded from acquisition'} · Review {link.version}</p><TextField name="reason" label="Identity correction reason" maxLength={2000} /></IdentityForm>)}
  </Disclosure>;
}
function HistoryReview({ learnerId, version }: { learnerId: string; version: number }) {
  const [evidence, setEvidence] = useState(''); return <Disclosure title="Record lifetime history coverage"><p>Confirm completeness only after checking the retained attendance history across all formats. This review does not create attendance.</p><IdentityForm action="analytics/record_learner_history" submitLabel="Save history review" successMessage="History review saved. Run the report again to include it." disabled={!evidence} payload={form => ({ learner_id: learnerId, history_complete: field(form, 'complete') === 'true', evidence_file_id: evidence, reason: field(form, 'reason'), expected_version: version })}><Select name="complete" label="Historical coverage" options={[{ value: 'false', label: 'Incomplete or unknown' }, { value: 'true', label: 'Verified complete lifetime history' }]} /><TextField name="reason" label="Review basis" maxLength={2000} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label="History coverage evidence" /></IdentityForm></Disclosure>;
}
function Workload({ range, refresh }: { range: Range; refresh: () => void }) {
  const [tutorCursor, setTutorCursor] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const path = `analytics/workload?${new URLSearchParams({ from: range.from, to: range.to })}`;
  const report = usePaymentRecord<WorkloadReport>(path), data = report.data;
  const tutorPage = usePaymentRecord<WorkloadReport>(tutorCursor ? `${path}&tutor_cursor=${tutorCursor}` : null);
  const conversationPage = usePaymentRecord<WorkloadReport>(conversationCursor ? `${path}&conversation_cursor=${conversationCursor}` : null);
  const tutors = tutorCursor ? tutorPage.data : data;
  const support = conversationCursor ? conversationPage.data : data;
  return <section className={ui.report}>
    <ReportHeading title="Team workload report" pending={!data} error={report.error} refresh={refresh} />
    {data && <WorkloadCharts report={data} />}
    <Disclosure title="Tutor capacity">
      {tutorCursor && !tutors && <PageStatus error={tutorPage.error} retry={tutorPage.reload} />}
      {tutors && <>
      <p className={ui.note}>Availability uses each tutor’s current saved schedule.</p>
      <ul className={ui.records}>{tutors.tutors.map(row => <li key={row.tutor_id}>
        <strong>{row.tutor_name}</strong><p>Scheduled {duration(row.scheduled_seconds)} · Delivered {duration(row.delivered_seconds)} · Available {row.available_seconds === null ? 'Unknown' : duration(row.available_seconds)}</p>
        {row.occurrences.length > 0 && <Disclosure title={`Occurrence drilldown (${row.occurrences.length})`}><ul className={ui.records}>{row.occurrences.map(o => <li key={o.occurrence_id}>
          <CairoTimestamp value={o.start_at} /> · Scheduled {duration(o.scheduled_seconds)} · Delivered {duration(o.delivered_seconds)}<p>Occurrence {o.occurrence_id}</p>
        </li>)}</ul></Disclosure>}
      </li>)}</ul>
      {tutors.tutors.length === 0 && <p>No tutors on this page.</p>}
      <div className={ui.actions}>{tutorCursor && <button type="button" onClick={() => setTutorCursor(null)}>First tutors</button>}{tutors.tutor_next_cursor && <button type="button" onClick={() => setTutorCursor(tutors.tutor_next_cursor)}>Next tutors</button>}</div>
    </>}</Disclosure>
    <Disclosure title="Support ownership and response">
      {conversationCursor && !support && <PageStatus error={conversationPage.error} retry={conversationPage.reload} />}
      {support && <>
      <p className={ui.note}>Includes open conversations and conversations with activity during the period.</p>
      <ul className={ui.records}>{support.conversations.map(row => <li key={row.conversation_id}>
        <Link href={`/admin/support?conversation=${row.conversation_id}`}>{row.channel} conversation {row.conversation_id}</Link>
        <p>{label(row.state)} · {row.owner_name || 'Unassigned'} · {row.ownership_changes} ownership changes</p>
        <p>Owned during period {duration(row.owned_seconds)} · First human response {row.first_response_seconds === null ? 'Not yet answered' : duration(row.first_response_seconds)} · Current waiting age {row.waiting_seconds === null ? 'Not waiting' : duration(row.waiting_seconds)}</p>
      </li>)}</ul>
      {support.conversations.length === 0 && <p>No conversations on this page.</p>}
      <div className={ui.actions}>{conversationCursor && <button type="button" onClick={() => setConversationCursor(null)}>First conversations</button>}{support.conversation_next_cursor && <button type="button" onClick={() => setConversationCursor(support.conversation_next_cursor)}>Next conversations</button>}</div>
    </>}</Disclosure>
  </section>;
}
