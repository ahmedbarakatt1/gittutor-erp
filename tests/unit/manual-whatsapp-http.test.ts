import { randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GET as verifyCallback, POST as receiveCallback } from '../../src/app/api/webhooks/whatsapp/route';
import { POST as support } from '../../src/app/api/v1/support/[[...path]]/route';

const port = vi.hoisted(() => ({ getConversation: vi.fn(), rpc: vi.fn(), database: vi.fn() }));
vi.mock('@/server/database', () => ({ createDatabasePool: port.database, databaseUrl: vi.fn() }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  config: { app_base_url: 'https://site.example.test', isolated: false, providers: { whatsapp: 'manual' } },
  client: { rpc: port.rpc, auth: { getClaims: async () => ({ data: { claims: { sub: 'staff' } } }) } },
  finish: (response: NextResponse) => response,
}) }));
vi.mock('@/modules/support/commands', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/modules/support/commands')>(), getConversation: port.getConversation,
}));
const id = randomUUID(), origin = 'https://site.example.test';
function write(path: string[], body: unknown = {}) {
  return support(new NextRequest(origin + '/api/v1/support/' + path.join('/'), { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ path }) });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('WHATSAPP_ADAPTER', 'manual'); });
afterEach(() => { vi.unstubAllEnvs(); });

test('manual mode rejects provider verification and inbound callbacks before processing', async () => {
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'leftover-token');
  const callback = origin + '/api/webhooks/whatsapp';
  const handshake = await verifyCallback(new NextRequest(callback + '?hub.mode=subscribe&hub.verify_token=leftover-token&hub.challenge=123'));
  expect(handshake.status).toBe(403);
  const incoming = await receiveCallback(new NextRequest(callback, { method: 'POST', body: '{}' }));
  expect(incoming.status).toBe(503);
  expect(await incoming.json()).toEqual({ code: 'NOT_CONFIGURED' });
  expect(port.database).not.toHaveBeenCalled();
});

test('manual mode blocks outbound WhatsApp actions and allows ordinary website replies', async () => {
  const reply = { text: 'A website response', template_id: null, template_parameters: [], expected_version: 1 };
  port.getConversation.mockResolvedValueOnce({ channel: 'whatsapp' });
  for (const path of [[id, 'reply'], [id, 'reconcile'], ['templates'], ['template-revocations']]) {
    const response = await write(path, reply);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WHATSAPP_MANUAL_CONTACT_ONLY' });
  }
  expect(port.rpc).not.toHaveBeenCalled();
  port.getConversation.mockResolvedValueOnce({ channel: 'website' });
  port.rpc.mockResolvedValueOnce({ data: { command_id: randomUUID(), resource_id: id, version: 2, conversation_id: id, state: 'assigned', owner_id: randomUUID() } });
  expect((await write([id, 'reply'], reply)).status).toBe(200);
  expect(port.rpc).toHaveBeenCalledWith('reply_to_conversation', expect.objectContaining({ p_conversation_id: id, p_text: reply.text }));
});
