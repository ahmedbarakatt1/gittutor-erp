import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';

export type IsolatedTarget = { connectionString: string; environment: string };

export function assertIsolatedTarget(target: IsolatedTarget): void {
  const url = new URL(target.connectionString);
  const knownDatabase = ['/gittutor_dev', '/gittutor_test'].includes(url.pathname);
  const ephemeralTestDatabase = target.environment === 'test' && /^\/gittutor_migration_[a-f0-9]{12}$/.test(url.pathname);
  if (!['development', 'test'].includes(target.environment)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.port !== '55432'
    || !(knownDatabase || ephemeralTestDatabase)
    || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('ISOLATED_TARGET_REQUIRED');
  }
}

export function localDatabaseUrl(database = 'gittutor_test', worker = false): string {
  if (!['gittutor_dev', 'gittutor_test'].includes(database)) throw new Error('ISOLATED_TARGET_REQUIRED');
  const manifest = JSON.parse(readFileSync(resolve('.local/database.json'), 'utf8').replace(/^\uFEFF/, '')) as {
    marker: string; port: number; password: string; worker_password: string;
  };
  if (manifest.marker !== 'git-tutor-disposable-v1' || manifest.port !== 55432) throw new Error('ISOLATED_TARGET_REQUIRED');
  return `postgresql://${worker ? 'git_tutor_worker' : 'postgres'}:${encodeURIComponent(worker ? manifest.worker_password : manifest.password)}@127.0.0.1:55432/${database}`;
}

export function testDatabaseUrl(): string {
  const connectionString = process.env.TEST_DATABASE_URL || localDatabaseUrl();
  assertIsolatedTarget({ connectionString, environment: process.env.APP_ENV || 'test' });
  if (new URL(connectionString).pathname !== '/gittutor_test') throw new Error('TEST_DATABASE_REQUIRED');
  return connectionString;
}

export async function assertTestDatabase(client: Pick<Client, 'query'>): Promise<void> {
  const result = await client.query('select current_database() as database,environment,fixture_marker from app_private.environment_metadata where singleton').catch(() => { throw new Error('TEST_DATABASE_REQUIRED'); });
  const marker = result.rows[0];
  if (result.rowCount !== 1 || marker.database !== 'gittutor_test' || marker.environment !== 'test' || marker.fixture_marker !== 'git-tutor-disposable-v1') {
    throw new Error('TEST_DATABASE_REQUIRED');
  }
}
