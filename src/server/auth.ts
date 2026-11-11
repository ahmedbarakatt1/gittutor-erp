import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthUnavailableError, serverSupabase } from "./supabase";
import { customerReturnPath } from "@/modules/identity/return-path";
export { AuthUnavailableError } from "./supabase";

export const accountSchema = z.object({
  account_id: z.uuid(), verified: z.boolean(), roles: z.array(z.enum(["student", "guardian", "tutor", "customer_service", "admin"])),
  locale: z.string(), authorized_learner_ids: z.array(z.uuid()), is_guest: z.boolean().optional(),
});
export type Account = z.infer<typeof accountSchema>;

export async function getCurrentAccount(): Promise<Account | null> {
  const client = await serverSupabase();
  const { data: claims, error } = await client.auth.getClaims();
  if (error || !claims?.claims.sub) return null;
  const result = await client.rpc("get_my_account");
  if (result.error) {
    if (["AUTH_REQUIRED", "SESSION_REVOKED", "VERIFIED_ACCOUNT_REQUIRED"].includes(result.error.message)) return null;
    throw new AuthUnavailableError();
  }
  const parsed = accountSchema.safeParse(result.data);
  if (!parsed.success || !parsed.data.verified || parsed.data.is_guest) return null;
  return parsed.data;
}

export async function requireAccount(role?: string, returnTo?: string): Promise<Account> {
  const returnPath = customerReturnPath(returnTo);
  const loginPath = (reason?: string) => {
    const query = new URLSearchParams();
    if (reason) query.set('reason', reason);
    if (returnPath) query.set('return_to', returnPath);
    return `/login${query.size ? `?${query}` : ''}`;
  };
  let account: Account | null;
  try { account = await getCurrentAccount(); }
  catch (error) {
    if (error instanceof AuthUnavailableError) redirect(loginPath('unavailable'));
    throw error;
  }
  if (!account) redirect(loginPath());
  const allowed = role === "student" ? ["student", "guardian"] : role ? [role] : account.roles;
  if (!allowed.some(item => account.roles.includes(item as Account["roles"][number]))) redirect(loginPath('forbidden'));
  return account;
}
