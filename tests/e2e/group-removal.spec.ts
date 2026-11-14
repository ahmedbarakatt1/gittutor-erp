import { expectSignedInAccount } from '../helpers/browser-auth';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { groupRemovalFixture } from '../helpers/group-removal';
import { loadLocalSupabase } from '../helpers/supabase';
import { formatCairoInstant } from '../../src/modules/booking/scheduling';

test.use({ trace: 'off', screenshot: 'off' });
const baseURL = 'http://127.0.0.1:3000';
const confidential = /fee_minor|fee_basis|fee_agreement_id|compensation_policy_version|internal_notes|payout_destination|provider_token|ledger_lines/;
async function login(page: Page, actor: string | { id: string; email: string; password: string }) {
  const user = typeof actor === 'string' ? loadLocalSupabase().actors[actor] : actor;
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login' && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expectSignedInAccount(page, user.id);
}
async function submit(page: Page, form: Locator, path: string, status = 200) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/${path}` && result.request().method() === 'POST');
  await form.getByRole('button', { name: await form.getAttribute('aria-label') || '', exact: true }).click();
  const result = await response, body = await result.json();
  expect(result.status(), body.code || '').toBe(status); return body.data;
}

test('a guaranteed dropout preserves the existing fee and survivor tuition through separate real consent', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const setup = await groupRemovalFixture(), f = setup.f;
  const contexts = await Promise.all(Array.from({ length: 6 }, () => browser.newContext({ baseURL, viewport: info.project.use.viewport })));
  const pageErrors: string[] = [];
  try {
    // A genuine fresh approved policy keeps this fixture's authored choice on its
    // actual current page; no mocked catalog response or arbitrary cursor cutoff.
    const content = (await f.database.query('select app_private.policy_content($1) content', [setup.replacementPolicyId])).rows[0].content;
    if (content.package_contract) content.package_contract.package_policy_version_id = null;
    const policy = await f.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'group', p_content: content, p_idempotency_key: randomUUID() });
    if (content.package_contract) content.package_contract.package_policy_version_id = policy.resource_id;
    await f.rpc('update_policy_draft', { p_policy_version_id: policy.resource_id, p_content: content, p_expected_version: 1, p_idempotency_key: randomUUID() });
    await f.rpc('approve_policy_version', { p_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Synthetic browser dropout replacement terms', p_expected_version: 2, p_idempotency_key: randomUUID() });
    const removedSeat = await f.rpc('get_enrollment', { p_enrollment_id: setup.seats[3] }, f.students[3]);
    const removedName = (removedSeat.learner as { display_name: string }).display_name;
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) { page.setDefaultTimeout(20_000); page.on('pageerror', error => pageErrors.push(error.message)); }
    const operator = pages[0]; await login(operator, 'admin_a'); await operator.goto(`/admin/schedule?occurrence=${setup.occurrenceId}`);
    await operator.getByText('Propose a group change', { exact: true }).click();
    const author = operator.getByRole('form', { name: 'Create group-change proposal', exact: true });
    await author.getByRole('group', { name: 'Remove existing learners', exact: true }).getByRole('checkbox', { name: removedName, exact: true }).check();
    await author.getByLabel('Proposed group size', { exact: true }).selectOption('3');
    const policySelect = author.getByLabel('Approved terms for the proposed group', { exact: true });
    await expect(policySelect.locator(`option[value="${policy.resource_id}"]`)).toHaveCount(1);
    await policySelect.selectOption(policy.resource_id as string);
    await expect(author.getByLabel('Exact fee agreement for this change', { exact: true }).locator(`option[value="${setup.sourceFeeId}"]`)).toContainText('Keep the current teaching agreement');
    await author.getByLabel('Exact fee agreement for this change', { exact: true }).selectOption(setup.sourceFeeId);
    await author.getByLabel('Cancellation remedy for removed learners', { exact: true }).selectOption('monetary_account_credit');
    const expiry = formatCairoInstant(new Date(Date.now() + 600000).toISOString());
    await author.getByLabel('Responses expire at', { exact: true }).fill(`${expiry.local_date}T${expiry.local_time}`);
    await author.getByLabel('Reason for this request', { exact: true }).fill('Preserve the guaranteed tuition and current tutor agreement after one withdrawal.');
    const proposed = await submit(operator, author, `occurrences/${setup.occurrenceId}/amendments`, 201);
    for (let index = 0; index < 4; index++) {
      const customer = pages[index + 1]; await login(customer, `learner_${String.fromCharCode(97 + index)}`);
      await customer.goto(`/learn/bookings/${setup.seats[index]}`);
      const proposal = customer.locator(`[data-proposal-id="${proposed.amendment_id}"]`);
      await proposal.locator('summary').first().click();
      const response = await contexts[index + 1].request.get(`/api/v1/amendments/${proposed.amendment_id}?view=customer&learner_id=${f.learners[index]}`);
      expect(response.status()).toBe(200); const dto = (await response.json()).data;
      expect(dto.terms).toMatchObject({ old_customer_price_minor: 50000, customer_price_minor: index === 3 ? 0 : 50000, customer_adjustment_minor: index === 3 ? -50000 : 0 });
      expect(JSON.stringify(dto)).not.toMatch(confidential);
      expect(await customer.locator('body').innerText()).not.toMatch(/EGP 725\.00|teaching agreement|compensation/i);
      if (index === 3) {
        expect(dto.terms).toMatchObject({ remedy: 'monetary_account_credit', remedy_amount_minor: 50000 });
        await mkdir('.local/screenshots', { recursive: true });
        await proposal.screenshot({ path: `.local/screenshots/t06-group-removal-${info.project.name}.png` });
      }
      const consent = proposal.getByRole('form', { name: 'Accept these proposed terms', exact: true });
      await consent.getByLabel('I accept the displayed change for this learner.').check();
      await submit(customer, consent, `amendments/${proposed.amendment_id}/accept`);
    }
    const tutor = pages[5]; await login(tutor, f.actor); await tutor.goto(`/tutor/schedule?occurrence=${setup.occurrenceId}`);
    const teaching = tutor.locator(`[data-proposal-id="${proposed.amendment_id}"]`); await teaching.locator('summary').first().click();
    await expect(teaching.getByText('EGP 725.00', { exact: true })).toBeVisible();
    const teachingConsent = teaching.getByRole('form', { name: 'Accept my teaching terms', exact: true });
    await teachingConsent.getByLabel('I accept this session time and the displayed teaching terms.').check();
    await submit(tutor, teachingConsent, `amendments/${proposed.amendment_id}/accept`);
    await operator.reload();
    const operatorProposal = operator.locator(`[data-proposal-id="${proposed.amendment_id}"]`); await operatorProposal.locator('summary').first().click();
    await submit(operator, operatorProposal.getByRole('form', { name: 'Apply accepted group change', exact: true }), `amendments/${proposed.amendment_id}/commit`);
    expect((await f.database.query('select state,target_tier,current_fee_agreement_id from app_private.occurrences where id=$1', [setup.occurrenceId])).rows[0]).toMatchObject({ state: 'confirmed', target_tier: 3, current_fee_agreement_id: setup.sourceFeeId });
    for (let index = 0; index < 4; index++) {
      const response = await contexts[index + 1].request.get(`/api/v1/enrollments/${setup.seats[index]}`);
      expect(response.status()).toBe(200); const dto = (await response.json()).data;
      expect(dto.state).toBe(index === 3 ? 'cancelled' : 'confirmed');
      expect(dto.funding.net_charge_minor).toBe(index === 3 ? 0 : 50000); expect(JSON.stringify(dto)).not.toMatch(confidential);
    }
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [setup.paid[3].transferId])).rows[0].data.available_minor).toBe(50000);
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); await f.close(); }
});
