import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { ScanAdapter, ScanScenario } from '../server/providers/file-scan';
import type { Job } from './claims';
import type { JobHandler } from './execute';

const id = z.uuid(), version = z.number().int().positive();
const completed = z.object({ file_id: id, scan_state: z.enum(['pending', 'clean', 'quarantined']), version }).strict();
const prepared = z.object({ file_id: id, scan_generation: version, object_key: z.string().min(1).max(1000), object_version: z.string().min(1).max(200), checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/), detected_type: z.string().max(200), size_bytes: z.number().int().positive().max(25 * 1024 * 1024), scenario: z.enum(['clean','infected','error','unknown','timeout_after_result']), completed_result: completed.nullable() }).strict();
const observation = z.object({ outcome: z.enum(['clean','infected','error','unknown']), adapter_mode: z.enum(['fake','clamav']), engine_version: z.string().min(1).max(200), signature_version: z.string().min(1).max(200), reference: z.string().min(1).max(200), safe_error_code: z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable() }).strict();
export type ScanFile = z.infer<typeof prepared>;
export function fileScanHandler(database: Pick<Pool,'query'>, read: (file: ScanFile) => Promise<Uint8Array|null>, factory: (scenario: ScanScenario) => ScanAdapter): JobHandler {
  async function process(job: Job) {
    if (job.purpose !== 'files.scan' || job.event_type !== 'file_scan_requested' || !z.object({file_id:id}).strict().safeParse(job.payload).success || job.payload.file_id !== job.aggregate_id) throw new Error('FILE_SCAN_JOB_INVALID');
    const file = prepared.parse((await database.query('select app_private.prepare_file_scan($1,$2,$3) result',[job.aggregate_id,job.id,job.lease_token])).rows[0]?.result);
    if (file.file_id !== job.aggregate_id) throw new Error('FILE_SCAN_JOB_INVALID');
    const reference = `scan:${file.file_id}:${file.scan_generation}`;
    if (file.completed_result) return reference;
    const bytes = await read(file);
    if (!bytes || bytes.length !== file.size_bytes) throw new Error('FILE_SIZE_MISMATCH');
    if (createHash('sha256').update(bytes).digest('hex') !== file.checksum_sha256) throw new Error('FILE_CHECKSUM_MISMATCH');
    const result = observation.parse(await factory(file.scenario).scan({ ...file, bytes }));
    const final = completed.parse((await database.query('select app_private.finalize_file_scan($1,$2,$3,$4,$5::jsonb) result',[file.file_id,file.scan_generation,job.id,job.lease_token,JSON.stringify(result)])).rows[0]?.result);
    if (final.file_id !== file.file_id) throw new Error('FILE_SCAN_RESULT_INVALID');
    // Exercise a real persisted result followed by lost worker acknowledgement.
    if (result.adapter_mode === 'fake' && file.scenario === 'timeout_after_result') throw new Error('SCANNER_OUTCOME_UNKNOWN');
    return reference;
  }
  return { execute: process, reconcile: async job => ({ outcome: 'completed', reference: await process(job) }) };
}
