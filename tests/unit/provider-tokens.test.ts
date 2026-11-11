import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createProviderTokenCipher } from '../../src/server/provider-tokens';

const keys = { currentKeyId: 'v1', currentKey: 'a'.repeat(64) };
const context = { provider: 'google' as const, connection_id: randomUUID(), credential_version: randomUUID() };
const tokens = { refresh_token: 'synthetic-refresh-token', access_token: 'synthetic-access-token', scopes: ['openid', 'email'] };

test('provider credentials round-trip with fresh nonces and exact connection/version binding', () => {
  const cipher = createProviderTokenCipher(keys), sealed = cipher.seal(tokens, context);
  expect(cipher.open(sealed, context)).toEqual(tokens);
  expect(cipher.seal(tokens, context).nonce).not.toBe(sealed.nonce);
  expect(JSON.stringify(sealed)).not.toContain('synthetic');
  for (const changed of [{ ...context, connection_id: randomUUID() }, { ...context, credential_version: randomUUID() }]) expect(() => cipher.open(sealed, changed)).toThrow('PROVIDER_CREDENTIALS_UNAVAILABLE');
  expect(() => cipher.open({ ...sealed, tag: 'a'.repeat(22) }, context)).toThrow('PROVIDER_CREDENTIALS_UNAVAILABLE');
});

test('provider credential rotation reads old records and rejects malformed secrets safely', () => {
  const sealed = createProviderTokenCipher(keys).seal(tokens, context);
  const rotated = createProviderTokenCipher({ currentKeyId: 'v2', currentKey: 'b'.repeat(64), previousKeys: { v1: keys.currentKey } });
  expect(rotated.open(sealed, context)).toEqual(tokens);
  expect(rotated.seal(tokens, context).kid).toBe('v2');
  expect(() => createProviderTokenCipher({ ...keys, currentKey: 'private-invalid' })).toThrow('PROVIDER_CONFIGURATION_REQUIRED');
  expect(() => rotated.seal({ ...tokens, refresh_token: '' }, context)).toThrow('VALIDATION_ERROR');
});
