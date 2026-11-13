import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { paymentFixture } from '../helpers/payments';
import { retryFinancialConflict, settleEnrollment } from '../helpers/financial-booking';
import { loadLocalSupabase } from '../helpers/supabase';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { formatCairoInstant } from '@/modules/booking/scheduling';
import type { EnrollmentTransferConsent } from '@/modules/booking/enrollment-transfers';

test.use({ trace: 'off', screenshot: 'off' });
const baseURL = 'http://127.0.0.1:3000';
const confidential = /fee_minor|fee_agreement_id|compensation|internal_notes|payer_account_id|identifier_ciphertext|payout_destination|provider_token/;
async function login(page: Page, label: string | { id: string; email: string; password: string }) {
  const actor = typeof label === 'string' ? loadLocalSupabase().actors[label] : label;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByTestId('account-id')).toHaveText(actor.id, { timeout: 15_000 });
}
async function submit(page: Page, form: Locator, path: string, status = 200) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click();
  const result = await response, body = await result.json();
  expect(result.status(), `${body.code || ''}: ${body.message || ''}`).toBe(status);
  return body.data;
}
function cairoInput(instant: string) { const time = formatCairoInstant(instant); return `${time.local_date}T${time.local_time}`; }
async function chooseDestination(page: Page, region: Locator, id: string) {
  const field = region.getByLabel('Requested session', { exact: true }), responses: Response[] = [], cursors = new Set<string>();
  const observe = (response: Response) => { if (new URL(response.url()).pathname === '/api/v1/booking/occurrences') responses.push(response); };
  page.on('response', observe);
  try {
    const more = region.locator(':scope > div').getByRole('button', { name: 'Load more results', exact: true });
    await expect.poll(async () => Boolean(await field.locator(`option[value="${id}"]`).count() || await more.count()), { message: 'Wait for the real destination picker to finish its initial read' }).toBe(true);
    for (;;) {
      await expect(region.locator(':scope > [role="status"]')).toHaveCount(0);
      if (await field.locator(`option[value="${id}"]`).count()) break;
      await expect(more, 'Requested destination must be discoverable through an actual next page').toBeVisible();
      const count = responses.length; await more.click(); await expect.poll(() => responses.length).toBeGreaterThan(count);
      const response = responses.at(-1)!; expect(response.status()).toBe(200);
      const cursor = new URL(response.url()).searchParams.get('cursor'); expect(cursor).toBeTruthy(); expect(cursors.has(cursor!)).toBe(false); cursors.add(cursor!);
      await expect(region.getByRole('button', { name: 'Loading more…', exact: true })).toHaveCount(0);
    }
    await field.selectOption(id);
  } finally { page.off('response', observe); }
}
async function openProposal(page: Page, id: string) {
  const disclosure = page.locator(`[data-proposal-id="${id}"]`);
  await expect(disclosure).toBeVisible();
  if (!(await disclosure.getAttribute('open') !== null)) await disclosure.locator(':scope > summary').click();
  return disclosure;
}
async function findPayerConsent(page: Page, proposalId: string): Promise<EnrollmentTransferConsent> {
  const path = '/api/v1/me/enrollment-transfer-consents', cursors = new Set<string>();
  const first = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'GET');
  await page.goto('/learn/payments');
  let response = await first;
  const region = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Requests to use your original funds', exact: true }) });
  for (;;) {
    expect(response.status()).toBe(200);
    const records = (await response.json()).data as { items: EnrollmentTransferConsent[]; next_cursor: string | null };
    expect(JSON.stringify(records.items)).not.toMatch(confidential);
    expect(JSON.stringify(records.items)).not.toMatch(/learner_id|display_name|allocation_id/);
    const consent = records.items.find(item => item.proposal_id === proposalId);
    if (consent) {
      await expect(region.locator(`a[href="/learn/payments/enrollment-transfer-consents/${consent.consent_id}"]`)).toBeVisible();
      return consent;
    }
    const cursor = records.next_cursor;
    expect(cursor, 'The exact original-payer consent must be discoverable through the real list').toBeTruthy();
    expect(cursors.has(cursor!)).toBe(false); cursors.add(cursor!);
    const next = page.waitForResponse(result => {
      const url = new URL(result.url());
      return url.pathname === path && url.searchParams.get('cursor') === cursor && result.request().method() === 'GET';
    });
    await region.getByRole('button', { name: 'Load more', exact: true }).click();
    response = await next;
    await expect(region.getByRole('button', { name: 'Loading more…', exact: true })).toHaveCount(0);
  }
}

test('a session transfer preserves the funded source until exact learner, tutor and original-payer consent is applied', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const f = await paymentFixture({ charge: 'enrollment' }), sourceId = f.enrollmentId!;
  const sourceOccurrence = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [sourceId])).rows[0].occurrence_id as string;
  const approveFee = (occurrenceId: string) => f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Synthetic exact source and destination teaching agreements', p_expected_version: 1, p_idempotency_key: randomUUID() });
  await approveFee(sourceOccurrence);
  const receiving = await f.receiving(), paid = await settleEnrollment(f, sourceId, 0, 50000, receiving);
  const destination = await f.occurrence('private', f.interval(1)), destinationId = String(destination.occurrence_id); await approveFee(destinationId);
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [customer, operator, tutor, payer, unrelated] = await Promise.all(contexts.map(context => context.newPage()));
    await login(customer, 'learner_a'); await customer.goto(`/learn/bookings/${sourceId}`);
    await expect(customer.getByRole('definition').filter({ hasText: /^Confirmed$/ })).toBeVisible();
    await customer.getByText('Request a change', { exact: true }).click();
    const changes = customer.locator('details').filter({ has: customer.locator('summary').getByText('Request a change', { exact: true }) });
    await chooseDestination(customer, changes, destinationId);
    const request = customer.getByRole('form', { name: 'Submit change request', exact: true });
    await request.getByLabel('Request expires at', { exact: true }).fill(cairoInput(new Date(Date.now() + 600000).toISOString()));
    await request.getByLabel('Reason for this request', { exact: true }).fill('Review a replacement session without cancelling the original before consent.');
    const original = await submit(customer, request, 'operation-proposals', 201);
    const initial = await openProposal(customer, original.proposal_id);
    await expect(initial.getByText('This is a request. No replacement seat is held yet; your original booking stays active.', { exact: true })).toBeVisible();
    await expect(initial.getByRole('button', { name: 'Accept transfer terms', exact: true })).toBeDisabled();
    expect((await f.database.query('select count(*)::int n from app_private.enrollments where occurrence_id=$1', [destinationId])).rows[0].n).toBe(0);

    await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${sourceOccurrence}`);
    const adminInitial = await openProposal(operator, original.proposal_id);
    const review = adminInitial.getByRole('form', { name: 'Create reviewed transfer', exact: true });
    await review.getByLabel('Source tutor total after withdrawal (EGP)', { exact: true }).fill('100');
    await review.getByLabel(/^Amount proposed for carryover \(EGP\) — /).fill('500');
    await review.getByLabel('Reason for this decision', { exact: true }).fill('Carry only the exact original payer funds after separate authorization.');
    await mkdir('.local/screenshots', { recursive: true }); await adminInitial.screenshot({ path: `.local/screenshots/t06-session-transfer-admin-${info.project.name}.png` }); expect(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const reviewed = await submit(operator, review, `enrollment-transfer-proposals/${original.proposal_id}/review`, 201);
    expect(reviewed.proposal_id).not.toBe(original.proposal_id); expect(reviewed.new_enrollment_id).not.toBe(sourceId);
    expect((await f.database.query('select state from app_private.enrollments where id=$1', [sourceId])).rows[0].state).toBe('confirmed');
    expect((await f.database.query('select count(*)::int n from finance_private.charges where enrollment_id=$1', [reviewed.new_enrollment_id])).rows[0].n).toBe(0);
    await initial.getByRole('button', { name: 'Refresh details', exact: true }).click();
    await initial.getByRole('button', { name: 'Open the latest transfer review', exact: true }).click();
    const terms = customer.locator(`[data-proposal-id="${reviewed.proposal_id}"]`);
    await expect(terms).toHaveAttribute('open', '');
    const termsResponse = await contexts[0].request.get(`/api/v1/enrollment-transfer-proposals/${reviewed.proposal_id}?view=customer&learner_id=${f.learnerId}`);
    expect(termsResponse.status()).toBe(200); const data = (await termsResponse.json()).data;
    expect(data.terms).toMatchObject({ source_cash_release_minor: 50000, planned_carryover_minor: 50000 });
    expect(JSON.stringify(data)).not.toMatch(confidential); expect(await customer.locator('body').innerText()).not.toMatch(/Source tutor total|Current source tutor agreement|Existing destination tutor agreement/);
    await mkdir('.local/screenshots', { recursive: true }); await terms.screenshot({ path: `.local/screenshots/t06-session-transfer-${info.project.name}.png` });
    const accept = terms.getByRole('form', { name: 'Accept transfer terms', exact: true }); await accept.getByLabel('I accept this replacement session and the displayed changes to my original booking.', { exact: true }).check();
    await submit(customer, accept, `operation-proposals/${reviewed.proposal_id}/accept`);
    await customer.goto(`/learn/bookings/${reviewed.new_enrollment_id}`);
    await expect(customer.getByRole('button', { name: 'Accept this quote', exact: true })).toHaveCount(0);
    expect((await (await contexts[0].request.get(`/api/v1/enrollments/${reviewed.new_enrollment_id}`)).json()).data).toMatchObject({ state: 'held', transfer_link: { role: 'destination', proposal_id: reviewed.proposal_id }, funding: { conditional_transfer_proposal_id: reviewed.proposal_id, eligible: false } });

    await login(payer, 'learner_a');
    const consent = await findPayerConsent(payer, reviewed.proposal_id);
    expect(consent).toMatchObject({ state: 'awaiting_acceptance', carryover_minor: 50000 }); expect(JSON.stringify(consent)).not.toMatch(confidential); expect(JSON.stringify(consent)).not.toMatch(/learner_id|display_name|allocation_id/);
    await payer.getByRole('link', { name: 'Authorize original funds for a replacement session', exact: true }).and(payer.locator(`[href="/learn/payments/enrollment-transfer-consents/${consent.consent_id}"]`)).click();
    const payerAccept = payer.getByRole('form', { name: 'Authorize this carryover', exact: true }); await payerAccept.getByLabel('I authorize these exact original funds for the displayed replacement booking.', { exact: true }).check();
    await payer.screenshot({ path: `.local/screenshots/t06-session-transfer-payer-${info.project.name}.png` }); expect(await payer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await submit(payer, payerAccept, `enrollment-transfer-consents/${consent.consent_id}/accept`);
    await login(unrelated, 'learner_b'); expect([403, 404]).toContain((await contexts[4].request.get(`/api/v1/enrollment-transfer-consents/${consent.consent_id}`)).status());
    expect([403, 404]).toContain((await contexts[4].request.get(`/api/v1/enrollment-transfer-proposals/${reviewed.proposal_id}?view=customer&learner_id=${f.learnerId}`)).status());

    await login(tutor, f.actor); await tutor.goto(`/tutor/schedule?occurrence=${sourceOccurrence}`); const teaching = await openProposal(tutor, reviewed.proposal_id);
    await expect(teaching.getByText('EGP 100.00', { exact: true })).toBeVisible();
    const teachingAccept = teaching.getByRole('form', { name: 'Accept reviewed teaching terms', exact: true }); await teachingAccept.getByLabel('I accept the displayed teaching terms after this learner’s withdrawal.', { exact: true }).check(); await submit(tutor, teachingAccept, `operation-proposals/${reviewed.proposal_id}/accept`);
    await operator.reload(); const admin = await openProposal(operator, reviewed.proposal_id);
    const approval = admin.getByRole('form', { name: 'Review transfer approval', exact: true }); await approval.getByLabel('Decision', { exact: true }).selectOption('approved'); await approval.getByLabel('Reason for this decision', { exact: true }).fill('All current customer, payer and source tutor consents are recorded.'); await submit(operator, approval, `operation-proposals/${reviewed.proposal_id}/approve`);
    const approved = await openProposal(operator, reviewed.proposal_id), apply = approved.getByRole('form', { name: 'Apply session transfer', exact: true }); await expect(apply.getByRole('button', { name: 'Apply session transfer', exact: true })).toBeEnabled();
    const moved = await submit(operator, apply, `enrollments/${sourceId}/transfer`); expect(moved.new_enrollment_id).toBe(reviewed.new_enrollment_id);
    const old = (await (await contexts[0].request.get(`/api/v1/enrollments/${sourceId}`)).json()).data, next = (await (await contexts[0].request.get(`/api/v1/enrollments/${reviewed.new_enrollment_id}`)).json()).data;
    expect(old).toMatchObject({ state: 'cancelled', transfer_link: { role: 'source', stage: 'committed', other_enrollment_id: reviewed.new_enrollment_id } }); expect(next.state).toBe('confirmed'); expect(JSON.stringify([old, next])).not.toMatch(confidential);
    const balance = (await f.database.query('select finance_private.finance_charge_balance($1) data', [paid.chargeId])).rows[0].data; expect(balance).toMatchObject({ allocated_cash_minor: 0, commercial_net_minor: 0 });
    await customer.reload(); await expect(customer.getByRole('link', { name: 'View original booking', exact: true }).locator('..')).toContainText('The session transfer has been applied.'); await expect(customer.getByText('Request a change', { exact: true })).toBeVisible(); const history = await openProposal(customer, reviewed.proposal_id); await expect(history.getByText('The session transfer has been applied.', { exact: true })).toBeVisible(); await expect(history.getByText('The replacement seat is temporarily held.', { exact: false })).toHaveCount(0); expect(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('.local/ui-review', { recursive: true });
    await contexts[0].storageState({ path: `.local/ui-review/t06-transfer-${info.project.name}-customer.json` });
    await contexts[1].storageState({ path: `.local/ui-review/t06-transfer-${info.project.name}-admin.json` });
    await contexts[3].storageState({ path: `.local/ui-review/t06-transfer-${info.project.name}-payer.json` });
    await writeFile(`.local/ui-review/t06-transfer-${info.project.name}-metadata.json`, JSON.stringify({ sourceId, sourceOccurrence, destinationId, destinationEnrollmentId: reviewed.new_enrollment_id, proposalId: reviewed.proposal_id, consentId: consent.consent_id }));
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});

test('replacement payment instructions and exact payment targets preserve the source until a partly carried transfer commits', async ({ browser }, info) => {
  test.setTimeout(120_000);
  test.info().annotations.push({ type: 'setup-boundary', description: 'Real Auth/RPC helpers stage and accept the transfer, independently settle evidence, link and allocate funds. Browser actions inspect instructions, submit prepared receipt metadata, authorize the conditional target and accept its payer plan. No uploaded bytes or live bank provider are claimed.' });
  const f = await paymentFixture({ charge: 'enrollment' }), sourceId = f.enrollmentId!;
  const sourceOccurrence = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [sourceId])).rows[0].occurrence_id;
  const fee = (occurrenceId: string) => f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Synthetic exact transfer agreements', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    await fee(sourceOccurrence); const receiving = await f.receiving(), paid = await settleEnrollment(f, sourceId, 0, 50000, receiving);
    const destination = await f.occurrence('private'); await fee(String(destination.occurrence_id));
    const sourceVersion = (await f.database.query('select version from app_private.enrollments where id=$1', [sourceId])).rows[0].version;
    const initial = await f.rpc('create_operation_proposal', { p_kind: 'reschedule', p_target_id: sourceId, p_requested_terms: { target_type: 'enrollment', destination_occurrence_id: destination.occurrence_id, expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Exact replacement with partial original funds', p_expected_version: sourceVersion, p_idempotency_key: randomUUID() }, f.learner);
    const reviewed = await f.rpc('review_enrollment_transfer_proposal', { p_proposal_id: initial.proposal_id, p_source_tutor_fee_minor: 10000, p_carryover_allocations: [{ allocation_id: (paid.allocation.allocation_ids as string[])[0], amount_minor: 10000 }], p_source_package_disposition: null, p_reason: 'Only 100 EGP of the original money is proposed for carryover', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const before = await f.rpc('get_enrollment_transfer_proposal', { p_proposal_id: reviewed.proposal_id, p_view: 'customer', p_learner_id: f.learnerId }, f.learner);
    await f.rpc('accept_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: before.terms_hash, p_expected_version: before.version, p_idempotency_key: randomUUID() }, f.learner);
    const chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [reviewed.new_enrollment_id])).rows[0].id;
    const additional = await f.transfer(receiving.id, 15000);
    const fileId = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: chargeId, uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId });
    const page = await context.newPage(); await login(page, 'learner_a'); await page.goto(`/learn/payments/charges/${chargeId}`);
    const instructions = await context.request.get(`/api/v1/charges/${chargeId}/payment-instructions`); expect(instructions.status()).toBe(200);
    const payment = (await instructions.json()).data;
    expect(payment).toMatchObject({ additional_required_minor: 15000, required_for_confirmation_minor: 25000, charge: { commitment_state: 'awaiting_transfer', conditional_transfer_proposal_id: reviewed.proposal_id } });
    expect(JSON.stringify(payment)).not.toMatch(confidential);
    await expect(page.locator('dt').filter({ hasText: /^Still needed for confirmation$/ }).locator('..').getByRole('definition')).toHaveText('EGP 150.00');
    await page.getByLabel('Payment channel', { exact: true }).selectOption(receiving.versionId);
    const receiptForm = page.getByRole('form', { name: 'Submit receipt for review', exact: true });
    await receiptForm.getByLabel('Amount you transferred (EGP)', { exact: true }).fill('150'); await receiptForm.getByLabel('Transfer reference', { exact: true }).fill('Synthetic additional replacement funding');
    await receiptForm.getByLabel('Prepared evidence', { exact: true }).selectOption(fileId);
    const receipt = await submit(page, receiptForm, 'receipts', 201); await page.getByRole('link', { name: 'Follow this receipt', exact: true }).click();
    await page.locator('summary').filter({ hasText: /^Specify how this transfer should be used$/ }).click();
    const planForm = page.getByRole('form', { name: 'Save payment plan', exact: true });
    await expect(planForm.getByText('Additional payment needed: EGP 150.00.', { exact: false })).toBeVisible();
    await planForm.getByLabel(/^Amount for this charge \(EGP\) — /).fill('150'); await planForm.getByLabel('I authorize these exact amounts for the selected charges.', { exact: true }).check();
    const sentPlan = page.waitForRequest(request => new URL(request.url()).pathname === `/api/v1/receipts/${receipt.receipt_id}/payment-plans` && request.method() === 'POST');
    const plan = await submit(page, planForm, `receipts/${receipt.receipt_id}/payment-plans`, 201);
    expect((await sentPlan).postDataJSON().targets).toEqual([{ charge_id: chargeId, amount_minor: 15000, conditional_amendment_id: null, conditional_transfer_proposal_id: reviewed.proposal_id }]);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const link = await f.rpc('link_transfer_payment_plan', { p_case_id: receipt.case_id, p_transfer_id: additional.id, p_payment_plan_id: plan.payment_plan_id, p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    await page.goto(`/learn/payments/plans/${link.plan_link_id}`);
    await expect(page.getByText('Funds support a replacement session. Your original booking stays active until the reviewed transfer is applied.', { exact: true })).toBeVisible();
    const payerPlan = page.getByRole('form', { name: 'Accept payment plan', exact: true }); await payerPlan.getByLabel('I own this transfer and accept these exact payment targets and amounts.', { exact: true }).check(); await submit(page, payerPlan, `transfers/${additional.id}/accept-payment-plan`);
    const caseVersion = (await f.database.query('select version from app_private.review_cases where id=$1', [receipt.case_id])).rows[0].version;
    const allocation = { p_case_id: receipt.case_id, p_transfer_id: additional.id, p_evidence_version: 1, p_payment_plan_id: plan.payment_plan_id, p_allocations: [{ charge_id: chargeId, amount_minor: 15000 }], p_expected_version: caseVersion, p_idempotency_key: randomUUID() };
    await retryFinancialConflict(() => f.rpc('allocate_transfer', allocation, f.reviewer));
    const currentSource = (await (await context.request.get(`/api/v1/enrollments/${sourceId}`)).json()).data, staged = (await (await context.request.get(`/api/v1/enrollments/${reviewed.new_enrollment_id}`)).json()).data;
    expect(currentSource.state).toBe('confirmed'); expect(staged).toMatchObject({ state: 'held', funding: { reason: 'TRANSFER_PENDING', eligible: false, conditional_transfer_proposal_id: reviewed.proposal_id } });
    expect((await f.database.query('select finance_private.finance_charge_balance($1) data', [paid.chargeId])).rows[0].data).toMatchObject({ allocated_cash_minor: 50000, commercial_net_minor: 50000 });
    await page.goto(`/learn/bookings/${reviewed.new_enrollment_id}`); const review = await openProposal(page, String(reviewed.proposal_id));
    await expect(review.getByText('The replacement seat is temporarily held. Your original booking stays active until Git Tutor applies the transfer.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const consentId = (await f.database.query('select id from app_private.enrollment_transfer_consents where proposal_id=$1', [reviewed.proposal_id])).rows[0].id;
    const carry = await f.rpc('get_enrollment_transfer_consent', { p_consent_id: consentId }, f.learner);
    await f.rpc('accept_enrollment_transfer_consent', { p_consent_id: consentId, p_terms_hash: carry.terms_hash, p_expected_version: carry.version, p_idempotency_key: randomUUID() }, f.learner);
    const teaching = await f.rpc('get_enrollment_transfer_proposal', { p_proposal_id: reviewed.proposal_id, p_view: 'tutor' }, f.tutor);
    await f.rpc('accept_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: teaching.terms_hash, p_expected_version: teaching.version, p_idempotency_key: randomUUID() }, f.tutor);
    const admin = await f.rpc('get_enrollment_transfer_proposal', { p_proposal_id: reviewed.proposal_id, p_view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: admin.terms_hash, p_decision: 'approved', p_reason: 'Exact existing carryover plus additional payment', p_expected_version: admin.version, p_idempotency_key: randomUUID() });
    await f.rpc('transfer_enrollment', { p_enrollment_id: sourceId, p_destination_occurrence_id: destination.occurrence_id, p_accepted_proposal_id: reviewed.proposal_id, p_expected_version: sourceVersion, p_idempotency_key: randomUUID() });
    const final = (await (await context.request.get(`/api/v1/enrollments/${reviewed.new_enrollment_id}`)).json()).data; expect(final.state).toBe('confirmed'); expect(JSON.stringify(final)).not.toMatch(confidential);
    expect((await f.database.query('select finance_private.finance_charge_balance($1) data', [chargeId])).rows[0].data).toMatchObject({ allocated_cash_minor: 25000, commercial_net_minor: 50000, receivable_minor: 25000 });
  } finally { await context.close(); await f.close(); }
});
