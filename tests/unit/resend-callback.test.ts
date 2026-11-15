import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/resend/route';
import { verifyResendWebhookSignature } from '@/server/resend-callback';

vi.mock('server-only', () => ({}));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/server/database', () => ({
  databaseUrl: () => 'postgresql://synthetic.invalid/git_tutor',
  createDatabasePool: () => ({ query }),
}));

// Public signing example from https://docs.svix.com/receiving/verifying-payloads/how
const signingSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const clockSeconds = 1_800_000_000;
const providerId = '56761188-7520-42d8-8898-ff6fc54ce618';
const attemptId = 'a9c0e8c3-d0cf-456b-bf06-2b3039d76675';
const occurredAt = '2027-01-15T08:00:00.123Z';
const baseEvent = {
  type: 'email.delivered',
  created_at: occurredAt,
  data: {
    email_id: providerId,
    created_at: '2027-01-15T07:59:58.123Z',
    from: 'lessons@example.test',
    to: ['customer@example.test'],
    subject: 'Your tutoring session',
    tags: { git_tutor_attempt: attemptId, extra: 'private metadata' },
  },
};

function callbackHeaders(body: string, id = 'msg_delivery_example', timestamp = clockSeconds) {
  const key = Buffer.from(signingSecret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Headers({
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  });
}

function webhookRequest(body: string, headers = callbackHeaders(body)) {
  return new Request('https://app.example.test/api/webhooks/resend', { method: 'POST', body, headers });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(clockSeconds * 1000);
  vi.stubEnv('EMAIL_ADAPTER', 'resend');
  vi.stubEnv('RESEND_API_KEY', 're_synthetic_send_only_key');
  vi.stubEnv('EMAIL_FROM', 'lessons@example.test');
  vi.stubEnv('RESEND_WEBHOOK_SECRET', signingSecret);
  query.mockReset().mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Resend callbacks', () => {
  it('verifies the documented Svix raw-body vector and rejects a semantically equivalent rewrite', () => {
    const timestamp = 1_614_265_330;
    vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000);
    const headers = new Headers({
      'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'svix-timestamp': String(timestamp),
      'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
    const verify = (body: string) => verifyResendWebhookSignature(Buffer.from(body), headers, signingSecret);
    expect(verify('{"test": 2432232314}')).toBe('msg_p5jXN8AQM9LWM0D4loKWxJek');
    expect(() => verify('{"test":2432232314}')).toThrow();
  });

  it.each([
    ['email.sent', 'sent'],
    ['email.delivered', 'delivered'],
    ['email.bounced', 'bounced'],
    ['email.failed', 'failed'],
  ])('records %s using just the authorized callback parameters', async (type, outcome) => {
    const body = JSON.stringify({ ...baseEvent, type }, null, 2);
    const headers = callbackHeaders(body);
    headers.set('svix-signature', `v2,unrecognized v1,invalid ${headers.get('svix-signature')}`);
    const response = await POST(webhookRequest(body, headers));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ received: true });
    expect(query).toHaveBeenCalledExactlyOnceWith(
      'select app_private.record_email_callback($1,$2,$3,$4,$5)',
      [attemptId, providerId, expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/), outcome, occurredAt],
    );
  });

  it('uses a stable database deduplication key across signed retries and different keys across messages', async () => {
    const body = JSON.stringify(baseEvent);
    await POST(webhookRequest(body, callbackHeaders(body, 'msg_same_retry', clockSeconds - 2)));
    await POST(webhookRequest(body, callbackHeaders(body, 'msg_same_retry', clockSeconds + 2)));
    await POST(webhookRequest(body, callbackHeaders(body, 'msg_different')));
    expect(query).toHaveBeenCalledTimes(3);
    const keys = query.mock.calls.map(([, parameters]) => parameters[2]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it.each([-301, 301])('rejects a valid HMAC signed %i seconds away', async (offset) => {
    const body = JSON.stringify(baseEvent);
    const headers = callbackHeaders(body, 'msg_outside_clock_window', clockSeconds + offset);
    expect((await POST(webhookRequest(body, headers))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a valid signature even for unrelated Auth SMTP events', async () => {
    const body = JSON.stringify({ ...baseEvent, data: { ...baseEvent.data, tags: undefined } });
    expect((await POST(webhookRequest(body))).status).toBe(200);
    const headers = callbackHeaders(body);
    headers.delete('svix-signature');
    expect((await POST(webhookRequest(body, headers))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed signed attempt and provider IDs without invoking the database', async () => {
    const invalidData = [
      { ...baseEvent.data, tags: { git_tutor_attempt: 'private-extra-data' } },
      { ...baseEvent.data, email_id: 'not-an-email-uuid' },
    ];
    for (const data of invalidData) {
      const response = await POST(webhookRequest(JSON.stringify({ ...baseEvent, data })));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: 'CALLBACK_REJECTED' });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a signed stream larger than 64 KiB and overlong signature headers', async () => {
    const oversized = JSON.stringify({ ...baseEvent, unused: 'x'.repeat(65_536) });
    expect((await POST(webhookRequest(oversized))).status).toBe(400);

    const body = JSON.stringify(baseEvent);
    const headers = callbackHeaders(body);
    headers.set('svix-signature', `${'v2,x '.repeat(500)}${headers.get('svix-signature')}`);
    expect((await POST(webhookRequest(body, headers))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a retryable response if a verified observation cannot be persisted', async () => {
    query.mockRejectedValueOnce(new Error('private connection details'));
    const response = await POST(webhookRequest(JSON.stringify(baseEvent)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'CALLBACK_UNAVAILABLE' });
  });

  it('disables the route in fake mode', async () => {
    vi.stubEnv('EMAIL_ADAPTER', 'fake');
    const response = await POST(webhookRequest(JSON.stringify(baseEvent)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'NOT_CONFIGURED' });
    expect(query).not.toHaveBeenCalled();
  });
});
