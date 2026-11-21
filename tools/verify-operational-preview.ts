/** Opt-in actual browser verification. Private data/artifacts stay in ignored .local. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client, Pool } from 'pg';
import type { OperationalPreviewManifest } from './import-operational-workflow';
import { operationalPreviewMarker, practiceSourceTerms, previewPdf } from './operational-preview-data';
import { workflowSnapshotSchema } from '../src/modules/workflow-import/model';
import { formatCairoInstant } from '../src/modules/booking/scheduling';
import { fileScanHandler } from '../src/worker/file-scan';
import { createFakeScanAdapter } from '../src/server/providers/file-scan';
import { claimJobs } from '../src/worker/claims';
import { executeLeasedJob } from '../src/worker/execute';
import { calendarHandler } from '../src/worker/calendar';
import { createFakeCalendarAdapter } from '../src/server/providers/calendar';
import { getOccurrenceMeeting, invokeMeetingCommandWithStatus } from '../src/modules/teaching/meetings';
import { assertHostedOperationalTarget, type HostedOperationalTarget } from './hosted-operational-target';

const hostedPreview = process.argv.includes('--hosted-preview');
const directory = resolve(hostedPreview ? '.local/hosted-preview' : '.local/operational-preview');
const config = JSON.parse(await readFile(resolve(directory, 'config.json'), 'utf8')) as HostedOperationalTarget & { publishable_key: string; secret_key: string };
assert.equal(config.marker, operationalPreviewMarker);
if (!hostedPreview) assert.equal(new URL(config.database_url).port, '54332');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as OperationalPreviewManifest;
assert.equal(manifest.marker, operationalPreviewMarker); assert.equal(manifest.state, 'ready');
const snapshot = workflowSnapshotSchema.parse(JSON.parse(await readFile('.local/workflow-import/workflow-snapshot.json', 'utf8')));
const terms = practiceSourceTerms(snapshot), baseURL = process.env.PREVIEW_VERIFY_URL || 'http://127.0.0.1:3000';
if (hostedPreview) { assertHostedOperationalTarget(config, snapshot.source_sha256, process.env.APP_ENV); assert.equal(baseURL, config.base_url); }
const mutate = process.argv.includes('--walkthrough');
assert(!mutate || baseURL === 'http://127.0.0.1:3000' || hostedPreview, 'Mutating walkthrough requires an isolated approved target');
const protection = hostedPreview ? JSON.parse(await readFile(resolve(directory, 'protection.json'), 'utf8')) as {secret:string} : null;
if (protection) assert.match(protection.secret, /^[A-Za-z0-9]{32}$/);
const browser = await chromium.launch();
const database = new Client({ connectionString: config.database_url }); await database.connect();
const worker = new Pool({ connectionString: config.worker_database_url });
const storage = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
const adminClient = createClient(config.url, config.publishable_key, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } });
const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, ...(protection ? {extraHTTPHeaders:{'x-vercel-protection-bypass':protection.secret}} : {}) })));
const [learner, service, tutor, admin] = await Promise.all(contexts.map(context => context.newPage()));
const consoleErrors: string[] = [], pageErrors: string[] = [];
const failedResponses: { path: string; status: number }[] = [];
for (const page of [learner, service, tutor, admin]) {
  page.setDefaultTimeout(20000);
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
}
type Progress = { enrollmentId?: string; chargeId?: string; receiptId?: string; caseId?: string; materialFileId?: string; confirmed?: boolean };
let progress: Progress = {};
try { progress = JSON.parse(await readFile(resolve(directory, 'verification-state.json'), 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
async function save() { await writeFile(resolve(directory, 'verification-state.json'), JSON.stringify(progress, null, 2)); }
async function login(page: Page, key: string) {
  const actor = manifest.actors[key];
  await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); assert.equal((await response).status(), 200, `${key} sign-in failed`);
  await page.waitForURL(url => url.pathname !== '/login');
  if (new URL(baseURL).protocol === 'https:') {
    const cookies = (await page.context().cookies()).filter(cookie => cookie.name.startsWith('sb-'));
    assert(cookies.length && cookies.every(cookie => cookie.secure && cookie.httpOnly), 'Public session cookies must be secure and HTTP-only');
  }
  await page.context().storageState({ path: resolve(directory, `${key.replace(':', '-')}-browser-state.json`) });
}
async function submit(page: Page, form: Locator, path: string, expected = 200) {
  const invalidFields = await form.evaluate(element => [...element.querySelectorAll<HTMLInputElement>('input,select,textarea')].filter(field => !field.checkValidity()).map(field => ({ name: field.name, type: field.type, message: field.validationMessage })));
  assert.equal(invalidFields.length, 0, `Invalid fields: ${JSON.stringify(invalidFields)}`);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click();
  const received = await response, body = await received.json();
  assert.equal(received.status(), expected, `Command ${path.split('/')[0]} failed: ${body.code || received.status()}`); return body.data;
}
async function claim(purpose: string, jobId: string) {
  await database.query('begin');
  try {
    await database.query('select id from app_private.outbox_jobs where purpose=$1 and id<>$2 for update', [purpose, jobId]);
    const jobs = await claimJobs(worker, purpose, 1, 60); assert.equal(jobs[0]?.id, jobId); return jobs[0];
  } finally { await database.query('rollback'); }
}
async function upload(page: Page, region: Locator, path: string) {
  const disclosure = region.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Upload supporting evidence$/ }) });
  if (await disclosure.count() && (await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const widget = region.getByRole('group', { name: 'Add a file', exact: true }); await widget.getByLabel('Choose a file', { exact: true }).setInputFiles(path);
  const response = page.waitForResponse(result => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(result.url()).pathname) && result.request().method() === 'POST');
  await widget.getByRole('button', { name: 'Upload and check file', exact: true }).click(); const received = await response, body = await received.json(); assert.equal(received.status(), 202);
  const id = new URL(received.url()).pathname.split('/')[4];
  const initialDownload = await page.request.get(`/api/v1/files/${id}/content`);
  if (!hostedPreview) assert.equal(initialDownload.ok(), false);
  else if (initialDownload.ok()) assert.equal((await database.query('select scan_state from app_private.file_access_states where file_id=$1',[id])).rows[0]?.scan_state,'clean');
  const handler = fileScanHandler(worker, async file => {
    const response = await storage.storage.from('git-tutor-private').download(file.object_key); assert(response.data && !response.error);
    return new Uint8Array(await response.data.arrayBuffer());
  }, scenario => createFakeScanAdapter(scenario, true));
  if (hostedPreview) {
    await expect.poll(async () => (await database.query('select scan_state from app_private.file_access_states where file_id=$1',[id])).rows[0]?.scan_state, {timeout:60000}).toBe('clean');
  } else assert.equal(await executeLeasedJob(worker, await claim('files.scan', body.data.scan_job_id), handler), 'completed');
  await widget.getByRole('button', { name: 'Refresh files', exact: true }).click(); await expect(widget.getByRole('status')).toHaveText('Check passed'); return id;
}
const privacyKeys = /^(?:tutor_fee_minor|fee_minor|reported_fee_due_minor|reported_fee_paid_minor|reported_fee_owed_minor|compensation_policy_version|internal_notes|payout_destination|provider_token|margin_minor)$/;
function customerSafe(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if ('key' in value && typeof value.key === 'string') assert(!/^(?:tutor_fee_|tutor_rate|notes$|action_needed$|google_account$|reported_balance_)/.test(value.key), 'Customer private field leak');
  for (const [key, item] of Object.entries(value)) { assert(!privacyKeys.test(key), 'Customer compensation leak'); customerSafe(item); }
}
const report: Record<string, unknown> = { started_at: new Date().toISOString(), environment: 'isolated actual-data preview', base_url: baseURL, checks: [] };
const checks = report.checks as string[];
try {
  assert.equal((await database.query('select fixture_marker from app_private.environment_metadata')).rows[0].fixture_marker, operationalPreviewMarker);
  await login(admin, 'owner'); await login(learner, 'student:5'); await login(tutor, 'tutor:5'); await login(service, 'service'); checks.push('four actual-data preview roles sign in');
  for (const [page, role] of [[learner, 'customer'], [service, 'service'], [tutor, 'tutor'], [admin, 'owner']] as const) {
    const response = await page.request.get(`/api/v1/workflow-operations?workspace=${role === 'owner' ? 'admin' : role === 'customer' ? 'learn' : role}`); assert.equal(response.status(), 200, `Operational ${role} read`);
    const data = await response.json(); if (role === 'customer' || role === 'service') customerSafe(data);
    if (role !== 'owner') assert.equal((await page.request.get('/api/v1/workflow-import')).status(), role === 'service' || role === 'tutor' || role === 'customer' ? 403 : 200);
  }
  checks.push('role-scoped operational projections and raw source archive denial');
  if (mutate) {
    const slot = manifest.verified!;
    if (!progress.enrollmentId) {
      await learner.goto(`/learn/bookings?offer=${slot.offerId}&occurrence=${slot.occurrenceId}`); await learner.getByLabel('Booking for', { exact: true }).selectOption(manifest.learnerId!);
      const hold = learner.getByRole('form', { name: 'Reserve a temporary seat', exact: true }); await hold.getByRole('checkbox').check();
      progress.enrollmentId = (await submit(learner, hold, `occurrences/${slot.occurrenceId}/holds`, 201)).enrollment_id; await save();
    }
    await learner.goto(`/learn/bookings/${progress.enrollmentId}`);
    const enrollment = (await (await learner.request.get(`/api/v1/enrollments/${progress.enrollmentId}`)).json()).data;
    if (!enrollment.quote.accepted_at) { const form = learner.getByRole('form', { name: 'Accept this quote', exact: true }); await form.getByRole('checkbox').check(); await submit(learner, form, `quotes/${enrollment.quote.quote_id}/accept`); }
    if (!progress.receiptId) {
      await learner.getByRole('link', { name: 'View payment instructions', exact: true }).click(); progress.chargeId = new URL(learner.url()).pathname.split('/').at(-1); await save();
      await learner.getByLabel('Payment channel', { exact: true }).selectOption(manifest.receivingVersionId!);
      const form = learner.getByRole('form', { name: 'Submit receipt for review', exact: true }); await form.getByLabel('Amount you transferred (EGP)', { exact: true }).fill(String(terms.tuitionMinor / 100)); await form.getByLabel('Transfer reference', { exact: true }).fill(slot.externalId);
      const proof = await upload(learner, form, resolve(directory, 'verification-receipt.pdf'));
      await form.getByLabel('Prepared evidence', { exact: true }).selectOption(proof);
      const receipt = await submit(learner, form, 'receipts', 201); progress.receiptId = receipt.receipt_id; progress.caseId = receipt.case_id; await save();
    }
    await service.goto('/service/payments');
    const ownership = (await database.query('select state,owner_id from app_private.review_cases where id=$1', [progress.caseId])).rows[0];
    if (!ownership.owner_id && ownership.state !== 'resolved') await submit(service, service.locator(`[data-case-id="${progress.caseId}"]`).getByRole('form', { name: 'Claim case', exact: true }), `review-cases/${progress.caseId}/claim`);
    // Resolved cases can leave the service actor's active review scope after its lease expires.
    if (ownership.state !== 'resolved') {
      await service.goto(`/service/payments/transfers/${slot.transferId}`);
      const transfer = (await (await service.request.get(`/api/v1/incoming-transfers/${slot.transferId}`)).json()).data;
      if (transfer.state === 'pending') {
        const form = service.getByRole('form', { name: 'Verify settled funds', exact: true }), time = formatCairoInstant(slot.observedAt);
        await form.getByLabel('Verified settlement time', { exact: true }).fill(`${time.local_date}T${time.local_time}`);
        await form.getByLabel('Settlement verification note', { exact: true }).fill('Preview practice only: independently checked the generated fake receiving statement.');
        await form.getByLabel('Prepared evidence', { exact: true }).selectOption(slot.settlementFileId); await submit(service, form, `transfers/${slot.transferId}/verify`);
      }
      if (!transfer.payer) {
        await service.goto(`/service/payments/transfers/${slot.transferId}`);
        const lookup = service.getByRole('form', { name: 'Find verified account', exact: true }); await lookup.getByLabel('Exact verified contact', { exact: true }).fill(manifest.actors['student:5'].email);
        const response = service.waitForResponse(result => new URL(result.url()).pathname.endsWith('/payer-lookup')); await lookup.getByRole('button', { name: 'Find verified account', exact: true }).click(); assert.equal((await response).status(), 200);
        const form = service.getByRole('form', { name: 'Verify source owner', exact: true }); await form.getByLabel('Verified source owner', { exact: true }).selectOption(manifest.actors['student:5'].id); await form.getByLabel('Independent ownership evidence', { exact: true }).selectOption(slot.ownershipFileId); await form.getByLabel('Reason for this action', { exact: true }).fill('Preview-only source ownership check against generated independent evidence.'); await submit(service, form, `transfers/${slot.transferId}/bind-payer`);
      }
      await service.goto(`/service/payments/${progress.caseId}`); await service.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(slot.transferId);
      await submit(service, service.getByRole('form', { name: 'Apply verified funds', exact: true }), `review-cases/${progress.caseId}/allocate`);
    }
    const funded = (await (await learner.request.get(`/api/v1/enrollments/${progress.enrollmentId}`)).json()).data;
    assert.equal(funded.state, 'confirmed'); assert.equal(funded.occurrence.state, 'confirmed'); customerSafe(funded); progress.confirmed = true; await save();
    checks.push('browser booking, exact quote consent, private receipt upload and scan, independent fake settlement/owner review, allocation and confirmation');
    assert.equal((await adminClient.auth.signInWithPassword(manifest.actors.owner)).error, null);
    assert.equal((await adminClient.rpc('connect_fake_calendar', { p_idempotency_key: 'operational-verification-calendar-v1' })).error, null);
    const meeting = await getOccurrenceMeeting(adminClient, slot.occurrenceId, { view: 'admin' });
    if (hostedPreview) {
      await expect.poll(async () => (await getOccurrenceMeeting(adminClient, slot.occurrenceId, {view:'admin'})).meeting_status, {timeout:60000}).toBe('ready');
    } else if (meeting.meeting_status !== 'ready') {
      const existing = (await database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.purpose='calendar.sync' and e.aggregate_id=$1 and j.state='pending' and j.available_at<=now() order by j.created_at desc limit 1", [slot.occurrenceId])).rows[0];
      const jobId = existing?.id || ((await invokeMeetingCommandWithStatus(adminClient, 'retry_meeting_provisioning', { p_occurrence_id: slot.occurrenceId, p_expected_version: meeting.occurrence_version, p_idempotency_key: randomUUID() })).data as { job_id: string }).job_id;
      assert.equal(await executeLeasedJob(worker, await claim('calendar.sync', jobId), calendarHandler(worker, () => createFakeCalendarAdapter(resolve(directory, 'fake-calendar')))), 'completed');
    }
    await tutor.goto(`/tutor/schedule?occurrence=${slot.occurrenceId}`);
    const material = previewPdf(['Practice study material', 'This file contains no tutor compensation.']); await writeFile(resolve(directory, 'practice-material.pdf'), material);
    if (!progress.materialFileId) {
      const resources = tutor.locator('section').filter({ has: tutor.getByRole('heading', { level: 2, name: 'Class resources', exact: true }) }).last();
      progress.materialFileId = await upload(tutor, resources, resolve(directory, 'practice-material.pdf'));
      const response = tutor.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/files/${progress.materialFileId}/publish`);
      await resources.getByRole('button', { name: 'Publish to this session', exact: true }).click(); assert.equal((await response).status(), 200); await save();
    }
    const downloaded = await learner.request.get(`/api/v1/files/${progress.materialFileId}/content`); assert.equal(downloaded.status(), 200);
    assert.equal(createHash('sha256').update(await downloaded.body()).digest('hex'), createHash('sha256').update(material).digest('hex'));
    checks.push('fake meeting provisioning and exact authorized study-file download');
  }
  if (!mutate && progress.confirmed) {
    const response = await learner.request.get(`/api/v1/enrollments/${progress.enrollmentId}`); assert.equal(response.status(), 200);
    const enrollment = (await response.json()).data; assert.equal(enrollment.state, 'confirmed'); customerSafe(enrollment);
    assert.equal((await learner.request.get('/api/v1/tutor/statement')).status(), 403);
    assert.equal((await service.request.get('/api/v1/tutor/statement')).status(), 403);
    if (progress.materialFileId) {
      const download = await learner.request.get(`/api/v1/files/${progress.materialFileId}/content`); assert.equal(download.status(), 200);
      assert.equal(createHash('sha256').update(await download.body()).digest('hex'), createHash('sha256').update(await readFile(resolve(directory, 'practice-material.pdf'))).digest('hex'));
    }
    const statementResponse = await tutor.request.get('/api/v1/tutor/statement'); assert.equal(statementResponse.status(), 200);
    const statement = (await statementResponse.json()).data; assert(statement.earned_minor > 0 && statement.settled_minor > 0);
    checks.push('confirmed booking, customer/service payroll denial, exact private download and tutor-only positive fake payout statement');
  }
  const routes = ['/admin', '/admin/schedule', '/admin/customers', '/admin/packages', '/admin/payments', '/admin/finance', '/admin/pay', '/admin/sessions', '/admin/students', '/admin/team', '/admin/campaigns'];
  await mkdir(resolve(directory, 'screenshots'), { recursive: true });
  const layouts: { path: string; width: number; overflow: boolean }[] = [];
  for (const width of [1440, 360]) {
    await admin.setViewportSize({ width, height: 1000 });
    for (const path of routes) {
      const response = await admin.goto(path); assert.equal(response?.status(), 200);
      await expect(admin.locator('[data-workflow-operations]')).toBeVisible();
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); assert.equal(overflow, false, `Overflow ${path} ${width}`);
      layouts.push({ path, width, overflow });
    }
    await admin.goto('/admin'); await expect(admin.locator('[data-workflow-operations]')).toBeVisible();
    await admin.screenshot({ path: resolve(directory, 'screenshots', `dashboard-${width}.png`), fullPage: true });
  }
  await contexts[3].storageState({ path: resolve(directory, 'owner-browser-state.json') });
  assert.equal((await database.query('select count(*)::int n from app_private.enrollments where occurrence_id=$1', [manifest.personal!.occurrenceId])).rows[0].n, 0, 'Personal session must remain untouched');
  assert.equal(pageErrors.length, 0, 'Unexpected browser page errors');
  checks.push('eleven main admin screens at desktop/mobile; untouched personal practice session');
  Object.assign(report, { completed_at: new Date().toISOString(), outcome: 'passed', layouts, page_error_count: pageErrors.length, console_error_count: consoleErrors.length });
  await writeFile(resolve(directory, `browser-${mutate ? 'walkthrough' : 'read'}-report.json`), JSON.stringify(report, null, 2));
  await writeFile(resolve(directory, 'browser-diagnostics.json'), JSON.stringify({ consoleErrors, pageErrors, failedResponses }, null, 2));
  console.log(JSON.stringify({ outcome: 'passed', checks: checks.length, layouts: layouts.length, page_errors: pageErrors.length, console_errors: consoleErrors.length }));
} catch (error) {
  await mkdir(resolve(directory, 'screenshots'), { recursive: true });
  for (const [page, role] of [[learner, 'customer'], [service, 'service'], [tutor, 'tutor'], [admin, 'owner']] as const) {
    await page.screenshot({ path: resolve(directory, 'screenshots', `failure-${role}.png`), fullPage: true });
    await writeFile(resolve(directory, `failure-${role}.txt`), await page.locator('body').innerText());
  }
  throw error;
} finally { await Promise.all(contexts.map(context => context.close())); await browser.close(); await adminClient.auth.signOut({ scope: 'local' }); await worker.end(); await database.end(); }
