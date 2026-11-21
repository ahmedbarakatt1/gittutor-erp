import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { integrationStates, parseServerConfig } from '../../src/server/config';
import { inspectProductionConfiguration, inspectProductionDatabase } from '../../tools/production-preflight-model';
import { workerRpcOwners } from '../../tools/production-worker-boundary';

const ref = 'abcdefghijklmnopqrst';
const configured = () => ({
  APP_ENV: 'production', APP_BASE_URL: 'https://learn.gittutor.com',
  PRODUCTION_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_configured',
  WORKER_DATABASE_URL: `postgresql://git_tutor_worker:private-password@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  PRODUCTION_DATABASE_URL: `postgresql://postgres:operator-secret@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  SUPABASE_SECRET_KEY: 'sb_secret_private', SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
  EMAIL_ADAPTER: 'ses', AWS_REGION: 'eu-west-1', EMAIL_FROM: 'lessons@gittutor.com', EMAIL_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:123456789012:delivery', EMAIL_CONFIGURATION_SET: 'delivery',
  CALENDAR_ADAPTER: 'google', GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'private-google', GOOGLE_OAUTH_REDIRECT_URI: 'https://learn.gittutor.com/api/calendar/google/callback', GOOGLE_CALENDAR_ID: 'organizer',
  WHATSAPP_ADAPTER: 'cloud', WHATSAPP_BUSINESS_ACCOUNT_ID: '123456', WHATSAPP_PHONE_NUMBER_ID: '234567', WHATSAPP_ACCESS_TOKEN: 'private-whatsapp', WHATSAPP_APP_SECRET: 'private-app', WHATSAPP_VERIFY_TOKEN: 'private-verify', WHATSAPP_GRAPH_VERSION: 'v25.0',
  FILE_SCAN_ADAPTER: 'clamav', FILE_SCAN_URL: 'tcp://scanner.internal:3310',
});
const clean = () => ({ environment: 'production', fixture_marker: null, fixture_count: 0, test_identity_count: 0, migration_versions: ['1','2'], worker_role: 'git_tutor_worker', worker_superuser: false, worker_bypassrls: false, worker_createrole: false, worker_createdb: false, worker_tls: true, worker_table_grants: 0, browser_private_table_grants: 0, private_tables_without_rls: 0,
  worker_functions: Object.entries(workerRpcOwners).map(([signature, owner]) => ({ signature, owner, definer: true, owner_login: false, owner_bypassrls: false, fixed_search_path: true })),
});

describe('production activation preflight', () => {
  it('boots the manual WhatsApp launch without any Meta account, credentials, or Graph version', async () => {
    const template = parseEnv(await readFile('deploy/production.env.example', 'utf8'));
    expect(template.WHATSAPP_ADAPTER).toBe('manual');
    const rest = Object.fromEntries(Object.entries(configured()).filter(([key]) => !key.startsWith('WHATSAPP_')));
    const env = { ...rest, WHATSAPP_ADAPTER: 'manual' };
    expect(integrationStates(parseServerConfig(env))).toContainEqual({ provider: 'whatsapp', mode: 'manual', state: 'manual_contact' });
    expect(inspectProductionConfiguration(env).every(check => check.passed)).toBe(true);
    expect(inspectProductionConfiguration({ ...env, WHATSAPP_ADAPTER: 'cloud' }).some(check => !check.passed)).toBe(true);
  });
  it('boots the published runtime template with the selected Mailjet sender', async () => {
    const template = parseEnv(await readFile('deploy/production.env.example', 'utf8'));
    const secrets: Record<string, string> = { ...configured(), MAILJET_API_KEY: 'a'.repeat(32), MAILJET_SECRET_KEY: 'b'.repeat(32) };
    const env = Object.fromEntries(Object.entries(template).map(([key, value]) =>
      [key, !value || value.includes('YOUR_') ? secrets[key] : value]));
    expect(parseServerConfig(env).mailjet).toEqual({
      from: secrets.EMAIL_FROM, api_key: secrets.MAILJET_API_KEY, secret_key: secrets.MAILJET_SECRET_KEY,
    });
  });
  it('separates valid configuration from actual target/provider verification', () => {
    const report = inspectProductionConfiguration(configured());
    expect(report.every(check => check.passed)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/private-password|operator-secret|private-google|private-whatsapp|sb_secret_private/);
  });
  it('rejects preview origins, paths, mismatched projects and unsafe worker connections', () => {
    for (const patch of [
      { APP_ENV: 'development' }, { EMAIL_ADAPTER: 'fake' }, { APP_BASE_URL: 'https://test.trycloudflare.com' },
      { APP_BASE_URL: 'https://test.trycloudflare.com.' },
      { APP_BASE_URL: 'https://learn.gittutor.com/portal' }, { APP_BASE_URL: 'https://learn.gittutor.com?secret=private-value' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co' }, { WORKER_DATABASE_URL: `postgres://postgres:secret@db.${ref}.supabase.co/postgres?sslmode=verify-full` },
      { WORKER_DATABASE_URL: `postgres://git_tutor_worker:secret@db.${ref}.supabase.co/postgres?sslmode=require` },
      { WORKER_DATABASE_URL: `postgres://git_tutor_worker.${ref}:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full` },
      { WHATSAPP_GRAPH_VERSION: '' },
    ]) expect(inspectProductionConfiguration({ ...configured(), ...patch }).some(check => !check.passed)).toBe(true);
  });
  it('accepts a project-bound TLS session pooler connection', () => {
    expect(inspectProductionConfiguration({ ...configured(), WORKER_DATABASE_URL: `postgres://git_tutor_worker.${ref}:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full` }).every(check => check.passed)).toBe(true);
  });
  it('refuses fixture promotion, incomplete migrations, privileged workers and browser grants', () => {
    expect(inspectProductionDatabase(clean(), ['1','2']).every(check => check.passed)).toBe(true);
    for (const patch of [
      { environment: 'development' }, { fixture_marker: 'git-tutor-operational-preview-v1' }, { fixture_count: 1 }, { test_identity_count: 1 },
      { migration_versions: ['1'] }, { migration_versions: ['1','2','3'] }, { private_tables_without_rls: 1 }, { worker_superuser: true }, { worker_bypassrls: true }, { worker_createrole: true }, { worker_createdb: true },
      { worker_tls: false }, { worker_role: 'postgres' }, { worker_table_grants: 1 }, { browser_private_table_grants: 1 },
    ]) expect(inspectProductionDatabase({ ...clean(), ...patch }, ['1','2']).some(check => !check.passed)).toBe(true);
  });
  it('refuses missing queue permissions and unexpected privileged function execution', () => {
    const allowed = clean().worker_functions;
    for (const worker_functions of [[], allowed.slice(1), [...allowed, { signature: 'app_private.auth_account(uuid)', owner: 'postgres', definer: true, owner_login: true, owner_bypassrls: true, fixed_search_path: true }],
      ...[{ owner: 'postgres' }, { definer: false }, { owner_login: true }, { owner_bypassrls: true }, { fixed_search_path: false }].map(patch => [{ ...allowed[0], ...patch }, ...allowed.slice(1)]),
    ]) {
      expect(inspectProductionDatabase({ ...clean(), worker_functions }, ['1','2']).some(check => !check.passed)).toBe(true);
    }
  });
});
