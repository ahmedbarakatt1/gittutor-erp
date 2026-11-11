import { z } from 'zod';
import { identityRpc, IdentityRpcError, type IdentityRpcClient } from './commands';

const id = z.uuid();
const role = z.enum(['student', 'guardian', 'tutor', 'customer_service', 'admin']);
const account = z.object({ account_id: id, verified: z.literal(true), roles: z.array(role), locale: z.enum(['en', 'ar']), authorized_learner_ids: z.array(id) }).strict();
const accountResult = z.union([account, z.object({ is_guest: z.literal(true) }).strict()]);
const publicProfile = z.object({ display_name: z.string(), bio: z.string(), subject_ids: z.array(id) }).strict();
const tutorProfile = publicProfile.extend({
  tutor_id: id, version: z.number().int().positive(), contact_id: id.nullable(), locale: z.enum(['en', 'ar']),
  contact_verified: z.boolean(), draft_profile_version_id: id.nullable(), approved_profile_version_id: id.nullable(),
  approved_profile: publicProfile.nullable(), payout_methods: z.array(z.never()),
}).strict();
const learner = z.object({ learner_id: id, display_name: z.string(), version: z.number().int().positive() }).strict();
const contacts = z.object({ items: z.array(z.object({ contact_id: id, channel: z.literal('email'), masked_destination: z.string(), verified: z.literal(true) }).strict()), next_cursor: z.null() }).strict();
const subjects = z.object({ items: z.array(z.object({ subject_id: id, title: z.string() }).strict()), next_cursor: z.null() }).strict();
const applications = z.object({ items: z.array(z.object({ application_id: id, applicant_account_id: id, display_name: z.string(), bio: z.string(), subject_ids: z.array(id), version: z.number().int().positive(), state: z.enum(['pending', 'approved', 'rejected']), created_at: z.string() }).strict()), next_cursor: z.string().nullable() }).strict();
const staffInvitations = z.object({ items: z.array(z.object({ invitation_id: id, masked_email: z.string(), role: z.enum(['tutor', 'customer_service', 'admin']), state: z.enum(['pending', 'accepted', 'cancelled']), delivery_state: z.enum(['pending', 'sent', 'unknown', 'failed']), version: z.number().int().positive(), created_at: z.string(), last_error_code: z.string().nullable() }).strict()), next_cursor: z.string().nullable() }).strict();
const guardianLinks = z.object({ items: z.array(z.object({ guardian_link_id: id, learner_id: id, learner_name: z.string(), guardian_masked_contact: z.string(), scopes: z.array(z.enum(['profile', 'booking', 'payments', 'materials', 'notifications'])), version: z.number().int().positive(), can_revoke: z.boolean() }).strict()), next_cursor: z.string().nullable() }).strict();
const staffRoleGrants = z.object({ items: z.array(z.object({ role_grant_id: id, account_id: id, display_name: z.string(), masked_email: z.string().nullable(), role: z.enum(['tutor', 'customer_service', 'admin']), version: z.number().int().positive() }).strict()), next_cursor: z.string().nullable() }).strict();
const pagination = z.object({ cursor: z.string().max(100).nullable().optional(), limit: z.number().int().min(1).max(100).optional() }).strict();

async function query<S extends z.ZodType>(client: IdentityRpcClient, name: string, schema: S, args?: Record<string, unknown>): Promise<z.output<S>> {
  const result = schema.safeParse(await identityRpc(client, name, args));
  if (!result.success) throw new IdentityRpcError('DEPENDENCY_UNAVAILABLE');
  return result.data;
}
function pageArgs(options: z.input<typeof pagination>) {
  const parsed = pagination.safeParse(options);
  if (!parsed.success) throw new IdentityRpcError('VALIDATION_ERROR');
  return { p_cursor: parsed.data.cursor ?? null, p_limit: parsed.data.limit ?? 25 };
}
export const getMyAccount = (client: IdentityRpcClient) => query(client, 'get_my_account', accountResult);
export const getTutorProfile = (client: IdentityRpcClient) => query(client, 'get_tutor_profile', tutorProfile);
export const getMyVerifiedContacts = (client: IdentityRpcClient) => query(client, 'get_my_verified_contacts', contacts);
export const getApplicationSubjects = (client: IdentityRpcClient) => query(client, 'list_application_subjects', subjects);
export const getTutorApplications = (client: IdentityRpcClient, options: z.input<typeof pagination> = {}) => query(client, 'get_tutor_applications', applications, pageArgs(options));
export const getStaffInvitations = (client: IdentityRpcClient, options: z.input<typeof pagination> = {}) => query(client, 'list_staff_invitations', staffInvitations, pageArgs(options));
export const getMyGuardianLinks = (client: IdentityRpcClient, options: z.input<typeof pagination> = {}) => query(client, 'get_my_guardian_links', guardianLinks, pageArgs(options));
export const getStaffRoleGrants = (client: IdentityRpcClient, options: z.input<typeof pagination> = {}) => query(client, 'list_staff_role_grants', staffRoleGrants, pageArgs(options));
export function getLearnerSummary(client: IdentityRpcClient, learnerId: string) {
  const parsed = id.safeParse(learnerId);
  if (!parsed.success) throw new IdentityRpcError('VALIDATION_ERROR');
  return query(client, 'get_learner_summary', learner, { p_learner_id: parsed.data });
}
