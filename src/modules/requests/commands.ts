import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';

export const requestFormatSchema = z.enum(['individual', 'group2', 'group3', 'group4', 'undecided']);
export const requestStateSchema = z.enum(['draft', 'submitted', 'reviewing', 'needs_information', 'matched', 'closed']);
const reviewState = requestStateSchema.exclude(['draft', 'submitted']);
const requestId = z.uuid();
const version = z.number().int().positive().max(2147483647);
const writeDetails = {
  p_topic: z.string().trim().min(1).max(160),
  p_course: z.string().trim().max(160).default(''),
  p_description: z.string().trim().min(1).max(4000),
  p_preferred_times: z.string().trim().min(1).max(1000),
  p_format: requestFormatSchema,
};
const key = { p_idempotency_key: z.string().min(1).max(200) };
const existing = { p_request_id: requestId, p_expected_version: version, ...key };
const inputs = {
  create_tutoring_request: z.object({ p_learner_id: requestId, ...writeDetails, ...key }).strict(),
  update_tutoring_request: z.object({ ...writeDetails, ...existing }).strict(),
  submit_tutoring_request: z.object(existing).strict(),
  remove_tutoring_request_file: z.object({ ...existing, p_file_id: requestId }).strict(),
  review_tutoring_request: z.object({
    ...existing,
    p_state: reviewState,
    p_customer_reply: z.string().trim().max(2000).nullable(),
    p_occurrence_id: requestId.nullable().default(null),
  }).strict().refine(data => (data.p_state === 'matched') === Boolean(data.p_occurrence_id)),
};
const resultSchema = z.object({ command_id: requestId, resource_id: requestId, version }).strict();
const safeCodes = new Set([
  'AUTH_REQUIRED', 'SESSION_REVOKED', 'VERIFIED_ACCOUNT_REQUIRED', 'FORBIDDEN', 'NOT_FOUND',
  'VALIDATION_ERROR', 'STATE_CONFLICT', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT',
  'EVIDENCE_REQUIRED', 'SCAN_REQUIRED', 'DEPENDENCY_UNAVAILABLE', 'RETRYABLE_CONFLICT',
]);

export type RequestCommandName = keyof typeof inputs;
export type RequestRpcClient = IdentityRpcClient;

export class RequestError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export async function requestRpc(client: RequestRpcClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) {
    const code = ['40001', '40P01', '55P03'].includes(result.error.code ?? '')
      ? 'RETRYABLE_CONFLICT'
      : result.error.message;
    throw new RequestError(safeCodes.has(code) ? code : 'DEPENDENCY_UNAVAILABLE');
  }
  return result;
}

export async function invokeRequestCommand(client: RequestRpcClient, name: RequestCommandName, args: unknown) {
  const input = inputs[name].safeParse(args);
  if (!input.success) throw new RequestError('VALIDATION_ERROR');
  const response = await requestRpc(client, name, input.data);
  const output = resultSchema.safeParse(response.data);
  if (!output.success || (response.status !== 200 && response.status !== 201)) throw new RequestError('DEPENDENCY_UNAVAILABLE');
  return { data: output.data, status: response.status };
}
