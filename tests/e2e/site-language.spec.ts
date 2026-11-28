import { expect, test } from '@playwright/test';
import { loadLocalSupabase } from '../helpers/supabase';

test('a visitor switches languages, keeps the choice across pages and can return to English', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('h1')).toContainText(/[\u0600-\u06ff]/);
  for (const route of ['/subjects', '/offers', '/login', '/support']) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('h1')).toContainText(/[\u0600-\u06ff]/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const other = await browser.newContext();
  try {
    const fresh = await other.newPage();
    await fresh.goto(new URL('/subjects', page.url()).href);
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'en');
  } finally { await other.close(); }
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('Arabic sign-in opens the same authorized learner workspace with Arabic navigation', async ({ page }) => {
  const actor = loadLocalSupabase().actors.learner_a;
  await page.goto('/login');
  await page.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.locator('input[type=email]').fill(actor.email);
  await page.locator('input[type=password]').fill(actor.password);
  await page.locator('form').filter({ has: page.locator('input[type=password]') }).getByRole('button', { name: /دخول/ }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main h1')).toContainText(/[\u0600-\u06ff]/);
  const account = await page.request.get('/api/v1/me');
  expect((await account.json()).data.account_id).toBe(actor.id);
});
