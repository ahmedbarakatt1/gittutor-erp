import type { Pool } from 'pg';
import { z } from 'zod';
import type { Job } from './claims';
import type { JobHandler } from './execute';

const payloadSchema = z.object({ occurrence_id: z.uuid() }).strict();
const resultSchema = z.object({
  expired_enrollment_ids: z.array(z.uuid()),
  promoted_waitlist_entry_id: z.uuid().nullable(),
  enrollment_id: z.uuid().nullable(),
  next_due_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

/** Expiry, promotion and the next scheduled job commit in one idempotent database transaction. */
export function bookingDueHandler(database: Pool): JobHandler {
  async function process(job: Job): Promise<string> {
    const payload = payloadSchema.safeParse(job.payload);
    if (job.purpose !== 'booking.process_due' || job.event_type !== 'booking_due'
      || !z.uuid().safeParse(job.id).success || !payload.success || payload.data.occurrence_id !== job.aggregate_id) {
      throw new Error('BOOKING_JOB_INVALID');
    }
    const key = `booking-due:${job.id}`;
    const result = await database.query('select app_private.process_occurrence_booking_due($1,$2) as result', [payload.data.occurrence_id, key]);
    if (result.rows.length !== 1 || !resultSchema.safeParse(result.rows[0].result).success) throw new Error('BOOKING_JOB_RESULT_INVALID');
    return key;
  }
  return {
    execute: process,
    // This work has no external dispatch. Replaying the same durable key resolves a lost DB acknowledgement.
    reconcile: async job => ({ outcome: 'completed', reference: await process(job) }),
  };
}
