import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowImport } from '@/modules/workflow-import/queries';
import { requestSupabase } from '@/server/supabase';
import { DomainError, safeError } from '@/server/http';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    if (request.nextUrl.searchParams.size) throw new DomainError('VALIDATION_ERROR');
    context = requestSupabase(request);
    const claims = await context.client.auth.getClaims();
    if (claims.error || !claims.data?.claims.sub) throw new DomainError('AUTH_REQUIRED');
    return context.finish(NextResponse.json({ data: await getWorkflowImport(context.client), request_id: requestId }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { 'Cache-Control': 'private, no-store' } });
    return context ? context.finish(response) : response;
  }
}
