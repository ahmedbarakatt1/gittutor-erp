import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadLocalSupabase } from '../helpers/supabase';

test('catalog reads require a verified session and reject unsupported or repeated filters', async ({ request }) => {
  const denied = await request.get('/api/v1/public/offers');
  expect(denied.status()).toBe(401);
  expect(await denied.json()).not.toHaveProperty('data');
  const actor = loadLocalSupabase().actors.learner_a;
  expect((await request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3000' }, data: { email: actor.email, password: actor.password },
  })).status()).toBe(200);
  const response = await request.get('/api/v1/public/offers');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.data.items)).toBe(true);
  expect(body.data).toHaveProperty('next_cursor');
  expect(body).toHaveProperty('request_id');
  for (const query of ['internal_compensation=true', 'format=group&format=private', 'limit=101', 'offer_id=invalid']) {
    const invalid = await request.get(`/api/v1/public/offers?${query}`);
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).code).toBe('VALIDATION_ERROR');
  }
});

test('an invalid account cookie is denied catalog access', async ({ request }) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const invalidJwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: randomUUID(), role: 'authenticated', aud: 'authenticated', exp: expires })}.not-a-valid-signature`;
  const cookie = `base64-${encode({ access_token: invalidJwt, refresh_token: 'invalid-synthetic-refresh', expires_at: expires, token_type: 'bearer', user: { id: randomUUID() } })}`;
  const response = await request.get('/api/v1/public/offers', { headers: { Cookie: `sb-127-auth-token=${cookie}` } });
  expect(response.status()).toBe(401);
  expect(await response.json()).not.toHaveProperty('data');
});

test('current customer cookies cannot read commercial administration or approve a policy', async ({ request }) => {
  const actor = loadLocalSupabase().actors.learner_a;
  const login = await request.post('/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3000' }, data: { email: actor.email, password: actor.password },
  });
  expect(login.status()).toBe(200);
  for (const path of ['policies', 'pricing-versions', 'offers', 'tutors']) {
    const response = await request.get(`/api/v1/${path}`);
    expect(response.status()).toBe(403);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await response.json()).code).toBe('FORBIDDEN');
  }
  const approve = await request.post(`/api/v1/policies/${randomUUID()}/approve`, {
    headers: { Origin: 'http://127.0.0.1:3000', 'Idempotency-Key': randomUUID() },
    data: { expected_version: 1, effective_at: new Date().toISOString(), approval_note: 'Unauthorized approval attempt' },
  });
  expect(approve.status()).toBe(403);
  expect((await approve.json()).code).toBe('FORBIDDEN');
  await request.post('/api/auth/logout', { headers: { Origin: 'http://127.0.0.1:3000' } });
});
