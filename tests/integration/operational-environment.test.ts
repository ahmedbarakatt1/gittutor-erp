import { afterAll, beforeAll, expect, test } from 'vitest';
import { adminDatabase } from '../helpers/supabase';

let database: Awaited<ReturnType<typeof adminDatabase>>;
let original: { environment: string; fixture_marker: string };
beforeAll(async () => {
  database = await adminDatabase();
  original = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
});
afterAll(async () => { await database?.end(); });

test.each([
  ['development', 'git-tutor-operational-preview-v1', true],
  ['test', 'git-tutor-operational-preview-v1', false],
  ['development', 'unrecognized-synthetic-marker', false],
  ['test', 'git-tutor-supabase-local-v1', true],
  ['staging', 'unrecognized-synthetic-marker', true],
  ['production', 'unrecognized-synthetic-marker', true],
] as const)('catalog environment guard: %s / %s', async (environment, marker, allowed) => {
  // Uncommitted metadata is visible only to this connection. Always roll back.
  await database.query('begin');
  try {
    await database.query('update app_private.environment_metadata set environment=$1,fixture_marker=$2 where singleton', [environment, marker]);
    if (allowed) expect((await database.query('select app_private.catalog_environment() value')).rows[0].value).toBe(environment);
    else await expect(database.query('select app_private.catalog_environment()')).rejects.toMatchObject({ message: 'DEPENDENCY_UNAVAILABLE' });
  } finally { await database.query('rollback'); }
  expect((await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0]).toEqual(original);
});
