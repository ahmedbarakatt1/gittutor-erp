import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import ts from 'typescript';

const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const work = resolve(process.argv[2] ?? repo);
const git = (...args) => execFileSync('git', args, { cwd: repo });
const commit = git('rev-parse', 'HEAD').toString().trim();
const requested = process.argv[3];
if (requested && requested !== commit) throw Error('Checkout does not match the requested evidence revision');
const ids = ['GT-1317', 'GT-1403', 'GT-1405', 'GT-1510'];
const manifest = JSON.parse(readFileSync(join(repo, 'fixtures/acceptance-cases.json'), 'utf8'));
const cases = ids.map(id => manifest.cases.find(c => c.id === id));
const paths = cases.map(c => c.test_file);
const instruments = ['tools/evidence/financial.config.ts', 'tools/evidence/count-assertions.ts'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const config = JSON.parse(readFileSync(join(work, '.local/supabase.json'), 'utf8').replace(/^\uFEFF/, ''));
const api = new URL(config.url);
const db = new URL(config.database_url);
if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || db.hostname !== api.hostname || db.pathname !== '/postgres'
    || !['54321:54322', '56321:56322'].includes(api.port + ':' + db.port) || config.marker !== 'git-tutor-supabase-local-v1') {
  throw Error('A marked loopback test stack is required');
}

// Verify whole files from the referenced Git tree, including transitive local
// TypeScript imports and customer/fixture contracts read directly from disk.
const queue = [...paths, 'vitest.config.ts', 'pnpm-lock.yaml', 'fixtures/domain-scenarios.json'];
const sourceFiles = {};
while (queue.length) {
  const file = queue.pop();
  if (file in sourceFiles) continue;
  const original = git('show', commit + ':' + file);
  const actual = readFileSync(join(work, file));
  const canonical = bytes => bytes.toString('utf8').replace(/\r\n/g, '\n');
  const expected = canonical(original);
  const local = canonical(actual);
  const expectedLocal = file === 'tests/helpers/supabase.ts'
    ? expected.replace('http://127.0.0.1:54321', api.origin).replace("database.port !== '54322'", "database.port !== '" + db.port + "'")
    : expected;
  if (local !== expectedLocal) throw Error('Execution source differs from its Git reference: ' + file);
  sourceFiles[file] = { git_sha256: digest(original), executed_sha256: digest(actual) };
  if (!/\.tsx?$/.test(file)) continue;
  for (const { fileName } of ts.preProcessFile(expected, true, true).importedFiles) {
    if (!fileName.startsWith('.') && !fileName.startsWith('@/')) continue;
    const base = fileName.startsWith('@/') ? 'src/' + fileName.slice(2) : posix.join(posix.dirname(file), fileName);
    const dependency = ['', '.ts', '.tsx', '/index.ts', '.json'].map(ext => base + ext)
      .find(p => existsSync(join(repo, p)) && statSync(join(repo, p)).isFile());
    if (!dependency) throw Error('Unresolved source import: ' + fileName);
    queue.push(dependency);
  }
}
const instrumentation = {};
for (const file of instruments) {
  const bytes = readFileSync(join(work, file));
  if (!bytes.equals(readFileSync(join(repo, file)))) throw Error('Different evidence instrumentation: ' + file);
  instrumentation[file] = digest(bytes);
}
instrumentation['tools/evidence/record-financial.mjs'] = digest(readFileSync(fileURLToPath(import.meta.url)));

const conn = new pg.Client({ connectionString: config.database_url });
await conn.connect();
let migration;
try {
  const marker = await conn.query('select environment, fixture_marker from app_private.environment_metadata where singleton');
  if (marker.rowCount !== 1 || marker.rows[0].environment !== 'test' || marker.rows[0].fixture_marker !== config.marker) {
    throw Error('The connected database is not a disposable synthetic test database');
  }
  migration = (await conn.query('select max(version) as latest from supabase_migrations.schema_migrations')).rows[0].latest;
  if (!migration) throw Error('No applied database migration recorded');
} finally { await conn.end(); }

const runId = randomUUID();
const rawPath = '.local/financial-vitest-' + runId + '.json';
const args = ['node_modules/vitest/vitest.mjs', 'run', '--config', instruments[0], '--reporter=json', '--outputFile=' + rawPath, ...paths];
const started = new Date().toISOString();
const execution = spawnSync(process.execPath, args, { cwd: work, stdio: 'inherit' });
const finished = new Date().toISOString();
const exitCode = execution.status ?? 1;
const raw = existsSync(join(work, rawPath)) ? readFileSync(join(work, rawPath)) : null;
const report = raw ? JSON.parse(raw.toString('utf8')) : null;
const environment = 'Marked synthetic local Supabase (API ' + api.port + ', PostgreSQL ' + db.port + ')';
const context = { environment, provider_mode: 'fake', database_migration_version: migration };
const results = cases.map(c => {
  const file = report?.testResults.find(f => relative(work, f.name).replaceAll('\\', '/') === c.test_file);
  const assertions = file?.assertionResults ?? [];
  const tests = assertions.map(test => ({ title: test.title, status: test.status,
    assertion_count: test.meta?.acceptanceAssertions ?? 0, duration_ms: test.duration }));
  const passed = file?.status === 'passed' && tests.length === 1 && tests[0].title.startsWith(c.id + ' ')
    && tests[0].status === 'passed' && Number.isSafeInteger(tests[0].assertion_count) && tests[0].assertion_count > 0;
  // The approved cancellation and final completion have different eligible occurrence versions.
  // The regression exercises their contested lock but cannot establish simultaneous eligibility.
  const releaseWindow = c.id === 'GT-1317' && passed;
  return { case_id: c.id, test_file: c.test_file, status: releaseWindow ? 'blocked' : passed ? 'passed' : 'failed',
    assertion_count: tests.reduce((sum, test) => sum + test.assertion_count, 0),
    layers: [{ layer: c.layer, ...context }], vitest_results: tests,
    ...(releaseWindow && { formal_limitation: 'The pre-start cancellation is already stale when completion is approved. Its independent lock wait and conflict passed, but both terminal commands cannot be eligible on the same occurrence version.' }) };
});
const artifact = { schema_version: 1, run_id: runId, test_command: ['node', ...args].join(' '), git_commit: commit,
  ...context, started_at: started, finished_at: finished, exit_code: exitCode, test_results: results,
  vitest_version: JSON.parse(readFileSync(join(work, 'node_modules/vitest/package.json'), 'utf8')).version,
  vitest_report_sha256: raw ? digest(raw) : null, git_tree: git('rev-parse', commit + '^{tree}').toString().trim(),
  source_note: 'Whole Git blobs and executed file bytes were hashed. Verification permits CRLF and only the isolated API/database port substitution in the Supabase test helper.',
  sources: Object.fromEntries(Object.entries(sourceFiles).sort(([a], [b]) => a.localeCompare(b, 'en'))), instrumentation };
const target = join(repo, 'docs/evidence/acceptance', runId + '.json');
mkdirSync(resolve(target, '..'), { recursive: true });
writeFileSync(target, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'report=' + relative(repo, target) + '\n');
console.log(relative(repo, target), digest(readFileSync(target)));
console.log(results.map(r => [r.case_id, r.status, r.assertion_count]));
process.exitCode = exitCode || Number(results.some(r => r.status === 'failed'));
