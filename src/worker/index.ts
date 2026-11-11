import { setTimeout } from 'node:timers/promises';
import { createDatabasePool, databaseUrl } from '../server/database';
import { integrationStates, parseServerConfig } from '../server/config';
import { claimJobs, failJob } from './claims';
import { executeLeasedJob, type JobHandler } from './execute';

const configuration = parseServerConfig(process.env);
const pool = createDatabasePool(databaseUrl('worker'));
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

/** Later domain tasks register handlers; unknown work is never reported as delivered. */
const handlers: Record<string, JobHandler> = {
  'foundation.healthcheck': {
    execute: async job => `fake:healthcheck:${job.event_id}`,
    reconcile: async () => ({ outcome: 'not_sent' }), // Pure local healthcheck has no external side effect.
  },
};

console.log(JSON.stringify({ event: 'worker_started', integrations: integrationStates(configuration), handlers: Object.keys(handlers) }));
try {
  while (!stopping) {
    const jobs = await claimJobs(pool, process.env.WORKER_PURPOSE || null);
    for (const job of jobs) {
      const handler = handlers[job.purpose];
      if (!handler) {
        try { await failJob(pool, job, 'HANDLER_NOT_CONFIGURED'); }
        catch (error) { if (!(error instanceof Error && error.message === 'LEASE_LOST')) throw error; }
        continue;
      }
      const result = await executeLeasedJob(pool, job, handler);
      console.log(JSON.stringify({ event: 'job_processed', job_id: job.id, result }));
    }
    if (process.argv.includes('--once')) stopping = true;
    if (!stopping) await setTimeout(1000);
  }
} finally { await pool.end(); }
