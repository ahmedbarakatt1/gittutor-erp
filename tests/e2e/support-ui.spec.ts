import { expect, test } from '@playwright/test';

// UI-only fixture. Ownership and persistence are covered by the support integration suite.
test('support entry separates contact options and preserves a failed session retry', async ({ page }, info) => {
  let attempts = 0;
  await page.route('**/api/v1/support/session', route => {
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 503 : 200,
      json: attempts === 1 ? { code: 'DEPENDENCY_UNAVAILABLE' } : { data: {} },
    });
  });
  await page.route('**/api/v1/support', route => route.fulfill({ json: { data: { items: [], next_cursor: null } } }));
  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Let’s work it out.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Website support' })).toBeVisible();
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', 'https://wa.me/201508823452');
  const start = page.getByRole('button', { name: 'Start a conversation', exact: true });
  await start.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Support could not connect' })).toBeVisible();
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.local/screenshots/t11-support-entry-${info.project.name}.png`, fullPage: true });
  await start.click();
  await expect(page.getByRole('heading', { name: 'Your conversations' })).toBeVisible();
  await expect(page.getByText('Keep payment credentials and private documents in your secure portal.')).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Instagram' })).toBeVisible();
});
