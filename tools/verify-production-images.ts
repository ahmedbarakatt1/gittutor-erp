/** Isolated packaging smoke test. Never connects to either existing Git Tutor database. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile), suffix = randomBytes(5).toString('hex');
const folder = resolve('.local/production-image-check', suffix), network = `gittutor-image-check-${suffix}`;
const names = { database: `${network}-db`, web: `${network}-web`, worker: `${network}-worker`, invalid: `${network}-invalid` };
const label = `com.git-tutor.image-check=${suffix}`, created: string[] = [];
await mkdir(folder, { recursive: true });
async function docker(args: string[], timeout = 180_000) { return (await execute('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
async function inspect(name: string) { return JSON.parse(await docker(['inspect', name]))[0]; }
async function healthy(name: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = (await inspect(name)).State;
    if (state.Health?.Status === 'healthy') return;
    assert(state.Running, 'Smoke container stopped unexpectedly; inspect its private logs');
    await setTimeout(1000);
  }
  throw Error('SMOKE_HEALTH_TIMEOUT');
}
const report = { environment: 'fresh disposable container network; no existing database access', checks: [] as string[], completed_at: '' };
try {
  for (const target of ['web', 'worker']) {
    const image = `gittutor-${target}:production-check`;
    assert.equal((await inspect(image)).Config.User, 'node');
    await docker(['run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', "const f=require('node:fs');for(const p of ['.local','.git','.env.local','tests','fixtures','contracts/pricing-policy.json'])if(f.existsSync('/app/'+p))process.exit(1);if(f.readdirSync('/app').some(p=>p.startsWith('.env')))process.exit(1)"]);
  }
  report.checks.push('both images run as non-root and exclude private host data, credentials, fixtures and authored compensation policy');
  await docker(['network', 'create', '--label', label, network]);
  const password = randomBytes(24).toString('hex');
  await writeFile(resolve(folder, 'database.env'), `POSTGRES_PASSWORD=${password}\n`, { mode: 0o600 });
  await docker(['run', '--detach', '--name', names.database, '--label', label, '--network', network, '--env-file', resolve(folder, 'database.env'), '--health-cmd', 'pg_isready -U postgres', '--health-interval', '2s', '--health-start-period', '0s', 'postgres:17.12']); created.push(names.database);
  await healthy(names.database);
  await docker(['exec', names.database, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'create schema app_private; create function app_private.claim_jobs(text,integer,integer) returns table(id uuid) language sql as $$ select null::uuid where false $$;']);
  const settings = `APP_ENV=test\nAPP_BASE_URL=http://127.0.0.1:3002\nNEXT_PUBLIC_SUPABASE_URL=http://unused.invalid\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_smoke\nSUPABASE_SECRET_KEY=isolated-smoke-only\nWORKER_DATABASE_URL=postgresql://postgres:${password}@${names.database}:5432/postgres\nWORKER_PURPOSE=verification.no_jobs\n`;
  await writeFile(resolve(folder, 'runtime.env'), settings, { mode: 0o600 });
  const common = ['--label', label, '--network', network, '--env-file', resolve(folder, 'runtime.env'), '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=32m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--health-interval', '2s', '--health-start-period', '0s'];
  await docker(['run', '--detach', '--name', names.web, ...common, '--publish', '127.0.0.1::3000', 'gittutor-web:production-check']); created.push(names.web);
  await healthy(names.web);
  const binding = (await inspect(names.web)).NetworkSettings.Ports['3000/tcp'][0]; assert.equal(binding.HostIp, '127.0.0.1');
  const origin = `http://127.0.0.1:${binding.HostPort}`;
  const health = await fetch(`${origin}/healthz`); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok' }); assert.equal(health.headers.get('cache-control'), 'no-store');
  const home = await fetch(origin); assert.equal(home.status, 200); assert.equal(home.headers.get('x-frame-options'), 'DENY');
  const logo = await fetch(`${origin}/brand/git-tutor-instagram.jpg`); assert.equal(logo.status, 200); assert((await logo.arrayBuffer()).byteLength > 1000);
  report.checks.push('read-only web container serves liveness, homepage, security headers and original logo through loopback');
  await docker(['run', '--detach', '--name', names.worker, ...common, 'gittutor-worker:production-check']); created.push(names.worker);
  await healthy(names.worker);
  const logs = await docker(['logs', names.worker]); assert(logs.includes('worker_started') && logs.includes('exports.render'));
  await docker(['stop', '--time', '10', names.worker]); assert.equal((await inspect(names.worker)).State.ExitCode, 0);
  report.checks.push('production dependency-only worker starts all handlers, heartbeats against disposable empty queue and exits cleanly on SIGTERM');
  await docker(['run', '--detach', '--name', names.invalid, '--label', label, '--env', 'APP_ENV=production', '--publish', '127.0.0.1::3000', 'gittutor-web:production-check']); created.push(names.invalid);
  const invalidBinding = (await inspect(names.invalid)).NetworkSettings.Ports['3000/tcp'][0]; assert.equal(invalidBinding.HostIp, '127.0.0.1');
  let refusal: Response | undefined;
  for (let attempt = 0; attempt < 20 && !refusal; attempt++) {
    try { refusal = await fetch(`http://127.0.0.1:${invalidBinding.HostPort}/healthz`, { signal: AbortSignal.timeout(2000) }); }
    catch { await setTimeout(500); }
  }
  assert(refusal && refusal.status >= 500, 'Unconfigured production must refuse requests and liveness');
  report.checks.push('production rejects requests and liveness when live configuration is missing rather than serving a fake-provider release');
  report.completed_at = new Date().toISOString();
  await writeFile(resolve(folder, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile('.local/production-image-report.json', JSON.stringify(report, null, 2));
  for (const name of created.reverse()) {
    assert.equal((await inspect(name)).Config.Labels['com.git-tutor.image-check'], suffix);
    await docker(['rm', '--force', '--volumes', name]);
  }
  assert.equal(JSON.parse(await docker(['network', 'inspect', network]))[0].Labels['com.git-tutor.image-check'], suffix);
  await docker(['network', 'rm', network]);
  console.log(JSON.stringify({ outcome: 'passed', checks: report.checks.length, disposable_containers_removed: true }));
} catch (error) {
  for (const name of created) await writeFile(resolve(folder, `${name}.log`), await docker(['logs', name]).catch(() => 'No container log available'));
  await writeFile(resolve(folder, 'failure.json'), JSON.stringify({ message: error instanceof Error ? error.message : 'UNKNOWN', containers: created }, null, 2));
  console.error('IMAGE_SMOKE_FAILED; disposable containers and private diagnostics preserved.'); process.exitCode = 1;
}
