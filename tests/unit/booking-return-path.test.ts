import { expect, test } from 'vitest';
import { bookingReturnPath } from '../../src/modules/identity/return-path';

const offer = 'c66002a8-1587-467f-b705-d7bf65294970';
const occurrence = 'ab915e6c-c35f-4b42-9242-14d71f386cfb';

test('booking sign-in intent retains only canonical customer booking paths and UUID selections', () => {
  expect(bookingReturnPath('/learn/bookings')).toBe('/learn/bookings');
  expect(bookingReturnPath(`/learn/bookings?offer=${offer}`)).toBe(`/learn/bookings?offer=${offer}`);
  expect(bookingReturnPath(`/learn/bookings?occurrence=${occurrence}&offer=${offer}`))
    .toBe(`/learn/bookings?offer=${offer}&occurrence=${occurrence}`);
});

test('booking sign-in intent rejects external, ambiguous, privileged and malformed paths', () => {
  for (const value of [undefined, null, 7, ['/learn/bookings'], '', '//evil.example/learn/bookings',
    'https://evil.example/learn/bookings', '/admin', '/learn/bookings/../admin',
    '/learn/bookings#ignored', '/learn/bookings\n', '/learn/bookings?next=https://evil.example',
    `/learn/bookings?offer=${offer}?ignored`,
    `/learn/bookings?offer=${offer}&offer=${offer}`, `/learn/bookings?occurrence=${occurrence}`,
    '/learn/bookings?offer=not-a-uuid', `/learn/bookings?offer=${offer}&role=admin`,
    '/learn/bookings?offer=%2563666002a8-1587-467f-b705-d7bf65294970',
    '/learn/bookings?offer=' + 'a'.repeat(600), '/learn\\bookings',
  ]) expect(bookingReturnPath(value)).toBeUndefined();
});
