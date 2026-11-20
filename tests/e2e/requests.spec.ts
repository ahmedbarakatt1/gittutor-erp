import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loadLocalSupabase } from '../helpers/supabase';
import { expectSignedInAccount } from '../helpers/browser-auth';
import { requestFixture } from '../helpers/requests';
import { runFileScan, syntheticPdf } from '../helpers/files';

test.use({ trace: 'off' });
const forbidden = /tutor_fee|fee_agreement|compensation|margin_minor|internal_notes|payout_destination/;
async function login(page: Page, label: string) {
  const actor = loadLocalSupabase().actors[label];
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectSignedInAccount(page, actor.id);
}
test('customer material request goes through staff review into a separately consented booking', async ({ browser, page }) => {
  test.setTimeout(120000);
  const f = await requestFixture(), staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' }), strangerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  const staff = await staffContext.newPage(), stranger = await strangerContext.newPage(), topic = `Astronomy ${randomUUID().slice(0, 8)}`;
  try {
    await f.availability(); const occurrence = await f.eligibleOccurrence(68125, 105);
    await login(page, 'learner_a');
    await page.goto('/learn/requests');
    await page.getByLabel('Who is the session for?', { exact: true }).selectOption(f.learners[0]);
    await page.getByLabel('Subject or topic', { exact: true }).fill(topic);
    const historyShortcut = page.getByRole('link', { name: 'Your requests', exact: true });
    if (await historyShortcut.isVisible()) {
      await historyShortcut.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#request-history')).toBeFocused();
      await page.getByRole('link', { name: 'Back to request form', exact: true }).press('Enter');
      await expect(page.locator('#request-content')).toBeFocused();
      await expect(page.getByLabel('Subject or topic', { exact: true })).toHaveValue(topic);
    }
    await page.getByLabel('Course or university (optional)', { exact: true }).fill('A course outside the example subject list');
    await page.getByLabel('What would you like help with?', { exact: true }).fill('Explain the lecture slides and work through the orbit examples.');
    await page.getByLabel('Preferred days and times', { exact: true }).fill('Sunday after 6 pm, Egypt time.');
    await page.getByRole('button', { name: 'Continue to upload material', exact: true }).click();
    await page.waitForURL(/\/learn\/requests\?request=/);
    const requestId = new URL(page.url()).searchParams.get('request')!;
    await expect(page.getByRole('button', { name: 'Submit tutoring request', exact: true })).toBeDisabled();
    await page.getByLabel('Choose a file', { exact: true }).setInputFiles({ name: 'lecture-slides.pdf', mimeType: 'application/pdf', buffer: syntheticPdf });
    const completed = page.waitForResponse(response => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Upload and check file', exact: true }).click();
    const response = await completed, upload = await response.json(); expect(response.status()).toBe(202);
    const fileId = new URL(response.url()).pathname.split('/')[4];
    expect((await page.request.get(`/api/v1/files/${fileId}/content`)).ok()).toBe(false);
    await expect(page.getByRole('listitem').filter({ hasText: 'lecture-slides.pdf' })).toContainText('Upload or safety check in progress');
    await page.getByText('Edit your request details', { exact: true }).click();
    const brief = page.getByLabel('What would you like help with?', { exact: true });
    await brief.fill('Keep this unsaved edit while the file scan is pending.');
    await page.waitForResponse(r => r.url().endsWith(`/api/v1/requests/${requestId}`) && r.request().method() === 'GET' && r.ok());
    await expect(brief).toHaveValue('Keep this unsaved edit while the file scan is pending.');
    await runFileScan(upload.data.scan_job_id);
    await expect(page.getByRole('button', { name: 'Submit tutoring request', exact: true })).toBeEnabled({ timeout: 20000 });
    const submitted = page.waitForResponse(r => r.url().endsWith(`/requests/${requestId}/submit`));
    await page.getByRole('button', { name: 'Submit tutoring request', exact: true }).click();
    expect((await submitted).ok()).toBe(true);
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    const customer = await page.request.get(`/api/v1/requests/${requestId}`); expect(await customer.text()).not.toMatch(forbidden);
    await login(stranger, 'learner_b');
    expect((await stranger.request.get(`/api/v1/requests/${requestId}`)).status()).toBe(404);
    expect((await stranger.request.get(`/api/v1/files/${fileId}/content`)).ok()).toBe(false);
    await login(staff, 'cs_a');
    await staff.goto(`/service/requests?request=${requestId}`);
    await expect(staff.getByRole('heading', { name: topic, exact: true })).toBeVisible();
    const download = await staff.request.get(`/api/v1/files/${fileId}/content`); expect(download.ok()).toBe(true); expect(await download.body()).toEqual(syntheticPdf);
    await staff.getByLabel('Next step', { exact: true }).selectOption('needs_information');
    await staff.getByLabel('Reply to the student or parent', { exact: true }).fill('Please tell us which slide you want to start with.');
    await staff.getByRole('button', { name: 'Save review and reply', exact: true }).click();
    await expect(staff.getByText('More information needed', { exact: true }).first()).toBeVisible();
    await page.reload(); await expect(page.getByText('Please tell us which slide you want to start with.', { exact: true })).toBeVisible();
    await page.getByText('Edit your request details', { exact: true }).click();
    await page.getByLabel('What would you like help with?', { exact: true }).fill('Start with slide 4, especially the orbit examples.');
    await page.getByRole('button', { name: 'Save request details', exact: true }).click();
    await expect(page.locator('p').filter({ hasText: /^Start with slide 4, especially the orbit examples\.$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Submit tutoring request', exact: true }).click();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await staff.reload(); await staff.getByLabel('Next step', { exact: true }).selectOption('matched');
    const selector = staff.getByLabel('Proposed session', { exact: true });
    for (let i = 0; i < 20 && !(await selector.locator(`option[value="${occurrence.occurrence_id}"]`).count()); i++) {
      const more = staff.getByRole('button', { name: 'Load more results', exact: true });
      if (await more.isVisible()) await more.click(); else await staff.waitForTimeout(200);
    }
    await selector.selectOption(String(occurrence.occurrence_id));
    await expect(selector.locator('option:checked')).toContainText('681.25');
    await expect(selector.locator('option:checked')).toContainText('1 seat available');
    await staff.getByLabel('Reply to the student or parent', { exact: true }).fill('Your individual session is ready to review.');
    await staff.getByRole('button', { name: 'Save review and reply', exact: true }).click();
    await expect(staff.getByText('Session proposed', { exact: true }).first()).toBeVisible();
    await page.reload(); await page.getByRole('link', { name: 'Review and book this session', exact: true }).click();
    await expect(page).toHaveURL(/\/learn\/bookings\?offer=/);
    await page.getByLabel('Booking for', { exact: true }).selectOption(f.learners[0]);
    await expect(page.getByRole('heading', { name: 'Review before reserving', exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('681.25');
    expect(await page.content()).not.toMatch(forbidden);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const reserve = () => page.request.post(`/api/v1/occurrences/${occurrence.occurrence_id}/holds`, {
      headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { learner_id: f.learners[0] },
    });
    const held = await reserve();
    expect(held.status()).toBe(201);
    const { enrollment_id } = (await held.json()).data;
    expect((await reserve()).status()).toBe(409);
    await page.goto(`/learn/requests?request=${requestId}`);
    await expect(page.getByRole('link', { name: 'Open your booking' })).toHaveAttribute('href', `/learn/bookings/${enrollment_id}`);
  } finally { await staffContext.close(); await strangerContext.close(); await f.close(); }
});

test('request creation preserves an interrupted retry and accepts a later identical draft', async ({ page }) => {
  test.setTimeout(60000);
  await login(page, 'learner_a');
  const topic = `Electronics ${randomUUID().slice(0, 8)}`;
  let committedId: string | undefined;
  let firstKey: string | undefined;
  await page.route('**/api/v1/requests', async route => {
    if (route.request().method() !== 'POST' || committedId) return route.continue();
    firstKey = route.request().headers()['idempotency-key'];
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = (await response.json()).data.resource_id;
    await route.abort();
  });
  async function submit() {
    await page.getByLabel('Subject or topic', { exact: true }).fill(topic);
    await page.getByLabel('What would you like help with?', { exact: true }).fill('Review these circuit examples.');
    await page.getByLabel('Preferred days and times', { exact: true }).fill('Sunday after 6 pm, Egypt time.');
    await page.getByRole('button', { name: 'Continue to upload material', exact: true }).click();
  }
  await page.goto('/learn/requests');
  await submit();
  await expect(page.getByRole('form', { name: 'Continue to upload material' }).getByRole('alert')).toBeVisible();
  expect(committedId).toBeTruthy();
  expect(firstKey).toBeTruthy();
  await page.reload();
  const retry = page.waitForResponse(r => r.url().endsWith('/api/v1/requests') && r.request().method() === 'POST');
  await submit();
  const acknowledgement = await retry;
  expect(acknowledgement.status()).toBe(200);
  expect(acknowledgement.request().headers()['idempotency-key']).toBe(firstKey);
  await expect(page).toHaveURL(`/learn/requests?request=${committedId}`);

  await page.getByRole('link', { name: 'New request', exact: true }).click();
  const next = page.waitForResponse(r => r.url().endsWith('/api/v1/requests') && r.request().method() === 'POST');
  await submit();
  const created = await next;
  expect(created.status()).toBe(201);
  expect(created.request().headers()['idempotency-key']).not.toBe(firstKey);
  const nextId = (await created.json()).data.resource_id;
  expect(nextId).not.toBe(committedId);
  await expect(page).toHaveURL(`/learn/requests?request=${nextId}`);
});
