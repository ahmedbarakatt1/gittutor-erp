import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { loadLocalSupabase } from '../helpers/supabase';

const origin = 'http://127.0.0.1:3000';
async function signIn(request: APIRequestContext) {
  const actor = loadLocalSupabase().actors.learner_a;
  expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: actor.email, password: actor.password } })).status()).toBe(200);
}
test('payment learner selection requires current scope and rejects unknown or repeated filters', async ({ request }) => {
  expect((await request.get('/api/v1/me/payment-learners')).status()).toBe(401);
  await signIn(request);
  try {
    const current = (await (await request.get('/api/v1/me')).json()).data;
    const response = await request.get('/api/v1/me/payment-learners');
    expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toContain('no-store');
    const rows = (await response.json()).data.items as { learner_id: string; display_name: string }[];
    expect(rows.map(row => row.learner_id)).toEqual(current.authorized_learner_ids);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['display_name', 'learner_id']);
    expect((await request.get('/api/v1/me/payment-learners?include_contacts=true')).status()).toBe(400);
    expect((await request.get('/api/v1/me/payment-learners?limit=1&limit=2')).status()).toBe(400);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});
test('payment mutations reject forged settlement, scan status, actors and foreign origins', async ({ request }) => {
  await signIn(request);
  try {
    const data = { enrollment_id: null, charge_id: randomUUID(), file_id: randomUUID(), receiving_account_version_id: randomUUID(), channel: 'instapay', transferred_amount_minor: 55000, currency: 'EGP', reference: 'SYNTHETIC-TRANSPORT', transferred_at: null };
    const headers = { Origin: origin, 'Idempotency-Key': randomUUID() };
    for (const injected of [{ actor_account_id: randomUUID() }, { state: 'settled' }, { scan_state: 'clean' }, { payer_verified: true }]) {
      const response = await request.post('/api/v1/receipts', { headers, data: { ...data, ...injected } });
      expect(response.status()).toBe(400); expect((await response.json()).code).toBe('VALIDATION_ERROR');
    }
    expect((await request.post('/api/v1/receipts', { headers: { Origin: origin }, data })).status()).toBe(400);
    expect((await request.post('/api/v1/receipts', { headers: { ...headers, Origin: 'https://untrusted.example.test' }, data })).status()).toBe(403);
    const dest = await request.post(`/api/v1/refunds/${randomUUID()}/destination`, { headers, data: { channel: 'instapay', identifier: 'synthetic-payer@instapay', payee_name: 'Synthetic payer', source_evidence_file_id: randomUUID(), expected_version: 1, verification_status: 'verified' } });
    expect(dest.status()).toBe(400);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});
test('customer financial reads do not admit privileged statements, cases or source reconciliation', async ({ request }) => {
  await signIn(request);
  try {
    for (const path of ['review-cases', 'incoming-transfers', 'statement-evidence', 'financial-exceptions', 'admin/refunds']) {
      const response = await request.get(`/api/v1/${path}`); expect(response.status()).toBe(403);
      expect(response.headers()['cache-control']).toContain('no-store');
      expect(JSON.stringify(await response.json())).not.toMatch(/fee_minor|compensation_policy|internal_notes|encrypted_identifier|identifier_fingerprint|ledger_lines/);
    }
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});

test('payer lookup keeps exact contacts in a same-origin authenticated POST with strict inputs', async ({ request }) => {
  const path = `/api/v1/incoming-transfers/${randomUUID()}/payer-lookup`;
  const body = { contact_channel: 'email', exact_contact: 'synthetic-payer@example.test' };
  expect((await request.post(path, { headers: { Origin: origin }, data: body })).status()).toBe(401);
  await signIn(request);
  try {
    expect((await request.post(path, { headers: { Origin: 'https://untrusted.example.test' }, data: body })).status()).toBe(403);
    for (const data of [{ ...body, include_all: true }, { contact_channel: 'email', exact_contact: '' }, { contact_channel: 'phone', exact_contact: '123' }]) {
      const response = await request.post(path, { headers: { Origin: origin }, data });
      expect(response.status()).toBe(400); expect((await response.json()).code).toBe('VALIDATION_ERROR');
      expect(response.headers()['cache-control']).toContain('no-store');
    }
    expect((await request.get(`${path}?contact_channel=email&exact_contact=${body.exact_contact}`)).status()).toBe(400);
  } finally { await request.post('/api/auth/logout', { headers: { Origin: origin } }); }
});
