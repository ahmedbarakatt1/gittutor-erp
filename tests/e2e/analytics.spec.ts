import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { loadLocalSupabase } from '../helpers/supabase';
import { formatCairoInstant } from '../../src/modules/booking/scheduling';
test.use({ trace: 'off', screenshot: 'off' });
async function login(page: Page, label: string) { const actor = loadLocalSupabase().actors[label]; await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password); const response = page.waitForResponse(row => new URL(row.url()).pathname === '/api/auth/login' && row.request().method() === 'POST'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); expect((await response).status()).toBe(200); await expectSignedInAccount(page, actor.id); }
test('admin campaign reporting exports the same cohort; learner access and mobile layout remain bounded', async ({ page, browser }, info) => {
  test.setTimeout(90000); const separate = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  try {
    await login(page, 'admin_a'); await page.goto('/admin/campaigns'); await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
    await expect(page.getByText('New learner conversion', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Report filters' }).click();
    const choices = page.getByRole('region', { name: 'Campaign choices' }); await expect(choices.getByRole('status')).toHaveCount(0);
    await page.locator('summary').filter({ hasText: 'Create campaign' }).click();
    const name = `Browser cohort ${randomUUID().slice(0, 8)}`, form = page.getByRole('form', { name: 'Create campaign', exact: true });
    await form.getByLabel('Campaign name', { exact: true }).fill(name); await form.getByLabel('Source platform').fill('synthetic_browser'); await form.getByLabel('External campaign identifier').fill(randomUUID()); await form.getByLabel('Active from', { exact: true }).fill('2026-01-01'); await form.getByLabel('Active through', { exact: true }).fill('2027-01-01');
    const reloaded = page.waitForResponse(row => new URL(row.url()).pathname === '/api/v1/analytics/campaigns' && row.request().method() === 'GET'); const saved = page.waitForResponse(row => new URL(row.url()).pathname === '/api/v1/analytics/create_campaign'); await form.getByRole('button', { name: 'Create campaign', exact: true }).click(); expect((await saved).status()).toBe(200); expect((await reloaded).status()).toBe(200); await expect(choices.getByRole('status')).toHaveCount(0);
    await expect(form.getByRole('status')).toContainText('Campaign identity saved.');
    // Pagination is exercised through the same UI used by administrators when retained history grows.
    const campaign = page.getByLabel('Campaign', { exact: true }).first();
    while (await campaign.locator('option', { hasText: name }).count() === 0) { const more = choices.getByRole('button', { name: 'Load more', exact: true }); await expect(more).toBeVisible(); const next = page.waitForResponse(row => new URL(row.url()).pathname === '/api/v1/analytics/campaigns'); await more.click(); expect((await next).status()).toBe(200); await expect(more).toBeEnabled(); }
    await campaign.selectOption({ label: name }); await page.getByRole('button', { name: 'Show report', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Acquisition and progression' })).toBeVisible(); await expect(page.getByText('No verified learner links match this cohort.')).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export this complete cohort' }).click(); const file = await download; const stream = await file.createReadStream(); let csv = ''; for await (const chunk of stream!) csv += chunk.toString(); expect(csv).toContain('"learner_id","learner_name","first_inquiry_id"'); expect(csv.trim().split('\r\n')).toHaveLength(1); expect(csv).not.toMatch(/tutor_fee|margin|payout_destination/);
    await page.goto('/admin/team'); await expect(page.getByText(/Staffed-hours coverage is unknown/)).toBeVisible();
    await expect(page.getByText('Teaching time', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Tutor capacity' }).click();
    await expect(page.getByText('Availability uses each tutor’s current saved schedule.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await mkdir('.local/screenshots', { recursive: true }); await page.screenshot({ path: `.local/screenshots/t12-team-${info.project.name}.png`, fullPage: true });
    await page.goto('/admin/finance'); const now = formatCairoInstant(new Date().toISOString()); await page.getByLabel('From business date (Cairo)', { exact: true }).fill(now.local_date); await page.getByLabel('Through business date (Cairo)', { exact: true }).fill(now.local_date); await page.getByLabel('Records known as of (Cairo time)', { exact: true }).fill(`${now.local_date}T${now.local_time}`); await page.getByRole('button', { name: 'Review this period', exact: true }).click(); await expect(page.getByText('Gross tutor pay outstanding', { exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Cash close investigations', exact: true })).toBeVisible(); await expect(page.getByText('Tutor advances', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const learner = await separate.newPage(); await login(learner, 'learner_a'); const response = await learner.request.get(`/api/v1/analytics/cohorts?from=2026-01-01&to=2026-01-31&as_of=${encodeURIComponent(new Date().toISOString())}`); expect(response.status()).toBe(403); expect(await response.text()).not.toMatch(/tutor_fee|margin|payout_destination|learner_name/); await learner.goto('/admin/campaigns'); await expect(learner).toHaveURL(/login/);
  } finally { await separate.close(); }
});
