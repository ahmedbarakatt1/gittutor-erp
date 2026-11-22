import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from 'pg';
import { afterEach, expect, test, vi } from 'vitest';
import { importOperationalWorkflow, writeOperationalHandoff, type OperationalPreviewManifest } from '../../tools/import-operational-workflow';

vi.mock('server-only', () => ({}));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn(original.readFile) };
});
afterEach(() => vi.restoreAllMocks());

test('canonical-only accepts a workbook without the practice row before trying its guarded database', async () => {
  const table = { columns: [], rows: [] };
  const source = { version: 1, source_name: 'synthetic.xlsx', source_sha256: 'f'.repeat(64), as_of: null, courses: [],
    tables: Object.fromEntries(['sessions', 'packages', 'students', 'tutors', 'balances', 'marketing', 'distributions'].map(key => [key, table])) };
  const config = { marker: 'git-tutor-operational-preview-v1', url: 'http://127.0.0.1:54331',
    database_url: 'postgres://127.0.0.1:54332/postgres', worker_database_url: 'postgres://127.0.0.1:54332/postgres' };
  const reads = vi.mocked(readFile);
  const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => { throw new Error('SYNTHETIC_DATABASE_BOUNDARY'); });
  for (const withPractice of [true, false]) {
    reads.mockResolvedValueOnce(JSON.stringify(config)).mockResolvedValueOnce(JSON.stringify(source));
    await expect(importOperationalWorkflow(withPractice)).rejects.toThrow(withPractice ? 'PRACTICE_SOURCE_REQUIRES_EXACT_PROFILES' : 'SYNTHETIC_DATABASE_BOUNDARY');
  }
  expect(connect).toHaveBeenCalledOnce();
});

test('the handoff uses imported profile rows and honors practice selections from older manifests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-tutor-import-handoff-'));
  const account = (label: string) => ({ id: label, displayName: label, email: label + '@example.test', password: 'synthetic' });
  const manifest: OperationalPreviewManifest = {
    marker: 'git-tutor-operational-preview-v1', sourceHash: 'a'.repeat(64), contentHash: 'b'.repeat(64),
    createdAt: '2026-11-22T09:00:00Z', effectiveAt: '2026-11-22T08:59:00Z', state: 'canonical_ready',
    actors: { owner: account('owner'), service: account('service') }, steps: {}, subjectIds: [],
    historicalRecordsAreUnverified: true, guardianConsentImported: false,
  };
  await writeOperationalHandoff(manifest, dir);
  expect(await readFile(join(dir, 'START-HERE.md'), 'utf8')).toContain('owner@example.test');
  manifest.actors['student:8'] = { ...account('learner'), learnerId: 'learner-id' };
  manifest.actors['student:12'] = { ...account('practice-learner'), learnerId: 'practice-learner-id' };
  manifest.actors['tutor:10'] = { ...account('instructor'), tutorId: 'tutor-id' };
  await writeOperationalHandoff(manifest, dir);
  const canonicalHandoff = await readFile(join(dir, 'START-HERE.md'), 'utf8');
  expect(canonicalHandoff).toContain('learner@example.test');
  expect(canonicalHandoff).toContain('instructor@example.test');
  expect(canonicalHandoff).not.toContain('practice-learner@example.test');
  expect(canonicalHandoff).not.toContain('Practice commercial policies are approved');
  manifest.practiceSourceRow = 79;
  manifest.learnerId = 'practice-learner-id';
  manifest.tutorId = 'tutor-id';
  await writeOperationalHandoff(manifest, dir);
  const practiceHandoff = await readFile(join(dir, 'START-HERE.md'), 'utf8');
  expect(practiceHandoff).toContain('practice-learner@example.test');
  expect(practiceHandoff).not.toContain('| student:8 |');
});
