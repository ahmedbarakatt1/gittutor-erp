import 'server-only';
import { z } from 'zod';
import { validateFileBytes } from '../modules/files/validation';

const origin = 'https://www.googleapis.com';
const files = origin + '/drive/v3/files';
const upload = origin + '/upload/drive/v3/files';
const driveId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const permissionId = z.string().regex(/^[!-~]{1,512}$/).refine(id => id !== '.' && id !== '..');
const fields = 'id,ownedByMe,owners(me,permissionId),driveId,trashed,writersCanShare,appProperties,size,sha256Checksum,mimeType';
const metadataSchema = z.object({
  id: driveId, ownedByMe: z.literal(true), driveId: z.undefined().optional(),
  owners: z.tuple([z.object({ me: z.literal(true), permissionId })]),
  trashed: z.boolean(), writersCanShare: z.boolean(),
  appProperties: z.object({ gitTutorRequestFile: z.string(), sha256: z.string(), sizeBytes: z.string() }),
  size: z.string().optional(), sha256Checksum: z.string().optional(), mimeType: z.string().optional(),
});
type DriveFile = z.infer<typeof metadataSchema>;
const permissionSchema = z.object({
  id: permissionId, type: z.enum(['user', 'group', 'anyone', 'domain']),
  role: z.enum(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader', 'publishedReader']),
  view: z.string().optional(),
  emailAddress: z.string().optional(), deleted: z.boolean().optional(), pendingOwner: z.boolean().optional(),
});
const permissionFields = 'id,type,role,emailAddress,deleted,pendingOwner,view';
const pageSchema = z.object({ permissions: z.array(permissionSchema), nextPageToken: z.string().min(1).optional() });
type Permission = z.infer<typeof permissionSchema>;
type Source = { fileId: string; name: string; mimeType: string; bytes: Buffer; checksum: string };

function fail(code: string): never {
  throw new Error(code);
}

function endpoint(id: string) {
  if (!driveId.safeParse(id).success) fail('DRIVE_FILE_ID_INVALID');
  return files + '/' + id;
}

async function request(token: string, url: string | URL, init: RequestInit = {}) {
  try {
    const headers = new Headers(init.headers);
    headers.set('authorization', 'Bearer ' + token);
    return await fetch(url, {
      ...init, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail('DRIVE_OUTCOME_UNKNOWN');
  }
}

function ensureSuccess(response: Response) {
  if (!response.ok) fail('DRIVE_HTTP_' + response.status);
}

async function readJSON(response: Response): Promise<unknown> {
  ensureSuccess(response);
  try { return await response.json(); } catch { fail('DRIVE_RESPONSE_INVALID'); }
}

async function ownedFile(response: Response, id: string, fileId: string) {
  const parsed = metadataSchema.safeParse(await readJSON(response));
  if (!parsed.success || parsed.data.id !== id || parsed.data.appProperties.gitTutorRequestFile !== fileId) {
    fail('DRIVE_FILE_IDENTITY_MISMATCH');
  }
  return parsed.data;
}

function verifiedContent(file: DriveFile) {
  return /^[a-f0-9]{64}$/.test(file.appProperties.sha256) && file.sha256Checksum === file.appProperties.sha256
    && /^[1-9]\d*$/.test(file.appProperties.sizeBytes) && file.size === file.appProperties.sizeBytes;
}

export async function generateRequestDriveId(token: string): Promise<string> {
  const response = await request(token, files + '/generateIds?count=1&space=drive&type=files');
  const parsed = z.object({ ids: z.tuple([driveId]) }).safeParse(await readJSON(response));
  if (!parsed.success) fail('DRIVE_RESPONSE_INVALID');
  return parsed.data.ids[0];
}

function sessionLocation(response: Response) {
  ensureSuccess(response);
  const location = URL.parse(response.headers.get('location') ?? '');
  if (!location || location.origin !== origin || location.pathname !== '/upload/drive/v3/files'
    || location.username || location.password || location.hash || !location.searchParams.get('upload_id')) {
    fail('DRIVE_UPLOAD_SESSION_INVALID');
  }
  return location;
}

export async function putRequestDriveFile(token: string, id: string, source: Source): Promise<void> {
  validateFileBytes({
    purpose: 'request_material', filename: source.name, declared_type: source.mimeType,
    size_bytes: source.bytes.length, checksum_sha256: source.checksum,
  }, source.bytes);
  const url = endpoint(id) + '?fields=' + fields;
  let response = await request(token, url);
  if (response.status === 404) {
    const size = String(source.bytes.length);
    response = await request(token, upload + '?uploadType=resumable&ignoreDefaultVisibility=true&fields=' + fields, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-upload-content-type': source.mimeType, 'x-upload-content-length': size },
      body: JSON.stringify({
        id, name: source.name, mimeType: source.mimeType, writersCanShare: false,
        appProperties: { gitTutorRequestFile: source.fileId, sha256: source.checksum, sizeBytes: size },
      }),
    });
    if (response.status !== 409) {
      response = await request(token, sessionLocation(response), {
        method: 'PUT', headers: { 'content-type': source.mimeType, 'content-length': size },
        body: new Uint8Array(source.bytes),
      });
    }
    // Only creation uses the pre-generated ID. Never PATCH media on a collision.
    if (response.status === 409) response = await request(token, url);
  }
  const file = await ownedFile(response, id, source.fileId);
  if (!verifiedContent(file) || file.sha256Checksum !== source.checksum || file.size !== String(source.bytes.length)
    || file.mimeType !== source.mimeType) fail('DRIVE_FILE_CONTENT_MISMATCH');
}

async function listPermissions(token: string, path: string, ownerId: string) {
  const url = new URL(path);
  url.searchParams.set('fields', 'nextPageToken,permissions(' + permissionFields + ')');
  url.searchParams.set('includePermissionsForView', 'published');
  const permissions: Permission[] = [];
  const pageTokens = new Set<string>();
  for (;;) {
    const parsed = pageSchema.safeParse(await readJSON(await request(token, url.toString())));
    if (!parsed.success) fail('DRIVE_PERMISSIONS_AMBIGUOUS');
    permissions.push(...parsed.data.permissions);
    const next = parsed.data.nextPageToken;
    if (next === undefined) break;
    if (pageTokens.has(next)) fail('DRIVE_PERMISSIONS_AMBIGUOUS');
    pageTokens.add(next);
    url.searchParams.set('pageToken', next);
  }
  const owners = permissions.filter(p => p.role === 'owner');
  if (owners.length !== 1 || owners[0].type !== 'user' || owners[0].id !== ownerId || owners[0].deleted
    || new Set(permissions.map(p => p.id)).size !== permissions.length) fail('DRIVE_PERMISSIONS_AMBIGUOUS');
  return permissions;
}

function isViewer(permission: Permission, email: string | null) {
  return email !== null && permission.type === 'user' && permission.role === 'reader'
    && !permission.view && !permission.deleted && !permission.pendingOwner && permission.emailAddress?.toLowerCase() === email;
}

async function cleanPermissions(token: string, file: DriveFile, email: string | null) {
  const path = endpoint(file.id) + '/permissions';
  const ownerId = file.owners[0].permissionId;
  let permissions = await listPermissions(token, path, ownerId);
  const keep = permissions.find(p => isViewer(p, email));
  const stale = permissions.filter(p => p.id !== ownerId && p.id !== keep?.id);
  if (stale.length) {
    // Drive requires sequential permission writes. Verify removals before any new grant.
    for (const permission of stale) {
      ensureSuccess(await request(token, path + '/' + encodeURIComponent(permission.id), { method: 'DELETE' }));
    }
    permissions = await listPermissions(token, path, ownerId);
    const readers = permissions.filter(p => p.id !== ownerId);
    if (readers.length > 1 || readers.some(p => !isViewer(p, email))) fail('DRIVE_PERMISSION_REVOKE_UNCONFIRMED');
  }
  return permissions;
}

async function updateFile(token: string, file: DriveFile, update: { trashed?: boolean; writersCanShare?: false }) {
  const response = await request(token, endpoint(file.id) + '?fields=' + fields, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update),
  });
  const changed = await ownedFile(response, file.id, file.appProperties.gitTutorRequestFile);
  if ((update.trashed !== undefined && changed.trashed !== update.trashed)
    || (update.writersCanShare === false && changed.writersCanShare)) fail('DRIVE_UPDATE_UNCONFIRMED');
  return changed;
}

/** Caller serializes operations per Drive ID and supplies the current verified tutor email, or null. */
export async function reconcileRequestDriveReaders(token: string, id: string, fileId: string, eligibleEmail: string | null): Promise<void> {
  const email = eligibleEmail?.toLowerCase() ?? null;
  if (email !== null && !z.email().safeParse(email).success) fail('DRIVE_RECIPIENT_INVALID');
  const path = endpoint(id);
  let file = await ownedFile(await request(token, path + '?fields=' + fields), id, fileId);
  if (!verifiedContent(file)) {
    await cleanPermissions(token, file, null);
    fail('DRIVE_FILE_CONTENT_MISMATCH');
  }
  let permissions = await cleanPermissions(token, file, file.trashed ? null : email);
  if (file.writersCanShare || file.trashed) {
    file = await updateFile(token, file, { trashed: false, writersCanShare: false });
    if (!verifiedContent(file)) fail('DRIVE_FILE_CONTENT_MISMATCH');
    permissions = await cleanPermissions(token, file, email);
  }
  if (!email || permissions.some(p => isViewer(p, email) || (p.role === 'owner' && p.emailAddress?.toLowerCase() === email))) return;

  const response = await request(token, path + '/permissions?sendNotificationEmail=false&fields=' + permissionFields, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
  });
  ensureSuccess(response);
  const final = await cleanPermissions(token, file, email);
  if (!final.some(p => isViewer(p, email))) fail('DRIVE_PERMISSION_GRANT_UNCONFIRMED');
}

export async function trashRequestDriveFile(token: string, id: string, fileId: string, reservedOnly = false): Promise<void> {
  const response = await request(token, endpoint(id) + '?fields=' + fields);
  if (reservedOnly && response.status === 404) return;
  const file = await ownedFile(response, id, fileId);
  await cleanPermissions(token, file, null);
  if (!file.trashed) await updateFile(token, file, { trashed: true });
}
