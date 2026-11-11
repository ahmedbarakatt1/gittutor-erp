import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { assertIsolatedTarget, localDatabaseUrl } from '../tests/helpers/environment';

export async function migrate(connectionString: string, environment = process.env.APP_ENV ?? 'development') {
  assertIsolatedTarget({ connectionString, environment });
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('gittutor:migration'))");
    // This is a native-local runner. Never reserve Supabase CLI's own history namespace.
    const legacy = await client.query("select to_regclass('supabase_migrations.schema_migrations') as old_history,to_regnamespace('git_tutor_migrations') as new_schema");
    if (legacy.rows[0].old_history) {
      const columns = await client.query("select column_name from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by column_name");
      const tables = await client.query("select count(*)::int as count from information_schema.tables where table_schema='supabase_migrations'");
      const marker = await client.query("select fixture_marker from app_private.environment_metadata where singleton");
      if (legacy.rows[0].new_schema || columns.rows.map(row => row.column_name).join(',') !== 'applied_at,checksum,version' || tables.rows[0].count !== 1 || marker.rows[0]?.fixture_marker !== 'git-tutor-disposable-v1') {
        throw new Error('UNRECOGNIZED_MIGRATION_HISTORY: refusing to modify Supabase-owned history');
      }
      await client.query('begin');
      try {
        await client.query('alter schema supabase_migrations rename to git_tutor_migrations');
        await client.query('alter table git_tutor_migrations.schema_migrations rename to applied_migrations');
        await client.query('commit');
        console.log('Preserved native-local migration history in git_tutor_migrations.applied_migrations.');
      } catch (error) { await client.query('rollback'); throw error; }
    }
    await client.query('create schema if not exists git_tutor_migrations');
    await client.query('create table if not exists git_tutor_migrations.applied_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())');
    const files = (await readdir(resolve('supabase/migrations'))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const file of files) {
      const sql = await readFile(resolve('supabase/migrations', file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('select checksum from git_tutor_migrations.applied_migrations where version=$1', [file]);
      if (previous.rowCount) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_CHANGED: ${file}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into git_tutor_migrations.applied_migrations(version,checksum) values($1,$2)', [file, checksum]);
        await client.query('commit');
        console.log(`Applied ${file}`);
      } catch (error) { await client.query('rollback'); throw error; }
    }
    const manifest = JSON.parse((await readFile(resolve('.local/database.json'), 'utf8')).replace(/^\uFEFF/, '')) as { worker_password: string };
    if (!/^[a-f0-9]{32}$/.test(manifest.worker_password)) throw new Error('INVALID_LOCAL_CREDENTIAL');
    await client.query(`alter role git_tutor_worker login password '${manifest.worker_password}'`);
    await client.query("insert into app_private.environment_metadata(singleton,environment,fixture_marker) values(true,$1,'git-tutor-disposable-v1') on conflict(singleton) do nothing", [environment]);
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('gittutor:migration'))").catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.DATABASE_URL) await migrate(process.env.DATABASE_URL);
  else for (const database of ['gittutor_dev', 'gittutor_test']) {
    await migrate(localDatabaseUrl(database), database === 'gittutor_test' ? 'test' : (process.env.APP_ENV ?? 'development'));
  }
}
