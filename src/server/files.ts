import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Pool } from 'pg';
import { FileRpcError, fileRpc, fileFilenameSchema, publicFilePurposeSchema, type FileRpcClient } from '../modules/files/commands';
import { validateFileBytes, fileLimits } from '../modules/files/validation';
import { createDatabasePool, databaseUrl } from './database';
import { parseServerConfig, type ServerConfig } from './config';

const bucket = 'git-tutor-private', id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), size = z.number().int().positive().max(fileLimits.materialBytes);
const object = z.object({ file_id: id, object_key: z.string().min(1).max(1000).refine(value => !value.startsWith('/') && !value.split('/').includes('..')), object_version: z.string().min(1).max(200), filename: fileFilenameSchema, size_bytes: size, checksum_sha256: hash });
const upload = object.extend({ attempt_id: id, lease_token: id, purpose: publicFilePurposeSchema, declared_type: z.string().max(200), already_uploaded: z.boolean(), version: z.number().int().positive() }).strict();
const download = object.extend({ detected_type: z.string().min(1).max(200) }).strict();
const uploaded = z.object({ file_id: id, upload_state: z.literal('uploaded'), size_bytes: size, checksum_sha256: hash, version: z.number().int().positive() }).strict();
export type UploadedFile = z.infer<typeof uploaded>;
export type PrivateObject = { object_key: string; size_bytes: number; checksum_sha256: string };
const safeCodes = new Set(['AUTH_REQUIRED', 'SESSION_REVOKED', 'FORBIDDEN', 'NOT_FOUND', 'CONSENT_REQUIRED', 'SCAN_REQUIRED', 'UPLOAD_REQUIRED', 'LEASE_LOST', 'VERSION_CONFLICT', 'STATE_CONFLICT']);

/** Only trusted descriptors from the private database boundary may reach this store. */
export function createPrivateObjectStore(config: ServerConfig) {
  if (!config.supabase_url || !config.supabase_secret_key) throw new FileRpcError('DEPENDENCY_UNAVAILABLE');
  const client = createClient(config.supabase_url, config.supabase_secret_key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let ready: Promise<void> | undefined;
  async function ensureBucket() {
    ready ??= (async () => {
      let result = await client.storage.getBucket(bucket);
      if (!result.data) { await client.storage.createBucket(bucket, { public: false, fileSizeLimit: fileLimits.materialBytes }); result = await client.storage.getBucket(bucket); }
      if (result.error || !result.data || result.data.public) throw new FileRpcError('DEPENDENCY_UNAVAILABLE');
    })().catch(error => { ready = undefined; throw error; });
    await ready;
  }
  async function read(descriptor: PrivateObject, missingAllowed = false): Promise<Uint8Array | null> {
    const result = await client.storage.from(bucket).download(descriptor.object_key);
    if (result.error || !result.data) { if (missingAllowed && String(result.error?.statusCode) === '404') return null; throw new FileRpcError('DEPENDENCY_UNAVAILABLE'); }
    if (result.data.size !== descriptor.size_bytes || result.data.size > fileLimits.materialBytes) throw new FileRpcError('FILE_SIZE_MISMATCH');
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== descriptor.checksum_sha256) throw new FileRpcError('FILE_CHECKSUM_MISMATCH');
    return bytes;
  }
  return {
    read,
    async put(descriptor: PrivateObject & { detected_type: string }, bytes: Uint8Array) {
      await ensureBucket();
      // Lost acknowledgements and concurrent retry adoption reuse the exact immutable object.
      if (await read(descriptor, true)) return;
      const result = await client.storage.from(bucket).upload(descriptor.object_key, bytes, { upsert: false, contentType: descriptor.detected_type, cacheControl: '0' });
      if (result.error) { if (await read(descriptor, true)) return; throw new FileRpcError('DEPENDENCY_UNAVAILABLE'); }
      await read(descriptor);
    },
  };
}

export function createFileContentService(database: Pick<Pool, 'query'>, config: ServerConfig) {
  const storage = createPrivateObjectStore(config);
  async function query(sql: string, values: unknown[]) {
    try { const result = await database.query(sql, values); if (result.rowCount !== 1) throw new Error(); return result.rows[0].data as unknown; }
    catch (error) { throw new FileRpcError(error instanceof Error && safeCodes.has(error.message) ? error.message : 'DEPENDENCY_UNAVAILABLE'); }
  }
  async function authorize(client: FileRpcClient, fileId: string, operation: 'upload' | 'download') {
    if (!id.safeParse(fileId).success) throw new FileRpcError('VALIDATION_ERROR');
    return z.object({ authorization_id: id }).strict().parse((await fileRpc(client, 'authorize_file_content', { p_file_id: fileId, p_operation: operation })).data).authorization_id;
  }
  return {
    async upload(client: FileRpcClient, fileId: string, bytes: Uint8Array): Promise<UploadedFile> {
      const ticket = await authorize(client, fileId, 'upload');
      const prepared = upload.parse(await query('select app_private.prepare_file_content($1,$2) data', [fileId, ticket]));
      if (prepared.file_id !== fileId) throw new FileRpcError('DEPENDENCY_UNAVAILABLE');
      const observed = validateFileBytes(prepared, bytes);
      await storage.put({ ...prepared, detected_type: observed.detected_type }, bytes);
      const result = uploaded.parse(await query('select app_private.record_file_object($1,$2,$3,$4::jsonb) data', [fileId, prepared.attempt_id, prepared.lease_token, JSON.stringify(observed)]));
      if (result.file_id !== fileId || result.checksum_sha256 !== observed.checksum_sha256 || result.size_bytes !== observed.size_bytes) throw new FileRpcError('DEPENDENCY_UNAVAILABLE');
      return result;
    },
    async download(client: FileRpcClient, fileId: string) {
      const ticket = await authorize(client, fileId, 'download');
      const prepared = download.parse(await query('select app_private.prepare_file_download($1,$2) data', [fileId, ticket]));
      if (prepared.file_id !== fileId) throw new FileRpcError('DEPENDENCY_UNAVAILABLE');
      const bytes = await storage.read(prepared); if (!bytes) throw new FileRpcError('NOT_FOUND');
      // The network read is not a grant: recheck current authority immediately before returning bytes.
      const current = download.parse(await query('select app_private.prepare_file_download($1,$2) data', [fileId, ticket]));
      if (current.object_key !== prepared.object_key || current.object_version !== prepared.object_version) throw new FileRpcError('VERSION_CONFLICT');
      return { bytes, filename: current.filename, detected_type: current.detected_type };
    },
  };
}
let service: ReturnType<typeof createFileContentService> | undefined;
function currentService() { return service ??= createFileContentService(createDatabasePool(databaseUrl('worker')), parseServerConfig(process.env)); }
export const uploadFileContent = (client: FileRpcClient, fileId: string, bytes: Uint8Array) => currentService().upload(client, fileId, bytes);
export const downloadFileContent = (client: FileRpcClient, fileId: string) => currentService().download(client, fileId);
