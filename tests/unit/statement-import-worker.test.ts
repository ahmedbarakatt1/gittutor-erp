import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import { statementImportHandler } from '../../src/worker/statement-import';
import type { Job } from '../../src/worker/claims';

function fixture() {
  const id = randomUUID(), bytes = Buffer.from('external_id,amount_minor,currency,observed_at\nSYNTHETIC,55000,EGP,2026-11-11T10:00:00Z');
  const prepared = { import_id: id, version: 2, state: 'processing', file: { file_id: randomUUID(), object_key: 'synthetic/private-statement', object_version: 'v1', checksum_sha256: createHash('sha256').update(bytes).digest('hex'), detected_mime: 'text/csv', byte_size: bytes.length, source_provenance: 'synthetic_statement_worker_bytes' }, receiving_account_id: randomUUID(), channel: 'instapay', statement_period: { from: '2026-11-11', to: '2026-11-11' }, completed_result: null as unknown };
  const query = vi.fn(async (sql: string, values: unknown[]) => ({ rowCount: 1, rows: [{ result: sql.includes('prepare_statement_import') ? prepared : { state: values[3], candidate_count: (JSON.parse(String(values[4])) as unknown[]).length, duplicate_count: 0 } }] }));
  const database = { query } as unknown as Pick<Pool, 'query'>;
  const job: Job = { id: randomUUID(), event_id: randomUUID(), purpose: 'payments.validate_statement', event_type: 'statement_import_requested', aggregate_id: id, payload: { import_id: id }, lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 60000), attempt_count: 1, correlation_id: randomUUID() };
  return { bytes, prepared, query, database, job };
}

test('statement worker binds job identity and does not invent bytes for a metadata fixture', async () => {
  const f = fixture(), handler = statementImportHandler(f.database);
  await expect(handler.execute({ ...f.job, aggregate_id: randomUUID() })).rejects.toThrow('STATEMENT_JOB_INVALID');
  expect(f.query).not.toHaveBeenCalled();
  expect(await handler.execute(f.job)).toBe(`statement-import:${f.job.id}`);
  expect(f.query.mock.calls[1][1]).toEqual([f.job.aggregate_id, 2, f.prepared.file.checksum_sha256, 'awaiting_file_bytes', '[]', 'FILE_BYTES_UNAVAILABLE', `statement-import:${f.job.id}`]);
});

test('statement worker passes only parsed pending candidates and exact immutable metadata to the private finalizer', async () => {
  const f = fixture(), reader = vi.fn(async () => f.bytes), handler = statementImportHandler(f.database, reader);
  await handler.execute(f.job);
  expect(reader).toHaveBeenCalledWith(f.prepared.file);
  const final = f.query.mock.calls[1][1];
  expect(final.slice(0, 4)).toEqual([f.job.aggregate_id, 2, f.prepared.file.checksum_sha256, 'completed']);
  expect(JSON.parse(String(final[4]))).toEqual([{ external_id: 'SYNTHETIC', amount_minor: 55000, currency: 'EGP', observed_at: '2026-11-11T10:00:00.000Z' }]);
});

test('a completed import reconciles lost acknowledgement without reading or importing a file again', async () => {
  const f = fixture(); f.prepared.completed_result = { state: 'completed', candidate_count: 1, duplicate_count: 0 };
  const reader = vi.fn(async () => f.bytes), handler = statementImportHandler(f.database, reader);
  expect(await handler.reconcile({ ...f.job, attempt_count: 2 })).toEqual({ outcome: 'completed', reference: `statement-import:${f.job.id}` });
  expect(reader).not.toHaveBeenCalled(); expect(f.query).toHaveBeenCalledTimes(1);
});

test('read failure and changed bytes create safe owned results instead of partial import or raw errors', async () => {
  const f = fixture(), handler = statementImportHandler(f.database, async () => { throw new Error('PRIVATE_OBJECT_SECRET'); });
  await handler.execute(f.job);
  expect(f.query.mock.calls[1][1].slice(3, 6)).toEqual(['failed', '[]', 'FILE_READ_FAILED']);
  expect(JSON.stringify(f.query.mock.calls)).not.toContain('PRIVATE_OBJECT_SECRET');
  const second = fixture(); await statementImportHandler(second.database, async () => Buffer.alloc(second.bytes.length)).execute(second.job);
  expect(second.query.mock.calls[1][1].slice(3, 6)).toEqual(['requires_manual_review', '[]', 'CHECKSUM_MISMATCH']);
  const third = fixture(); await statementImportHandler(third.database, async () => Buffer.from('wrong size')).execute(third.job);
  expect(third.query.mock.calls[1][1].slice(3, 6)).toEqual(['requires_manual_review', '[]', 'FILE_SIZE_MISMATCH']);
});
