import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendEmailAdapter } from '@/server/providers/email';

const config = { api_key: 're_synthetic_send_only_key', from: 'lessons@example.test' };
const attemptId = 'a9c0e8c3-d0cf-456b-bf06-2b3039d76675';
const providerId = '56761188-7520-42d8-8898-ff6fc54ce618';
const message = {
  attempt_id: attemptId,
  to: 'customer@example.test',
  subject: 'Your tutoring session',
  text: 'Open your booking in the portal.',
  html: '<p>Open your booking in the portal.</p>',
  internal_notes: 'Private sentinel',
  tutor_fee_minor: 40000,
};

afterEach(() => vi.restoreAllMocks());

describe('Resend email adapter', () => {
  it('posts only the customer-safe message and keeps the same idempotency key for the attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: providerId }));
    const adapter = createResendEmailAdapter(config, fetcher);
    await expect(adapter.send(message)).resolves.toMatchObject({
      outcome: 'sent', provider_message_id: providerId, safe_error_code: null,
    });
    await adapter.send(message);
    await adapter.send({ ...message, attempt_id: '4f42d9ec-a6ba-4472-ae2f-6e45e038abf6' });

    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer re_synthetic_send_only_key');
    expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json');
    const keys = fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys[0]).toBe(`git-tutor/${attemptId}`);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(JSON.parse(String(request?.body))).toEqual({
      from: 'lessons@example.test',
      to: ['customer@example.test'],
      subject: 'Your tutoring session',
      text: 'Open your booking in the portal.',
      html: '<p>Open your booking in the portal.</p>',
      tags: [{ name: 'git_tutor_attempt', value: attemptId }],
    });
  });

  it.each([
    [401, 'failed', 'EMAIL_REJECTED'],
    [403, 'failed', 'EMAIL_REJECTED'],
    [422, 'failed', 'EMAIL_REJECTED'],
    [429, 'failed', 'EMAIL_TEMPORARY_REJECTION'],
    [408, 'unknown', 'EMAIL_OUTCOME_UNKNOWN'],
    [409, 'unknown', 'EMAIL_OUTCOME_UNKNOWN'],
    [500, 'unknown', 'EMAIL_OUTCOME_UNKNOWN'],
    [503, 'unknown', 'EMAIL_OUTCOME_UNKNOWN'],
  ])('classifies HTTP %i without returning provider error details or resending', async (status, outcome, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      statusCode: status, name: 'provider_error', message: 'provider diagnostic with customer@example.test',
    }, { status }));
    const adapter = createResendEmailAdapter(config, fetcher);
    const result = await adapter.send(message);
    expect(result).toEqual({
      outcome, provider_message_id: null, safe_error_code: code, observed_at: expect.any(String),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful HTTP response without a valid email ID unresolved', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'private-misformed-reference' }));
    await expect(createResendEmailAdapter(config, fetcher).send(message)).resolves.toMatchObject({
      outcome: 'unknown', provider_message_id: null, safe_error_code: 'EMAIL_OUTCOME_UNKNOWN',
    });
  });

  it('treats a timed-out send as unknown and uses callbacks for reconciliation without further HTTP calls', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new Error('private provider noise')));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, request) => {
      request?.signal?.throwIfAborted();
      return Response.json({ id: providerId });
    });
    const adapter = createResendEmailAdapter(config, fetcher);
    await expect(adapter.send(message)).resolves.toMatchObject({
      outcome: 'unknown', provider_message_id: null, safe_error_code: 'EMAIL_OUTCOME_UNKNOWN',
    });
    await expect(adapter.reconcile(attemptId)).resolves.toMatchObject({
      outcome: 'unknown', provider_message_id: null, safe_error_code: 'EMAIL_CALLBACK_REQUIRED',
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
