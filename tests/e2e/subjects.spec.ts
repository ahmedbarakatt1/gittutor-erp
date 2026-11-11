import { expect, test } from '@playwright/test';

test('subject discovery uses the four study areas with real course links and supplied contact channels', async ({ page }) => {
  await page.goto('/subjects');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Start with your subject.' })).toBeVisible();
  const areas = [
    ['Computer Science', 'computer-science'], ['Engineering', 'engineering'], ['Business', 'business'], ['Business Intelligence', 'business-intelligence'],
  ];
  for (const [title, slug] of areas) {
    await expect(main.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    const link = main.getByRole('link', { name: `Explore ${title}`, exact: true });
    const href = await link.getAttribute('href'); expect(href).toMatch(/^\/offers\?subject_id=[0-9a-f-]{36}$/);
    const response = await page.request.get(`/api/v1/public/offers?${href!.split('?')[1]}&limit=1`);
    expect(response.status()).toBe(200); expect((await response.json()).data.items[0].subject.slug).toBe(slug);
  }
  await expect(main.getByRole('heading', { name: 'Calculus', exact: true })).toHaveCount(0);
  await expect(main).not.toContainText(/\d+ published offers?|synthetic|test fixture|browser fixture/i);
  await expect(main.getByRole('link', { name: 'Browse all courses and sessions' })).toHaveAttribute('href', '/offers');
  await expect(main.getByRole('link', { name: 'Ask us on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/201508823452');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', 'https://wa.me/201508823452');
  await expect(footer.getByRole('link', { name: /Call us/ })).toHaveAttribute('href', 'tel:+201508823452');
  await expect(footer.getByRole('link', { name: 'Instagram', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/gittutor/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await main.getByRole('link', { name: 'Explore Computer Science', exact: true }).focus();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/offers\?subject_id=/);
  await expect(page.getByRole('heading', { name: 'Make room for understanding.', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Instagram', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/gittutor/');
});
