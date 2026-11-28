import type { Pool, PoolClient } from 'pg';

export type Job = {
  id: string;
  event_id: string;
  purpose: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  lease_token: string;
  lease_expires_at: Date;
  attempt_count: number;
  requires_reconciliation?: boolean; // Absent on legacy claims.
  correlation_id: string;
};
type Database = Pick<Pool | PoolClient, 'query'>;

export async function claimJobs(database: Database, purpose: string | null = null, limit = 10, leaseSeconds = 60): Promise<Job[]> {
  const result = await database.query('select * from app_private.claim_jobs($1,$2,$3)', [purpose, limit, leaseSeconds]);
  return result.rows as Job[];
}
export async function claimWorkerJobs(database: Database, purpose: string | null, mode: 'manual' | 'fake' | 'cloud'): Promise<Job[]> {
  const excluded = mode === 'manual' ? 'support.whatsapp_send' : null;
  const result = await database.query('select * from app_private.claim_worker_job($1,$2)', [purpose, excluded]);
  return result.rows as Job[];
}
export async function startJobDispatch(database: Database, job: Job) {
  await database.query('select app_private.start_job_dispatch($1,$2)', [job.id, job.lease_token]);
}
export async function failJobExecution(database: Database, job: Job) {
  const result = await database.query<{ state: 'pending' | 'failed' | 'reconciliation' }>(
    'select app_private.fail_job_execution($1,$2) state', [job.id, job.lease_token]);
  return result.rows[0].state;
}
export async function completeJob(database: Database, job: Job, providerReference: string | null) {
  await database.query('select app_private.complete_job($1,$2,$3)', [job.id, job.lease_token, providerReference]);
}
export async function failJob(database: Database, job: Job, code: string, uncertain = false) {
  if (!/^[A-Z0-9_]{1,80}$/.test(code)) throw new Error('SAFE_ERROR_CODE_REQUIRED');
  await database.query('select app_private.fail_job($1,$2,$3,$4)', [job.id, job.lease_token, code, uncertain]);
}
