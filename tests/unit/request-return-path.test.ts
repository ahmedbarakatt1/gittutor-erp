import { expect, test } from 'vitest';
import { customerReturnPath } from '../../src/modules/identity/return-path';

test('request subject and draft survive authentication using a narrow internal return path', () => {
  expect(customerReturnPath('/learn/requests')).toBe('/learn/requests');
  expect(customerReturnPath('/learn/requests?topic=Computer%20Science')).toBe('/learn/requests?topic=Computer+Science');
  expect(customerReturnPath('/learn/requests?request=313fe9f0-fb6d-4de2-8ed4-b8732fde68a9')).toContain('request=313fe9f0');
  for (const path of ['//evil.test/learn/requests', '/learn/requests/../admin', '/learn/requests?return_to=https://evil.test', '/learn/requests?request=wrong', '/learn/requests?topic=A&topic=B', '/learn/requests?topic=%00', '/learn/requests#evil']) expect(customerReturnPath(path)).toBeUndefined();
});
