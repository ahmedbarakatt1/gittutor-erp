import 'server-only';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { parseServerConfig } from './config';
import { createPrivateObjectStore } from './files';
import { getRequestDriveToken, requestDriveDatabase } from './request-drive-auth';
import { generateRequestDriveId, putRequestDriveFile, reconcileRequestDriveReaders, trashRequestDriveFile } from './request-drive-provider';

const remoteId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const material = z.object({
  file_id: z.uuid(), drive_file_id: remoteId.nullable(), want_copy: z.boolean(),
  copy_uploaded: z.boolean(), revision: z.number().int().positive(), tutor_email: z.email().nullable(),
  object_key: z.string().nullable(), checksum_sha256: z.string().nullable(), size_bytes: z.number().int().nullable(),
  detected_type: z.string().nullable(), filename: z.string().nullable(),
});
type Target = { fileId?: string; requestId?: string };
async function projection(client: PoolClient, file: string) {
  const result = await client.query('select app_private.drive_material_projection($1) as item', [file]);
  return material.nullable().parse(result.rows[0]?.item);
}

async function syncFile(file: string, token: string) {
  const client = await requestDriveDatabase().connect();
  let revision: number | undefined;
  try {
    const initial = await projection(client, file);
    if (!initial) return;
    revision = initial.revision;
    if (initial.want_copy && !initial.drive_file_id) {
      // Commit the stable Drive ID before Google sees any bytes. An ambiguous upload can
      // then be retried against the same object even if a function invocation is interrupted.
      const generated = await generateRequestDriveId(token);
      await client.query('select app_private.drive_material_reserve_id($1,$2)', [file, generated]);
    }
    await client.query('begin isolation level read committed');
    const lock = await client.query("select pg_try_advisory_xact_lock(hashtextextended('request-drive:' || $1::text, 0)) as acquired", [file]);
    if (!lock.rows[0].acquired) { await client.query('rollback'); return; }
    let item = await projection(client, file);
    if (!item) { await client.query('commit'); return; }
    revision = item.revision;
    let uploaded: string | undefined;
    if (item.want_copy && !item.copy_uploaded) {
      if (!item.drive_file_id || !item.checksum_sha256 || !item.filename || !item.detected_type || !item.object_key || !item.size_bytes) throw Error('DRIVE_SOURCE_UNAVAILABLE');
      const storage = createPrivateObjectStore(parseServerConfig(process.env));
      const bytes = await storage.read({ object_key: item.object_key, size_bytes: item.size_bytes, checksum_sha256: item.checksum_sha256 });
      if (!bytes) throw Error('DRIVE_SOURCE_UNAVAILABLE');
      await putRequestDriveFile(token, item.drive_file_id, {fileId: file, name: item.filename, mimeType: item.detected_type, bytes: Buffer.from(bytes), checksum: item.checksum_sha256});
      uploaded = item.drive_file_id;
    }
    // Re-read entitlement after the upload and again when acknowledging permissions.
    // A simultaneous reassignment must leave the row due for reconciliation.
    item = await projection(client, file);
    if (!item) throw Error('DRIVE_SOURCE_UNAVAILABLE');
    revision = item.revision;
    if (item.drive_file_id) {
      if (item.want_copy) await reconcileRequestDriveReaders(token, item.drive_file_id, file, item.tutor_email);
      else await trashRequestDriveFile(token, item.drive_file_id, file, !item.copy_uploaded && !uploaded);
    }
    // Updating this row earlier would block assignment-change triggers while Google
    // processes the upload or ACL. Take the database write lock only at acknowledgement.
    if (uploaded) await client.query('select app_private.drive_material_mark_uploaded($1,$2)', [file, uploaded]);
    const ack = await client.query('select app_private.drive_material_finish($1,$2,true,$3) as ok', [file, revision, item.want_copy ? item.tutor_email : null]);
    if (!ack.rows[0]?.ok && item.drive_file_id && item.want_copy && item.tutor_email) {
      // Withdraw the grant from this attempt immediately if the assignment changed during the Google call.
      await reconcileRequestDriveReaders(token, item.drive_file_id, file, null);
    }
    await client.query('commit');
  } catch {
    await client.query('rollback');
    if (revision !== undefined) await client.query('select app_private.drive_material_finish($1,$2,false,null)', [file, revision]);
    throw Error('DRIVE_SYNC_PENDING');
  } finally { client.release(); }
}

export async function syncRequestDrive(target: Target = {}, limit = 3) {
  if (process.env.REQUEST_DRIVE_ADAPTER !== 'google') return { attempted: 0, failed: 0 };
  const result = await requestDriveDatabase().query('select file_id from app_private.drive_material_work($1,$2,$3)', [target.requestId ?? null, target.fileId ?? null, limit]);
  const rows = z.array(z.object({file_id: z.uuid()})).parse(result.rows);
  if (!rows.length) return { attempted: 0, failed: 0 };
  const token = await getRequestDriveToken();
  const start = Date.now();
  let attempted = 0, failed = 0;
  for (const row of rows) {
    if (Date.now() - start > 180_000) break;
    attempted++;
    try { await syncFile(row.file_id, token); } catch { failed++; }
  }
  if (failed) console.warn('Git Tutor Drive material sync pending', { attempted, failed });
  return { attempted, failed };
}
