import { getTutorStatement, listTutorEarnings, listPayoutDestinations, listPayouts, listPayoutTutors, listTutorAwards, type payrollCommands } from '@/modules/tutor_pay/payroll';
import type { IdentityRpcClient } from '@/modules/identity/commands';
type Route = { family: 'payroll'; pattern: RegExp; rpc: keyof typeof payrollCommands; fields: string[]; pathArgument?: string };
export const payrollCommandRoutes: Route[] = [
  {family:'payroll',pattern:/^occurrences\/([^/]+)\/cancellation-award$/,rpc:'approve_cancellation_award',pathArgument:'occurrence_id',fields:['cancellation_decision_id','amount_minor','reason','expected_version']},
  {family:'payroll',pattern:/^occurrences\/([^/]+)\/reassignment-award$/,rpc:'approve_reassignment_award',pathArgument:'occurrence_id',fields:['reassignment_id','amount_minor','reason','expected_version']},
  { family: 'payroll', pattern: /^tutors\/([^/]+)\/payout-methods$/, rpc: 'set_tutor_payout_methods', pathArgument: 'tutor_id', fields: ['channels', 'expected_version'] },
  { family: 'payroll', pattern: /^tutor\/payout-destinations$/, rpc: 'submit_payout_destination', fields: ['channel', 'identifier', 'payee_name'] },
  { family: 'payroll', pattern: /^payout-destinations\/([^/]+)\/verify$/, rpc: 'verify_payout_destination', pathArgument: 'destination_id', fields: ['evidence_file_id', 'decision', 'reason', 'expected_version'] },
  { family: 'payroll', pattern: /^payouts$/, rpc: 'authorize_payout', fields: ['tutor_id', 'destination_version_id', 'allocations'] },
  { family: 'payroll', pattern: /^payouts\/([^/]+)\/retry$/, rpc: 'retry_payout', pathArgument: 'payout_attempt_id', fields: ['destination_version_id', 'expected_version'] },
  { family: 'payroll', pattern: /^payouts\/([^/]+)\/reconcile$/, rpc: 'reconcile_payout', pathArgument: 'payout_attempt_id', fields: ['outcome', 'receiving_account_id', 'external_reference', 'evidence_file_id', 'settled_at', 'expected_version'] },
  { family: 'payroll', pattern: /^payouts\/([^/]+)\/reversals$/, rpc: 'record_payout_reversal', pathArgument: 'payout_attempt_id', fields: ['amount_minor', 'receiving_account_id', 'external_reference', 'evidence_file_id', 'effective_at', 'reason', 'expected_version'] },
];
export function findPayrollReadRoute(path: string): { fields: string[]; run: (client: IdentityRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  if(path==='tutor/awards')return{fields:['tutor_id','cursor','limit'],run:(client,options)=>listTutorAwards(client,options)};
  if (path === 'tutor/statement') return { fields: ['tutor_id', 'as_of'], run: (client, options) => getTutorStatement(client, options.tutor_id as string | undefined, options.as_of as string | undefined) };
  if (path === 'tutor/earnings') return { fields: ['tutor_id', 'cursor', 'limit'], run: (client, options) => listTutorEarnings(client, options) };
  if (path === 'tutor/payout-destinations') return { fields: ['tutor_id', 'cursor', 'limit'], run: (client, options) => listPayoutDestinations(client, options) };
  if (path === 'payouts') return { fields: ['tutor_id', 'cursor', 'limit'], run: (client, options) => listPayouts(client, options) };
  if (path === 'payout-tutors') return { fields: ['cursor', 'limit'], run: (client, options) => listPayoutTutors(client, options) };
}
