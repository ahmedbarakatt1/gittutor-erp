/** Separate actual-data preview. Copies schema only; never resets or copies demo rows. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';

const execute = promisify(execFile);
const directory = resolve('.local/operational-preview');
const project = 'GitTutor_Operational_Preview';
const container = `supabase_db_${project}`;
const marker = 'git-tutor-operational-preview-v1';
const excluded = 'realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta';
const cliPath = resolve('node_modules/supabase/dist/supabase.js');
type Configuration = { marker: typeof marker; url: string; publishable_key: string; secret_key: string; database_url: string; worker_database_url: string; secret_encryption_key: string; node_path: string };

async function cli(args: string[], label: string) {
  try {
    const result = await execute(process.execPath, [cliPath, ...args, '--workdir', directory], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    await writeFile(resolve(directory, `${label}.log`), result.stderr, { mode: 0o600 });
    return result.stdout;
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string };
    await writeFile(resolve(directory, `${label}.log`), `${detail.stdout || ''}\n${detail.stderr || ''}`, { mode: 0o600 });
    throw Error(`OPERATIONAL_BACKEND_${label.toUpperCase()}_FAILED; inspect private log`);
  }
}
async function docker(args: string[]) {
  return (await execute('docker', args, { timeout: 180_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true })).stdout;
}
async function extensionGrants(source: Client, target: Client) {
  // Schema-selective dumps omit ACLs owned by the managed extensions schema.
  // Reproduce only existing application-role privileges, never browser grants.
  const grants = (await source.query("select r.rolname,a.privilege_type from pg_namespace n cross join lateral aclexplode(n.nspacl) a join pg_roles r on r.oid=a.grantee where n.nspname='extensions' and r.rolname like 'git_tutor_%'")).rows;
  for (const grant of grants) {
    assert.match(grant.rolname, /^git_tutor_[a-z_]+$/); assert(['USAGE', 'CREATE'].includes(grant.privilege_type));
    await target.query(`grant ${grant.privilege_type} on schema extensions to ${grant.rolname}`);
  }
  const functions = (await source.query("select p.oid::regprocedure::text signature,r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee where n.nspname='extensions' and r.rolname like 'git_tutor_%' and a.privilege_type='EXECUTE'")).rows;
  for (const fn of functions) {
    assert.match(fn.rolname, /^git_tutor_[a-z_]+$/); assert(fn.signature.startsWith('extensions.'));
    await target.query(`grant execute on function ${fn.signature} to ${fn.rolname}`);
  }
}
async function validationContracts(source: Client, target: Client) {
  // Immutable JSON validation schemas are application definitions, not demo/customer rows.
  const contracts = (await source.query('select schema_version,document from app_private.catalog_validation_schemas order by schema_version')).rows;
  for (const contract of contracts) {
    await target.query('insert into app_private.catalog_validation_schemas(schema_version,document) values($1,$2) on conflict(schema_version) do nothing', [contract.schema_version, contract.document]);
    assert.deepEqual((await target.query('select document from app_private.catalog_validation_schemas where schema_version=$1', [contract.schema_version])).rows[0].document, contract.document, 'Validation contract conflict');
  }
}
async function configuration(): Promise<Configuration> {
  const status = JSON.parse(await cli(['status', '--output', 'json'], 'status')) as Record<string, string>;
  const db = new URL(status.DB_URL); db.hostname = '127.0.0.1';
  assert.equal(db.port, '54332'); assert.equal(db.pathname, '/postgres');
  const api = new URL(status.API_URL); assert(['127.0.0.1', 'localhost'].includes(api.hostname)); assert.equal(api.port, '54331');
  let previous: Configuration | undefined;
  try { previous = JSON.parse(await readFile(resolve(directory, 'config.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous) assert.equal(previous.marker, marker);
  const worker = new URL(db); worker.username = 'git_tutor_worker'; worker.password = previous ? new URL(previous.worker_database_url).password : randomBytes(32).toString('hex');
  const config: Configuration = { marker, url: api.origin, publishable_key: status.PUBLISHABLE_KEY || status.ANON_KEY,
    secret_key: status.SECRET_KEY || status.SERVICE_ROLE_KEY, database_url: db.toString(), worker_database_url: worker.toString(),
    secret_encryption_key: previous?.secret_encryption_key || randomBytes(32).toString('hex'), node_path: process.execPath };
  await writeFile(resolve(directory, 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}

async function bootstrap() {
  await mkdir(resolve(directory, 'supabase/templates'), { recursive: true });
  let config = await readFile('supabase/config.toml', 'utf8');
  config = config.replace('project_id = "GitTutor_System"', `project_id = "${project}"`)
    .replace(/5432(\d)/g, '5433$1');
  await writeFile(resolve(directory, 'supabase/config.toml'), config);
  for (const file of await readdir('supabase/templates')) {
    if (file.endsWith('.html')) await writeFile(resolve(directory, 'supabase/templates', file), await readFile(resolve('supabase/templates', file)));
  }
  const network = 'gittutor_operational_isolated';
  try {
    const options = JSON.parse(await docker(['network', 'inspect', network, '--format', '{{json .Options}}']));
    assert.equal(options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    await docker(['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', 'com.git-tutor.scope=operational-preview', network]);
  }
  await cli(['start', '--network-id', network, '--exclude', `postgrest,${excluded}`], 'start-foundation');
  const saved = await configuration();
  await cloneSchema(saved);
  // An initial REST start requires the api schema. Stop/start preserves this project's volumes.
  await cli(['stop'], 'stop-foundation');
  await cli(['start', '--network-id', network, '--exclude', excluded], 'start');
  await configuration();
  console.log('Separate operational backend ready on loopback API 54331 / database 54332. No demo rows copied.');
}

async function cloneSchema(config: Configuration) {
  const sourceConfig = JSON.parse(await readFile('.local/supabase.json', 'utf8')) as { database_url: string; marker: string };
  assert.equal(sourceConfig.marker, 'git-tutor-supabase-local-v1');
  const sourceUrl = new URL(sourceConfig.database_url); assert.equal(sourceUrl.hostname, '127.0.0.1'); assert.equal(sourceUrl.port, '54322');
  const labels = JSON.parse(await docker(['inspect', container, '--format', '{{json .Config.Labels}}']));
  assert.equal(labels['com.supabase.cli.project'], project);
  const source = new Client({ connectionString: sourceUrl.toString() }); const target = new Client({ connectionString: config.database_url });
  await source.connect(); await target.connect();
  try {
    const exists = (await target.query("select to_regclass('app_private.environment_metadata') id")).rows[0].id;
    if (exists) {
      const state = (await target.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
      assert.equal(state?.fixture_marker, marker); assert.equal(state?.environment, 'development');
      await extensionGrants(source, target);
      await validationContracts(source, target);
      console.log('Existing operational schema and data preserved.'); return;
    }
    assert.equal(Number((await target.query('select count(*) n from auth.users')).rows[0].n), 0, 'Fresh project required for schema bootstrap');
    assert.equal(Number((await target.query("select count(*) n from pg_tables where schemaname in ('api','app_private','finance_private')")).rows[0].n), 0);
    const roles = (await source.query("select rolname from pg_roles where rolname like 'git_tutor_%' order by rolname")).rows as { rolname: string }[];
    for (const role of roles) {
      assert.match(role.rolname, /^git_tutor_[a-z_]+$/);
      await target.query(`create role ${role.rolname} nologin nobypassrls`);
      await target.query(`grant ${role.rolname} to postgres`);
    }
    const memberships = (await source.query("select parent.rolname parent,member.rolname member from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member where parent.rolname like 'git_tutor_%' and member.rolname like 'git_tutor_%'")).rows;
    for (const membership of memberships) {
      assert.match(membership.parent, /^git_tutor_[a-z_]+$/); assert.match(membership.member, /^git_tutor_[a-z_]+$/);
      await target.query(`grant ${membership.parent} to ${membership.member}`);
    }
    await target.query('create extension if not exists pgcrypto with schema extensions; create extension if not exists btree_gist with schema extensions; create extension if not exists pg_jsonschema with schema extensions;');
    await extensionGrants(source, target);
    const archive = '/tmp/gittutor-operational-schema.dump';
    await docker(['exec', 'supabase_db_GitTutor_System', 'pg_dump', '--username=postgres', '--dbname=postgres', '--schema-only', '--format=custom', '--schema=api', '--schema=app_private', '--schema=finance_private', `--file=${archive}`]);
    await docker(['cp', `supabase_db_GitTutor_System:${archive}`, resolve(directory, 'schema.dump')]);
    await docker(['cp', resolve(directory, 'schema.dump'), `${container}:${archive}`]);
    try { await docker(['exec', container, 'pg_restore', '--username=supabase_admin', '--dbname=postgres', '--exit-on-error', '--single-transaction', archive]); }
    catch (error) {
      await writeFile(resolve(directory, 'restore-error.log'), String((error as { stderr?: string }).stderr || 'Schema restore failed'), { mode: 0o600 });
      throw Error('SCHEMA_RESTORE_FAILED; inspect private restore-error.log');
    }
    await validationContracts(source, target);
    // Auth-owned triggers are not part of a schema-selective archive.
    const triggers = (await source.query("select pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where n.nspname='auth' and pn.nspname='app_private' and not t.tgisinternal")).rows;
    for (const trigger of triggers) await target.query(trigger.definition);
    await target.query("insert into app_private.environment_metadata(singleton,environment,fixture_marker) values(true,'development',$1)", [marker]);
    const worker = new URL(config.worker_database_url);
    const passwordSql = (await target.query("select format('alter role git_tutor_worker login password %L',$1::text) sql", [decodeURIComponent(worker.password)])).rows[0].sql;
    await target.query(passwordSql);
    const migrations = (await source.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
    await target.query('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text)');
    for (const item of migrations) await target.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [item.version, item.name, item.statements]);
    const bucket = (await source.query("select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='git-tutor-private'")).rows[0];
    assert(bucket && !bucket.public, 'Private file bucket required');
    await target.query('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$2,false,$3,$4)', [bucket.id, bucket.name, bucket.file_size_limit, bucket.allowed_mime_types]);
    await target.query("notify pgrst,'reload schema'");
    const unsafe = (await target.query("select count(*)::int n from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname in ('app_private','finance_private') and (not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))")).rows[0].n;
    assert.equal(unsafe, 0);
    await writeFile(resolve(directory, 'bootstrap-report.json'), JSON.stringify({ source: 'schema only', migrations: migrations.length, auth_triggers: triggers.length, roles: roles.length, raw_customer_grants: unsafe, demo_rows_copied: 0, completed_at: new Date().toISOString() }, null, 2));
  } finally { await source.end(); await target.end(); }
}

if (process.argv.includes('--repair-prerequisites')) {
  const saved = JSON.parse(await readFile(resolve(directory, 'config.json'), 'utf8')) as Configuration;
  assert.equal(saved.marker, marker); assert.equal(new URL(saved.database_url).hostname, '127.0.0.1'); assert.equal(new URL(saved.database_url).port, '54332');
  await cloneSchema(saved);
} else await bootstrap();
