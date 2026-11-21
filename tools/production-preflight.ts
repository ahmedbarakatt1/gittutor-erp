import { readdir } from 'node:fs/promises';
import { Client } from 'pg';
import { inspectProductionConfiguration, inspectProductionDatabase, type PreflightCheck } from './production-preflight-model';
import { readWorkerFunctionBoundary } from './production-worker-boundary';

const checks = inspectProductionConfiguration(process.env);
const configOnly = process.argv.includes('--config-only');
if (checks.every(check => check.passed) && !configOnly) {
  const operator = new Client({ connectionString: process.env.PRODUCTION_DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 10000 });
  const worker = new Client({ connectionString: process.env.WORKER_DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 10000 });
  try {
    await operator.connect(); await worker.connect();
    await operator.query('begin read only'); await worker.query('begin read only');
    const metadata = (await operator.query('select environment,fixture_marker from app_private.environment_metadata where singleton')).rows[0];
    const counts = (await operator.query("select (select count(*)::int from app_private.synthetic_fixture_registry) fixture_count,(select count(*)::int from auth.users where lower(email) ~ '@(example[.]test|preview[.]gittutor[.]invalid)$') test_identity_count")).rows[0];
    const migrations = (await operator.query('select version from supabase_migrations.schema_migrations')).rows.map(row => row.version);
    const role = (await worker.query("select current_user worker_role,rolsuper worker_superuser,rolbypassrls worker_bypassrls,rolcreaterole worker_createrole,rolcreatedb worker_createdb,coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) worker_tls from pg_roles where rolname=current_user")).rows[0];
    const grants = (await operator.query("select count(*) filter(where not c.relrowsecurity)::int private_tables_without_rls,count(*) filter(where has_table_privilege('git_tutor_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::int worker_table_grants,count(*) filter(where has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::int browser_private_table_grants from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('api','app_private','finance_private') and c.relkind='r'")).rows[0];
    const versions = (await readdir('supabase/migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).map(file => file.split('_')[0]);
    const worker_functions = await readWorkerFunctionBoundary(operator);
    checks.push(...inspectProductionDatabase({ ...counts, ...role, ...grants, worker_functions, environment: metadata?.environment ?? null, fixture_marker: metadata?.fixture_marker ?? null, migration_versions: migrations }, versions));
  } catch {
    checks.push({ name: 'hosted_database_readiness_query', passed: false });
  } finally {
    await Promise.allSettled([operator.query('rollback'), worker.query('rollback')]);
    await Promise.allSettled([operator.end(), worker.end()]);
  }
}
const passed = checks.every((check: PreflightCheck) => check.passed);
console.log(JSON.stringify({ status: passed ? configOnly ? 'configuration_valid_target_unverified' : 'technical_checks_passed_activation_pending' : 'blocked', checks, outstanding: ['approved_commercial_policy', 'controlled_live_provider_pilots', 'hosted_backup_restore', 'real_identity_and_opening_balance_review'] }, null, 2));
process.exitCode = passed ? 0 : 1;
