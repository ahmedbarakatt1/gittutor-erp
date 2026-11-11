import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { raceBookingCalls } from '../helpers/booking';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';
import { getIncomingTransfer, getMyTransfer, listReceivingAccounts } from '../../src/modules/payments/queries';

describe('T06 actual verified sources and current review ownership', () => {
  let f: Awaited<ReturnType<typeof paymentFixture>>;
  beforeAll(async () => { f = await paymentFixture(); }, 30000);
  afterAll(async () => { await f?.close(); });

  test('GT-501 GT-1410 manual statement observation stays pending until independently verified, then cash and source ownership are distinct', async () => {
    const account = await f.receiving();
    expect((await listReceivingAccounts(f.reviewer)).items.some(item => item.receiving_account_id === account.id)).toBe(true);
    const pending = await f.transfer(account.id, 55000, false, false);
    expect((await getIncomingTransfer(f.reviewer, pending.id)).state).toBe('pending');
    expect((await f.database.query("select count(*)::int as count from finance_private.ledger_transactions where source_id=$1 and source_type='transfer_settled'", [pending.id])).rows[0].count).toBe(0);
    const args = { p_transfer_id: pending.id, p_statement_evidence_id: pending.fileId, p_external_id: pending.externalId, p_settled_at: pending.observedAt, p_amount_minor: 55000, p_currency: 'EGP', p_verification_note: 'Actual synthetic statement amount', p_expected_version: 1, p_idempotency_key: randomUUID() };
    expect((await f.reviewer.rpc('verify_transfer_settlement', { ...args, p_amount_minor: 55001 })).error?.message).toBe('VALIDATION_ERROR');
    const verified = await invokePaymentCommandWithStatus(f.reviewer, 'verify_transfer_settlement', args);
    expect(verified.data).toMatchObject({ transfer_id: pending.id, state: 'settled' });
    const before = (await f.database.query('select finance_private.finance_transfer_balance($1) as balance', [pending.id])).rows[0].balance;
    expect(before).toMatchObject({ gross_settled_minor: 55000, net_allocated_minor: 0, unapplied_signed_minor: 55000, payer_account_id: null });
    expect((await f.database.query('select count(*)::int as count from finance_private.customer_credit_lots where transfer_id=$1', [pending.id])).rows[0].count).toBe(0);
    expect((await invokePaymentCommandWithStatus(f.reviewer, 'verify_transfer_settlement', args)).data).toEqual(verified.data);
    const payerProof = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: pending.id });
    await f.rpc('bind_transfer_payer', { p_transfer_id: pending.id, p_payer_account_id: f.learnerAccountId, p_evidence_file_id: payerProof, p_reason: 'Actual synthetic payer source identity', p_expected_version: verified.data.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const own = await getMyTransfer(f.learner, pending.id);
    expect(own).toMatchObject({ view: 'payer_only', transfer: { available_minor: 55000, payer_is_current_account: true }, credit: { source_id: pending.id, available_minor: 55000 } });
    expect(JSON.stringify(own)).not.toMatch(/statement_evidence|ciphertext|learner_id|fee_minor|internal/);
    expect((await f.database.query("select count(*)::int as count from finance_private.ledger_transactions where source_id=$1 and source_type='transfer_settled'", [pending.id])).rows[0].count).toBe(1);
  });

  test('GT-1401 two real authenticated reviewers cannot claim the same current case', async () => {
    const account = await f.receiving(), receipt = await f.receipt(account.versionId);
    const results = await raceBookingCalls([f.reviewer, f.admin].map(client => ({ client, name: 'claim_review_case', args: { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() } })));
    expect(results.filter(result => !result.error)).toHaveLength(1);
    expect(results.find(result => result.error)?.error).toBe('VERSION_CONFLICT');
    const claim = (await f.database.query('select owner_id,state,claim_expires_at>now() as live from app_private.review_cases where id=$1', [receipt.case_id])).rows[0];
    expect(claim).toMatchObject({ state: 'claimed', live: true });
  });

  test('GT-502 GT-1404 staff-origin, quarantined and wrong-destination proof never become qualified customer evidence', async () => {
    const account = await f.receiving();
    const base = { p_enrollment_id: null, p_charge_id: f.chargeId, p_receiving_account_version_id: account.versionId, p_channel: 'instapay', p_transferred_amount_minor: 55000, p_currency: 'EGP', p_reference: 'Synthetic proof boundaries', p_transferred_at: null, p_idempotency_key: randomUUID() };
    const staff = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: f.chargeId, learnerId: f.learnerId, chargeId: f.chargeId });
    expect((await f.learner.rpc('submit_receipt', { ...base, p_file_id: staff })).error?.message).toBe('EVIDENCE_REQUIRED');
    const unsafe = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: f.chargeId, uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId: f.chargeId, scanState: 'quarantined' });
    expect((await f.learner.rpc('submit_receipt', { ...base, p_file_id: unsafe })).error?.message).toBe('FILE_REJECTED');
    const clean = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: f.chargeId, uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId: f.chargeId });
    expect((await f.learner.rpc('submit_receipt', { ...base, p_file_id: clean, p_channel: 'vodafone_cash' })).error?.message).toBe('VALIDATION_ERROR');
  });
});
