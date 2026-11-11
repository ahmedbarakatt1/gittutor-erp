import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';

export type ScanInput = { file_id: string; object_version: string; checksum_sha256: string; bytes: Uint8Array };
export type ScanObservation = { outcome: 'clean'|'infected'|'error'|'unknown'; adapter_mode: 'fake'|'clamav'; engine_version: string; signature_version: string; reference: string; safe_error_code: string|null };
export type ScanAdapter = { scan(file: ScanInput): Promise<ScanObservation> };
export type ScanScenario = 'clean'|'infected'|'error'|'unknown'|'timeout_after_result';
const maxBytes = 25 * 1024 * 1024;
function validate(file: ScanInput) { if (!file.bytes.length || file.bytes.length > maxBytes) throw new Error('FILE_SIZE_MISMATCH'); if (createHash('sha256').update(file.bytes).digest('hex') !== file.checksum_sha256) throw new Error('FILE_CHECKSUM_MISMATCH'); }
function reference(file: ScanInput) { return createHash('sha256').update(`${file.file_id}:${file.object_version}:${file.checksum_sha256}`).digest('hex'); }
export function createFakeScanAdapter(scenario: ScanScenario, isolated: boolean): ScanAdapter {
  if (!isolated) throw new Error('FAKE_SCANNER_REQUIRES_ISOLATION');
  return { async scan(file) { validate(file); const outcome = scenario === 'timeout_after_result' ? 'clean' : scenario; return { outcome, adapter_mode: 'fake', engine_version: 'git-tutor-fake-v1', signature_version: 'synthetic-v1', reference: reference(file), safe_error_code: outcome === 'clean' ? null : outcome === 'infected' ? 'FILE_QUARANTINED' : outcome === 'error' ? 'SCANNER_UNAVAILABLE' : 'SCANNER_OUTCOME_UNKNOWN' }; } };
}

/** Private-network ClamD INSTREAM; no customer path or URL reaches the daemon. */
export function createClamavScanAdapter(endpoint: string): ScanAdapter {
  const address = new URL(endpoint);
  if (address.protocol !== 'tcp:' || !address.hostname || !address.port || address.username || address.password || address.search || address.hash || (address.pathname && address.pathname !== '/')) throw new Error('SCANNER_CONFIGURATION_INVALID');
  let active = 0;
  async function request(command: 'VERSION'|'INSTREAM', bytes?: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: address.hostname, port: Number(address.port) }); let output = Buffer.alloc(0), ended = false;
      const timer = setTimeout(() => finish(new Error('SCANNER_TIMEOUT')), 10000);
      function finish(error?: Error, result?: string) { if (ended) return; ended = true; clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(result!); }
      socket.on('error', () => finish(new Error('SCANNER_UNAVAILABLE')));
      socket.on('close', () => { if (!ended) finish(new Error('SCANNER_RESPONSE_INVALID')); });
      socket.on('data', chunk => { output = Buffer.concat([output, chunk]); if (output.length > 4096) { finish(new Error('SCANNER_RESPONSE_INVALID')); return; } const end = output.indexOf(0); if (end >= 0) finish(undefined, output.subarray(0, end).toString('utf8')); });
      socket.once('connect', () => {
        void (async () => {
          const write = (data: Uint8Array|string) => new Promise<void>((done, fail) => socket.write(data, error => error ? fail(error) : done()));
          await write(`z${command}\0`);
          if (bytes) { for (let offset = 0; offset < bytes.length; offset += 65536) { const part = bytes.subarray(offset, offset + 65536), length = Buffer.alloc(4); length.writeUInt32BE(part.length); await write(length); await write(part); } await write(Buffer.alloc(4)); }
        })().catch(() => finish(new Error('SCANNER_UNAVAILABLE')));
      });
    });
  }
  return { async scan(file) {
    validate(file); const base = { adapter_mode: 'clamav' as const, engine_version: 'unavailable', signature_version: 'unavailable', reference: reference(file) };
    if (active >= 4) return { ...base, outcome: 'error', safe_error_code: 'SCANNER_BUSY' };
    active++;
    try {
      const version = /^ClamAV ([A-Za-z0-9._-]{1,100})\/(\d{1,30})\/(.{1,100})$/.exec(await request('VERSION'));
      if (!version) return { ...base, outcome: 'error', safe_error_code: 'SCANNER_VERSION_UNAVAILABLE' };
      base.engine_version = version[1]; base.signature_version = version[2];
      const age = Date.now() - Date.parse(version[3]);
      if (!Number.isFinite(age) || age > 48 * 3600000 || age < -3600000) return { ...base, outcome: 'error', safe_error_code: 'SCANNER_SIGNATURES_STALE' };
      const result = await request('INSTREAM', file.bytes);
      if (result === 'stream: OK') return { ...base, outcome: 'clean', safe_error_code: null };
      if (/^stream: .+ FOUND$/.test(result)) return { ...base, outcome: 'infected', safe_error_code: 'FILE_QUARANTINED' };
      return { ...base, outcome: 'error', safe_error_code: 'SCANNER_REJECTED' };
    } catch { return { ...base, outcome: 'unknown', safe_error_code: 'SCANNER_OUTCOME_UNKNOWN' }; }
    finally { active--; }
  } };
}
