import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { generateRequestDriveId, putRequestDriveFile, reconcileRequestDriveReaders, trashRequestDriveFile } from '../../src/server/request-drive-provider';

const token = 'synthetic-token', id = 'opaque-Drive_ID', fileId = '4bdbf5ef-ad4a-4fb7-90eb-c96593ff6411';
const bytes = Buffer.from('%PDF-1.4\nSynthetic material\n%%EOF');
const checksum = createHash('sha256').update(bytes).digest('hex');
const source = { fileId, name: 'Notes.pdf', mimeType: 'application/pdf', bytes, checksum };
const metadata = {
  id, ownedByMe: true, owners: [{ me: true, permissionId: 'owner' }], trashed: false, writersCanShare: false,
  appProperties: { gitTutorRequestFile: fileId, sha256: checksum, sizeBytes: String(bytes.length) },
  size: String(bytes.length), sha256Checksum: checksum, mimeType: source.mimeType,
};
const owner = { id: 'owner', role: 'owner', type: 'user', emailAddress: 'owner@example.test' };
const viewer = { id: 'viewer', role: 'reader', type: 'user', emailAddress: 'tutor@example.test' };
const missing = () => new Response(null, { status: 404 });
const success = () => new Response(null, { status: 204 });
const json = (value: unknown) => Response.json(value);

function responses(...responses: Response[]) {
  const http = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected network request');
    return next;
  });
  vi.stubGlobal('fetch', http);
  return http;
}
afterEach(() => vi.unstubAllGlobals());

test('allocates exactly one opaque file ID for My Drive', async () => {
  const http = responses(json({ ids: [id] }));
  expect(await generateRequestDriveId(token)).toBe(id);
  const url = new URL(String(http.mock.calls[0][0]));
  expect(url.pathname).toBe('/drive/v3/files/generateIds');
  expect(url.searchParams.get('count')).toBe('1');
  expect(url.searchParams.get('space')).toBe('drive');
});

const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque';
test('creates private metadata in My Drive and sends the original verified bytes', async () => {
  const http = responses(missing(), new Response(null, { headers: { location: session } }), json(metadata));
  await putRequestDriveFile(token, id, source);
  const [[, read], [url, init], [upload, put]] = http.mock.calls;
  for (const call of [read, init, put]) {
    expect(call?.cache).toBe('no-store');
    expect(call?.redirect).toBe('error');
    expect(call?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(new URL(String(url)).searchParams.get('ignoreDefaultVisibility')).toBe('true');
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({ id, mimeType: source.mimeType, writersCanShare: false, appProperties: metadata.appProperties });
  expect(body.parents).toBeUndefined();
  expect(String(upload)).toBe(session);
  expect(put?.method).toBe('PUT');
  expect(Buffer.from(put?.body as Uint8Array)).toEqual(bytes);
});

test('reconciles a create conflict against the bound identity and the exact bytes', async () => {
  const http = responses(missing(), new Response(null, { status: 409 }), json(metadata));
  await putRequestDriveFile(token, id, source);
  expect(http.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET']);
});

test.each([{ size: '0' }, { sha256Checksum: 'mismatch' }, { ownedByMe: false }, { appProperties: {} }])(
  'refuses a conflicting pre-existing object without writing (%o)', async (override) => {
    const http = responses(json({ ...metadata, ...override }));
    await expect(putRequestDriveFile(token, id, source)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });

test('rejects an untrusted upload session destination before sending bytes', async () => {
  const http = responses(missing(), new Response(null, { headers: { location: 'https://example.test/upload' } }));
  await expect(putRequestDriveFile(token, id, source)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(2);
});

test('checks all paginated permissions and verifies revocation before granting one reader without email', async () => {
  const stale = [
    { id: 'public', role: 'reader', type: 'anyone' }, { id: 'domain:example.test', role: 'publishedReader', type: 'domain', view: 'published' },
    { id: 'group', role: 'reader', type: 'group', emailAddress: viewer.emailAddress },
    { ...viewer, role: 'writer' },
  ];
  const http = responses(json(metadata), json({ permissions: [owner], nextPageToken: 'page2' }), json({ permissions: stale }),
    ...stale.map(success), json({ permissions: [owner] }), json(viewer), json({ permissions: [owner, viewer] }));
  await reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress);
  expect(new URL(String(http.mock.calls[2][0])).searchParams.get('pageToken')).toBe('page2');
  expect(http.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) =>
    decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!))).toEqual(stale.map(p => p.id));
  const grant = http.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(new URL(String(grant[0])).searchParams.get('sendNotificationEmail')).toBe('false');
  expect(JSON.parse(String(grant[1]?.body))).toEqual({ emailAddress: viewer.emailAddress, type: 'user', role: 'reader' });
});

test('matching owner and viewer need no permission writes on retry', async () => {
  const http = responses(json(metadata), json({ permissions: [owner, viewer] }));
  await reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress.toUpperCase());
  expect(http).toHaveBeenCalledTimes(2);
});

test('restores a verified trashed file only after stripping readers and rechecking permissions', async () => {
  const http = responses(json({ ...metadata, trashed: true }), json({ permissions: [owner, viewer] }),
    success(), json({ permissions: [owner] }), json(metadata), json({ permissions: [owner] }),
    json(viewer), json({ permissions: [owner, viewer] }));
  await reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress);
  expect(http.mock.calls.map(([, init]) => init?.method ?? 'GET'))
    .toEqual(['GET', 'GET', 'DELETE', 'GET', 'PATCH', 'GET', 'POST', 'GET']);
  expect(JSON.parse(String(http.mock.calls[4][1]?.body))).toMatchObject({ trashed: false, writersCanShare: false });
});

test('provider content drift revokes all viewers and blocks a grant', async () => {
  const http = responses(json({ ...metadata, sha256Checksum: 'changed' }), json({ permissions: [owner, viewer] }),
    success(), json({ permissions: [owner] }));
  await expect(reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress)).rejects.toThrow('DRIVE_FILE_CONTENT_MISMATCH');
  expect(http.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET', 'DELETE', 'GET']);
});

test.each([
  {}, { permissions: [] }, { permissions: [owner, { role: 'reader' }] }, { permissions: [owner, owner] },
  { permissions: [{ ...owner, id: 'other-owner' }] }, { permissions: [owner], nextPageToken: null },
])('ambiguous permission reads never authorize a grant (%o)', async (page) => {
  const http = responses(json(metadata), json(page));
  await expect(reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress)).rejects.toThrow();
  expect(http.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

test('a failed deletion stops reconciliation before a grant', async () => {
  const http = responses(json(metadata), json({ permissions: [owner, { ...viewer, role: 'writer' }] }),
    new Response('provider-private-diagnostics', { status: 403 }));
  await expect(reconcileRequestDriveReaders(token, id, fileId, viewer.emailAddress)).rejects.toThrow(/^DRIVE_[A-Z0-9_]+$/);
  expect(http).toHaveBeenCalledTimes(3);
});

test('trash revokes access before moving the marked file and is safe to retry', async () => {
  const http = responses(json(metadata), json({ permissions: [owner, viewer] }), success(),
    json({ permissions: [owner] }), json({ ...metadata, trashed: true }), json({ ...metadata, trashed: true }), json({ permissions: [owner] }));
  await trashRequestDriveFile(token, id, fileId);
  await trashRequestDriveFile(token, id, fileId);
  expect(http.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET', 'DELETE', 'GET', 'PATCH', 'GET', 'GET']);
  expect(JSON.parse(String(http.mock.calls[4][1]?.body))).toEqual({ trashed: true });
});

test('foreign and unidentifiable files cannot be trashed', async () => {
  const http = responses(json({ ...metadata, appProperties: { ...metadata.appProperties, gitTutorRequestFile: 'other' } }), missing());
  await expect(trashRequestDriveFile(token, id, fileId)).rejects.toThrow();
  await expect(trashRequestDriveFile(token, id, fileId)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(2);
});

test('a reserved ID removed before its upload has no remote object to trash', async () => {
  const http = responses(missing());
  await trashRequestDriveFile(token, id, fileId, true);
  expect(http).toHaveBeenCalledOnce();
});
