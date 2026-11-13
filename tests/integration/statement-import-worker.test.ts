import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { paymentFixture } from '../helpers/payments';
import { loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { statementImportHandler } from '../../src/worker/statement-import';
import { getStatementImport, listStatementImports } from '../../src/modules/payments/queries';
import { createFileContentService, createPrivateObjectStore } from '../../src/server/files';
import { parseServerConfig } from '../../src/server/config';
import { invokeFileCommandWithStatus } from '../../src/modules/files/commands';
import { runFileScan } from '../helpers/files';
import type { StatementFileReader } from '../../src/worker/statement-import';

let f: Awaited<ReturnType<typeof paymentFixture>>, worker: Pool;
let content: ReturnType<typeof createFileContentService>, readStoredStatement: StatementFileReader;
beforeAll(async () => {
  f = await paymentFixture(); const configuration = loadLocalSupabase();
  if (!configuration.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  worker = new Pool({ connectionString: configuration.worker_database_url });
  const config = parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: configuration.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: configuration.publishable_key, SUPABASE_SECRET_KEY: configuration.secret_key });
  content = createFileContentService(worker, config);
  const store = createPrivateObjectStore(config);
  readStoredStatement = file => store.read({ object_key: file.object_key, checksum_sha256: file.checksum_sha256, size_bytes: file.byte_size });
}, 60_000);
afterAll(async () => { await worker?.end(); await f?.close(); });

async function source(accountId: string, bytes: Buffer) {
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const created = await invokeFileCommandWithStatus(f.reviewer, 'create_file_upload', { p_purpose: 'statement_evidence', p_evidence_action: 'create_statement_import', p_parent_id: accountId, p_filename: 'synthetic-statement.csv', p_declared_type: 'text/csv', p_size_bytes: bytes.length, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
  const fileId = created.data.file_id;
  await content.upload(f.reviewer, fileId, bytes);
  const finalized = await invokeFileCommandWithStatus(f.reviewer, 'finalize_file_upload', { p_file_id: fileId, p_checksum_sha256: checksum, p_idempotency_key: randomUUID() });
  expect(await runFileScan(finalized.data.scan_job_id)).toBe('completed');
  expect(Buffer.from((await content.download(f.reviewer, fileId)).bytes)).toEqual(bytes);
  return fileId;
}
async function createImport(accountId: string, fileId: string) {
  return f.rpc('create_statement_import', { p_file_id: fileId, p_receiving_account_id: accountId, p_channel: 'instapay', p_statement_period: { from: '2026-11-11', to: '2026-11-11' }, p_idempotency_key: randomUUID() }, f.reviewer);
}
async function claimOnly(jobId: string) {
  await f.database.query('begin');
  try {
    await f.database.query("select id from app_private.outbox_jobs where purpose='payments.validate_statement' and id<>$1 for update", [jobId]);
    const jobs = await claimJobs(worker, 'payments.validate_statement', 1, 60);
    expect(jobs.map(row => row.id)).toEqual([jobId]); return jobs[0];
  } finally { await f.database.query('rollback'); }
}

test('real import metadata remains awaiting bytes and completed worker replay cannot invent transfers', async () => {
  const account = await f.receiving(), bytes = Buffer.from('external_id,amount_minor,currency,observed_at\nSYNTHETIC-METADATA,55000,EGP,2026-11-11T10:00:00Z');
  const file = await source(account.id, bytes), imported = await createImport(account.id, file), first = await claimOnly(String(imported.validation_job_id));
  const handler = statementImportHandler(worker); // Deliberately unavailable reader despite a valid uploaded and scanned object.
  await handler.execute(first); // Simulate lost job acknowledgement after the domain commit.
  let record = await f.rpc('get_statement_import', { p_import_id: imported.import_id, p_limit: 25, p_candidate_cursor: null }, f.reviewer);
  expect(record).toMatchObject({ state: 'awaiting_file_bytes', accepted_count: 0, failure_code: 'FILE_BYTES_UNAVAILABLE' });
  expect(await getStatementImport(f.reviewer, String(imported.import_id))).toMatchObject({ state: 'awaiting_file_bytes', candidate_page: { items: [] } });
  expect((await listStatementImports(f.reviewer, { limit: 100 })).items.some(row => row.import_id === imported.import_id)).toBe(true);
  await expect(getStatementImport(f.learner, String(imported.import_id))).rejects.toThrow('FORBIDDEN');
  expect((await f.database.query('select id from finance_private.incoming_transfers where statement_evidence_file_id=$1', [file])).rowCount).toBe(0);
  await f.database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  const reclaimed = await claimOnly(first.id);
  expect(reclaimed.attempt_count).toBe(2); expect(await executeLeasedJob(worker, reclaimed, handler)).toBe('completed');
  record = await f.rpc('get_statement_import', { p_import_id: imported.import_id, p_limit: 25, p_candidate_cursor: null }, f.reviewer);
  expect(record).toMatchObject({ state: 'awaiting_file_bytes', accepted_count: 0 });
});

test('actual restricted worker imports pending candidates once and replays without cash or payer assertions', async () => {
  const account = await f.receiving(), reference = `SYNTHETIC-${randomUUID()}`;
  const bytes = Buffer.from(`external_id,amount_minor,currency,observed_at\n${reference},55000,EGP,2026-11-11T10:00:00Z`);
  const file = await source(account.id, bytes), imported = await createImport(account.id, file), job = await claimOnly(String(imported.validation_job_id));
  let readCount = 0;
  const handler = statementImportHandler(worker, async metadata => { expect(metadata.file_id).toBe(file); readCount++; return readStoredStatement(metadata); });
  await handler.execute(job);
  expect(await handler.reconcile({ ...job, attempt_count: 2 })).toEqual({ outcome: 'completed', reference: `statement-import:${job.id}` });
  expect(readCount).toBe(1);
  const transfers = (await f.database.query('select id,state,amount_minor,current_payer_binding_id from finance_private.incoming_transfers where receiving_account_id=$1 and external_id=$2', [account.id, reference])).rows;
  expect(transfers).toHaveLength(1); expect(transfers[0]).toMatchObject({ state: 'pending', amount_minor: '55000', current_payer_binding_id: null });
  expect((await f.database.query('select id from finance_private.ledger_lines where transfer_id=$1', [transfers[0].id])).rowCount).toBe(0);
  expect((await f.database.query('select id from finance_private.customer_credit_lots where transfer_id=$1', [transfers[0].id])).rowCount).toBe(0);
  await expect(worker.query('select * from app_private.files where id=$1', [file])).rejects.toThrow(/permission denied/);
});

test('independent statement workers deduplicate the same source and reject a conflicting whole import', async () => {
  const secondWorker = new Pool({ connectionString: loadLocalSupabase().worker_database_url, max: 1 });
  try {
    const account = await f.receiving(), reference = `SYNTHETIC-CONCURRENT-${randomUUID()}`;
    const firstBytes = Buffer.from(`external_id,amount_minor,currency,observed_at\n${reference},55000,EGP,2026-11-11T10:00:00Z`);
    const secondBytes = Buffer.from(`amount_minor,currency,external_id,observed_at\r\n55000,EGP,${reference},2026-11-11T12:00:00+02:00\r\n`);
    const firstFile = await source(account.id, firstBytes), secondFile = await source(account.id, secondBytes);
    const firstImport = await createImport(account.id, firstFile), secondImport = await createImport(account.id, secondFile);
    const firstJob = await claimOnly(String(firstImport.validation_job_id)), secondJob = await claimOnly(String(secondImport.validation_job_id));
    await Promise.all([
      statementImportHandler(worker, readStoredStatement).execute(firstJob),
      statementImportHandler(secondWorker, readStoredStatement).execute(secondJob),
    ]);
    const candidates = (await f.database.query('select transfer_id,was_duplicate from finance_private.statement_import_candidates where import_id=any($1::uuid[])', [[firstImport.import_id, secondImport.import_id]])).rows;
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map(row => row.transfer_id)).size).toBe(1);
    expect(candidates.map(row => row.was_duplicate).sort()).toEqual([false, true]);
    expect((await f.database.query('select state,amount_minor,current_payer_binding_id from finance_private.incoming_transfers where id=$1', [candidates[0].transfer_id])).rows[0]).toEqual({ state: 'pending', amount_minor: '55000', current_payer_binding_id: null });
    expect((await f.database.query('select id from finance_private.ledger_lines where transfer_id=$1', [candidates[0].transfer_id])).rowCount).toBe(0);

    const unrelatedReference = `SYNTHETIC-ROLLBACK-${randomUUID()}`;
    const conflictBytes = Buffer.from(`external_id,amount_minor,currency,observed_at\n${unrelatedReference},100,EGP,2026-11-11T10:00:00Z\n${reference},55001,EGP,2026-11-11T10:00:00Z`);
    const conflictFile = await source(account.id, conflictBytes), conflictImport = await createImport(account.id, conflictFile);
    await statementImportHandler(worker, readStoredStatement).execute(await claimOnly(String(conflictImport.validation_job_id)));
    expect(await f.rpc('get_statement_import', { p_import_id: conflictImport.import_id, p_limit: 25, p_candidate_cursor: null }, f.reviewer)).toMatchObject({ state: 'requires_manual_review', accepted_count: 0, rejected_count: 2, failure_code: 'DUPLICATE_EXTERNAL_ID' });
    expect((await f.database.query('select id from finance_private.incoming_transfers where receiving_account_id=$1 and external_id=$2', [account.id, unrelatedReference])).rowCount).toBe(0);
    expect((await f.database.query('select id from finance_private.statement_import_candidates where import_id=$1', [conflictImport.import_id])).rowCount).toBe(0);
  } finally { await secondWorker.end(); }
});
