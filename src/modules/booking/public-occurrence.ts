import { z } from 'zod';

export const occurrenceStateSchema=z.enum(['draft','forming','confirmed','in_progress','completion_pending','completed','cancelled']);
export const meetingStatusSchema=z.enum(['not_requested','pending','ready','failed','revoked']);
export const occurrenceSummarySchema=z.object({
  occurrence_id:z.uuid(),version:z.number().int().positive().max(2147483647),offer_id:z.uuid(),
  tutor:z.object({tutor_id:z.uuid(),display_name:z.string()}).strict(),
  start_at:z.iso.datetime({offset:true}),end_at:z.iso.datetime({offset:true}),time_zone:z.literal('Africa/Cairo'),
  state:occurrenceStateSchema,format:z.enum(['private','group']),target_tier:z.union([z.literal(2),z.literal(3),z.literal(4)]).nullable(),
  capacity:z.number().int().min(1).max(4),available_seats:z.number().int().min(0).max(4),waitlist_available:z.boolean(),
  customer_price_minor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),currency:z.literal('EGP'),
  policy_version_id:z.uuid(),pricing_version_id:z.uuid(),
}).strict();
export const publicOccurrenceSchema=occurrenceSummarySchema.extend({state:z.enum(['forming','confirmed'])});
export type PublicOccurrence=z.infer<typeof publicOccurrenceSchema>;
export type OccurrenceSummary=z.infer<typeof occurrenceSummarySchema>;
