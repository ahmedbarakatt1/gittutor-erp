import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthUnavailableError, serverSupabase } from "./supabase";
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

export async function requireAccount(role?: string): Promise<Account> {
  let account: Account | null;
  try { account = await getCurrentAccount(); }
  catch (error) {
    if (error instanceof AuthUnavailableError) redirect("/login?reason=unavailable");
    throw error;
  }
  if (!account) redirect("/login");
  const allowed = role === "student" ? ["student", "guardian"] : role ? [role] : account.roles;
  if (!allowed.some(item => account.roles.includes(item as Account["roles"][number]))) redirect("/login?reason=forbidden");
  return account;
}
