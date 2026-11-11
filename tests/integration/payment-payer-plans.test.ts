import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { authClient } from '../helpers/supabase';
import { listPaymentPlans, getTransferPaymentPlan } from '../../src/modules/payments/queries';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';

test('different actual payer must accept exact immutable customer target plan before cash allocation', async () => {
  const f = await paymentFixture({ charge: 'enrollment' }), payer = await authClient('guardian_a');
  try {
    const payerId = (await payer.auth.getUser()).data.user!.id;
    const account = await f.receiving(), transfer = await f.transfer(account.id, 55000, true, false);
    const file = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
    await f.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: payerId, p_evidence_file_id: file, p_reason: 'Synthetic source belongs to a different verified payer', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const receipt = await f.receipt(account.versionId), claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const allocate = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null as string | null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
    expect((await f.reviewer.rpc('allocate_transfer', allocate)).error?.message).toBe('CONSENT_REQUIRED');
    const plan = (await invokePaymentCommandWithStatus(f.learner, 'authorize_payment_plan', { p_receipt_id: receipt.receipt_id, p_targets: allocate.p_allocations, p_expected_version: 1, p_idempotency_key: randomUUID() })).data;
    const link = (await invokePaymentCommandWithStatus(f.reviewer, 'link_transfer_payment_plan', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_payment_plan_id: plan.payment_plan_id, p_expected_version: claim.version, p_idempotency_key: randomUUID() })).data;
    expect((await listPaymentPlans(f.learner,receipt.receipt_id as string)).items.map(row=>row.payment_plan_id)).toContain(plan.payment_plan_id);
    expect((await getTransferPaymentPlan(payer,link.plan_link_id)).plan_hash).toBe(link.plan_hash);
    expect((await f.rpc('get_review_case_payer_intent',{p_case_id:receipt.case_id,p_transfer_id:transfer.id,p_payment_plan_id:plan.payment_plan_id},f.reviewer)).intent).toMatchObject({plan_link_id:link.plan_link_id,state:'awaiting_payer_acceptance'});
    expect((await getTransferPaymentPlan(f.reviewer,link.plan_link_id)).plan_hash).toBe(link.plan_hash);
    const accept = { p_transfer_id: transfer.id, p_payment_plan_id: plan.payment_plan_id, p_plan_hash: link.plan_hash, p_expected_version: link.version, p_idempotency_key: randomUUID() };
    expect((await f.admin.rpc('accept_transfer_payment_plan', accept)).error?.message).toBe('FORBIDDEN');
    expect((await f.learner.rpc('accept_transfer_payment_plan', accept)).error?.message).toBe('FORBIDDEN');
    const accepted = (await invokePaymentCommandWithStatus(payer, 'accept_transfer_payment_plan', accept)).data;
    expect(accepted.state).toBe('accepted');
    expect((await invokePaymentCommandWithStatus(payer, 'accept_transfer_payment_plan', accept)).data).toEqual(accepted);
    const current = (await f.database.query('select version from app_private.review_cases where id=$1', [receipt.case_id])).rows[0].version;
    const posted = await invokePaymentCommandWithStatus(f.reviewer, 'allocate_transfer', { ...allocate, p_payment_plan_id: plan.payment_plan_id, p_expected_version: current, p_idempotency_key: randomUUID() });
    expect(posted.data.unapplied_minor).toBe(5000);
    const ownership = (await f.database.query('select b.payer_account_id,a.payer_intent_acceptance_id from finance_private.payment_allocations a join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id where a.id=$1', [posted.data.allocation_ids[0]])).rows[0];
    expect(ownership).toEqual({ payer_account_id: payerId, payer_intent_acceptance_id: accepted.payer_intent_acceptance_id });
  } finally { await payer.auth.signOut({ scope: 'local' }); await f.close(); }
});
