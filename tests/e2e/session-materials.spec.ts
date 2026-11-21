import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { runFileScan, syntheticPdf } from '../helpers/files';
import { loadLocalSupabase } from '../helpers/supabase';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { provisionFakeMeeting } from '../helpers/calendar';
import { bookingFixture } from '../helpers/booking';

test.use({ trace: 'off', screenshot: 'off' });
const baseURL = 'http://127.0.0.1:3000';
async function login(page: Page, label: string | { id: string; email: string; password: string }) {
  const actor = typeof label === 'string' ? loadLocalSupabase().actors[label] : label;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expectSignedInAccount(page, actor.id);
}
function section(page: Page, name: string) { return page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) }).last(); }
async function upload(page: Page, region: Locator, filename: string, interrupt = false) {
  console.log('Selecting material');
  const widget = region.getByRole('group', { name: 'Add a file', exact: true });
  await widget.getByLabel('Choose a file', { exact: true }).setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: syntheticPdf });
  const intents: { key: string | undefined; body: string | null; id: string }[] = [];
  page.on('response', async function capture(response) {
    if (new URL(response.url()).pathname === '/api/v1/files' && response.request().method() === 'POST' && response.ok()) {
      const body = await response.json(); intents.push({ key: response.request().headers()['idempotency-key'], body: response.request().postData(), id: body.data.file_id });
    }
  });
  if (interrupt) {
    console.log('Preparing one interrupted PUT');
    await page.route('**/api/v1/files/*/content', route => route.request().method() === 'PUT' ? route.abort('connectionreset') : route.continue(), { times: 1 });
    await widget.getByRole('button', { name: 'Upload and check file', exact: true }).click();
    console.log('Interrupted upload clicked');
    await expect(widget.getByRole('alert')).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Retry this upload', exact: true })).toBeEnabled();
  }
  const completed = page.waitForResponse(response => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 10000 });
  const uploaded = page.waitForResponse(response => /\/api\/v1\/files\/[^/]+\/content$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT', { timeout: 10000 });
  console.log('Clicking upload retry or initial upload');
  await widget.getByRole('button', { name: interrupt ? 'Retry this upload' : 'Upload and check file', exact: true }).click();
  console.log('Upload click returned');
  const uploadedResponse = await uploaded; expect(uploadedResponse.status()).toBe(200);
  console.log('Material bytes accepted');
  const response = await completed, payload = await response.json();
  expect(response.status(), payload.message).toBe(202);
  console.log('Material scan queued');
  const fileId = new URL(response.url()).pathname.split('/')[4];
  if (interrupt) { await expect.poll(() => intents.length).toBe(2); expect(intents[1]).toEqual(intents[0]); }
  await expect(widget.getByRole('status')).toHaveText('File check in progress. Access stays unavailable until it finishes.');
  console.log('Checking pending content denial');
  expect((await page.request.get(`/api/v1/files/${fileId}/content`, { timeout: 10000 })).ok()).toBe(false);
  console.log('Pending content denied; executing restricted scan worker');
  await runFileScan(payload.data.scan_job_id);
  await widget.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(widget.getByRole('status')).toHaveText('Check passed');
  await expect(widget.getByText('Development check: simulated scanner. This is not a live malware-scan attestation.', { exact: true })).toBeVisible();
  return fileId;
}
async function download(page: Page, fileId: string) {
  const response = await page.request.get(`/api/v1/files/${fileId}/content`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(createHash('sha256').update(syntheticPdf).digest('hex'));
}

test('large private material recovers interrupted pieces and a lost final acknowledgement', async ({ page }) => {
  test.setTimeout(90_000);
  test.info().annotations.push({ type: 'transport-fixture', description: 'Only a host payload ceiling, one dropped request and one lost final acknowledgement are simulated; Auth, SQL, Storage and scan-worker execution are real local services.' });
  const fixture = await bookingFixture();
  try {
    await fixture.availability(); const occurrence = await fixture.occurrence(), enrollment = await fixture.reserve(String(occurrence.occurrence_id));
    await login(page, 'learner_a'); await page.goto(`/learn/files?enrollment=${enrollment.enrollment_id}`);
    const bytes = Buffer.alloc(5 * 1024 * 1024, 32); bytes.write('%PDF-1.4\n'); bytes.write('\n%%EOF\n', bytes.length - 7);
    const requests: { size: number; range: string | undefined }[] = []; let interruptions = 0;
    await page.route('**/api/v1/files/*/content', async route => {
      const request = route.request(); if (request.method() !== 'PUT') return route.continue();
      const size = request.postDataBuffer()?.length ?? 0, range = request.headers()['content-range']; requests.push({ size, range });
      if (size > 4_500_000) return route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ message: 'Host payload limit exceeded' }) });
      if (range?.startsWith('bytes 3145728-') && interruptions < 2) {
        interruptions++;
        if (interruptions === 2) expect((await route.fetch()).status()).toBe(200);
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    const widget = section(page, 'Private preparation').getByRole('group', { name: 'Add a file', exact: true });
    await widget.getByLabel('Choose a file', { exact: true }).setInputFiles({ name: 'large-private-preparation.pdf', mimeType: 'application/pdf', buffer: bytes });
    await widget.getByRole('button', { name: 'Upload and check file', exact: true }).click();
    await expect(widget.getByRole('alert')).toBeVisible();
    await widget.getByRole('button', { name: 'Retry this upload', exact: true }).click();
    await expect(widget.getByRole('button', { name: 'Retry this upload', exact: true })).toBeEnabled();
    await expect(widget.getByRole('alert')).toBeVisible();
    const [completed] = await Promise.all([
      page.waitForResponse(response => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST'),
      widget.getByRole('button', { name: 'Retry this upload', exact: true }).click(),
    ]);
    expect(completed.status()).toBe(202); expect(interruptions).toBe(2);
    expect(requests).toEqual([
      { size: 3145728, range: 'bytes 0-3145727/5242880' }, { size: 2097152, range: 'bytes 3145728-5242879/5242880' },
      { size: 3145728, range: 'bytes 0-3145727/5242880' }, { size: 2097152, range: 'bytes 3145728-5242879/5242880' },
      { size: 3145728, range: 'bytes 0-3145727/5242880' },
    ]);
    const fileId = new URL(completed.url()).pathname.split('/')[4], body = await completed.json();
    expect((await page.request.get(`/api/v1/files/${fileId}/content`)).ok()).toBe(false);
    expect(await runFileScan(body.data.scan_job_id)).toBe('completed');
    const downloaded = await page.request.get(`/api/v1/files/${fileId}/content`);
    expect(downloaded.status()).toBe(200); expect(downloaded.headers()['cache-control']).toContain('no-store');
    expect(createHash('sha256').update(await downloaded.body()).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(JSON.stringify(await (await page.request.get(`/api/v1/files/${fileId}`)).json())).not.toMatch(/object_key|part_keys|tutor_fee|lease_token|authorization_id/);
    expect((await fixture.database.query('select count(*)::int n from app_private.files where id=$1', [fileId])).rows[0].n).toBe(1);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await fixture.close(); }
});

test('actual private preparation retries safely, publishes a separate class resource and revokes its saved download', async ({ browser }, info) => {
  test.setTimeout(120_000);
  // Genuine funding/confirmation is setup; the uploaded material below uses actual bytes and a real leased scan worker.
  const f = await paymentFixture(), held = await f.hold(), second = await f.reserve(held.occurrenceId, 1);
  const quote = await f.rpc('get_quote', { p_quote_id: second.quote_id }, f.students[1]);
  await f.rpc('accept_quote', { p_quote_id: second.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[1]);
  await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Synthetic material access fixture', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const receiving = await f.receiving();
  await settleEnrollment(f, held.enrollmentId, 0, 57500, receiving);
  await settleEnrollment(f, String(second.enrollment_id), 1, 57500, receiving);
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [customer, peer, tutor, operator] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [customer, peer, tutor, operator]) page.setDefaultTimeout(10000);
    await login(customer, 'learner_a'); await customer.goto(`/learn/files?enrollment=${held.enrollmentId}`);
    const preparation = section(customer, 'Private preparation');
    const privateId = await upload(customer, preparation, 'my-preparation.pdf', true);
    await download(customer, privateId);
    expect(JSON.stringify(await (await customer.request.get(`/api/v1/files/${privateId}`)).json())).not.toMatch(/fee_minor|compensation|object_key|provider_token|internal_notes/);
    await login(peer, 'learner_b'); await peer.goto(`/learn/files?enrollment=${second.enrollment_id}`);
    expect((await peer.request.get(`/api/v1/files/${privateId}`)).ok()).toBe(false);
    expect((await peer.request.get(`/api/v1/files/${privateId}/content`)).ok()).toBe(false);
    await expect(peer.getByText('my-preparation.pdf', { exact: true })).toHaveCount(0);

    await login(tutor, f.actor); await tutor.goto(`/tutor/schedule?occurrence=${held.occurrenceId}`);
    await tutor.getByLabel('Learner preparation', { exact: true }).selectOption(held.enrollmentId);
    await expect(section(tutor, 'Private preparation').getByRole('heading', { name: 'my-preparation.pdf', exact: true })).toBeVisible();
    await download(tutor, privateId);
    const resources = section(tutor, 'Class resources'), sharedId = await upload(tutor, resources, 'class-handout.pdf');
    expect((await peer.request.get(`/api/v1/files/${sharedId}/content`)).ok()).toBe(false);
    const resource = resources.getByRole('listitem').filter({ has: tutor.getByRole('heading', { name: 'class-handout.pdf', exact: true }) });
    const published = tutor.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/files/${sharedId}/publish` && response.request().method() === 'POST');
    await resource.getByRole('button', { name: 'Publish to this session', exact: true }).click(); expect((await published).status()).toBe(200);
    await peer.reload(); await expect(section(peer, 'Class resources').getByRole('heading', { name: 'class-handout.pdf', exact: true })).toBeVisible();
    await download(peer, sharedId);
    await mkdir('.local/screenshots', { recursive: true }); await mkdir('.local/ui-review', { recursive: true });
    await peer.screenshot({ path: `.local/screenshots/t07-materials-${info.project.name}.png`, fullPage: true });
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await contexts[1].storageState({ path: `.local/ui-review/t07-materials-${info.project.name}-customer.json` });
    await contexts[2].storageState({ path: `.local/ui-review/t07-materials-${info.project.name}-tutor.json` });
    await writeFile(`.local/ui-review/t07-materials-${info.project.name}.json`, JSON.stringify({ occurrenceId: held.occurrenceId, enrollmentId: second.enrollment_id, privateId, sharedId }));
    await resource.locator('summary').filter({ hasText: /^Withdraw this resource$/ }).click();
    await resource.getByLabel('Reason for withdrawing', { exact: true }).fill('Replace this class handout after review.');
    const withdrawn = tutor.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/files/${sharedId}/withdraw` && response.request().method() === 'POST');
    await resource.getByRole('button', { name: 'Withdraw this resource', exact: true }).click(); expect((await withdrawn).status()).toBe(200);
    expect((await peer.request.get(`/api/v1/files/${sharedId}/content`)).ok()).toBe(false);
    await peer.reload(); await expect(section(peer, 'Class resources').getByRole('heading', { name: 'class-handout.pdf', exact: true })).toHaveCount(0);
    await login(operator, 'admin_a'); await operator.goto('/admin/integrations');
    const connected = operator.waitForResponse(response => new URL(response.url()).pathname === '/api/calendar/connect' && response.request().method() === 'POST');
    await operator.getByRole('button', { name: /^(Connect simulated calendar|Add simulated organizer)$/ }).click();
    expect((await connected).status()).toBe(200);
    await expect(operator.getByRole('status').filter({ hasText: 'The simulated organizer is connected.' })).toBeVisible();
    expect((await provisionFakeMeeting(f, held.occurrenceId)).meeting_status).toBe('ready');
    await peer.goto(`/learn/bookings/${second.enrollment_id}`);
    const room = peer.getByRole('region', { name: 'Session room', exact: true });
    await expect(room.getByText('Room ready', { exact: true })).toBeVisible();
    const roomButton = room.getByRole('button', { name: 'Preview simulated meeting', exact: true });
    await expect(roomButton).toBeInViewport();
    await expect(peer.getByText('Study files and class resources', { exact: true }).locator('..')).not.toHaveAttribute('open', '');
    await expect(room.getByRole('timer')).toContainText('Starts in');
    const access = peer.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/occurrences/${held.occurrenceId}/meeting/access`);
    await roomButton.click();
    const accessResponse = await access; expect(accessResponse.status()).toBe(200);
    expect(JSON.stringify(await accessResponse.json())).not.toMatch(/fee_minor|compensation|provider_token|refresh_token|internal_notes/);
    await expect(room.getByRole('region', { name: 'Simulated room preview', exact: true })).toBeVisible();
    await room.screenshot({ path: `.local/screenshots/t07-meeting-${info.project.name}.png` });
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } catch (error) { console.error(error instanceof Error ? error.message : 'MATERIAL_BROWSER_CHECK_FAILED'); throw error; }
  finally { await Promise.all(contexts.map(async context => { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); })); await f.close(); }
});
