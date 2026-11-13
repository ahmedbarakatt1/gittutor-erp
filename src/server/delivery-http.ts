import type { TeachingCommandName } from '@/modules/teaching/commands';
import { getOccurrenceDelivery } from '@/modules/teaching/queries';
import type { BookingRpcClient } from '@/modules/booking/commands';
type DeliveryRoute = { family: 'delivery'; pattern: RegExp; rpc: TeachingCommandName; pathArgument: string; fields: string[] };
export const deliveryCommandRoutes: DeliveryRoute[] = [
  { family: 'delivery', pattern: /^occurrences\/([^/]+)\/start$/, rpc: 'start_occurrence', pathArgument: 'occurrence_id', fields: ['actual_start_at', 'expected_version'] },
  { family: 'delivery', pattern: /^occurrences\/([^/]+)\/attendance$/, rpc: 'record_attendance', pathArgument: 'occurrence_id', fields: ['actual_start_at', 'actual_end_at', 'entries', 'expected_version'] },
  { family: 'delivery', pattern: /^occurrences\/([^/]+)\/completion$/, rpc: 'submit_completion', pathArgument: 'occurrence_id', fields: ['attendance_version', 'topic_summary', 'delivery_exception_ids', 'expected_version'] },
  { family: 'delivery', pattern: /^occurrences\/([^/]+)\/completion\/approve$/, rpc: 'approve_completion', pathArgument: 'occurrence_id', fields: ['completion_version', 'approved_remedy_ids', 'expected_version'] },
  { family: 'delivery', pattern: /^occurrences\/([^/]+)\/delivery-review$/, rpc: 'review_delivery_exception', pathArgument: 'occurrence_id', fields: ['attendance_version', 'tutor_fee_minor', 'enrollment_outcomes', 'reason', 'evidence_file_id', 'expected_version'] },
  { family: 'delivery', pattern: /^completions\/([^/]+)\/amend$/, rpc: 'amend_completion', pathArgument: 'completion_id', fields: ['corrected_facts', 'evidence_file_id', 'reason', 'expected_version'] },
];
export function findDeliveryReadRoute(path: string): { fields: string[]; run: (client: BookingRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  const match = /^occurrences\/([^/]+)\/delivery$/.exec(path);
  if (match) return { fields: ['view'], run: (client, options) => getOccurrenceDelivery(client, match[1], options.view as 'tutor' | 'admin' | undefined) };
}
