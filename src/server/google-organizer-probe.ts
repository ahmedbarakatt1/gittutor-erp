import 'server-only';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const inputSchema = z.object({
  calendar_id: z.string().min(1).max(1024).regex(/^[!-~]+$/).refine(id => id !== '.' && id !== '..'),
  access_token: z.string().min(1).max(16384).regex(/^[!-~]+$/),
  probe_id: z.uuid(),
});
const eventSchema = z.object({
  id: z.string(), status: z.string().optional(), etag: z.string().optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
  conferenceData: z.unknown().optional(),
});
const conferenceSchema = z.object({
  createRequest: z.object({ requestId: z.string(), status: z.object({ statusCode: z.string() }) }),
  conferenceSolution: z.object({ key: z.object({ type: z.string() }) }).optional(),
  entryPoints: z.array(z.object({ entryPointType: z.string(), uri: z.string() })).optional(),
});

type Conference = 'pending' | 'ready' | 'invalid';
type Observation = { kind: 'owned'; etag: string; conference: Conference }
  | { kind: 'absent' | 'gone' | 'foreign' | 'unknown' };

function conferenceState(data: unknown, requestId: string): Conference {
  if (data === undefined) return 'pending';
  const parsed = conferenceSchema.safeParse(data);
  if (!parsed.success || parsed.data.createRequest.requestId !== requestId) return 'invalid';
  const { createRequest, conferenceSolution, entryPoints } = parsed.data;
  if (createRequest.status.statusCode === 'pending') return 'pending';
  const hasMeetVideo = entryPoints?.some(point => point.entryPointType === 'video'
    && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(point.uri));
  return createRequest.status.statusCode === 'success' && conferenceSolution?.key.type === 'hangoutsMeet' && hasMeetVideo
    ? 'ready' : 'invalid';
}

/** Reuse the durable OAuth request ID for retries of the same consent attempt. */
export async function verifyGoogleOrganizer(input: z.input<typeof inputSchema>, fetcher: typeof fetch = fetch): Promise<boolean> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return false;
  const { calendar_id, access_token, probe_id } = parsed.data;
  const digest = (purpose: string) => createHash('sha256')
    .update(JSON.stringify(['GitTutor/organizer-probe/v1', purpose, calendar_id, probe_id])).digest('hex');
  const id = digest('event'), marker = digest('ownership'), requestId = digest('conference');
  const collection = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendar_id) + '/events';
  const resource = collection + '/' + id;
  const fields = 'id,etag,status,extendedProperties/private,conferenceData(createRequest,conferenceSolution/key/type,entryPoints(entryPointType,uri))';
  const started = Date.now(), verifyUntil = started + 9000, cleanupUntil = started + 15000;

  async function send(url: string, method: string, until: number, body?: object, etag?: string) {
    const milliseconds = Math.min(3000, until - Date.now());
    if (milliseconds <= 0) return null;
    try {
      return await fetcher(url, {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(milliseconds),
        headers: { Authorization: 'Bearer ' + access_token, ...(body && { 'Content-Type': 'application/json' }), ...(etag && { 'If-Match': etag }) },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch { return null; }
  }

  async function observe(response: Response | null): Promise<Observation> {
    if (response?.status === 404) return { kind: 'absent' };
    if (response?.status === 410) return { kind: 'gone' };
    if (!response?.ok) return { kind: 'unknown' };
    const event = eventSchema.safeParse(await response.json().catch(() => null));
    if (!event.success) return { kind: 'unknown' };
    const data = event.data;
    if (data.id !== id) return { kind: 'foreign' };
    if (data.status === 'cancelled') return { kind: 'gone' };
    if (data.extendedProperties?.private?.git_tutor_organizer_probe !== marker) return { kind: 'foreign' };
    if (!data.etag || !/^"[!#-~]{1,200}"$/.test(data.etag)) return { kind: 'unknown' };
    return { kind: 'owned', etag: data.etag, conference: conferenceState(data.conferenceData, requestId) };
  }

  async function read(until: number) {
    return observe(await send(resource + '?fields=' + encodeURIComponent(fields), 'GET', until));
  }

  async function remove(etag: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await send(resource + '?sendUpdates=none', 'DELETE', cleanupUntil, undefined, etag);
      if (response && [200, 204, 404, 410].includes(response.status)) return true;
      if (response?.status === 401 || response?.status === 403) return false;
      // A lost delete response may already have removed the event. A 412 needs fresh ownership proof.
      const latest = await read(cleanupUntil);
      if (latest.kind === 'absent' || latest.kind === 'gone') return true;
      if (latest.kind !== 'owned') return false;
      etag = latest.etag;
    }
    return false;
  }

  const end = started - 60000;
  const inserted = await send(collection + '?conferenceDataVersion=1&sendUpdates=none&fields=id,etag,extendedProperties/private', 'POST', verifyUntil, {
    id, summary: 'Git Tutor organizer verification', visibility: 'private', transparency: 'transparent',
    reminders: { useDefault: false }, start: { dateTime: new Date(end - 60000).toISOString() }, end: { dateTime: new Date(end).toISOString() },
    extendedProperties: { private: { git_tutor_organizer_probe: marker } },
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  });
  const mayHaveInserted = !inserted || inserted.ok || inserted.status === 409 || inserted.status >= 500;
  // An acknowledged insert may be our only ownership proof if later reads go offline.
  let lastOwned = inserted?.ok ? await observe(inserted) : undefined;
  let observed = await read(verifyUntil);
  for (const backoff of [250, 500, 1000, 2000, 3000]) {
    if (!mayHaveInserted || observed.kind === 'gone' || observed.kind === 'foreign'
      || (observed.kind === 'owned' && observed.conference !== 'pending')) break;
    if (Date.now() + backoff >= verifyUntil) break;
    if (observed.kind === 'owned') lastOwned = observed;
    await delay(backoff);
    observed = await read(verifyUntil);
  }
  // Reserve a final lookup for ambiguous insert/read outcomes, even when capability verification failed.
  if (observed.kind === 'unknown' || observed.kind === 'absent') observed = await read(cleanupUntil);
  const cleanupTarget = observed.kind === 'unknown' ? lastOwned : observed;
  if (cleanupTarget?.kind !== 'owned') return false;
  const cleaned = await remove(cleanupTarget.etag);
  return mayHaveInserted && observed.kind === 'owned' && observed.conference === 'ready' && cleaned;
}
