import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createOAuthHandshake, readOAuthHandshake, googleAuthorizationUrl, exchangeGoogleCode, refreshGoogleAccessToken,
} from '../../src/server/google-oauth';
import { createProviderTokenCipher } from '../../src/server/provider-tokens';
import { parseServerConfig, publicConfig } from '../../src/server/config';

const owner = 'gittutor2@gmail.com';
const drive = 'https://www.googleapis.com/auth/drive.file';
const config = { client_id: 'test', client_secret: 'secret', redirect_uri: 'https://example.test/api/drive/google/callback' };
const keys = { currentKeyId: 'test', currentKey: 'a'.repeat(64) };
const context = { request_id: randomUUID(), actor_id: randomUUID(), session_id: randomUUID(), connection_id: randomUUID(), expires_at: new Date(Date.now() + 600000).toISOString() };
const grant = { refresh_token: 'test-refresh', access_token: 'test-access', expires_in: 3600, scope: `openid https://www.googleapis.com/auth/userinfo.email ${drive}` };
const identity = { email: owner, email_verified: true, sub: 'example-owner-sub' };

test('Drive can be configured independently and exposes no credentials in public configuration', () => {
  expect(parseServerConfig({ APP_ENV: 'test' }).request_drive).toBeNull();
  expect(() => parseServerConfig({ APP_ENV: 'test', REQUEST_DRIVE_ADAPTER: 'google' })).toThrow('GOOGLE_OAUTH_CLIENT_ID');
  const parsed = parseServerConfig({ APP_ENV: 'test', REQUEST_DRIVE_ADAPTER: 'google', SECRET_ENCRYPTION_KEY: keys.currentKey,
    APP_BASE_URL: 'https://example.test', GOOGLE_OAUTH_CLIENT_ID: config.client_id, GOOGLE_OAUTH_CLIENT_SECRET: config.client_secret });
  expect(parsed.google).toBeNull();
  expect(parsed.request_drive).toEqual(config);
  expect(publicConfig(parsed)).toEqual({ supabase_url: null, supabase_publishable_key: null });
});

test('Drive consent binds state and encrypted credentials to a distinct purpose', () => {
  const handshake = createOAuthHandshake(keys, context, 'request-drive');
  expect(readOAuthHandshake(keys, handshake.cookie, handshake.state, context.actor_id, context.session_id, Date.now(), 'request-drive').request_id).toBe(context.request_id);
  expect(() => readOAuthHandshake(keys, handshake.cookie, handshake.state, context.actor_id, context.session_id)).toThrow();
  const url = new URL(googleAuthorizationUrl(config, handshake, 'request-drive'));
  expect(url.searchParams.get('scope')).toBe(`openid email ${drive}`);
  expect(url.searchParams.get('login_hint')).toBe(owner);
  expect(url.searchParams.get('redirect_uri')).toBe(config.redirect_uri);
  const cipher = createProviderTokenCipher(keys);
  const bound = { connection_id: context.connection_id, credential_version: randomUUID() };
  const sealed = cipher.seal({ refresh_token: 'test-refresh', scopes: [drive] }, { ...bound, provider: 'request-drive' });
  expect(() => cipher.open(sealed, { ...bound, provider: 'google' })).toThrow();
});

test('Drive accepts the verified owner, refusing another identity, partial consent and excess scopes', async () => {
  function provider(scopes: string, who = identity): typeof fetch {
    return async url => Response.json(String(url).endsWith('/token') ? { ...grant, scope: scopes } : who);
  }
  expect(await exchangeGoogleCode(config, 'code', 'verifier', provider(grant.scope), 'request-drive')).toMatchObject({ organizer_email: owner, google_subject: identity.sub });
  for (const [scopes, who] of [
    ['openid email', identity], [grant.scope + ' https://www.googleapis.com/auth/calendar.events', identity],
    [grant.scope, { ...identity, email: 'other@example.test' }], [grant.scope, { ...identity, email_verified: false }],
  ] as const) {
    await expect(exchangeGoogleCode(config, 'code', 'verifier', provider(scopes, who), 'request-drive')).rejects.toThrow();
  }
  await expect(refreshGoogleAccessToken(config, { refresh_token: 'token', scopes: ['openid', 'email', drive] },
    provider(grant.scope + ' https://www.googleapis.com/auth/drive'), 'request-drive')).rejects.toThrow();
});
