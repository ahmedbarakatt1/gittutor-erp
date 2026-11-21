import { randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { GET, POST } from '../../src/app/api/v1/requests/[[...path]]/route';

const port = vi.hoisted(() => ({ rpc: vi.fn(), getClaims: vi.fn() }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  config: { isolated: false, app_base_url: 'https://tutoring.example.test' },
  client: { ...port, auth: { getClaims: port.getClaims } },
  finish: (response: NextResponse) => response,
}) }));

const origin = 'https://tutoring.example.test';
const learnerId = randomUUID();
const payload = { learner_id: learnerId, topic: 'Circuits', description: 'Review these slides', preferred_times: 'Tuesday 18:00 Cairo', format: 'individual' };
const key = randomUUID();

function createRequest(body: unknown, site = origin, idempotencyKey: string | null = key) {
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: site });
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  return new NextRequest(`${origin}/api/v1/requests`, { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  port.getClaims.mockResolvedValue({ data: { claims: { sub: learnerId } }, error: null });
});

test('request writes require signed claims, same origin, idempotency and allowlisted input', async () => {
  const context = { params: Promise.resolve({}) };
  expect((await POST(createRequest(payload, 'https://other.example.test'), context)).status).toBe(403);
  expect((await POST(createRequest(payload, origin, null), context)).status).toBe(400);
  expect((await POST(createRequest({ ...payload, tutor_fee: 1 }), context)).status).toBe(400);
  expect((await POST(createRequest({ ...payload, idempotency_key: key }), context)).status).toBe(400);
  port.getClaims.mockResolvedValueOnce({ data: null, error: { message: 'Expired' } });
  expect((await POST(createRequest(payload), context)).status).toBe(401);
  expect(port.rpc).not.toHaveBeenCalled();

  const saved = { command_id: randomUUID(), resource_id: randomUUID(), version: 1 };
  port.rpc.mockResolvedValueOnce({ status: 201, data: saved, error: null });
  const response = await POST(createRequest(payload), context);
  expect(response.status).toBe(201);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ data: saved, request_id: expect.any(String) });
  expect(port.rpc).toHaveBeenCalledWith('create_tutoring_request', { p_learner_id: learnerId, p_topic: payload.topic, p_course: '',
    p_description: payload.description, p_preferred_times: payload.preferred_times, p_format: payload.format, p_idempotency_key: key });
});

test.each([false, true])('match options expose the current quote and seat count, rejecting private fields (private = %s)', async hasPrivateField => {
  const requestId = randomUUID();
  port.rpc.mockResolvedValueOnce({ status: 200, error: null, data: { items: [{
    offer_id: randomUUID(), occurrence_id: randomUUID(), title: 'Systems', start_at: '2026-11-16T16:00:00Z',
    end_at: '2026-11-16T17:30:00Z', customer_price_minor: 68125, available_seats: 1,
    ...(hasPrivateField && { tutor_fee_minor: 25000 }),
  }], next_cursor: null } });
  const response = await GET(new NextRequest(`${origin}/api/v1/requests/${requestId}/matches`), { params: Promise.resolve({ path: [requestId, 'matches'] }) });
  expect(port.rpc).toHaveBeenCalledWith('list_tutoring_request_matches', { p_request_id: requestId, p_cursor: null, p_limit: 25 });
  expect(response.status).toBe(hasPrivateField ? 503 : 200);
  expect(await response.json()).toMatchObject(hasPrivateField
    ? { code: 'DEPENDENCY_UNAVAILABLE', request_id: expect.any(String) }
    : { data: { items: [{ customer_price_minor: 68125, available_seats: 1 }] } });
});
