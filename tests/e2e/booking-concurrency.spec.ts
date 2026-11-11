import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { bookingFixture } from '../helpers/booking';
import { loadLocalSupabase } from '../helpers/supabase';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { bookingDueHandler } from '../../src/worker/booking-due';

const baseURL = 'http://127.0.0.1:3000';
async function signIn(page: Page, label: string) {
  const user = loadLocalSupabase().actors[label]; await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByTestId('account-id')).toHaveText(user.id, { timeout: 15_000 });
}

async function findOfferedSeat(page: Page, enrollmentId: string) {
  const isOfferedPage = (url: string) => {
    const parsed = new URL(url);
    return parsed.pathname === '/api/v1/me/waitlist' && parsed.searchParams.get('state') === 'offered';
  };
  const firstResponse = page.waitForResponse(response => isOfferedPage(response.url()));
  await page.goto('/learn/bookings');
  const first = await firstResponse; expect(first.status()).toBe(200);
  let body = (await first.json()).data as { items: unknown[]; next_cursor: string | null };
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'A temporary seat is available', exact: true }) });
  const offer = section.locator(`a[href="/learn/bookings/${enrollmentId}"]`).filter({ hasText: 'A temporary seat is available' });
  let loaded = body.items.length;
  await expect(section.getByRole('listitem')).toHaveCount(loaded);
  // The collection is intentionally paginated. Follow its actual controls instead of assuming
  // this fixture's seat is one of the first 25 entries in a preserved development database.
  for (let pageNumber = 1; !await offer.count() && body.next_cursor && pageNumber < 100; pageNumber++) {
    const cursor = body.next_cursor;
    const pending = page.waitForResponse(response => isOfferedPage(response.url()) && new URL(response.url()).searchParams.get('cursor') === cursor);
    await section.getByRole('button', { name: 'Load more results', exact: true }).click();
    const response = await pending; expect(response.status()).toBe(200);
    body = (await response.json()).data;
    loaded += body.items.length;
    await expect(section.getByRole('listitem')).toHaveCount(loaded);
  }
  await expect(offer).toBeVisible();
  return offer;
}

test('independent browsers keep a last-seat conflict explicit and never silently join a waitlist', async ({ browser }, info) => {
  test.setTimeout(120_000); const fixture = await bookingFixture(); await fixture.availability(); const occurrenceId = String((await fixture.occurrence('group')).occurrence_id); await fixture.reserve(occurrenceId);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (let index = 0; index < pages.length; index++) { const page = pages[index]; await signIn(page, ['learner_b', 'learner_c'][index]); await page.goto(`/learn/bookings?offer=${catalogFixtureIds.group2_offer}&occurrence=${occurrenceId}`); await page.getByLabel('I have reviewed the offer’s price, timing and cancellation terms.').check(); }
    const responses = pages.map(page => page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/occurrences/${occurrenceId}/holds` && response.request().method() === 'POST'));
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'Reserve a temporary seat', exact: true }).click())); const saved = await Promise.all(responses); expect(saved.map(response => response.status()).sort()).toEqual([201, 409]);
    const loser = saved.findIndex(response => response.status() === 409); await expect(pages[loser].getByRole('status').filter({ hasText: 'Another booking changed availability.' })).toBeVisible(); await expect(pages[loser].getByRole('form', { name: 'Join waiting list', exact: true })).toBeVisible(); await expect(pages[loser].locator('#reserve').getByRole('link', { name: 'Review your reservation', exact: true })).toHaveCount(0);
    expect((await fixture.database.query("select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and state='held' and hold_expires_at>now()", [occurrenceId])).rows[0].count).toBe(2);
    expect((await fixture.database.query('select count(*)::int as count from app_private.waitlist_entries where occurrence_id=$1', [occurrenceId])).rows[0].count).toBe(0);
  } finally { await Promise.all(contexts.map(context => context.close())); await fixture.close(); }
});

test('GT-208 independent queue walkthrough expires one offer and promotes exactly the next learner', async ({ browser }, info) => {
  test.setTimeout(150_000); const fixture = await bookingFixture(); await fixture.availability(); const occurrenceId = String((await fixture.occurrence()).occurrence_id); const initial = await fixture.reserve(occurrenceId);
  const connection = loadLocalSupabase().worker_database_url; if (!connection) throw new Error('LOCAL_WORKER_REQUIRED'); const worker = new Pool({ connectionString: connection });
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  async function runOwnDueJob() {
    const pending = await fixture.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='booking.process_due' and j.state='pending' order by j.available_at,j.id limit 1", [occurrenceId]); expect(pending.rows).toHaveLength(1); const id = pending.rows[0].id;
    await fixture.database.query('update app_private.outbox_jobs set available_at=now() where id=$1', [id]); await fixture.database.query('begin');
    let jobs: Awaited<ReturnType<typeof claimJobs>>;
    try { await fixture.database.query("select id from app_private.outbox_jobs where purpose='booking.process_due' and id<>$1 for update", [id]); jobs = await claimJobs(worker, 'booking.process_due', 1, 60); expect(jobs.map(job => job.id)).toEqual([id]); } finally { await fixture.database.query('rollback'); }
    expect(await executeLeasedJob(worker, jobs![0], bookingDueHandler(worker))).toBe('completed');
  }
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage())); const entries: string[] = [];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]; await signIn(page, ['learner_b', 'learner_c'][index]); await page.goto(`/learn/bookings?offer=${catalogFixtureIds.private_offer}&occurrence=${occurrenceId}`);
      await expect(page.getByRole('button', { name: 'Reserve a temporary seat', exact: true })).toHaveCount(0); await page.getByLabel('Add this learner to the waiting list for this session.').check();
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/occurrences/${occurrenceId}/waitlist` && response.request().method() === 'POST'); await page.getByRole('button', { name: 'Join waiting list', exact: true }).click(); const response = await pending; expect(response.status()).toBe(201); entries.push((await response.json()).data.waitlist_entry_id);
    }
    // Only fixture-owned timestamps move. The actual worker uses database time and restricted grants.
    await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [initial.enrollment_id]); await runOwnDueJob();
    const first = (await fixture.database.query('select state,offered_enrollment_id from app_private.waitlist_entries where id=$1', [entries[0]])).rows[0]; expect(first.state).toBe('offered');
    await findOfferedSeat(pages[0], first.offered_enrollment_id);
    expect((await fixture.database.query('select state from app_private.waitlist_entries where id=$1', [entries[1]])).rows[0].state).toBe('waiting');
    await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [first.offered_enrollment_id]); await runOwnDueJob();
    const second = (await fixture.database.query('select state,offered_enrollment_id from app_private.waitlist_entries where id=$1', [entries[1]])).rows[0]; expect(second.state).toBe('offered'); expect((await fixture.database.query('select state from app_private.waitlist_entries where id=$1', [entries[0]])).rows[0].state).toBe('expired');
    const offer = await findOfferedSeat(pages[1], second.offered_enrollment_id); await offer.click(); await pages[1].waitForURL('**/learn/bookings/' + second.offered_enrollment_id, { timeout: 15_000 }); await expect(pages[1].getByRole('heading', { name: 'Your exact quote', exact: true })).toBeVisible();
    await expect(pages[1].getByTestId('confirmation-explanation')).toBeVisible(); await expect(pages[1].getByRole('button', { name: 'Confirm session', exact: true })).toHaveCount(0);
    expect((await fixture.database.query("select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and state='held' and hold_expires_at>now()", [occurrenceId])).rows[0].count).toBe(1);
  } finally { await Promise.all(contexts.map(context => context.close())); await worker.end(); await fixture.close(); }
});
