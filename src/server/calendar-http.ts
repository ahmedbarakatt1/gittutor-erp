import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { accountSchema } from './auth';
import { requestSupabase } from './supabase';
import { allowedOrigin, DomainError, readJson, safeError } from './http';
import { createDatabasePool, databaseUrl } from './database';
import { getCalendarConnectionRequest, listCalendarConnections, invokeMeetingCommandWithStatus } from '../modules/teaching/meetings';
import { createProviderTokenCipher, type ProviderTokenKeys } from './provider-tokens';
import { createOAuthHandshake, readOAuthHandshake, googleAuthorizationUrl, exchangeGoogleCode } from './google-oauth';
import type { ServerConfig } from './config';

const legacyCookieName = 'git_tutor_google_oauth', cookiePath = '/api/calendar';
function stateCookieName(state: string) { return `${legacyCookieName}_${state}`; }
const connectInput = z.union([
  z.object({ action: z.literal('add') }).strict(),
  z.object({ action: z.literal('reconnect'), connection_id: z.uuid(), expected_version: z.int().positive().max(2147483647) }).strict(),
  z.object({}).strict().transform(() => ({ action: 'legacy' as const })),
]);
type ConnectInput = z.output<typeof connectInput>;
let workerPool: Pool | undefined;
function keys(config: ServerConfig): ProviderTokenKeys { if (!config.secret_encryption_key) throw new DomainError('DEPENDENCY_UNAVAILABLE'); return { currentKeyId: config.secret_encryption_key_id, currentKey: config.secret_encryption_key, previousKeys: config.secret_encryption_previous_keys }; }
async function actor(client: ReturnType<typeof requestSupabase>['client']) {
  const result = await client.auth.getClaims(), parsed = z.object({ sub: z.uuid(), session_id: z.uuid() }).safeParse(result.data?.claims);
  if (result.error || !parsed.success) throw new DomainError('AUTH_REQUIRED');
  const current = await client.rpc('get_my_account'); if (current.error) throw new DomainError(safeError(current.error).code);
  const account = accountSchema.safeParse(current.data);
  if (!account.success || account.data.account_id !== parsed.data.sub || !account.data.verified || account.data.is_guest || !account.data.roles.includes('admin')) throw new DomainError('FORBIDDEN');
  return { actor_id: parsed.data.sub, session_id: parsed.data.session_id };
}
function secure(response: NextResponse) { response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response; }

async function legacyGoogleTarget(client: ReturnType<typeof requestSupabase>['client']): Promise<ConnectInput> {
  const organizers = (await listCalendarConnections(client)).filter(connection => connection.mode === 'google');
  const current = organizers.filter(connection => connection.state !== 'revoked');
  const candidates = current.length ? current : organizers;
  if (candidates.length > 1) throw new DomainError('STATE_CONFLICT');
  const target = candidates[0];
  return target ? { action: 'reconnect', connection_id: target.connection_id, expected_version: target.version } : { action: 'legacy' };
}

export async function connectCalendar(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  try {
    transport = requestSupabase(request); const { client, config } = transport;
    if (!allowedOrigin(request.headers.get('origin'), config.app_base_url, config.isolated)) throw new DomainError('FORBIDDEN');
    const key = request.headers.get('Idempotency-Key');
    const input = connectInput.safeParse(await readJson(request));
    if (!key || key.length > 200 || !input.success) throw new DomainError('VALIDATION_ERROR');
    const current = await actor(client);
    const mode = config.providers.calendar;
    const target = input.data.action === 'legacy' && mode === 'google' ? await legacyGoogleTarget(client) : input.data;
    const args = target.action === 'reconnect'
      ? { p_connection_id: target.connection_id, p_expected_version: target.expected_version, p_idempotency_key: key }
      : { p_idempotency_key: key };
    if (mode === 'fake') {
      if (!config.isolated) throw new DomainError('FORBIDDEN');
      const rpc = { add: 'add_fake_calendar_organizer', reconnect: 'reconnect_fake_calendar_organizer', legacy: 'connect_fake_calendar' }[target.action];
      await invokeMeetingCommandWithStatus(client, rpc, args);
      return transport.finish(secure(NextResponse.json({ data: { mode: 'fake', authorization_url: '/admin/integrations', expires_at: null } })));
    }
    if (!config.google) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const rpc = target.action === 'reconnect' ? 'create_calendar_reconnection_request' : 'create_calendar_connection_request';
    const command = await invokeMeetingCommandWithStatus(client, rpc, args);
    const created = z.object({ request_id: z.uuid(), connection_id: z.uuid(), expires_at: z.iso.datetime({ offset: true }) }).parse(command.data);
    if (target.action === 'reconnect' && target.connection_id !== created.connection_id) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const handshake = createOAuthHandshake(keys(config), { ...created, ...current, calendar_source: target.action === 'legacy' ? 'configured' : 'primary' });
    const response = NextResponse.json({ data: { mode: 'google', authorization_url: googleAuthorizationUrl(config.google, handshake), expires_at: created.expires_at } });
    response.cookies.set(stateCookieName(handshake.state), handshake.cookie, { httpOnly: true, secure: new URL(config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, expires: new Date(created.expires_at) });
    return transport.finish(secure(response));
  } catch (error) { const safe = safeError(error), response = secure(NextResponse.json({ error: safe }, { status: safe.status })); return transport ? transport.finish(response) : response; }
}

export async function completeCalendarConnection(request: NextRequest) {
  let transport: ReturnType<typeof requestSupabase> | undefined;
  let consumedCookieName: string | undefined;
  try {
    transport = requestSupabase(request); const { client, config } = transport;
    if (!config.google || config.providers.calendar !== 'google') throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const current = await actor(client), state = request.nextUrl.searchParams.get('state') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const cookie = request.cookies.get(stateCookieName(state)) ?? request.cookies.get(legacyCookieName);
    if (!cookie) throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const pending = readOAuthHandshake(keys(config), cookie.value, state, current.actor_id, current.session_id);
    consumedCookieName = cookie.name;
    const authorized = await getCalendarConnectionRequest(client, pending.request_id);
    if (authorized.connection_id !== pending.connection_id || Date.parse(authorized.expires_at) <= Date.now() || request.nextUrl.searchParams.has('error')) throw new DomainError('CALENDAR_AUTH_REQUIRED');
    const granted = await exchangeGoogleCode(config.google, request.nextUrl.searchParams.get('code') ?? '', pending.code_verifier);
    const credentialVersion = randomUUID(), envelope = createProviderTokenCipher(keys(config)).seal(granted.tokens, { provider: 'google', connection_id: pending.connection_id, credential_version: credentialVersion });
    workerPool ??= createDatabasePool(databaseUrl('worker'));
    // The private command consumes one request and rechecks its original current admin/session.
    const calendarId = pending.calendar_source === 'primary' ? 'primary' : config.google.calendar_id;
    const recorded = await workerPool.query('select app_private.record_calendar_organizer($1,$2,$3,$4,$5,$6::jsonb,$7,$8) data', [
      pending.request_id, pending.connection_id, credentialVersion, granted.organizer_email, calendarId, JSON.stringify(envelope), envelope.kid, granted.google_subject,
    ]);
    if (recorded.rowCount !== 1 || !z.object({ connection_id: z.literal(pending.connection_id), version: z.number().int().positive(), integration_state: z.literal('verification_required') }).strict().safeParse(recorded.rows[0].data).success) throw new DomainError('DEPENDENCY_UNAVAILABLE');
    const response = secure(NextResponse.redirect(new URL('/admin/integrations?calendar=connected', config.app_base_url), 303));
    response.cookies.set(consumedCookieName, '', { httpOnly: true, secure: new URL(config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, maxAge: 0 });
    return transport.finish(response);
  } catch (error) {
    const safe = safeError(error);
    if (!transport) return secure(NextResponse.json({ error: safe }, { status: safe.status }));
    const status = { CALENDAR_AUTH_REQUIRED: 'reauthorize', STATE_CONFLICT: 'conflict', VERSION_CONFLICT: 'stale' }[safe.code] ?? 'unavailable';
    const response = secure(NextResponse.redirect(new URL(`/admin/integrations?calendar=${status}`, transport.config.app_base_url), 303));
    if (consumedCookieName) response.cookies.set(consumedCookieName, '', { httpOnly: true, secure: new URL(transport.config.app_base_url).protocol === 'https:', sameSite: 'lax', path: cookiePath, maxAge: 0 });
    return transport.finish(response);
  }
}
