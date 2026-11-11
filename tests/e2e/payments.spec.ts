import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { paymentFixture } from '../helpers/payments';
import { fundedAmendmentFixture } from '../helpers/funded-amendments';
import { prepareAmendmentReceipt, reserveFutureAmendment, settleEnrollment } from '../helpers/financial-booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { authClient, loadLocalSupabase } from '../helpers/supabase';
import { formatCairoInstant } from '@/modules/booking/scheduling';

test.use({ trace: 'off', screenshot: 'off' });
const baseURL = 'http://127.0.0.1:3000';
const confidential = /fee_minor|compensation_policy_version|fee_min_minor|fee_max_minor|internal_notes|payout_destination|provider_token|ledger_lines|identifier_ciphertext|source_provenance/;
async function login(page: Page, label: string | { id: string; email: string; password: string }) {
  page.setDefaultTimeout(15_000);
  const actor = typeof label === 'string' ? loadLocalSupabase().actors[label] : label;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByTestId('account-id')).toHaveText(actor.id, { timeout: 15_000 });
}
async function submit(page: Page, form: Locator, path: string, status = 200, verifyRolledBack?: () => Promise<void>) {
  const send = async () => {
    const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
    await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click();
    return response;
  };
  let result = await send(), body = await result.json();
  if (verifyRolledBack && result.status() === 503 && body.code === 'RETRYABLE_CONFLICT') {
    test.info().annotations.push({ type: 'explicit-ui-retry', description: `Rolled-back RETRYABLE_CONFLICT at ${path}; retry must preserve key and body.` });
    await expect(form.getByRole('alert')).toContainText('Another change is in progress. Retry this action shortly.');
    await verifyRolledBack();
    const originalKey = result.request().headers()['idempotency-key'], originalBody = result.request().postData();
    expect(originalKey).toBeTruthy();
    result = await send(); body = await result.json();
    expect(result.request().headers()['idempotency-key']).toBe(originalKey);
    expect(result.request().postData()).toBe(originalBody);
  }
  expect(result.status(), `${body.code || ''}: ${body.message || ''}`).toBe(status);
  return body.data;
}
function cairoInput(instant: string) { const time = formatCairoInstant(instant); return `${time.local_date}T${time.local_time}`; }

test('changing an incoming filter discards an old page and leaves current pagination usable', async ({ page }) => {
  await login(page, 'cs_a');
  let releaseOld!: () => void;
  const holdOld = new Promise<void>(resolve => { releaseOld = resolve; });
  const row = (label: string) => ({ transfer_id: randomUUID(), version: 1, channel: 'instapay', amount_minor: 10000, currency: 'EGP', state: 'pending', settled_at: null, reversed_minor: 0, available_minor: 0, refund_reserved_minor: 0, recovery_exposure_minor: 0, reconciliation_state: 'clear', payer_is_current_account: false, receiving_account_id: randomUUID(), receiving_account_version_id: randomUUID(), external_id: label, observed_at: new Date().toISOString(), payer: null });
  const first = row('Synthetic initial entry'), filtered = row('Synthetic filtered entry'), stale = row('Synthetic stale page'), next = row('Synthetic current next page');
  await page.route('**/api/v1/incoming-transfers?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === 'old-page') { await holdOld; await route.fulfill({ json: { data: { items: [stale], next_cursor: null } } }).catch(() => {}); return; }
    const result = url.searchParams.get('cursor') === 'new-page' ? { items: [next], next_cursor: null } : url.searchParams.get('state') === 'pending' ? { items: [filtered], next_cursor: 'new-page' } : { items: [first], next_cursor: 'old-page' };
    await route.fulfill({ json: { data: result } });
  });
  try {
    await page.goto('/service/payments/incoming'); const incoming = page.locator('#incoming');
    await expect(incoming.getByRole('heading', { name: first.external_id, exact: true })).toBeVisible();
    await incoming.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(incoming.getByRole('button', { name: 'Loading more…', exact: true })).toBeDisabled();
    await incoming.getByLabel('Status', { exact: true }).selectOption('pending');
    await expect(incoming.getByRole('heading', { name: filtered.external_id, exact: true })).toBeVisible();
    await expect(incoming.getByRole('button', { name: 'Load more', exact: true })).toBeEnabled();
    releaseOld();
    await incoming.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(incoming.getByRole('heading', { name: next.external_id, exact: true })).toBeVisible();
    await expect(incoming.getByRole('heading', { name: stale.external_id, exact: true })).toHaveCount(0);
    await expect(incoming.getByRole('heading', { name: first.external_id, exact: true })).toHaveCount(0);
  } finally { releaseOld(); await page.unroute('**/api/v1/incoming-transfers?*'); }
});

test('a former guardian with no current roles retains own-source access without learner disclosure', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const fixture = await paymentFixture(), config = loadLocalSupabase();
  const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `payment.former.${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}!`;
  const created = await provider.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('SYNTHETIC_PAYER_AUTH_FAILED');
  const actor = { id: created.data.user.id, email, password };
  const payer = createClient(config.url, config.publishable_key, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } });
  if ((await payer.auth.signInWithPassword({ email, password })).error) throw new Error('SYNTHETIC_PAYER_AUTH_FAILED');
  const customer = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const contact = (await fixture.database.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null', [actor.id])).rows[0].id;
    const invitation = await fixture.rpc('create_guardian_invitation', { p_contact_id: contact, p_scopes: ['payments'], p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() }, fixture.learner);
    const token = (await fixture.database.query("select payload->>'single_use_token' as token from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitation.invitation_id])).rows[0].token;
    const link = await fixture.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: token, p_expected_version: 1, p_idempotency_key: randomUUID() }, payer);
    const account = await fixture.receiving(), transfer = await fixture.transfer(account.id, 10000, true, false);
    const ownerEvidence = await fixture.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
    await fixture.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: actor.id, p_evidence_file_id: ownerEvidence, p_reason: 'Actual fresh synthetic source owner', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, fixture.reviewer);
    const page = await customer.newPage(); await login(page, actor); await page.goto(`/learn/payments/charges/${fixture.chargeId}`);
    await expect(page.getByLabel('Payment channel', { exact: true })).toBeVisible();
    await fixture.rpc('revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_reason: 'Synthetic guardian consent withdrawn', p_expected_version: 1, p_idempotency_key: randomUUID() }, fixture.learner);
    // The guarded local fixture represents a legacy verified payer with no current memberships. Only the fresh actor is changed.
    await fixture.database.query("update app_private.account_roles set revoked_at=now(),reason='Synthetic roleless payer fixture',version=version+1 where account_id=$1 and revoked_at is null", [actor.id]);
    const me = await customer.request.get('/api/v1/me'); expect(me.status()).toBe(200); expect((await me.json()).data.roles).toEqual([]);
    const denied = await customer.request.get(`/api/v1/charges/${fixture.chargeId}/payment-instructions`); expect([403, 404]).toContain(denied.status());
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email address', { exact: true }).fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/learn/payments`);
    await page.goto(`/learn/payments/transfers/${transfer.id}`);
    await expect(page).toHaveURL(new RegExp(`/learn/payments/transfers/${transfer.id}$`));
    await expect(page.getByRole('heading', { name: 'Your money & refunds', exact: true })).toBeVisible();
    const owned = await customer.request.get(`/api/v1/transfers/${transfer.id}/own`); expect(owned.status()).toBe(200); const dto = (await owned.json()).data;
    expect(dto.view).toBe('payer_only'); expect(dto.credit.available_minor).toBe(10000); expect(JSON.stringify(dto)).not.toMatch(/learner_id|display_name|external_id|receiving_account_id/); expect(JSON.stringify(dto)).not.toMatch(confidential);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await customer.close(); await payer.auth.signOut({ scope: 'local' }); await fixture.close(); }
});

test('payer-authorized credit creates a separate exact grant without paying the package purchase charge', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const fixture = await paymentFixture(), receiving = await fixture.receiving(), transfer = await fixture.transfer(receiving.id, 50000);
  const source = (await fixture.database.query('select id from finance_private.customer_credit_lots where transfer_id=$1', [transfer.id])).rows[0].id;
  const policy = await fixture.rpc('create_package_grant_policy', { p_content: { name: 'Synthetic exact source-credit policy', eligible_package_contract_version_ids: [fixture.policyId], currency: 'EGP', valuation_rule: 'reviewed_exact_source_credit', maximum_credit_quanta_per_grant: 1000, maximum_carrying_value_minor_per_grant: 50000 }, p_idempotency_key: randomUUID() });
  await fixture.rpc('approve_package_grant_policy', { p_grant_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Explicit synthetic exact source valuation', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const customer = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const page = await customer.newPage(), operator = await admin.newPage(); await login(page, 'learner_a'); await page.goto(`/learn/packages/${fixture.purchaseId}`);
    await page.locator('summary').filter({ hasText: /^Use your source credit for a package$/ }).click();
    await page.getByLabel('Your available source credit', { exact: true }).selectOption(source);
    await page.getByLabel('Approved conversion policy', { exact: true }).selectOption(String(policy.resource_id));
    const authorization = page.getByRole('form', { name: 'Authorize source-credit conversion', exact: true });
    await authorization.getByLabel('Credits to authorize', { exact: true }).fill('1');
    await authorization.getByLabel('Source value to authorize (EGP)', { exact: true }).fill('500');
    await authorization.getByLabel('Consent valid until', { exact: true }).fill(cairoInput(new Date(Date.now() + 600000).toISOString()));
    await authorization.getByLabel('I authorize this exact source value and credit quantity for this package.', { exact: true }).check();
    const intent = await submit(page, authorization, 'credit-conversion-intents', 201);
    await login(operator, 'admin_a'); await operator.goto(`/admin/packages?package=${fixture.purchaseId}`);
    await operator.getByLabel('Source-credit authorizations', { exact: true }).selectOption(intent.credit_conversion_intent_id);
    const grant = operator.getByRole('form', { name: 'Apply payer-authorized source credit', exact: true });
    await expect(grant.locator('input[name="credits"], input[name="value"]')).toHaveCount(0);
    await grant.getByLabel('Reason for this action', { exact: true }).fill('Apply the exact current source-owner authorization.');
    const result = await submit(operator, grant, `packages/${fixture.purchaseId}/complimentary-grants`, 201, async () => {
      const before = (await (await customer.request.get(`/api/v1/packages/${fixture.purchaseId}`)).json()).data;
      expect(before.lot_page.items.filter((row: { origin_kind: string }) => row.origin_kind === 'approved_credit')).toHaveLength(0);
      expect(before.package.usable_available_credit_quanta).toBe(0);
    });
    const data = (await (await customer.request.get(`/api/v1/packages/${fixture.purchaseId}`)).json()).data;
    expect(data.package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0, usable_available_credit_quanta: 1000, usable_available_value_minor: 50000, charge: { allocated_minor: 0, balance_minor: 150000 } });
    const lot = data.lot_page.items.find((row: { lot_id: string }) => row.lot_id === result.lot_id);
    expect(data.lot_page.items.filter((row: { origin_kind: string }) => row.origin_kind === 'approved_credit')).toHaveLength(1);
    expect(lot.origin_kind).toBe('approved_credit'); expect(Date.parse(lot.expires_at) - Date.parse(lot.created_at)).toBe(90 * 86400000);
    expect(JSON.stringify(data)).not.toMatch(confidential);
    const owned = (await (await customer.request.get(`/api/v1/transfers/${transfer.id}/own`)).json()).data; expect(owned.credit.available_minor).toBe(0);
    await page.reload(); await expect(page.getByRole('link', { name: 'View payment instructions', exact: true })).toBeVisible();
    await mkdir('.local/ui-review', { recursive: true }); await writeFile(`.local/ui-review/t06-${info.project.name}-credit.json`, JSON.stringify({ packageId: fixture.purchaseId, intentId: intent.credit_conversion_intent_id, transferId: transfer.id }));
  } finally { await Promise.all([customer.close(), admin.close()]); await fixture.close(); }
});

test('a two-learner plan waits for the actual outside payer and survives staff reload before allocation', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const fixture = await paymentFixture(), receiving = await fixture.receiving(), authorClient = await authClient('guardian_a');
  const terms = await fixture.rpc('get_package_contract', { p_package_contract_version_id: fixture.policyId, p_learner_id: fixture.learners[1] }, fixture.students[1]);
  const sibling = await fixture.rpc('purchase_package', { p_learner_id: fixture.learners[1], p_package_contract_version_id: fixture.policyId, p_accepted_terms_hash: terms.terms_hash, p_idempotency_key: randomUUID() }, fixture.students[1]);
  const transfer = await fixture.transfer(receiving.id, 300000, true, false);
  const ownerEvidence = await fixture.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
  await fixture.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: fixture.actor.id, p_evidence_file_id: ownerEvidence, p_reason: 'Independent synthetic outside payer', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, fixture.reviewer);
  const proof = await fixture.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: fixture.chargeId, uploaderId: loadLocalSupabase().actors.guardian_a.id, learnerId: fixture.learnerId, chargeId: fixture.chargeId });
  const receipt = await fixture.rpc('submit_receipt', { p_enrollment_id: null, p_charge_id: fixture.chargeId, p_file_id: proof, p_receiving_account_version_id: receiving.versionId, p_channel: 'instapay', p_transferred_amount_minor: 300000, p_currency: 'EGP', p_reference: transfer.externalId, p_transferred_at: null, p_idempotency_key: randomUUID() }, authorClient);
  await fixture.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, fixture.reviewer);
  const guardian = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), service = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), payer = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const author = await guardian.newPage(), staff = await service.newPage(), owner = await payer.newPage();
    await login(owner, 'learner_a'); await owner.goto(`/learn/payments/${receipt.receipt_id}`);
    await expect(owner.getByText('Only the account that submitted the current ready receipt can specify a payment plan. If you need to change the proof, submit a replacement from your own account first.', { exact: true })).toBeVisible();
    await expect(owner.getByRole('form', { name: 'Save payment plan', exact: true })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(owner).toHaveURL(/\/login$/);
    await login(author, 'guardian_a'); await author.goto(`/learn/payments/${receipt.receipt_id}`);
    await author.locator('summary').filter({ hasText: /^Specify how this transfer should be used$/ }).click();
    await author.getByLabel('Add charges for learner', { exact: true }).selectOption(fixture.learners[1]);
    await author.getByLabel('Choose a charge', { exact: true }).selectOption(String(sibling.charge_id));
    await author.getByRole('button', { name: 'Add selected charge', exact: true }).click();
    const planForm = author.getByRole('form', { name: 'Save payment plan', exact: true });
    await planForm.locator(`input[name="amount-${fixture.chargeId}"]`).fill('1500');
    await planForm.locator(`input[name="amount-${sibling.charge_id}"]`).fill('1500');
    await planForm.getByLabel('I authorize these exact amounts for the selected charges.', { exact: true }).check();
    const plan = await submit(author, planForm, `receipts/${receipt.receipt_id}/payment-plans`, 201);
    await login(staff, 'cs_a'); await staff.goto(`/service/payments/${receipt.case_id}`);
    await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id);
    await staff.getByLabel('Saved customer payment plan', { exact: true }).selectOption(plan.payment_plan_id);
    await expect(staff.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeDisabled();
    const link = await submit(staff, staff.getByRole('form', { name: 'Request source-owner confirmation', exact: true }), `review-cases/${receipt.case_id}/link-payment-plan`, 201);
    await staff.reload(); await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id); await staff.getByLabel('Saved customer payment plan', { exact: true }).selectOption(plan.payment_plan_id);
    await expect(staff.getByText('The verified source owner must accept this exact payment plan. Refresh these records after their response.', { exact: true })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Request source-owner confirmation', exact: true })).toHaveCount(0);
    await expect(staff.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeDisabled();
    await login(owner, fixture.actor); await owner.goto(`/learn/payments/plans/${link.plan_link_id}`);
    const intentResponse = await payer.request.get(`/api/v1/transfer-payment-plans/${link.plan_link_id}`); expect(intentResponse.status()).toBe(200); const intent = (await intentResponse.json()).data;
    expect(intent.targets).toHaveLength(2); expect(intent.targets.map((row: { amount_minor: number }) => row.amount_minor)).toEqual([150000, 150000]); expect(JSON.stringify(intent)).not.toMatch(/learner_id|display_name|fee_minor|compensation/);
    const consent = owner.getByRole('form', { name: 'Accept payment plan', exact: true });
    await consent.getByLabel('I own this transfer and accept these exact payment targets and amounts.', { exact: true }).check();
    await submit(owner, consent, `transfers/${transfer.id}/accept-payment-plan`);
    await staff.reload(); await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id); await staff.getByLabel('Saved customer payment plan', { exact: true }).selectOption(plan.payment_plan_id);
    const allocation = staff.getByRole('form', { name: 'Apply verified funds', exact: true }); await expect(allocation.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeEnabled();
    const result = await submit(staff, allocation, `review-cases/${receipt.case_id}/allocate`, 200, async () => {
      const before = (await (await guardian.request.get(`/api/v1/payments/${receipt.receipt_id}`)).json()).data;
      expect(before.allocation_page.items).toHaveLength(0);
      for (const packageId of [fixture.purchaseId, String(sibling.package_purchase_id)]) expect((await (await guardian.request.get(`/api/v1/packages/${packageId}`)).json()).data.package.purchased_granted_credit_quanta).toBe(0);
    }); expect(result.allocation_ids).toHaveLength(2); expect(result.unapplied_minor).toBe(0);
    await expect(staff.getByText('This review is closed. Its recorded decision remains in the case history.', { exact: true })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Apply verified funds', exact: true })).toHaveCount(0);
    await expect(staff.getByRole('button', { name: 'Renew claim', exact: true })).toHaveCount(0);
    for (const packageId of [fixture.purchaseId, String(sibling.package_purchase_id)]) { const detail = (await (await guardian.request.get(`/api/v1/packages/${packageId}`)).json()).data; expect(detail.package.purchased_granted_credit_quanta).toBe(3000); expect(JSON.stringify(detail)).not.toMatch(confidential); }
  } finally { await Promise.all([guardian.close(), service.close(), payer.close()]); await authorClient.auth.signOut({ scope: 'local' }); await fixture.close(); }
});

test('cancellation review replaces terms and requires fresh private and customer consent before releasing original funds', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const f = await paymentFixture({ charge: 'enrollment' });
  const enrollmentId = f.enrollmentId!, occurrenceId = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [enrollmentId])).rows[0].occurrence_id;
  await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Synthetic bounded original private agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const receiving = await f.receiving(), paid = await settleEnrollment(f, enrollmentId, 0, 50000, receiving);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [page, operator, tutor] = await Promise.all(contexts.map(context => context.newPage()));
    await login(page, 'learner_a'); await page.goto(`/learn/bookings/${enrollmentId}`);
    await page.getByText('Request a change', { exact: true }).click(); await page.getByLabel('Change requested', { exact: true }).selectOption('cancellation_remedy');
    const request = page.getByRole('form', { name: 'Submit change request', exact: true });
    await request.getByLabel('Cancellation remedy', { exact: true }).selectOption('cash_refund');
    await request.getByLabel('Request expires at', { exact: true }).fill(cairoInput(new Date(Date.now() + 600000).toISOString()));
    await request.getByLabel('Reason for this request', { exact: true }).fill('Review exact cancellation of the funded synthetic session.');
    const original = await submit(page, request, 'operation-proposals', 201);
    const initial = page.locator(`[data-proposal-id="${original.proposal_id}"]`); await initial.locator('summary').first().click();
    await expect(initial.getByRole('button', { name: 'Accept these proposed terms', exact: true })).toBeDisabled();
    await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${occurrenceId}`); await operator.getByText('Review proposed terms', { exact: true }).click();
    await operator.locator('summary').filter({ hasText: /^Review cancellation compensation$/ }).click();
    const review = operator.getByRole('form', { name: 'Save exact cancellation review', exact: true });
    const amount = review.getByLabel('Reviewed cancellation compensation (EGP)', { exact: true }); await expect(operator.getByText('Current agreement ceiling: EGP 250.00', { exact: true })).toBeVisible();
    await amount.fill('100'); await review.getByLabel('Reason for this request', { exact: true }).fill('Exact independently reviewed cancellation amount within the active agreement.');
    const revised = await submit(operator, review, `operation-proposals/${original.proposal_id}/revise-cancellation`, 201);
    expect(revised.proposal_id).not.toBe(original.proposal_id);
    await initial.getByRole('button', { name: 'Refresh details', exact: true }).click();
    await initial.getByRole('button', { name: 'Review replacement terms', exact: true }).click();
    const customerTerms = page.locator(`[data-proposal-id="${revised.proposal_id}"]`);
    await expect(customerTerms.getByText('These terms replace an earlier proposal. Review this exact version before responding.', { exact: true })).toBeVisible();
    const dto = (await (await contexts[0].request.get(`/api/v1/operation-proposals/${revised.proposal_id}?view=customer&learner_id=${f.learnerId}`)).json()).data;
    expect(dto.terms).toMatchObject({ customer_price_minor: 0, remedy: 'cash_refund', remedy_amount_minor: 50000 }); expect(JSON.stringify(dto)).not.toMatch(confidential); expect(JSON.stringify(dto)).not.toMatch(/compensation|fee_minor/);
    const customerConsent = customerTerms.getByRole('form', { name: 'Accept these proposed terms', exact: true }); await customerConsent.getByLabel('I accept the displayed change for this learner.').check(); await submit(page, customerConsent, `operation-proposals/${revised.proposal_id}/accept`);
    await login(tutor, f.actor); await tutor.goto(`/tutor/schedule?occurrence=${occurrenceId}`); await tutor.getByText('Review proposed terms', { exact: true }).click();
    await expect(tutor.getByText('Reviewed cancellation compensation (EGP)', { exact: true })).toBeVisible();
    const teachingConsent = tutor.getByRole('form', { name: 'Accept my teaching terms', exact: true }); await teachingConsent.getByLabel('I accept this session time and the displayed teaching terms.').check(); await submit(tutor, teachingConsent, `operation-proposals/${revised.proposal_id}/accept`);
    await operator.reload(); await operator.getByText('Review proposed terms', { exact: true }).click();
    const approval = operator.getByRole('form', { name: 'Save approval decision', exact: true }); await approval.getByLabel('Decision', { exact: true }).selectOption('approved'); await approval.getByLabel('Reason for this request', { exact: true }).fill('Both parties accepted this exact replacement.'); await submit(operator, approval, `operation-proposals/${revised.proposal_id}/approve`);
    await operator.getByText('Review proposed terms', { exact: true }).click(); const apply = operator.getByRole('form', { name: 'Apply approved cancellation', exact: true }); await apply.getByLabel('Reason for this request', { exact: true }).fill('Apply the approved remedy to the original obligation.'); await submit(operator, apply, `enrollments/${enrollmentId}/cancel`);
    const final = (await (await contexts[0].request.get(`/api/v1/enrollments/${enrollmentId}`)).json()).data; expect(final.state).toBe('cancelled'); expect(JSON.stringify(final)).not.toMatch(confidential);
    expect((await (await contexts[0].request.get(`/api/v1/transfers/${paid.transferId}/own`)).json()).data.transfer.available_minor).toBe(50000);
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});

test('reserved cancellation shows exact returned and retained credits before customer consent', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const f = await paymentFixture({ cancellationRefundBasisPoints: 5000 });
  const contexts = await Promise.all(Array.from({ length: 2 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const grant = await f.grantPolicy(50001);
    await f.grant(f.purchaseId, grant, 50001, 1000);
    const held = await f.hold();
    await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Synthetic package cancellation agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: held.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const enrollment = await f.rpc('get_enrollment', { p_enrollment_id: held.enrollmentId }, f.learner);
    const original = await f.rpc('create_operation_proposal', { p_kind: 'cancellation_remedy', p_target_id: held.enrollmentId, p_requested_terms: { target_type: 'enrollment', remedy: 'policy_default', expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Review partial return of reserved credits', p_expected_version: enrollment.version, p_idempotency_key: randomUUID() }, f.learner);
    const [operator, customer] = await Promise.all(contexts.map(context => context.newPage()));
    const errors: string[] = []; for (const page of [operator, customer]) page.on('pageerror', error => errors.push(error.message));
    await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${held.occurrenceId}`);
    await operator.getByText('Review proposed terms', { exact: true }).click();
    await operator.locator('summary').filter({ hasText: /^Review cancellation compensation$/ }).click();
    const review = operator.getByRole('form', { name: 'Save exact cancellation review', exact: true });
    await review.getByLabel('Reviewed cancellation compensation (EGP)', { exact: true }).fill('100');
    await review.getByLabel(/^Credits to return ·/).fill('0.5');
    await review.getByLabel('Reason for this request', { exact: true }).fill('Return half the reserved credits and retain half under the reviewed policy.');
    const revised = await submit(operator, review, `operation-proposals/${original.proposal_id}/revise-cancellation`, 201);
    await login(customer, 'learner_a'); await customer.goto(`/learn/bookings/${held.enrollmentId}`);
    const proposal = customer.locator(`[data-proposal-id="${revised.proposal_id}"]`);
    await proposal.locator('summary').first().click();
    await expect(proposal.locator('div').filter({ has: customer.locator('dt').getByText('Unused teaching credits to return', { exact: true }) }).last()).toContainText('0.5');
    await expect(proposal.getByText('Teaching credits retained for cancellation', { exact: true })).toBeVisible();
    await expect(proposal.getByText('EGP 250.00', { exact: true })).toBeVisible();
    await expect(proposal.getByText('EGP 250.01', { exact: true })).toBeVisible();
    await expect(proposal.getByText('Credits retained for cancellation will no longer be available for lessons. Returned credits keep their original expiry.', { exact: true })).toBeVisible();
    const response = await contexts[1].request.get(`/api/v1/operation-proposals/${revised.proposal_id}?view=customer&learner_id=${f.learnerId}`);
    expect(response.status()).toBe(200); const dto = (await response.json()).data;
    expect(dto.terms).toMatchObject({ old_customer_price_minor: 0, customer_price_minor: 0, customer_adjustment_minor: 0, released_credit_quanta: 500, released_value_minor: 25000, extinguished_credit_quanta: 500, extinguished_value_minor: 25001 });
    expect(JSON.stringify(dto)).not.toMatch(confidential);
    expect(await customer.locator('body').innerText()).not.toMatch(/compensation|Current agreement ceiling|EGP 100\.00/);
    await expect(customer.getByText('Reserved package credits count toward funding. Check the related reservation for its confirmation status.', { exact: true })).toBeVisible();
    await expect(customer.getByText('Session funding and confirmation remain unavailable until payment integration is complete.', { exact: true })).toHaveCount(0);
    await mkdir('.local/screenshots', { recursive: true });
    await proposal.screenshot({ path: `.local/screenshots/t06-partial-cancellation-${info.project.name}.png` });
    const consent = proposal.getByRole('form', { name: 'Accept these proposed terms', exact: true });
    await consent.getByLabel('I accept the displayed change for this learner.').check();
    await submit(customer, consent, `operation-proposals/${revised.proposal_id}/accept`);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});

test('accepted future tuition uses an exact payment target and commits only after both existing learners are funded', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const { f, account, first, second, proposed } = await fundedAmendmentFixture();
  const prepared = await prepareAmendmentReceipt(f, first.enrollmentId, 0, 2500, account);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  try {
    const [page, staff, operator] = await Promise.all(contexts.map(context => context.newPage()));
    await login(page, 'learner_a'); await page.goto(`/learn/payments/${prepared.receipt.receipt_id}`);
    await page.locator('summary').filter({ hasText: /^Specify how this transfer should be used$/ }).click();
    const planForm = page.getByRole('form', { name: 'Save payment plan', exact: true });
    await planForm.getByLabel(/^Apply these funds to —/).selectOption(String(proposed.amendment_id));
    await planForm.locator(`input[name="amount-${prepared.chargeId}"]`).fill('25');
    await planForm.getByLabel('I authorize these exact amounts for the selected charges.', { exact: true }).check();
    const plan = await submit(page, planForm, `receipts/${prepared.receipt.receipt_id}/payment-plans`, 201);
    await login(staff, 'cs_a'); await staff.goto(`/service/payments/${prepared.receipt.case_id}`);
    await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(prepared.transfer.id);
    await staff.getByLabel('Saved customer payment plan', { exact: true }).selectOption(plan.payment_plan_id);
    const link = await submit(staff, staff.getByRole('form', { name: 'Request source-owner confirmation', exact: true }), `review-cases/${prepared.receipt.case_id}/link-payment-plan`, 201);
    await page.goto(`/learn/payments/plans/${link.plan_link_id}`); const consent = page.getByRole('form', { name: 'Accept payment plan', exact: true });
    await consent.getByLabel('I own this transfer and accept these exact payment targets and amounts.', { exact: true }).check();
    await submit(page, consent, `transfers/${prepared.transfer.id}/accept-payment-plan`);
    await staff.reload(); await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(prepared.transfer.id); await staff.getByLabel('Saved customer payment plan', { exact: true }).selectOption(plan.payment_plan_id);
    const reserve = staff.getByRole('form', { name: 'Reserve funds for proposed change', exact: true });
    await expect(reserve.getByRole('button', { name: 'Reserve funds for proposed change', exact: true })).toBeEnabled();
    await submit(staff, reserve, `review-cases/${prepared.receipt.case_id}/reserve-amendment-payment`);
    const before = (await (await contexts[0].request.get(`/api/v1/enrollments/${first.enrollmentId}`)).json()).data;
    expect(before.quote.customer_price_minor).toBe(57500); expect(before.occurrence.target_tier).toBe(2); expect(JSON.stringify(before)).not.toMatch(confidential);
    await reserveFutureAmendment(f, String(proposed.amendment_id), String(second.enrollment_id), 1, 2500, account);
    await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${first.occurrenceId}`); await operator.getByText('Review proposed terms', { exact: true }).click();
    const commit = operator.getByRole('form', { name: 'Apply accepted group change', exact: true });
    await submit(operator, commit, `amendments/${proposed.amendment_id}/commit`);
    const after = (await (await contexts[0].request.get(`/api/v1/enrollments/${first.enrollmentId}`)).json()).data;
    expect(after).toMatchObject({ state: 'confirmed', occurrence: { target_tier: 3 }, quote: { customer_price_minor: 60000 }, funding: { integration_state: 'ready', additional_required_minor: 0, allocated_minor: 60000 } });
    expect(JSON.stringify(after)).not.toMatch(confidential);
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});

test('settled tuition keeps a booking pending until its actual teaching approval permits confirmation', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const fixture = await paymentFixture({ charge: 'enrollment' }), receiving = await fixture.receiving(), transfer = await fixture.transfer(receiving.id), receipt = await fixture.receipt(receiving.versionId);
  await fixture.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, fixture.reviewer);
  const service = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), customer = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const staff = await service.newPage(), operator = await admin.newPage(), page = await customer.newPage();
    await login(staff, 'cs_a'); await staff.goto(`/service/payments/${receipt.case_id}`);
    await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id);
    const allocation = staff.getByRole('form', { name: 'Apply verified funds', exact: true });
    const applied = await submit(staff, allocation, `review-cases/${receipt.case_id}/allocate`);
    expect(applied.confirmation_status).toHaveLength(1);
    expect(applied.confirmation_status[0]).toMatchObject({ state: 'awaiting_requirements', reason: 'FEE_NOT_APPROVED' });
    await expect(staff.getByText('The session still needs an internal approval.', { exact: true })).toBeVisible();
    await login(page, 'learner_a'); await page.goto(`/learn/bookings/${fixture.enrollmentId}`);
    const detail = await customer.request.get(`/api/v1/enrollments/${fixture.enrollmentId}`); expect(detail.status()).toBe(200); const pending = (await detail.json()).data;
    expect(pending.occurrence.state).toBe('forming'); expect(pending.funding.allocated_minor).toBe(50000); expect(pending.funding.balance_minor).toBe(0);
    expect(JSON.stringify(pending)).not.toMatch(confidential);
    await expect(page.getByTestId('confirmation-explanation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm session', exact: true })).toHaveCount(0);
    await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${pending.occurrence.occurrence_id}`);
    const fee = operator.getByRole('form', { name: 'Approve exact tutor fee', exact: true });
    const feeAmount = fee.getByLabel('Exact tutor fee (EGP)', { exact: true });
    // The selected approved pricing record may load asynchronously. Its actual configured lower bound is displayed by the editor.
    await expect.poll(async () => Number(await feeAmount.getAttribute('min'))).toBeGreaterThan(0);
    await feeAmount.fill((await feeAmount.getAttribute('min'))!);
    await fee.getByLabel('Fee approval reason', { exact: true }).fill('Approve the exact configured agreement after tuition verification.');
    await submit(operator, fee, `occurrences/${pending.occurrence.occurrence_id}/fee-agreements`, 201);
    const confirm = operator.getByRole('form', { name: 'Confirm session', exact: true });
    await expect(confirm.getByRole('button', { name: 'Confirm session', exact: true })).toBeEnabled();
    await submit(operator, confirm, `occurrences/${pending.occurrence.occurrence_id}/confirm`);
    await page.reload(); const confirmedResponse = await customer.request.get(`/api/v1/enrollments/${fixture.enrollmentId}`); const confirmed = (await confirmedResponse.json()).data;
    expect(confirmed.occurrence.state).toBe('confirmed'); expect(confirmed.state).toBe('confirmed'); expect(confirmed.meeting_status).not.toBe('ready'); expect(JSON.stringify(confirmed)).not.toMatch(confidential);
    await expect(page.getByRole('link', { name: 'View payment instructions', exact: true })).toBeVisible();
    await mkdir('.local/ui-review', { recursive: true });
    await admin.storageState({ path: `.local/ui-review/t06-${info.project.name}-admin.json` });
    await writeFile(`.local/ui-review/t06-${info.project.name}-booking.json`, JSON.stringify({ enrollmentId: fixture.enrollmentId, occurrenceId: confirmed.occurrence.occurrence_id, caseId: receipt.case_id }));
  } finally { await Promise.all([service.close(), admin.close(), customer.close()]); await fixture.close(); }
});

test('customer proof is applied only after independent settlement and source-owner verification', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const fixture = await paymentFixture(), receiving = await fixture.receiving(), transfer = await fixture.transfer(receiving.id, 155000, false, false);
  const receiptFile = await fixture.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: fixture.chargeId, uploaderId: fixture.learnerAccountId, learnerId: fixture.learnerId, chargeId: fixture.chargeId });
  const ownerFile = await fixture.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
  const customer = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), service = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
  try {
    const page = await customer.newPage(), staff = await service.newPage();
    await login(page, 'learner_a');
    await page.goto(`/learn/payments/charges/${fixture.chargeId}`);
    await expect(page.getByRole('heading', { name: 'Payment instructions', exact: true }).first()).toBeVisible();
    await page.getByLabel('Payment channel', { exact: true }).selectOption(receiving.versionId);
    const receipt = page.getByRole('form', { name: 'Submit receipt for review', exact: true });
    await receipt.getByLabel('Amount you transferred (EGP)', { exact: true }).fill('1550');
    await receipt.getByLabel('Transfer reference', { exact: true }).fill(transfer.externalId);
    await receipt.getByLabel('Prepared evidence', { exact: true }).selectOption(receiptFile);
    const reported = await submit(page, receipt, 'receipts', 201);
    await page.getByRole('link', { name: 'Follow this receipt', exact: true }).click();
    await expect(page.getByText('Ready for review', { exact: true }).first()).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(confidential);
    const customerReceipt = await customer.request.get(`/api/v1/payments/${reported.receipt_id}`);
    expect(customerReceipt.status()).toBe(200); expect(JSON.stringify(await customerReceipt.json())).not.toMatch(confidential);

    await login(staff, 'cs_a'); await staff.goto('/service/payments');
    const row = staff.locator(`[data-case-id="${reported.case_id}"]`);
    await submit(staff, row.getByRole('form', { name: 'Claim case', exact: true }), `review-cases/${reported.case_id}/claim`);
    await expect(staff).toHaveURL(new RegExp(`/service/payments/${reported.case_id}$`));
    await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id);
    await expect(staff.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeDisabled();
    await expect(staff.getByText('Settle the independently sourced transfer before applying funds.', { exact: true })).toBeVisible();
    await staff.getByRole('link', { name: 'View your transfer', exact: true }).click();
    const settlement = staff.getByRole('form', { name: 'Verify settled funds', exact: true });
    await settlement.getByLabel('Verified settlement time', { exact: true }).fill(cairoInput(transfer.observedAt));
    await settlement.getByLabel('Settlement verification note', { exact: true }).fill('Reviewed the independently prepared synthetic statement.');
    await settlement.getByLabel('Prepared evidence', { exact: true }).selectOption(transfer.fileId);
    await submit(staff, settlement, `transfers/${transfer.id}/verify`);
    const lookup = staff.getByRole('form', { name: 'Find verified account', exact: true });
    await lookup.getByLabel('Exact verified contact', { exact: true }).fill(loadLocalSupabase().actors.learner_a.email);
    const lookupResponse = staff.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/incoming-transfers/${transfer.id}/payer-lookup`);
    await lookup.getByRole('button', { name: 'Find verified account', exact: true }).click();
    expect((await lookupResponse).status()).toBe(200);
    const binding = staff.getByRole('form', { name: 'Verify source owner', exact: true });
    await binding.getByLabel('Verified source owner', { exact: true }).selectOption(fixture.learnerAccountId);
    await binding.getByLabel('Independent ownership evidence', { exact: true }).selectOption(ownerFile);
    await binding.getByLabel('Reason for this action', { exact: true }).fill('Independent synthetic source-owner evidence matches the verified account.');
    await submit(staff, binding, `transfers/${transfer.id}/bind-payer`);
    await staff.goto(`/service/payments/${reported.case_id}`);
    await staff.getByLabel('Choose an incoming transfer', { exact: true }).selectOption(transfer.id);
    const allocation = staff.getByRole('form', { name: 'Apply verified funds', exact: true });
    await expect(allocation.getByRole('button', { name: 'Apply verified funds', exact: true })).toBeEnabled();
    const applied = await submit(staff, allocation, `review-cases/${reported.case_id}/allocate`);
    expect(applied.unapplied_minor).toBe(5000);
    await page.goto(`/learn/packages/${fixture.purchaseId}`);
    const packageResponse = await customer.request.get(`/api/v1/packages/${fixture.purchaseId}`);
    expect(packageResponse.status()).toBe(200); const saved = (await packageResponse.json()).data;
    expect(saved.package.balances.available_credit_quanta).toBe(3000);
    expect(JSON.stringify(saved)).not.toMatch(confidential);
    const instructionsResponse = await customer.request.get(`/api/v1/charges/${fixture.chargeId}/payment-instructions`);
    expect((await instructionsResponse.json()).data.charge.balance_minor).toBe(0);
    await page.goto(`/learn/payments/transfers/${transfer.id}`);
    await expect(page.getByText('EGP 50.00', { exact: true }).first()).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(confidential);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('.local/ui-review', { recursive: true });
    await customer.storageState({ path: `.local/ui-review/t06-${info.project.name}-customer.json` });
    await service.storageState({ path: `.local/ui-review/t06-${info.project.name}-service.json` });
    await writeFile(`.local/ui-review/t06-${info.project.name}-payment.json`, JSON.stringify({ packageId: fixture.purchaseId, chargeId: fixture.chargeId, transferId: transfer.id, receiptId: reported.receipt_id, caseId: reported.case_id }));
  } finally { await Promise.all([customer.close(), service.close()]); await fixture.close(); }
});

test('payment and refund workspaces require a verified session', async ({ page }) => {
  for (const path of ['/learn/payments', '/learn/refunds', '/service/payments', '/admin/payments', '/admin/refunds']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login(?:\?return_to=[^&]+)?$/);
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  }
});

test.describe('private refund destination', () => {
  test('an original payer receives a verified refund; unknown holds funds and a partial return restores its source', async ({ browser }, info) => {
    test.setTimeout(150_000);
    const fixture = await paymentFixture(), receiving = await fixture.receiving(), transfer = await fixture.transfer(receiving.id, 10000);
    const customer = await browser.newContext({ baseURL, viewport: info.project.use.viewport }), admin = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    try {
      const page = await customer.newPage(), operator = await admin.newPage(); await login(page, 'learner_a'); await page.goto('/learn/refunds');
      await page.getByLabel('Original payment source', { exact: true }).selectOption(`unapplied_credit:${transfer.id}:self`);
      const request = page.getByRole('form', { name: 'Request refund', exact: true });
      await request.getByLabel('Refund amount (EGP)', { exact: true }).fill('50');
      await request.getByLabel('Reason for the refund request', { exact: true }).fill('Return unused funds to the verified original payer.');
      const refund = await submit(page, request, 'refunds', 201);
      const ownership = await fixture.evidence({ purpose: 'refund_destination', parentType: 'refund', parentId: refund.refund_id, uploaderId: fixture.learnerAccountId });
      await page.getByRole('link', { name: 'View refund', exact: true }).last().click();
      const destination = page.getByRole('form', { name: 'Propose refund destination', exact: true });
      const identifier = `synthetic-private-${randomUUID()}@instapay`;
      await destination.getByLabel('Destination account or wallet', { exact: true }).fill(identifier);
      await destination.getByLabel('Account holder name', { exact: true }).fill('Synthetic original payer');
      await destination.getByLabel('Destination ownership evidence', { exact: true }).selectOption(ownership);
      const proposed = await submit(page, destination, `refunds/${refund.refund_id}/destination`, 201);
      expect(JSON.stringify(proposed).includes(identifier)).toBe(false);
      await expect.poll(async () => page.locator('input[name="identifier"]').evaluateAll(fields => fields.every(field => !(field as HTMLInputElement).value))).toBe(true);
      expect(await page.evaluate(value => Object.values(sessionStorage).some(item => item.includes(value)), identifier)).toBe(false);
      const candidates = await customer.request.get(`/api/v1/refunds/${refund.refund_id}/destinations`); expect(candidates.status()).toBe(200); const candidateDto = await candidates.json();
      expect(JSON.stringify(candidateDto).includes(identifier)).toBe(false); expect(JSON.stringify(candidateDto)).not.toMatch(/encrypted_identifier|ciphertext|fingerprint|nonce/);
      const independent = await fixture.evidence({ purpose: 'refund_destination_verification', parentType: 'refund_destination', parentId: proposed.destination_id });
      await login(operator, 'admin_a'); await operator.goto(`/admin/refunds/${refund.refund_id}`);
      const verify = operator.getByRole('form', { name: 'Verify destination ownership', exact: true });
      await verify.getByLabel('Destination ownership evidence', { exact: true }).selectOption(independent);
      await verify.getByLabel('Reason for this action', { exact: true }).fill('Independent prepared synthetic proof verifies the original payer destination.');
      const verified = await submit(operator, verify, `refund-destinations/${proposed.destination_id}/verify`);
      expect(verified.verification_status).toBe('verified');
      expect(JSON.stringify(verified).includes(identifier)).toBe(false);
      await page.reload(); const detail = await customer.request.get(`/api/v1/refunds/${refund.refund_id}`); expect(detail.status()).toBe(200); const data = (await detail.json()).data;
      expect(data.state).toBe('requested'); expect(data.settled_minor).toBe(0); expect(data.reserved_minor).toBe(0);
      expect(JSON.stringify(data).includes(identifier)).toBe(false); expect(JSON.stringify(data)).not.toMatch(confidential);
      await expect(operator.getByRole('button', { name: 'Approve and reserve refund', exact: true })).toBeDisabled();
      const approval = operator.getByRole('form', { name: 'Approve and reserve refund', exact: true });
      await approval.getByLabel('Verified destination', { exact: true }).selectOption(verified.destination_version_id);
      await expect(approval.getByRole('button', { name: 'Approve and reserve refund', exact: true })).toBeEnabled();
      await approval.getByLabel('Reason for this action', { exact: true }).fill('Return only the verified unused original source funds.');
      await submit(operator, approval, `refunds/${refund.refund_id}/approve`);
      const start = operator.getByRole('form', { name: 'Record outgoing attempt', exact: true });
      await start.getByLabel('Outgoing transaction reference', { exact: true }).fill(`synthetic-outgoing-${randomUUID()}`);
      const attempt = await submit(operator, start, `refunds/${refund.refund_id}/attempts`, 201);
      const evidence = await fixture.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: attempt.attempt_id });
      await operator.getByLabel('Outgoing attempt to review', { exact: true }).selectOption(attempt.attempt_id);
      const reveal = operator.locator('details').filter({ has: operator.locator('summary').filter({ hasText: /^View destination for this attempt$/ }) });
      await reveal.locator('summary').click(); await reveal.getByLabel('Reason for viewing the destination', { exact: true }).fill('Check the pinned destination for this synthetic outgoing attempt.');
      const revealedResponse = operator.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/refund-destinations/${proposed.destination_id}/reveal`);
      await reveal.getByRole('button', { name: 'View destination for this attempt', exact: true }).click();
      const revealed = await revealedResponse; expect(revealed.status()).toBe(200); expect(revealed.headers()['cache-control']).toContain('no-store');
      await expect.poll(async () => (await reveal.locator('output').textContent()) === identifier).toBe(true);
      await reveal.getByRole('button', { name: 'Hide destination', exact: true }).click(); await expect(reveal.locator('output')).toHaveCount(0);
      expect(await operator.evaluate(value => Object.values(sessionStorage).some(item => item.includes(value)), identifier)).toBe(false);
      let reconcile = operator.getByRole('form', { name: 'Record verified outcome', exact: true });
      await reconcile.getByLabel('Prepared evidence', { exact: true }).selectOption(evidence);
      await submit(operator, reconcile, `refunds/${refund.refund_id}/reconcile`);
      await expect(operator.getByRole('button', { name: 'Record outgoing attempt', exact: true })).toHaveCount(0);
      const unknown = (await (await customer.request.get(`/api/v1/refunds/${refund.refund_id}`)).json()).data;
      expect(unknown).toMatchObject({ state: 'unknown', reserved_minor: 5000, settled_minor: 0, returned_minor: 0 });
      expect((await (await customer.request.get(`/api/v1/transfers/${transfer.id}/own`)).json()).data.transfer).toMatchObject({ available_minor: 5000, refund_reserved_minor: 5000 });
      await operator.getByLabel('Outgoing attempt to review', { exact: true }).selectOption(attempt.attempt_id);
      reconcile = operator.getByRole('form', { name: 'Record verified outcome', exact: true });
      await reconcile.getByLabel('Observed outcome', { exact: true }).selectOption('settled');
      await reconcile.getByLabel('Verified settlement time', { exact: true }).fill(cairoInput(new Date().toISOString()));
      await reconcile.getByLabel('Prepared evidence', { exact: true }).selectOption(evidence);
      await submit(operator, reconcile, `refunds/${refund.refund_id}/reconcile`);
      const settled = (await (await customer.request.get(`/api/v1/refunds/${refund.refund_id}`)).json()).data;
      expect(settled).toMatchObject({ state: 'settled', reserved_minor: 0, settled_minor: 5000, returned_minor: 0 });
      const returnEvidence = await fixture.evidence({ purpose: 'refund_reversal', parentType: 'refund_attempt', parentId: attempt.attempt_id });
      await operator.getByLabel('Outgoing attempt to review', { exact: true }).selectOption(attempt.attempt_id);
      await operator.locator('summary').filter({ hasText: /^Record returned refund$/ }).click();
      const returned = operator.getByRole('form', { name: 'Record returned refund', exact: true });
      await returned.getByLabel('External return reference', { exact: true }).fill(`synthetic-return-${randomUUID()}`);
      await returned.getByLabel('Amount returned (EGP)', { exact: true }).fill('20');
      await returned.getByLabel('Effective time', { exact: true }).fill(cairoInput(new Date().toISOString()));
      await returned.getByLabel('Prepared evidence', { exact: true }).selectOption(returnEvidence);
      await submit(operator, returned, `refunds/${refund.refund_id}/reversals`);
      const final = (await (await customer.request.get(`/api/v1/refunds/${refund.refund_id}`)).json()).data;
      expect(final).toMatchObject({ state: 'partially_reversed', reserved_minor: 0, settled_minor: 5000, returned_minor: 2000 });
      expect((await (await customer.request.get(`/api/v1/transfers/${transfer.id}/own`)).json()).data.transfer).toMatchObject({ available_minor: 7000, refund_reserved_minor: 0 });
      expect((await (await customer.request.get(`/api/v1/packages/${fixture.purchaseId}`)).json()).data.package.purchased_granted_credit_quanta).toBe(0);
      const history = (await (await customer.request.get(`/api/v1/refunds/${refund.refund_id}/attempts`)).json()).data; expect(history.items).toHaveLength(1);
      await page.reload(); expect((await page.content()).includes(identifier)).toBe(false); expect(JSON.stringify(final)).not.toMatch(confidential);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir('.local/ui-review', { recursive: true });
      await customer.storageState({ path: `.local/ui-review/t06-${info.project.name}-refund-customer.json` });
      await admin.storageState({ path: `.local/ui-review/t06-${info.project.name}-refund-admin.json` });
      await writeFile(`.local/ui-review/t06-${info.project.name}-refund.json`, JSON.stringify({ refundId: refund.refund_id, destinationId: proposed.destination_id, destinationVersionId: verified.destination_version_id, transferId: transfer.id }));
    } finally { await Promise.all([customer.close(), admin.close()]); await fixture.close(); }
  });
});
