'use client';

import { useSiteLanguage } from '@/components/site-language';
import { useStaffText } from '@/components/ar-staff-label';
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
  const t = useStaffText();

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
    if (Number(days) > 365) { setFilterError(t("Choose an observation window of 1 to 365 days.")); return; }
    setRange({ from, to, as_of: snapshot(), observation_days: days, campaign_id: field(data, 'campaign_id'), source: field(data, 'source'), format: field(data, 'format') });
    setFilterError('');
    const disclosure = form.closest('details');
    if (disclosure) { disclosure.open = false; disclosure.querySelector('summary')?.focus(); }
  }

  const campaignName = campaigns.items?.find(item => item.campaign_id === range.campaign_id)?.name;
  const applied = [campaignName || (range.campaign_id && t('Selected campaign')), t(label(range.source)), t(label(range.format))].filter(Boolean);
  return <div className={ui.workspace}>
    <nav className={ui.tabs} aria-label={t("Analytics views")}>{(Object.keys(views) as View[]).map(key =>
      <Link key={key} href={`/admin/${key}`} aria-current={key === view ? 'page' : undefined}>{t(views[key])}</Link>)}</nav>
    <details className={ui.disclosure}>
      <summary><strong>{t("Report filters")}</strong><span className={ui.range}>{range.from} – {range.to} · {t('Cairo')}{applied.length > 0 && ` · ${applied.join(' · ')}`}</span></summary>
      <form className={forms.form} onSubmit={apply}>
        <fieldset className={`${forms.formFields} ${forms.filterFields}`} disabled={!hydrated}>
          <TextField name="from" label={t("From (Cairo date)")} type="date" defaultValue={range.from} />
          <TextField name="to" label={t("To (Cairo date, inclusive)")} type="date" defaultValue={range.to} />
          {view !== 'team' && <>
            <TextField name="observation_days" label={t("Observation window in days")} type="number" min={1} defaultValue={30} />
            <Select name="campaign_id" label={t("Campaign")} options={[{ value: '', label: t('All campaigns and sources') }, ...(campaigns.items || []).map(row => ({ value: row.campaign_id, label: row.name }))]} />
            <Select name="source" label={t("Verified attribution")} options={[{ value: '', label: t('All attribution') }, { value: 'verified_campaign', label: t('Verified campaign') }, { value: 'verified_organic', label: t('Verified organic') }, { value: 'unknown', label: t('Unknown source') }]} />
            <Select name="format" label={t("Progression format")} options={[{ value: '', label: t('All formats') }, { value: 'private', label: t('Private') }, { value: 'group', label: t('Group') }]} />
            <section aria-label={t("Campaign choices")}><PaymentReadState pending={!campaigns.items} {...campaigns} /></section>
          </>}
          {filterError && <p className={forms.error} role="alert">{filterError}</p>}
          <button className={forms.primary} type="submit">{t("Show report")}</button>
        </fieldset>
      </form>
    </details>
    {view === 'team' ? <Workload key={range.as_of} range={range} refresh={refresh} /> : <Cohorts key={range.as_of} range={range} refresh={refresh} />}
    {view === 'campaigns' && <>
      <CampaignManagement campaigns={campaigns.items || []} reload={campaigns.reload} />
      <Disclosure title={t("Source observations")}><InquiryManagement campaigns={campaigns.items || []} /></Disclosure>
    </>}
  </div>;
}

function PageStatus({ error, retry }: { error?: string; retry: () => void }) {
  const t = useStaffText();

  return error ? <div className={ui.actions}><p role="alert">{error}</p><button type="button" onClick={retry}>{t("Retry page")}</button></div> :
    <p role="status">{t("Loading records…")}</p>;
}

function ReportHeading({ title, pending, error, refresh }: { title: string; pending: boolean; error?: string; refresh: () => void }) {
  const t = useStaffText();

  return <>
    <header className={ui.heading}><h2>{title}</h2><button className={forms.signout} type="button" onClick={refresh}>{t("Refresh report")}</button></header>
    {error ? <p role="alert" className={forms.error}>{error}</p> : pending && <p role="status">{t("Loading report…")}</p>}
  </>;
}

function Cohorts({ range, refresh }: { range: Range; refresh: () => void }) {
  const t = useStaffText();

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
    <ReportHeading title={t("Acquisition and progression")} pending={!data} error={report.error} refresh={refresh} />
    {data && <>
      <p className={ui.note}>{data.observation_days}{t("-day observation window from each learner’s first lifetime inquiry · As of ")}<CairoTimestamp value={data.as_of} /> · {t('Policy')} {data.policy_version}.</p>
      <CohortCharts report={data} />
      {data.summary.learners === 0 && <p className={ui.empty}>{t("No verified learner links match this cohort.")}</p>}
      <p className={ui.note}>{data.unlinked_inquiries}{t(" unlinked inquiry observations in the date range are excluded from conversion.")}</p>
      {data.spend.state === 'not_applicable' ? <p className={ui.note}>{t("Select a campaign to see dated spend and acquisition cost.")}</p> :
        <div className={ui.spend}>
          <p><strong>{t("Campaign spend")}</strong> · {t(label(data.spend.state))}{data.spend.amount_minor !== null && ` · ${money(data.spend.amount_minor, data.spend.currency)}`}</p>
          <p><strong>{t("Cost per newly taught learner")}</strong> · {data.spend.cac_minor === null ? t("Not calculable") : money(data.spend.cac_minor, data.spend.currency)}</p>
          <p className={ui.note}>{t("Acquisition cost requires complete spend for the dates and a newly taught learner. Format and subject subsets are excluded.")}</p>
        </div>}
      {data.spend.entries.length > 0 && <Disclosure title={t("Spend sources and corrections")}>
        <ul className={styles.list}>{data.spend.entries.map(entry => <li className={styles.file} key={entry.spend_entry_id}>{entry.from} – {entry.to} · {money(entry.amount_minor, data.spend.currency)} · {t('revision')} {entry.version}
          {entry.expense_id && <p>{t("Linked expense ")}{entry.expense_id}{t(", counted once in Finance.")}</p>}<SpendCorrection entry={entry} reload={refresh} /></li>)}</ul>
      </Disclosure>}
    </>}
    {data && data.summary.learners > 0 && <Disclosure title={t("Learner records")}>
      {cursor && !page && <PageStatus error={nextPage.error} retry={nextPage.reload} />}
      {page && <>
        <ul className={ui.records}>{page.items.map(row => <li key={row.learner_id}>
          <Disclosure title={`${row.learner_name} · ${row.cohort_date}`}>
            <p>{t(label(row.attribution))} · {t('History')} {t(label(row.history_status))} · {row.provisional ? t("Provisional") : t("Window complete")}</p>
            <p>{row.interactions}{t(" interactions · Accepted booking ")}{row.booked ? t("Yes") : t("No")}{t(" · Settled payment ")}{row.paid ? t("Yes") : t("No")}{t(" · Approved attendance ")}{row.attended ? t("Yes") : t("No")}{t(" · Newly taught ")}{row.newly_taught ? t("Yes") : t("No")}</p>
            <p>{t("First inquiry ")}{row.first_inquiry_id}. {t('Window ends')} <CairoTimestamp value={row.window_end} />.</p>
            {row.first_occurrence_id && row.first_attendance_at && <p>{t("First approved attendance ")}<CairoTimestamp value={row.first_attendance_at} /> · {t('Occurrence')} {row.first_occurrence_id}</p>}
            <Link href={`/admin/customers?learner_id=${row.learner_id}`}>{t("Open customer follow-up")}</Link>
            <HistoryReview learnerId={row.learner_id} version={row.history_version} />
          </Disclosure>
        </li>)}</ul>
        {page.items.length === 0 && <p>{t("No more learners on this page.")}</p>}
      </>}
      <div className={ui.actions}>{cursor && <button type="button" onClick={() => setCursor(null)}>{t("First page")}</button>}
        {page?.next_cursor && <button type="button" onClick={() => setCursor(page.next_cursor)}>{t("Next learners")}</button>}</div>
    </Disclosure>}
    {data && <div className={ui.actions}><button className={forms.signout} type="button" disabled={exporting} onClick={download}>{exporting ? t("Preparing reconciled export…") : t("Export this complete cohort")}</button>
      {exportError && <p role="alert">{exportError}</p>}</div>}
  </section>;
}
function CampaignManagement({ campaigns, reload }: { campaigns: Campaign[]; reload: () => void }) {
  const t = useStaffText();

  const [evidence, setEvidence] = useState('');
  return <><Disclosure title={t("Create campaign")}><IdentityForm action="analytics/create_campaign" submitLabel={t("Create campaign")} successMessage={t("Campaign identity saved.")} onSaved={reload} payload={form => ({ source: field(form, 'source'), external_campaign_id: field(form, 'external_campaign_id'), name: field(form, 'name'), active_from: field(form, 'active_from'), active_to: field(form, 'active_to') })}><TextField name="name" label={t("Campaign name")} maxLength={200} /><TextField name="source" label={t("Source platform")} maxLength={100} /><TextField name="external_campaign_id" label={t("External campaign identifier")} maxLength={200} /><TextField name="active_from" label={t("Active from")} type="date" /><TextField name="active_to" label={t("Active through")} type="date" /></IdentityForm></Disclosure>
    <Disclosure title={t("Record campaign spend")}><IdentityForm action="analytics/record_campaign_spend" submitLabel={t("Record evidenced spend")} successMessage={t("Dated spend saved without an additional expense posting.")} disabled={!evidence || !campaigns.length} payload={form => ({ campaign_id: field(form, 'campaign_id'), from: field(form, 'from'), to: field(form, 'to'), amount_minor: Number(field(form, 'amount_minor')), currency: 'EGP', evidence_file_id: evidence, expense_id: field(form, 'expense_id') || null })}><Select name="campaign_id" label={t("Campaign")} options={campaigns.map(row => ({ value: row.campaign_id, label: row.name }))} /><TextField name="from" label={t("Spend period from")} type="date" /><TextField name="to" label={t("Spend period through")} type="date" /><TextField name="amount_minor" label={t("Spend (EGP piastres)")} type="number" min={0} hint={t("100 piastres = EGP 1. Record an evidenced zero when spend is confirmed zero.")} /><TextField name="expense_id" label={t("Existing marketing expense ID (optional)")} required={false} pattern={uuidPattern} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label={t("Spend evidence")} /><p>{t("Upload the approved source report. Periods for one campaign cannot overlap; correct an existing entry from its report instead.")}</p></IdentityForm></Disclosure>
  </>;
}
function SpendCorrection({ entry, reload }: { entry: CohortReport['spend']['entries'][number]; reload: () => void }) {
  const t = useStaffText();

  const [evidence, setEvidence] = useState(''); return <Disclosure title={t("Correct this spend entry")}><IdentityForm action="analytics/correct_campaign_spend" submitLabel={t("Save spend correction")} successMessage={t("Correction appended. Original spend retained.")} onSaved={reload} disabled={!evidence} payload={form => ({ spend_entry_id: entry.spend_entry_id, amount_minor: Number(field(form, 'amount_minor')), reason: field(form, 'reason'), evidence_file_id: evidence, expected_version: entry.version })}><TextField name="amount_minor" label={t("Corrected spend (EGP piastres)")} type="number" min={0} defaultValue={entry.amount_minor} /><TextField name="reason" label={t("Correction reason")} maxLength={2000} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label={t("Correction evidence")} /></IdentityForm></Disclosure>;
}
function InquiryManagement({ campaigns }: { campaigns: Campaign[] }) {
  const t = useStaffText();

  const inquiries = usePaymentList<AnalyticsInquiry>('analytics/inquiries');
  return <section className={styles.section} aria-label={t("Inquiry observations")}><p>{t("Client source tokens are observed claims. Review independent evidence before assigning campaign or organic credit. Shared contacts stay unlinked until the learner is verified.")}</p><PaymentReadState pending={!inquiries.items} {...inquiries} /><ul className={styles.list}>{inquiries.items?.map(row => <li className={styles.file} key={row.inquiry_id}><h3>{t(label(row.source))}</h3><p><CairoTimestamp value={row.observed_at} /> · {t(label(row.attribution))} · {row.learner_ids.length}{t(" learner links")}</p>{row.observed_source_token && <p>{t("Observed source claim: ")}{row.observed_source_token}</p>}<p>{t("Inquiry ")}{row.inquiry_id}</p><InquiryReview row={row} campaigns={campaigns} reload={inquiries.reload} /></li>)}</ul>{inquiries.cursor && <button type="button" onClick={inquiries.loadMore}>{t("Load more observations")}</button>}</section>;
}
function InquiryReview({ row, campaigns, reload }: { row: AnalyticsInquiry; campaigns: Campaign[]; reload: () => void }) {
  const t = useStaffText();

  const [evidence, setEvidence] = useState(''); return <Disclosure title={t("Review attribution or learner link")}><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label={t("Independent source / identity evidence")} />
    <IdentityForm action="analytics/review_attribution" submitLabel={t("Save attribution review")} successMessage={t("Review appended and cohort credit recalculated.")} onSaved={reload} payload={form => ({ inquiry_id: row.inquiry_id, attribution: field(form, 'attribution'), campaign_id: field(form, 'attribution') === 'verified_campaign' ? field(form, 'campaign_id') : null, evidence_file_id: evidence || null, reason: field(form, 'reason'), expected_version: row.version })}><Select name="attribution" label={t("Attribution decision")} options={[{ value: 'unknown', label: t('Unknown / unverified') }, { value: 'verified_organic', label: t('Verified organic') }, { value: 'verified_campaign', label: t('Verified campaign') }]} /><Select name="campaign_id" label={t("Campaign for verified paid touch")} options={[{ value: '', label: t('Choose campaign') }, ...campaigns.map(c => ({ value: c.campaign_id, label: c.name }))]} /><TextField name="reason" label={t("Evidence review reason")} maxLength={2000} /></IdentityForm>
    <IdentityForm action="analytics/link_inquiry_learner" submitLabel={t("Link verified learner")} successMessage={t("Verified learner linked; original observations retained.")} onSaved={reload} disabled={!evidence} payload={form => ({ inquiry_id: row.inquiry_id, learner_id: field(form, 'learner_id'), evidence_file_id: evidence, reason: field(form, 'reason') })}><TextField name="learner_id" label={t("Verified learner ID")} pattern={uuidPattern} /><TextField name="reason" label={t("Identity verification reason")} maxLength={2000} /></IdentityForm>
    {row.links.map(link => <IdentityForm key={link.learner_id} action="analytics/review_inquiry_link" submitLabel={link.active ? t("Reject this learner link") : t("Restore this learner link")} successMessage={t("Link review appended. Earlier identity evidence is retained.")} onSaved={reload} disabled={!evidence} payload={form => ({ inquiry_id: row.inquiry_id, learner_id: link.learner_id, active: !link.active, evidence_file_id: evidence, reason: field(form, 'reason'), expected_version: link.version })}><p>{t("Learner ")}{link.learner_id} · {link.active ? t("Included in acquisition") : t("Excluded from acquisition")} · {t('Review')} {link.version}</p><TextField name="reason" label={t("Identity correction reason")} maxLength={2000} /></IdentityForm>)}
  </Disclosure>;
}
function HistoryReview({ learnerId, version }: { learnerId: string; version: number }) {
  const t = useStaffText();

  const [evidence, setEvidence] = useState(''); return <Disclosure title={t("Record lifetime history coverage")}><p>{t("Confirm completeness only after checking the retained attendance history across all formats. This review does not create attendance.")}</p><IdentityForm action="analytics/record_learner_history" submitLabel={t("Save history review")} successMessage={t("History review saved. Run the report again to include it.")} disabled={!evidence} payload={form => ({ learner_id: learnerId, history_complete: field(form, 'complete') === 'true', evidence_file_id: evidence, reason: field(form, 'reason'), expected_version: version })}><Select name="complete" label={t("Historical coverage")} options={[{ value: 'false', label: t('Incomplete or unknown') }, { value: 'true', label: t('Verified complete lifetime history') }]} /><TextField name="reason" label={t("Review basis")} maxLength={2000} /><EvidenceSelect action="analytics_evidence" value={evidence} onChange={setEvidence} label={t("History coverage evidence")} /></IdentityForm></Disclosure>;
}
function Workload({ range, refresh }: { range: Range; refresh: () => void }) {
  const t = useStaffText();
  const language = useSiteLanguage();

  const [tutorCursor, setTutorCursor] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const path = `analytics/workload?${new URLSearchParams({ from: range.from, to: range.to })}`;
  const report = usePaymentRecord<WorkloadReport>(path), data = report.data;
  const tutorPage = usePaymentRecord<WorkloadReport>(tutorCursor ? `${path}&tutor_cursor=${tutorCursor}` : null);
  const conversationPage = usePaymentRecord<WorkloadReport>(conversationCursor ? `${path}&conversation_cursor=${conversationCursor}` : null);
  const tutors = tutorCursor ? tutorPage.data : data;
  const support = conversationCursor ? conversationPage.data : data;
  return <section className={ui.report}>
    <ReportHeading title={t("Team workload report")} pending={!data} error={report.error} refresh={refresh} />
    {data && <WorkloadCharts report={data} />}
    <Disclosure title={t("Tutor capacity")}>
      {tutorCursor && !tutors && <PageStatus error={tutorPage.error} retry={tutorPage.reload} />}
      {tutors && <>
      <p className={ui.note}>{t("Availability uses each tutor’s current saved schedule.")}</p>
      <ul className={ui.records}>{tutors.tutors.map(row => <li key={row.tutor_id}>
        <strong>{row.tutor_name}</strong><p>{t("Scheduled ")}{duration(row.scheduled_seconds, language)} · {t('Delivered')} {duration(row.delivered_seconds, language)} · {t('Available')} {row.available_seconds === null ? t("Unknown") : duration(row.available_seconds, language)}</p>
        {row.occurrences.length > 0 && <Disclosure title={`Occurrence drilldown (${row.occurrences.length})`}><ul className={ui.records}>{row.occurrences.map(o => <li key={o.occurrence_id}>
          <CairoTimestamp value={o.start_at} /> · {t('Scheduled')} {duration(o.scheduled_seconds, language)} · {t('Delivered')} {duration(o.delivered_seconds, language)}<p>{t("Occurrence ")}{o.occurrence_id}</p>
        </li>)}</ul></Disclosure>}
      </li>)}</ul>
      {tutors.tutors.length === 0 && <p>{t("No tutors on this page.")}</p>}
      <div className={ui.actions}>{tutorCursor && <button type="button" onClick={() => setTutorCursor(null)}>{t("First tutors")}</button>}{tutors.tutor_next_cursor && <button type="button" onClick={() => setTutorCursor(tutors.tutor_next_cursor)}>{t("Next tutors")}</button>}</div>
    </>}</Disclosure>
    <Disclosure title={t("Support ownership and response")}>
      {conversationCursor && !support && <PageStatus error={conversationPage.error} retry={conversationPage.reload} />}
      {support && <>
      <p className={ui.note}>{t("Includes open conversations and conversations with activity during the period.")}</p>
      <ul className={ui.records}>{support.conversations.map(row => <li key={row.conversation_id}>
        <Link href={`/admin/support?conversation=${row.conversation_id}`}>{t(row.channel)} {t('conversation')} {row.conversation_id}</Link>
        <p>{t(label(row.state))} · {row.owner_name || t("Unassigned")} · {row.ownership_changes}{t(" ownership changes")}</p>
        <p>{t("Owned during period ")}{duration(row.owned_seconds, language)}{t(" · First human response ")}{row.first_response_seconds === null ? t("Not yet answered") : duration(row.first_response_seconds, language)}{t(" · Current waiting age ")}{row.waiting_seconds === null ? t("Not waiting") : duration(row.waiting_seconds, language)}</p>
      </li>)}</ul>
      {support.conversations.length === 0 && <p>{t("No conversations on this page.")}</p>}
      <div className={ui.actions}>{conversationCursor && <button type="button" onClick={() => setConversationCursor(null)}>{t("First conversations")}</button>}{support.conversation_next_cursor && <button type="button" onClick={() => setConversationCursor(support.conversation_next_cursor)}>{t("Next conversations")}</button>}</div>
    </>}</Disclosure>
  </section>;
}
