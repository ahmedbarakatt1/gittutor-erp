import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { encryptedIdentifierSchema } from '../modules/payments/commands';

const contextSchema = z.object({
  purpose: z.enum(['refund_destination', 'tutor_payout_destination']),
  channel: z.enum(['instapay', 'vodafone_cash']), parent_id: z.uuid(), destination_id: z.uuid(),
  owner_account_id: z.uuid(), identifier_version: z.literal(1),
}).strict();
export type IdentifierContext = z.infer<typeof contextSchema>;
export type EncryptedIdentifier = z.infer<typeof encryptedIdentifierSchema>;
export type IdentifierKeys = { currentKeyId: string; currentKey: string; previousKeys?: Record<string, string> };

export function normalizeIdentifier(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 512 || /\p{C}/u.test(raw)) throw new Error('VALIDATION_ERROR');
  const value = raw.trim().normalize('NFC');
  if (!value || value.length > 200 || Buffer.byteLength(value, 'utf8') > 256) throw new Error('VALIDATION_ERROR');
  return value;
}

function maskedIdentifier(value: string): string {
  const visible = value.replace(/[^A-Za-z0-9]/g, '');
  return visible.length > 8 ? `•••• ${visible.slice(-4)}` : '••••';
}
function canonicalBytes(value: string, expectedLength?: number): Buffer {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (expectedLength !== undefined && bytes.length !== expectedLength)) throw new Error('PRIVATE_IDENTIFIER_UNAVAILABLE');
  return bytes;
}
function associatedData(context: IdentifierContext, keyId: string) {
  return Buffer.from(JSON.stringify(['GitTutor/private-identifier', 1, 'A256GCM', keyId, context.purpose, context.channel, context.parent_id, context.destination_id, context.owner_account_id, context.identifier_version]), 'utf8');
}

/** Keep this object in server memory only. Each historical key remains available for its immutable records. */
export function createIdentifierCipher(configuration: IdentifierKeys) {
  const keys = new Map<string, { encryption: Buffer; fingerprint: Buffer }>();
  const currentKeyId = configuration?.currentKeyId;
  try {
    if (!configuration || !/^[A-Za-z0-9_-]{1,40}$/.test(configuration.currentKeyId)) throw new Error();
    const previous = configuration.previousKeys ?? {};
    if (typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).length > 8 || Object.hasOwn(previous, configuration.currentKeyId)) throw new Error();
    for (const [keyId, material] of [...Object.entries(previous), [configuration.currentKeyId, configuration.currentKey]]) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId) || typeof material !== 'string' || !/^[a-f0-9]{64}$/i.test(material)) throw new Error();
      const master = Buffer.from(material, 'hex');
      const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', master, 'GitTutor/private-identifiers/v1', purpose, 32));
      keys.set(keyId, { encryption: derive('encryption'), fingerprint: derive('fingerprint') });
      master.fill(0);
    }
  } catch { throw new Error('PRIVATE_IDENTIFIER_CONFIGURATION_REQUIRED'); }
  const metadata = (identifier: string, channel: IdentifierContext['channel'], keyId: string) => ({
    masked_identifier: maskedIdentifier(identifier),
    identifier_fingerprint: createHmac('sha256', keys.get(keyId)!.fingerprint).update(JSON.stringify([channel, identifier]), 'utf8').digest('hex'),
  });

  return {
    seal(raw: string, inputContext: IdentifierContext) {
      const scope = contextSchema.safeParse(inputContext);
      if (!scope.success) throw new Error('VALIDATION_ERROR');
      const identifier = normalizeIdentifier(raw), kid = currentKeyId, nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keys.get(kid)!.encryption, nonce, { authTagLength: 16 });
      cipher.setAAD(associatedData(scope.data, kid));
      const ciphertext = Buffer.concat([cipher.update(identifier, 'utf8'), cipher.final()]);
      const encrypted_identifier: EncryptedIdentifier = { v: 1, alg: 'A256GCM', kid, nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
      return { encrypted_identifier, ...metadata(identifier, scope.data.channel, kid) };
    },
    open(rawEnvelope: unknown, inputContext: IdentifierContext) {
      try {
        const envelope = encryptedIdentifierSchema.parse(rawEnvelope), scope = contextSchema.parse(inputContext), key = keys.get(envelope.kid);
        if (!key) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key.encryption, canonicalBytes(envelope.nonce, 12), { authTagLength: 16 });
        decipher.setAAD(associatedData(scope, envelope.kid));
        decipher.setAuthTag(canonicalBytes(envelope.tag, 16));
        const plaintext = Buffer.concat([decipher.update(canonicalBytes(envelope.ciphertext)), decipher.final()]);
        const identifier = plaintext.toString('utf8');
        if (!Buffer.from(identifier, 'utf8').equals(plaintext) || normalizeIdentifier(identifier) !== identifier) throw new Error();
        plaintext.fill(0);
        return { identifier, ...metadata(identifier, scope.channel, envelope.kid) };
      } catch { throw new Error('PRIVATE_IDENTIFIER_UNAVAILABLE'); }
    },
  };
}
