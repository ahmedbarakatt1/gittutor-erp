import 'server-only';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ServerConfig } from './config';
import type { ProviderTokenKeys, ProviderTokenPayload } from './provider-tokens';

type GoogleConfig = Pick<NonNullable<ServerConfig['google']>, 'client_id' | 'client_secret' | 'redirect_uri'>;
type Purpose = 'calendar' | 'request-drive';
export const requestDriveOwner = 'gittutor2@gmail.com';
const driveScope = 'https://www.googleapis.com/auth/drive.file';
const scope = z.object({ request_id: z.uuid(), connection_id: z.uuid(), actor_id: z.uuid(), session_id: z.uuid(), expires_at: z.iso.datetime({ offset: true }), calendar_source: z.enum(['primary','configured']).optional(), verify_room: z.literal(true).optional() }).strict();
const handshakeSchema = scope.extend({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_verifier: z.string().regex(/^[A-Za-z0-9_-]{64}$/) }).strict();
export const googleScopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'] as const;
function fail(): never { throw new Error('CALENDAR_AUTH_REQUIRED'); }
function equal(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function signingKey(keys: ProviderTokenKeys, id: string, purpose: Purpose) {
  const raw = id === keys.currentKeyId ? keys.currentKey : keys.previousKeys?.[id];
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !raw || !/^[a-f\d]{64}$/i.test(raw)) return fail();
  return Buffer.from(hkdfSync('sha256', Buffer.from(raw, 'hex'), `GitTutor/${purpose}-oauth/v1`, 'state-cookie', 32));
}
export function createOAuthHandshake(keys: ProviderTokenKeys, context: z.input<typeof scope>, purpose: Purpose = 'calendar') {
  const value = handshakeSchema.parse({ ...scope.parse(context), state: randomBytes(32).toString('base64url'), code_verifier: randomBytes(48).toString('base64url') });
  if (Date.parse(value.expires_at) <= Date.now() || Date.parse(value.expires_at) > Date.now() + 630000) return fail();
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url'), input = `${keys.currentKeyId}.${payload}`;
  const signature = createHmac('sha256', signingKey(keys, keys.currentKeyId, purpose)).update(input).digest('base64url');
  return { state: value.state, code_challenge: createHash('sha256').update(value.code_verifier).digest('base64url'), cookie: `${input}.${signature}`, expires_at: value.expires_at };
}
export function readOAuthHandshake(keys: ProviderTokenKeys, raw: string, state: string, actorId: string, sessionId: string, now = Date.now(), purpose: Purpose = 'calendar') {
  try {
    if (raw.length > 4096) return fail();
    const parts = raw.split('.'); if (parts.length !== 3) return fail();
    const [id, payload, signature] = parts, expected = createHmac('sha256', signingKey(keys, id, purpose)).update(`${id}.${payload}`).digest('base64url');
    if (!equal(signature, expected)) return fail();
    const parsed = handshakeSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!equal(parsed.state, state) || parsed.actor_id !== actorId || parsed.session_id !== sessionId || Date.parse(parsed.expires_at) <= now) return fail();
    return parsed;
  } catch { return fail(); }
}
export function googleAuthorizationUrl(config: GoogleConfig, handshake: { state: string; code_challenge: string }, purpose: Purpose = 'calendar') {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.client_id, redirect_uri: config.redirect_uri, response_type: 'code', scope: (purpose === 'calendar' ? googleScopes : ['openid', 'email', driveScope]).join(' '), ...(purpose === 'request-drive' && { login_hint: requestDriveOwner }), access_type: 'offline', prompt: 'select_account consent', state: handshake.state, code_challenge: handshake.code_challenge, code_challenge_method: 'S256' }).toString();
  return url.toString();
}
async function providerJson(response: Response, detectRevokedDriveGrant = false) {
  if (!response.ok && !(detectRevokedDriveGrant && response.status === 400)) {
    if ([400, 401, 403].includes(response.status)) return fail();
    throw new Error('DEPENDENCY_UNAVAILABLE');
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error('DEPENDENCY_UNAVAILABLE');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 65536) { await reader.cancel(); throw new Error('DEPENDENCY_UNAVAILABLE'); } chunks.push(item.value); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('DEPENDENCY_UNAVAILABLE'); }
  if (!response.ok) {
    if (z.object({ error: z.literal('invalid_grant') }).safeParse(parsed).success) throw new Error('DRIVE_REAUTH_REQUIRED');
    throw new Error('DEPENDENCY_UNAVAILABLE');
  }
  return parsed;
}
const tokenResponse = z.object({ access_token: z.string().min(1).max(16384), refresh_token: z.string().min(1).max(16384).optional(), expires_in: z.number().int().positive().max(86400), scope: z.string().max(8192).optional() });
function permitted(scopes: string[], purpose: Purpose) {
  const normalized = scopes.map(value => value === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : value);
  if (purpose === 'calendar') return googleScopes.every(value => normalized.includes(value));
  const required = ['openid', 'email', driveScope];
  return required.every(value => normalized.includes(value)) && normalized.every(value => required.includes(value));
}
export async function exchangeGoogleCode(config: GoogleConfig, code: string, verifier: string, http: typeof fetch = fetch, purpose: Purpose = 'calendar') {
  if (!code || code.length > 4096 || !verifier || verifier.length > 128) return fail();
  const response = tokenResponse.parse(await providerJson(await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: config.client_id, client_secret: config.client_secret, redirect_uri: config.redirect_uri }), signal: AbortSignal.timeout(10000), redirect: 'error' })));
  const scopes = response.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (!response.refresh_token || !permitted(scopes, purpose)) return fail();
  const identity = z.object({ sub: z.string().min(1).max(255).regex(/^[!-~]+$/), email: z.email().max(254), email_verified: z.literal(true) }).safeParse(await providerJson(await http('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${response.access_token}` }, signal: AbortSignal.timeout(10000), redirect: 'error' })));
  if (!identity.success || (purpose === 'request-drive' && identity.data.email.toLowerCase() !== requestDriveOwner)) return fail();
  return { google_subject: identity.data.sub, organizer_email: identity.data.email, tokens: { refresh_token: response.refresh_token, access_token: response.access_token, scopes, expires_at: new Date(Date.now() + response.expires_in * 1000).toISOString() } satisfies ProviderTokenPayload };
}
export async function refreshGoogleAccessToken(config: GoogleConfig, current: ProviderTokenPayload, http: typeof fetch = fetch, purpose: Purpose = 'calendar'): Promise<ProviderTokenPayload> {
  if (purpose === 'request-drive' && !permitted(current.scopes, purpose)) return fail();
  if (current.access_token && current.expires_at && Date.parse(current.expires_at) > Date.now() + 60000) return current;
  const response = tokenResponse.parse(await providerJson(await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh_token, client_id: config.client_id, client_secret: config.client_secret }), signal: AbortSignal.timeout(10000), redirect: 'error' }), purpose === 'request-drive'));
  const scopes = response.scope?.split(/\s+/).filter(Boolean) ?? current.scopes; if (!permitted(scopes, purpose)) return fail();
  return { refresh_token: response.refresh_token ?? current.refresh_token, access_token: response.access_token, scopes, expires_at: new Date(Date.now() + response.expires_in * 1000).toISOString() };
}
