import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { allowedOrigin, DomainError, readJson, safeError } from "@/server/http";
import { invokeIdentityCommandWithStatus, type IdentityCommandName } from "@/modules/identity/commands";
import { getApplicationSubjects, getLearnerSummary, getMyGuardianLinks, getMyVerifiedContacts, getStaffInvitations, getStaffRoleGrants, getTutorApplications, getTutorProfile } from "@/modules/identity/queries";

type CommandRoute = { pattern: RegExp; rpc: IdentityCommandName; fields: string[]; pathArgument?: string };
const commands: CommandRoute[] = [
  { pattern: /^guardian-invitations$/, rpc: "create_guardian_invitation", fields: ["contact_id", "scopes", "expires_at"] },
  { pattern: /^guardian-invitations\/([^/]+)\/accept$/, rpc: "accept_guardian_invitation", pathArgument: "invitation_id", fields: ["single_use_token", "expected_version"] },
  { pattern: /^guardian-links\/([^/]+)\/revoke$/, rpc: "revoke_guardian_link", pathArgument: "guardian_link_id", fields: ["reason", "expected_version"] },
  { pattern: /^staff-role-grants$/, rpc: "grant_staff_role", fields: ["account_id", "role", "reason"] },
  { pattern: /^staff-role-grants\/([^/]+)\/revoke$/, rpc: "revoke_staff_role", pathArgument: "role_grant_id", fields: ["reason", "expected_version"] },
  { pattern: /^staff-invitations$/, rpc: "create_staff_invitation", fields: ["email", "role", "reason", "expires_at"] },
  { pattern: /^staff-invitations\/([^/]+)\/accept$/, rpc: "accept_staff_invitation", pathArgument: "invitation_id", fields: ["expected_version"] },
  { pattern: /^tutor-applications$/, rpc: "submit_tutor_application", fields: ["display_name", "subject_ids", "bio", "contact_id"] },
  { pattern: /^tutor-applications\/([^/]+)\/review$/, rpc: "review_tutor_application", pathArgument: "application_id", fields: ["decision", "reason", "approved_subject_ids", "expected_version"] },
  { pattern: /^tutor\/profile$/, rpc: "update_tutor_profile", fields: ["display_name", "bio", "subject_ids", "contact_id", "locale", "expected_version"] },
];

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    const path = (await params).path.join("/");
    const route = commands.find(item => item.pattern.test(path));
    if (!route) throw new DomainError("NOT_FOUND");
    context = requestSupabase(request);
    if (!allowedOrigin(request.headers.get("origin"), context.config.app_base_url, context.config.isolated)) throw new DomainError("FORBIDDEN");
    const { data, error } = await context.client.auth.getClaims();
    if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
    const key = request.headers.get("Idempotency-Key");
    if (!key || !key.trim() || key.length > 200) throw new DomainError("VALIDATION_ERROR");
    const body = await readJson(request);
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(field => !route.fields.includes(field))) throw new DomainError("VALIDATION_ERROR");
    const args: Record<string, unknown> = { p_idempotency_key: key };
    for (const [field, value] of Object.entries(body)) args[`p_${field}`] = value;
    if (route.pathArgument) args[`p_${route.pathArgument}`] = route.pattern.exec(path)![1];
    const result = await invokeIdentityCommandWithStatus(context.client, route.rpc, args);
    return context.finish(NextResponse.json({ data: result.data, request_id: requestId }, { status: result.status }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    const path = (await params).path;
    const paged = ["tutor-applications", "staff-invitations", "staff-role-grants", "me/guardian-links"].includes(path.join("/"));
    const filters = request.nextUrl.searchParams;
    if (Array.from(filters.keys()).some(key => !paged || !["cursor", "limit"].includes(key)) || new Set(filters.keys()).size !== filters.size) throw new DomainError("VALIDATION_ERROR");
    const pageOptions = { cursor: filters.get("cursor"), limit: filters.has("limit") ? Number(filters.get("limit")) : 25 };
    context = requestSupabase(request);
    const { data, error } = await context.client.auth.getClaims();
    if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
    let result: unknown;
    if (path.join("/") === "tutor/profile") result = await getTutorProfile(context.client);
    else if (path.join("/") === "me/contacts") result = await getMyVerifiedContacts(context.client);
    else if (path.join("/") === "me/application-subjects") result = await getApplicationSubjects(context.client);
    else if (path.join("/") === "tutor-applications") result = await getTutorApplications(context.client, pageOptions);
    else if (path.join("/") === "staff-invitations") result = await getStaffInvitations(context.client, pageOptions);
    else if (path.join("/") === "staff-role-grants") result = await getStaffRoleGrants(context.client, pageOptions);
    else if (path.join("/") === "me/guardian-links") result = await getMyGuardianLinks(context.client, pageOptions);
    else if (path.length === 2 && path[0] === "learners") result = await getLearnerSummary(context.client, path[1]);
    else throw new DomainError("NOT_FOUND");
    return context.finish(NextResponse.json({ data: result, request_id: requestId }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}
