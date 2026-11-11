import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { loadLocalSupabase } from '../helpers/supabase';

const origin = 'http://127.0.0.1:3000';
async function signIn(request: APIRequestContext, label = 'learner_a') {
  const actor = loadLocalSupabase().actors[label];
  const response = await request.post('/api/auth/login', {
    headers: { Origin: origin }, data: { email: actor.email, password: actor.password },
  });
  expect(response.status()).toBe(200);
}

test('booking learner selection uses current customer scope and a narrow name projection', async ({ request }) => {
  await signIn(request);
  try {
    const account = (await (await request.get('/api/v1/me')).json()).data;
    const response = await request.get('/api/v1/me/learners');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json();
    expect(body.data.items.map((row: { learner_id: string }) => row.learner_id)).toEqual(account.authorized_learner_ids);
    for (const row of body.data.items) {
      expect(Object.keys(row).sort()).toEqual(['display_name', 'learner_id']);
      expect(row.display_name.length).toBeGreaterThan(0);
    }
    const unsupported = await request.get('/api/v1/me/learners?include_contacts=true');
    expect(unsupported.status()).toBe(400);
    const repeated = await request.get('/api/v1/me/learners?limit=1&limit=2');
    expect(repeated.status()).toBe(400);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});

test('customer cookies cannot inspect administrative scheduling or exact fee agreements', async ({ request }) => {
  await signIn(request);
  try {
    for (const path of ['occurrences', 'booking/learners', `tutors/${randomUUID()}/availability`, `occurrences/${randomUUID()}/fee-agreements`]) {
      const response = await request.get(`/api/v1/${path}`);
      expect(response.status()).toBe(403);
      expect(response.headers()['cache-control']).toContain('no-store');
      const body = await response.json();
      expect(body.code).toBe('FORBIDDEN');
      expect(JSON.stringify(body)).not.toMatch(/fee_minor|compensation_policy|payout|internal_notes/);
    }
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});

test('booking mutations reject forged actors, missing operation keys and foreign cookie origins', async ({ request }) => {
  await signIn(request);
  try {
    const path = `/api/v1/occurrences/${randomUUID()}/holds`;
    const key = randomUUID();
    const forged = await request.post(path, {
      headers: { Origin: origin, 'Idempotency-Key': key },
      data: { learner_id: randomUUID(), actor_account_id: randomUUID() },
    });
    expect(forged.status()).toBe(400);
    expect((await forged.json()).code).toBe('VALIDATION_ERROR');
    const missing = await request.post(path, { headers: { Origin: origin }, data: { learner_id: randomUUID() } });
    expect(missing.status()).toBe(400);
    const foreign = await request.post(path, {
      headers: { Origin: 'https://untrusted.example.test', 'Idempotency-Key': key }, data: { learner_id: randomUUID() },
    });
    expect(foreign.status()).toBe(403);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});
