import type { PaymentCommandName, PaymentRpcClient } from '../modules/payments/commands';
import * as q from '../modules/payments/queries';

type MutationRoute = { family: 'payments'; pattern: RegExp; rpc: PaymentCommandName; fields: string[]; pathArgument?: string };
const mutation = (pattern: RegExp, rpc: PaymentCommandName, fields: string[], pathArgument?: string): MutationRoute => ({ family: 'payments', pattern, rpc, fields, pathArgument });
export const paymentCommandRoutes: MutationRoute[] = [
  mutation(/^enrollments\/([^/]+)\/charge$/, 'prepare_enrollment_charge', ['expected_version'], 'enrollment_id'),
  mutation(/^receipts$/, 'submit_receipt', ['enrollment_id', 'charge_id', 'file_id', 'receiving_account_version_id', 'channel', 'transferred_amount_minor', 'currency', 'reference', 'transferred_at']),
  mutation(/^receipts\/([^/]+)\/replace$/, 'replace_receipt', ['file_id', 'reason', 'expected_version'], 'receipt_id'),
  mutation(/^receipts\/([^/]+)\/payment-plans$/, 'authorize_payment_plan', ['targets', 'expected_version'], 'receipt_id'),
  mutation(/^review-cases\/([^/]+)\/claim$/, 'claim_review_case', ['expected_version'], 'case_id'),
  mutation(/^review-cases\/([^/]+)\/renew-claim$/, 'renew_review_claim', ['expected_version'], 'case_id'),
  mutation(/^review-cases\/([^/]+)\/release$/, 'release_review_case', ['reason', 'expected_version'], 'case_id'),
  mutation(/^review-cases\/([^/]+)\/assign$/, 'assign_review_case', ['owner_id', 'reason', 'expected_version'], 'case_id'),
  mutation(/^review-cases\/([^/]+)\/decision$/, 'decide_review_case', ['decision', 'reason', 'expected_version'], 'case_id'),
  mutation(/^statement-imports$/, 'create_statement_import', ['file_id', 'receiving_account_id', 'channel', 'statement_period']),
  mutation(/^receiving-accounts$/, 'create_receiving_account', ['channel', 'collection_identifier', 'display_instructions', 'ownership_evidence_file_id']),
  mutation(/^receiving-accounts\/([^/]+)\/approve$/, 'approve_receiving_account', ['enabled', 'verification_note', 'expected_version'], 'receiving_account_id'),
  mutation(/^transfers$/, 'record_manual_transfer', ['receiving_account_id', 'channel', 'external_id', 'amount_minor', 'currency', 'observed_at', 'statement_evidence_file_id']),
  mutation(/^transfers\/([^/]+)\/verify$/, 'verify_transfer_settlement', ['statement_evidence_id', 'external_id', 'settled_at', 'amount_minor', 'currency', 'verification_note', 'expected_version'], 'transfer_id'),
  mutation(/^transfers\/([^/]+)\/bind-payer$/, 'bind_transfer_payer', ['payer_account_id', 'evidence_file_id', 'reason', 'expected_version'], 'transfer_id'),
  mutation(/^review-cases\/([^/]+)\/link-payment-plan$/, 'link_transfer_payment_plan', ['transfer_id', 'payment_plan_id', 'expected_version'], 'case_id'),
  mutation(/^transfers\/([^/]+)\/accept-payment-plan$/, 'accept_transfer_payment_plan', ['payment_plan_id', 'plan_hash', 'expected_version'], 'transfer_id'),
  mutation(/^credit-conversion-intents$/, 'authorize_credit_conversion', ['source_credit_id', 'package_purchase_id', 'credit_quanta', 'carrying_value_minor', 'grant_policy_version_id', 'expires_at', 'expected_version']),
  mutation(/^review-cases\/([^/]+)\/allocate$/, 'allocate_transfer', ['transfer_id', 'evidence_version', 'payment_plan_id', 'allocations', 'expected_version'], 'case_id'),
  mutation(/^review-cases\/([^/]+)\/reserve-amendment-payment$/, 'reserve_amendment_payment', ['transfer_id', 'evidence_version', 'payment_plan_id', 'amendment_id', 'enrollment_id', 'amount_minor', 'expected_version'], 'case_id'),
  mutation(/^allocations\/([^/]+)\/correct$/, 'correct_allocation', ['replacement_charge_id', 'amount_minor', 'reason', 'payment_plan_id', 'expected_version'], 'allocation_id'),
  mutation(/^transfers\/([^/]+)\/reversals$/, 'record_transfer_reversal', ['external_reversal_id', 'amount_minor', 'effective_at', 'evidence_file_id', 'expected_version'], 'transfer_id'),
  mutation(/^transfer-reversals\/([^/]+)\/resolve$/, 'resolve_transfer_reversal', ['allocations', 'unapplied_minor', 'reason', 'expected_version'], 'reversal_id'),
  mutation(/^refunds$/, 'request_refund', ['source_type', 'source_id', 'payer_account_id', 'amount_minor', 'reason']),
  mutation(/^refunds\/([^/]+)\/destination$/, 'propose_refund_destination', ['channel', 'identifier', 'payee_name', 'source_evidence_file_id', 'expected_version'], 'refund_id'),
  mutation(/^refund-destinations\/([^/]+)\/verify$/, 'verify_refund_destination', ['evidence_file_id', 'decision', 'reason', 'expected_version'], 'destination_id'),
  mutation(/^refunds\/([^/]+)\/approve$/, 'approve_refund', ['remedy_id', 'destination_version_id', 'amount_minor', 'reason', 'expected_version'], 'refund_id'),
  mutation(/^refunds\/([^/]+)\/attempts$/, 'record_refund_attempt', ['external_reference', 'expected_version'], 'refund_id'),
  mutation(/^refunds\/([^/]+)\/reconcile$/, 'reconcile_refund', ['attempt_id', 'outcome', 'evidence_file_id', 'external_reference', 'settled_at', 'expected_version'], 'refund_id'),
  mutation(/^refunds\/([^/]+)\/reversals$/, 'record_refund_reversal', ['attempt_id', 'external_reversal_id', 'amount_minor', 'evidence_file_id', 'effective_at', 'expected_version'], 'refund_id'),
  mutation(/^packages\/([^/]+)\/resolve-financing-hold$/, 'resolve_package_financing_hold', ['reason', 'evidence_file_id', 'expected_version'], 'package_purchase_id'),
];

type Filters = Record<string, unknown>;
type ReadRoute = { pattern: RegExp; fields: string[]; run(client: PaymentRpcClient, match: RegExpExecArray, filters: Filters): Promise<unknown> };
const paged = ['cursor', 'limit'];
const read = (pattern: RegExp, fields: string[], run: ReadRoute['run']): ReadRoute => ({ pattern, fields, run });
const paymentReadRoutes: ReadRoute[] = [
  read(/^me\/payment-learners$/, paged, (c, _, p) => q.listPaymentLearners(c, p)),
  read(/^me\/charges$/, [...paged, 'learner_id', 'state'], (c, _, p) => q.listMyCharges(c, { ...p, learner_id: String(p.learner_id ?? '') })),
  read(/^charges\/([^/]+)$/, [], (c, m) => q.getMyCharge(c, m[1])),
  read(/^charges\/([^/]+)\/payment-instructions$/, [], (c, m) => q.getPaymentInstructions(c, m[1])),
  read(/^charges\/([^/]+)\/receipt-files$/, paged, (c, m, p) => q.listReceiptFiles(c, m[1], p)),
  read(/^charges\/([^/]+)\/amendment-funding-options$/, paged, (c, m, p) => q.listChargeAmendmentFundingOptions(c, m[1], p)),
  read(/^me\/payments$/, [...paged, 'learner_id', 'from', 'to'], (c, _, p) => q.listMyPayments(c, p)),
  read(/^payments\/([^/]+)$/, ['allocation_cursor', 'refund_cursor', 'limit'], (c, m, p) => q.getMyPayment(c, m[1], p)),
  read(/^me\/transfers$/, paged, (c, _, p) => q.listMyTransfers(c, p)),
  read(/^transfers\/([^/]+)\/own$/, ['refund_cursor', 'limit'], (c, m, p) => q.getMyTransfer(c, m[1], p)),
  read(/^review-cases$/, [...paged, 'state', 'owner_id', 'updated_after'], (c, _, p) => q.listReviewCases(c, p)),
  read(/^review-cases\/([^/]+)$/, ['evidence_cursor', 'event_cursor', 'limit'], (c, m, p) => q.getReviewCase(c, m[1], p)),
  read(/^review-cases\/([^/]+)\/charges\/([^/]+)$/, [], (c, m) => q.getReviewCaseCharge(c, m[1], m[2])),
  read(/^review-cases\/([^/]+)\/payer-intent$/, ['transfer_id', 'payment_plan_id'], (c, m, p) => q.getReviewCasePayerIntent(c, m[1], String(p.transfer_id ?? ''), String(p.payment_plan_id ?? ''))),
  read(/^review-cases\/([^/]+)\/transfer-candidates$/, paged, (c, m, p) => q.listTransferCandidates(c, m[1], p)),
  read(/^receiving-accounts$/, paged, (c, _, p) => q.listReceivingAccounts(c, p)),
  read(/^statement-evidence$/, [...paged, 'receiving_account_id'], (c, _, p) => q.listStatementEvidence(c, p)),
  read(/^statement-imports$/, paged, (c, _, p) => q.listStatementImports(c, p)),
  read(/^statement-imports\/([^/]+)$/, ['candidate_cursor', 'limit'], (c, m, p) => q.getStatementImport(c, m[1], p)),
  read(/^incoming-transfers$/, [...paged, 'state', 'payer_state'], (c, _, p) => q.listIncomingTransfers(c, p)),
  read(/^incoming-transfers\/([^/]+)$/, [], (c, m) => q.getIncomingTransfer(c, m[1])),
  read(/^incoming-transfers\/([^/]+)\/allocations$/, paged, (c, m, p) => q.listTransferAllocations(c, m[1], p)),
  read(/^me\/payment-plan-requests$/, paged, (c, _, p) => q.listMyPaymentPlanRequests(c, p)),
  read(/^transfer-payment-plans\/([^/]+)$/, [], (c, m) => q.getTransferPaymentPlan(c, m[1])),
  read(/^receipts\/([^/]+)\/payment-plans$/, paged, (c, m, p) => q.listPaymentPlans(c, m[1], p)),
  read(/^receipts\/([^/]+)\/versions$/, paged, (c, m, p) => q.listReceiptVersions(c, m[1], p)),
  read(/^credit-conversion-intents$/, [...paged, 'package_purchase_id', 'state'], (c, _, p) => q.listCreditConversionIntents(c, p)),
  read(/^credit-conversion-intents\/([^/]+)$/, [], (c, m) => q.getCreditConversionIntent(c, m[1])),
  read(/^packages\/([^/]+)\/credit-conversion-sources$/, paged, (c, m, p) => q.listCreditConversionSources(c, m[1], p)),
  read(/^packages\/([^/]+)\/credit-conversion-policies$/, [...paged, 'source_credit_id'], (c, m, p) => { const { source_credit_id, ...page } = p; return q.listCreditConversionPolicies(c, m[1], String(source_credit_id ?? ''), page); }),
  read(/^refund-sources$/, [...paged, 'learner_id', 'view'], (c, _, p) => q.listRefundSources(c, p)),
  read(/^me\/refunds$/, paged, (c, _, p) => q.listMyRefunds(c, p)),
  read(/^refunds\/([^/]+)$/, [], (c, m) => q.getRefund(c, m[1])),
  read(/^admin\/refunds$/, [...paged, 'state'], (c, _, p) => q.listAdminRefunds(c, p)),
  read(/^refunds\/([^/]+)\/destinations$/, paged, (c, m, p) => q.listRefundDestinations(c, m[1], p)),
  read(/^refunds\/([^/]+)\/remedies$/, paged, (c, m, p) => q.listRefundRemedies(c, m[1], p)),
  read(/^refunds\/([^/]+)\/attempts$/, paged, (c, m, p) => q.listRefundAttempts(c, m[1], p)),
  read(/^refunds\/([^/]+)\/reversals$/, paged, (c, m, p) => q.listRefundReversals(c, m[1], p)),
  read(/^financial-exceptions$/, [...paged, 'state'], (c, _, p) => q.listFinancialExceptions(c, p)),
  read(/^transfer-reversals\/([^/]+)$/, ['allocation_cursor', 'limit'], (c, m, p) => q.getTransferReversal(c, m[1], p)),
  read(/^payment-evidence$/, [...paged, 'action', 'target_id'], (c, _, p) => q.listPaymentEvidence(c, { ...p, action: p.action as Parameters<typeof q.listPaymentEvidence>[1]['action'], target_id: p.target_id ? String(p.target_id) : null })),
];

export function findPaymentReadRoute(path: string) {
  for (const route of paymentReadRoutes) {
    const match = route.pattern.exec(path);
    if (match) return { fields: route.fields, run: (client: PaymentRpcClient, filters: Filters) => route.run(client, match, filters) };
  }
  return null;
}
