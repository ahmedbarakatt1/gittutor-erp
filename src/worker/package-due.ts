import type { Pool } from 'pg';
import { z } from 'zod';
import type { Job } from './claims';
import type { JobHandler } from './execute';

const payloadSchema = z.object({ package_purchase_id: z.uuid() }).strict();
const resultSchema = z.object({
  expired_lot_ids: z.array(z.uuid()),
  next_due_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

/** Available-lot expiry and its next due job share the same durable database transaction. */
export function packageDueHandler(database: Pool): JobHandler {
  async function process(job: Job): Promise<string> {
    const payload = payloadSchema.safeParse(job.payload);
    if (job.purpose !== 'packages.process_due' || job.event_type !== 'package_due'
      || !z.uuid().safeParse(job.id).success || !payload.success || payload.data.package_purchase_id !== job.aggregate_id) {
      throw new Error('PACKAGE_JOB_INVALID');
    }
    const key = `package-due:${job.id}`;
    const result = await database.query('select app_private.process_package_due($1,$2) as result', [payload.data.package_purchase_id, key]);
    if (result.rows.length !== 1 || !resultSchema.safeParse(result.rows[0].result).success) throw new Error('PACKAGE_JOB_RESULT_INVALID');
    return key;
  }
  return {
    execute: process,
    // A repeated durable key resolves a lost acknowledgement without another movement or external dispatch.
    reconcile: async job => ({ outcome: 'completed', reference: await process(job) }),
  };
}
