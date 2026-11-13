import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowOperations, reviewWorkflowOperation } from '@/modules/workflow-import/operational-queries';
import { requestSupabase } from '@/server/supabase';
import { allowedOrigin, DomainError, readJson, safeError } from '@/server/http';

export const runtime = 'nodejs';
async function handle(request: NextRequest) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    if (request.nextUrl.searchParams.size) throw new DomainError('VALIDATION_ERROR');
    context = requestSupabase(request);
    const claims = await context.client.auth.getClaims();
    if (claims.error || !claims.data?.claims.sub) throw new DomainError('AUTH_REQUIRED');
    let data: unknown;
    if (request.method === 'GET') data = await getWorkflowOperations(context.client);
    else {
      if (!allowedOrigin(request.headers.get('origin'), context.config.app_base_url, context.config.isolated)) throw new DomainError('FORBIDDEN');
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('VALIDATION_ERROR');
      const input = body as Record<string, unknown>;
      const key = request.headers.get('Idempotency-Key') || input.idempotency_key;
      if (input.idempotency_key !== undefined && input.idempotency_key !== key) throw new DomainError('VALIDATION_ERROR');
      data = await reviewWorkflowOperation(context.client, { ...input, idempotency_key: key });
    }
    return context.finish(NextResponse.json({ data, request_id: requestId }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { 'Cache-Control': 'private, no-store' } });
    return context ? context.finish(response) : response;
  }
}
export const GET = handle;
export const POST = handle;
