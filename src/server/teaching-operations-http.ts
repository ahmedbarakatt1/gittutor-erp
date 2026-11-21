import { getOccurrenceSeries, getSeriesChangeSet, listOccurrenceSeries, listUnavailabilityCases, getTutorReassignment, listTutorReassignments, type teachingCommands } from '@/modules/teaching/operations';
import type { IdentityRpcClient } from '@/modules/identity/commands';
import { getSessionQuizzes, listMyQuizResults } from '@/modules/teaching/quizzes';
type OperationRoute = { family: 'teaching-operations'; pattern: RegExp; rpc: keyof typeof teachingCommands; pathArgument?: string; fields: string[] };
export const teachingOperationRoutes: OperationRoute[] = [
  { family: 'teaching-operations', pattern: /^occurrences\/([^/]+)\/quizzes$/, rpc: 'create_session_quiz', pathArgument: 'occurrence_id', fields: ['title', 'file_id', 'max_score'] },
  { family: 'teaching-operations', pattern: /^quizzes\/([^/]+)\/grades$/, rpc: 'record_quiz_grade', pathArgument: 'quiz_id', fields: ['learner_id', 'score', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^occurrences\/([^/]+)\/tutor-reassignments$/, rpc: 'propose_tutor_reassignment', pathArgument: 'occurrence_id', fields: ['new_tutor_id', 'new_fee_minor', 'old_tutor_compensation_minor', 'expires_at', 'reason', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^tutor-reassignments\/([^/]+)\/accept$/, rpc: 'accept_tutor_reassignment', pathArgument: 'proposal_id', fields: ['terms_hash', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^tutor-reassignments\/([^/]+)\/approve$/, rpc: 'approve_tutor_reassignment', pathArgument: 'proposal_id', fields: ['terms_hash', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^tutor-reassignments\/([^/]+)\/decline$/, rpc: 'decline_tutor_reassignment', pathArgument: 'proposal_id', fields: ['reason', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^tutor-reassignments\/([^/]+)\/commit$/, rpc: 'commit_tutor_reassignment', pathArgument: 'proposal_id', fields: ['expected_version'] },
  { family: 'teaching-operations', pattern: /^tutor-unavailability$/, rpc: 'report_tutor_unavailability', fields: ['tutor_id', 'from_at', 'to_at', 'reason', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^unavailability-cases\/([^/]+)\/assign$/, rpc: 'assign_unavailability_case', pathArgument: 'case_id', fields: ['owner_account_id', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^unavailability-cases\/([^/]+)\/resolve$/, rpc: 'resolve_unavailability_case', pathArgument: 'case_id', fields: ['resolution_proposal_id', 'reason', 'expected_version'] },
  { family: 'teaching-operations', pattern: /^occurrence-series$/, rpc: 'create_occurrence_series', fields: ['title', 'occurrence_ids'] },
  { family: 'teaching-operations', pattern: /^occurrence-series\/([^/]+)\/changes$/, rpc: 'create_series_change_set', pathArgument: 'series_id', fields: ['selection', 'changes', 'expires_at', 'reason'] },
];
export function findTeachingOperationReadRoute(path: string): { fields: string[]; run: (client: IdentityRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  if (path === 'me/quiz-results') return { fields: ['learner_id', 'cursor', 'limit'], run: listMyQuizResults };
  const sessionQuizzes = /^occurrences\/([^/]+)\/quizzes$/.exec(path);
  if (sessionQuizzes) return { fields: ['view', 'learner_id'], run: (client, options) => getSessionQuizzes(client, sessionQuizzes[1], options) };
  if (path === 'tutor-reassignments') return { fields: ['view', 'learner_id', 'occurrence_id', 'state', 'cursor', 'limit'], run: (client, options) => listTutorReassignments(client, options) };
  const reassignment = /^tutor-reassignments\/([^/]+)$/.exec(path); if (reassignment) return { fields: ['view', 'learner_id'], run: (client, options) => getTutorReassignment(client, reassignment[1], options) };
  if (path === 'unavailability-cases') return { fields: ['tutor_id', 'state', 'cursor', 'limit'], run: (client, options) => listUnavailabilityCases(client, options) };
  if (path === 'occurrence-series') return { fields: ['tutor_id', 'cursor', 'limit'], run: (client, options) => listOccurrenceSeries(client, options) };
  const series = /^occurrence-series\/([^/]+)$/.exec(path); if (series) return { fields: ['cursor', 'limit'], run: (client, options) => getOccurrenceSeries(client, series[1], options) };
  const change = /^series-change-sets\/([^/]+)$/.exec(path); if (change) return { fields: ['cursor', 'limit'], run: (client, options) => getSeriesChangeSet(client, change[1], options) };
}
