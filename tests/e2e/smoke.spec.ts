import { expect, test } from '@playwright/test';

test('public website shell explains the learning journey and safe group tuition', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bring the slide you are stuck on.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a session', exact: true })).toHaveAttribute('href', '/learn/requests');
  await expect(page.getByRole('heading', { name: 'Find your subject.' })).toBeVisible();
  await expect(page.locator('.private-tuition')).toContainText('EGP 650');
  for (const tuition of ['575', '550', '500']) {
    await expect(page.getByTestId(`tuition-${tuition}`)).toContainText(tuition);
  }
  const html = await page.content();
  expect(html).not.toMatch(/tutor_fee|fee_min|fee_max|internal_compensation|payout_destination|margin_minor/);
  expect(errors).toEqual([]);
});

test('study example and frequently asked questions work with native controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'See the next step' }).click();
  await expect(page.getByRole('status')).toContainText('56');
  await page.getByRole('button', { name: 'See the next step' }).click();
  await expect(page.getByRole('status')).toContainText('Found 23');
  await page.getByText('Can I bring my own course materials?', { exact: true }).click();
  await expect(page.getByText('Yes. Bring the slides, questions or course notes you want to work through. Your private preparation files stay separate from shared teaching resources.', { exact: true })).toBeVisible();
});

test('layout stays readable and within the viewport', async ({ page }) => {
  await page.goto('/');
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    bodySize: parseFloat(getComputedStyle(document.body).fontSize),
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.bodySize).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});

test('RTL layout retains visible navigation and bounded content', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('decorative Giza accent loads only when approached', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('giza-canvas')).toHaveCount(0);
  await page.locator('.giza-accent').scrollIntoViewIfNeeded();
  await expect(page.locator('.giza-accent')).toHaveAttribute('data-render-state', 'ready');
  await expect(page.getByTestId('giza-canvas')).toHaveCount(1);
});
