import 'server-only';
import { createDatabasePool, databaseUrl } from './database';
import { parseServerConfig } from './config';
import { createSandboxClamavScanAdapter } from './providers/sandbox-clamav';
import { createWorkerHandlers } from '../worker/handlers';
import { claimWorkerJobs, type Job } from '../worker/claims';
import { executeLeasedJob } from '../worker/execute';

let pool: ReturnType<typeof createDatabasePool> | undefined;

/** The database scheduler supplies a purpose only. Each handler gets its input from a fresh database lease. */
export async function drainQueuedWork(purpose: string) {
  const config = parseServerConfig(process.env);
  pool ??= createDatabasePool(databaseUrl('worker'));
  const sandbox = config.providers.file_scan === 'clamav'
    ? createSandboxClamavScanAdapter(process.env.REQUEST_MATERIAL_SCAN_SNAPSHOT) : undefined;
  const { handlers, channelMode } = createWorkerHandlers(pool, config, sandbox);
  if (!Object.hasOwn(handlers, purpose)) throw new Error('UNKNOWN_JOB_PURPOSE');
  const handler = handlers[purpose];
  const scanning = purpose === 'files.scan';
  const deadline = Date.now() + 20_000;
  let processed = 0;
  let completed = 0;
  while (processed < (scanning ? 1 : 16) && Date.now() < deadline) {
    // A cold scanner can take longer than a normal 60-second lease. Scans reconcile
    // from persisted scan results on retry, including attempts made by the daemon.
    const jobs = scanning
      ? (await pool.query<Job>('select * from app_private.claim_jobs($1,1,300,$2)', [purpose, channelMode === 'manual' ? 'support.whatsapp_send' : null])).rows
      : await claimWorkerJobs(pool, purpose, channelMode);
    if (!jobs.length) break;
    const result = await executeLeasedJob(pool, jobs[0], handler);
    processed++;
    if (result !== 'completed') break;
    completed++;
  }
  return { processed, completed };
}
