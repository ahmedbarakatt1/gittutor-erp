import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { calendarHandler } from '../../src/worker/calendar';
import { calendarAdapterFactory } from '../../src/server/calendar-provider';
import { parseServerConfig } from '../../src/server/config';
import { createProviderTokenCipher } from '../../src/server/provider-tokens';
import type { CalendarDesired } from '../../src/server/providers/calendar';
import type { Job } from '../../src/worker/claims';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

function makeJob(): Job {
  const occurrence = randomUUID();
  return { id: randomUUID(), lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 60000),
    purpose: 'calendar.sync', event_type: 'calendar_sync_requested', aggregate_id: occurrence, payload: { occurrence_id: occurrence },
    attempt_count: 1, correlation_id: randomUUID(), event_id: randomUUID() };
}

test('a capacity wait completes the lease without opening a provider connection or dispatching an event', async () => {
  const database = { query: vi.fn().mockResolvedValue({ rows: [{ result: { state: 'suppressed', reason: 'CALENDAR_ORGANIZER_CAPACITY' } }] }) };
  const factory = vi.fn();
  const handler = calendarHandler(database, factory);
  const job = makeJob();
  expect(await handler.execute(job)).toBe('suppressed:CALENDAR_ORGANIZER_CAPACITY');
  expect(await handler.reconcile(job)).toEqual({ outcome: 'completed', reference: 'suppressed:CALENDAR_ORGANIZER_CAPACITY' });
  expect(database.query.mock.calls.map(([sql]) => sql)).toEqual(Array(2).fill('select app_private.prepare_calendar_sync($1,$2,$3) result'));
  expect(factory).not.toHaveBeenCalled();
});

test('parallel jobs use the assigned Google credential for every read and write on that organizer’s primary calendar', async () => {
  const config = parseServerConfig({ APP_ENV: 'test', CALENDAR_ADAPTER: 'google', SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
    GOOGLE_OAUTH_CLIENT_ID: 'synthetic', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic', GOOGLE_CALENDAR_ID: 'old@example.test',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/calendar/google/callback' });
  const cipher = createProviderTokenCipher({ currentKeyId: 'v1', currentKey: 'a'.repeat(64) });
  const slots = [makeJob(), makeJob()].map((job,index) => {
    const connection = randomUUID(), version = randomUUID(), bearer = 'synthetic-bearer-' + index;
    const envelope = cipher.seal({ refresh_token: 'synthetic-refresh-' + index, access_token: bearer,
      expires_at: new Date(Date.now() + 600000).toISOString(), scopes: ['openid','email','https://www.googleapis.com/auth/calendar.events'] },
    { provider: 'google', connection_id: connection, credential_version: version });
    const desired: CalendarDesired = {
      occurrence_id: job.aggregate_id, occurrence_version: 2, connection_id: connection, connection_version: 3,
      credential_version: version, calendar_id: 'primary', provider_event_id: 'gt' + job.aggregate_id.replaceAll('-',''),
      meeting_generation: 1, conference_request_id: randomUUID(), action: 'upsert', start_at: '2030-02-13T15:00:00Z',
      end_at: '2030-02-13T16:30:00Z', tutor_email: 'tutor' + index + '@example.test', title: 'Git Tutor session',
    };
    return { job, desired, envelope, bearer };
  });
  const database = { query: vi.fn() };
  database.query.mockImplementation(async (sql: string, args: unknown[]) => {
    const slot = slots.find(s => args.includes(s.job.lease_token));
    if (!slot) throw new Error('UNEXPECTED_LEASE');
    if (sql.includes('prepare_calendar_sync')) return { rows: [{ result: { state: 'ready', mode: 'google', desired: slot.desired } }] };
    if (sql.includes('get_calendar_credentials')) {
      expect(args).toEqual([slot.desired.connection_id, slot.desired.connection_version, slot.job.id, slot.job.lease_token]);
      return { rows: [{ result: { provider: 'google', connection_id: slot.desired.connection_id,
        credential_version: slot.desired.credential_version, envelope: slot.envelope } }] };
    }
    if (sql.includes('finalize_calendar_sync')) {
      expect(args.slice(0,4)).toEqual([slot.job.aggregate_id,2,slot.desired.connection_id,3]);
      return { rows: [{ result: { applied: true, outcome: 'ready' } }] };
    }
    throw new Error('UNEXPECTED_QUERY');
  });
  const calls = vi.fn(async (input: string, options: RequestInit) => {
    const token = new Headers(options.headers).get('authorization');
    const slot = slots.find(s => token === 'Bearer ' + s.bearer);
    if (!slot) throw new Error('UNKNOWN_CREDENTIAL');
    const path = new URL(input).pathname;
    const eventsPath = '/calendar/v3/calendars/primary/events';
    if (options.method === 'GET') {
      expect(path).toBe(eventsPath + '/' + slot.desired.provider_event_id);
      return new Response(null, { status: 404 });
    }
    expect(path).toBe(eventsPath);
    const event = JSON.parse(String(options.body));
    expect(event.id).toBe(slot.desired.provider_event_id);
    expect(event.attendees).toEqual([{ email: slot.desired.tutor_email }]);
    return Response.json({ ...event, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } });
  });
  vi.stubGlobal('fetch', calls);
  const handler = calendarHandler(database, calendarAdapterFactory(database,config));
  const results = await Promise.all(slots.map(slot => handler.execute(slot.job)));
  expect(results).toEqual(slots.map(slot => slot.desired.provider_event_id + ':1'));
  expect(calls).toHaveBeenCalledTimes(4);
});
