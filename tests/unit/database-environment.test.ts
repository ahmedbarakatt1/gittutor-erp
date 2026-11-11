import { afterEach, expect, test, vi } from 'vitest';
import { localDatabaseUrl, testDatabaseUrl } from '../helpers/environment';

afterEach(() => { vi.unstubAllEnvs(); });

test('integration target refuses a development database even on the isolated local cluster', () => {
  vi.stubEnv('TEST_DATABASE_URL', localDatabaseUrl('gittutor_dev'));
  expect(() => testDatabaseUrl()).toThrow('TEST_DATABASE_REQUIRED');
});
