import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { expect, test, vi } from 'vitest';
import { GET } from '../../src/app/auth/callback/route';

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }));
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
  auth.verifyOtp.mockResolvedValue({ error: null });
  const result = await GET(new NextRequest(action));
  expect(auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: tokenHash, type });
  expect(result.headers.get('location')).toBe(origin + destination);
});

test('an expired email action returns to sign-in without creating a session', async () => {
  auth.verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' } });
  const result = await GET(new NextRequest(origin + '/auth/callback?type=recovery&token_hash=' + tokenHash));
  expect(result.headers.get('location')).toBe(origin + '/login?reason=verification');
});
