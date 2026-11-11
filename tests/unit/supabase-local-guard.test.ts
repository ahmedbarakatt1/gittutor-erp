import { afterEach, expect, test, vi } from 'vitest';
import { assertLocalSupabase, type LocalSupabase } from '../helpers/supabase';
import { assertAllowedDefiner, assertEnvironmentFileWritable, assertMigrationMarker, assertPackageWorkerBoundary, assertPaymentWorkerBoundary, withLocalEncryptionKey } from '../../tools/supabase-local';

const config: LocalSupabase = {
  marker: 'git-tutor-supabase-local-v1', url: 'http://127.0.0.1:54321',
  publishable_key: 'synthetic-public', secret_key: 'synthetic-secret',
  database_url: 'postgresql://local:synthetic@127.0.0.1:54322/postgres',
  actors: { learner: { id: '10000000-0000-4000-8000-000000000001', email: 'learner@example.test', password: 'synthetic' } },
};
afterEach(() => vi.unstubAllEnvs());

test('the Supabase fixture helper rejects any remote or non-project database target', () => {
  expect(() => assertLocalSupabase({ ...config, url: 'https://example.supabase.co' })).toThrow('LOCAL_SUPABASE_REQUIRED');
  expect(() => assertLocalSupabase({ ...config, database_url: 'postgresql://local:synthetic@127.0.0.1:55432/gittutor_dev' })).toThrow('LOCAL_SUPABASE_REQUIRED');
  expect(() => assertLocalSupabase({ ...config, database_url: 'https://127.0.0.1:54322/postgres' })).toThrow('LOCAL_SUPABASE_REQUIRED');
});

test('Supabase fixture helpers refuse production environments and non-synthetic identities', () => {
  vi.stubEnv('APP_ENV', 'production');
  expect(() => assertLocalSupabase(config)).toThrow('LOCAL_SUPABASE_REQUIRED');
  vi.stubEnv('APP_ENV', 'test');
  expect(() => assertLocalSupabase({ ...config, actors: { learner: { ...config.actors.learner, email: 'real@example.com' } } })).toThrow('LOCAL_SUPABASE_REQUIRED');
});

test('owner grants and migrations require a current test marker or verified empty bootstrap', () => {
  expect(() => assertMigrationMarker({ environment: 'production', fixture_marker: config.marker }, true)).toThrow('LOCAL_SUPABASE_REQUIRED');
  expect(() => assertMigrationMarker({ environment: 'test', fixture_marker: 'another-project' }, false)).toThrow('LOCAL_SUPABASE_REQUIRED');
  expect(() => assertMigrationMarker(undefined, false)).toThrow('LOCAL_SUPABASE_REQUIRED');
  expect(() => assertMigrationMarker(undefined, true)).not.toThrow();
  expect(() => assertMigrationMarker({ environment: 'test', fixture_marker: config.marker }, false)).not.toThrow();
});

test('local setup never overwrites an environment file designated production or staging', () => {
  for (const content of ['APP_ENV=production\n', 'export APP_ENV="staging"\n', " APP_ENV = 'production'\n", 'APP_ENV=development\nAPP_ENV=production\n']) {
    expect(() => assertEnvironmentFileWritable(content)).toThrow('ENVIRONMENT_FILE_IS_NOT_LOCAL');
  }
  expect(() => assertEnvironmentFileWritable('APP_ENV=development\n')).not.toThrow();
});

test('local private encryption setup generates a key once and preserves configured historical material', () => {
  const initial = withLocalEncryptionKey('APP_ENV=development\nSECRET_ENCRYPTION_KEY=\nSECRET_ENCRYPTION_KEY_ID=local-v1\n');
  expect(initial).toMatch(/^SECRET_ENCRYPTION_KEY=[a-f0-9]{64}$/m);
  expect(initial).toContain('SECRET_ENCRYPTION_KEY_ID=local-v1');
  expect(withLocalEncryptionKey(initial)).toBe(initial);
  const configured = 'APP_ENV=test\nSECRET_ENCRYPTION_KEY="' + 'a'.repeat(64) + '"\nSECRET_ENCRYPTION_PREVIOUS_KEYS=private-history\n';
  expect(withLocalEncryptionKey(configured)).toBe(configured);
  expect(() => withLocalEncryptionKey('APP_ENV=production\n')).toThrow('ENVIRONMENT_FILE_IS_NOT_LOCAL');
  expect(() => withLocalEncryptionKey('SECRET_ENCRYPTION_KEY=\nSECRET_ENCRYPTION_KEY=\n')).toThrow('LOCAL_ENCRYPTION_CONFIGURATION_AMBIGUOUS');
});

test('the managed Auth exception permits only exact private read bridges with restricted execution', () => {
  const bridge = {
    proname: 'auth_email_exists', nspname: 'app_private', signature: 'app_private.auth_email_exists(text)',
    result: 'boolean', prosecdef: true, proconfig: ['search_path=""'], rolname: 'postgres', rolcanlogin: true, rolbypassrls: true,
    provolatile: 's', lanname: 'sql', executors: ['git_tutor_commands', 'postgres'],
    prosrc: 'select exists(select 1 from auth.users where lower(email)=lower(p_email))',
  };
  expect(() => assertAllowedDefiner(bridge)).not.toThrow();
  for (const change of [
    { nspname: 'api' }, { signature: 'app_private.auth_email_exists(text,text)' },
    { executors: ['git_tutor_commands', 'postgres', 'authenticated'] },
    { prosrc: 'delete from auth.users returning true' }, { provolatile: 'v' },
    { rolname: 'git_tutor_worker' }, { proconfig: ['search_path=public'] }, { result: 'text' },
  ]) expect(() => assertAllowedDefiner({ ...bridge, ...change })).toThrow('SUPABASE_DEFINER_INVALID');
});

test('the package worker can execute only its exact due-processing entry point', () => {
  const allowed = { nspname: 'app_private', proname: 'process_package_due', signature: 'app_private.process_package_due(uuid,text)',
    rolname: 'git_tutor_commands', prosecdef: true, worker: true, executors: ['git_tutor_commands', 'git_tutor_worker'] };
  expect(() => assertPackageWorkerBoundary(allowed)).not.toThrow();
  for (const change of [
    { nspname: 'api' }, { signature: 'app_private.process_package_due(uuid,text,jsonb)' },
    { rolname: 'postgres' }, { worker: false }, { prosecdef: false },
    { executors: ['git_tutor_commands', 'git_tutor_worker', 'authenticated'] },
    { proname: 'package_append_movement' }, { nspname: 'finance_private', proname: 'finance_post_balanced' },
  ]) expect(() => assertPackageWorkerBoundary({ ...allowed, ...change })).toThrow('SUPABASE_PACKAGE_WORKER_BOUNDARY_INVALID');
  expect(() => assertPackageWorkerBoundary({ ...allowed, proname: 'package_append_movement', worker: false })).not.toThrow();
});

test('private payment processing permits only the exact narrow worker signatures and owner', () => {
  const functions = [
    ['prepare_refund_destination_context', 'uuid,uuid,uuid,text'],
    ['read_refund_destination_for_server', 'uuid,uuid,uuid,text,uuid,text'],
    ['issue_destination_validation_artifact', 'uuid,uuid,uuid,integer,text,text,text,text,jsonb'],
    ['prepare_statement_import', 'uuid,text'],
    ['finalize_statement_import', 'uuid,integer,text,text,jsonb,text,text'],
  ];
  for (const [name, args] of functions) {
    const allowed = { nspname: 'app_private', proname: name, signature: `app_private.${name}(${args})`, rolname: 'git_tutor_commands', prosecdef: true, worker: true, executors: ['git_tutor_commands', 'git_tutor_worker'] };
    expect(() => assertPaymentWorkerBoundary(allowed)).not.toThrow();
    for (const change of [{ nspname: 'api' }, { signature: `app_private.${name}()` }, { rolname: 'postgres' }, { worker: false }, { prosecdef: false }, { executors: [...allowed.executors, 'service_role'] }, { executors: [...allowed.executors, 'authenticated'] }]) {
      expect(() => assertPaymentWorkerBoundary({ ...allowed, ...change })).toThrow('SUPABASE_PAYMENT_WORKER_BOUNDARY_INVALID');
    }
    expect(() => assertPaymentWorkerBoundary({ ...allowed, proname: 'unsafe_refund_destination_read' })).toThrow('SUPABASE_PAYMENT_WORKER_BOUNDARY_INVALID');
  }
});
