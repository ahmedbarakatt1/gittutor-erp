import { randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { POST as connect } from '../../src/app/api/calendar/connect/route';
import { GET as callback } from '../../src/app/api/calendar/google/callback/route';
import { findMeetingReadRoute } from '../../src/server/meeting-http';

const port = vi.hoisted(() => ({ rpc: vi.fn(), query: vi.fn(), probe:vi.fn(), mode: 'google', environment:'test', admin: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/server/google-organizer-probe', () => ({verifyGoogleOrganizer:port.probe}));
vi.mock('@/server/database', () => ({ createDatabasePool: () => ({ query: port.query }), databaseUrl: vi.fn() }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  client: { rpc: port.rpc, auth: { getClaims: async () => ({ data: { claims: { sub: actor, session_id: session } } }) } },
  config: { providers: { calendar: port.mode }, app_base_url: origin, environment:port.environment, isolated: port.environment==='test', secret_encryption_key: 'a'.repeat(64),
    secret_encryption_key_id: 'v1', google: { client_id: 'synthetic-id', client_secret: 'synthetic-secret',
      redirect_uri: origin + '/api/calendar/google/callback', calendar_id: 'legacy@example.test' } },
  finish: (response: NextResponse) => response,
}) }));

const origin = 'https://site.example.test', actor = randomUUID(), session = randomUUID();
const target = randomUUID(), requestId = randomUUID(), key = randomUUID(), subject = 'synthetic-google-account';
const summary = { connection_id: target, version: 7, mode: 'google', state: 'preview_connected',
  integration_state: 'verified', organizer_masked_email: 'o***@example.test', last_verified_at: null, safe_error_code: null };
const commandResult = { command_id: randomUUID(), resource_id: target, version: 1, connection_id: target };
function post(body: unknown) {
  return connect(new NextRequest(origin + '/api/calendar/connect', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key,
  }, body: JSON.stringify(body) }));
}
beforeEach(() => {
  vi.resetAllMocks(); port.admin = true; port.mode = 'google'; port.environment='test';
  const pending = { request_id: requestId, connection_id: target, expires_at: new Date(Date.now() + 300000).toISOString() };
  port.rpc.mockImplementation(async (name: string) => {
    if (name === 'get_my_account') return { data: { account_id: actor, verified: true, roles: [port.admin ? 'admin' : 'tutor'], locale: 'en', authorized_learner_ids: [] } };
    if (name === 'get_calendar_connection_request') return { data: pending };
    if (name === 'list_calendar_connections') return { data: [summary] };
    if (name === 'create_calendar_connection_request' || name === 'create_calendar_reconnection_request') return { data: { ...commandResult, ...pending } };
    if (name.includes('fake_calendar')) return { data: { ...commandResult, integration_state: 'simulated' } };
    throw new Error('UNEXPECTED_RPC');
  });
  port.query.mockResolvedValue({ rowCount: 1, rows: [{ data: { connection_id: target, version: 8, integration_state: 'verification_required' } }] });
});
afterEach(() => vi.unstubAllGlobals());

async function begin(body: unknown) {
  const start = await post(body);
  expect(start.status).toBe(200);
  const state = new URL((await start.json()).data.authorization_url).searchParams.get('state');
  return { state, cookie: start.cookies.getAll()[0] };
}
function mockGoogle() {
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/token') ? {
    refresh_token: 'private-refresh', access_token: 'private-access', expires_in: 3600,
    scope: 'openid email https://www.googleapis.com/auth/calendar.events',
  } : { sub: subject, email: 'another@example.test', email_verified: true }));
}
function complete(state: string | null, cookies: string) {
  return callback(new NextRequest(origin + '/api/calendar/google/callback?code=synthetic&state=' + state, { headers: { cookie: cookies } }));
}
async function grant(body: unknown) {
  const { state, cookie } = await begin(body);
  mockGoogle();
  return complete(state,cookie.name + '=' + cookie.value);
}

test('add chooses the authorized account primary calendar and binds its Google subject when storing credentials', async () => {
  const finish = await grant({ action: 'add' });
  expect(port.rpc).toHaveBeenCalledWith('create_calendar_connection_request', { p_idempotency_key: key });
  expect(finish.headers.get('location')).toBe(origin + '/admin/integrations?calendar=connected');
  const [sql, args] = port.query.mock.lastCall!;
  expect(sql).toContain('app_private.record_calendar_organizer');
  expect(args).toEqual([requestId, target, expect.any(String), 'another@example.test', 'primary', expect.any(String), 'v1', subject]);
  expect(args[5]).not.toMatch(/private-access|private-refresh/);
  expect(JSON.stringify([...finish.headers])).not.toContain(subject);
});

test.each([['STATE_CONFLICT','conflict'],['VERSION_CONFLICT','stale']])('a rejected targeted grant reports %s and clears the handshake', async (reason,outcome) => {
  port.query.mockRejectedValueOnce(new Error(reason));
  const finish = await grant({ action: 'reconnect', connection_id: target, expected_version: 7 });
  expect(finish.headers.get('location')).toBe(origin + '/admin/integrations?calendar=' + outcome);
  expect(finish.cookies.getAll()).toMatchObject([{ value: '', maxAge: 0 }]);
});

test('two pending organizer consents in one admin session keep independent state and verifier cookies', async () => {
  const first = await begin({ action: 'add' });
  const second = await begin({ action: 'reconnect', connection_id: target, expected_version: 7 });
  expect(first.cookie.name).not.toBe(second.cookie.name);
  const browserCookies = [first,second].map(({ cookie }) => cookie.name + '=' + cookie.value).join('; ');
  mockGoogle();
  const finishFirst = await complete(first.state,browserCookies);
  expect(finishFirst.headers.get('location')).toBe(origin + '/admin/integrations?calendar=connected');
  expect(finishFirst.cookies.getAll().map(c => c.name)).toEqual([first.cookie.name]);
  const finishSecond = await complete(second.state,second.cookie.name + '=' + second.cookie.value);
  expect(finishSecond.headers.get('location')).toBe(origin + '/admin/integrations?calendar=connected');
});

test('legacy Google connect targets the sole organizer and rejects an ambiguous pool', async () => {
  expect((await post({})).status).toBe(200);
  expect(port.rpc).toHaveBeenCalledWith('create_calendar_reconnection_request', { p_connection_id: target, p_expected_version: 7, p_idempotency_key: key });
  port.rpc.mockResolvedValueOnce({ data: { account_id: actor, verified: true, roles: ['admin'], locale: 'en', authorized_learner_ids: [] } })
    .mockResolvedValueOnce({ data: [summary, { ...summary, connection_id: randomUUID() }] });
  expect((await post({})).status).toBe(409);
  expect(port.rpc).not.toHaveBeenCalledWith('create_calendar_connection_request', expect.anything());
});

test.each(['google','fake'])('reconnect %s targets exactly one row and its expected version', async mode => {
  port.mode = mode;
  const response = await post({ action: 'reconnect', connection_id: target, expected_version: 7 });
  expect(response.status).toBe(200);
  expect(port.rpc).toHaveBeenCalledWith(mode === 'google' ? 'create_calendar_reconnection_request' : 'reconnect_fake_calendar_organizer',
    { p_connection_id: target, p_expected_version: 7, p_idempotency_key: key });
  expect(port.rpc).not.toHaveBeenCalledWith('create_calendar_connection_request', expect.anything());
});

test('explicit fake add, legacy connect and exact input validation', async () => {
  port.mode = 'fake';
  expect((await post({ action: 'add' })).status).toBe(200);
  expect(port.rpc).toHaveBeenCalledWith('add_fake_calendar_organizer', { p_idempotency_key: key });
  expect((await post({})).status).toBe(200);
  expect(port.rpc).toHaveBeenCalledWith('connect_fake_calendar', { p_idempotency_key: key });
  expect((await post({ action: 'add', connection_id: target })).status).toBe(400);
  expect((await post({ action: 'reconnect', connection_id: target })).status).toBe(400);
  port.admin = false;
  expect((await post({ action: 'add' })).status).toBe(403);
});

test('the organizer list accepts only sanitized per-connection rows', async () => {
  const route = findMeetingReadRoute('calendar/connections');
  expect(route).toBeDefined();
  expect(await route!.run({ rpc: port.rpc }, {})).toEqual([summary]);
  port.rpc.mockResolvedValueOnce({ data: [{ ...summary, google_subject: subject }] });
  await expect(route!.run({ rpc: port.rpc }, {})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});

test('the production organizer check uses the saved calendar and only marks the exact verified grant after cleanup', async () => {
  port.environment = 'production';
  port.query.mockResolvedValueOnce({rowCount:1,rows:[{data:{connection_id:target,version:8,calendar_id:'saved-calendar@example.test',verification_allowed:true,integration_state:'verification_required'}}]})
    .mockResolvedValueOnce({rowCount:1,rows:[{data:{connection_id:target,version:8,integration_state:'verified'}}]});
  port.probe.mockResolvedValue(true);
  const response = await grant({action:'reconnect',connection_id:target,expected_version:7,verify_room:true});
  expect(response.headers.get('location')).toBe(origin+'/admin/integrations?calendar=verified');
  expect(port.probe).toHaveBeenCalledWith({probe_id:requestId,calendar_id:'saved-calendar@example.test',access_token:'private-access'});
  const credentialVersion = port.query.mock.calls[0][1][2];
  expect(port.query.mock.calls[1]).toEqual([expect.stringContaining('verify_calendar_organizer'),[requestId,target,8,credentialVersion]]);
  expect(port.probe.mock.invocationCallOrder[0]).toBeLessThan(port.query.mock.invocationCallOrder[1]);
  expect(JSON.stringify([...response.headers])).not.toMatch(/saved-calendar|private-access|private-refresh/);
});

test.each(['test','development','staging'])('the explicit production probe is unavailable in %s', async environment => {
  port.environment = environment;
  expect((await post({action:'add',verify_room:true})).status).toBe(400);
  expect(port.probe).not.toHaveBeenCalled();
});

test('ordinary production consent still saves the account without authorizing a room check', async () => {
  port.environment = 'production';
  const response = await grant({action:'add'});
  expect(response.headers.get('location')).toBe(origin+'/admin/integrations?calendar=connected');
  expect(port.probe).not.toHaveBeenCalled();
  expect(port.query).toHaveBeenCalledTimes(1);
});

test.each(['inconclusive','probe-error','stale-grant','missing-calendar','preview-database'])('a saved account needs another check after %s', async problem => {
  port.environment='production';
  port.query.mockResolvedValueOnce({rowCount:1,rows:[{data:{connection_id:target,version:8,verification_allowed:problem!=='preview-database',integration_state:'verification_required',
    ...(problem==='missing-calendar'?{}:{calendar_id:'primary'})}}]});
  port.probe.mockResolvedValue(problem==='stale-grant');
  if (problem==='probe-error') port.probe.mockRejectedValueOnce(new Error('sensitive upstream body'));
  if (problem==='stale-grant') port.query.mockRejectedValueOnce(new Error('VERSION_CONFLICT'));
  const response = await grant({action:'add',verify_room:true});
  expect(response.headers.get('location')).toBe(origin+'/admin/integrations?calendar=check_required');
  expect(port.query.mock.calls[0][0]).toContain('record_calendar_organizer');
  expect(port.query).toHaveBeenCalledTimes(problem==='stale-grant'?2:1);
  expect(port.probe).toHaveBeenCalledTimes(['missing-calendar','preview-database'].includes(problem)?0:1);
});
