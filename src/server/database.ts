import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';

/** Only server/worker modules may import this module. Never serialize connection settings. */
export function databaseUrl(kind: 'application' | 'worker' | 'migration' = 'application'): string {
  const explicit = kind === 'worker' ? process.env.WORKER_DATABASE_URL : process.env.DATABASE_URL;
  if (explicit) return explicit;
  if (!['development', 'test'].includes(process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development')) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  if (kind === 'worker') {
    try {
      const supabase = JSON.parse(readFileSync(resolve('.local/supabase.json'), 'utf8')) as { marker: string; worker_database_url: string };
      const workerUrl = new URL(supabase.worker_database_url);
      if (supabase.marker !== 'git-tutor-supabase-local-v1' || workerUrl.hostname !== '127.0.0.1' || workerUrl.port !== '54322' || workerUrl.pathname !== '/postgres' || workerUrl.username !== 'git_tutor_worker') throw new Error('DATABASE_CONFIGURATION_REQUIRED');
      return supabase.worker_database_url;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const local = JSON.parse(readFileSync(resolve('.local/database.json'), 'utf8').replace(/^\uFEFF/, '')) as { marker: string; port: number; password: string; worker_password: string };
  if (local.marker !== 'git-tutor-disposable-v1' || local.port !== 55432) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  const worker = kind === 'worker';
  return `postgresql://${worker ? 'git_tutor_worker' : 'postgres'}:${encodeURIComponent(worker ? local.worker_password : local.password)}@127.0.0.1:55432/gittutor_dev`;
}

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
}

/** Each call owns a real connection and transaction; no network provider calls belong inside. */
export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
