import { getEnrollmentTransferConsent, getEnrollmentTransferProposal, listEnrollmentTransferSources, listMyEnrollmentTransferConsents, type EnrollmentTransferCommandName } from '@/modules/booking/enrollment-transfers';
import type { BookingRpcClient } from '@/modules/booking/commands';

type CommandRoute = { family: 'enrollment-transfer'; pattern: RegExp; rpc: EnrollmentTransferCommandName; pathArgument: string; fields: string[] };
export const enrollmentTransferCommandRoutes: CommandRoute[] = [
  { family: 'enrollment-transfer', pattern: /^enrollment-transfer-proposals\/([^/]+)\/review$/, rpc: 'review_enrollment_transfer_proposal', pathArgument: 'proposal_id', fields: ['source_tutor_fee_minor', 'carryover_allocations', 'source_package_disposition', 'reason', 'expected_version'] },
  { family: 'enrollment-transfer', pattern: /^enrollment-transfer-consents\/([^/]+)\/accept$/, rpc: 'accept_enrollment_transfer_consent', pathArgument: 'consent_id', fields: ['terms_hash', 'expected_version'] },
  { family: 'enrollment-transfer', pattern: /^enrollment-transfer-consents\/([^/]+)\/decline$/, rpc: 'decline_enrollment_transfer_consent', pathArgument: 'consent_id', fields: ['reason', 'expected_version'] },
];
export function findEnrollmentTransferReadRoute(path: string): { fields: string[]; run: (client: BookingRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  if (path === 'me/enrollment-transfer-consents') return { fields: ['state', 'cursor', 'limit'], run: (client, options) => listMyEnrollmentTransferConsents(client, options) };
  const sources = /^enrollment-transfer-proposals\/([^/]+)\/sources$/.exec(path);
  if (sources) return { fields: ['cursor', 'limit'], run: (client, options) => listEnrollmentTransferSources(client, sources[1], options) };
  const proposal = /^enrollment-transfer-proposals\/([^/]+)$/.exec(path);
  if (proposal) return { fields: ['view', 'learner_id'], run: (client, options) => getEnrollmentTransferProposal(client, proposal[1], options as Parameters<typeof getEnrollmentTransferProposal>[2]) };
  const consent = /^enrollment-transfer-consents\/([^/]+)$/.exec(path);
  if (consent) return { fields: [], run: client => getEnrollmentTransferConsent(client, consent[1]) };
}
