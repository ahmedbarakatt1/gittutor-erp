import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { authRedirectBase, isAuthTokenHash } from "@/server/http";

export async function GET(request: NextRequest) {
  const context = requestSupabase(request);
  const base = authRedirectBase(request.url, context.config.app_base_url, context.config.isolated, request.headers.get("host"));
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const invitation = request.nextUrl.searchParams.get("staff_invitation_id");
  if (tokenHash && isAuthTokenHash(tokenHash) && (type === "invite" || type === "email")) {
    const { error } = await context.client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const destination = new URL(type === "invite" ? "/auth/set-password" : "/learn", base);
      if (invitation && /^[a-f0-9-]{36}$/i.test(invitation)) destination.searchParams.set("staff_invitation_id", invitation);
      return context.finish(NextResponse.redirect(destination));
    }
  }
  if (code && code.length <= 4096) {
    const { error } = await context.client.auth.exchangeCodeForSession(code);
    if (!error) return context.finish(NextResponse.redirect(new URL("/learn", base)));
  }
  return context.finish(NextResponse.redirect(new URL("/login?reason=verification", base)));
}
