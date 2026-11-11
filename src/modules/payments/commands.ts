import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';

export type PaymentRpcClient = IdentityRpcClient;
const codes = new Set(['AUTH_REQUIRED', 'SESSION_REVOKED', 'VERIFIED_ACCOUNT_REQUIRED', 'FORBIDDEN', 'OWNER_REQUIRED', 'CONSENT_REQUIRED', 'NOT_FOUND', 'VALIDATION_ERROR', 'AMOUNT_OUT_OF_RANGE', 'INVALID_TIME', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT', 'DESTINATION_UNVERIFIED', 'EVIDENCE_REQUIRED', 'INSUFFICIENT_FUNDS', 'INSUFFICIENT_ENTITLEMENT', 'POLICY_INCOMPLETE', 'TRANSFER_UNSETTLED', 'DUPLICATE_TRANSFER', 'REMEDY_RESERVED', 'FILE_REJECTED', 'WINDOW_CLOSED', 'RETRYABLE_CONFLICT', 'DEPENDENCY_UNAVAILABLE']);
export class PaymentRpcError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'PaymentRpcError'; }
}
export async function paymentRpc(client: PaymentRpcClient, name: string, args?: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw new PaymentRpcError(codes.has(result.error.message) ? result.error.message : 'DEPENDENCY_UNAVAILABLE');
  return result;
}

const id = z.uuid(), version = z.number().int().positive().max(2147483647);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), positive = minor.positive();
const key = z.string().trim().min(1).max(200), reason = z.string().trim().min(1).max(2000);
const reference = z.string().trim().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !value.startsWith('0000-'));
const channel = z.enum(['instapay', 'vodafone_cash']), currency = z.literal('EGP');
const create = { p_idempotency_key: key }, write = { p_expected_version: version, ...create };
const common = { command_id: id, resource_id: id, version };
const finish = <S extends z.ZodRawShape>(fields: S) => z.object({ ...common, ...fields }).strict();
const caseState = z.enum(['waiting_for_evidence', 'unassigned', 'claimed', 'needs_information', 'escalated', 'resolved']);
const refundState = z.enum(['requested', 'approved', 'pending', 'settled', 'failed', 'unknown', 'cancelled', 'partially_reversed', 'reversed']);
const reconciliation = z.enum(['clear', 'requires_review']);
const target = z.object({ charge_id: id, amount_minor: positive }).strict();
const exactTargets = <T extends z.ZodType<{ charge_id: string; amount_minor: number }>>(item: T) => z.array(item).min(1).max(100)
  .refine(rows => new Set(rows.map(row => row.charge_id)).size === rows.length)
  .refine(rows => rows.reduce((total, row) => total + BigInt(row.amount_minor), 0n) <= BigInt(Number.MAX_SAFE_INTEGER));

/** Data shape only; encryption and key access live exclusively in the authenticated server transport. */
export const encryptedIdentifierSchema = z.object({
  v: z.literal(1), alg: z.literal('A256GCM'), kid: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/).max(1024),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
}).strict();

const confirmationResult = z.object({
  state: z.enum(['confirmed', 'already_confirmed', 'awaiting_requirements', 'not_applicable']), occurrence_id: id.nullable(),
  reason: z.enum(['ELIGIBLE', 'INSUFFICIENT_FUNDS', 'TARGET_NOT_MET', 'HOLD_EXPIRED', 'OCCURRENCE_CANCELLED', 'QUOTE_NOT_ACCEPTED', 'QUOTE_EXPIRED', 'FEE_NOT_APPROVED', 'SCHEDULE_CONFLICT', 'POLICY_INCOMPLETE', 'RECONCILIATION_REQUIRED', 'AMENDMENT_PENDING', 'FINANCING_HOLD']).nullable(),
}).strict();

export const paymentCommands = {
  prepare_enrollment_charge: {
    input: z.object({ p_enrollment_id: id, ...write }).strict(),
    output: finish({ charge_id: id, commitment_state: z.enum(['ordinary', 'awaiting_amendment', 'committed', 'resolution_required']) }),
  },
  submit_receipt: {
    input: z.object({ p_enrollment_id: id.nullable(), p_charge_id: id, p_file_id: id, p_receiving_account_version_id: id, p_channel: channel, p_transferred_amount_minor: positive, p_currency: currency, p_reference: reference, p_transferred_at: instant.nullable(), ...create }).strict(),
    output: finish({ receipt_id: id, case_id: id, evidence_state: z.enum(['uploaded', 'quarantined', 'ready_for_review', 'superseded', 'rejected']) }),
  },
  replace_receipt: {
    input: z.object({ p_receipt_id: id, p_file_id: id, p_reason: reason, ...write }).strict(),
    output: finish({ new_evidence_version: version, case_id: id }),
  },
  authorize_payment_plan: {
    input: z.object({ p_receipt_id: id, p_targets: exactTargets(target.extend({ conditional_amendment_id: id.nullable().optional(), conditional_transfer_proposal_id: id.nullable().optional() }).strict().refine(value => !(value.conditional_amendment_id && value.conditional_transfer_proposal_id))), ...write }).strict(),
    output: finish({ payment_plan_id: id, plan_version: version, plan_hash: hash }),
  },
  claim_review_case: {
    input: z.object({ p_case_id: id, ...write }).strict(),
    output: finish({ owner_id: id, state: caseState, claim_expires_at: instant }),
  },
  renew_review_claim: {
    input: z.object({ p_case_id: id, ...write }).strict(), output: finish({ state: caseState, claim_expires_at: instant }),
  },
  release_review_case: {
    input: z.object({ p_case_id: id, p_reason: reason, ...write }).strict(), output: finish({ state: caseState }),
  },
  assign_review_case: {
    input: z.object({ p_case_id: id, p_owner_id: id, p_reason: reason, ...write }).strict(), output: finish({ owner_id: id, state: caseState, claim_expires_at: instant }),
  },
  decide_review_case: {
    input: z.object({ p_case_id: id, p_decision: z.enum(['needs_information', 'escalated', 'resolved_rejected']), p_reason: reason, ...write }).strict(), output: finish({ state: caseState }),
  },
  create_statement_import: {
    input: z.object({ p_file_id: id, p_receiving_account_id: id, p_channel: channel, p_statement_period: z.object({ from: z.iso.date(), to: z.iso.date() }).strict().refine(period => period.from <= period.to), ...create }).strict(),
    output: finish({ import_id: id, validation_job_id: id }),
  },
  create_receiving_account: {
    input: z.object({ p_channel: channel, p_collection_identifier: z.string().trim().min(1).max(200), p_display_instructions: z.string().trim().min(1).max(2000), p_ownership_evidence_file_id: id, ...create }).strict(), output: finish({ receiving_account_id: id }),
  },
  approve_receiving_account: {
    input: z.object({ p_receiving_account_id: id, p_enabled: z.boolean(), p_verification_note: reason, ...write }).strict(), output: finish({ verified_at: instant, instructions_version: version }),
  },
  record_manual_transfer: {
    input: z.object({ p_receiving_account_id: id, p_channel: channel, p_external_id: reference, p_amount_minor: positive, p_currency: currency, p_observed_at: instant, p_statement_evidence_file_id: id, ...create }).strict(), output: finish({ transfer_id: id, state: z.literal('pending') }),
  },
  verify_transfer_settlement: {
    input: z.object({ p_transfer_id: id, p_statement_evidence_id: id, p_external_id: reference, p_settled_at: instant, p_amount_minor: positive, p_currency: currency, p_verification_note: reason, ...write }).strict(), output: finish({ transfer_id: id, state: z.literal('settled') }),
  },
  bind_transfer_payer: {
    input: z.object({ p_transfer_id: id, p_payer_account_id: id, p_evidence_file_id: id, p_reason: reason, ...write }).strict(), output: finish({ payer_binding_id: id, transfer_id: id }),
  },
  link_transfer_payment_plan: {
    input: z.object({ p_case_id: id, p_transfer_id: id, p_payment_plan_id: id, ...write }).strict(), output: finish({ plan_link_id: id, state: z.literal('awaiting_payer_acceptance'), plan_hash: hash, expires_at: instant }),
  },
  accept_transfer_payment_plan: {
    input: z.object({ p_transfer_id: id, p_payment_plan_id: id, p_plan_hash: hash, ...write }).strict(), output: finish({ payer_intent_acceptance_id: id, plan_link_id: id, state: z.literal('accepted') }),
  },
  authorize_credit_conversion: {
    input: z.object({ p_source_credit_id: id, p_package_purchase_id: id, p_credit_quanta: positive, p_carrying_value_minor: positive, p_grant_policy_version_id: id, p_expires_at: instant, ...write }).strict(), output: finish({ credit_conversion_intent_id: id, intent_hash: hash, state: z.literal('authorized'), expires_at: instant }),
  },
  allocate_transfer: {
    input: z.object({ p_case_id: id, p_transfer_id: id, p_evidence_version: version, p_payment_plan_id: id.nullable().default(null), p_allocations: exactTargets(target), ...write }).strict(), output: finish({ allocation_ids: z.array(id), unapplied_minor: minor, confirmation_status: z.array(confirmationResult) }),
  },
  reserve_amendment_payment: {
    input: z.object({ p_case_id: id, p_transfer_id: id, p_evidence_version: version, p_payment_plan_id: id, p_amendment_id: id, p_enrollment_id: id, p_amount_minor: positive, ...write }).strict(), output: finish({ funding_reservation_id: id, reserved_minor: positive, confirmation_status: z.literal('AMENDMENT_PENDING') }),
  },
  correct_allocation: {
    input: z.object({ p_allocation_id: id, p_replacement_charge_id: id, p_amount_minor: positive, p_reason: reason, p_payment_plan_id: id.nullable().default(null), ...write }).strict(), output: finish({ reversal_id: id, new_allocation_id: id }),
  },
  record_transfer_reversal: {
    input: z.object({ p_transfer_id: id, p_external_reversal_id: reference, p_amount_minor: positive, p_effective_at: instant, p_evidence_file_id: id, ...write }).strict(), output: finish({ reversal_id: id, reconciliation_exception_id: id.nullable() }),
  },
  resolve_transfer_reversal: {
    input: z.object({ p_reversal_id: id, p_allocations: z.array(z.object({ allocation_id: id, amount_minor: positive }).strict()).max(100).refine(rows => new Set(rows.map(row => row.allocation_id)).size === rows.length), p_unapplied_minor: minor, p_reason: reason, ...write }).strict().refine(row => BigInt(row.p_unapplied_minor) + row.p_allocations.reduce((total, item) => total + BigInt(item.amount_minor), 0n) <= BigInt(Number.MAX_SAFE_INTEGER)).refine(row => row.p_unapplied_minor > 0 || row.p_allocations.length > 0),
    output: finish({ resolution_id: id, remaining_unresolved_minor: minor, reconciliation_exception_id: id.nullable() }),
  },
  request_refund: {
    input: z.object({ p_source_type: z.enum(['charge', 'unapplied_credit']), p_source_id: id, p_payer_account_id: id.nullable().default(null), p_amount_minor: positive, p_reason: reason, ...create }).strict(), output: finish({ refund_id: id, state: z.literal('requested') }),
  },
  propose_refund_destination: {
    input: z.object({ p_refund_id: id, p_destination_id: id, p_channel: channel, p_encrypted_identifier: encryptedIdentifierSchema, p_masked_identifier: z.string().min(1).max(100), p_identifier_fingerprint: hash, p_payee_name: z.string().trim().min(1).max(200), p_source_evidence_file_id: id, ...write }).strict(), output: finish({ destination_id: id, masked_identifier: z.string(), verification_status: z.literal('unverified') }),
  },
  verify_refund_destination: {
    input: z.object({ p_destination_id: id, p_evidence_file_id: id, p_decision: z.enum(['verified', 'rejected']), p_reason: reason, p_validation_artifact_id: id, ...write }).strict(), output: finish({ destination_version_id: id.nullable(), verification_status: z.enum(['verified', 'rejected']) }),
  },
  approve_refund: {
    input: z.object({ p_refund_id: id, p_remedy_id: id.nullable(), p_destination_version_id: id, p_amount_minor: positive, p_reason: reason, ...write }).strict(), output: finish({ reserved_minor: positive, state: z.literal('approved') }),
  },
  record_refund_attempt: {
    input: z.object({ p_refund_id: id, p_external_reference: reference, ...write }).strict(), output: finish({ attempt_id: id, state: z.literal('pending') }),
  },
  reconcile_refund: {
    input: z.object({ p_refund_id: id, p_attempt_id: id, p_outcome: z.enum(['settled', 'failed', 'unknown']), p_evidence_file_id: id, p_external_reference: reference, p_settled_at: instant.nullable(), ...write }).strict().refine(row => (row.p_outcome === 'settled') === (row.p_settled_at !== null)), output: finish({ state: refundState, ledger_transaction_id: id.nullable() }),
  },
  record_refund_reversal: {
    input: z.object({ p_refund_id: id, p_attempt_id: id, p_external_reversal_id: reference, p_amount_minor: positive, p_evidence_file_id: id, p_effective_at: instant, ...write }).strict(), output: finish({ refund_reversal_id: id, ledger_transaction_id: id, returned_minor: positive, reconciliation_state: reconciliation }),
  },
  resolve_package_financing_hold: {
    input: z.object({ p_package_purchase_id: id, p_reason: reason, p_evidence_file_id: id, ...write }).strict(), output: finish({ state: z.enum(['clear', 'held']), released_original_lot_ids: z.array(id) }),
  },
} as const;

export type PaymentCommandName = keyof typeof paymentCommands;
export async function invokePaymentCommandWithStatus<N extends PaymentCommandName>(client: PaymentRpcClient, name: N, args: Record<string, unknown>) {
  if (!Object.hasOwn(paymentCommands, name)) throw new PaymentRpcError('VALIDATION_ERROR');
  const definition = paymentCommands[name], input = definition.input.safeParse(args);
  if (!input.success) throw new PaymentRpcError('VALIDATION_ERROR');
  const response = await paymentRpc(client, name, input.data), output = definition.output.safeParse(response.data);
  if (!output.success || ![200, 201, 202].includes(response.status ?? 0)) throw new PaymentRpcError('DEPENDENCY_UNAVAILABLE');
  return { data: output.data as z.output<(typeof paymentCommands)[N]['output']>, status: response.status as 200 | 201 | 202 };
}
