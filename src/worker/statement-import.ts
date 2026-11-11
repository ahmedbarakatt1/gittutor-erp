import type { Pool } from 'pg';
import { z } from 'zod';
import { parseManualStatement, statementLimits } from '../server/providers/manual-statement';
import type { Job } from './claims';
import type { JobHandler } from './execute';

const id = z.uuid(), count = z.number().int().nonnegative().max(statementLimits.maxRows);
const terminal = z.enum(['completed', 'requires_manual_review', 'awaiting_file_bytes', 'failed', 'unknown']);
const resultSchema = z.object({ state: terminal, candidate_count: count, duplicate_count: count }).strict().refine(row => row.candidate_count + row.duplicate_count <= statementLimits.maxRows);
const fileSchema = z.object({ file_id: id, object_key: z.string().min(1).max(1000), object_version: z.string().min(1).max(200), checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/), detected_mime: z.string().min(1).max(200), byte_size: z.number().int().positive().max(statementLimits.maxBytes), source_provenance: z.string().min(1).max(200) }).strict();
const preparedSchema = z.object({ import_id: id, version: z.number().int().positive().max(2147483647), state: z.enum(['pending', 'processing', ...terminal.options]), file: fileSchema, receiving_account_id: id, channel: z.enum(['instapay', 'vodafone_cash']), statement_period: z.object({ from: z.iso.date(), to: z.iso.date() }).strict(), completed_result: resultSchema.nullable() }).strict();
export type StatementFileReader = (file: z.infer<typeof fileSchema>) => Promise<Uint8Array | null>;

/** T06 metadata has no uploaded bytes. T07 supplies the private immutable Storage reader through this port. */
export function statementImportHandler(database: Pick<Pool, 'query'>, readFile: StatementFileReader = async () => null): JobHandler {
  async function process(job: Job) {
    const payload = z.object({ import_id: id }).strict().safeParse(job.payload);
    if (job.purpose !== 'payments.validate_statement' || job.event_type !== 'statement_import_requested' || !id.safeParse(job.id).success || !payload.success || payload.data.import_id !== job.aggregate_id) throw new Error('STATEMENT_JOB_INVALID');
    const key = `statement-import:${job.id}`;
    const response = await database.query('select app_private.prepare_statement_import($1,$2) as result', [payload.data.import_id, key]);
    const parsed = preparedSchema.safeParse(response.rows[0]?.result);
    if (response.rowCount !== 1 || !parsed.success || parsed.data.import_id !== job.aggregate_id) throw new Error('STATEMENT_JOB_RESULT_INVALID');
    const prepared = parsed.data;
    if (prepared.completed_result) return key;
    let bytes: Uint8Array | null = null, readFailed = false;
    try { bytes = await readFile(prepared.file); }
    catch { readFailed = true; }
    const result = readFailed ? { state: 'failed', candidates: [], reason_code: 'FILE_READ_FAILED' }
      : bytes && bytes.byteLength !== prepared.file.byte_size ? { state: 'requires_manual_review', candidates: [], reason_code: 'FILE_SIZE_MISMATCH' }
        : parseManualStatement({ bytes, detected_mime: prepared.file.detected_mime, checksum_sha256: prepared.file.checksum_sha256, statement_period: prepared.statement_period });
    const final = await database.query('select app_private.finalize_statement_import($1,$2,$3,$4,$5::jsonb,$6,$7) as result', [prepared.import_id, prepared.version, prepared.file.checksum_sha256, result.state, JSON.stringify(result.candidates), result.reason_code, key]);
    if (final.rowCount !== 1 || !resultSchema.safeParse(final.rows[0]?.result).success) throw new Error('STATEMENT_JOB_RESULT_INVALID');
    return key;
  }
  return { execute: process, reconcile: async job => ({ outcome: 'completed', reference: await process(job) }) };
}
