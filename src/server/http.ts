import { z } from "zod";
export const loginInput = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).strict();
export const signupInput = loginInput.extend({ password: z.string().min(12).max(256) });

/** Supabase prefixes confirmation hashes created by SSR PKCE signup. Provider verifies the value. */
export function isAuthTokenHash(value: string): boolean {
  return /^(?:pkce_)?[a-f0-9]{32,128}$/i.test(value);
}

export class DomainError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function allowedOrigin(origin: string | null, base: string, isolated: boolean): boolean {
  if (!origin) return false;
  try {
    const target = new URL(base);
    const source = new URL(origin);
    if (source.origin === target.origin) return true;
    return isolated && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
      && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      && source.port === target.port && source.protocol === target.protocol;
  } catch { return false; }
}

/** Keep cookie-bound Auth callbacks on the approved host used by the browser. */
export function authRedirectBase(incoming: string, configured: string, isolated: boolean, browserHost?: string | null): string {
  try {
    const internal = new URL(incoming);
    const origin = browserHost ? new URL(`${internal.protocol}//${browserHost}`).origin : internal.origin;
    if (allowedOrigin(origin, configured, isolated)) return origin;
  } catch { /* An invalid request origin must never become a redirect target. */ }
  return new URL(configured).origin;
}

const errors: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, "Sign in to continue."],
  AUTH_FAILED: [401, "Check your email and password and try again."],
  SESSION_REVOKED: [401, "Your session has ended. Sign in again."],
  PASSWORD_UPDATED_REVOCATION_UNCONFIRMED: [503, "Your password changed. Use Account security to sign out on all devices."],
  VERIFIED_ACCOUNT_REQUIRED: [401, "Verify your email before continuing."],
  FORBIDDEN: [403, "You do not have permission for this action."],
  OWNER_REQUIRED: [403, "This action needs the current owner."],
  CONSENT_REQUIRED: [403, "Current consent is required."],
  NOT_FOUND: [404, "This record is not available."],
  VALIDATION_ERROR: [400, "Check the supplied fields and try again."],
  INVALID_TIME: [400, "Choose a valid date and time."],
  AMOUNT_OUT_OF_RANGE: [400, "Enter a valid amount."],
  VERSION_CONFLICT: [409, "This record has changed. Refresh before trying again."],
  IDEMPOTENCY_CONFLICT: [409, "This operation key was already used with different details."],
  STATE_CONFLICT: [409, "This action is no longer available for the current record."],
  WHATSAPP_MANUAL_CONTACT_ONLY: [409, "Reply directly in WhatsApp. Website conversations can be answered here."],
  DESTINATION_UNVERIFIED: [409, "Verify the destination before continuing."],
  EVIDENCE_REQUIRED: [409, "The required verified evidence is not available."],
  CAPACITY_CONFLICT: [409, "This place is no longer available. Choose another session."],
  DUPLICATE_ENROLLMENT: [409, "This learner already has a place in this session."],
  SCHEDULE_CONFLICT: [409, "This time conflicts with an existing commitment."],
  INSUFFICIENT_FUNDS: [409, "The verified available funds do not cover this action."],
  INSUFFICIENT_ENTITLEMENT: [409, "There is not enough available package entitlement."],
  POLICY_INCOMPLETE: [409, "Complete and approve the required policy before continuing."],
  TRANSFER_UNSETTLED: [409, "Independently verify settled funds before allocating them."],
  DUPLICATE_TRANSFER: [409, "This transfer reference has already been recorded."],
  REMEDY_RESERVED: [409, "This benefit is already reserved by another remedy."],
  HISTORY_UNKNOWN: [409, "The historical evidence is incomplete."],
  FILE_REJECTED: [422, "This file does not meet the upload requirements."],
  FILE_TOO_LARGE: [413, "This file exceeds the upload size limit."],
  FILE_TYPE_INVALID: [422, "Choose a supported file type."],
  FILE_CHECKSUM_MISMATCH: [422, "The file changed during upload. Select it again."],
  FILE_SIZE_MISMATCH: [422, "The upload is incomplete. Select the file and retry."],
  FILE_ARCHIVE_INVALID: [422, "This presentation could not be safely verified."],
  SCAN_REQUIRED: [409, "This file is waiting for its safety check."],
  UPLOAD_REQUIRED: [409, "Upload the file content before continuing."],
  LEASE_LOST: [409, "This operation has changed. Refresh and try again."],
  CALENDAR_AUTH_REQUIRED: [409, "Connect the approved calendar account again."],
  CALENDAR_CONNECTION_REQUIRED: [409, "Connect a calendar before provisioning meetings."],
  WINDOW_CLOSED: [422, "The time window for this action has closed. Refresh to see the available actions."],
  TEMPLATE_REQUIRED: [422, "Choose an eligible approved message template."],
  RETRYABLE_CONFLICT: [503, "Another change is in progress. Retry this action shortly."],
  DEPENDENCY_UNAVAILABLE: [503, "This service is temporarily unavailable. Try again shortly."],
  RATE_LIMITED: [429, "Too many requests. Please wait before trying again."],
};

const scheduleConflictFields = z.object({ conflicting_occurrence_ids: z.array(z.uuid()).max(100) }).strict();
export function safeError(error: unknown): { status: number; code: string; message: string; field_errors?: { conflicting_occurrence_ids: string[] } } {
  const candidate = typeof error === "object" && error !== null
    ? ("code" in error && typeof error.code === "string" && errors[error.code] ? error.code : "message" in error ? error.message : null) : null;
  const code = typeof candidate === "string" && errors[candidate] ? candidate : "DEPENDENCY_UNAVAILABLE";
  const fields = code === "SCHEDULE_CONFLICT" && typeof error === "object" && error !== null && "field_errors" in error
    ? scheduleConflictFields.safeParse(error.field_errors) : null;
  return { code, status: errors[code][0], message: errors[code][1], ...(fields?.success ? { field_errors: fields.data } : {}) };
}

export function landingForRoles(roles: string[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("customer_service")) return "/service";
  if (roles.includes("tutor")) return "/tutor";
  if (roles.length === 0) return "/learn/payments";
  return "/learn";
}

export async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new DomainError("VALIDATION_ERROR");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("VALIDATION_ERROR");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) { await reader.cancel(); throw new DomainError("VALIDATION_ERROR"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("VALIDATION_ERROR"); }
}
