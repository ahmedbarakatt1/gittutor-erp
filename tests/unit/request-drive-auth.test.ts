import { randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createProviderTokenCipher } from '../../src/server/provider-tokens';
import { getRequestDriveToken } from '../../src/server/request-drive-auth';
import { POST } from '../../src/app/api/drive/connect/route';
import { GET } from '../../src/app/api/drive/google/callback/route';

const port = vi.hoisted(() => ({ rpc: vi.fn(), query: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/server/database', () => ({ createDatabasePool: () => ({ query: port.query }), databaseUrl: vi.fn() }));
vi.mock('@/server/config', () => ({ parseServerConfig: () => settings }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  client: { rpc: port.rpc }, config: settings, finish: (response: NextResponse) => response,
}) }));

const app = 'https://school.example.test', callbackPath = '/api/drive/google/callback';
const settings = { app_base_url: app, isolated: false, secret_encryption_key: 'a'.repeat(64), secret_encryption_key_id: 'v1',
  request_drive: { client_id: 'id', client_secret: 'secret', redirect_uri: app + callbackPath } };
const actor = { actor_id: randomUUID(), session_id: randomUUID(), can_connect: true, consent_version: randomUUID(), connection_id: randomUUID() };
const cipher = createProviderTokenCipher({ currentKeyId: 'v1', currentKey: settings.secret_encryption_key });
const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const googleTokens = { scope: scopes.join(' '), access_token: 'private-access-value', refresh_token: 'private-refresh-value', expires_in: 3600 };
function connect(origin = app) {
  return POST(new NextRequest(app + '/api/drive/connect', { method: 'POST', headers: { Origin: origin } }));
}
async function begin() {
  const response = await connect();
  expect(response.status).toBe(303);
  const url = new URL(response.headers.get('location')!);
  expect(url.origin).toBe('https://accounts.google.com');
  const cookie = response.cookies.getAll()[0];
  expect(cookie).toMatchObject({ path: callbackPath, secure: true, httpOnly: true, sameSite: 'lax' });
  return () => GET(new NextRequest(app + callbackPath + '?code=synthetic&state=' + url.searchParams.get('state'), {
    headers: { Cookie: cookie.name + '=' + cookie.value },
  }));
}
beforeEach(() => {
  vi.resetAllMocks();
  port.rpc.mockResolvedValue({ data: actor });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/token') ? googleTokens :
    { sub: 'owner-id', email: 'gittutor2@gmail.com', email_verified: true })));
});
afterEach(() => vi.unstubAllGlobals());

test('consent checks same origin and the current owner, including on callback', async () => {
  expect((await connect('https://other.example.test')).status).toBe(403);
  expect(port.rpc).not.toHaveBeenCalled();
  const complete = await begin();
  port.rpc.mockResolvedValue({ data: { can_connect: false } });
  expect((await connect()).status).toBe(403);
  expect((await complete()).headers.get('location')).toBe(app + '/admin/integrations?drive=consent_failed');
  expect(fetch).not.toHaveBeenCalled();
  expect(port.query).not.toHaveBeenCalled();
});

test('successful callback stores an authenticated envelope and returns only the status', async () => {
  const complete = await begin();
  const response = await complete();
  expect(response.headers.get('location')).toBe(app + '/admin/integrations?drive=connected');
  expect([...response.headers].join(' ')).not.toMatch(/private-access-value|private-refresh-value/);
  const [query, values] = port.query.mock.calls[0];
  expect(query).toContain('record_request_drive_grant');
  expect(JSON.stringify(values)).not.toMatch(/private-access-value|private-refresh-value/);
  expect(cipher.open(values[6], { provider: 'request-drive', connection_id: actor.connection_id, credential_version: values[3] })).toMatchObject({ refresh_token: googleTokens.refresh_token });
});

function stored(access?: string) {
  const credential_version = randomUUID();
  return { connection_id: actor.connection_id, credential_version, envelope: cipher.seal({ refresh_token: 'old-token', scopes,
    ...(access && { access_token: access, expires_at: new Date(Date.now() + 3600000).toISOString() }) },
  { provider: 'request-drive', connection_id: actor.connection_id, credential_version }) };
}
test('refresh writes only encrypted updated tokens and resolves a concurrent grant replacement', async () => {
  const old = stored();
  port.query.mockResolvedValueOnce({ rows: [{ grant: old }] })
    .mockResolvedValueOnce({ rows: [{ saved: false }] }).mockResolvedValueOnce({ rows: [{ grant: stored('winner-access') }] });
  expect(await getRequestDriveToken()).toBe('winner-access');
  expect(fetch).toHaveBeenCalledTimes(1);
  const [query, [expected, version, envelope]] = port.query.mock.calls[1];
  expect(query).toContain('update_request_drive_token');
  expect(expected).toBe(old.credential_version);
  expect(cipher.open(envelope, { provider: 'request-drive', connection_id: actor.connection_id, credential_version: version })).toMatchObject({ refresh_token: googleTokens.refresh_token });
});

test.each([[400, 'invalid_grant', 'DRIVE_CONNECTION_REQUIRED', 2], [503, 'unavailable', 'DEPENDENCY_UNAVAILABLE', 1]] as const)(
  'refresh handles provider status %s and safely classifies the connection', async (status, error, expected, queries) => {
    port.query.mockResolvedValueOnce({ rows: [{ grant: stored() }] }).mockResolvedValueOnce({ rows: [{ saved: true }] });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error }, { status })));
    await expect(getRequestDriveToken()).rejects.toThrow(expected);
    expect(port.query).toHaveBeenCalledTimes(queries);
  },
);
