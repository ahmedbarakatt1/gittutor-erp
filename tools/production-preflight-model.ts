import { isIP } from 'node:net';
import { parseServerConfig } from '../src/server/config';
import { parseWhatsAppConfig } from '../src/server/providers/whatsapp';
import { workerFunctionsAreRestricted, type WorkerFunctionBoundary } from './production-worker-boundary';

type Env = Record<string, string | undefined>;
export type PreflightCheck = { name: string; passed: boolean };
function check(name: string, run: () => boolean): PreflightCheck {
  try { return { name, passed: run() }; } catch { return { name, passed: false }; }
}
function origin(value: string | undefined) {
  const url = new URL(value || '');
  return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    && !isIP(url.hostname) && url.hostname.includes('.') && !/(?:^|\.)(?:localhost|test|invalid|example|local|trycloudflare\.com)$/.test(url.hostname.replace(/\.$/, ''));
}
function database(value: string | undefined, reference: string, worker: boolean) {
  const url = new URL(value || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password || url.pathname !== '/postgres' || url.hash
    || url.searchParams.get('sslmode') !== 'verify-full' || url.searchParams.getAll('sslmode').length !== 1
    || [...url.searchParams.keys()].some(key => !['sslmode', 'sslrootcert', 'connect_timeout'].includes(key)) || (url.port && url.port !== '5432')) return false;
  const user = decodeURIComponent(url.username);
  if (url.hostname === `db.${reference}.supabase.co`) return worker ? user === 'git_tutor_worker' : user === 'postgres';
  return url.hostname.endsWith('.pooler.supabase.com') && user === `${worker ? 'git_tutor_worker' : 'postgres'}.${reference}`;
}

/** Results contain fixed check names only, never configuration values or provider error messages. */
export function inspectProductionConfiguration(env: Env): PreflightCheck[] {
  const reference = env.PRODUCTION_PROJECT_REF || '';
  return [
    check('explicit_production_environment', () => env.APP_ENV === 'production'),
    check('selected_production_adapters_configured', () => { const config = parseServerConfig(env); parseWhatsAppConfig(env, config.isolated); return !config.isolated; }),
    check('permanent_https_origin', () => origin(env.APP_BASE_URL)),
    check('selected_supabase_project', () => /^[a-z]{20}$/.test(reference) && env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') === `https://${reference}.supabase.co`),
    check('restricted_worker_tls_connection', () => database(env.WORKER_DATABASE_URL, reference, true)),
    check('selected_operator_tls_connection', () => database(env.PRODUCTION_DATABASE_URL, reference, false)),
  ];
}

export type ProductionDatabaseSnapshot = {
  environment: string | null; fixture_marker: string | null; fixture_count: number; test_identity_count: number; migration_versions: string[];
  worker_role: string; worker_superuser: boolean; worker_bypassrls: boolean; worker_createrole: boolean; worker_createdb: boolean;
  worker_tls: boolean; worker_table_grants: number; browser_private_table_grants: number; private_tables_without_rls: number;
  worker_functions: WorkerFunctionBoundary[];
};
export function inspectProductionDatabase(snapshot: ProductionDatabaseSnapshot, versions: string[]): PreflightCheck[] {
  return [
    check('production_database_identity', () => snapshot.environment === 'production' && snapshot.fixture_marker === null),
    check('no_development_fixtures_or_preview_logins', () => snapshot.fixture_count === 0 && snapshot.test_identity_count === 0),
    check('reviewed_migrations_applied', () => versions.length > 0 && versions.length === snapshot.migration_versions.length && versions.every(version => snapshot.migration_versions.includes(version))),
    check('restricted_worker_role', () => snapshot.worker_role === 'git_tutor_worker' && !snapshot.worker_superuser && !snapshot.worker_bypassrls && !snapshot.worker_createrole && !snapshot.worker_createdb && snapshot.worker_table_grants === 0),
    check('worker_connection_uses_tls', () => snapshot.worker_tls === true),
    check('exact_worker_rpc_permissions_and_owners', () => workerFunctionsAreRestricted(snapshot.worker_functions)),
    check('no_browser_private_table_grants', () => snapshot.browser_private_table_grants === 0),
    check('private_table_row_security_enabled', () => snapshot.private_tables_without_rls === 0),
  ];
}
