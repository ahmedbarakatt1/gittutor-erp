import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import * as q from '../../src/modules/payments/queries';

let f: Awaited<ReturnType<typeof paymentFixture>>;
beforeAll(async () => { f = await paymentFixture(); }, 60_000);
afterAll(async () => { await f?.close(); });
const privateFields = /fee_minor|compensation|margin_minor|internal_notes|object_key|encrypted_identifier|identifier_fingerprint|ledger_lines/;

test('payment instructions and charge discovery are current learner scoped, exact and read-only', async () => {
  const account = await f.receiving();
  const before = (await f.database.query('select count(*)::int as count from finance_private.ledger_lines where charge_id=$1', [f.chargeId])).rows[0].count;
  const learners = await q.listPaymentLearners(f.learner); expect(learners.items.map(row => row.learner_id)).toContain(f.learnerId);
  expect(learners.items.map(row => row.learner_id)).not.toContain(f.learners[1]);
  const charges = await q.listMyCharges(f.learner, { learner_id: f.learnerId, state: 'unpaid', limit: 100 });
  expect(charges.items.some(row => row.charge_id === f.chargeId)).toBe(true);
  const instructions = await q.getPaymentInstructions(f.learner, f.chargeId);
  expect(instructions).toMatchObject({ required_for_confirmation_minor: 150000, additional_required_minor: 150000, confirmation: { state: 'not_applicable' } });
  expect(instructions.channels.some(row => row.receiving_account_version_id === account.versionId)).toBe(true);
  expect(JSON.stringify(instructions)).not.toMatch(privateFields);
  await expect(q.getPaymentInstructions(f.students[1], f.chargeId)).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
  expect((await f.database.query('select count(*)::int as count from finance_private.ledger_lines where charge_id=$1', [f.chargeId])).rows[0].count).toBe(before);
});

test('receipt histories and prepared evidence do not expose sibling records or private storage keys', async () => {
  const account = await f.receiving(), receipt = await f.receipt(account.versionId);
  const payment = await q.getMyPayment(f.learner, String(receipt.receipt_id));
  expect(payment.receipt.can_authorize_plan).toBe(true);
  expect(payment.receipt.charge_id).toBe(f.chargeId); expect(payment.receipt.evidence.can_download).toBe(false);
  expect(payment.credit).toBeNull(); expect(payment.matched_transfer).toBeNull();
  expect(JSON.stringify(payment)).not.toMatch(privateFields);
  const page = await q.listMyPayments(f.learner, { learner_id: f.learnerId, limit: 1 });
  expect(page.items).toHaveLength(1);
  if (page.next_cursor) expect((await q.listMyPayments(f.learner, { learner_id: f.learnerId, limit: 1, cursor: page.next_cursor })).items.map(row => row.receipt_id)).not.toContain(page.items[0].receipt_id);
  const files = await q.listReceiptFiles(f.learner, f.chargeId); expect(files.items.length).toBeGreaterThan(0); expect(files.items.every(file => !file.can_download)).toBe(true);
  const versions = await q.listReceiptVersions(f.learner, String(receipt.receipt_id)); expect(versions.items).toHaveLength(1);
  await expect(q.getMyPayment(f.students[1], String(receipt.receipt_id))).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
  await expect(q.listMyPayments(f.learner, { learner_id: f.learners[1] })).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
});

test('review detail and matching sources require a live case owner while queue reads remain scoped to staff', async () => {
  const account = await f.receiving(), transfer = await f.transfer(account.id), receipt = await f.receipt(account.versionId);
  const caseId = String(receipt.case_id);
  await expect(q.listReviewCases(f.learner)).rejects.toThrow('FORBIDDEN');
  await expect(q.getReviewCase(f.reviewer, caseId)).rejects.toThrow('OWNER_REQUIRED');
  await f.rpc('claim_review_case', { p_case_id: caseId, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  const detail = await q.getReviewCase(f.reviewer, caseId);
  expect(detail.receipt.can_authorize_plan).toBe(false);
  expect(detail.case.case_id).toBe(caseId); expect(detail.evidence_files.items.length).toBe(1);
  expect(detail.candidate_transfers.items.map(row => row.transfer_id)).toContain(transfer.id);
  expect((await q.getReviewCaseCharge(f.reviewer, caseId, f.chargeId)).charge_id).toBe(f.chargeId);
  await expect(q.getReviewCaseCharge(f.reviewer, caseId, randomUUID())).rejects.toThrow(/NOT_FOUND|FORBIDDEN/);
  await f.database.query("update app_private.review_cases set claim_expires_at=now()-interval '1 second' where id=$1", [caseId]);
  await expect(q.getReviewCase(f.reviewer, caseId)).rejects.toThrow('OWNER_REQUIRED');
  await expect(q.listTransferCandidates(f.reviewer, caseId)).rejects.toThrow('OWNER_REQUIRED');
  expect((await q.getReviewCase(f.admin, caseId)).case.case_id).toBe(caseId);
});

test('verified payer lookup is exact and staff-only; own transfer view contains no learner or statement identity', async () => {
  const account = await f.receiving(), transfer = await f.transfer(account.id);
  const email = (await f.learner.auth.getUser()).data.user!.email!;
  const found = await q.lookupTransferPayer(f.reviewer, transfer.id, { contact_channel: 'email', exact_contact: email });
  expect(found.items.map(row => row.account_id)).toContain(f.learnerAccountId); expect(JSON.stringify(found)).not.toContain(email);
  await expect(q.lookupTransferPayer(f.learner, transfer.id, { contact_channel: 'email', exact_contact: email })).rejects.toThrow('FORBIDDEN');
  const owned = await q.getMyTransfer(f.learner, transfer.id);
  expect(owned.view).toBe('payer_only'); expect(owned.credit.available_minor).toBe(55000);
  expect(JSON.stringify(owned)).not.toMatch(/learner_id|display_name|external_id|observed_at|receiving_account_id/);
  expect(JSON.stringify(owned)).not.toMatch(privateFields);
  expect((await q.listMyTransfers(f.learner, { limit: 100 })).items.some(row => row.transfer_id === transfer.id)).toBe(true);
  await expect(q.getMyTransfer(f.students[1], transfer.id)).rejects.toThrow('NOT_FOUND');
  expect((await q.listIncomingTransfers(f.reviewer, { state: 'settled', payer_state: 'bound', limit: 100 })).items.some(row => row.transfer_id === transfer.id)).toBe(true);
  await expect(q.listTransferAllocations(f.reviewer, transfer.id)).rejects.toThrow('FORBIDDEN');
});
