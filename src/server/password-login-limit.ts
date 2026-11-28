import 'server-only';
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { createDatabasePool, databaseUrl } from './database';
import { DomainError } from './http';

let pool: Pool | undefined;

export async function reservePasswordLogin(email: string, secret: string | null, source: string) {
  if (!secret) throw new DomainError('DEPENDENCY_UNAVAILABLE');
  const bucket = createHmac('sha256', secret).update(JSON.stringify(['password-login', source, email])).digest('hex');
  const database = pool ??= createDatabasePool(databaseUrl('worker'));
  const sql = 'select * from app_private.password_login_slot($1,$2)';
  const { rows: [slot] } = await database.query<{ window_start: Date; retry_seconds: number }>(sql, [bucket, null]);
  if (!slot) throw new DomainError('DEPENDENCY_UNAVAILABLE');
  return {
    retrySeconds: slot.retry_seconds,
    async releaseSuccessfulAttempt() {
      // A successful authentication may finish after the next window has started.
      await database.query(sql, [bucket, slot.window_start]);
    },
  };
}
