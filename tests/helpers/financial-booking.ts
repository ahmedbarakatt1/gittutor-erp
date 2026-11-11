import { randomUUID } from 'node:crypto';
import type { paymentFixture } from './payments';
import assert from 'node:assert/strict';

/** Other role/browser suites share canonical learners. Only the documented graph retry is retried, with the caller's unchanged key. */
export async function retryFinancialConflict<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) { if (!String(error).endsWith(':RETRYABLE_CONFLICT') || attempt >= 2) throw error; }
  }
}

/** Actual local Auth/RPC path; only file metadata uses the guarded T06 fixture seam. */
export async function settleEnrollment(f: Awaited<ReturnType<typeof paymentFixture>>, enrollmentId: string, studentIndex: number, amount: number, receiving: { id: string; versionId: string }) {
  const student = f.students[studentIndex], accountId = (await student.auth.getUser()).data.user!.id;
  const chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [enrollmentId])).rows[0].id as string;
  const transfer = await f.transfer(receiving.id, amount, true, false);
  const ownership = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
  await f.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: accountId, p_evidence_file_id: ownership, p_reason: 'Actual synthetic learner is source payer', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, f.reviewer);
  const fileId = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: chargeId, uploaderId: accountId, learnerId: f.learners[studentIndex], chargeId });
  const receipt = await f.rpc('submit_receipt', { p_enrollment_id: enrollmentId, p_charge_id: chargeId, p_file_id: fileId, p_receiving_account_version_id: receiving.versionId, p_channel: 'instapay', p_transferred_amount_minor: amount, p_currency: 'EGP', p_reference: 'Actual synthetic enrollment funding', p_transferred_at: null, p_idempotency_key: randomUUID() }, student);
  const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: chargeId, amount_minor: amount }], p_expected_version: claim.version, p_idempotency_key: randomUUID() };
  const allocation = await retryFinancialConflict(() => f.rpc('allocate_transfer', args, f.reviewer));
  return { chargeId, transferId: transfer.id, allocation };
}

export async function prepareAmendmentReceipt(f: Awaited<ReturnType<typeof paymentFixture>>, enrollmentId: string, studentIndex: number, amount: number, receiving: { id: string; versionId: string }) {
  const student = f.students[studentIndex], accountId = (await student.auth.getUser()).data.user!.id;
  const chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [enrollmentId])).rows[0].id as string;
  const transfer = await f.transfer(receiving.id, amount, true, false);
  const ownership = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
  await f.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: accountId, p_evidence_file_id: ownership, p_reason: 'Exact source payer for future amendment', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, f.reviewer);
  const fileId = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: chargeId, uploaderId: accountId, learnerId: f.learners[studentIndex], chargeId });
  const receipt = await f.rpc('submit_receipt', { p_enrollment_id: enrollmentId, p_charge_id: chargeId, p_file_id: fileId, p_receiving_account_version_id: receiving.versionId, p_channel: 'instapay', p_transferred_amount_minor: amount, p_currency: 'EGP', p_reference: 'Exact future amendment cash intent', p_transferred_at: null, p_idempotency_key: randomUUID() }, student);
  const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  return { student, accountId, chargeId, transfer, receipt, claim };
}

export async function reserveFutureAmendment(f: Awaited<ReturnType<typeof paymentFixture>>, amendmentId: string, enrollmentId: string, studentIndex: number, amount: number, receiving: { id: string; versionId: string }) {
  const { student, chargeId, transfer, receipt, claim } = await prepareAmendmentReceipt(f, enrollmentId, studentIndex, amount, receiving);
  const plan = await f.rpc('authorize_payment_plan', { p_receipt_id: receipt.receipt_id, p_targets: [{ charge_id: chargeId, amount_minor: amount, conditional_amendment_id: amendmentId }], p_expected_version: 1, p_idempotency_key: randomUUID() }, student);
  const link = await f.rpc('link_transfer_payment_plan', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_payment_plan_id: plan.payment_plan_id, p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
  await f.rpc('accept_transfer_payment_plan', { p_transfer_id: transfer.id, p_payment_plan_id: plan.payment_plan_id, p_plan_hash: link.plan_hash, p_expected_version: link.version, p_idempotency_key: randomUUID() }, student);
  const version = (await f.database.query('select version from app_private.review_cases where id=$1', [receipt.case_id])).rows[0].version;
  const args = { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: plan.payment_plan_id, p_amendment_id: amendmentId, p_enrollment_id: enrollmentId, p_amount_minor: amount, p_expected_version: version, p_idempotency_key: randomUUID() };
  const reservation = await retryFinancialConflict(() => f.rpc('reserve_amendment_payment', args, f.reviewer));
  assert.equal(reservation.reserved_minor, amount); assert.equal(reservation.confirmation_status, 'AMENDMENT_PENDING');
  assert.deepEqual(await f.rpc('reserve_amendment_payment', args, f.reviewer), reservation);
  assert.equal((await f.database.query('select count(*)::integer n from finance_private.payment_allocations where transfer_id=$1', [transfer.id])).rows[0].n, 0);
  assert.equal((await f.database.query('select finance_private.finance_transfer_balance($1) result', [transfer.id])).rows[0].result.available_minor, 0);
  assert.equal(Number((await f.database.query("select sum(r.amount_minor) amount from finance_private.credit_reservations r join finance_private.customer_credit_lots l on l.id=r.credit_lot_id where l.transfer_id=$1 and r.state='reserved'", [transfer.id])).rows[0].amount), amount);
  return { reservationId: reservation.funding_reservation_id as string, transferId: transfer.id, caseId: receipt.case_id as string };
}
