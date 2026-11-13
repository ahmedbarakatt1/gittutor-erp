import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ store: { getAll: () => [], set: vi.fn() } }));
vi.mock('next/headers', () => ({ cookies: async () => state.store }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookieOptions: CookieOptions;
    cookies: { setAll: (values: { name: string; value: string; options: CookieOptions }[], headers: Record<string, string>) => void };
  }) => {
    options.cookies.setAll([{ name: 'auth-test', value: 'synthetic-session', options: options.cookieOptions }], { 'Cache-Control': 'private, no-store' });
    return {};
  },
}));
import { requestSupabase, serverSupabase } from '../../src/server/supabase';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

test.each([
  ['https://preview.example.test', true],
  ['http://127.0.0.1:3000', false],
])('session transport follows configured %s even with fake providers', async (origin, secure) => {
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('APP_BASE_URL', origin);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
  // The internal hop remains HTTP; never infer browser transport from the proxy request.
  const transport = requestSupabase(new NextRequest('http://127.0.0.1:3001/api/auth/login'));
  const response = transport.finish(NextResponse.json({ ok: true }));
  expect(response.cookies.get('auth-test')).toMatchObject({ secure, httpOnly: true, sameSite: 'lax', path: '/' });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  await serverSupabase();
  expect(state.store.set).toHaveBeenCalledWith('auth-test', 'synthetic-session', expect.objectContaining({ secure, httpOnly: true, sameSite: 'lax', path: '/' }));
});
