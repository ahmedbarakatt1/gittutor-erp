import { expect, test } from 'vitest';
import { adminDatabase } from '../helpers/supabase';
import { readWorkerFunctionBoundary, workerFunctionsAreRestricted } from '../../tools/production-worker-boundary';

test('production worker preflight detects missing, excess and inherited RPC grants against PostgreSQL', async () => {
  const database = await adminDatabase();
  try {
    expect(workerFunctionsAreRestricted(await readWorkerFunctionBoundary(database))).toBe(true);
    // Catalog changes are visible only inside this transaction and always rolled back.
    await database.query('begin');
    await database.query('savepoint original');
    for (const mutation of [
      'revoke execute on function app_private.claim_jobs(text,integer,integer) from git_tutor_worker',
      'grant execute on function app_private.auth_account(uuid) to git_tutor_worker',
      'grant execute on function app_private.auth_account(uuid) to public',
      'grant git_tutor_commands to git_tutor_worker',
    ]) {
      await database.query(mutation);
      expect(workerFunctionsAreRestricted(await readWorkerFunctionBoundary(database)), mutation).toBe(false);
      await database.query('rollback to savepoint original');
    }
    expect(workerFunctionsAreRestricted(await readWorkerFunctionBoundary(database))).toBe(true);
  } finally { await database.query('rollback'); await database.end(); }
});
