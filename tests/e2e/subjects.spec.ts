import { expect, test } from '@playwright/test';

test('subjects are flexible starting points for private requests with the supplied contact channels', async ({ page }) => {
  await page.goto('/subjects');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Start with your subject.' })).toBeVisible();
  const areas = [
    ['Computer Science', 'computer-science'], ['Engineering', 'engineering'], ['Business', 'business'], ['Business Intelligence', 'business-intelligence'],
  ];
  for (const [title] of areas) {
    await expect(main.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
    const link = main.getByRole('link', { name: `Explore ${title}`, exact: true });
    const href = await link.getAttribute('href'); expect(href).toBe(`/learn/requests?topic=${encodeURIComponent(title)}`);
  }
  await expect(main.getByRole('heading', { name: 'Calculus', exact: true })).toHaveCount(0);
  await expect(main).not.toContainText(/\d+ published offers?|synthetic|test fixture|browser fixture/i);
  await expect(main.getByRole('link', { name: 'See individual and group pricing' })).toHaveAttribute('href', '/offers');
  await expect(main.getByRole('link', { name: 'Request help with another subject' })).toHaveAttribute('href', '/learn/requests');
  await expect(main.getByRole('link', { name: 'Ask us on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/201508823452');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', 'https://wa.me/201508823452');
  await expect(footer.getByRole('link', { name: /Call us/ })).toHaveAttribute('href', 'tel:+201508823452');
  await expect(footer.getByRole('link', { name: 'Instagram', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/gittutor/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await main.getByRole('link', { name: 'Explore Computer Science', exact: true }).focus();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login\?return_to=/);
  expect(new URL(page.url()).searchParams.get('return_to')).toBe('/learn/requests?topic=Computer+Science');
  await page.goto('/offers');
  const prices = page.getByRole('table', { name: 'Individual and group tuition' });
  for (const amount of ['650', '575', '550', '500']) await expect(prices).toContainText(amount);
  await expect(page.getByRole('main')).toContainText('90–105 minutes');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Request a session', exact: true })).toHaveAttribute('href', '/learn/requests');
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Instagram', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/gittutor/');
});
