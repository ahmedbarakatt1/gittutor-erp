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

test('package learner selection is authenticated, scoped and narrowly projected', async ({ request }) => {
  expect((await request.get('/api/v1/me/package-learners')).status()).toBe(401);
  await signIn(request);
  try {
    const account = (await (await request.get('/api/v1/me')).json()).data;
    const response = await request.get('/api/v1/me/package-learners');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const rows = (await response.json()).data.items as { learner_id: string; display_name: string }[];
    expect(rows.map(row => row.learner_id)).toEqual(account.authorized_learner_ids);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['display_name', 'learner_id']);
      expect(row.display_name).not.toHaveLength(0);
    }
    expect((await request.get('/api/v1/me/package-learners?include_contacts=true')).status()).toBe(400);
    expect((await request.get('/api/v1/me/package-learners?limit=1&limit=2')).status()).toBe(400);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});

test('customers cannot read package administration, subsidy authoring or privileged reconciliation', async ({ request }) => {
  await signIn(request);
  try {
    for (const path of ['admin/packages', 'package-grant-policies', `packages/${randomUUID()}/reconciliation`]) {
      const response = await request.get(`/api/v1/${path}`);
      expect(response.status()).toBe(403);
      expect(response.headers()['cache-control']).toContain('no-store');
      const body = await response.json();
      expect(body.code).toBe('FORBIDDEN');
      expect(JSON.stringify(body)).not.toMatch(/fee_minor|compensation_policy|payout|internal_notes|ledger_lines/);
    }
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});

test('package mutations reject caller actors, synthetic funding assertions and foreign origins', async ({ request }) => {
  await signIn(request);
  try {
    const data = { learner_id: randomUUID(), package_contract_version_id: randomUUID(), accepted_terms_hash: 'a'.repeat(64) };
    const headers = { Origin: origin, 'Idempotency-Key': randomUUID() };
    for (const injected of [{ actor_account_id: randomUUID() }, { funded: true }, { purchased_granted_credit_quanta: 1000 }]) {
      const response = await request.post('/api/v1/packages', { headers, data: { ...data, ...injected } });
      expect(response.status()).toBe(400);
      expect((await response.json()).code).toBe('VALIDATION_ERROR');
    }
    expect((await request.post('/api/v1/packages', { headers: { Origin: origin }, data })).status()).toBe(400);
    expect((await request.post('/api/v1/packages', { headers: { ...headers, Origin: 'https://untrusted.example.test' }, data })).status()).toBe(403);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});
