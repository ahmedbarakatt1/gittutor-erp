import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { invokeRequestCommand, type RequestCommandName } from '@/modules/requests/commands';
import { getTutoringRequest, listRequestMatches, listRequestQueue, listRequests } from '@/modules/requests/queries';
import { allowedOrigin, DomainError, readJson, safeError } from '@/server/http';
import { requestSupabase } from '@/server/supabase';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const actions = new Map<string, RequestCommandName>([
  ['update', 'update_tutoring_request'],
  ['submit', 'submit_tutoring_request'],
  ['review', 'review_tutoring_request'],
  ['remove-file', 'remove_tutoring_request_file'],
]);

async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  let scoped: ReturnType<typeof requestSupabase> | undefined;
  const requestId = randomUUID();
  try {
    scoped = requestSupabase(request);
    const { client, config } = scoped;
    const { data: claims, error } = await client.auth.getClaims();
    if (error || !claims?.claims.sub) throw new DomainError('AUTH_REQUIRED');
    const path = (await context.params).path ?? [];
    const params = request.nextUrl.searchParams;
    let data: unknown;
    let status = 200;
    if (request.method === 'GET') {
      const isQueue = path.length === 1 && path[0] === 'queue';
      const isMatchList = path.length === 2 && path[1] === 'matches';
      if (!path.length || isQueue || isMatchList) {
        if ([...params.keys()].some(key => !['cursor', 'limit'].includes(key) || params.getAll(key).length !== 1)) throw new DomainError('VALIDATION_ERROR');
        const options = { cursor: params.get('cursor'), limit: params.has('limit') ? Number(params.get('limit')) : undefined };
        data = isMatchList ? await listRequestMatches(client, path[0], options) : await (isQueue ? listRequestQueue : listRequests)(client, options);
      } else if (path.length === 1 && !params.size) {
        data = await getTutoringRequest(client, path[0]);
      } else {
        throw new DomainError('NOT_FOUND');
      }
    } else {
      if (!allowedOrigin(request.headers.get('origin'), config.app_base_url, config.isolated)) throw new DomainError('FORBIDDEN');
      const key = request.headers.get('Idempotency-Key');
      if (params.size || !key) throw new DomainError('VALIDATION_ERROR');
      const action = !path.length ? 'create_tutoring_request' : path.length === 2 ? actions.get(path[1]) : undefined;
      if (!action) throw new DomainError('NOT_FOUND');
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || 'request_id' in body || 'idempotency_key' in body) throw new DomainError('VALIDATION_ERROR');
      const args = Object.fromEntries(Object.entries(body).map(([key, value]) => [`p_${key}`, value]));
      args.p_idempotency_key = key;
      if (path.length) args.p_request_id = path[0];
      ({ data, status } = await invokeRequestCommand(client, action, args));
    }
    return scoped.finish(NextResponse.json({ data, request_id: requestId }, { status, headers }));
  } catch (error) {
    const { status, ...safe } = safeError(error);
    const response = NextResponse.json({ ...safe, request_id: requestId }, { status, headers });
    return scoped ? scoped.finish(response) : response;
  }
}

export const GET = handle;
export const POST = handle;
