import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readDemo, saveDemo, writeDemoHandoff } from '../../tools/prepare-demo';
import { adminDatabase, authClient } from '../helpers/supabase';
import { runFileScan } from '../helpers/files';
import { provisionFakeMeeting } from '../helpers/calendar';
import { formatCairoInstant } from '../../src/modules/booking/scheduling';

test.use({ trace: 'off', screenshot: 'off' });
test.skip(process.env.DEMO_VERIFY !== '1', 'Opt-in walkthrough preserves the personal demo slot.');

async function login(page: Page, actor: { id: string; email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expectSignedInAccount(page, actor.id);
}
async function submit(page: Page, form: Locator, path: string, expected = 200) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click();
  const received = await response, body = await received.json();
  expect(received.status(), body.message).toBe(expected); return body.data;
}
async function upload(page: Page, region: Locator, path: string) {
  const disclosure = region.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Upload supporting evidence$/ }) });
  if (await disclosure.count() && (await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const widget = region.getByRole('group', { name: 'Add a file', exact: true });
  await widget.getByLabel('Choose a file', { exact: true }).setInputFiles(path);
  const completed = page.waitForResponse(response => /\/api\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await widget.getByRole('button', { name: 'Upload and check file', exact: true }).click();
  const response = await completed, body = await response.json(); expect(response.status()).toBe(202);
  const id = new URL(response.url()).pathname.split('/')[4];
  expect((await page.request.get(`/api/v1/files/${id}/content`)).ok()).toBe(false);
  expect(await runFileScan(body.data.scan_job_id)).toBe('completed');
  await widget.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(widget.getByRole('status')).toHaveText('Check passed');
  return id;
}

test('guided synthetic booking, real receipt review, confirmation, files and five-role access', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'One bounded walkthrough only.'); test.setTimeout(180000);
  const demo = await readDemo(), slot = demo.verified!;
  expect(demo.state).toBe('ready'); expect(demo.browser).toBeUndefined();
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1000 } })));
  const database = await adminDatabase(), adminClient = await authClient('admin_a');
  try {
    const [learner, service, tutor, admin, guardian] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [learner, service, tutor, admin, guardian]) page.setDefaultTimeout(15000);
    await login(learner, demo.actors.learner);
    if (!slot.enrollmentId) {
      await learner.goto(slot.bookingUrl);
      await learner.getByLabel('Booking for', { exact: true }).selectOption(demo.learnerId);
      const hold = learner.getByRole('form', { name: 'Reserve a temporary seat', exact: true });
      await hold.getByRole('checkbox').check();
      const held = await submit(learner, hold, `occurrences/${slot.occurrenceId}/holds`, 201);
      slot.enrollmentId = held.enrollment_id; await saveDemo(demo);
    }
    await learner.goto(`/learn/bookings/${slot.enrollmentId}`);
    const accept = learner.getByRole('form', { name: 'Accept this quote', exact: true });
    const enrollmentResponse = await learner.request.get(`/api/v1/enrollments/${slot.enrollmentId}`);
    const enrollment = (await enrollmentResponse.json()).data;
    if (!enrollment.quote.accepted_at) { await accept.getByRole('checkbox').check(); await submit(learner, accept, `quotes/${enrollment.quote.quote_id}/accept`); }
    await learner.getByRole('link', { name: 'View payment instructions', exact: true }).click();
    slot.chargeId = new URL(learner.url()).pathname.split('/').at(-1); await saveDemo(demo);
    if (!slot.receiptId) {
      await learner.getByLabel('Payment channel', { exact: true }).selectOption(demo.receivingVersionId);
      const receipt = learner.getByRole('form', { name: 'Submit receipt for review', exact: true });
      await receipt.getByLabel('Amount you transferred (EGP)', { exact: true }).fill('500');
      await receipt.getByLabel('Transfer reference', { exact: true }).fill(slot.externalId);
      await upload(learner, receipt, '.local/demo/verification-receipt.pdf');
      const saved = await submit(learner, receipt, 'receipts', 201);
      slot.receiptId = saved.receipt_id; slot.caseId = saved.case_id; await saveDemo(demo);
    }
    await login(service, demo.actors.service); await service.goto('/service/payments');
    const caseRow = service.locator(`[data-case-id="${slot.caseId}"]`);
    const claim = caseRow.getByRole('form', { name: 'Claim case', exact: true });
    const ownership = (await database.query('select state,owner_id from app_private.review_cases where id=$1', [slot.caseId])).rows[0];
    if (!ownership.owner_id && ownership.state !== 'resolved') {
      await expect(claim).toBeVisible(); await submit(service, claim, `review-cases/${slot.caseId}/claim`);
    }
    await service.goto(`/service/payments/${slot.caseId}`);
    const caseResponse = await service.request.get(`/api/v1/review-cases/${slot.caseId}`);
    expect(caseResponse.status()).toBe(200);
    const caseData = (await caseResponse.json()).data;
    if (caseData.case.state !== 'resolved') {
      await service.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(slot.transferId);
      const transfer = (await (await service.request.get(`/api/v1/incoming-transfers/${slot.transferId}`)).json()).data;
      if (transfer.state === 'pending') {
        await expect(service.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeDisabled();
        await service.goto(`/service/payments/transfers/${slot.transferId}`);
        const settlement = service.getByRole('form', { name: 'Verify settled funds', exact: true });
        const time = formatCairoInstant(slot.observedAt);
        await settlement.getByLabel('Verified settlement time', { exact: true }).fill(`${time.local_date}T${time.local_time}`);
        await settlement.getByLabel('Settlement verification note', { exact: true }).fill('Independently checked the synthetic receiving statement; customer receipt alone is insufficient.');
        await settlement.getByLabel('Prepared evidence', { exact: true }).selectOption(slot.settlementFileId);
        await submit(service, settlement, `transfers/${slot.transferId}/verify`);
      }
      if (!transfer.payer) {
        await service.goto(`/service/payments/transfers/${slot.transferId}`);
        const lookup = service.getByRole('form', { name: 'Find verified account', exact: true });
        await lookup.getByLabel('Exact verified contact', { exact: true }).fill(demo.actors.learner.email);
        const lookupResponse = service.waitForResponse(response => new URL(response.url()).pathname.endsWith('/payer-lookup'));
        await lookup.getByRole('button', { name: 'Find verified account', exact: true }).click(); expect((await lookupResponse).status()).toBe(200);
        const binding = service.getByRole('form', { name: 'Verify source owner', exact: true });
        await binding.getByLabel('Verified source owner', { exact: true }).selectOption(demo.actors.learner.id);
        await binding.getByLabel('Independent ownership evidence', { exact: true }).selectOption(slot.ownershipFileId);
        await binding.getByLabel('Reason for this action', { exact: true }).fill('Independent demo source evidence matches this verified learner.');
        await submit(service, binding, `transfers/${slot.transferId}/bind-payer`);
      }
      await service.goto(`/service/payments/${slot.caseId}`);
      await service.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(slot.transferId);
      await submit(service, service.getByRole('form', { name: 'Apply verified funds', exact: true }), `review-cases/${slot.caseId}/allocate`);
    }
    const funded = (await (await learner.request.get(`/api/v1/enrollments/${slot.enrollmentId}`)).json()).data;
    expect(funded.state).toBe('confirmed'); expect(funded.occurrence.state).toBe('confirmed');
    expect(JSON.stringify(funded)).not.toMatch(/fee_minor|compensation_policy_version|internal_notes|payout_destination|provider_token/);
    await provisionFakeMeeting({ database, admin: adminClient }, slot.occurrenceId);
    await login(tutor, demo.actors.tutor); await tutor.goto(`/tutor/schedule?occurrence=${slot.occurrenceId}`);
    if (!slot.materialFileId) {
      const resources = tutor.locator('section').filter({ has: tutor.getByRole('heading', { level: 2, name: 'Class resources', exact: true }) }).last();
      slot.materialFileId = await upload(tutor, resources, '.local/demo/demo-material.pdf');
      const published = tutor.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/files/${slot.materialFileId}/publish`);
      await resources.getByRole('button', { name: 'Publish to this session', exact: true }).click(); expect((await published).status()).toBe(200);
      await saveDemo(demo);
    }
    await learner.goto(`/learn/bookings/${slot.enrollmentId}`);
    await learner.getByText('Study files and class resources', { exact: true }).click();
    await expect(learner.getByRole('heading', { name: 'demo-material.pdf', exact: true })).toBeVisible();
    const download = await learner.request.get(`/api/v1/files/${slot.materialFileId}/content`); expect(download.status()).toBe(200);
    expect(createHash('sha256').update(await download.body()).digest('hex')).toBe(createHash('sha256').update(await readFile('.local/demo/demo-material.pdf')).digest('hex'));
    await login(guardian, demo.actors.guardian); await guardian.goto(`/learn/bookings/${slot.enrollmentId}`);
    expect((await guardian.request.get(`/api/v1/enrollments/${slot.enrollmentId}`)).status()).toBe(200);
    await login(admin, demo.actors.admin); await admin.goto(`/admin/schedule?occurrence=${demo.historical.occurrenceId}`);
    await expect(admin.getByRole('region', { name: 'Session delivery', exact: true }).getByRole('heading', { name: 'Approved', exact: true })).toBeVisible();
    await tutor.goto('/tutor/pay'); await expect(tutor.getByText('EGP 100.00', { exact: true }).first()).toBeVisible();
    expect((await database.query('select count(*)::int n from app_private.enrollments where occurrence_id=$1', [demo.personal!.occurrenceId])).rows[0].n).toBe(0);
    expect((await database.query('select count(*)::int n from finance_private.tutor_earnings where occurrence_id=$1', [demo.historical.occurrenceId])).rows[0].n).toBe(1);
    await mkdir('.local/demo/screenshots', { recursive: true });
    await learner.screenshot({ path: '.local/demo/screenshots/confirmed-session.png', fullPage: true });
    await admin.screenshot({ path: '.local/demo/screenshots/approved-delivery.png', fullPage: true });
    await tutor.screenshot({ path: '.local/demo/screenshots/tutor-pay.png', fullPage: true });
    demo.browser = { verifiedAt: new Date().toISOString(), result: 'Passed actual browser booking, receipt upload, independent settlement/ownership review, funding confirmation, simulated meeting, exact private-file bytes, guardian access and approved delivery/pay visibility' };
    await saveDemo(demo); await writeDemoHandoff(demo);
  } finally { await Promise.all(contexts.map(context => context.close())); await adminClient.auth.signOut({ scope: 'local' }); await database.end(); }
});
