import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bookingFixture } from '../helpers/booking';
import { calendarFixture } from '../helpers/calendar';
import { loadLocalSupabase } from '../helpers/supabase';
import { formatCairoInstant } from '../../src/modules/booking/scheduling';
test.use({ trace: 'off', screenshot: 'off' });
async function login(page: Page, actor: { id: string; email: string; password: string }) { await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password); const response = page.waitForResponse(row => new URL(row.url()).pathname === '/api/auth/login' && row.request().method() === 'POST'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); expect((await response).status()).toBe(200); await expect(page.getByTestId('account-id')).toHaveText(actor.id, { timeout: 15000 }); }
function local(instant: string) { const time = formatCairoInstant(instant); return `${time.local_date}T${time.local_time}`; }
async function submit(page: Page, form: Locator, path: string, label: string) { const response = page.waitForResponse(row => new URL(row.url()).pathname === `/api/v1/${path}` && row.request().method() === 'POST'); await form.getByRole('button', { name: label, exact: true }).click(); const result = await response, body = await result.json(); expect(result.status(), body.message).toBe(201); return body.data; }
test('unavailability has a responsible owner and a selected series change leaves its other session untouched', async ({ browser }, info) => {
  test.setTimeout(90000);
  const f = await bookingFixture(); await f.availability(); const firstTime = f.interval(5), secondTime = f.interval(6), proposedTime = f.interval(8), first = await f.occurrence('private', firstTime), second = await f.occurrence('private', secondTime);
  const contexts = await Promise.all(Array.from({ length: 2 }, () => browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: info.project.use.viewport })));
  try {
    const [tutor, admin] = await Promise.all(contexts.map(context => context.newPage()));
    await login(tutor, f.actor); await tutor.goto('/tutor/teaching');
    const report = tutor.getByRole('form', { name: 'Report unavailability', exact: true });
    await report.getByLabel('Unavailable from (Cairo time)', { exact: true }).fill(local(firstTime.start_at)); await report.getByLabel('Unavailable until (Cairo time)', { exact: true }).fill(local(firstTime.end_at)); await report.getByLabel('Reason', { exact: true }).fill('Review a conflicting teaching commitment.');
    const incident = await submit(tutor, report, 'tutor-unavailability', 'Report unavailability'); expect(incident.affected_count).toBe(1);
    await login(admin, loadLocalSupabase().actors.admin_a); await admin.goto('/admin/teaching');
    const affected = admin.getByRole('listitem').filter({ has: admin.locator(`a[href="/admin/schedule?occurrence=${first.occurrence_id}"]`) }).first();
    await expect(affected).toContainText('Responsible administrator:'); await expect(affected.getByRole('link', { name: 'Open the affected session', exact: true })).toBeVisible(); await expect(affected.getByRole('button', { name: 'Close resolved case', exact: true })).toHaveCount(0);
    await admin.locator('summary').filter({ hasText: /^Create session series$/ }).click();
    const create = admin.getByRole('form', { name: 'Create session series', exact: true }); await create.getByLabel('Series name', { exact: true }).fill(`Reviewable series ${randomUUID().slice(0, 8)}`);
    for (const occurrence of [first, second]) { const checkbox = create.locator(`input[name="occurrence_id"][value="${occurrence.occurrence_id}"]`); while (!(await checkbox.count())) { const more = create.getByRole('button', { name: 'Load more', exact: true }); await expect(more).toBeVisible(); const next = admin.waitForResponse(row => new URL(row.url()).pathname === '/api/v1/occurrences' && new URL(row.url()).searchParams.has('cursor')); await more.click(); expect((await next).status()).toBe(200); await expect(create.getByRole('button', { name: 'Loading more…', exact: true })).toHaveCount(0); } await checkbox.check(); }
    const series = await submit(admin, create, 'occurrence-series', 'Create session series');
    const editor = admin.getByRole('form', { name: 'Create individual change proposals', exact: true });
    await expect(editor).toBeVisible(); await editor.getByRole('checkbox').first().check();
    // Select the exact first occurrence by its displayed existing time, with no manual identifier entry.
    const candidateRows = await editor.getByRole('group', { name: 'Select sessions', exact: true }).locator('label').all();
    for (const row of candidateRows) { const time = row.locator('time').first(); if (await time.getAttribute('datetime') === firstTime.start_at) { await row.getByRole('checkbox').check(); } else { await row.getByRole('checkbox').uncheck(); } }
    await editor.getByLabel('Proposed start (Cairo time)', { exact: true }).fill(local(proposedTime.start_at)); await editor.getByLabel('Responses valid until (Cairo time)', { exact: true }).fill(local(new Date(Date.now() + 3600000).toISOString())); await editor.getByLabel('Reason', { exact: true }).fill('Review only the affected session; preserve the second session.');
    const changes = await submit(admin, editor, `occurrence-series/${series.series_id}/changes`, 'Create individual change proposals'); expect(changes.proposal_ids).toHaveLength(1);
    await expect(admin.getByRole('heading', { name: 'Change-set progress', exact: true })).toBeVisible();
    await expect(admin.getByRole('link', { name: 'Review this session change', exact: true })).toHaveAttribute('href', `/admin/schedule?occurrence=${first.occurrence_id}`);
    const saved = (await f.database.query('select id,start_at from app_private.occurrences where id=any($1::uuid[])', [[first.occurrence_id, second.occurrence_id]])).rows;
    expect(new Date(saved.find(row => row.id === first.occurrence_id).start_at).toISOString()).toBe(firstTime.start_at); expect(new Date(saved.find(row => row.id === second.occurrence_id).start_at).toISOString()).toBe(secondTime.start_at);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});

test('tutor replacement requires separate learner and both tutor consent before admin application', async ({ browser }, info) => {
  test.setTimeout(120000);
  const f = await calendarFixture(), replacement = await bookingFixture(); await replacement.availability();
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: info.project.use.viewport })));
  try {
    const [admin, learner, previousTutor, newTutor] = await Promise.all(contexts.map(context => context.newPage()));
    const before = (await f.database.query('select * from finance_private.charges where enrollment_id=$1', [f.enrollmentId])).rows;
    await login(admin, loadLocalSupabase().actors.admin_a); await admin.goto(`/admin/schedule?occurrence=${f.occurrenceId}`);
    await admin.locator('summary').filter({ hasText: /^Propose a different tutor$/ }).click();
    const form = admin.getByRole('form', { name: 'Propose a different tutor', exact: true });
    await form.getByLabel('Approved replacement tutor', { exact: true }).selectOption(replacement.tutorId);
    await form.getByLabel('Replacement teaching fee (EGP)', { exact: true }).fill('250'); await form.getByLabel('Previous tutor release compensation (EGP)', { exact: true }).fill('100');
    await form.getByLabel('Respond by (Cairo time)', { exact: true }).fill(local(new Date(Date.now() + 3600000).toISOString())); await form.getByLabel('Reason for this change', { exact: true }).fill('Review an approved replacement without changing learner tuition.');
    const proposal = await submit(admin, form, `occurrences/${f.occurrenceId}/tutor-reassignments`, 'Propose a different tutor');
    const open = async (page: Page) => { const details = page.locator(`[data-reassignment-id="${proposal.proposal_id}"]`); await expect(details).toBeVisible(); if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click(); return details; };
    await login(learner, loadLocalSupabase().actors.learner_a); await learner.goto(`/learn/bookings/${f.enrollmentId}`);
    let terms = await open(learner); await expect(terms.getByText('Your agreed tuition stays unchanged.', { exact: true })).toBeVisible();
    const customerPayload = await learner.request.get(`/api/v1/tutor-reassignments/${proposal.proposal_id}?view=customer&learner_id=${f.learnerId}`); expect(customerPayload.status()).toBe(200); expect(JSON.stringify(await customerPayload.json())).not.toMatch(/amount_minor|fee|compensation|25000|10000/);
    for (const [page, actor, path] of [[learner, null, null], [previousTutor, f.actor, '/tutor/teaching'], [newTutor, replacement.actor, '/tutor/teaching']] as const) {
      if (actor && path) { await login(page, actor); await page.goto(path); }
      terms = await open(page);
      await terms.getByRole('checkbox', { name: 'I accept the exact tutor change and terms shown here.', exact: true }).check();
      const accepted = page.waitForResponse(row => new URL(row.url()).pathname === `/api/v1/tutor-reassignments/${proposal.proposal_id}/accept` && row.request().method() === 'POST');
      await terms.getByRole('button', { name: 'Accept tutor change', exact: true }).click(); expect((await accepted).status()).toBe(200);
    }
    expect((await f.database.query('select tutor_id from app_private.tutor_assignments where occurrence_id=$1 and active', [f.occurrenceId])).rows[0].tutor_id).toBe(f.tutorId);
    await admin.reload(); let review = await open(admin);
    await review.getByRole('checkbox', { name: 'I reviewed the participant acceptances and exact teaching terms.', exact: true }).check();
    const approved = admin.waitForResponse(row => new URL(row.url()).pathname === `/api/v1/tutor-reassignments/${proposal.proposal_id}/approve` && row.request().method() === 'POST'); await review.getByRole('button', { name: 'Approve tutor change', exact: true }).click(); expect((await approved).status()).toBe(200);
    await expect(admin.locator(`[data-reassignment-id="${proposal.proposal_id}"] > summary`)).toContainText('Approved'); review = await open(admin);
    const committed = admin.waitForResponse(row => new URL(row.url()).pathname === `/api/v1/tutor-reassignments/${proposal.proposal_id}/commit` && row.request().method() === 'POST'); await review.getByRole('button', { name: 'Apply tutor change', exact: true }).click(); expect((await committed).status()).toBe(200);
    expect((await f.database.query('select tutor_id from app_private.tutor_assignments where occurrence_id=$1 and active', [f.occurrenceId])).rows[0].tutor_id).toBe(replacement.tutorId);
    expect((await f.database.query('select * from finance_private.charges where enrollment_id=$1', [f.enrollmentId])).rows).toEqual(before);
    await learner.reload(); await expect((await open(learner)).locator(':scope > summary')).toContainText('Applied');
    expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.all(contexts.map(context => context.close())); await replacement.close(); await f.close(); }
});
