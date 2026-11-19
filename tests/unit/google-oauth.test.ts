import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createOAuthHandshake, readOAuthHandshake, googleAuthorizationUrl, exchangeGoogleCode } from '../../src/server/google-oauth';

const keys = { currentKeyId: 'v1', currentKey: 'a'.repeat(64) };
const context = { request_id: randomUUID(), connection_id: randomUUID(), actor_id: randomUUID(), session_id: randomUUID(), expires_at: new Date(Date.now() + 600000).toISOString() };
const config = { client_id: 'synthetic-id', client_secret: 'synthetic-secret', redirect_uri: 'http://localhost:3000/api/calendar/google/callback', calendar_id: 'synthetic@example.test' };

test('OAuth state binds original actor/session, expiry and PKCE without disclosing the verifier in the URL', () => {
  const handshake = createOAuthHandshake(keys, context);
  const current = readOAuthHandshake(keys, handshake.cookie, handshake.state, context.actor_id, context.session_id);
  const url = new URL(googleAuthorizationUrl(config, handshake));
  expect(url.origin).toBe('https://accounts.google.com'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('prompt')?.split(' ')).toEqual(expect.arrayContaining(['select_account', 'consent']));
  expect(url.searchParams.get('state')).toBe(handshake.state); expect(url.toString()).not.toContain(current.code_verifier);
  expect(url.toString()).not.toContain(config.client_secret);
  for (const [state, actor, session, now] of [['wrong', context.actor_id, context.session_id, Date.now()], [handshake.state, randomUUID(), context.session_id, Date.now()], [handshake.state, context.actor_id, randomUUID(), Date.now()], [handshake.state, context.actor_id, context.session_id, Date.now() + 700000]] as const) expect(() => readOAuthHandshake(keys, handshake.cookie, state, actor, session, now)).toThrow('CALENDAR_AUTH_REQUIRED');
});

test('code exchange uses the bound verifier and requires verified organizer and all granted scopes', async () => {
  const calls: string[] = [];
  const http: typeof fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('/token')) { expect(new URLSearchParams(String(options?.body)).get('code_verifier')).toBe('bound-verifier'); return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events' }); }
    return Response.json({ sub: 'synthetic-organizer', email: 'organizer@example.test', email_verified: true });
  };
  expect(await exchangeGoogleCode(config, 'synthetic-code', 'bound-verifier', http)).toMatchObject({ google_subject: 'synthetic-organizer', organizer_email: 'organizer@example.test', tokens: { refresh_token: 'synthetic-refresh' } });
  expect(calls).toEqual(['https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo']);
  await expect(exchangeGoogleCode(config, 'code', 'verifier', async () => Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'openid email' }))).rejects.toThrow('CALENDAR_AUTH_REQUIRED');
});

test.each([
  { email: 'organizer@example.test', email_verified: true },
  { sub: ' ', email: 'organizer@example.test', email_verified: true },
  { sub: 'synthetic-organizer', email: 'organizer@example.test', email_verified: false },
])('refuses incomplete or unverified Google account identity', async identity => {
  const mockFetch: typeof fetch = async url => Response.json(String(url).endsWith('/token') ? {
    access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600,
    scope: 'openid email https://www.googleapis.com/auth/calendar.events',
  } : identity);
  await expect(exchangeGoogleCode(config, 'code', 'verifier', mockFetch)).rejects.toThrow('CALENDAR_AUTH_REQUIRED');
});
