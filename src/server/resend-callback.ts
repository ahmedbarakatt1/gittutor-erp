import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const maxBodyBytes = 65_536;
const maxSignatureLength = 2_048;
const timestampToleranceSeconds = 300;

/** Verify Svix's signature over the untouched bytes and return the authenticated message ID. */
export function verifyResendWebhookSignature(body: Uint8Array, headers: Headers, secret: string) {
  const id = headers.get('svix-id') ?? '';
  const timestamp = headers.get('svix-timestamp') ?? '';
  const signatures = headers.get('svix-signature') ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[1-9]\d{0,11}$/.test(timestamp) ||
      signatures.length === 0 || signatures.length > maxSignatureLength ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > timestampToleranceSeconds) {
    throw new Error('EMAIL_CALLBACK_INVALID');
  }

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const hmac = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body);
  const expected = Buffer.from(hmac.digest('base64'), 'ascii');
  const verified = signatures.split(' ').some(signature => {
    if (!signature.startsWith('v1,')) return false;
    const provided = Buffer.from(signature.slice(3), 'utf8');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
  if (!verified) throw new Error('EMAIL_CALLBACK_INVALID');
  return id;
}

async function readWebhookBody(request: Request) {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) throw new Error('EMAIL_CALLBACK_INVALID');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('EMAIL_CALLBACK_INVALID');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, length);
      length += value.byteLength;
      if (length > maxBodyBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error('EMAIL_CALLBACK_INVALID');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

const webhookEvent = z.object({ type: z.string().max(128) });
const attemptTag = z.object({
  data: z.object({ tags: z.object({ git_tutor_attempt: z.uuid().optional() }).nullish() }),
});
const emailEvent = z.object({
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.uuid() }),
});
const outcomes = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
} as const;

/** The existing callback function uses UUIDs for deduplication. Svix IDs are strings. */
function resendCallbackId(id: string) {
  const hash = createHash('sha256').update('git-tutor:resend:').update(id).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readResendEmailCallback(request: Request, secret: string) {
  const body = await readWebhookBody(request);
  const id = verifyResendWebhookSignature(body, request.headers, secret);
  const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  const { type } = webhookEvent.parse(payload);
  if (!Object.hasOwn(outcomes, type)) return null;
  const attemptId = attemptTag.parse(payload).data.tags?.git_tutor_attempt;
  if (!attemptId) return null; // Auth SMTP and other unrelated messages carry no attempt tag.
  const event = emailEvent.parse(payload);
  return {
    attempt_id: attemptId,
    provider_message_id: event.data.email_id,
    callback_id: resendCallbackId(id),
    outcome: outcomes[type as keyof typeof outcomes],
    observed_at: event.created_at,
  };
}
