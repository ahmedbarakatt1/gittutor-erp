import { beforeEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortalShell } from '../../src/components/portal-shell';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ account: { account_id: '50a7291f-829f-439a-9719-f8b3225ed77f', verified: true, roles: [] as string[], locale: 'en', authorized_learner_ids: [] }, signedIn: true }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock('../../src/server/supabase', () => ({ AuthUnavailableError: class AuthUnavailableError extends Error {}, serverSupabase: async () => ({ auth: { getClaims: async () => ({ data: state.signedIn ? { claims: { sub: state.account.account_id } } : null, error: null }) }, rpc: async () => ({ data: state.account, error: null }) }) }));
import { requireAccount } from '../../src/server/auth';

beforeEach(() => { state.account.roles = []; state.account.verified = true; state.signedIn = true; });
test('verified original payer may enter own-money shell with no current learner or staff role', async () => {
  await expect(requireAccount(undefined, '/learn/payments')).resolves.toMatchObject({ roles: [], authorized_learner_ids: [], verified: true });
});
test('explicit learner and staff guards still deny the roleless account', async () => {
  await expect(requireAccount('student')).rejects.toThrow('REDIRECT:/login?reason=forbidden');
  await expect(requireAccount('admin')).rejects.toThrow('REDIRECT:/login?reason=forbidden');
});
test('guardian retains the explicit learner-workspace compatibility rule', async () => {
  state.account.roles = ['guardian']; await expect(requireAccount('student')).resolves.toMatchObject({ roles: ['guardian'] });
});
test('staff-only accounts following a learner link reach their own workspace', async () => {
  for (const [role, destination] of [['admin', '/admin'], ['tutor', '/tutor'], ['customer_service', '/service']]) {
    state.account.roles = [role];
    await expect(requireAccount('student', '/learn/requests?topic=Math')).rejects.toThrow(`REDIRECT:${destination}`);
    await expect(requireAccount(undefined, '/learn/payments')).resolves.toMatchObject({ roles: [role] });
  }
  state.account.roles = ['admin', 'guardian'];
  await expect(requireAccount('student', '/learn/grades')).resolves.toMatchObject({ roles: ['admin', 'guardian'] });
});
test('shared account pages offer personal receipts and the authorized admin workspace', async () => {
  state.account.roles = ['admin'];
  const account = await requireAccount(undefined, '/learn/payments');
  const html = renderToStaticMarkup(createElement(PortalShell, {
    kind: 'learn', account, title: 'Payments', activePath: '/learn/payments', showAccount: false,
  }));
  expect(html).toContain('aria-label="Account"');
  for (const path of ['/learn/payments', '/learn/refunds', '/learn/support', '/admin']) expect(html).toContain(`href="${path}"`);
  for (const path of ['/learn/files', '/learn/exports', '/learn/bookings']) expect(html).not.toContain(`href="${path}"`);
});
test('own-money shell still rejects an absent session or unverified account', async () => {
  state.signedIn = false; await expect(requireAccount(undefined, '/learn/refunds')).rejects.toThrow('REDIRECT:/login?return_to=%2Flearn%2Frefunds');
  state.signedIn = true; state.account.verified = false; await expect(requireAccount(undefined, '/learn/refunds')).rejects.toThrow('REDIRECT:/login?return_to=%2Flearn%2Frefunds');
});
