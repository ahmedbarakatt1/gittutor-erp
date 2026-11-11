import { expect, test } from 'vitest';
import { chargeSummarySchema, receiptSummarySchema, customerPaymentSchema, payerPaymentSchema, transferSummarySchema, staffTransferSummarySchema, listMyTransfers, getMyPayment, lookupTransferPayer, listPaymentEvidence, getMyTransfer, listRefundSources, listChargeAmendmentFundingOptions } from '../../src/modules/payments/queries';

const id = '50a7291f-829f-439a-9719-f8b3225ed77f';
const instant = '2026-11-11T10:00:00Z';
const transfer = { transfer_id: id, version: 1, channel: 'instapay', amount_minor: 57500, currency: 'EGP', state: 'settled', settled_at: instant, reversed_minor: 0, available_minor: 57500, refund_reserved_minor: 0, recovery_exposure_minor: 0, reconciliation_state: 'clear', payer_is_current_account: true };
const charge = { charge_id: id, version: 1, title: 'Calculus session', currency: 'EGP', charge_type: 'enrollment', learner: { learner_id: id, display_name: 'Synthetic learner' }, enrollment_id: id, package_purchase_id: null, original_minor: 57500, adjustments_minor: -7500, net_minor: 50000, allocated_cash_minor: 0, allocated_package_value_minor: 0, balance_minor: 50000, refund_reserved_minor: 0, refunded_minor: 0, credit_released_minor: 0, reconciliation_state: 'clear', recovery_exposure_minor: 0, commitment_state: 'ordinary', conditional_amendment_id: null, funding_quote_id: id };

test('charge-scoped amendment choices reject private fields and invalid debit amounts', async () => {
  const option = { amendment_id: id, enrollment_id: id, title: 'Accepted group change', additional_required_minor: 2500, expires_at: instant };
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return { data: { items: [option], next_cursor: null }, error: null }; } };
  expect((await listChargeAmendmentFundingOptions(client, id)).items).toEqual([option]);
  expect(calls).toEqual([['list_charge_amendment_funding_options', { p_charge_id: id, p_cursor: null, p_limit: 25 }]]);
  for (const invalid of [{ ...option, fee_minor: 62500 }, { ...option, additional_required_minor: 0 }, { ...option, additional_required_minor: Number.MAX_SAFE_INTEGER + 1 }]) {
    await expect(listChargeAmendmentFundingOptions({ rpc: async () => ({ data: { items: [invalid], next_cursor: null }, error: null }) }, id)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  }
});

test('receipt plan eligibility is explicit and never discloses uploader identity', () => {
  const receipt = { receipt_id: id, version: 1, can_authorize_plan: false, learner: charge.learner, charge_id: id, enrollment_id: null, reported_amount_minor: 57500, currency: 'EGP', channel: 'instapay', reference: 'Synthetic transfer', transferred_at: null, receiving_account: { receiving_account_id: id, receiving_account_version_id: id, instructions_version: 1, approved_recipient_display: 'Synthetic recipient' }, evidence: { file_id: id, evidence_version: 1, state: 'ready_for_review', submitted_at: instant, can_download: false }, review: { case_id: id, version: 1, state: 'unassigned', owner_display_name: null, next_action: 'Await independent review.' }, created_at: instant };
  expect(receiptSummarySchema.parse(receipt).can_authorize_plan).toBe(false);
  expect(receiptSummarySchema.safeParse({ ...receipt, can_authorize_plan: undefined }).success).toBe(false);
  expect(receiptSummarySchema.safeParse({ ...receipt, uploader_account_id: id }).success).toBe(false);
});

test('customer transfer rejects staff identity, financial internals and destination secrets', () => {
  expect(transferSummarySchema.safeParse(transfer).success).toBe(true);
  const staff = { ...transfer, receiving_account_id: id, receiving_account_version_id: id, external_id: 'SYNTHETIC-BANK-1', observed_at: instant, payer: { account_id: id, display_name: 'Synthetic payer', masked_contact: 'p***@example.test' } };
  expect(staffTransferSummarySchema.safeParse(staff).success).toBe(true);
  expect(transferSummarySchema.safeParse(staff).success).toBe(false);
  for (const forbidden of ['fee_minor', 'compensation_policy_version', 'statement_evidence_id', 'encrypted_identifier', 'identifier_fingerprint', 'internal_notes']) expect(transferSummarySchema.safeParse({ ...transfer, [forbidden]: 'secret' }).success).toBe(false);
});

test('payer-only history remains valid without learner data and rejects reintroduced child records', () => {
  const own = { view: 'payer_only', transfer, credit: { source_type: 'unapplied_credit', source_id: id, available_minor: 57500, refund_reserved_minor: 0, refundable_minor: 57500 }, refund_page: { items: [], next_cursor: null } };
  expect(payerPaymentSchema.safeParse(own).success).toBe(true);
  expect(payerPaymentSchema.safeParse({ ...own, charge }).success).toBe(false);
  expect(payerPaymentSchema.safeParse({ ...own, learner: charge.learner }).success).toBe(false);
  expect(customerPaymentSchema.safeParse(own).success).toBe(false);
});

test('charge arithmetic preserves exact safe integers and only explicit signed fields', () => {
  expect(chargeSummarySchema.safeParse(charge).success).toBe(true);
  expect(chargeSummarySchema.safeParse({ ...charge, original_minor: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  expect(chargeSummarySchema.safeParse({ ...charge, original_minor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(chargeSummarySchema.safeParse({ ...charge, allocated_cash_minor: -1 }).success).toBe(false);
  expect(chargeSummarySchema.safeParse({ ...charge, balance_minor: -1 }).success).toBe(true);
  expect(chargeSummarySchema.safeParse({ ...charge, allocated_cash_minor: null }).success).toBe(false);
});

test('own-payer list needs no learner role assertion and validates every returned row', async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return { data: { items: [transfer], next_cursor: null }, error: null, status: 200 }; } };
  await expect(listMyTransfers(client)).resolves.toMatchObject({ items: [transfer] });
  expect(calls).toEqual([['list_my_transfers', { p_cursor: null, p_limit: 25 }]]);
  expect(() => listMyTransfers(client, { actor_id: id } as never)).toThrow('VALIDATION_ERROR');
  const poisoned = { rpc: async () => ({ data: { items: [{ ...transfer, statement_evidence_id: id }], next_cursor: null }, error: null, status: 200 }) };
  await expect(listMyTransfers(poisoned)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});

test('detail continuation parameters remain bounded and do not widen payer scope', async () => {
  const calls: unknown[] = [];
  const own = { view: 'payer_only', transfer, credit: { source_type: 'unapplied_credit', source_id: id, available_minor: 57500, refund_reserved_minor: 0, refundable_minor: 57500 }, refund_page: { items: [], next_cursor: null } };
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return { data: own, error: null, status: 200 }; } };
  await getMyTransfer(client, id, { refund_cursor: '2026-11-11T10:00:00Z|' + id, limit: 20 });
  expect(calls[0]).toEqual(['get_my_transfer', { p_transfer_id: id, p_refund_cursor: '2026-11-11T10:00:00Z|' + id, p_limit: 20 }]);
  expect(() => getMyPayment(client, id, { allocation_cursor: 'x', limit: 101 })).toThrow('VALIDATION_ERROR');
  expect(() => getMyTransfer(client, id, { learner_id: id } as never)).toThrow('VALIDATION_ERROR');
});

test('payer lookup cannot become an empty or unscoped directory', () => {
  let called = false;
  const client = { rpc: async () => { called = true; return { data: { items: [] }, error: null, status: 200 }; } };
  expect(() => lookupTransferPayer(client, id, { contact_channel: 'email', exact_contact: '' })).toThrow('VALIDATION_ERROR');
  expect(() => lookupTransferPayer(client, id, { contact_channel: 'email', exact_contact: 'synthetic' })).toThrow('VALIDATION_ERROR');
  expect(() => lookupTransferPayer(client, 'not-an-id', { contact_channel: 'email', exact_contact: 'payer@example.test' })).toThrow('VALIDATION_ERROR');
  expect(called).toBe(false);
});

test('evidence selectors bind finite actions to a real resource and cannot request generic clean files', () => {
  let called = false;
  const client = { rpc: async () => { called = true; return { data: { items: [], next_cursor: null }, error: null, status: 200 }; } };
  expect(() => listPaymentEvidence(client, { action: 'bind_transfer_payer', target_id: null })).toThrow('VALIDATION_ERROR');
  expect(() => listPaymentEvidence(client, { action: 'all', target_id: null } as never)).toThrow('VALIDATION_ERROR');
  expect(() => listPaymentEvidence(client, { action: 'verify_refund_destination', target_id: id, scan_state: 'clean' } as never)).toThrow('VALIDATION_ERROR');
  expect(called).toBe(false);
});

test('customer refund-source wrapper rejects an accidentally privileged projection', async () => {
  const source = { view: 'admin', source_type: 'charge', source_id: id, version: 1, title: 'Synthetic source', currency: 'EGP', refundable_minor: 5000, requires_remedy: true, payer: { account_id: id, display_name: 'Another original payer', masked_contact: 'x***@example.test' } };
  const client = { rpc: async () => ({ data: { items: [source], next_cursor: null }, error: null, status: 200 }) };
  await expect(listRefundSources(client)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
