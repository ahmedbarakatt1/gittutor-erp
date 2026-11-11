import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { accountSchema } from './auth';
import { requestSupabase } from './supabase';
import { allowedOrigin, DomainError, readJson, safeError } from './http';
import { createDatabasePool, databaseUrl } from './database';
import { getCalendarConnectionRequest, invokeMeetingCommandWithStatus } from '../modules/teaching/meetings';
import { createProviderTokenCipher, type ProviderTokenKeys } from './provider-tokens';
import { createOAuthHandshake, readOAuthHandshake, googleAuthorizationUrl, exchangeGoogleCode } from './google-oauth';
import type { ServerConfig } from './config';

const cookieName = 'git_tutor_google_oauth', cookiePath = '/api/calendar';
let workerPool: Pool | undefined;
function keys(config: ServerConfig): ProviderTokenKeys { if (!config.secret_encryption_key) throw new DomainError('DEPENDENCY_UNAVAILABLE'); return { currentKeyId: config.secret_encryption_key_id, currentKey: config.secret_encryption_key, previousKeys: config.secret_encryption_previous_keys }; }
async function actor(client: ReturnType<typeof requestSupabase>['client']) {
  const result = await client.auth.getClaims(), parsed = z.object({ sub: z.uuid(), session_id: z.uuid() }).safeParse(result.data?.claims);
  if (result.error || !parsed.success) throw new DomainError('AUTH_REQUIRED');
  const current = await client.rpc('get_my_account'); if (current.error) throw new DomainError(safeError(current.error).code);
  const account = accountSchema.safeParse(current.data);
  if (!account.success || !account.data.verified || account.data.is_guest || !account.data.roles.includes('admin')) throw new DomainError('FORBIDDEN');
  return { actor_id: parsed.data.sub, session_id: parsed.data.session_id };
}
function secure(response: NextResponse) { response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response; }

export async function connectCalendar(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  try {
    transport = requestSupabase(request); const { client, config } = transport;
    if (!allowedOrigin(request.headers.get('origin'), config.app_base_url, config.isolated)) throw new DomainError('FORBIDDEN');
    const key = request.headers.get('Idempotency-Key'); if (!key || key.length > 200 || !z.object({}).strict().safeParse(await readJson(request)).success) throw new DomainError('VALIDATION_ERROR');
    const current = await actor(client);
    if (config.providers.calendar === 'fake') {
      await invokeMeetingCommandWithStatus(client, 'connect_fake_calendar', { p_idempotency_key: key });
      return transport.finish(secure(NextResponse.json({ data: { mode: 'fake', authorization_url: '/admin/integrations', expires_at: null } })));
    }
    if (!config.google) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const command = await invokeMeetingCommandWithStatus(client, 'create_calendar_connection_request', { p_idempotency_key: key });
    const created = z.object({ request_id: z.uuid(), connection_id: z.uuid(), expires_at: z.iso.datetime({ offset: true }) }).parse(command.data);
    const handshake = createOAuthHandshake(keys(config), { ...created, ...current });
    const response = NextResponse.json({ data: { mode: 'google', authorization_url: googleAuthorizationUrl(config.google, handshake), expires_at: created.expires_at } });
    response.cookies.set(cookieName, handshake.cookie, { httpOnly: true, secure: new URL(config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, expires: new Date(created.expires_at) });
    return transport.finish(secure(response));
  } catch (error) { const safe = safeError(error), response = secure(NextResponse.json({ error: safe }, { status: safe.status })); return transport ? transport.finish(response) : response; }
}

export async function completeCalendarConnection(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  try {
    transport = requestSupabase(request); const { client, config } = transport;
    if (!config.google || config.providers.calendar !== 'google') throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const current = await actor(client), state = request.nextUrl.searchParams.get('state') ?? '', cookie = request.cookies.get(cookieName)?.value ?? '';
    const pending = readOAuthHandshake(keys(config), cookie, state, current.actor_id, current.session_id);
    const authorized = await getCalendarConnectionRequest(client, pending.request_id);
    if (authorized.connection_id !== pending.connection_id || Date.parse(authorized.expires_at) <= Date.now() || request.nextUrl.searchParams.has('error')) throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const granted = await exchangeGoogleCode(config.google, request.nextUrl.searchParams.get('code') ?? '', pending.code_verifier);
    const credentialVersion = randomUUID(), envelope = createProviderTokenCipher(keys(config)).seal(granted.tokens, { provider: 'google', connection_id: pending.connection_id, credential_version: credentialVersion });
    workerPool ??= createDatabasePool(databaseUrl('worker'));
    // The private command consumes one request and rechecks its original current admin/session.
    const recorded = await workerPool.query('select app_private.record_calendar_connection($1,$2,$3,$4,$5,$6::jsonb,$7) data', [pending.request_id, pending.connection_id, credentialVersion, granted.organizer_email, config.google.calendar_id, JSON.stringify(envelope), envelope.kid]);
    if (recorded.rowCount !== 1 || !z.object({ connection_id: z.uuid(), version: z.number().int().positive(), integration_state: z.literal('verification_required') }).strict().safeParse(recorded.rows[0].data).success) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const response = secure(NextResponse.redirect(new URL('/admin/integrations?calendar=connected', config.app_base_url), 303));
    response.cookies.set(cookieName, '', { httpOnly: true, secure: new URL(config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, maxAge: 0 });
    return transport.finish(response);
  } catch (error) {
    const safe = safeError(error);
    if (!transport) return secure(NextResponse.json({ error: safe }, { status: safe.status }));
    const response = secure(NextResponse.redirect(new URL(`/admin/integrations?calendar=${safe.code === 'CALENDAR_AUTH_REQUIRED' ? 'reauthorize' : 'unavailable'}`, transport.config.app_base_url), 303));
    response.cookies.set(cookieName, '', { httpOnly: true, secure: new URL(transport.config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, maxAge: 0 });
    return transport.finish(response);
  }
}
