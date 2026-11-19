import { expectSignedInAccount } from '../helpers/browser-auth';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { adminDatabase, anonymousClient, loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { staffInvitationHandler } from '../../src/worker/auth-invitations';

// Token-bearing browser traces are disabled for these cases. Mailpit is
// read only for each unique recipient; no global mailbox reset or message deletion.
test.use({ trace: 'off' });
async function verificationLink(email: string, type: 'email' | 'invite' | 'recovery') {
  let messages: { ID: string; To: { Address: string }[] }[] = [];
  await expect.poll(async () => {
    const response = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (!response.ok) throw new Error('LOCAL_MAIL_READ_FAILED');
    const result = await response.json() as { messages: typeof messages };
    messages = result.messages.filter(message => message.To.some(to => to.Address === email));
    return messages.length;
  }, { timeout: 15000 }).toBe(1);
  const response = await fetch(`http://127.0.0.1:54324/api/v1/message/${messages[0].ID}`);
  const body = await response.json() as { HTML: string };
  const href = body.HTML.match(/href="([^"]+\/auth\/callback[^\"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!href) throw new Error('EXPECTED_LOCAL_VERIFICATION_LINK');
  const link = new URL(href);
  expect(link.origin).toBe('http://127.0.0.1:3000');
  expect(link.pathname).toBe('/auth/callback');
  expect(link.searchParams.get('type')).toBe(type);
  expect(Boolean(link.searchParams.get('token_hash'))).toBe(true);
  expect(/tutor_fee|margin_minor|payout_destination|internal_notes/.test(body.HTML)).toBe(false);
  return link;
}

async function followVerification(page: Page, link: URL, destination: string) {
  const hops: { host: string; path: string; status: number; destination: string; cookies: boolean }[] = [];
  let callbackReferrerPolicy: string | undefined;
  page.on('response', async response => {
    const url = new URL(response.url());
    if (!['/auth/callback', '/auth/set-password', '/learn', '/login'].includes(url.pathname)) return;
    const headers = await response.allHeaders();
    if (url.pathname === '/auth/callback') callbackReferrerPolicy = headers['referrer-policy'];
    const target = headers.location ? new URL(headers.location, url) : null;
    hops.push({ host: url.host, path: url.pathname, status: response.status(), destination: target ? `${target.host}${target.pathname}` : '', cookies: Boolean(headers['set-cookie']) });
  });
  try { await page.goto(link.href); } catch { throw new Error('LOCAL_VERIFICATION_NAVIGATION_FAILED'); }
  try { await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe(destination); }
  catch { throw new Error(`LOCAL_VERIFICATION_REDIRECT_FAILED:${JSON.stringify(hops)}`); }
  await expect.poll(() => callbackReferrerPolicy).toBe('no-referrer');
}

test('signup email confirms the actual Auth account and retains ordinary customer access', async ({ page }) => {
  test.setTimeout(60000);
  const database = await adminDatabase();
  try {
    const email = `confirmation.ui.${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}!`;
    await page.goto('/signup');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe('/auth/verify');
    const before = await database.query('select id,email_confirmed_at from auth.users where email=$1', [email]);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].email_confirmed_at).toBeNull();
    const id = before.rows[0].id as string;
    expect((await database.query('select role from app_private.account_roles where account_id=$1 and revoked_at is null order by role', [id])).rows).toEqual([{ role: 'student' }]);
    expect((await page.request.get('/api/v1/me')).status()).toBe(401);
    const denied = await page.request.post('/api/auth/login', { headers: { Origin: 'http://127.0.0.1:3000' }, data: { email, password } });
    expect(denied.status()).toBe(401);
    const link = await verificationLink(email, 'email');
    await followVerification(page, link, '/learn');
    await expectSignedInAccount(page, id);
    const response = await page.request.get('/api/v1/me');
    expect(response.status()).toBe(200);
    const { data } = await response.json();
    expect(data.account_id).toBe(id);
    expect(data.verified).toBe(true);
    expect(data.roles).toEqual(['student']);
    expect((await database.query('select email_confirmed_at is not null as confirmed from auth.users where id=$1', [id])).rows[0].confirmed).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await database.end(); }
});

test('staff recipient follows real invitation mail, sets a password and explicitly accepts before staff access', async ({ page }) => {
  test.setTimeout(60000);
  const database = await adminDatabase();
  const config = loadLocalSupabase();
  if (!config.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  const worker = new Pool({ connectionString: config.worker_database_url });
  const approver = anonymousClient();
  try {
    const run = randomUUID();
    const email = `staff.ui.${run}@example.test`;
    const approverEmail = `staff.ui.approver.${run}@example.test`;
    const password = `Synthetic-${randomUUID()}!`;
    const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    const actor = await provider.auth.admin.createUser({ email: approverEmail, password, email_confirm: true });
    if (actor.error || !actor.data.user) throw new Error(`AUTH_FIXTURE_FAILED:${actor.error?.code || 'NO_USER'}`);
    await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','isolated invitation browser test bootstrap')", [actor.data.user.id]);
    expect((await approver.auth.signInWithPassword({ email: approverEmail, password })).error?.code).toBeUndefined();
    const invitation = await approver.rpc('create_staff_invitation', { p_email: email, p_role: 'customer_service', p_reason: 'Synthetic browser invitation check', p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() });
    expect(invitation.error?.message).toBeUndefined();
    const id = invitation.data.invitation_id as string;
    const queued = await database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='identity.staff_invitation'", [id]);
    expect(queued.rows).toHaveLength(1);
    await database.query('begin');
    const jobs = await (async () => {
      try {
        await database.query("select id from app_private.outbox_jobs where purpose='identity.staff_invitation' and id<>$1 for update", [queued.rows[0].id]);
        return await claimJobs(worker, 'identity.staff_invitation', 1, 60);
      } finally { await database.query('rollback'); }
    })();
    expect(jobs.map(job => job.id)).toEqual([queued.rows[0].id]);
    expect(await executeLeasedJob(worker, jobs[0], staffInvitationHandler(worker))).toBe('completed');
    const link = await verificationLink(email, 'invite');
    expect(link.searchParams.get('staff_invitation_id')).toBe(id);
    await followVerification(page, link, '/auth/set-password');
    const before = await page.request.get('/api/v1/me');
    expect(before.status()).toBe(200);
    expect((await before.json()).data.roles).toEqual(['student']);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save password and continue', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/learn');
    const accept = page.getByRole('form', { name: 'Accept staff invitation', exact: true });
    await expect(accept).toBeVisible();
    await expect(accept.getByLabel('Staff invitation reference', { exact: true })).toHaveValue(id);
    await accept.getByRole('button', { name: 'Accept staff invitation', exact: true }).click();
    await expect(accept.getByRole('status')).toContainText('Staff invitation accepted');
    const after = await page.request.get('/api/v1/me');
    expect(after.status()).toBe(200);
    const { data } = await after.json();
    expect(data.roles).toContain('customer_service');
    const navigation = page.getByRole('navigation', { name: 'Learning', exact: true });
    const menu = navigation.getByRole('button', { name: /^Menu/ });
    if (await menu.isVisible()) await menu.click();
    await navigation.getByRole('link', { name: 'Operations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Customer service', exact: true })).toBeVisible();
    expect((await database.query("select count(*)::int as count from app_private.account_roles where account_id=$1 and role='customer_service' and revoked_at is null", [data.account_id])).rows[0].count).toBe(1);
    expect((await database.query('select count(*)::int as count from auth.users where email=$1', [email])).rows[0].count).toBe(1);
  } finally {
    await approver.auth.signOut();
    await worker.end();
    await database.end();
  }
});

test('a learner can reset a password through the emailed recovery link', async ({ page, context }) => {
  test.setTimeout(60000);
  const config = loadLocalSupabase();
  const email = `recovery.${randomUUID()}@example.test`;
  const original = `Synthetic-${randomUUID()}!`;
  const replacement = `Synthetic-${randomUUID()}!`;
  const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await provider.auth.admin.createUser({ email, password: original, email_confirm: true });
  expect(created.error?.code).toBeUndefined();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('check your inbox');
  const link = await verificationLink(email, 'recovery');
  await followVerification(page, link, '/auth/set-password');
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByLabel('Confirm password').fill(replacement);
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  const auth = anonymousClient();
  expect((await auth.auth.signInWithPassword({ email, password: original })).error?.code).toBe('invalid_credentials');
  expect((await auth.auth.signInWithPassword({ email, password: replacement })).error).toBeNull();
  await auth.auth.signOut();
  await context.clearCookies();
  await followVerification(page, link, '/login');
});
