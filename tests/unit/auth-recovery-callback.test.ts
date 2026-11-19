import { NextRequest } from 'next/server';
import { expect, test, vi } from 'vitest';
import { GET } from '../../src/app/auth/callback/route';

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
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
