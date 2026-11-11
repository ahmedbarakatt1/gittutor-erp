import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createIdentifierCipher, normalizeIdentifier, type IdentifierKeys } from '../../src/server/private-identifiers';

const context = () => ({ purpose: 'refund_destination' as const, channel: 'instapay' as const, parent_id: randomUUID(), destination_id: randomUUID(), owner_account_id: randomUUID(), identifier_version: 1 as const });
const ring = () => ({ currentKeyId: 'test-v1', currentKey: randomBytes(32).toString('hex'), previousKeys: {} });

test('private identifiers use fresh authenticated ciphertext and canonical masked metadata', () => {
  const cipher = createIdentifierCipher(ring()), scope = context(), first = cipher.seal('  synthetic.payer@instapay  ', scope), second = cipher.seal('synthetic.payer@instapay', scope);
  expect(first.encrypted_identifier.nonce).not.toBe(second.encrypted_identifier.nonce);
  expect(first.encrypted_identifier.ciphertext).not.toBe(second.encrypted_identifier.ciphertext);
  expect(first.identifier_fingerprint).toBe(second.identifier_fingerprint);
  expect(first.masked_identifier).toBe('•••• apay');
  expect(cipher.open(first.encrypted_identifier, scope)).toEqual({ identifier: 'synthetic.payer@instapay', masked_identifier: first.masked_identifier, identifier_fingerprint: first.identifier_fingerprint });
  expect(JSON.stringify(first)).not.toContain('synthetic.payer');
  expect(JSON.stringify(cipher)).toBe('{}');
});

test('ciphertext cannot move between owners, refunds, destinations, channels or purposes', () => {
  const cipher = createIdentifierCipher(ring()), scope = context(), saved = cipher.seal('synthetic-01001234567', scope);
  for (const changed of [
    { owner_account_id: randomUUID() }, { parent_id: randomUUID() }, { destination_id: randomUUID() },
    { channel: 'vodafone_cash' as const }, { purpose: 'tutor_payout_destination' as const },
  ]) expect(() => cipher.open(saved.encrypted_identifier, { ...scope, ...changed })).toThrow('PRIVATE_IDENTIFIER_UNAVAILABLE');
});

test('tampered or noncanonical envelopes fail without exposing the identifier', () => {
  const cipher = createIdentifierCipher(ring()), scope = context(), saved = cipher.seal('synthetic-private-destination', scope).encrypted_identifier;
  const altered = (value: string) => `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
  for (const envelope of [
    { ...saved, ciphertext: altered(saved.ciphertext) }, { ...saved, tag: altered(saved.tag) }, { ...saved, nonce: altered(saved.nonce) },
    { ...saved, kid: 'unknown' }, { ...saved, ciphertext: `${saved.ciphertext}=` }, { ...saved, ciphertext: 'A'.repeat(1025) },
    { ...saved, extra: 'untrusted' }, { ...saved, alg: 'AES-CBC' }, { ...saved, tag: saved.tag.slice(0, -1) },
  ]) expect(() => cipher.open(envelope, scope)).toThrow('PRIVATE_IDENTIFIER_UNAVAILABLE');
});

test('rotation reads immutable old records but all new ciphertext uses the current key', () => {
  const old = ring(), scope = context(), saved = createIdentifierCipher(old).seal('synthetic-rotation-record', scope);
  const rotated = createIdentifierCipher({ currentKeyId: 'test-v2', currentKey: randomBytes(32).toString('hex'), previousKeys: { [old.currentKeyId]: old.currentKey } });
  expect(rotated.open(saved.encrypted_identifier, scope).identifier_fingerprint).toBe(saved.identifier_fingerprint);
  expect(rotated.seal('synthetic-rotation-record', scope).encrypted_identifier.kid).toBe('test-v2');
  expect(() => createIdentifierCipher(ring()).open(saved.encrypted_identifier, scope)).toThrow('PRIVATE_IDENTIFIER_UNAVAILABLE');
});

test('normalization preserves identifier semantics and rejects hidden controls or excessive input', () => {
  expect(normalizeIdentifier('  Ab.C 123  ')).toBe('Ab.C 123');
  expect(normalizeIdentifier('e\u0301-record')).toBe('é-record');
  const cipher = createIdentifierCipher(ring()), scope = context();
  expect(cipher.seal('abc', scope).masked_identifier).toBe('••••');
  for (const value of ['', ' ', 'abc\n123', 'abc\u202e123', 'abc\u200b123', 'x'.repeat(257)]) expect(() => normalizeIdentifier(value)).toThrow('VALIDATION_ERROR');
});

test('invalid key configuration fails with a fixed error and never echoes secret values', () => {
  const invalid: IdentifierKeys[] = [{ currentKeyId: 'v1', currentKey: 'secret-invalid-material', previousKeys: {} }, { ...ring(), currentKeyId: '' }, { ...ring(), previousKeys: { bad: 'not-a-key' } }];
  for (const value of invalid) {
    expect(() => createIdentifierCipher(value)).toThrow('PRIVATE_IDENTIFIER_CONFIGURATION_REQUIRED');
  }
  const duplicate = ring();
  expect(() => createIdentifierCipher({ ...duplicate, previousKeys: { [duplicate.currentKeyId]: duplicate.currentKey } })).toThrow('PRIVATE_IDENTIFIER_CONFIGURATION_REQUIRED');
});
