import { expect, test } from '@playwright/test';
import { randomUUID, createHmac } from 'node:crypto';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';

test('GT-AUTH-004 a full password window shows the retry message and expires', async ({ page, baseURL }) => {
  const config = loadLocalSupabase();
  const db = await adminDatabase();
  const email = `limit-${randomUUID()}@example.test`;
  const password = 'synthetic-wrong-password';
  const bucket = createHmac('sha256', config.secret_key).update(JSON.stringify(['password-login', 'default', email])).digest('hex');
  try {
    // Preload nine failures on this disposable identity without generating a burst against Auth.
    await db.query('insert into app_private.password_login_windows values ($1,now(),9)', [bucket]);
    const failed = await page.request.post('/api/auth/login', { headers: { Origin: baseURL! }, data: { email, password } });
    expect(failed.status()).toBe(401);
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const limited = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await limited;
    expect(response.status()).toBe(429);
    expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
    expect(Number(response.headers()['retry-after'])).toBeLessThanOrEqual(60);
    expect(Object.keys(await response.json()).sort()).toEqual(['code', 'message', 'request_id']);
    await expect(page.locator('form').getByRole('alert')).toContainText(/too many requests/i);
    await db.query("update app_private.password_login_windows set started_at=now()-interval '61 seconds' where bucket=$1", [bucket]);
    const next = await page.request.post('/api/auth/login', { headers: { Origin: baseURL! }, data: { email, password } });
    expect(next.status()).toBe(401);
  } finally { await db.end(); }
});
