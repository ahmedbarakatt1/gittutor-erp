import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { listReviewCases } from '../../src/modules/payments/queries';
import { packageFixture } from '../helpers/packages';
import { paymentFixture } from '../helpers/payments';

test('GT-CS-034 expired claim is unassigned and can be reclaimed at the visible version', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving();
    const renewCase = await f.receipt(account.versionId);
    const renewalClaim = await f.rpc('claim_review_case', { p_case_id: renewCase.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const expiring = (await f.database.query("update app_private.review_cases set claim_expires_at=now()+interval '10 seconds' where id=$1 returning claim_expires_at", [renewCase.case_id])).rows[0];
    const renewed = await f.rpc('renew_review_claim', { p_case_id: renewCase.case_id, p_expected_version: renewalClaim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    expect(Date.parse(String(renewed.claim_expires_at))).toBeGreaterThan(expiring.claim_expires_at.getTime());
    const { case_id } = await f.receipt(account.versionId);
    const claim = await f.rpc('claim_review_case', { p_case_id: case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    await f.database.query("update app_private.review_cases set claim_expires_at=now()-interval '1 second' where id=$1", [case_id]);
    const owner = (await f.reviewer.auth.getUser()).data.user!.id;
    expect((await listReviewCases(f.reviewer, { state: 'claimed', owner_id: owner })).items.map(row => row.case_id)).not.toContain(case_id);
    const row = (await listReviewCases(f.reviewer, { state: 'unassigned' })).items.find(item => item.case_id === case_id);
    expect(row).toMatchObject({ state: 'unassigned', owner_id: null, owner_display_name: null, claim_expires_at: null, version: claim.version });
    const reclaimed = await f.rpc('claim_review_case', { p_case_id: case_id, p_expected_version: row!.version, p_idempotency_key: randomUUID() }, f.reviewer);
    expect(reclaimed.version).toBe(Number(claim.version) + 1);
  } finally { await f.close(); }
});

test.each([true, false])('GT-CON-008 expired hold refuses settled cash and retains the payer credit (expiry processed %s)', async processed => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const account = await f.receiving();
    const receipt = await f.receipt(account.versionId, 50000);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const seat = (await f.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 minute' where id=$1 returning occurrence_id", [f.enrollmentId])).rows[0];
    if (processed) await f.database.query('select app_private.booking_expire_holds($1)', [seat.occurrence_id]);
    const transfer = await f.transfer(account.id, 50000);
    const allocation = await f.reviewer.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() });
    expect(allocation.error?.message).toBe('WINDOW_CLOSED');
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) b', [transfer.id])).rows[0].b).toMatchObject({ available_minor: 50000, net_allocated_minor: 0, payer_account_id: f.learnerAccountId });
    expect((await f.database.query('select state from app_private.enrollments where id=$1', [f.enrollmentId])).rows[0].state).toBe(processed ? 'expired' : 'held');
  } finally { await f.close(); }
});

test('GT-STU-084 an accepted, unfunded temporary seat releases once with no residual tuition due', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const { version } = (await f.database.query('select version from app_private.enrollments where id=$1', [f.enrollmentId])).rows[0];
    const args = { p_enrollment_id: f.enrollmentId, p_reason: 'Release the temporary seat', p_remedy_proposal_id: null, p_expected_version: version, p_idempotency_key: randomUUID() };
    const result = await f.rpc('cancel_enrollment', args, f.learner);
    expect(result.state).toBe('cancelled');
    expect(await f.rpc('cancel_enrollment', args, f.learner)).toEqual(result);
    expect((await f.database.query('select finance_private.finance_charge_balance($1) b', [f.chargeId])).rows[0].b).toMatchObject({ commercial_net_minor: 0, receivable_minor: 0 });
    expect((await f.database.query('select amount_minor from finance_private.charges where id=$1', [f.chargeId])).rows[0].amount_minor).toBe('50000');
  } finally { await f.close(); }
});

test('GT-STU-084 releasing a package-backed temporary seat restores the same reserved quantity and value', async () => {
  const f = await packageFixture();
  try {
    const purchase = await f.purchase();
    const policy = await f.grantPolicy(50000);
    await f.grant(String(purchase.resource_id), policy, 50000, 1000);
    const seat = await f.hold();
    await f.rpc('reserve_package_credit', { p_package_id: purchase.resource_id, p_enrollment_id: seat.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const { version } = (await f.database.query('select version from app_private.enrollments where id=$1', [seat.enrollmentId])).rows[0];
    const args = { p_enrollment_id: seat.enrollmentId, p_reason: 'Release a temporary reservation', p_remedy_proposal_id: null, p_expected_version: version, p_idempotency_key: randomUUID() };
    expect((await f.rpc('cancel_enrollment', args, f.learner)).state).toBe('cancelled');
    await f.rpc('cancel_enrollment', args, f.learner);
    expect((await f.database.query('select app_private.package_balance($1) b', [purchase.resource_id])).rows[0].b).toMatchObject({ available_credit_quanta: 1000, available_value_minor: 50000, reserved_credit_quanta: 0, reserved_value_minor: 0 });
    expect((await f.database.query('select finance_private.finance_charge_balance(id) b from finance_private.charges where enrollment_id=$1', [seat.enrollmentId])).rows[0].b).toMatchObject({ commercial_net_minor: 0, receivable_minor: 0 });
  } finally { await f.close(); }
});

test('a held seat with settled customer funds still requires the reviewed cancellation remedy', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const account = await f.receiving();
    const receipt = await f.receipt(account.versionId, 1000);
    const transfer = await f.transfer(account.id, 1000);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 1000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const { version, state } = (await f.database.query('select version,state from app_private.enrollments where id=$1', [f.enrollmentId])).rows[0];
    expect(state).toBe('held');
    const attempt = await f.learner.rpc('cancel_enrollment', { p_enrollment_id: f.enrollmentId, p_reason: 'Request direct release', p_remedy_proposal_id: null, p_expected_version: version, p_idempotency_key: randomUUID() });
    expect(attempt.error?.message).toBe('CONSENT_REQUIRED');
    expect((await f.database.query('select finance_private.finance_charge_balance($1) b', [f.chargeId])).rows[0].b).toMatchObject({ commercial_net_minor: 50000, allocated_cash_minor: 1000 });
  } finally { await f.close(); }
});
