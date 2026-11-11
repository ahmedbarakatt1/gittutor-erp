import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { invokePaymentCommandWithStatus, paymentCommands, PaymentRpcError, type PaymentRpcClient } from '../modules/payments/commands';
import { createIdentifierCipher, normalizeIdentifier } from './private-identifiers';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const actorSchema = z.object({ account_id: id, session_id: id }).strict();
export type DestinationActor = z.infer<typeof actorSchema>;
const proposalSchema = paymentCommands.propose_refund_destination.input.omit({ p_destination_id: true, p_encrypted_identifier: true, p_masked_identifier: true, p_identifier_fingerprint: true }).extend({ p_identifier: z.string().max(512) });
const approvalSchema = paymentCommands.verify_refund_destination.input.omit({ p_validation_artifact_id: true });
const preparedSchema = z.object({ payer_account_id: id, prior_request: paymentCommands.propose_refund_destination.input.nullable() }).strict();
const destinationSchema = z.object({
  destination_id: id, refund_id: id, payer_account_id: id, channel: z.enum(['instapay', 'vodafone_cash']), identifier_version: z.literal(1),
  version: z.number().int().positive().max(2147483647), encrypted_identifier: paymentCommands.propose_refund_destination.input.shape.p_encrypted_identifier,
  ciphertext_digest: hash, masked_identifier: z.string().max(100), identifier_fingerprint: hash,
  verification_status: z.enum(['unverified', 'verified', 'rejected']), destination_version_id: id.nullable(),
}).strict();
const artifactSchema = z.object({ validation_artifact_id: id, approval_request_hash: hash, expires_at: z.iso.datetime({ offset: true }) }).strict();
const revealSchema = z.object({ destination_id: id, refund_attempt_id: id, reason: z.string().trim().min(1).max(2000) }).strict();
type ApprovalRequest = { destination_id: string; expected_version: number; evidence_file_id: string; decision: 'verified' | 'rejected'; reason: string; idempotency_key: string };
type ArtifactInput = { destination_id: string; destination_version: number; ciphertext_digest: string; masked_identifier: string; identifier_fingerprint: string; purpose: 'verify_refund_destination'; approval_request: ApprovalRequest };
export interface PrivateDestinationPort {
  prepare(actor: DestinationActor, refundId: string, key: string): Promise<unknown>;
  read(actor: DestinationActor, destinationId: string, purpose: 'verify_candidate' | 'reveal_for_attempt', attemptId: string | null, reason: string | null): Promise<unknown>;
  issue(actor: DestinationActor, input: ArtifactInput): Promise<unknown>;
}
function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PaymentRpcError('VALIDATION_ERROR');
  return parsed.data;
}
function privateResult<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PaymentRpcError('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

/** This transport never grants business authority. Private SQL revalidates the live session; every mutation uses the user's JWT. */
export function createRefundDestinationTransport({ cipher, port, client }: { cipher: ReturnType<typeof createIdentifierCipher>; port: PrivateDestinationPort; client: PaymentRpcClient }) {
  function decrypt(row: z.infer<typeof destinationSchema>, destinationId: string) {
    if (row.destination_id !== destinationId) throw new Error('PRIVATE_IDENTIFIER_UNAVAILABLE');
    const opened = cipher.open(row.encrypted_identifier, { purpose: 'refund_destination', channel: row.channel, parent_id: row.refund_id, destination_id: row.destination_id, owner_account_id: row.payer_account_id, identifier_version: row.identifier_version });
    if (opened.masked_identifier !== row.masked_identifier || opened.identifier_fingerprint !== row.identifier_fingerprint) throw new Error('PRIVATE_IDENTIFIER_UNAVAILABLE');
    return opened;
  }
  return {
    async propose(rawActor: DestinationActor, rawInput: unknown) {
      const actor = input(actorSchema, rawActor), request = input(proposalSchema, rawInput);
      const identifier = normalizeIdentifier(request.p_identifier);
      const prepared = privateResult(preparedSchema, await port.prepare(actor, request.p_refund_id, request.p_idempotency_key));
      function replay(context: z.infer<typeof preparedSchema>) {
        const prior = context.prior_request;
        if (!prior) throw new PaymentRpcError('IDEMPOTENCY_CONFLICT');
        const logicalKeys = ['p_refund_id', 'p_channel', 'p_payee_name', 'p_source_evidence_file_id', 'p_expected_version', 'p_idempotency_key'] as const;
        if (logicalKeys.some(key => prior[key] !== request[key])) throw new PaymentRpcError('IDEMPOTENCY_CONFLICT');
        const opened = cipher.open(prior.p_encrypted_identifier, { purpose: 'refund_destination', channel: prior.p_channel, parent_id: prior.p_refund_id, destination_id: prior.p_destination_id, owner_account_id: context.payer_account_id, identifier_version: 1 });
        if (opened.masked_identifier !== prior.p_masked_identifier || opened.identifier_fingerprint !== prior.p_identifier_fingerprint) throw new Error('PRIVATE_IDENTIFIER_UNAVAILABLE');
        if (opened.identifier !== identifier) throw new PaymentRpcError('IDEMPOTENCY_CONFLICT');
        return prior;
      }
      const destinationId = randomUUID();
      const args = prepared.prior_request ? replay(prepared) : (() => {
        const business = { p_refund_id: request.p_refund_id, p_channel: request.p_channel, p_payee_name: request.p_payee_name, p_source_evidence_file_id: request.p_source_evidence_file_id, p_expected_version: request.p_expected_version, p_idempotency_key: request.p_idempotency_key };
        const sealed = cipher.seal(identifier, { purpose: 'refund_destination', channel: request.p_channel, parent_id: request.p_refund_id, destination_id: destinationId, owner_account_id: prepared.payer_account_id, identifier_version: 1 });
        return { ...business, p_destination_id: destinationId, p_encrypted_identifier: sealed.encrypted_identifier, p_masked_identifier: sealed.masked_identifier, p_identifier_fingerprint: sealed.identifier_fingerprint };
      })();
      try { return await invokePaymentCommandWithStatus(client, 'propose_refund_destination', args); }
      catch (error) {
        if (!(error instanceof PaymentRpcError) || error.code !== 'IDEMPOTENCY_CONFLICT' || prepared.prior_request) throw error;
        const winner = privateResult(preparedSchema, await port.prepare(actor, request.p_refund_id, request.p_idempotency_key));
        return invokePaymentCommandWithStatus(client, 'propose_refund_destination', replay(winner));
      }
    },
    async verify(rawActor: DestinationActor, rawInput: unknown) {
      const actor = input(actorSchema, rawActor), request = input(approvalSchema, rawInput);
      const row = privateResult(destinationSchema, await port.read(actor, request.p_destination_id, 'verify_candidate', null, null));
      const opened = decrypt(row, request.p_destination_id);
      // SQL handles exact completed replay before stale-version/consumed/expiry checks. Never preempt that ordering here.
      const approval = { destination_id: request.p_destination_id, expected_version: request.p_expected_version, evidence_file_id: request.p_evidence_file_id, decision: request.p_decision, reason: request.p_reason, idempotency_key: request.p_idempotency_key };
      const artifact = privateResult(artifactSchema, await port.issue(actor, { destination_id: request.p_destination_id, destination_version: request.p_expected_version, ciphertext_digest: row.ciphertext_digest, masked_identifier: opened.masked_identifier, identifier_fingerprint: opened.identifier_fingerprint, purpose: 'verify_refund_destination', approval_request: approval }));
      return invokePaymentCommandWithStatus(client, 'verify_refund_destination', { ...request, p_validation_artifact_id: artifact.validation_artifact_id });
    },
    async reveal(rawActor: DestinationActor, rawInput: unknown) {
      const actor = input(actorSchema, rawActor), request = input(revealSchema, rawInput);
      const row = privateResult(destinationSchema, await port.read(actor, request.destination_id, 'reveal_for_attempt', request.refund_attempt_id, request.reason));
      const opened = decrypt(row, request.destination_id);
      return { identifier: opened.identifier };
    },
  };
}
