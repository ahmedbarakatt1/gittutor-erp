import { z } from 'zod';

/** Structural boundary accepts user-scoped Supabase clients without retaining credentials. */
export type IdentityRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message: string; code?: string } | null; status?: number;
  }>;
};
const codes = new Set(['AUTH_REQUIRED', 'SESSION_REVOKED', 'VERIFIED_ACCOUNT_REQUIRED', 'FORBIDDEN', 'CONSENT_REQUIRED', 'NOT_FOUND',
  'VALIDATION_ERROR', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT', 'DESTINATION_UNVERIFIED', 'EVIDENCE_REQUIRED']);
export class IdentityRpcError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'IdentityRpcError'; }
}
export async function identityRpc(client: IdentityRpcClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new IdentityRpcError(codes.has(error.message) ? error.message : 'DEPENDENCY_UNAVAILABLE');
  return data;
}

const id = z.uuid();
const key = z.string().min(1).max(200);
const version = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(1).max(2000);
const staffRole = z.enum(['tutor', 'customer_service', 'admin']);
const subjects = z.array(id).min(1).max(30).refine(ids => new Set(ids).size === ids.length);
const scopes = z.array(z.enum(['profile', 'booking', 'payments', 'materials', 'notifications'])).min(1).max(5).refine(values => new Set(values).size === values.length);
const common = z.object({ command_id: id, resource_id: id, version });
const displayName = z.string().trim().min(1).max(120);
const bio = z.string().trim().min(1).max(5000);

const commands = {
  create_guardian_invitation: {
    input: z.object({ p_contact_id: id, p_scopes: scopes, p_expires_at: z.iso.datetime({ offset: true }), p_idempotency_key: key }).strict(),
    output: common.extend({ invitation_id: id, expires_at: z.string() }).strict(),
  },
  accept_guardian_invitation: {
    input: z.object({ p_invitation_id: id, p_single_use_token: z.string().min(1).max(256), p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ guardian_link_id: id, scopes }).strict(),
  },
  revoke_guardian_link: {
    input: z.object({ p_guardian_link_id: id, p_reason: reason, p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ revoked_at: z.string() }).strict(),
  },
  grant_staff_role: {
    input: z.object({ p_account_id: id, p_role: staffRole, p_reason: reason, p_idempotency_key: key }).strict(),
    output: common.extend({ role_grant_id: id }).strict(),
  },
  revoke_staff_role: {
    input: z.object({ p_role_grant_id: id, p_reason: reason, p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ revoked_at: z.string() }).strict(),
  },
  submit_tutor_application: {
    input: z.object({ p_display_name: displayName, p_subject_ids: subjects, p_bio: bio, p_contact_id: id, p_idempotency_key: key }).strict(),
    output: common.extend({ application_id: id }).strict(),
  },
  review_tutor_application: {
    input: z.object({ p_application_id: id, p_decision: z.enum(['approved', 'rejected']), p_reason: reason, p_approved_subject_ids: z.array(id).max(30), p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ tutor_id: id.nullable(), decision: z.enum(['approved', 'rejected']) }).strict(),
  },
  update_tutor_profile: {
    input: z.object({ p_display_name: displayName, p_bio: bio, p_subject_ids: subjects, p_contact_id: id, p_locale: z.enum(['en', 'ar']), p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ review_required_fields: z.array(z.enum(['display_name', 'bio', 'subject_ids'])) }).strict(),
  },
  create_staff_invitation: {
    input: z.object({ p_email: z.email().max(254), p_role: staffRole, p_reason: reason, p_expires_at: z.iso.datetime({ offset: true }), p_idempotency_key: key }).strict(),
    output: common.extend({ invitation_id: id, expires_at: z.string(), delivery_state: z.literal('pending') }).strict(),
  },
  accept_staff_invitation: {
    input: z.object({ p_invitation_id: id, p_expected_version: version, p_idempotency_key: key }).strict(),
    output: common.extend({ role_grant_id: id, role: staffRole }).strict(),
  },
} as const;
export type IdentityCommandName = keyof typeof commands;

export async function invokeIdentityCommand(client: IdentityRpcClient, rpcName: IdentityCommandName, args: Record<string, unknown>) {
  return (await invokeIdentityCommandWithStatus(client, rpcName, args)).data;
}

/** Transport metadata is kept outside the allowlisted public command result. */
export async function invokeIdentityCommandWithStatus(client: IdentityRpcClient, rpcName: IdentityCommandName, args: Record<string, unknown>) {
  if (!Object.hasOwn(commands, rpcName)) throw new IdentityRpcError('VALIDATION_ERROR');
  const contract = commands[rpcName];
  const parsed = contract.input.safeParse(args);
  if (!parsed.success) throw new IdentityRpcError('VALIDATION_ERROR');
  const { data, error, status } = await client.rpc(rpcName, parsed.data);
  if (error) throw new IdentityRpcError(codes.has(error.message) ? error.message : 'DEPENDENCY_UNAVAILABLE');
  if (status !== 200 && status !== 201 && status !== 202) throw new IdentityRpcError('DEPENDENCY_UNAVAILABLE');
  const result = contract.output.safeParse(data);
  if (!result.success) throw new IdentityRpcError('DEPENDENCY_UNAVAILABLE');
  return { data: result.data, status };
}
