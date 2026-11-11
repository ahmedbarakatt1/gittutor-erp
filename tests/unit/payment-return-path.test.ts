import { expect, test } from 'vitest';
import { customerReturnPath } from '../../src/modules/identity/return-path';
const id = 'bb02c2b2-a620-4e16-b324-03dc806673f0';
test('verified payer money journeys survive sign-in through exact bounded local paths', () => {
  for (const path of ['/learn/payments', '/learn/refunds', `/learn/payments/${id}`, `/learn/payments/charges/${id}`, `/learn/payments/transfers/${id}`, `/learn/payments/plans/${id}`, `/learn/refunds/${id}`]) expect(customerReturnPath(path)).toBe(path);
});
test('payer sign-in continuation never accepts arbitrary queries, actions or external destinations', () => {
  for (const path of ['//evil.test/learn/payments', '/learn/payments?next=https://evil.test', `/learn/payments/${id}/approve`, `/learn/payments/charges/${id}?actor=admin`, '/learn/payments/charges/no-id', `/learn/refunds/${id}#token`, '/admin/refunds']) expect(customerReturnPath(path)).toBeUndefined();
});
