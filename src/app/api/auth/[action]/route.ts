import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { accountSchema } from "@/server/auth";
import { allowedOrigin, DomainError, landingForRoles, loginInput, readJson, safeError, signupInput } from "@/server/http";
import { z } from "zod";

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    const { action } = await params;
    if (!["login", "signup", "logout", "password", "recover"].includes(action)) throw new DomainError("NOT_FOUND");
    context = requestSupabase(request);
    if (!allowedOrigin(request.headers.get("origin"), context.config.app_base_url, context.config.isolated)) throw new DomainError("FORBIDDEN");
    if (action === "recover") {
      const input = loginInput.pick({ email: true }).safeParse(await readJson(request));
      if (!input.success) throw new DomainError("VALIDATION_ERROR");
      const { error } = await context.client.auth.resetPasswordForEmail(input.data.email.trim().toLowerCase(), {
        redirectTo: new URL("/auth/callback", context.config.app_base_url).href,
      });
      // The public response is independent of account existence and per-recipient throttling.
      if (error) console.warn("auth_recovery_request_unconfirmed", { request_id: requestId });
      return context.finish(NextResponse.json({ data: { request_received: true }, request_id: requestId },
        { status: 202, headers: { "Cache-Control": "private, no-store" } }));
    }
    const verified = await context.client.auth.getClaims();
    if (action === "password") {
      if (verified.error || !verified.data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
      const account = await context.client.rpc("get_my_account");
      if (account.error) throw account.error;
      if (!account.data?.verified) throw new DomainError("VERIFIED_ACCOUNT_REQUIRED");
      const parsed = z.object({ password: z.string().min(12).max(256) }).strict().safeParse(await readJson(request));
      if (!parsed.success) throw new DomainError("VALIDATION_ERROR");
      const { error } = await context.client.auth.updateUser({ password: parsed.data.password });
      if (error) throw new DomainError(error.status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR");
      return context.finish(NextResponse.json({ data: { password_updated: true }, request_id: requestId }));
    }
    if (action === "logout") {
      const { error } = await context.client.auth.signOut({ scope: "local" });
      if (error) throw new DomainError("DEPENDENCY_UNAVAILABLE");
      return context.finish(NextResponse.json({ data: { signed_out: true }, request_id: requestId }));
    }
    const body = await readJson(request);
    const parsed = (action === "signup" ? signupInput : loginInput).safeParse(body);
    if (!parsed.success) throw new DomainError("VALIDATION_ERROR");
    const email = parsed.data.email.trim().toLowerCase();
    if (action === "signup") {
      const { error } = await context.client.auth.signUp({ email, password: parsed.data.password,
        options: { emailRedirectTo: new URL("/auth/callback", context.config.app_base_url).href } });
      if (error) throw new DomainError(error.status === 429 ? "RATE_LIMITED" : "VALIDATION_ERROR");
      return context.finish(NextResponse.json({ data: { verification_required: true }, request_id: requestId }, { status: 201 }));
    }
    const { error } = await context.client.auth.signInWithPassword({ email, password: parsed.data.password });
    if (error) throw new DomainError(error.code === "email_not_confirmed" ? "VERIFIED_ACCOUNT_REQUIRED" : error.status === 429 ? "RATE_LIMITED" : "AUTH_FAILED");
    const account = await context.client.rpc("get_my_account");
    if (account.error) throw account.error;
    const current = accountSchema.safeParse(account.data);
    if (!current.success || !current.data.verified || current.data.is_guest) throw new DomainError("VERIFIED_ACCOUNT_REQUIRED");
    return context.finish(NextResponse.json({ data: { redirect_to: landingForRoles(current.data.roles) }, request_id: requestId }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}
