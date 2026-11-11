import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { accountSchema } from "@/server/auth";
import { DomainError, safeError } from "@/server/http";

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    if (request.nextUrl.searchParams.size) throw new DomainError("VALIDATION_ERROR");
    context = requestSupabase(request);
    const { data, error } = await context.client.auth.getClaims();
    if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
    const result = await context.client.rpc("get_my_account");
    if (result.error) throw result.error;
    const account = result.data?.is_guest === true ? { is_guest: true } : accountSchema.parse(result.data);
    return context.finish(NextResponse.json({ data: account, request_id: requestId }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}
