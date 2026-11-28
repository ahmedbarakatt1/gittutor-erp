import { expect, test } from '@playwright/test';
import { loadLocalSupabase } from '../helpers/supabase';

test('admin can add two independent organizers and revoke one', async ({ page, request }) => {
  const admin = loadLocalSupabase().actors.admin_a;
  const learner = loadLocalSupabase().actors.learner_a;
  const origin = 'http://127.0.0.1:3000';
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: origin }, data: { email: admin.email, password: admin.password },
  });
  expect(login.status()).toBe(200);
  await page.goto('/admin/integrations');
  const organizers = page.getByRole('region', { name: 'Meet organizers' });
  const read = async () => {
    const result = await page.request.get('/api/v1/calendar/connections');
    expect(result.status()).toBe(200);
    return (await result.json()).data as { connection_id: string; state: string }[];
  };
  async function add() {
    const before = new Set((await read()).map(row => row.connection_id));
    const posted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/calendar/connect' && r.request().method() === 'POST');
    await organizers.getByRole('button', { name: /^(Connect simulated calendar|Add simulated organizer)$/ }).click();
    expect((await posted).status()).toBe(200);
    await expect(organizers.getByRole('status').filter({ hasText: 'The simulated organizer is connected.' })).toBeVisible();
    const added = (await read()).find(row => !before.has(row.connection_id));
    expect(added).toBeDefined();
    await expect(organizers.locator(`#organizer-${added!.connection_id}`)).toBeVisible();
    return added!.connection_id;
  }
  const first = await add();
  const second = await add();
  const row = organizers.locator(`#organizer-${first}`);
  await row.locator('summary').click();
  const revoked = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/calendar/connection/revoke');
  await row.getByRole('button', { name: 'Revoke calendar connection' }).click();
  expect((await revoked).ok()).toBe(true);
  await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
  expect((await read()).find(item => item.connection_id === second)?.state).toBe('connected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const studentLogin = await request.post('/api/auth/login', {
    headers: { Origin: origin }, data: { email: learner.email, password: learner.password },
  });
  expect(studentLogin.ok()).toBe(true);
  expect((await request.get('/api/v1/calendar/connections')).status()).toBe(403);
});
