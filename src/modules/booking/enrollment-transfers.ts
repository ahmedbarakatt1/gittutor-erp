import { z } from 'zod';
import { bookingRpc, BookingRpcError, proposalStateSchema, type BookingRpcClient } from './commands';
import { feeAgreementSchema, quoteSchema } from './queries';
import { publicOccurrenceSchema } from './public-occurrence';
import { publicPolicySummarySchema } from '../catalog/queries';

const id = z.uuid(), version = z.number().int().positive().max(2147483647);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), signed = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true }), hash = z.string().regex(/^[a-f0-9]{64}$/), title = z.string().min(1).max(300), currency = z.literal('EGP');
const learner = z.object({ learner_id: id, display_name: title }).strict();
const pageFields = { cursor: z.string().max(200).nullable().optional(), limit: z.number().int().min(1).max(100).optional() };
const pages = z.object(pageFields).strict();
const page = <S extends z.ZodType>(schema: S) => z.object({ items: z.array(schema), next_cursor: z.string().max(200).nullable() }).strict();
export const transferActionSchema = z.enum(['review_source_consequence', 'accept_transfer_terms', 'await_payer_consent', 'await_tutor_consent', 'provide_additional_funding', 'await_admin_approval', 'apply_transfer', 'refresh_stale_terms', 'resolve_funding', 'closed']);
const base = { proposal_id: id, version, kind: z.literal('enrollment_transfer'), state: proposalStateSchema, expires_at: instant, replaces_proposal_id: id.nullable(), superseded_by_proposal_id: id.nullable(), terms_hash: hash, accepted_at: instant.nullable(), can_accept: z.boolean(), required_actions: z.array(transferActionSchema) };
export const transferBookingSnapshotSchema = z.object({ enrollment_id: id, occurrence_id: id, title, tutor: z.object({ tutor_id: id, display_name: title }).strict(), start_at: instant, end_at: instant, time_zone: z.literal('Africa/Cairo'), format: z.enum(['private', 'group']), target_tier: z.union([z.literal(2), z.literal(3), z.literal(4)]).nullable() }).strict();
export const transferCustomerTermsSchema = z.object({ source_quote_id: id, source_policy_version_id: id, source_customer_policy: publicPolicySummarySchema, source_customer_price_minor: minor, source_retained_charge_minor: minor, source_charge_adjustment_minor: signed, source_cash_release_minor: minor, source_package_disposition: z.object({ released_credit_quanta: minor, extinguished_credit_quanta: minor, released_value_minor: minor, extinguished_value_minor: minor }).strict().nullable(), destination_quote: quoteSchema, planned_carryover_minor: minor, currency }).strict();
export const transferFundingSchema = z.object({ destination_charge_id: id.nullable(), required_for_confirmation_minor: minor, planned_carryover_minor: minor, accepted_carryover_minor: minor, posted_additional_minor: minor, additional_required_minor: minor, carryover_required_count: z.number().int().min(0).max(100), carryover_accepted_count: z.number().int().min(0).max(100), can_receive_additional_payment: z.boolean(), reconciliation_state: z.enum(['clear', 'requires_review']) }).strict().refine(value => value.accepted_carryover_minor <= value.planned_carryover_minor && value.carryover_accepted_count <= value.carryover_required_count);
export const transferCustomerDataSchema = z.object({ learner, source: transferBookingSnapshotSchema, requested_destination: publicOccurrenceSchema.extend({ title }).strict(), destination: transferBookingSnapshotSchema.nullable(), terms: transferCustomerTermsSchema.nullable(), funding: transferFundingSchema.nullable() }).strict();
export const transferTeachingTermsSchema = z.object({ tutor_id: id, occurrence_id: id, start_at: instant, end_at: instant, time_zone: z.literal('Africa/Cairo'), source_fee_agreement_id: id, old_fee_minor: minor, reviewed_fee_minor: minor, review_id: id, currency }).strict();
export const transferCarryoverOptionSchema = z.object({ allocation_id: id, transfer_id: id, source_reference: title, payer_masked_label: title, releasable_minor: minor, selected_carryover_minor: minor, currency }).strict().refine(value => value.selected_carryover_minor <= value.releasable_minor);
export const customerEnrollmentTransferSchema = transferCustomerDataSchema.extend({ ...base, view: z.literal('customer') }).strict();
export const tutorEnrollmentTransferSchema = z.object({ ...base, view: z.literal('tutor'), source_teaching_terms: transferTeachingTermsSchema.nullable() }).strict();
export const adminEnrollmentTransferSchema = z.object({ ...base, view: z.literal('admin'), customer: transferCustomerDataSchema, source_teaching_terms: transferTeachingTermsSchema.nullable(), destination_fee_snapshot: feeAgreementSchema.nullable(), required_acceptances: z.array(z.object({ participant_type: z.enum(['learner', 'tutor']), participant_id: id, accepted_at: instant.nullable() }).strict()), carryover_page: page(transferCarryoverOptionSchema), can_apply: z.boolean(), blockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)), source_version: version }).strict();
export const enrollmentTransferSchema = z.discriminatedUnion('view', [customerEnrollmentTransferSchema, tutorEnrollmentTransferSchema, adminEnrollmentTransferSchema]);
export const enrollmentTransferConsentStateSchema = z.enum(['awaiting_acceptance', 'accepted', 'declined', 'invalidated', 'consumed', 'expired']);
export const enrollmentTransferConsentSchema = z.object({ consent_id: id, version, proposal_id: id, state: enrollmentTransferConsentStateSchema, source_booking_reference: title, destination_booking_reference: title, destination_charge_id: id, destination_quote_id: id, sources: z.array(z.object({ transfer_id: id, channel: z.enum(['instapay', 'vodafone_cash']), amount_minor: minor.positive() }).strict()).min(1).max(100), carryover_minor: minor.positive(), currency, terms_hash: hash, expires_at: instant, accepted_at: instant.nullable(), can_accept: z.boolean() }).strict().refine(value => new Set(value.sources.map(row => row.transfer_id)).size === value.sources.length && value.sources.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n) === BigInt(value.carryover_minor));

export type EnrollmentTransfer = z.infer<typeof enrollmentTransferSchema>;
export type CustomerEnrollmentTransfer = z.infer<typeof customerEnrollmentTransferSchema>;
export type AdminEnrollmentTransfer = z.infer<typeof adminEnrollmentTransferSchema>;
export type TutorEnrollmentTransfer = z.infer<typeof tutorEnrollmentTransferSchema>;
export type TransferCustomerData = z.infer<typeof transferCustomerDataSchema>;
export type TransferCustomerTerms = z.infer<typeof transferCustomerTermsSchema>;
export type TransferCarryoverOption = z.infer<typeof transferCarryoverOptionSchema>;
export type EnrollmentTransferConsent = z.infer<typeof enrollmentTransferConsentSchema>;

const write = { p_expected_version: version, p_idempotency_key: z.string().min(1).max(200) }, reason = z.string().trim().min(1).max(2000);
const common = z.object({ command_id: id, resource_id: id, version });
export const enrollmentTransferCommands = {
  review_enrollment_transfer_proposal: { input: z.object({ p_proposal_id: id, p_source_tutor_fee_minor: minor, p_carryover_allocations: z.array(z.object({ allocation_id: id, amount_minor: minor.positive() }).strict()).max(100).refine(rows => new Set(rows.map(row => row.allocation_id)).size === rows.length), p_source_package_disposition: z.object({ released_credit_quanta: minor, extinguished_credit_quanta: minor }).strict().nullable().optional(), p_reason: reason, ...write }).strict(), output: common.extend({ proposal_id: id, new_enrollment_id: id, destination_quote_id: id, replaces_proposal_id: id }).strict() },
  accept_enrollment_transfer_consent: { input: z.object({ p_consent_id: id, p_terms_hash: hash, ...write }).strict(), output: common.extend({ consent_id: id, state: z.literal('accepted'), accepted_at: instant }).strict() },
  decline_enrollment_transfer_consent: { input: z.object({ p_consent_id: id, p_reason: reason, ...write }).strict(), output: common.extend({ consent_id: id, state: z.literal('declined') }).strict() },
} as const;
export type EnrollmentTransferCommandName = keyof typeof enrollmentTransferCommands;
export async function invokeEnrollmentTransferCommand(client: BookingRpcClient, name: EnrollmentTransferCommandName, args: Record<string, unknown>) {
  const command = enrollmentTransferCommands[name]; if (!command) throw new BookingRpcError('VALIDATION_ERROR');
  const input = command.input.safeParse(args); if (!input.success) throw new BookingRpcError('VALIDATION_ERROR');
  const result = await bookingRpc(client, name, input.data); const output = command.output.safeParse(result.data);
  if (!output.success || ![200, 201].includes(result.status ?? 0)) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');
  return { data: output.data, status: result.status as 200 | 201 };
}
function one(value: string, name: string) { if (!id.safeParse(value).success) throw new BookingRpcError('VALIDATION_ERROR'); return { [`p_${name}`]: value }; }
function parameters<S extends z.ZodType>(schema: S, input: unknown, paged = true) {
  const parsed = schema.safeParse(input); if (!parsed.success) throw new BookingRpcError('VALIDATION_ERROR');
  const values = parsed.data as Record<string, unknown>; return Object.fromEntries(Object.entries(paged ? { ...values, cursor: values.cursor ?? null, limit: values.limit ?? 25 } : values).map(([key, value]) => [`p_${key}`, value]));
}
async function read<S extends z.ZodType>(client: BookingRpcClient, name: string, schema: S, args: Record<string, unknown>): Promise<z.output<S>> {
  const parsed = schema.safeParse((await bookingRpc(client, name, args)).data); if (!parsed.success) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE'); return parsed.data;
}
const views = z.object({ view: z.enum(['customer', 'tutor', 'admin']), learner_id: id.optional() }).strict();
export async function getEnrollmentTransferProposal(client: BookingRpcClient, proposalId: string, options: z.input<typeof views>) {
  const data = await read(client, 'get_enrollment_transfer_proposal', enrollmentTransferSchema, { ...one(proposalId, 'proposal_id'), ...parameters(views, options, false) });
  if (data.view !== options.view) throw new BookingRpcError('DEPENDENCY_UNAVAILABLE'); return data;
}
export const listEnrollmentTransferSources = (client: BookingRpcClient, proposalId: string, options: z.input<typeof pages> = {}) => read(client, 'list_enrollment_transfer_sources', page(transferCarryoverOptionSchema), { ...one(proposalId, 'proposal_id'), ...parameters(pages, options) });
const consentFilters = pages.extend({ state: enrollmentTransferConsentStateSchema.optional() }).strict();
export const listMyEnrollmentTransferConsents = (client: BookingRpcClient, options: z.input<typeof consentFilters> = {}) => read(client, 'list_my_enrollment_transfer_consents', page(enrollmentTransferConsentSchema), parameters(consentFilters, options));
export const getEnrollmentTransferConsent = (client: BookingRpcClient, consentId: string) => read(client, 'get_enrollment_transfer_consent', enrollmentTransferConsentSchema, one(consentId, 'consent_id'));
