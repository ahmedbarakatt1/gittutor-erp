import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';

const baseURL = 'http://127.0.0.1:3000';
const portals = [
  { actor: 'learner_a', path: '/learn', heading: /^(Your learning space\.|Your learning overview)$/, role: 'student' },
  { actor: 'tutor_a', path: '/tutor', heading: /^(Tutor workspace|Your teaching overview)$/, role: 'tutor' },
  { actor: 'cs_a', path: '/service', heading: /^(Customer service|Your customer overview)$/, role: 'customer_service' },
  { actor: 'admin_a', path: '/admin', heading: /^(Administration|Your business overview)$/, role: 'admin' },
] as const;

async function signIn(page: Page, actorLabel: string | { id: string; email: string; password: string }) {
  const actor = typeof actorLabel === 'string' ? loadLocalSupabase().actors[actorLabel] : actorLabel;
  if (!actor) throw new Error('MISSING_SYNTHETIC_AUTH_ACTOR');
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => result.url().endsWith('/api/auth/login') && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/(learn(?:\/payments)?|tutor|service|admin)$/, { timeout: 15_000 });
  await expectSignedInAccount(page, actor.id);
}

async function createSyntheticActor() {
  const database = await adminDatabase();
  await database.end();
  const config = loadLocalSupabase();
  const authAdmin = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `ui.${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}!`;
  const { data, error } = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`SYNTHETIC_AUTH_CREATION_FAILED:${error?.code || 'NO_USER'}`);
  return { id: data.user.id, email, password };
}

async function independentContext(browser: Browser, viewport: { width: number; height: number } | null | undefined) {
  return browser.newContext({ baseURL, viewport });
}

test('signed-out direct portal URLs require sign-in', async ({ page }) => {
  for (const portal of portals) {
    await page.goto(portal.path);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  }
  const response = await page.request.get('/api/v1/me');
  expect(response.status()).toBe(401);
});

for (const portal of portals) {
  test(`Back, the logo and public account links preserve the ${portal.role} session`, async ({ page, context }) => {
    await signIn(page, portal.actor);
    const detail = portal.path + '/notifications';
    const direct = await context.newPage();
    await direct.goto(detail);
    await direct.getByRole('link', { name: 'Back', exact: true }).click();
    await expect(direct).toHaveURL(baseURL + portal.path);
    await direct.goto(detail);
    await direct.locator('header a:has(img)').first().click();
    await expect(direct).toHaveURL(baseURL + portal.path);
    await direct.goto('/subjects');
    await direct.locator('header nav').getByRole('link', { name: 'My dashboard' }).click();
    await expect(direct).toHaveURL(baseURL + portal.path);
    await direct.getByRole('link', { name: 'Back', exact: true }).click();
    await expect(direct).toHaveURL(baseURL + '/subjects');
    await direct.goto('/login');
    await expect(direct).toHaveURL(baseURL + portal.path);
    await expectSignedInAccount(direct, loadLocalSupabase().actors[portal.actor].id);
    await direct.close();
  });
}

test('form validation is associated with controls and preserves entered email', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email address', { exact: true }).fill('not-an-email');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#email-error')).toHaveText('Enter a valid email address.');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('not-an-email');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile navigation supports keyboard use and keeps the current learner page in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'learner_a');
  await page.goto('/learn/bookings');
  const nav = page.getByRole('navigation', { name: 'Learning', exact: true });
  const toggle = nav.getByRole('button', { name: /^Menu/ });
  const current = nav.locator('a[aria-current="page"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(current).toBeHidden();
  await toggle.press('Enter');
  await expect(current).toHaveAttribute('href', '/learn/bookings');
  await current.focus();
  await current.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(current).toBeHidden();
  await toggle.click();
  await expect(nav.locator('a[href^="/admin"]')).toHaveCount(0);
  await nav.locator('a[href="/learn/files"]').click();
  await expect(page).toHaveURL(/\/learn\/files$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute('href', '/learn/files');
});

test('real independent sessions enter only their assigned staff portal', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const contexts: BrowserContext[] = [];
  try {
    for (const portal of portals) {
      const context = await independentContext(browser, testInfo.project.use.viewport);
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, portal.actor);
      await expect(page).toHaveURL(`${baseURL}${portal.path}`);
      await expect(page.getByRole('heading', { name: portal.heading, exact: true })).toBeVisible();
      const response = await page.request.get('/api/v1/me');
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.roles).toContain(portal.role);
      expect(data.account_id).toBe(loadLocalSupabase().actors[portal.actor].id);
      expect(JSON.stringify(data)).not.toMatch(/tutor_fee|fee_min|fee_max|margin_minor|payout_destination|internal_notes/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Genuine local sessions for the requested CLI visual review; ignored and never shipped.
      await mkdir('.local/ui-review', { recursive: true });
      await context.storageState({ path: `.local/ui-review/${testInfo.project.name}-${portal.actor}.json` });
      if (portal.role !== 'admin') {
        await page.goto('/admin');
        await expect(page).not.toHaveURL(`${baseURL}/admin`);
        await expect(page.getByRole('heading', { name: portals[3].heading })).toHaveCount(0);
      }
    }
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('a learner cannot self-assign staff access or open tutor and service URLs', async ({ page }) => {
  const actor = loadLocalSupabase().actors.learner_b;
  const escalation = await page.request.post('/api/auth/signup', { headers: { Origin: baseURL }, data: { email: actor.email, password: actor.password, role: 'admin' } });
  expect(escalation.status()).toBe(400);
  await signIn(page, 'learner_b');
  for (const path of ['/tutor', '/service']) {
    await page.goto(path);
    await expect(page).not.toHaveURL(`${baseURL}${path}`);
  }
  const response = await page.request.get('/api/v1/me');
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.roles).not.toEqual(expect.arrayContaining(['admin']));
  expect(data.roles).not.toEqual(expect.arrayContaining(['tutor']));
  expect(data.roles).not.toEqual(expect.arrayContaining(['customer_service']));
});

test('an administrator without a learner identity stays in administration on learner links', async ({ page }) => {
  const owner = await createSyntheticActor();
  const database = await adminDatabase();
  try {
    await database.query('begin');
    await database.query("insert into app_private.account_roles(account_id,role,reason) values ($1,'admin','Synthetic staff-only account')", [owner.id]);
    await database.query("update app_private.account_roles set revoked_at=now(),version=version+1 where account_id=$1 and role='student'", [owner.id]);
    await database.query('delete from app_private.learners where account_id=$1', [owner.id]);
    await database.query('commit');
  } finally { await database.end(); }
  await signIn(page, owner);
  for (const path of ['/learn', '/learn/files', '/learn/requests?topic=Mathematics']) {
    await page.goto(path);
    await expect(page).toHaveURL(`${baseURL}/admin`);
    await expect(page.getByRole('link', { name: 'Learning', exact: true })).toHaveCount(0);
  }
  const account = await page.request.get('/api/v1/me');
  expect(account.status()).toBe(200);
  expect((await account.json()).data).toMatchObject({ roles: ['admin'], authorized_learner_ids: [] });
});

test('GT-GRD-003 a guardian with no current links sees guidance and no learner records', async ({ page }) => {
  const account = await createSyntheticActor();
  const db = await adminDatabase();
  try {
    await db.query("insert into app_private.account_roles(account_id, role, reason) values ($1,'guardian','Synthetic guardian without links')", [account.id]);
    await db.query("update app_private.account_roles set revoked_at=now(), version=version+1 where account_id=$1 and role='student'", [account.id]);
    await db.query('delete from app_private.learners where account_id=$1', [account.id]);
  } finally { await db.end(); }
  await signIn(page, account);
  await page.goto('/learn');
  await expect(page).toHaveURL(baseURL+'/learn/payments');
  await expect(page.getByText(/^No learner is linked to this account/)).toBeVisible();
  await expect(page.getByTestId('learner-id')).toHaveCount(0);
  expect((await (await page.request.get('/api/v1/me')).json()).data.authorized_learner_ids).toEqual([]);
});

test('GT-ADM-001/002/111 workbook overview, source filters and audited mapping review', async ({ page }) => {
  test.setTimeout(90_000);
  const owner = await createSyntheticActor();
  const db = await adminDatabase();
  const batch = randomUUID(), target = randomUUID();
  const hash = createHash('sha256').update(batch).digest('hex');
  const empty = { columns: [], rows: [] };
  const sessions = {
    columns: [
      { key: 'col_a', label: 'Date', type: 'date' }, { key: 'col_e', label: 'Learner', type: 'text' },
      { key: 'col_f', label: 'Course', type: 'text' }, { key: 'col_i', label: 'Status', type: 'text' },
    ],
    rows: ['Completed','Scheduled'].map((status, i) => ({ source_row: i+2, issues: [], values: {
      col_a: '2026-10-20', col_e: 'Synthetic learner', col_f: i ? 'Synthetic algebra' : 'Synthetic geometry', col_i: status,
    } })),
  };
  const snapshot = { version: 1, source_name: 'synthetic-dashboard.xlsx', source_sha256: hash, as_of: null,
    courses: ['Synthetic algebra','Synthetic geometry'], tables: { sessions,
      students: { columns: [{ key: 'col_a', label: 'Name', type: 'text' }], rows: [{ source_row: 2, issues: [], values: { col_a: 'Synthetic learner' } }] },
      tutors: { columns: [{ key: 'col_a', label: 'Name', type: 'text' }], rows: [{ source_row: 2, issues: [], values: { col_a: 'Synthetic tutor' } }] },
      packages: empty, balances: empty, distributions: empty, marketing: empty } };
  try {
    await db.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','Synthetic dashboard reviewer')", [owner.id]);
    const learner = (await db.query('select id from app_private.learners where account_id=$1',[owner.id])).rows[0].id;
    const tutor = (await db.query('select id from app_private.tutors where account_id=$1',[loadLocalSupabase().actors.tutor_a.id])).rows[0].id;
    await db.query("insert into app_private.workflow_import_batches(id,owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$3,$3,'synthetic',$4)",[batch,owner.id,hash,JSON.stringify(snapshot)]);
    await db.query("insert into app_private.operational_workbook_links(id,batch_id,source_table,source_row) values($1,$2,'sessions',2)", [target,batch]);
    await db.query("insert into app_private.operational_workbook_links(batch_id,source_table,source_row,learner_id,review_state) values($1,'sessions',3,$2,'linked')", [batch,learner]);
    await db.query("insert into app_private.operational_workbook_links(batch_id,source_table,source_row,learner_id,review_state) values($1,'students',2,$2,'linked')", [batch,learner]);
    await db.query("insert into app_private.operational_workbook_links(batch_id,source_table,source_row,tutor_id,review_state) values($1,'tutors',2,$2,'linked')", [batch,tutor]);
    await signIn(page, owner);
    await page.goto('/admin/workflow');
    await page.getByRole('searchbox', { name: 'Search this section' }).fill('geometry');
    await page.getByLabel('Reported status').selectOption('Completed');
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.getByRole('button',{name:'Row 2',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Source row 2'})).toBeVisible();
    await page.goto('/admin');
    const overview = page.locator('[data-workflow-view="overview"]');
    await expect(overview.getByRole('link',{name:/Open request queue/})).toHaveAttribute('href','/admin/requests');
    await overview.getByRole('button',{name:'Browse records'}).click();
    const search = overview.getByRole('searchbox');
    await search.fill('geometry');
    await overview.getByRole('button',{name:'Completed 1',exact:true}).click();
    await expect(search).toHaveValue('geometry');
    await expect(overview.getByText('1 matching record',{exact:false})).toBeVisible();
    await expect(overview.locator('li > details > summary')).toHaveCount(1);
    await overview.locator('li > details > summary').click();
    await overview.getByText('Review record links',{exact:true}).click();
    await overview.getByLabel('Linked learner').selectOption(learner);
    await overview.getByLabel('Linked tutor').selectOption(tutor);
    await overview.getByLabel('Review evidence and reason').fill('Matched to the learner in the synthetic source.');
    await overview.getByRole('button',{name:'Save mapping review'}).click();
    await expect.poll(async () => (await db.query('select review_state,version,learner_id from app_private.operational_workbook_links where id=$1',[target])).rows[0]).toEqual({review_state:'reviewed',version:2,learner_id:learner});
    expect((await db.query('select snapshot from app_private.workflow_import_batches where id=$1',[batch])).rows[0].snapshot).toEqual(snapshot);
  } finally { await db.end(); }
});

test('guardian account shows exactly its current authorized learner scope', async ({ page }) => {
  await signIn(page, 'guardian_a');
  await expect(page).toHaveURL(`${baseURL}/learn`);
  const response = await page.request.get('/api/v1/me');
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.roles).toContain('guardian');
  const database = await adminDatabase();
  try {
    const actors = loadLocalSupabase().actors;
    const siblings = await database.query('select id from app_private.learners where account_id = any($1::uuid[])', [[actors.learner_a.id, actors.learner_b.id]]);
    expect(siblings.rows).toHaveLength(2);
    expect(data.authorized_learner_ids).toEqual(expect.arrayContaining(siblings.rows.map(row => row.id)));
    expect(new Set(data.authorized_learner_ids).size).toBe(data.authorized_learner_ids.length);
    const authorized = await database.query(`select id from app_private.learners where account_id=$1
      union select learner_id from app_private.guardian_links where guardian_account_id=$1
      and revoked_at is null and valid_from<=now() and valid_until>now()`, [actors.guardian_a.id]);
    expect([...data.authorized_learner_ids].sort()).toEqual(authorized.rows.map(row => row.id).sort());
  } finally { await database.end(); }
  await expect(page.locator('#learners')).toBeVisible();
});

test('logout denies a stale tab and replay of the pre-logout session cookie', async ({ browser }, testInfo) => {
  const context = await independentContext(browser, testInfo.project.use.viewport);
  let replay: BrowserContext | undefined;
  try {
    const page = await context.newPage();
    await signIn(page, 'learner_d');
    const stale = await context.newPage();
    await stale.goto('/learn');
    await expectSignedInAccount(stale, loadLocalSupabase().actors.learner_d.id);
    const previousCookies = await context.cookies();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(stale).toHaveURL(/\/auth\/session-ended$/);
    await expect(stale.getByTestId('account-id')).toHaveCount(0);
    await stale.goto('/learn');
    await expect(stale).toHaveURL(/\/login(?:\?|$)/);
    const staleResponse = await stale.request.get('/api/v1/me');
    expect(staleResponse.status()).toBe(401);
    replay = await independentContext(browser, testInfo.project.use.viewport);
    await replay.addCookies(previousCookies);
    const replayResponse = await replay.request.get('/api/v1/me');
    expect(replayResponse.status()).toBe(401);
  } finally { await replay?.close(); await context.close(); }
});

test('GT-1607 tutor application retries one saved command and requires actual admin review', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const applicant = await createSyntheticActor();
  const learnerContext = await independentContext(browser, testInfo.project.use.viewport);
  const adminContext = await independentContext(browser, testInfo.project.use.viewport);
  try {
    const learner = await learnerContext.newPage();
    await signIn(learner, applicant);
    await learner.goto('/apply-to-teach');
    const form = learner.getByRole('form', { name: 'Submit application', exact: true });
    await expect(form).toBeVisible();
    const displayName = `Synthetic teacher ${randomUUID().slice(0, 8)}`;
    await form.getByLabel('Display name', { exact: true }).fill(displayName);
    await form.getByLabel('Teaching experience and biography').fill('Synthetic university teaching experience, created for an isolated browser check.');
    await form.getByRole('checkbox').first().check();
    const submittedSubject = await form.getByRole('checkbox').first().getAttribute('value');
    await form.getByLabel('Verified contact', { exact: true }).selectOption({ index: 1 });

    const keys: string[] = [];
    let committedApplicationId = '';
    let interrupted = false;
    // Fault injection after a real server commit checks retry identity without mocking Auth or SQL.
    await learner.route('**/api/v1/tutor-applications', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      keys.push(route.request().headers()['idempotency-key']);
      if (!interrupted) {
        const response = await route.fetch();
        if (!response.ok()) { await route.fulfill({ response }); return; }
        committedApplicationId = (await response.json()).data.application_id;
        interrupted = true;
        await route.abort('failed');
      } else await route.continue();
    });
    await form.getByRole('button', { name: 'Submit application', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('connection was interrupted');
    await expect(form.getByLabel('Display name', { exact: true })).toHaveValue(displayName);
    await form.getByRole('button', { name: 'Submit application', exact: true }).click();
    await expect(form.getByRole('status')).toContainText('Application submitted for review');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await expect(form.getByRole('status')).toContainText(committedApplicationId);
    const before = await learner.request.get('/api/v1/me');
    expect((await before.json()).data.roles).not.toContain('tutor');
    const forgedReview = await learner.request.post(`/api/v1/tutor-applications/${committedApplicationId}/review`, { headers: { Origin: baseURL, 'Idempotency-Key': randomUUID() }, data: { decision: 'approved', reason: 'Unauthorized self-approval attempt', approved_subject_ids: [], expected_version: 1 } });
    expect(forgedReview.status()).toBe(403);

    const admin = await adminContext.newPage();
    await signIn(admin, 'admin_a');
    await admin.goto('/admin/access');
    await admin.getByRole('button', { name: new RegExp(displayName) }).click();
    await expect(admin.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
    const review = admin.getByRole('form', { name: 'Save review decision', exact: true });
    const approvedOptions = await review.getByRole('group', { name: 'Approved teaching subjects', exact: true }).getByRole('checkbox').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    expect(approvedOptions).toEqual([submittedSubject]);
    await review.getByLabel('Reason', { exact: true }).fill('Verified synthetic teaching experience for this isolated test.');
    await review.getByRole('button', { name: 'Save review decision', exact: true }).click();
    await expect(review.getByRole('status')).toContainText('Review decision saved');
    await learner.goto('/tutor');
    await expect(learner.getByRole('heading', { name: 'Tutor workspace', exact: true })).toBeVisible();
    const after = await learner.request.get('/api/v1/me');
    expect((await after.json()).data.roles).toContain('tutor');
    const database = await adminDatabase();
    try {
      const applications = await database.query('select count(*)::int as count from app_private.tutor_applications where account_id=$1', [applicant.id]);
      expect(applications.rows[0].count).toBe(1);
    } finally { await database.end(); }
  } finally { await learnerContext.close(); await adminContext.close(); }
});

test('refresh discards a delayed older application page while fresh pagination still works', async ({ page }) => {
  test.setTimeout(90_000);
  const actor = await createSyntheticActor();
  const database = await adminDatabase();
  const fixtureIds: string[] = [];
  const fixtureRoleId = randomUUID();
  let releasePage: (() => void) | undefined;
  try {
    // Serialize this read-model fixture across viewport projects; never reset existing data.
    await database.query("select pg_advisory_lock(hashtext('git-tutor-ui-pagination-fixture'))");
    await database.query("insert into app_private.account_roles(id,account_id,role,reason) values($1,$2,'admin','isolated pagination read-model fixture')", [fixtureRoleId, actor.id]);
    const referenceData = await database.query('select c.id as contact_id,s.id as subject_id from app_private.verified_contacts c cross join app_private.subjects s where c.account_id=$1 and c.revoked_at is null and s.active limit 1', [actor.id]);
    const refs = referenceData.rows[0];
    const delayedName = `Synthetic delayed page ${randomUUID().slice(0, 8)}`;
    for (let index = 0; index < 26; index += 1) {
      const id = randomUUID(); fixtureIds.push(id);
      await database.query(`insert into app_private.tutor_applications(id,account_id,display_name,subject_ids,bio,contact_id,state,created_at)
        values($1,$2,$3,array[$4]::uuid[],'Isolated pagination review fixture',$5,$6,'2001-01-01T00:00:00Z'::timestamptz+$7::int*interval '1 second')`,
      [id, actor.id, index === 25 ? delayedName : `Synthetic reviewed page ${index}`, refs.subject_id, refs.contact_id, index === 25 ? 'pending' : 'rejected', index]);
    }
    await signIn(page, actor);
    await page.goto('/admin/access');
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tutor applications', exact: true }) });
    await expect(section.getByRole('button', { name: 'Load more records', exact: true })).toBeVisible();
    let signalFetched: (() => void) | undefined;
    let signalHandled: (() => void) | undefined;
    const fetched = new Promise<void>(resolve => { signalFetched = resolve; });
    const handled = new Promise<void>(resolve => { signalHandled = resolve; });
    const release = new Promise<void>(resolve => { releasePage = resolve; });
    let oldIds: string[] = [];
    const pattern = '**/api/v1/tutor-applications?cursor=*';
    await page.route(pattern, async route => {
      try {
        const response = await route.fetch();
        oldIds = (await response.json()).data.items.map((item: { application_id: string }) => item.application_id);
        signalFetched?.();
        await release;
        try { await route.fulfill({ response }); } catch { /* Refresh legitimately aborts this old request. */ }
      } finally { signalHandled?.(); }
    });
    await section.getByRole('button', { name: 'Load more records', exact: true }).click();
    await fetched;
    expect(oldIds).toContain(fixtureIds[25]);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/tutor-applications' && !new URL(response.url()).searchParams.has('cursor'));
    await section.getByRole('button', { name: 'Refresh applications', exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    releasePage?.();
    await handled;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(section.getByRole('button', { name: new RegExp(delayedName) })).toHaveCount(0);
    await page.unroute(pattern);
    await section.getByRole('button', { name: 'Load more records', exact: true }).click();
    await expect(section.getByRole('button', { name: new RegExp(delayedName) })).toBeVisible();
  } finally {
    releasePage?.();
    if (fixtureIds.length) await database.query('delete from app_private.tutor_applications where id=any($1::uuid[])', [fixtureIds]);
    await database.query('delete from app_private.account_roles where id=$1', [fixtureRoleId]);
    await database.end();
  }
});

test('guardian invitation, acceptance and revocation update a separate live browser session', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const learnerActor = await createSyntheticActor();
  const guardianActor = await createSyntheticActor();
  const learnerContext = await independentContext(browser, testInfo.project.use.viewport);
  const guardianContext = await independentContext(browser, testInfo.project.use.viewport);
  try {
    const learner = await learnerContext.newPage();
    const guardian = await guardianContext.newPage();
    await signIn(learner, learnerActor);
    await signIn(guardian, guardianActor);
    const own = await learner.request.get('/api/v1/me');
    const learnerId = (await own.json()).data.authorized_learner_ids[0];
    const before = await guardian.request.get(`/api/v1/learners/${learnerId}`);
    expect(before.status()).toBe(404);
    const contacts = await guardian.request.get('/api/v1/me/contacts');
    const guardianContactId = (await contacts.json()).data.items[0].contact_id;
    const invite = learner.getByRole('form', { name: 'Create invitation', exact: true });
    await invite.getByLabel('Guardian’s verified contact reference', { exact: true }).fill(guardianContactId);
    await invite.getByRole('checkbox', { name: 'Learner profile', exact: true }).check();
    await invite.getByRole('checkbox', { name: 'Bookings', exact: true }).check();
    const expiry = await learner.evaluate(() => {
      const date = new Date(Date.now() + 86_400_000);
      const two = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
    });
    await invite.getByLabel('Invitation expires', { exact: true }).fill(expiry);
    const createdResponse = learner.waitForResponse(response => response.url().endsWith('/api/v1/guardian-invitations') && response.request().method() === 'POST');
    await invite.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const invitationId = (await created.json()).data.invitation_id;
    await expect(invite.getByRole('status')).toContainText(invitationId);

    // Read only this disposable fixture's durable outbox token. Email delivery is a separate milestone.
    const database = await adminDatabase();
    let token: string;
    try {
      const event = await database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitationId]);
      token = event.rows[0].payload.single_use_token;
    } finally { await database.end(); }
    const accept = guardian.getByRole('form', { name: 'Accept invitation', exact: true });
    await accept.getByLabel('Invitation reference', { exact: true }).fill(invitationId);
    await accept.getByLabel('Single-use invitation code', { exact: true }).fill(token);
    const acceptedResponse = guardian.waitForResponse(response => response.url().endsWith(`/api/v1/guardian-invitations/${invitationId}/accept`) && response.request().method() === 'POST');
    await accept.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    const accepted = await acceptedResponse;
    expect(accepted.status()).toBe(200);
    const linkId = (await accepted.json()).data.guardian_link_id;
    await expect(guardian.getByTestId('learner-id').filter({ hasText: learnerId })).toBeVisible();
    const authorized = await guardian.request.get(`/api/v1/learners/${learnerId}`);
    expect(authorized.status()).toBe(200);

    await learner.getByText('Revoke guardian access', { exact: true }).click();
    await learner.getByLabel('Guardian access to revoke', { exact: true }).selectOption(linkId);
    const revoke = learner.getByRole('form', { name: 'Revoke access', exact: true });
    await revoke.getByLabel('Reason', { exact: true }).fill('End the isolated browser consent scenario.');
    await revoke.getByRole('button', { name: 'Revoke access', exact: true }).click();
    await expect(revoke.getByRole('status')).toContainText('Guardian access revoked');
    const revoked = await guardian.request.get(`/api/v1/learners/${learnerId}`);
    expect(revoked.status()).toBe(404);
    await guardian.reload();
    await expect(guardian.getByTestId('learner-id').filter({ hasText: learnerId })).toHaveCount(0);
  } finally { await learnerContext.close(); await guardianContext.close(); }
});

test('authentication and staff acceptance controls wait for hydration with delayed scripts', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  for (const scenario of [
    { path: '/login', button: 'Sign in', authenticated: false },
    { path: '/signup', button: 'Create account', authenticated: false },
    { path: '/auth/set-password', button: 'Save password and continue', authenticated: true },
    { path: `/learn?staff_invitation_id=${randomUUID()}`, button: 'Accept staff invitation', authenticated: true },
  ]) {
    const context = await independentContext(browser, testInfo.project.use.viewport);
    let releaseScripts: (() => void) | undefined;
    try {
      if (scenario.authenticated) {
        const actor = loadLocalSupabase().actors.learner_a;
        const login = await context.request.post('/api/auth/login', { headers: { Origin: baseURL }, data: { email: actor.email, password: actor.password } });
        expect(login.status()).toBe(200);
      }
      const page = await context.newPage();
      const ready = new Promise<void>(resolve => { releaseScripts = resolve; });
      await page.route('**/_next/static/**/*.js', async route => { await ready; try { await route.continue(); } catch { /* Test cleanup may close a delayed request. */ } });
      await page.goto(scenario.path, { waitUntil: 'commit' });
      const button = page.getByRole('button', { name: scenario.button, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeDisabled();
      const form = page.locator('form').filter({ has: button });
      for (const input of await form.locator('input:not([type="hidden"])').all()) await expect(input).toBeDisabled();
      if (scenario.path.startsWith('/learn')) await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
      releaseScripts?.();
      await expect(button).toBeEnabled({ timeout: 15_000 });
      if (scenario.path.startsWith('/learn')) await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
    } finally { releaseScripts?.(); await context.close(); }
  }
});
