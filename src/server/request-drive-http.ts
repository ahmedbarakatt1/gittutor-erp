import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requestSupabase } from './supabase';
import { allowedOrigin, DomainError, safeError } from './http';
import { createOAuthHandshake, exchangeGoogleCode, googleAuthorizationUrl, readOAuthHandshake } from './google-oauth';
import { createProviderTokenCipher } from './provider-tokens';
import { requestDriveDatabase, requestDriveKeys } from './request-drive-auth';

const callbackPath = '/api/drive/google/callback';
const cookieName = 'git_tutor_request_drive_oauth';
const ownerContext = z.object({
  can_connect: z.literal(true), actor_id: z.uuid(), session_id: z.uuid(), connection_id: z.uuid(), consent_version: z.uuid(),
});
async function owner(transport: ReturnType<typeof requestSupabase>) {
  const status = await transport.client.rpc('get_request_drive_status');
  if (status.error) throw new DomainError(safeError(status.error).code);
  const result = ownerContext.safeParse(status.data);
  if (!result.success) throw new DomainError('FORBIDDEN');
  return result.data;
}
function secure(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
function outcome(base: string, result: string) {
  return secure(NextResponse.redirect(new URL('/admin/integrations?drive=' + result, base), 303));
}

export async function connectRequestDrive(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  try {
    transport = requestSupabase(request);
    const { config } = transport;
    if (!allowedOrigin(request.headers.get('origin'), config.app_base_url, config.isolated)) throw new DomainError('FORBIDDEN');
    if (!config.request_drive) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const current = await owner(transport);
    const expires_at = new Date(Date.now() + 600000).toISOString();
    const handshake = createOAuthHandshake(requestDriveKeys(config), { request_id: current.consent_version,
      connection_id: current.connection_id, actor_id: current.actor_id, session_id: current.session_id, expires_at }, 'request-drive');
    const response = secure(NextResponse.redirect(googleAuthorizationUrl(config.request_drive, handshake, 'request-drive'), 303));
    response.cookies.set(cookieName, handshake.cookie, { httpOnly: true, secure: new URL(config.app_base_url).protocol === 'https:', sameSite: 'lax', path: callbackPath, expires: new Date(expires_at) });
    return transport.finish(response);
  } catch (error) {
    const safe = safeError(error);
    if (transport && safe.status >= 500) return transport.finish(outcome(transport.config.app_base_url, 'unavailable'));
    const response = secure(NextResponse.json({ error: safe }, { status: safe.status }));
    return transport ? transport.finish(response) : response;
  }
}

export async function completeRequestDrive(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  let result = 'consent_failed';
  try {
    transport = requestSupabase(request);
    const { config } = transport;
    if (!config.request_drive) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const current = await owner(transport);
    const pending = readOAuthHandshake(requestDriveKeys(config), request.cookies.get(cookieName)?.value ?? '',
      request.nextUrl.searchParams.get('state') ?? '', current.actor_id, current.session_id, Date.now(), 'request-drive');
    if (pending.connection_id !== current.connection_id || pending.request_id !== current.consent_version ||
        request.nextUrl.searchParams.has('error')) throw new DomainError('CONSENT_REQUIRED');
    const granted = await exchangeGoogleCode(config.request_drive, request.nextUrl.searchParams.get('code') ?? '',
      pending.code_verifier, fetch, 'request-drive');
    const version = randomUUID();
    const sealed = createProviderTokenCipher(requestDriveKeys(config)).seal(granted.tokens, {
      provider: 'request-drive', connection_id: current.connection_id, credential_version: version,
    });
    await requestDriveDatabase().query('select app_private.record_request_drive_grant($1,$2,$3,$4,$5,$6,$7::jsonb)', [
      current.actor_id, current.session_id, pending.request_id, version, granted.organizer_email, granted.google_subject, sealed,
    ]);
    result = 'connected';
  } catch (error) {
    if (!transport) {
      const safe = safeError(error);
      return secure(NextResponse.json({ error: safe }, { status: safe.status }));
    }
  }
  const response = outcome(transport.config.app_base_url, result);
  response.cookies.set(cookieName, '', { httpOnly: true, secure: new URL(transport.config.app_base_url).protocol === 'https:', sameSite: 'lax', path: callbackPath, maxAge: 0 });
  return transport.finish(response);
}
