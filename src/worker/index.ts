import { setTimeout } from 'node:timers/promises';
import { createDatabasePool, databaseUrl } from '../server/database';
import { integrationStates, parseServerConfig } from '../server/config';
import { claimWorkerJobs, failJob } from './claims';
import { executeLeasedJob } from './execute';
import { createWorkerHandlers } from './handlers';
import { writeHeartbeat } from './health';

const configuration = parseServerConfig(process.env);
const pool = createDatabasePool(databaseUrl('worker'));
const { handlers, channelMode } = createWorkerHandlers(pool, configuration);
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

console.log(JSON.stringify({ event: 'worker_started', integrations: integrationStates(configuration), handlers: Object.keys(handlers) }));
try {
  while (!stopping) {
    const jobs = await claimWorkerJobs(pool, process.env.WORKER_PURPOSE || null, channelMode);
    await writeHeartbeat(process.env.WORKER_HEARTBEAT_FILE);
    for (const job of jobs) {
      const handler = handlers[job.purpose];
      if (!handler) {
        try { await failJob(pool, job, 'HANDLER_NOT_CONFIGURED'); }
        catch (error) { if (!(error instanceof Error && error.message === 'LEASE_LOST')) throw error; }
        continue;
      }
      const result = await executeLeasedJob(pool, job, handler);
      await writeHeartbeat(process.env.WORKER_HEARTBEAT_FILE);
      console.log(JSON.stringify({ event: 'job_processed', job_id: job.id, result }));
    }
    if (process.argv.includes('--once')) stopping = true;
    if (!stopping && jobs.length === 0) await setTimeout(1000);
  }
} finally { await pool.end(); }
