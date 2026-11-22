import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Page, type Locator, type APIRequestContext, type Response } from '@playwright/test';
import { bookingFixture } from '../helpers/booking';
import { loadLocalSupabase } from '../helpers/supabase';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { formatCairoInstant } from '@/modules/booking/scheduling';
import type { AdminPricing } from '@/modules/catalog/queries';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const baseURL = 'http://127.0.0.1:3000';
const privateFields = /fee_minor|fee_agreement_id|compensation_policy_version|fee_min_minor|fee_max_minor|internal_notes|payout_destination|provider_token/;
async function savedPricing(request: APIRequestContext, id: string): Promise<AdminPricing> {
  let cursor: string | null = null;
  do { const response = await request.get(`/api/v1/pricing-versions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); expect(response.status()).toBe(200); const body = (await response.json()).data as { items: AdminPricing[]; next_cursor: string | null }; const found = body.items.find(row => row.pricing_version_id === id); if (found) return found; cursor = body.next_cursor; } while (cursor);
  throw new Error('APPROVED_FIXTURE_PRICING_NOT_FOUND');
}
async function login(page: Page, actor: string | { id: string; email: string; password: string }) {
  const user = typeof actor === 'string' ? loadLocalSupabase().actors[actor] : actor;
  await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill(user.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); expect((await response).status()).toBe(200); await expectSignedInAccount(page, user.id);
}
async function submit(page: Page, form: Locator, action: string, expected = 200) {
  const pending = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${action}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click(); const response = await pending; expect(response.status()).toBe(expected); return (await response.json()).data;
}
async function ensurePagedOption(page: Page, field: Locator, region: Locator, path: string, value: string) {
  const controls = region.locator(':scope > div'); const cursors = new Set<string>(); const responses: Response[] = [];
  const more = controls.getByRole('button', { name: /^(Load more results|Loading more\u2026)$/ });
  const observe = (response: Response) => { if (new URL(response.url()).pathname === path && response.request().method() === 'GET') responses.push(response); };
  let consumed = 0; let nextCursor: string | null | undefined;
  page.on('response', observe);
  try {
    for (;;) {
      let ready = 'waiting';
      await expect.poll(async () => {
        if (responses.length > consumed) return ready = 'response';
        if (await field.locator(`option[value="${value}"]`).count()) return ready = 'target';
        if (await region.locator(':scope > [role="alert"]').count()) return ready = 'failed';
        const hasCursorControl = await more.count() > 0;
        // The policy selector automatically loads until its first compatible option.
        if (hasCursorControl && await more.isEnabled() && (path !== '/api/v1/policies' || await field.locator('option').count() > 1)) return ready = 'more';
        if (nextCursor === null && !hasCursorControl && !await region.locator(':scope > [role="status"]').count()) return ready = 'end';
        return ready = 'waiting';
      }, { message: `Waiting for ${path} cursor progress or the required option` }).not.toBe('waiting');
      if (ready === 'target') break;
      if (ready === 'failed') throw new Error(`Could not read ${path} options`);
      if (ready === 'end') throw new Error(`Required option ${value} was absent after the final ${path} page`);
      if (ready === 'more') { await more.click(); await expect.poll(() => responses.length).toBeGreaterThan(consumed); continue; }
      const response = responses[consumed++]; expect(response.status()).toBe(200);
      nextCursor = (await response.json()).data.next_cursor as string | null;
      if (nextCursor !== null) {
        expect(nextCursor, `${path} cursor must advance`).not.toBe(new URL(response.url()).searchParams.get('cursor'));
        expect(cursors.has(nextCursor), `${path} cursor must not repeat`).toBe(false); cursors.add(nextCursor);
      }
    }
    await field.selectOption(value);
  } finally { page.off('response', observe); }
}
async function ensureOption(page: Page, label: string, value: string) {
  const field = page.getByRole('form', { name: 'Schedule a session', exact: true }).getByLabel(label, { exact: true });
  await ensurePagedOption(page, field, page.getByRole('region', { name: label, exact: true }), label === 'Published offer' ? '/api/v1/offers' : '/api/v1/tutors', value);
}

test('booking and schedule workspaces require a verified session', async ({ page }) => {
  for (const path of ['/learn/bookings', '/tutor/schedule', '/admin/schedule']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login(?:\?return_to=[^&]+)?$/);
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  }
});

test('a protected offer returns after sign-in and preserves the selected session at booking', async ({ page }) => {
  const offerPath = `/offers/${catalogFixtureIds.group2_offer}`;
  await page.goto(offerPath);
  await expect(page).toHaveURL(/\/login\?return_to=/);
  expect(new URL(page.url()).searchParams.get('return_to')).toBe(offerPath);
  const actor = loadLocalSupabase().actors.learner_d;
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${baseURL}${offerPath}`);
  const choice = page.getByRole('link', { name: 'Choose this session', exact: true }).first();
  await expect(choice).toBeVisible();
  const destination = await choice.getAttribute('href');
  expect(destination).toMatch(/^\/learn\/bookings\?offer=/);
  await choice.click();
  await page.waitForURL(`${baseURL}${destination}`);
  await expect(page.getByRole('heading', { name: 'Choose a session', exact: true })).toBeVisible();
  const selected = new URL(destination!, baseURL).searchParams.get('occurrence'); const request = await page.request.get(`/api/v1/booking/occurrences?offer_id=${catalogFixtureIds.group2_offer}&occurrence_id=${selected}`); expect(request.status()).toBe(200); expect((await request.json()).data.items).toHaveLength(1);
});

async function retryInterruptedCreation(page: Page, form: Locator, action: string) {
  let committedId: string | undefined;
  await page.route(`**/api/v1/${action}`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = (await response.json()).data.resource_id;
    await route.abort('connectionreset');
  }, { times: 1 });
  await form.getByRole('checkbox').check();
  await form.getByRole('button').click();
  await expect(form.getByRole('alert')).toBeVisible();
  await page.reload();
  await form.getByRole('checkbox').check();
  const replay = await submit(page, form, action);
  await expect(form.getByRole('status')).toBeVisible();
  expect(replay.resource_id).toBe(committedId);
  return replay;
}

test('same-tab reservation retries a lost receipt and creates new seats after release and expiry', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await bookingFixture();
  try {
    await fixture.availability();
    const id = String((await fixture.occurrence('group')).occurrence_id);
    const path = `/learn/bookings?offer=${catalogFixtureIds.group2_offer}&occurrence=${id}`;
    const action = `occurrences/${id}/holds`;
    const form = page.getByRole('form', { name: 'Reserve a temporary seat', exact: true });
    await login(page, 'learner_a');
    await page.goto(path);
    const first = await retryInterruptedCreation(page, form, action);
    await page.locator('#reserve').getByRole('link', { name: 'Review your reservation' }).click();
    await page.getByText('Release this temporary seat', { exact: true }).click();
    const release = page.getByRole('form', { name: 'Release temporary seat', exact: true });
    await release.getByLabel('Reason for this request').fill('Synthetic same-tab rebooking');
    await submit(page, release, `enrollments/${first.enrollment_id}/cancel`);

    async function reserveAgain() {
      await page.goto(path);
      await form.getByRole('checkbox').check();
      const saved = await submit(page, form, action, 201);
      await expect(form.getByRole('status')).toBeVisible();
      return saved.enrollment_id as string;
    }
    const second = await reserveAgain();
    await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [second]);
    const third = await reserveAgain();
    expect((await fixture.database.query(
      'select id,state from app_private.enrollments where occurrence_id=$1 order by created_at', [id],
    )).rows).toEqual([
      { id: first.enrollment_id, state: 'cancelled' },
      { id: second, state: 'expired' },
      { id: third, state: 'held' },
    ]);
  } finally { await fixture.close(); }
});

test('same-tab waitlist retries a lost receipt and creates a new entry after leaving', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await bookingFixture();
  try {
    await fixture.availability();
    const id = String((await fixture.occurrence()).occurrence_id);
    await fixture.reserve(id);
    const action = `occurrences/${id}/waitlist`;
    const form = page.getByRole('form', { name: 'Join waiting list', exact: true });
    await login(page, 'learner_b');
    await page.goto(`/learn/bookings?offer=${catalogFixtureIds.private_offer}&occurrence=${id}`);
    const first = await retryInterruptedCreation(page, form, action);
    const leave = await page.request.post(`/api/v1/waitlist/${first.waitlist_entry_id}/leave`, {
      headers: { Origin: baseURL, 'Idempotency-Key': randomUUID() }, data: { expected_version: first.version },
    });
    expect(leave.status()).toBe(200);
    await page.reload();
    await form.getByRole('checkbox').check();
    const second = await submit(page, form, action, 201);
    await expect(form.getByRole('status')).toBeVisible();
    expect((await fixture.database.query(
      'select id,state from app_private.waitlist_entries where occurrence_id=$1 order by created_at', [id],
    )).rows).toEqual([
      { id: first.waitlist_entry_id, state: 'cancelled' },
      { id: second.waitlist_entry_id, state: 'waiting' },
    ]);
  } finally { await fixture.close(); }
});

test('administrator schedules and approves exact teaching terms; guardian reserves and accepts separate learner quotes', async ({ browser }, info) => {
  test.setTimeout(180_000); const fixture = await bookingFixture(); await fixture.availability();
  const admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); const guardian = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); const stranger = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const adminPage = await admin.newPage(); await login(adminPage, 'admin_a'); await adminPage.goto('/admin/schedule');
    await ensureOption(adminPage, 'Published offer', catalogFixtureIds.group2_offer); await ensureOption(adminPage, 'Approved tutor', fixture.tutorId);
    const times = fixture.interval(); const local = formatCairoInstant(times.start_at); const form = adminPage.getByRole('form', { name: 'Schedule a session', exact: true });
    await form.getByLabel('Session starts', { exact: true }).fill(`${local.local_date}T${local.local_time}`);
    const created = await submit(adminPage, form, 'occurrences', 201); const occurrenceId = String(created.occurrence_id);
    await adminPage.goto(`/admin/schedule?occurrence=${occurrenceId}`); await expect(adminPage.getByRole('heading', { name: 'Confidential teaching terms', exact: true })).toBeVisible();
    const price = await savedPricing(admin.request, catalogFixtureIds.group_pricing);
    const bands = price.compensation.group_fee_bands as { tier_id: string; fee_min_minor: number }[]; const fee = bands.find(item => item.tier_id === 'group_2')!.fee_min_minor;
    const feeForm = adminPage.getByRole('form', { name: 'Approve exact tutor fee', exact: true });
    await feeForm.getByLabel('Exact tutor fee (EGP)', { exact: true }).fill((fee / 100).toFixed(2)); await feeForm.getByLabel('Fee approval reason', { exact: true }).fill('Synthetic browser exact agreement');
    await submit(adminPage, feeForm, `occurrences/${occurrenceId}/fee-agreements`, 201);
    await expect(adminPage.getByRole('button', { name: 'Confirm session', exact: true })).toBeDisabled();
    const page = await guardian.newPage(); await login(page, 'guardian_a');
    const downloaded = new Set<string>(); page.on('response', response => { const url = new URL(response.url()); if (response.status() === 200 && url.origin === baseURL && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js')) downloaded.add(response.url()); });
    const enrollmentIds: string[] = [];
    for (const learnerId of fixture.learners.slice(0, 2)) {
      await page.goto(`/learn/bookings?offer=${catalogFixtureIds.group2_offer}&occurrence=${occurrenceId}`); await page.getByLabel('Booking for', { exact: true }).selectOption(learnerId);
      const hold = page.getByRole('form', { name: 'Reserve a temporary seat', exact: true }); await hold.getByLabel('I have reviewed the offer’s price, timing and cancellation terms.').check();
      const reservation = await submit(page, hold, `occurrences/${occurrenceId}/holds`, 201); enrollmentIds.push(String(reservation.enrollment_id));
      await page.locator('#reserve').getByRole('link', { name: 'Review your reservation', exact: true }).click(); await page.waitForURL(`**/learn/bookings/${reservation.enrollment_id}`, { timeout: 15_000 });
      const quote = page.getByRole('form', { name: 'Accept this quote', exact: true });
      await expect(page.getByRole('region', { name: 'Session room', exact: true })).toHaveCount(0);
      await page.getByText('Review booking terms', { exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Payment for confirmation', exact: true })).toBeVisible();
      await page.getByText('Review booking terms', { exact: true }).click();
      await quote.getByLabel('I accept this learner’s exact price, session time and saved terms.').check(); await submit(page, quote, `quotes/${reservation.quote_id}/accept`);
      await expect(page.getByRole('status').filter({ hasText: 'Quote accepted:' })).toBeVisible(); await expect(page.getByTestId('confirmation-explanation')).toBeVisible(); await expect(page.getByRole('button', { name: 'Confirm session', exact: true })).toHaveCount(0);
      const detail = await page.request.get(`/api/v1/enrollments/${reservation.enrollment_id}`); expect(detail.status()).toBe(200); const dto = (await detail.json()).data; expect(dto.learner.learner_id).toBe(learnerId); expect(dto.funding.integration_state).toBe('ready'); expect(dto.funding.allocated_minor).toBe(0); expect(dto.funding.eligible).toBe(false);
      expect(JSON.stringify(dto)).not.toMatch(privateFields); expect(await page.content()).not.toMatch(privateFields); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    }
    expect(new Set(enrollmentIds).size).toBe(2); expect(downloaded.size).toBeGreaterThan(0);
    // Read each exact browser-observed asset URL through the same context before teardown.
    // DevTools response handles can disappear when a full-document navigation completes.
    const assetViolations: { asset: string; fields: string[] }[] = [];
    for (const url of downloaded) { const asset = await guardian.request.get(url); expect(asset.status()).toBe(200); const fields = (await asset.text()).match(new RegExp(privateFields.source, 'g')); if (fields) assetViolations.push({ asset: new URL(url).pathname, fields: [...new Set(fields)] }); }
    expect(assetViolations, 'Every actual customer-downloaded script must exclude confidential field definitions').toEqual([]);
    expect((await guardian.request.get(`/api/v1/occurrences/${occurrenceId}/fee-agreements`)).status()).toBe(403);
    const unrelated = await stranger.newPage(); await login(unrelated, 'learner_c'); for (const id of enrollmentIds) expect((await stranger.request.get(`/api/v1/enrollments/${id}`)).status()).toBe(404);
    const memberOffer = await guardian.request.get(`/api/v1/public/offers?offer_id=${catalogFixtureIds.group2_offer}`);
    expect(memberOffer.status()).toBe(200);
    expect(await memberOffer.text()).not.toMatch(privateFields);
    await mkdir('.local/ui-review', { recursive: true }); await admin.storageState({ path: `.local/ui-review/t04-${info.project.name}-admin.json` }); await guardian.storageState({ path: `.local/ui-review/t04-${info.project.name}-guardian.json` }); await writeFile(`.local/ui-review/t04-${info.project.name}-booking.json`, JSON.stringify({ occurrenceId, enrollmentIds, offerId: catalogFixtureIds.group2_offer }));
  } finally { await Promise.all([admin.close(), guardian.close(), stranger.close()]); await fixture.close(); }
});

test('tutor availability conflict preserves the scheduled session and shows its Cairo time', async ({ browser }, info) => {
  test.setTimeout(90_000); const fixture = await bookingFixture(); await fixture.availability(); const times = fixture.interval(); const created = await fixture.occurrence('private', times); const local = formatCairoInstant(times.start_at);
  const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const page = await context.newPage(); await login(page, fixture.actor); await page.goto(`/tutor/schedule?occurrence=${created.occurrence_id}`);
    const availability = page.getByRole('form', { name: 'Save availability', exact: true }); await availability.getByRole('button', { name: 'Add a date exception', exact: true }).click(); await availability.getByLabel('Date 1', { exact: true }).fill(local.local_date); await availability.getByLabel('Reason for this request', { exact: true }).fill('Synthetic conflict demonstration');
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/availability' && result.request().method() === 'POST'); await availability.getByRole('button', { name: 'Save availability', exact: true }).click(); expect((await response).status()).toBe(409);
    const affected = page.getByRole('region', { name: 'Sessions affected by this change', exact: true }); await expect(affected).toBeVisible(); await expect(affected.getByRole('link', { name: 'Review this session', exact: true })).toHaveAttribute('href', `/tutor/schedule?occurrence=${created.occurrence_id}`);
    await expect(availability.getByLabel('Date 1', { exact: true })).toHaveValue(local.local_date);
    const record = await context.request.get(`/api/v1/tutor/occurrences?occurrence_id=${created.occurrence_id}`); expect(record.status()).toBe(200); expect(Date.parse((await record.json()).data.items[0].occurrence.start_at)).toBe(Date.parse(times.start_at));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('.local/ui-review', { recursive: true }); await context.storageState({ path: `.local/ui-review/t04-${info.project.name}-tutor.json` }); await writeFile(`.local/ui-review/t04-${info.project.name}-tutor-meta.json`, JSON.stringify({ occurrenceId: created.occurrence_id, localDate: local.local_date }));
  } finally { await context.close(); await fixture.close(); }
});

test('a group change collects separate learner and tutor consent while unfunded commit preserves original terms', async ({ browser }, info) => {
  test.setTimeout(180_000); const fixture = await bookingFixture(); await fixture.availability(); const occurrenceId = String((await fixture.occurrence('group')).occurrence_id);
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [adminPage, guardianPage, addedPage, tutorPage] = await Promise.all(contexts.map(context => context.newPage())); await login(adminPage, 'admin_a');
    const pricing = await savedPricing(contexts[0].request, catalogFixtureIds.group_pricing); const bands = pricing.compensation.group_fee_bands as { tier_id: string; fee_min_minor: number }[];
    const firstFee = bands.find(row => row.tier_id === 'group_2')!.fee_min_minor; const nextFee = bands.find(row => row.tier_id === 'group_3')!.fee_min_minor;
    await fixture.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: fixture.tutorId, p_fee_minor: firstFee, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Synthetic initial agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const seats = [];
    for (const index of [0, 1]) { const seat = await fixture.reserve(occurrenceId, index); const quote = await fixture.rpc('get_quote', { p_quote_id: seat.quote_id }, fixture.students[index]); await fixture.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, fixture.students[index]); seats.push(String(seat.enrollment_id)); }
    await adminPage.goto(`/admin/schedule?occurrence=${occurrenceId}`); const feeForm = adminPage.getByRole('form', { name: 'Approve exact tutor fee', exact: true }); await feeForm.getByLabel('Group size for this agreement', { exact: true }).selectOption('3'); await feeForm.getByLabel('Exact tutor fee (EGP)', { exact: true }).fill((nextFee / 100).toFixed(2)); await feeForm.getByLabel('Fee approval reason', { exact: true }).fill('Synthetic proposed agreement'); const fee = await submit(adminPage, feeForm, `occurrences/${occurrenceId}/fee-agreements`, 201);
    await adminPage.getByText('Propose a group change', { exact: true }).click(); const form = adminPage.getByRole('form', { name: 'Create group-change proposal', exact: true }); await form.getByLabel('Proposed group size', { exact: true }).selectOption('3');
    await ensurePagedOption(adminPage, form.getByLabel('Approved terms for the proposed group', { exact: true }), form.locator('..'), '/api/v1/policies', catalogFixtureIds.group3_policy);
    await form.getByLabel('Find a learner', { exact: true }).fill('LearnerC'); await form.getByRole('button', { name: 'Search learners', exact: true }).click(); await form.getByRole('checkbox', { name: 'LearnerC', exact: true }).check();
    // A roster edit invalidates the prior agreement selection. Review it after
    // selecting the participants, as the real administrator must do.
    await expect(form.getByLabel('Exact fee agreement for this change', { exact: true })).toHaveValue('');
    await form.getByLabel('Exact fee agreement for this change', { exact: true }).selectOption(String(fee.fee_agreement_id));
    const expires = formatCairoInstant(new Date(Date.now() + 600_000).toISOString()); await form.getByLabel('Responses expire at', { exact: true }).fill(`${expires.local_date}T${expires.local_time}`); await form.getByLabel('Reason for this request', { exact: true }).fill('Synthetic group expansion'); const amendment = await submit(adminPage, form, `occurrences/${occurrenceId}/amendments`, 201); const amendmentId = String(amendment.amendment_id);
    await login(guardianPage, 'guardian_a');
    for (const id of seats) { await guardianPage.goto(`/learn/bookings/${id}`); await guardianPage.getByText('Review proposed change', { exact: true }).click(); const consent = guardianPage.getByRole('form', { name: 'Accept these proposed terms', exact: true }); await consent.getByLabel('I accept the displayed change for this learner.').check(); await submit(guardianPage, consent, `amendments/${amendmentId}/accept`); }
    const guardianViews = await Promise.all(fixture.learners.slice(0, 2).map(async id => { const response = await contexts[1].request.get(`/api/v1/amendments/${amendmentId}?view=customer&learner_id=${id}`); expect(response.status()).toBe(200); return (await response.json()).data; }));
    expect(guardianViews[0].terms_hash).not.toBe(guardianViews[1].terms_hash); expect(JSON.stringify(guardianViews)).not.toMatch(privateFields); expect(guardianViews.map(row => row.terms.customer_price_minor)).toEqual([55000, 55000]);
    const newSeat = (await fixture.database.query('select id from app_private.enrollments where occurrence_id=$1 and learner_id=$2', [occurrenceId, fixture.learners[2]])).rows[0].id;
    await login(addedPage, 'learner_c'); await addedPage.goto(`/learn/bookings/${newSeat}`); await expect(addedPage.getByRole('form', { name: 'Accept this quote', exact: true })).toHaveCount(0); await expect(addedPage.getByRole('heading', { name: 'Proposed quote', exact: true })).toBeVisible(); await addedPage.getByText('Review proposed change', { exact: true }).click(); const addedConsent = addedPage.getByRole('form', { name: 'Accept these proposed terms', exact: true }); await addedConsent.getByLabel('I accept the displayed change for this learner.').check(); await submit(addedPage, addedConsent, `amendments/${amendmentId}/accept`);
    await login(tutorPage, fixture.actor); await tutorPage.goto(`/tutor/schedule?occurrence=${occurrenceId}`); await tutorPage.getByText('Review proposed terms', { exact: true }).click(); const tutorConsent = tutorPage.getByRole('form', { name: 'Accept my teaching terms', exact: true }); await tutorConsent.getByLabel('I accept this session time and the displayed teaching terms.').check(); await submit(tutorPage, tutorConsent, `amendments/${amendmentId}/accept`);
    const final = await contexts[0].request.get(`/api/v1/amendments/${amendmentId}?view=admin`); expect(final.status()).toBe(200); expect((await final.json()).data.state).toBe('accepted');
    await adminPage.reload(); await adminPage.getByText('Review proposed terms', { exact: true }).click(); await expect(adminPage.getByRole('button', { name: 'Apply accepted group change', exact: true })).toBeEnabled();
    const commit = adminPage.getByRole('form', { name: 'Apply accepted group change', exact: true });
    const refused = adminPage.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/amendments/${amendmentId}/commit` && response.request().method() === 'POST');
    await commit.getByRole('button', { name: 'Apply accepted group change', exact: true }).click(); const denied = await refused; expect(denied.status()).toBe(409); expect((await denied.json()).code).toBe('INSUFFICIENT_FUNDS');
    for (const id of seats) { const response = await contexts[1].request.get(`/api/v1/enrollments/${id}`); const dto = (await response.json()).data; expect(dto.quote.customer_price_minor).toBe(57500); expect(dto.occurrence.target_tier).toBe(2); }
    await mkdir('.local/ui-review', { recursive: true }); await writeFile(`.local/ui-review/t04-${info.project.name}-amendment.json`, JSON.stringify({ occurrenceId, amendmentId, enrollmentId: seats[0], provisionalEnrollmentId: newSeat })); await contexts[0].storageState({ path: `.local/ui-review/t04-${info.project.name}-proposal-admin.json` }); await contexts[1].storageState({ path: `.local/ui-review/t04-${info.project.name}-proposal-guardian.json` }); await contexts[2].storageState({ path: `.local/ui-review/t04-${info.project.name}-proposal-added.json` });
  } finally { await Promise.all(contexts.map(context => context.close())); await fixture.close(); }
});

test('a customer can request a reviewed cancellation but cannot consent to unknown financial consequences', async ({ browser }, info) => {
  test.setTimeout(90_000); const fixture = await bookingFixture(); await fixture.availability(); const occurrenceId = String((await fixture.occurrence()).occurrence_id); const held = await fixture.reserve(occurrenceId); const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const page = await context.newPage(); await login(page, 'learner_a'); await page.goto(`/learn/bookings/${held.enrollment_id}`); await page.getByText('Release this temporary seat', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Release temporary seat', exact: true })).toBeEnabled();
    await page.getByText('Request a change', { exact: true }).click(); await page.getByLabel('Change requested', { exact: true }).selectOption('cancellation_remedy'); const form = page.getByRole('form', { name: 'Submit change request', exact: true }); await form.getByLabel('Cancellation remedy', { exact: true }).selectOption('cash_refund'); const expires = formatCairoInstant(new Date(Date.now() + 600_000).toISOString()); await form.getByLabel('Request expires at', { exact: true }).fill(`${expires.local_date}T${expires.local_time}`); await form.getByLabel('Reason for this request', { exact: true }).fill('Synthetic reviewed cancellation'); const created = await submit(page, form, 'operation-proposals', 201);
    await page.getByText('Review proposed change', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Accept these proposed terms', exact: true })).toBeDisabled(); await expect(page.getByText('The financial consequence is not available yet. Final acceptance is unavailable until it can be shown.', { exact: true })).toBeVisible();
    const response = await context.request.get(`/api/v1/operation-proposals/${created.proposal_id}?view=customer&learner_id=${fixture.learners[0]}`); expect(response.status()).toBe(200); const dto = (await response.json()).data; expect(dto.can_accept).toBe(false); expect(dto.terms.remedy_amount_minor).toBeNull(); expect(JSON.stringify(dto)).not.toMatch(privateFields);
  } finally { await context.close(); await fixture.close(); }
});

test('an accepted schedule-only proposal is reviewed and applied without changing the saved tuition', async ({ browser }, info) => {
  test.setTimeout(150_000); const fixture = await bookingFixture(); await fixture.availability(); const times = fixture.interval(); const occurrenceId = String((await fixture.occurrence('private', times)).occurrence_id);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [adminPage, learnerPage, tutorPage] = await Promise.all(contexts.map(context => context.newPage())); await login(adminPage, 'admin_a');
    const pricing = await savedPricing(contexts[0].request, catalogFixtureIds.private_pricing); const rule = pricing.compensation.private_fee_rule as { fee_min_minor: number };
    await fixture.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: fixture.tutorId, p_fee_minor: rule.fee_min_minor, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Synthetic initial private agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const seat = await fixture.reserve(occurrenceId); const original = await fixture.rpc('get_quote', { p_quote_id: seat.quote_id }, fixture.students[0]); await fixture.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: original.quote_hash, p_expected_version: original.version, p_idempotency_key: randomUUID() }, fixture.students[0]);
    await adminPage.goto(`/admin/schedule?occurrence=${occurrenceId}`); await adminPage.getByText('Propose a session change', { exact: true }).click(); const form = adminPage.getByRole('form', { name: 'Create change proposal', exact: true });
    const target = new Date(Date.parse(times.start_at) + 86_400_000).toISOString(); const local = formatCairoInstant(target); const expires = formatCairoInstant(new Date(Date.now() + 600_000).toISOString()); await form.getByLabel('Proposed session start', { exact: true }).fill(`${local.local_date}T${local.local_time}`); await form.getByLabel('Responses expire at', { exact: true }).fill(`${expires.local_date}T${expires.local_time}`); await form.getByLabel('Reason for this request', { exact: true }).fill('Synthetic accepted move'); const proposal = await submit(adminPage, form, 'operation-proposals', 201); const id = String(proposal.proposal_id);
    await login(learnerPage, 'learner_a'); await learnerPage.goto(`/learn/bookings/${seat.enrollment_id}`); await learnerPage.getByText('Review proposed change', { exact: true }).click(); const learnerConsent = learnerPage.getByRole('form', { name: 'Accept these proposed terms', exact: true }); await learnerConsent.getByLabel('I accept the displayed change for this learner.').check(); await submit(learnerPage, learnerConsent, `operation-proposals/${id}/accept`);
    await login(tutorPage, fixture.actor); await tutorPage.goto(`/tutor/schedule?occurrence=${occurrenceId}`); await tutorPage.getByText('Review proposed terms', { exact: true }).click(); const tutorConsent = tutorPage.getByRole('form', { name: 'Accept my teaching terms', exact: true }); await tutorConsent.getByLabel('I accept this session time and the displayed teaching terms.').check(); await submit(tutorPage, tutorConsent, `operation-proposals/${id}/accept`);
    await adminPage.reload(); await adminPage.getByText('Review proposed terms', { exact: true }).click(); const approval = adminPage.getByRole('form', { name: 'Save approval decision', exact: true }); await approval.getByLabel('Decision', { exact: true }).selectOption('approved'); await approval.getByLabel('Reason for this request', { exact: true }).fill('All parties accepted the exact schedule'); await submit(adminPage, approval, `operation-proposals/${id}/approve`);
    await adminPage.getByText('Review proposed terms', { exact: true }).click(); const commit = adminPage.getByRole('form', { name: 'Save new session time', exact: true }); await commit.getByLabel('Reason for this request', { exact: true }).fill('Apply reviewed schedule-only change'); await submit(adminPage, commit, `occurrences/${occurrenceId}/reschedule`);
    const response = await contexts[1].request.get(`/api/v1/enrollments/${seat.enrollment_id}`); expect(response.status()).toBe(200); const enrollment = (await response.json()).data; expect(Date.parse(enrollment.occurrence.start_at)).toBe(Date.parse(target)); expect(enrollment.quote.customer_price_minor).toBe(original.customer_price_minor); expect(enrollment.quote.quote_id).not.toBe(original.quote_id); expect(enrollment.quote.accepted_at).not.toBeNull(); expect(enrollment.funding.integration_state).toBe('ready'); expect(enrollment.funding.eligible).toBe(false);
  } finally { await Promise.all(contexts.map(context => context.close())); await fixture.close(); }
});
