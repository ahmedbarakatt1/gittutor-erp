import { expect, test } from 'vitest';
import { customerReturnPath } from '../../src/modules/identity/return-path';

const learner = 'c66002a8-1587-467f-b705-d7bf65294970';
const contract = 'ab915e6c-c35f-4b42-9242-14d71f386cfb';

test('sign-in returns to a published catalog detail by ID', () => {
  for (const category of ['offers', 'tutors']) {
    expect(customerReturnPath(`/${category}/${contract}`)).toBe(`/${category}/${contract}`);
    expect(customerReturnPath(`/${category}/unpublished`)).toBeUndefined();
  }
});

test('customer sign-in intent preserves bounded package selection and detail paths', () => {
  expect(customerReturnPath('/learn/packages')).toBe('/learn/packages');
  expect(customerReturnPath(`/learn/packages?contract=${contract}&learner=${learner}`))
    .toBe(`/learn/packages?learner=${learner}&contract=${contract}`);
  expect(customerReturnPath(`/learn/packages/${contract}`)).toBe(`/learn/packages/${contract}`);
  expect(customerReturnPath(`/learn/bookings?offer=${contract}`)).toBe(`/learn/bookings?offer=${contract}`);
});

test('package sign-in intent rejects arbitrary routes, privileged actions and ambiguous inputs', () => {
  for (const value of [undefined, null, 5, ['/learn/packages'], '//evil.example/learn/packages',
    'https://evil.example/learn/packages', '/admin/packages', '/learn/packages/../admin',
    '/learn/packages#fragment', '/learn/packages\n', '/learn/packages?next=/admin',
    `/learn/packages?learner=${learner}&learner=${learner}`, '/learn/packages?learner=invalid',
    `/learn/packages?learner=${learner}&role=admin`, '/learn/packages/not-a-uuid',
    `/learn/packages/${contract}/renew`, `/learn/packages/${contract}?learner=${learner}`,
    `/learn/packages/${contract}/`, '/learn/packages/%2e%2e', '/learn\\packages',
    '/learn/packages?contract=' + 'a'.repeat(600),
  ]) expect(customerReturnPath(value)).toBeUndefined();
});
