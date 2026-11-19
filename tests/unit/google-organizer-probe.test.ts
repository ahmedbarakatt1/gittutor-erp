import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));
import { verifyGoogleOrganizer } from '../../src/server/google-organizer-probe';

const input = { calendar_id: 'organizer+test@example.test', access_token: 'stub-token', probe_id: '7b865c57-dafc-4ed6-9f95-b6053af20f01' };
type Event = {
  id: string; etag: string; status: string;
  extendedProperties: { private: Record<string, string> };
  conferenceData: {
    createRequest: { requestId: string; conferenceSolutionKey: { type: string }; status: { statusCode: string } };
    conferenceSolution: { key: { type: string } }; entryPoints: { entryPointType: string; uri: string }[];
  };
  start: { dateTime: string }; end: { dateTime: string };
};

function provider(options: {
  insert?: () => Response;
  read?: (event: Event, count: number) => Response;
  remove?: (count: number) => Response;
} = {}) {
  let event: Event;
  let reads = 0, deletes = 0;
  const http = vi.fn<typeof fetch>(async (url, init) => {
    const endpoint = new URL(String(url));
    expect(endpoint.origin).toBe('https://www.googleapis.com');
    expect(endpoint.pathname).toContain('/calendar/v3/calendars/organizer%2Btest%40example.test/events');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer stub-token');
    if (init?.method === 'POST') {
      expect(endpoint.searchParams.get('conferenceDataVersion')).toBe('1');
      expect(endpoint.searchParams.get('sendUpdates')).toBe('none');
      event = JSON.parse(String(init.body)) as Event;
      expect(event).toMatchObject({ visibility: 'private', transparency: 'transparent', reminders: { useDefault: false } });
      expect(event).not.toHaveProperty('attendees');
      expect(event.id).toMatch(/^[0-9a-v]{5,1024}$/);
      expect(Date.parse(event.end.dateTime)).toBeLessThan(Date.now());
      expect(Date.parse(event.start.dateTime)).toBeLessThan(Date.parse(event.end.dateTime));
      event.etag = '"version-1"';
      event.status = 'confirmed';
      event.conferenceData.createRequest.status = { statusCode: 'success' };
      event.conferenceData.conferenceSolution = { key: { type: 'hangoutsMeet' } };
      event.conferenceData.entryPoints = [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }];
      return options.insert ? options.insert() : Response.json(event);
    }
    expect(endpoint.pathname.endsWith('/' + event.id)).toBe(true);
    if (init?.method === 'DELETE') {
      deletes++;
      expect(endpoint.searchParams.get('sendUpdates')).toBe('none');
      expect(new Headers(init.headers).get('if-match')).toBe(event.etag);
      return options.remove ? options.remove(deletes) : new Response(null, { status: 204 });
    }
    reads++;
    expect(init?.method).toBe('GET');
    return options.read ? options.read(event, reads) : Response.json(event);
  });
  return { http, counts: () => ({ reads, deletes }), event: () => event };
}

test('proves a real Meet video entry and cleans up its private one-minute event', async () => {
  const google = provider();
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts().deletes).toBe(1);
  const retry = provider({ insert: () => new Response(null, { status: 409 }) });
  expect(await verifyGoogleOrganizer(input, retry.http)).toBe(true);
  expect(retry.event().id).toBe(google.event().id);
  expect(retry.event().extendedProperties).toEqual(google.event().extendedProperties);
  expect(retry.event().conferenceData.createRequest.requestId).toBe(google.event().conferenceData.createRequest.requestId);
});

test('reconciles a lost insert and pending conference without submitting another event', async () => {
  const google = provider({ insert: () => { throw new Error('timeout'); }, read(event, count) {
    event.conferenceData.createRequest.status.statusCode = count === 1 ? 'pending' : 'success';
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts()).toEqual({ reads: 2, deletes: 1 });
  expect(google.http.mock.calls.filter(([,init]) => init?.method === 'POST')).toHaveLength(1);
});

test.each(['marker', 'id', 'etag'] as const)('a conflict with a different or unguarded event (%s) never deletes it', async missing => {
  const google = provider({ insert: () => new Response(null, { status: 409 }), read(event) {
    if (missing === 'marker') event.extendedProperties.private = {};
    if (missing === 'id') event.id = 'different-event';
    if (missing === 'etag') event.etag = '*';
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(false);
  expect(google.http.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

test.each(['foreign-link', 'phone', 'status', 'request-id', 'provider'])('rejects an invalid conference (%s) and still cleans up', async reason => {
  const google = provider({ read(event) {
    const data = event.conferenceData;
    if (reason === 'foreign-link') data.entryPoints[0].uri = 'https://meet.google.com.example.test/abc-defg-hij';
    if (reason === 'phone') data.entryPoints[0].entryPointType = 'phone';
    if (reason === 'status') data.createRequest.status.statusCode = 'failure';
    if (reason === 'request-id') data.createRequest.requestId = 'foreign-request';
    if (reason === 'provider') data.conferenceSolution.key.type = 'addOn';
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(false);
  expect(google.counts().deletes).toBe(1);
});

test.each([404, 410])('reconciles an unknown delete with a later %i', async status => {
  const google = provider({ remove: () => { throw new Error('response lost'); }, read(event, count) {
    return count === 1 ? Response.json(event) : new Response(null, { status });
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts()).toEqual({ reads: 2, deletes: 1 });
});

test.each([404, 410])('accepts an idempotent %i deleting the already-verified event', async status => {
  const google = provider({ remove: () => new Response(null, { status }) });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts().deletes).toBe(1);
});

test('rechecks private ownership on a version conflict before retrying deletion', async () => {
  const google = provider({ remove: count => new Response(null, { status: count === 1 ? 412 : 204 }), read(event, count) {
    event.etag = '"version-' + count + '"';
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts()).toEqual({ reads: 2, deletes: 2 });
});

test('fails closed when cleanup is denied, or an existing tombstone offers no conference proof', async () => {
  const refused = provider({ remove: () => new Response(null, { status: 403 }) });
  expect(await verifyGoogleOrganizer(input, refused.http)).toBe(false);
  const gone = provider({ insert: () => new Response(null, { status: 409 }), read: () => new Response(null, { status: 410 }) });
  expect(await verifyGoogleOrganizer(input, gone.http)).toBe(false);
  expect(gone.counts().deletes).toBe(0);
});

test('an uncertain creation can be initially absent and then found by its deterministic ID', async () => {
  const google = provider({ insert: () => new Response(null, { status: 503 }), read(event, count) {
    return count === 1 ? new Response(null, { status: 404 }) : Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(true);
  expect(google.counts()).toEqual({ reads: 2, deletes: 1 });
});

test('keeps the account unverified and cleans up a permanently pending event', async () => {
  const google = provider({ read(event) {
    event.conferenceData.createRequest.status.statusCode = 'pending';
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(false);
  expect(google.counts().deletes).toBe(1);
  expect(google.counts().reads).toBeLessThanOrEqual(7);
});

test('uses an acknowledged private insert and its ETag for cleanup if reads go offline', async () => {
  const google = provider({ read: () => { throw new Error('timeout'); } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(false);
  expect(google.counts().deletes).toBe(1);
});

test('a replacement with a different ownership marker stops a delete retry', async () => {
  const google = provider({ remove: () => new Response(null, { status: 412 }), read(event, count) {
    if (count > 1) event.extendedProperties.private = {};
    return Response.json(event);
  } });
  expect(await verifyGoogleOrganizer(input, google.http)).toBe(false);
  expect(google.counts()).toEqual({ reads: 2, deletes: 1 });
});

test.each([{ calendar_id: '..' }, { access_token: 'invalid\nheader' }, { probe_id: 'not-an-attempt' }])('invalid request stays local', async invalid => {
  const http = vi.fn<typeof fetch>();
  expect(await verifyGoogleOrganizer({ ...input, ...invalid }, http)).toBe(false);
  expect(http).not.toHaveBeenCalled();
});
