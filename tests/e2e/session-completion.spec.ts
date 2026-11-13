import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { completionFixture } from '../helpers/completion';
import { loadLocalSupabase } from '../helpers/supabase';
import { formatCairoInstant } from '../../src/modules/booking/scheduling';

test.use({ trace: 'off', screenshot: 'off' });
async function login(page: Page, actor: { id: string; email: string; password: string }) {
  await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); expect((await response).status()).toBe(200); await expect(page.getByTestId('account-id')).toHaveText(actor.id, { timeout: 15000 });
}
function local(value: number) { const time = formatCairoInstant(new Date(value).toISOString()); return `${time.local_date}T${time.local_time}`; }
async function submit(page: Page, form: Locator, path: string, label: string) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: label, exact: true }).click(); const received = await response, body = await received.json(); expect(received.status(), body.message).toBe(200); return body.data;
}
test('assigned tutor records actual delivery and admin approval posts one confidential earning', async ({ browser }, info) => {
  test.setTimeout(90000);
  // Only consistent historical admission is fixture setup; all factual delivery and approval below use the real UI/API.
  const f = await completionFixture(), contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: info.project.use.viewport })));
  try {
    const [tutor, admin, customer] = await Promise.all(contexts.map(context => context.newPage()));
    await login(tutor, f.actor); await tutor.goto(`/tutor/schedule?occurrence=${f.occurrenceId}`);
    const delivery = tutor.getByRole('region', { name: 'Session delivery', exact: true }), startedAt = Math.ceil(Date.parse(f.actualStart) / 60000) * 60000;
    const start = delivery.getByRole('form', { name: 'Record session start', exact: true });
    await start.getByLabel('Actual start (Cairo time)', { exact: true }).fill(local(startedAt));
    await submit(tutor, start, `occurrences/${f.occurrenceId}/start`, 'Record session start');
    await delivery.locator('summary').filter({ hasText: /^Attendance$/ }).click();
    const attendance = delivery.getByRole('form', { name: 'Save attendance', exact: true });
    await attendance.getByLabel('Actual end (Cairo time)', { exact: true }).fill(local(startedAt + 3600000));
    await attendance.getByLabel('Attendance status', { exact: true }).selectOption('present');
    await attendance.getByLabel('Seconds attended', { exact: true }).fill('3600');
    await submit(tutor, attendance, `occurrences/${f.occurrenceId}/attendance`, 'Save attendance');
    const completion = delivery.getByRole('form', { name: 'Submit delivery for approval', exact: true });
    await completion.getByLabel('Topics covered and delivery notes', { exact: true }).fill('Worked through derivatives and the learner completed the practice questions.');
    await submit(tutor, completion, `occurrences/${f.occurrenceId}/completion`, 'Submit delivery for approval');
    await expect(delivery.getByRole('heading', { name: 'Awaiting approval', exact: true })).toBeVisible();
    await expect(delivery.getByRole('heading', { name: 'Recorded teaching earning', exact: true })).toHaveCount(0);
    await login(admin, loadLocalSupabase().actors.admin_a); await admin.goto(`/admin/schedule?occurrence=${f.occurrenceId}`);
    const review = admin.getByRole('region', { name: 'Session delivery', exact: true });
    await expect(review.getByText('Worked through derivatives and the learner completed the practice questions.', { exact: true })).toBeVisible();
    const approval = review.getByRole('form', { name: 'Approve session delivery', exact: true });
    await approval.getByRole('checkbox', { name: 'I reviewed the actual attendance, delivery notes and required remedies.', exact: true }).check();
    const result = await submit(admin, approval, `occurrences/${f.occurrenceId}/completion/approve`, 'Approve session delivery');
    await expect(review.getByRole('heading', { name: 'Approved', exact: true })).toBeVisible();
    await expect(review.getByRole('heading', { name: 'Recorded teaching earning', exact: true })).toBeVisible();
    expect((await f.database.query('select count(*)::int n from finance_private.tutor_earnings where occurrence_id=$1', [f.occurrenceId])).rows[0].n).toBe(1);
    expect((await f.database.query('select amount_minor from finance_private.tutor_earnings where id=$1', [result.base_earning_id])).rows[0].amount_minor).toBe('25000');
    await tutor.reload(); await expect(delivery.getByRole('heading', { name: 'Recorded teaching earning', exact: true })).toBeVisible();
    await login(customer, loadLocalSupabase().actors.learner_a);
    expect((await customer.request.get(`/api/v1/occurrences/${f.occurrenceId}/delivery?view=tutor`)).status()).toBe(403);
    const customerBooking = await customer.request.get(`/api/v1/enrollments/${f.enrollmentId}`); expect(customerBooking.status()).toBe(200);
    expect(JSON.stringify(await customerBooking.json())).not.toMatch(/fee_minor|base_earning_id|compensation|tutor_earnings|internal_notes/);
    await mkdir('.local/screenshots', { recursive: true }); await mkdir('.local/ui-review', { recursive: true });
    await review.screenshot({ path: `.local/screenshots/t08-approved-delivery-${info.project.name}.png` });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await contexts[0].storageState({ path: `.local/ui-review/t08-delivery-${info.project.name}-tutor.json` });
    await contexts[1].storageState({ path: `.local/ui-review/t08-delivery-${info.project.name}-admin.json` });
    await writeFile(`.local/ui-review/t08-delivery-${info.project.name}.json`, JSON.stringify({ occurrenceId: f.occurrenceId, enrollmentId: f.enrollmentId }));
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});
