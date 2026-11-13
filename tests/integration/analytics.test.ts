import { createHash, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { paymentFixture } from '../helpers/payments';
import { getCohortReport, invokeAnalyticsCommand, listAnalyticsInquiries, getWorkloadReport } from '../../src/modules/analytics/queries';
import { cairoDate } from '../../src/modules/shared/primitives';
import { anonymousClient, loadLocalSupabase } from '../helpers/supabase';
import { createFileContentService } from '../../src/server/files';
import { parseServerConfig } from '../../src/server/config';
import { invokeFileCommandWithStatus } from '../../src/modules/files/commands';
import { runFileScan, syntheticPdf } from '../helpers/files';
import { invokeSupportCommand } from '../../src/modules/support/commands';
import { proposalFixture } from '../helpers/proposal-fixtures';

async function freshLearner() {
  const config = loadLocalSupabase(), provider = createClient(config.url, config.secret_key, { auth: { persistSession: false } }), email = `analytics.${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}!`;
  const created = await provider.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error || !created.data.user) throw new Error('ANALYTICS_FIXTURE_FAILED');
  const client = anonymousClient(); if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error('ANALYTICS_FIXTURE_FAILED');
  return { client, accountId: created.data.user.id };
}
async function scannedEvidence(client: ReturnType<typeof anonymousClient>) {
  const config = loadLocalSupabase(), worker = new Pool({ connectionString: config.worker_database_url }), content = createFileContentService(worker, parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishable_key, SUPABASE_SECRET_KEY: config.secret_key }));
  try {
    const checksum = createHash('sha256').update(syntheticPdf).digest('hex');
    const created = await invokeFileCommandWithStatus(client, 'create_file_upload', { p_purpose: 'review_evidence', p_parent_id: null, p_evidence_action: 'analytics_evidence', p_filename: 'synthetic-analytics-source.pdf', p_declared_type: 'application/pdf', p_size_bytes: syntheticPdf.length, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
    const id = created.data.file_id; await content.upload(client, id, syntheticPdf);
    const finalized = await invokeFileCommandWithStatus(client, 'finalize_file_upload', { p_file_id: id, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
    expect(await runFileScan(finalized.data.scan_job_id)).toBe('completed');
    expect(Buffer.from((await content.download(client, id)).bytes)).toEqual(syntheticPdf);
    return id;
  } finally { await worker.end(); }
}

test('T12 observed booking intent is private, deduplicated, source-reviewed and export-reconcilable', async () => {
  const f = await paymentFixture({ charge: 'enrollment' }), fresh = await freshLearner();
  try {
    const learnerId = (await f.database.query('select id from app_private.learners where account_id=$1', [fresh.accountId])).rows[0].id as string;
    const occurrence = await f.occurrence('private'); const enrollment = await f.rpc('reserve_enrollment', { p_occurrence_id: occurrence.occurrence_id, p_learner_id: learnerId, p_idempotency_key: randomUUID() }, fresh.client);
    const inquiries = await listAnalyticsInquiries(f.admin, { p_learner_id: learnerId });
    const inquiry = inquiries.items.find(row => row.source_event_id === enrollment.enrollment_id)!;
    expect(inquiry).toMatchObject({ source: 'website_booking', attribution: 'unknown' });
    const campaign = await invokeAnalyticsCommand(f.admin, 'create_campaign', { p_source: 'instagram', p_external_campaign_id: randomUUID(), p_name: 'Synthetic campaign', p_active_from: '2026-01-01', p_active_to: '2027-01-01', p_idempotency_key: randomUUID() });
    const evidence = await scannedEvidence(f.admin);
    expect((await f.admin.rpc('list_payment_evidence', { p_action: 'analytics_evidence', p_target_id: null })).data.items).toEqual(expect.arrayContaining([expect.objectContaining({ file_id: evidence, can_download: true })]));
    expect((await fresh.client.rpc('get_file', { p_file_id: evidence })).error?.message).toBe('NOT_FOUND');
    const review = { p_inquiry_id: inquiry.inquiry_id, p_attribution: 'verified_campaign', p_campaign_id: campaign.data.resource_id, p_evidence_file_id: evidence, p_reason: 'Synthetic tracked touch independently reviewed', p_expected_version: 1, p_idempotency_key: randomUUID() };
    const result = await invokeAnalyticsCommand(f.admin, 'review_attribution', review);
    expect((await invokeAnalyticsCommand(f.admin, 'review_attribution', review)).data).toEqual(result.data);
    await expect(invokeAnalyticsCommand(f.admin, 'review_attribution', { ...review, p_idempotency_key: randomUUID() })).rejects.toThrow('VERSION_CONFLICT');
    const range = { p_from: cairoDate(new Date()), p_to: cairoDate(new Date()), p_as_of: new Date().toISOString(), p_campaign_id: campaign.data.resource_id };
    const report = await getCohortReport(f.admin, range);
    expect(report.summary.learners).toBe(1); expect(report.items[0]).toMatchObject({ learner_id: learnerId, attribution: 'verified_campaign', history_status: 'unknown', newly_taught: false });
    expect(report.spend.state).toBe('missing'); expect(report.spend.cac_minor).toBeNull();
    await expect(getCohortReport(f.learner, range)).rejects.toThrow('FORBIDDEN');
    await expect(getCohortReport(f.reviewer, range)).rejects.toThrow('FORBIDDEN');
    await expect(f.database.query('update app_private.lead_inquiries set source=source where id=$1', [inquiry.inquiry_id])).rejects.toThrow();
    const workload = await getWorkloadReport(f.admin, { p_from: range.p_from, p_to: range.p_to });
    expect(workload.staffed_hours_state).toBe('unknown');
    await expect(getWorkloadReport(f.learner, { p_from: range.p_from, p_to: range.p_to })).rejects.toThrow('FORBIDDEN');
  } finally { await fresh.client.auth.signOut({ scope: 'local' }); await f.close(); }
}, 60000);

test('T12 dated campaign spend retains revisions and references expense without another ledger posting', async () => {
  const f = await paymentFixture(); try {
    const evidence = await f.evidence({ purpose: 'expense_evidence', parentType: 'expense', parentId: null });
    const expense = await f.rpc('record_expense', { p_category: 'marketing', p_amount_minor: 10000, p_currency: 'EGP', p_incurred_at: new Date().toISOString(), p_description: 'Synthetic campaign cost', p_evidence_file_id: evidence, p_idempotency_key: randomUUID() });
    const campaign = await invokeAnalyticsCommand(f.admin, 'create_campaign', { p_source: 'search', p_external_campaign_id: randomUUID(), p_name: 'Synthetic spend', p_active_from: '2026-01-01', p_active_to: '2027-01-01', p_idempotency_key: randomUUID() });
    const analyticEvidence = await f.evidence({ purpose: 'analytics_evidence', parentType: 'analytics', parentId: null });
    const before = Number((await f.database.query('select count(*) from finance_private.ledger_transactions')).rows[0].count);
    const args = { p_campaign_id: campaign.data.resource_id, p_from: cairoDate(new Date()), p_to: cairoDate(new Date()), p_amount_minor: 10000, p_currency: 'EGP', p_evidence_file_id: analyticEvidence, p_expense_id: expense.expense_id, p_idempotency_key: randomUUID() };
    const spend = await invokeAnalyticsCommand(f.admin, 'record_campaign_spend', args);
    expect((await invokeAnalyticsCommand(f.admin, 'record_campaign_spend', args)).data).toEqual(spend.data);
    await expect(invokeAnalyticsCommand(f.admin, 'record_campaign_spend', { ...args, p_idempotency_key: randomUUID() })).rejects.toThrow('STATE_CONFLICT');
    await invokeAnalyticsCommand(f.admin, 'correct_campaign_spend', { p_spend_entry_id: spend.data.resource_id, p_amount_minor: 8000, p_reason: 'Correct analytics share only', p_evidence_file_id: analyticEvidence, p_expected_version: 1, p_idempotency_key: randomUUID() });
    const report = await getCohortReport(f.admin, { p_from: args.p_from, p_to: args.p_to, p_as_of: new Date().toISOString(), p_campaign_id: campaign.data.resource_id });
    expect(report.spend).toMatchObject({ state: 'known', amount_minor: 8000, cac_minor: null });
    expect(Number((await f.database.query('select count(*) from finance_private.ledger_transactions')).rows[0].count)).toBe(before);
    expect(Number((await f.database.query('select count(*) from app_private.campaign_spend_revisions where spend_entry_id=$1', [spend.data.resource_id])).rows[0].count)).toBe(1);
  } finally { await f.close(); }
});

test('GT-1003 ambiguous support contacts require explicit named-learner evidence and retain link corrections', async () => {
  const f = await paymentFixture(), contact = await freshLearner(), sibling = await freshLearner(); try {
    const learnerIds = (await f.database.query('select id from app_private.learners where account_id=any($1::uuid[]) order by account_id', [[contact.accountId, sibling.accountId]])).rows.map(row => row.id as string);
    const conversation = (await invokeSupportCommand(contact.client, 'start_conversation', { p_channel: 'website', p_topic: 'Two learners need tuition', p_source_token: 'self-reported-social', p_idempotency_key: randomUUID() })).data;
    await invokeSupportCommand(contact.client, 'submit_message', { p_conversation_id: conversation.conversation_id, p_client_message_id: randomUUID(), p_text: 'Please help with the booking steps for my children.', p_idempotency_key: randomUUID() });
    const inquiryId = (await f.database.query('select id from app_private.lead_inquiries where conversation_id=$1 order by recorded_at limit 1', [conversation.conversation_id])).rows[0].id;
    type Observations = { items: { inquiry_id: string; learner_ids: string[] }[]; next_cursor: string | null };
    let before = (await f.admin.rpc('list_analytics_inquiries', { p_cursor: null, p_limit: 100 })).data as Observations;
    while (!before.items.some(row => row.inquiry_id === inquiryId) && before.next_cursor) before = (await f.admin.rpc('list_analytics_inquiries', { p_cursor: before.next_cursor, p_limit: 100 })).data as Observations;
    expect(before.items.find(row => row.inquiry_id === inquiryId)!.learner_ids).toEqual([]);
    const evidence = await f.evidence({ purpose: 'analytics_evidence', parentType: 'analytics', parentId: null });
    for (const learnerId of learnerIds) await invokeAnalyticsCommand(f.admin, 'link_inquiry_learner', { p_inquiry_id: inquiryId, p_learner_id: learnerId, p_evidence_file_id: evidence, p_reason: 'Independent synthetic named learner verification', p_idempotency_key: randomUUID() });
    const inquiry = (await listAnalyticsInquiries(f.admin, { p_learner_id: learnerIds[0] })).items.find(row => row.inquiry_id === inquiryId)!;
    expect(inquiry.learner_ids.sort()).toEqual(learnerIds.sort());
    const reversed = await invokeAnalyticsCommand(f.admin, 'review_inquiry_link', { p_inquiry_id: inquiryId, p_learner_id: learnerIds[0], p_active: false, p_evidence_file_id: evidence, p_reason: 'Synthetic corrected identity match', p_expected_version: inquiry.links.find(link => link.learner_id === learnerIds[0])!.version, p_idempotency_key: randomUUID() });
    expect(reversed.data.version).toBeGreaterThan(1);
    expect((await listAnalyticsInquiries(f.admin, { p_learner_id: learnerIds[1] })).items.find(row => row.inquiry_id === inquiryId)!.learner_ids).toEqual([learnerIds[1]]);
  } finally { await contact.client.auth.signOut({ scope: 'local' }); await sibling.client.auth.signOut({ scope: 'local' }); await f.close(); }
});

test('GT-1003/1004/1507 persisted sibling cohorts use approved individual attendance, lifetime first touch and audited correction', async () => {
  const f = await proposalFixture(); try {
    await f.link('learner'); await f.link('sibling');
    const admin = f.clients.admin, evidence = await scannedEvidence(admin), campaign = (await invokeAnalyticsCommand(admin, 'create_campaign', { p_source: 'verified_source_fixture', p_external_campaign_id: randomUUID(), p_name: 'Synthetic Cairo cutoff cohort', p_active_from: '2026-08-01', p_active_to: '2026-10-31', p_idempotency_key: randomUUID() })).data.resource_id;
    // Retained historical observations are fixture input; timestamps come from the source, never a public client assertion.
    const inquiry = (await f.database.query("select app_private.analytics_record_inquiry('support',$1,null,$2,'2026-08-31T20:59:59Z',null,null) id", [randomUUID(), f.accountIds.guardian])).rows[0].id as string;
    const repeat = (await f.database.query("select app_private.analytics_record_inquiry('support',$1,null,$2,'2026-08-31T21:00:00Z',null,null) id", [randomUUID(), f.accountIds.guardian])).rows[0].id as string;
    for (const inquiryId of [inquiry, repeat]) for (const name of ['learner', 'sibling']) await invokeAnalyticsCommand(admin, 'link_inquiry_learner', { p_inquiry_id: inquiryId, p_learner_id: f.learnerIds[name], p_evidence_file_id: evidence, p_reason: 'Synthetic verified guardian and named child evidence', p_idempotency_key: randomUUID() });
    await invokeAnalyticsCommand(admin, 'review_attribution', { p_inquiry_id: inquiry, p_attribution: 'verified_campaign', p_campaign_id: campaign, p_evidence_file_id: evidence, p_reason: 'Synthetic verified source', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const occurrence = await f.occurrence('group'), first = await f.hold(occurrence.id), second = await f.hold(occurrence.id, 'sibling'), attendanceId = randomUUID(), completionId = randomUUID();
    // Explicit isolated historical source fixture. T08 command tests prove posting; T12 consumes these approved facts without using a payment event as attendance.
    const assignment = (await f.database.query('select id from app_private.tutor_assignments where occurrence_id=$1 and active', [occurrence.id])).rows[0].id;
    await f.database.query("insert into app_private.attendance_snapshots(id,occurrence_id,version,assignment_id,actual_start_at,actual_end_at,entries,actor_account_id,command_id)values($1,$2,1,$3,'2026-09-01T10:00:00Z','2026-09-01T11:00:00Z',$4,$5,$6)", [attendanceId, occurrence.id, assignment, JSON.stringify([{ enrollment_id: first.enrollment_id, attendance: 'present', attended_seconds: 3600, reason: null }, { enrollment_id: second.enrollment_id, attendance: 'present', attended_seconds: 3600, reason: null }]), f.accountIds.tutor, randomUUID()]);
    await f.database.query("insert into app_private.completions(id,occurrence_id,assignment_id,fee_agreement_id,policy_version_id,attendance_id,topic_summary,submitted_by,command_id)values($1,$2,$3,$4,$5,$6,'Synthetic historical source-only attendance fixture',$7,$8)", [completionId, occurrence.id, assignment, occurrence.feeId, f.policyIds.group, attendanceId, f.accountIds.tutor, randomUUID()]);
    const range = () => ({ p_from: '2026-08-01', p_to: '2026-08-31', p_as_of: new Date().toISOString(), p_campaign_id: campaign });
    expect((await getCohortReport(admin, range())).summary).toMatchObject({ learners: 2, attended: 0, newly_taught: 0 });
    await f.database.query("update app_private.occurrences set state='completed',start_at='2026-09-01T10:00:00Z',end_at='2026-09-01T11:00:00Z',confirmation_deadline_at='2026-08-31T10:00:00Z'where id=$1", [occurrence.id]);
    await f.database.query("update app_private.enrollments set state='confirmed'where occurrence_id=$1", [occurrence.id]);
    await f.database.query('insert into app_private.completion_approvals(completion_id,approved_by,command_id)values($1,$2,$3)', [completionId, (await admin.auth.getUser()).data.user!.id, randomUUID()]);
    expect((await getCohortReport(admin, range())).summary).toMatchObject({ learners: 2, attended: 2, unknown_history: 2, newly_taught: 0 });
    for (const name of ['learner', 'sibling']) await invokeAnalyticsCommand(admin, 'record_learner_history', { p_learner_id: f.learnerIds[name], p_history_complete: true, p_evidence_file_id: evidence, p_reason: 'Complete synthetic lifetime source history', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const report = await getCohortReport(admin, range()); expect(report.summary).toMatchObject({ learners: 2, interactions: 4, attended: 2, newly_taught: 2, paid: 0 });
    expect(report.items.every(row => row.first_inquiry_id === inquiry && row.cohort_date === '2026-08-31')).toBe(true);
    expect((await getCohortReport(admin, { ...range(), p_from: '2026-09-01', p_to: '2026-09-30' })).summary.learners).toBe(0);
    expect((await f.database.query("select app_private.analytics_record_inquiry('support',$1,null,$2,'2026-08-31T20:59:59Z',null,null) id", [(await f.database.query('select source_event_id from app_private.lead_inquiries where id=$1', [inquiry])).rows[0].source_event_id, f.accountIds.guardian])).rows[0].id).toBe(inquiry);
    expect((await getCohortReport(admin, range())).summary.newly_taught).toBe(2);
    const workload = await getWorkloadReport(admin, { p_from: '2026-09-01', p_to: '2026-09-01', p_limit: 100, p_tutor_cursor: null });
    let tutorPage = workload; while (!tutorPage.tutors.some(row => row.tutor_id === f.tutorId) && tutorPage.tutor_next_cursor) tutorPage = await getWorkloadReport(admin, { p_from: '2026-09-01', p_to: '2026-09-01', p_limit: 100, p_tutor_cursor: tutorPage.tutor_next_cursor });
    expect(tutorPage.tutors.find(row => row.tutor_id === f.tutorId)!.delivered_seconds).toBe(3600);
    const filters = { from: '2026-08-01', to: '2026-08-31', as_of: report.as_of, observation_days: 30, campaign_id: campaign, source: null, format: null, subject_id: null };
    expect((await admin.rpc('audit_cohort_export', { p_filters: filters, p_row_count: 2, p_newly_taught_count: 2 })).error).toBeNull();
    expect((await admin.rpc('audit_cohort_export', { p_filters: filters, p_row_count: 4, p_newly_taught_count: 2 })).error?.message).toBe('STATE_CONFLICT');
  } finally { await f.close(); }
}, 90000);
