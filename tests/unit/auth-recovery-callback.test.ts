import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { expect, test, vi } from 'vitest';
import { GET, HEAD, POST } from '../../src/app/auth/callback/route';

const auth = vi.hoisted(() => ({ getSession: vi.fn(async () => ({data:{session:null},error:null})), exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  client: { auth }, config: { app_base_url: 'https://gittutor.example', isolated: false },
  finish: (response: Response) => response,
}) }));

test.each([['recovery', '/auth/set-password'], [null, '/learn']])(
  'uses the verified code exchange flow %s for default provider email links', async (redirectType, path) => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType }, error: null });
    const response = await GET(new NextRequest('https://gittutor.example/auth/callback?code=synthetic-code'));
    expect(response.headers.get('location')).toBe('https://gittutor.example' + path);
  },
);

const invitationId = '9e577815-c4cc-4eb8-b87c-df21cb37a882';
const tokenHash = 'a'.repeat(64);
const origin = 'https://gittutor.example';

function confirm(action: string, source = origin, fetchSite = 'same-origin') {
  return POST(new NextRequest(action, {
    method: 'POST', body: 'confirm=yes',
    headers: { origin: source, 'sec-fetch-site': fetchSite, 'content-type': 'application/x-www-form-urlencoded' },
  }));
}

test.each([
  ['confirmation', 'email', false, '/learn'],
  ['recovery', 'recovery', false, '/auth/set-password'],
  ['invite', 'invite', false, '/auth/set-password'],
  ['invite', 'invite', true, '/auth/set-password?staff_invitation_id=' + invitationId],
] as const)('routes the %s email action (type %s, staff %s) through the verified callback', async (template, type, staff, destination) => {
  const html = readFileSync(`supabase/templates/${template}.html`, 'utf8');
  expect(html).toContain('lang="ar" dir="rtl"');
  expect(html).not.toMatch(/<(?:img|script|iframe)\b/i);
  const actions = [...html.matchAll(/<a href="([^"]+)"/g)];
  expect(actions).toHaveLength(1);
  const action = actions[0][1]
    .replace(/{{ if \.Data\.staff_invitation_id }}(.*?){{ end }}/g, staff ? '$1' : '')
    .replace('{{ .SiteURL }}', origin)
    .replace('{{ .TokenHash }}', tokenHash)
    .replace('{{ .Data.staff_invitation_id }}', invitationId)
    .replaceAll('&amp;', '&');
  expect(new URL(action).pathname).toBe('/auth/callback');
  expect(new URL(action).origin).toBe(origin);
  auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'synthetic' } }, error: null });
  auth.verifyOtp.mockClear();
  const preview = await GET(new NextRequest(action));
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toContain('no-store');
  expect(preview.headers.get('referrer-policy')).toBe('no-referrer');
  expect(preview.headers.get('content-security-policy')).toContain("default-src 'none'");
  const document = await preview.text();
  expect(document).toContain('<form method="post">');
  expect(document).not.toContain(tokenHash);
  expect(document).not.toContain(invitationId);
  expect(await HEAD().text()).toBe('');
  expect(auth.verifyOtp).not.toHaveBeenCalled();
  const result = await confirm(action);
  expect(auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: tokenHash, type });
  expect(result.status).toBe(303);
  expect(result.headers.get('location')).toBe(origin + destination);
});

test('an expired email action returns to sign-in without creating a session', async () => {
  auth.verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' } });
  const result = await confirm(origin + '/auth/callback?type=recovery&token_hash=' + tokenHash, 'null');
  expect(result.headers.get('location')).toBe(origin + '/login?reason=verification');
});

test.each([['https://elsewhere.example', 'cross-site'], ['null', 'cross-site'], [origin, 'same-site'], ['null', '']])(
  'rejects untrusted form submissions (%s, %s) before verifying a token', async (source, site) => {
    auth.verifyOtp.mockClear();
    const result = await confirm(origin + '/auth/callback?type=recovery&token_hash=' + tokenHash, source, site);
    expect(result.status).toBe(403);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  },
);

test('an oversized form without a declared size leaves the email token unused', async () => {
  auth.verifyOtp.mockClear();
  const request = new NextRequest(origin + '/auth/callback?type=recovery&token_hash=' + tokenHash, {
    method: 'POST', body: 'confirm=yes' + 'x'.repeat(1024),
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect((await POST(request)).headers.get('location')).toBe(origin + '/login?reason=verification');
  expect(auth.verifyOtp).not.toHaveBeenCalled();
});

test('a change of account between the email preview and confirmation leaves the link unused', async () => {
  const url = origin + '/auth/callback?type=recovery&token_hash=' + tokenHash;
  const first = 'sb-example-auth-token.0=synthetic-first';
  const preview = await GET(new NextRequest(url, { headers: { cookie: first } }));
  const html = await preview.text();
  expect(html).not.toContain('synthetic-first');
  const view = html.match(/name="view" value="([a-f0-9]{64})"/)?.[1];
  expect(view).toBeTruthy();
  auth.verifyOtp.mockClear();
  const result = await POST(new NextRequest(url, { method:'POST', body:`view=${view}&confirm=yes`,
    headers:{origin, cookie:'sb-example-auth-token.0=synthetic-second','content-type':'application/x-www-form-urlencoded'} }));
  expect(result.headers.get('location')).toBe(origin+'/login?reason=verification');
  expect(auth.verifyOtp).not.toHaveBeenCalled();
});
