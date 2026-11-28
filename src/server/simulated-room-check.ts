import { randomUUID } from 'node:crypto';
import { createFakeCalendarAdapter, type CalendarDesired } from './providers/calendar';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Exercise the same room lifecycle as the isolated calendar worker, without touching lesson events. */
export async function checkSimulatedRoom(connectionId: string, version: number) {
  const probe = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'git-tutor-room-check-'));
  try {
    const adapter = createFakeCalendarAdapter(directory);
    const now = Date.now();
    const desired: CalendarDesired = {
      occurrence_id: probe, occurrence_version: 1, connection_id: connectionId, connection_version: version,
      credential_version: null, calendar_id: 'probe@example.test', provider_event_id: 'gt' + probe.replaceAll('-', ''),
      meeting_generation: 1, conference_request_id: probe, action: 'upsert',
      start_at: new Date(now).toISOString(), end_at: new Date(now + 60000).toISOString(),
      tutor_email: 'probe@example.test', title: 'Simulated room check',
    };
    await adapter.apply(desired);
    const room = await adapter.reconcile(desired);
    const cancelled = await adapter.apply({ ...desired, action: 'cancel' });
    if (room.outcome !== 'ready' || !room.matches_desired || !room.join_url || cancelled.outcome !== 'revoked') {
      throw new Error('DEPENDENCY_UNAVAILABLE');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
