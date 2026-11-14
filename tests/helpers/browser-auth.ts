import { expect, type Page } from '@playwright/test';

/** Verify the browser's current server-authenticated identity, independent of dashboard presentation. */
export async function expectSignedInAccount(page: Page, accountId: string) {
  await expect.poll(async () => {
    const response = await page.request.get('/api/v1/me');
    if (response.status() !== 200) return null;
    const body = await response.json();
    return body.data?.account_id;
  }, { timeout: 15_000 }).toBe(accountId);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({ timeout: 15_000 });
}
