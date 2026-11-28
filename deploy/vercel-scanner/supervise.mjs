import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForScanner } from './readiness.ts';
import { createClamavScanAdapter } from './src/server/providers/file-scan.ts';

const endpoint = 'tcp://127.0.0.1:3310';
const smoke = process.argv.length === 3 && process.argv[2] === '--verify-scanner';
assert.ok(smoke || (process.argv.length === 2 && process.env.APP_ENV === 'production'), 'PRODUCTION_SCANNER_REQUIRES_PRODUCTION');
assert.ok(process.env.FILE_SCAN_ADAPTER === 'clamav' && process.env.FILE_SCAN_URL === endpoint, 'LOOPBACK_CLAMAV_REQUIRED');
const adapter = createClamavScanAdapter(endpoint);
const clean = Buffer.from('%PDF-1.4\n% Synthetic startup check\n%%EOF\n');
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

function start(name, args, user, env) {
  const account = readFileSync('/etc/passwd', 'utf8').split('\n').find(line => line.startsWith(user + ':'))?.split(':');
  assert.ok(account && Number(account[2]) > 0 && Number(account[3]) > 0, 'UNPRIVILEGED_ACCOUNT_REQUIRED');
  const child = spawn(name, args, { uid: Number(account[2]), gid: Number(account[3]), env, stdio: ['ignore', 'inherit', 'inherit'] });
  const exited = new Promise(resolve => {
    child.once('error', () => resolve({ name, code: 1 }));
    child.once('exit', (code, signal) => resolve({ name, code, signal }));
  });
  return { child, exited };
}
async function stop(service, graceMs) {
  if (!service || service.child.exitCode !== null || service.child.signalCode !== null) return;
  service.child.kill('SIGTERM');
  const timer = new AbortController();
  const force = delay(graceMs, null, { signal: timer.signal }).then(() => service.child.kill('SIGKILL'), () => {});
  try { await Promise.race([service.exited, force]); await service.exited; } finally { timer.abort(); }
}

function scan(bytes) {
  return adapter.scan({ file_id: randomUUID(), object_version: randomUUID(),
    checksum_sha256: createHash('sha256').update(bytes).digest('hex'), bytes });
}
const stopSignal = new AbortController();
const requested = new Promise(resolve => {
  const shutdown = () => { stopSignal.abort(); resolve({ name: 'shutdown', code: 0 }); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
});
const scannerEnv = { PATH: process.env.PATH, HOME: '/tmp', TZ: 'UTC' };
let clamd, updates, worker;
async function run() {
  const deadline = Date.now() + 300000;
  const probe = allowStale => waitForScanner({ scan: () => scan(clean), deadline, allowStale, signal: stopSignal.signal, log });
  clamd = start('clamd', ['--config-file=/etc/clamav/clamd.conf'], 'clamav', scannerEnv);
  // FreshClam must be able to notify a listening daemon when it installs its first update.
  const listening = await Promise.race([clamd.exited, requested, probe(true)]);
  if (listening.name === 'shutdown') return;
  if (listening.name !== 'ready') throw new Error('PRIVATE_SCANNER_STARTUP_FAILED_' + listening.name);
  updates = start('freshclam', ['--daemon', '--config-file=/etc/clamav/freshclam.conf'], 'clamav', scannerEnv);
  const serviceExit = Promise.race([clamd.exited, updates.exited, requested]);
  const first = await Promise.race([serviceExit, probe(false)]);
  if (first.name === 'ready') {
    // Validate actual kernel listeners. ClamD has no authentication of its own.
    const clamdSockets = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap(path => {
      const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
      return lines.map(line => line.trim().split(/\s+/)).filter(fields => fields[3] === '0A' && fields[1].endsWith(':0CEE'));
    });
    assert.deepEqual(clamdSockets.map(fields => fields[1]), ['0100007F:0CEE'], 'CLAMD_REQUIRES_ONE_LOOPBACK_LISTENER');
    log('private_scanner_ready', { engine: first.observation.engine_version, signatures: first.observation.signature_version });
    if (smoke) {
      const maximumSizePdf = Buffer.alloc(25 * 1024 * 1024, 0x20);
      maximumSizePdf.write('%PDF-1.4\n% Synthetic maximum-size scan\n');
      maximumSizePdf.write('%%EOF\n', maximumSizePdf.length - 6);
      assert.equal((await scan(maximumSizePdf)).outcome, 'clean', 'MAXIMUM_SIZE_SCAN_FAILED');
      // Inert standard EICAR anti-malware test pattern, generated only for this local check.
      const pattern = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      assert.equal((await scan(pattern)).outcome, 'infected'); log('private_scanner_self_test_passed');
    } else {
      worker = start('node', ['--conditions=react-server', '--import', 'tsx', 'src/worker/index.ts'], 'gitworker',
        { ...process.env, HOME: '/home/gitworker' });
      const result = await Promise.race([serviceExit, worker.exited]);
      if (result.name !== 'shutdown') throw new Error('PRIVATE_SCANNER_PROCESS_EXITED_' + result.name);
    }
  } else if (first.name !== 'shutdown') throw new Error('PRIVATE_SCANNER_STARTUP_FAILED_' + first.name);
}
try { await run(); } finally {
  stopSignal.abort();
  await stop(worker, 95000);
  await Promise.all([stop(updates, 12000), stop(clamd, 12000)]);
}
