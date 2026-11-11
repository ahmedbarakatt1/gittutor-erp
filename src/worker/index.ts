import { setTimeout } from 'node:timers/promises';
import { createDatabasePool, databaseUrl } from '../server/database';
import { integrationStates, parseServerConfig } from '../server/config';
import { claimJobs, failJob } from './claims';
import { executeLeasedJob, type JobHandler } from './execute';
import { staffInvitationHandler } from './auth-invitations';
import { bookingDueHandler } from './booking-due';
import { packageDueHandler } from './package-due';
import { statementImportHandler } from './statement-import';
import { createPrivateObjectStore } from '../server/files';
import { fileScanHandler } from './file-scan';
import { createClamavScanAdapter, createFakeScanAdapter } from '../server/providers/file-scan';
import { calendarHandler } from './calendar';
import { calendarAdapterFactory } from '../server/calendar-provider';
import { notificationRouteHandler, notificationSendHandler } from './notifications';
import { createLocalEmailAdapter, createSesEmailAdapter } from '../server/providers/email';

const configuration = parseServerConfig(process.env);
const pool = createDatabasePool(databaseUrl('worker'));
const storage = createPrivateObjectStore(configuration);
const liveScanner = configuration.providers.file_scan === 'clamav' ? createClamavScanAdapter(configuration.file_scan_url!) : null;
const liveEmail = configuration.providers.email === 'ses' ? createSesEmailAdapter(configuration.email!) : null;
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

/** Later domain tasks register handlers; unknown work is never reported as delivered. */
const handlers: Record<string, JobHandler> = {
  'identity.staff_invitation': staffInvitationHandler(pool),
  'booking.process_due': bookingDueHandler(pool),
  'packages.process_due': packageDueHandler(pool),
  'payments.validate_statement': statementImportHandler(pool, file => file.source_provenance === 'stored_object' ? storage.read({ ...file, size_bytes: file.byte_size }) : Promise.resolve(null)),
  'files.scan': fileScanHandler(pool, file => storage.read(file), scenario => liveScanner ?? createFakeScanAdapter(scenario, configuration.isolated)),
  'calendar.sync': calendarHandler(pool, calendarAdapterFactory(pool, configuration)),
  'notifications.route': notificationRouteHandler(pool),
  'notifications.send': notificationSendHandler(pool, scenario => liveEmail ?? createLocalEmailAdapter('.local/email-inbox', configuration.isolated, scenario), configuration.app_base_url),
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
