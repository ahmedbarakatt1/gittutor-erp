import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertIsolatedTarget, localDatabaseUrl } from '../tests/helpers/environment';

export async function verifyDatabaseBoundary(connectionString: string) {
assertIsolatedTarget({ connectionString, environment: process.env.APP_ENV || 'test' });
const client = new Client({ connectionString });
await client.connect();
try {
  const failures: string[] = [];
  for (const schema of ['api', 'app_private', 'finance_private', 'git_tutor_migrations']) {
    if (!(await client.query('select to_regnamespace($1) as oid', [schema])).rows[0].oid) failures.push(`Missing schema: ${schema}`);
  }
  const requiredTables = ['environment_metadata', 'synthetic_fixture_registry', 'command_results', 'audit_events', 'domain_events', 'outbox_jobs', 'job_attempts'];
  for (const table of requiredTables) {
    if (!(await client.query('select to_regclass($1) as oid', [`app_private.${table}`])).rows[0].oid) failures.push(`Missing table: ${table}`);
  }
  if (!(await client.query("select to_regclass('git_tutor_migrations.applied_migrations') as oid")).rows[0].oid) failures.push('Missing local migration history');
  const requiredFunctions = ['reject_immutable_change()', 'enqueue_event(uuid,text,uuid,jsonb,text)', 'claim_jobs(text,integer,integer)', 'complete_job(uuid,uuid,text)', 'fail_job(uuid,uuid,text,boolean)'];
  for (const fn of requiredFunctions) {
    if (!(await client.query('select to_regprocedure($1) as oid', [`app_private.${fn}`])).rows[0].oid) failures.push(`Missing function: ${fn}`);
  }
  if (failures.length) throw new Error(`DATABASE_FOUNDATION_MISSING: ${failures.join('; ')}`);
  const migrations = (await readdir('supabase/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  if (!migrations.length) throw new Error('DATABASE_FOUNDATION_MISSING: no versioned migrations');
  for (const migration of migrations) {
    const row = (await client.query('select checksum from git_tutor_migrations.applied_migrations where version=$1', [migration])).rows[0];
    const checksum = createHash('sha256').update(await readFile(resolve('supabase/migrations', migration), 'utf8')).digest('hex');
    if (!row || row.checksum !== checksum) failures.push(`Missing or changed migration: ${migration}`);
  }
  for (const fn of requiredFunctions.slice(2)) {
    if (!(await client.query("select has_function_privilege('git_tutor_worker',$1,'EXECUTE') as allowed", [`app_private.${fn}`])).rows[0].allowed) failures.push(`Worker grant missing: ${fn}`);
  }
  const tables = await client.query("select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app_private','finance_private','api') and c.relkind='r'");
  for (const table of tables.rows) {
    if (!table.relrowsecurity) failures.push(`RLS absent: ${table.nspname}.${table.relname}`);
    for (const role of ['anon', 'authenticated']) {
      const access = await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed", [role, `${table.nspname}.${table.relname}`]);
      if (access.rows[0].allowed) failures.push(`Raw privilege: ${role} ${table.relname}`);
    }
  }
  const functions = await client.query("select p.oid,p.proname,p.prosecdef,p.proconfig,n.nspname,r.rolname,r.rolcanlogin,r.rolbypassrls from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in ('app_private','api','finance_private')");
  for (const fn of functions.rows) {
    if (fn.prosecdef && (fn.rolcanlogin || fn.rolbypassrls)) failures.push(`Definer owner must be NOLOGIN/NOBYPASSRLS: ${fn.proname}`);
    if (fn.prosecdef && !fn.proconfig?.includes('search_path=""')) failures.push(`Unfixed search path: ${fn.proname}`);
    const granted = await client.query("select has_function_privilege('anon',$1,'EXECUTE') as allowed", [fn.oid]);
    const publicReads = ['list_public_offers', 'get_public_tutor'];
    if (granted.rows[0].allowed && !(fn.nspname === 'api' && publicReads.includes(fn.proname))) failures.push(`Unexpected anon function: ${fn.proname}`);
    if (fn.nspname !== 'api' && (await client.query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed", [fn.oid])).rows[0].allowed) failures.push(`Unexpected authenticated private function: ${fn.proname}`);
  }
  const config = await readFile('supabase/config.toml', 'utf8');
  if (!/^schemas = \["api"\]$/m.test(config)) failures.push('Only api schema may be exposed');
  if (failures.length) throw new Error(failures.join('\n'));
  const result = { tables: tables.rowCount, functions: functions.rowCount };
  console.log(`Database verification passed: ${result.tables} private tables with RLS, ${result.functions} functions checked, api-only exposure.`);
  return result;
} finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyDatabaseBoundary(process.env.TEST_DATABASE_URL || localDatabaseUrl('gittutor_test'));
}
