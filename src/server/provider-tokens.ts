import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const providerTokenContextSchema = z.object({ provider: z.enum(['google', 'request-drive']), connection_id: z.uuid(), credential_version: z.uuid() }).strict();
export type ProviderTokenContext = z.infer<typeof providerTokenContextSchema>;
const token = z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/);
export const providerTokenPayloadSchema = z.object({ refresh_token: token, access_token: token.optional(), expires_at: z.iso.datetime({ offset: true }).optional(), scopes: z.array(z.string().min(1).max(300)).min(1).max(30) }).strict();
export type ProviderTokenPayload = z.infer<typeof providerTokenPayloadSchema>;
export const providerTokenEnvelopeSchema = z.object({ v: z.literal(1), alg: z.literal('A256GCM'), kid: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), nonce: z.string().max(24), ciphertext: z.string().min(1).max(65536), tag: z.string().max(24) }).strict();
export type ProviderTokenEnvelope = z.infer<typeof providerTokenEnvelopeSchema>;
export type ProviderTokenKeys = { currentKeyId: string; currentKey: string; previousKeys?: Record<string, string> };

function canonical(raw: string, length?: number) { const data = Buffer.from(raw, 'base64url'); if (data.toString('base64url') !== raw || (length !== undefined && data.length !== length)) throw new Error(); return data; }
function aad(context: ProviderTokenContext, key: string) { return Buffer.from(JSON.stringify(['GitTutor/provider-tokens', 1, key, context.provider, context.connection_id, context.credential_version])); }

/** Provider tokens have a separate cryptographic domain from payout/refund identifiers. */
export function createProviderTokenCipher(configuration: ProviderTokenKeys) {
  const keys = new Map<string, Buffer>();
  try {
    const previous = configuration.previousKeys ?? {};
    if (typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).length > 8 || Object.hasOwn(previous, configuration.currentKeyId)) throw new Error();
    for (const [id, material] of [...Object.entries(previous), [configuration.currentKeyId, configuration.currentKey]]) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof material !== 'string' || !/^[a-f\d]{64}$/i.test(material)) throw new Error();
      const master = Buffer.from(material, 'hex'); keys.set(id, Buffer.from(hkdfSync('sha256', master, 'GitTutor/provider-tokens/v1', 'encryption', 32))); master.fill(0);
    }
  } catch { throw new Error('PROVIDER_CONFIGURATION_REQUIRED'); }
  return {
    seal(value: ProviderTokenPayload, input: ProviderTokenContext): ProviderTokenEnvelope {
      const payload = providerTokenPayloadSchema.safeParse(value), scope = providerTokenContextSchema.safeParse(input);
      if (!payload.success || !scope.success) throw new Error('VALIDATION_ERROR');
      const plaintext = Buffer.from(JSON.stringify(payload.data));
      try {
        if (plaintext.length > 32768) throw new Error('VALIDATION_ERROR');
        const nonce = randomBytes(12), kid = configuration.currentKeyId, cipher = createCipheriv('aes-256-gcm', keys.get(kid)!, nonce);
        cipher.setAAD(aad(scope.data, kid));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { v: 1, alg: 'A256GCM', kid, nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
      } finally { plaintext.fill(0); }
    },
    open(value: unknown, input: ProviderTokenContext): ProviderTokenPayload {
      let plaintext: Buffer | undefined;
      try {
        const envelope = providerTokenEnvelopeSchema.parse(value), scope = providerTokenContextSchema.parse(input), key = keys.get(envelope.kid);
        if (!key) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, canonical(envelope.nonce, 12));
        decipher.setAAD(aad(scope, envelope.kid)); decipher.setAuthTag(canonical(envelope.tag, 16));
        plaintext = Buffer.concat([decipher.update(canonical(envelope.ciphertext)), decipher.final()]);
        if (plaintext.length > 32768) throw new Error();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
        return providerTokenPayloadSchema.parse(JSON.parse(text));
      } catch { throw new Error('PROVIDER_CREDENTIALS_UNAVAILABLE'); }
      finally { plaintext?.fill(0); }
    },
  };
}
