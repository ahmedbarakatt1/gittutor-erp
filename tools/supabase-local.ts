import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase, anonymousClient, assertLocalSupabase, loadLocalSupabase, type LocalSupabase } from '../tests/helpers/supabase';
import { fixtureId } from './db-seed';
import { NATIVE_BASELINE_MIGRATIONS } from './db-migrate';
import { seedCatalog } from './catalog-seed';

const execute = promisify(execFile);
const workspace = resolve('.local/supabase-bootstrap');
const exclusions = 'realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta';
const cli = resolve('node_modules/supabase/dist/supabase.js');
const marker = 'git-tutor-supabase-local-v1' as const;

export function assertMigrationMarker(value: { environment: string; fixture_marker: string } | undefined, verifiedFreshBootstrap: boolean) {
  if (value ? value.environment !== 'test' || value.fixture_marker !== marker : !verifiedFreshBootstrap) throw new Error('LOCAL_SUPABASE_REQUIRED');
}
export function assertEnvironmentFileWritable(content: string) {
  const matches = content.matchAll(/^\s*(?:export\s+)?APP_ENV\s*=\s*["']?([^\s"'#]+)/gm);
  for (const match of matches) if (!['development', 'test'].includes(match[1])) throw new Error('ENVIRONMENT_FILE_IS_NOT_LOCAL');
}

type DefinerBoundary = {
  proname: string; nspname: string; signature: string; result: string;
  prosecdef: boolean; proconfig: string[] | null; rolname: string; rolcanlogin: boolean; rolbypassrls: boolean;
  provolatile: string; lanname: string; executors: string[]; prosrc: string;
};
// Supabase's managed auth schema cannot grant USAGE to our NOLOGIN owners. Only
// these four bounded reads may run as postgres; no exposed business RPC is exempt.
const authBridges: Record<string, { source: string; result: string }> = {
  'app_private.auth_account(uuid)': {
    source: 'select u.email::text,u.email_confirmed_at,u.is_anonymous,u.deleted_at,u.banned_until from auth.users u where u.id=p_id',
    result: 'TABLE(email text, email_confirmed_at timestamp with time zone, is_anonymous boolean, deleted_at timestamp with time zone, banned_until timestamp with time zone)',
  },
  'app_private.auth_session_active(uuid,uuid)': {
    source: 'select exists(select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>now()))', result: 'boolean',
  },
  'app_private.auth_email_exists(text)': {
    source: 'select exists(select 1 from auth.users where lower(email)=lower(p_email))', result: 'boolean',
  },
  'app_private.auth_invited_user(uuid,text,timestamp with time zone)': {
    source: "select id from auth.users where lower(email)=p_email and created_at>=p_created_at and invited_at is not null and raw_user_meta_data->>'staff_invitation_id'=p_invitation::text and deleted_at is null", result: 'uuid',
  },
};
export function assertAllowedDefiner(fn: DefinerBoundary) {
  if (!fn.prosecdef) return;
  const bridge = authBridges[fn.signature];
  const allowedBridge = bridge && fn.nspname === 'app_private' && fn.rolname === 'postgres'
    && fn.lanname === 'sql' && fn.provolatile === 's' && fn.result === bridge.result
    && fn.prosrc.trim().replace(/\s+/g, ' ') === bridge.source
    && [...fn.executors].sort().join(',') === 'git_tutor_commands,postgres';
  if (!fn.proconfig?.includes('search_path=""') || ((fn.rolcanlogin || fn.rolbypassrls) && !allowedBridge)) {
    throw new Error(`SUPABASE_DEFINER_INVALID:${fn.proname}`);
  }
}

async function verifyProjectContainer() {
  const labels = JSON.parse((await execute('docker', ['inspect', 'supabase_db_GitTutor_System', '--format', '{{json .Config.Labels}}'])).stdout) as Record<string, string>;
  const ports = JSON.parse((await execute('docker', ['inspect', 'supabase_db_GitTutor_System', '--format', '{{json .NetworkSettings.Ports}}'])).stdout) as Record<string, { HostIp: string; HostPort: string }[]>;
  if (labels['com.supabase.cli.project'] !== 'GitTutor_System'
    || ![resolve('.'), workspace].includes(resolve(labels['com.supabase.cli.workdir'] || ''))
    || ports['5432/tcp']?.length !== 1 || ports['5432/tcp'][0].HostIp !== '127.0.0.1' || ports['5432/tcp'][0].HostPort !== '54322') throw new Error('LOCAL_PROJECT_CONTAINER_REQUIRED');
}

async function runCli(args: string[], log: string) {
  try {
    const result = await execute(process.execPath, [cli, ...args], { timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
    await writeFile(resolve('.local', log), result.stdout + result.stderr, { mode: 0o600 });
    return result.stdout;
  } catch (failure) {
    const error = failure as { stdout?: string; stderr?: string };
    await writeFile(resolve('.local', log), (error.stdout || '') + (error.stderr || ''), { mode: 0o600 });
    throw new Error(`LOCAL_SUPABASE_CLI_FAILED: inspect ignored .local/${log}`);
  }
}

async function captureConfig(): Promise<LocalSupabase> {
  const status = JSON.parse(await runCli(['status', '--workdir', workspace, '--output', 'json'], 'supabase-status-private.log')) as Record<string, string>;
  const database = new URL(status.DB_URL);
  database.hostname = '127.0.0.1';
  let actors: LocalSupabase['actors'] = {};
  let seedState: LocalSupabase['seed_state'];
  let workerDatabaseUrl: string | undefined;
  try { const previous = loadLocalSupabase(); actors = previous.actors; seedState = previous.seed_state; workerDatabaseUrl = previous.worker_database_url; } catch { /* First isolated startup. */ }
  const config: LocalSupabase = { marker, url: status.API_URL, publishable_key: status.PUBLISHABLE_KEY || status.ANON_KEY,
    secret_key: status.SECRET_KEY || status.SERVICE_ROLE_KEY, database_url: database.toString(), worker_database_url: workerDatabaseUrl, actors, seed_state: seedState };
  assertLocalSupabase(config);
  await writeFile(resolve('.local/supabase.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

async function owners(database: Client, enable: boolean) {
  if (enable) {
    await database.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='git_tutor_commands') then create role git_tutor_commands nologin nobypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='git_tutor_worker_api') then create role git_tutor_worker_api nologin nobypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='git_tutor_identity_sync') then create role git_tutor_identity_sync nologin nobypassrls; end if;
    end $$;
    grant git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync to postgres;
    create schema if not exists api;
    create schema if not exists app_private;
    grant usage,create on schema api,app_private to git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync;`);
  } else {
    await database.query('revoke create on schema api,app_private from git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync');
  }
}

async function applyMigrations(foundationOnly = false) {
  const config = await captureConfig();
  const database = new Client({ connectionString: config.database_url });
  await database.connect();
  let permissionsGranted = false;
  let primaryError: unknown;
  try {
    await verifyProjectContainer();
    const hasMarkerTable = (await database.query("select to_regclass('app_private.environment_metadata') as id")).rows[0].id;
    const existingMarker = hasMarkerTable ? (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0] : undefined;
    let verifiedFreshBootstrap = false;
    if (!hasMarkerTable && foundationOnly) {
      const privateTables = await database.query("select count(*)::int as count from information_schema.tables where table_schema in ('app_private','finance_private')");
      const users = await database.query('select count(*)::int as count from auth.users');
      verifiedFreshBootstrap = privateTables.rows[0].count === 0 && users.rows[0].count === 0;
    }
    assertMigrationMarker(existingMarker, verifiedFreshBootstrap);
    await owners(database, true);
    permissionsGranted = true;
    await runCli(['migration', 'up', ...(foundationOnly ? ['--workdir', workspace] : [])], 'supabase-migrations.log');
    await database.query("insert into app_private.environment_metadata(singleton,environment,fixture_marker) values(true,'test',$1) on conflict(singleton) do nothing", [marker]);
    const stored = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    if (stored.environment !== 'test' || stored.fixture_marker !== marker) throw new Error('LOCAL_SUPABASE_REQUIRED');
    const workerUrl = new URL(config.database_url);
    workerUrl.username = 'git_tutor_worker';
    workerUrl.password = config.worker_database_url ? new URL(config.worker_database_url).password : randomBytes(32).toString('hex');
    const passwordCommand = (await database.query("select format('alter role git_tutor_worker login password %L',$1::text) as statement", [decodeURIComponent(workerUrl.password)])).rows[0].statement as string;
    await database.query(passwordCommand);
    config.worker_database_url = workerUrl.toString();
    await writeFile('.local/supabase.json', JSON.stringify(config, null, 2), { mode: 0o600 });
    await database.query("notify pgrst, 'reload schema'");
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (permissionsGranted) await owners(database, false);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error('OWNER_CREATE_REVOKE_FAILED: primary migration error preserved.');
    } finally { await database.end(); }
  }
}

async function publicEnvironment(config: LocalSupabase) {
  let existing = '';
  try { existing = await readFile('.env.local', 'utf8'); } catch { /* New local configuration. */ }
  assertEnvironmentFileWritable(existing);
  const lines = existing.split(/\r?\n/).filter(line => line && !/^(APP_ENV|APP_BASE_URL|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=/.test(line));
  lines.push('APP_ENV=development', 'APP_BASE_URL=http://127.0.0.1:3000', `NEXT_PUBLIC_SUPABASE_URL=${config.url}`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${config.publishable_key}`);
  await writeFile('.env.local', `${lines.join('\n')}\n`, { mode: 0o600 });
}

async function copyLocalConfiguration() {
  assertEnvironmentFileWritable(`APP_ENV=${process.env.APP_ENV || process.env.NODE_ENV || 'development'}`);
  let environmentFile = '';
  try { environmentFile = await readFile('.env.local', 'utf8'); } catch { /* New configuration. */ }
  assertEnvironmentFileWritable(environmentFile);
  await mkdir(resolve(workspace, 'supabase/migrations'), { recursive: true });
  const configText = (await readFile('supabase/config.toml', 'utf8')).replace(/(\[db\.migrations\][\s\S]*?)enabled = true/, '$1enabled = false');
  await writeFile(resolve(workspace, 'supabase/config.toml'), configText);
  for (const filename of NATIVE_BASELINE_MIGRATIONS) await writeFile(resolve(workspace, 'supabase/migrations', filename), await readFile(resolve('supabase/migrations', filename)));
  let templates: string[] = [];
  try { templates = await readdir('supabase/templates'); } catch { /* No custom template yet. */ }
  await mkdir(resolve(workspace, 'supabase/templates'), { recursive: true });
  for (const file of templates.filter(name => name.endsWith('.html'))) await writeFile(resolve(workspace, 'supabase/templates', file), await readFile(resolve('supabase/templates', file)));
}

async function restart() {
  await copyLocalConfiguration();
  await verifyProjectContainer();
  const database = await adminDatabase();
  await database.end();
  await runCli(['stop', '--workdir', workspace], 'supabase-restart-stop.log');
  await runCli(['start', '--workdir', workspace, '--network-id', 'gittutor_local_isolated', '--exclude', exclusions], 'supabase-restart-start.log');
  await publicEnvironment(await captureConfig());
  console.log('Project-local Supabase restarted with data preserved and current Auth configuration.');
}

async function bootstrap() {
  await copyLocalConfiguration();
  try {
    const result = await execute('docker', ['network', 'inspect', 'gittutor_local_isolated', '--format', '{{json .Options}}']);
    if (JSON.parse(result.stdout)['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1') throw new Error('LOCAL_NETWORK_BINDING_REQUIRED');
  } catch (error) {
    if (error instanceof Error && error.message === 'LOCAL_NETWORK_BINDING_REQUIRED') throw error;
    await execute('docker', ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', 'com.git-tutor.scope=local', 'gittutor_local_isolated']);
  }
  await runCli(['start', '--workdir', workspace, '--network-id', 'gittutor_local_isolated', '--exclude', `postgrest,${exclusions}`], 'supabase-bootstrap-start.log');
  await applyMigrations(true);
  await runCli(['stop', '--workdir', workspace], 'supabase-bootstrap-stop.log');
  await runCli(['start', '--workdir', workspace, '--network-id', 'gittutor_local_isolated', '--exclude', exclusions], 'supabase-start.log');
  await publicEnvironment(await captureConfig());
  console.log('Real local Supabase Auth, API, private Storage and Mailpit ready; generated credentials remain in ignored .local/supabase.json.');
}

async function seed() {
  const config = loadLocalSupabase();
  const database = new Client({ connectionString: config.database_url });
  await database.connect();
  try {
    const stored = (await database.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    if (stored?.environment !== 'test' || stored?.fixture_marker !== marker) throw new Error('LOCAL_SUPABASE_REQUIRED');
    if (!(await database.query("select to_regclass('app_private.accounts') as id")).rows[0].id) throw new Error('IDENTITY_MIGRATION_REQUIRED');
    const fixture = JSON.parse(await readFile('fixtures/domain-scenarios.json', 'utf8')) as { actors: { id: string; name: string; email: string; role: string }[] };
    const admin = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const actor of fixture.actors) {
      if (!actor.email.endsWith('@example.test')) throw new Error('SYNTHETIC_FIXTURES_REQUIRED');
      const id = fixtureId(actor.id);
      const previous = config.actors[actor.id];
      const password = previous?.password || `Synthetic-${randomBytes(24).toString('hex')}!`;
      const existing = await admin.auth.admin.getUserById(id);
      if (!existing.data.user) {
        const result = await admin.auth.admin.createUser({ id, email: actor.email, password, email_confirm: true, user_metadata: { display_name: actor.name } });
        if (result.error || result.data.user?.id !== id) throw new Error(`SYNTHETIC_USER_CREATE_FAILED:${actor.id}`);
      } else if (!previous || existing.data.user.email !== actor.email) throw new Error(`SYNTHETIC_IDENTITY_CONFLICT:${actor.id}`);
      config.actors[actor.id] = { id, email: actor.email, password };
      // Save incrementally so a partial interruption never loses an existing synthetic password.
      await writeFile('.local/supabase.json', JSON.stringify(config, null, 2), { mode: 0o600 });
    }
    await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','synthetic bootstrap') on conflict do nothing", [config.actors.admin_a.id]);
    await database.query("insert into app_private.subjects(id,slug,title) values($1,'calculus','Calculus') on conflict do nothing", [fixtureId('subject_calculus')]);
    const clients = new Map<string, ReturnType<typeof anonymousClient>>();
    async function asActor(label: string) {
      const client = createClient(config.url, config.publishable_key, { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } });
      const actor = config.actors[label];
      const result = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
      if (result.error) throw new Error(`SYNTHETIC_LOGIN_FAILED:${label}`);
      clients.set(label, client);
      return client;
    }
    const adminClient = await asActor('admin_a');
    for (const actor of fixture.actors.filter(item => ['tutor', 'customer_service'].includes(item.role))) {
      const grant = await adminClient.rpc('grant_staff_role', { p_account_id: config.actors[actor.id].id, p_role: actor.role, p_reason: 'synthetic development fixture', p_idempotency_key: `synthetic-role-v1:${actor.id}` });
      if (grant.error) throw new Error(`SYNTHETIC_ROLE_FAILED:${actor.id}:${grant.error.code}`);
    }
    const guardian = await asActor('guardian_a');
    config.seed_state ??= { guardian_invitation_expires_at: new Date(Date.now()+86400000).toISOString() };
    await writeFile('.local/supabase.json', JSON.stringify(config, null, 2), { mode: 0o600 });
    const contact = (await database.query('select id from app_private.verified_contacts where account_id=$1 and verified_at is not null and revoked_at is null', [config.actors.guardian_a.id])).rows[0];
    for (const label of ['learner_a', 'learner_b']) {
      const existing = await database.query('select 1 from app_private.guardian_links g join app_private.learners l on l.id=g.learner_id where g.guardian_account_id=$1 and l.account_id=$2 and g.revoked_at is null', [config.actors.guardian_a.id, config.actors[label].id]);
      if (existing.rowCount) continue;
      const learner = await asActor(label);
      const created = await learner.rpc('create_guardian_invitation', { p_contact_id: contact.id, p_scopes: ['profile', 'booking', 'payments', 'materials', 'notifications'], p_expires_at: config.seed_state.guardian_invitation_expires_at, p_idempotency_key: `synthetic-guardian-invite-v1:${label}` });
      if (created.error) throw new Error(`SYNTHETIC_GUARDIAN_INVITATION_FAILED:${created.error.code}`);
      const event = (await database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [created.data.invitation_id])).rows[0];
      const accepted = await guardian.rpc('accept_guardian_invitation', { p_invitation_id: created.data.invitation_id, p_single_use_token: event.payload.single_use_token, p_expected_version: 1, p_idempotency_key: `synthetic-guardian-accept-v1:${label}` });
      if (accepted.error) throw new Error(`SYNTHETIC_GUARDIAN_ACCEPT_FAILED:${accepted.error.code}`);
    }
    await Promise.all([...clients.values()].map(client => client.auth.signOut({ scope: 'local' })));
    console.log(`Seeded ${fixture.actors.length} synthetic Auth identities with current roles and two scoped guardian links. No external delivery requested.`);
  } finally { await database.end(); }
}

async function verify() {
  const database = await adminDatabase();
  try {
    const files = (await readdir('supabase/migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
    const applied = await database.query('select version from supabase_migrations.schema_migrations order by version');
    const versions = new Set(applied.rows.map(row => row.version));
    const missing = files.filter(file => !versions.has(file.split('_')[0]));
    if (missing.length) throw new Error(`SUPABASE_MIGRATIONS_MISSING:${missing.join(',')}`);
    const tables = await database.query(`select n.nspname,c.relname,c.relrowsecurity,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anonymous,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as authenticated
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('api','app_private','finance_private') and c.relkind='r'`);
    if (!tables.rowCount || tables.rows.some(row => !row.relrowsecurity || row.anonymous || row.authenticated)) throw new Error('SUPABASE_TABLE_BOUNDARY_INVALID');
    const functions = await database.query(`select p.proname,n.nspname,p.prosecdef,p.proconfig,r.rolcanlogin,r.rolbypassrls,r.rolname,
      p.oid::regprocedure::text as signature,pg_get_function_result(p.oid) as result,p.prosrc,p.provolatile,l.lanname,
      array(select coalesce(g.rolname,'PUBLIC')::text from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee where a.privilege_type='EXECUTE') as executors,
      has_function_privilege('anon',p.oid,'EXECUTE') as anonymous,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
      where n.nspname in ('api','app_private','finance_private')`);
    for (const fn of functions.rows) {
      const publicRead = fn.nspname === 'api' && ['list_public_offers', 'get_public_tutor'].includes(fn.proname);
      if (fn.anonymous && !publicRead) throw new Error(`SUPABASE_ANON_FUNCTION_INVALID:${fn.proname}`);
      if (fn.nspname !== 'api' && fn.authenticated) throw new Error(`SUPABASE_PRIVATE_FUNCTION_INVALID:${fn.proname}`);
      assertAllowedDefiner(fn);
    }
    console.log(`Real Supabase verification passed: ${files.length} migrations, ${tables.rowCount} private RLS tables, ${functions.rowCount} function boundaries.`);
  } finally { await database.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await mkdir('.local', { recursive: true });
  switch (process.argv[2]) {
    case 'bootstrap': await bootstrap(); break;
    case 'migrate': await applyMigrations(process.argv.includes('--foundation-only')); console.log('Project-local Supabase migrations applied; temporary owner CREATE grants revoked.'); break;
    case 'seed': await seed(); await seedCatalog(); break;
    case 'verify': await verify(); break;
    case 'restart': await restart(); break;
    default: throw new Error('Usage: tsx tools/supabase-local.ts bootstrap|migrate|seed|verify|restart');
  }
}
