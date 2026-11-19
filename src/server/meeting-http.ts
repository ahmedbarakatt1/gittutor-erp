import { getCalendarConnection, listCalendarConnections, getMeetingAccess, getOccurrenceMeeting, type meetingCommands } from '@/modules/teaching/meetings';
import type { IdentityRpcClient } from '@/modules/identity/commands';

type MeetingRoute = { family: 'meetings'; pattern: RegExp; rpc: keyof typeof meetingCommands; pathArgument?: string; fields: string[] };
export const meetingCommandRoutes: MeetingRoute[] = [
  { family: 'meetings', pattern: /^calendar\/connection\/revoke$/, rpc: 'revoke_calendar_connection', fields: ['connection_id', 'expected_version'] },
  { family: 'meetings', pattern: /^occurrences\/([^/]+)\/meeting\/retry$/, rpc: 'retry_meeting_provisioning', pathArgument: 'occurrence_id', fields: ['expected_version'] },
  { family: 'meetings', pattern: /^occurrences\/([^/]+)\/meeting\/replace$/, rpc: 'replace_meeting_access', pathArgument: 'occurrence_id', fields: ['reason', 'expected_version'] },
];
export function findMeetingReadRoute(path: string): { fields: string[]; run: (client: IdentityRpcClient, options: Record<string, unknown>) => Promise<unknown> } | undefined {
  if (path === 'calendar/connection') return { fields: [], run: client => getCalendarConnection(client) };
  if (path === 'calendar/connections') return { fields: [], run: listCalendarConnections };
  const access = /^occurrences\/([^/]+)\/meeting\/access$/.exec(path);
  if (access) return { fields: ['view', 'learner_id'], run: (client, options) => getMeetingAccess(client, access[1], options) };
  const meeting = /^occurrences\/([^/]+)\/meeting$/.exec(path);
  if (meeting) return { fields: ['view', 'learner_id'], run: (client, options) => getOccurrenceMeeting(client, meeting[1], options) };
}
