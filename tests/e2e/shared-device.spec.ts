import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';

test.use({ trace: 'off' });
const origin = 'http://127.0.0.1:3000';
const headers = { Origin: origin };
async function accounts() {
  const config = loadLocalSupabase();
  const admin = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const label = randomUUID();
  return Promise.all(['one', 'two'].map(async suffix => {
    const email = `shared.${label}+${suffix}@example.test`, password = `Synthetic-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Same Name' } });
    if (!created.data.user || created.error) throw new Error('Synthetic account creation failed');
    return { id: created.data.user.id, email, password };
  }));
}
async function login(request: APIRequestContext, user: {email:string;password:string}) {
  return request.post('/api/auth/login', { headers, data: { email:user.email, password:user.password } });
}

test('a previous tab cannot change the password of a similar account on the same browser', async ({page, browser}) => {
  test.setTimeout(90000);
  const [first, second] = await accounts();
  const otherDevice = await browser.newContext({baseURL:origin});
  const db = await adminDatabase();
  try {
    expect((await login(otherDevice.request, first)).status()).toBe(200);
    expect((await login(page.request, first)).status()).toBe(200);
    const firstRecord = (await (await page.request.get('/api/v1/me')).json()).data;
    expect(firstRecord.account_id).toBe(first.id);
    await page.goto('/auth/set-password');
    await page.getByLabel('Password', {exact:true}).fill('Synthetic-stale-form-123');
    await page.getByLabel('Confirm password', {exact:true}).fill('Synthetic-stale-form-123');
    expect((await login(page.request, {...second,password:'Synthetic-wrong-password'})).status()).toBe(401);
    expect((await (await page.request.get('/api/v1/me')).json()).data.account_id).toBe(first.id);
    expect((await login(page.request, second)).status()).toBe(200);
    const secondRecord = (await (await page.request.get('/api/v1/me')).json()).data;
    expect(secondRecord.account_id).toBe(second.id);
    expect(firstRecord.authorized_learner_ids).toHaveLength(1);
    expect(secondRecord.authorized_learner_ids).toHaveLength(1);
    expect(secondRecord.authorized_learner_ids).not.toEqual(firstRecord.authorized_learner_ids);
    const stale = page.waitForResponse(r => r.url().endsWith('/api/auth/password') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Save password and continue'}).click();
    expect((await stale).status()).toBe(409);
    await expect(page).toHaveURL(/\/auth\/session-ended$/);
    expect((await db.query('select count(*)::int as n from auth.sessions where user_id=$1',[first.id])).rows[0].n).toBe(1);
    expect((await (await otherDevice.request.get('/api/v1/me')).json()).data.account_id).toBe(first.id);
    expect((await login(page.request,second)).status()).toBe(200);
  } finally { await otherDevice.close(); await db.end(); }
});

test('signing out on all devices closes other tabs and sessions for that account only', async ({page,browser}) => {
  test.setTimeout(90000);
  const [first, second] = await accounts();
  const otherDevice = await browser.newContext({baseURL:origin});
  const separate = await browser.newContext({baseURL:origin});
  try {
    expect((await login(page.request,first)).status()).toBe(200);
    expect((await login(otherDevice.request,first)).status()).toBe(200);
    expect((await login(separate.request,second)).status()).toBe(200);
    await page.goto('/learn');
    const sibling=await page.context().newPage();
    await sibling.goto('/learn');
    await expect(sibling.getByTestId('account-id')).toHaveText(first.id);
    await page.getByText('Account security',{exact:true}).click();
    await page.getByRole('button',{name:'Sign out on all my devices'}).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(sibling).toHaveURL(/\/auth\/session-ended$/);
    expect((await otherDevice.request.get('/api/v1/me')).status()).toBe(401);
    expect((await (await separate.request.get('/api/v1/me')).json()).data.account_id).toBe(second.id);
  } finally { await otherDevice.close(); await separate.close(); }
});

test('a guest can end a support session before handing over the device', async ({page}) => {
  await page.goto('/support');
  await page.getByRole('button',{name:'Start a conversation'}).click();
  await expect(page.getByRole('heading',{name:'Your conversations'})).toBeVisible();
  expect((await (await page.request.get('/api/v1/me')).json()).data).toEqual({is_guest:true});
  await page.getByRole('button',{name:'End guest session on this device'}).click();
  await expect(page.getByRole('button',{name:'Start a conversation'})).toBeVisible();
  expect((await page.request.get('/api/v1/support')).status()).toBe(401);
});

test('browser history after logout keeps the previous learner workspace closed with storage disabled', async ({page}) => {
  const [first] = await accounts();
  await page.addInitScript(() => { Object.defineProperty(window,'localStorage',{get(){ throw new Error('Storage unavailable'); }}); });
  expect((await login(page.request,first)).status()).toBe(200);
  await page.goto('/learn');
  await expect(page.getByTestId('account-id')).toHaveText(first.id);
  await page.goto('/support');
  expect((await page.request.post('/api/auth/logout',{headers})).status()).toBe(200);
  await page.goBack();
  await expect(page).toHaveURL(/\/(?:login|auth\/session-ended)(?:\?|$)/);
  await expect(page.getByText(first.id,{exact:true})).toHaveCount(0);
});
