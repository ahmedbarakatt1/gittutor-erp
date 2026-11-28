import 'server-only';
import { Sandbox } from '@vercel/sandbox';
import { clamavVersion, scanReference, validateScanInput, type ScanAdapter, type ScanObservation } from './file-scan';

const path = '/tmp/git-tutor-request-material';
type Credentials = { token: string; teamId: string; projectId: string };

async function runSetup(box: Sandbox, cmd: string, args: string[]) {
  const result = await box.runCommand({ cmd, args, sudo: true });
  if (result.exitCode !== 0) throw new Error('SCANNER_SETUP_FAILED');
}

async function version(box: Sandbox) {
  const result = await box.runCommand({ cmd: 'clamscan', args: ['--version'] });
  return clamavVersion(result.exitCode === 0 ? await result.stdout() : '');
}

/** A snapshot, when configured, contains only the engine and its signed public databases. */
export function createSandboxClamavScanAdapter(snapshotId?: string, credentials?: Credentials): ScanAdapter {
  return { async scan(file) {
    validateScanInput(file);
    const base: ScanObservation = {
      outcome: 'unknown', adapter_mode: 'clamav', engine_version: 'unavailable', signature_version: 'unavailable',
      reference: scanReference(file), safe_error_code: 'SCANNER_OUTCOME_UNKNOWN',
    };
    let box: Sandbox | undefined;
    try {
      const options = { ...credentials, persistent: false, ports: [], resources: { vcpus: 2 }, timeout: 225_000 };
      box = await Sandbox.create(snapshotId ? { ...options, source: { type: 'snapshot', snapshotId } } : options);
      if (!snapshotId) {
        await runSetup(box, 'apt-get', ['-qq', 'update']);
        await runSetup(box, 'env', ['DEBIAN_FRONTEND=noninteractive', 'apt-get', '-qq', 'install',
          '-y', '--no-install-recommends', 'clamav', 'clamav-freshclam']);
      }
      let current = await version(box);
      if (current.safe_error_code) {
        await runSetup(box, 'freshclam', ['--config-file=/etc/clamav/freshclam.conf', '--stdout']);
        current = await version(box);
      }
      Object.assign(base, current);
      if (current.safe_error_code) return { ...base, outcome: 'error' };

      await box.updateNetworkPolicy('deny-all');
      await box.writeFiles([{ path, content: file.bytes, mode: 0o600 }]);
      const checksum = await box.runCommand({ cmd: 'sha256sum', args: [path] });
      if (checksum.exitCode !== 0 || (await checksum.stdout()).trim() !== file.checksum_sha256 + '  ' + path) {
        return { ...base, outcome: 'error', safe_error_code: 'FILE_CHECKSUM_MISMATCH' };
      }
      const result = await box.runCommand({ cmd: 'clamscan', args: [
        '--stdout', '--no-summary', '--alert-exceeds-max=yes', '--alert-encrypted=yes',
        '--max-filesize=26M', '--max-scansize=100M', '--max-files=2000', '--max-recursion=16', '--max-scantime=8000', path,
      ] });
      const output = (await result.stdout()).trim();
      if (result.exitCode === 0 && output === path + ': OK') return { ...base, outcome: 'clean', safe_error_code: null };
      if (result.exitCode === 1 && output.startsWith(path + ': ') && output.endsWith(' FOUND')) {
        return { ...base, outcome: 'infected', safe_error_code: 'FILE_QUARANTINED' };
      }
      return { ...base, outcome: 'error', safe_error_code: 'SCANNER_REJECTED' };
    } catch {
      return { ...base, outcome: 'unknown', safe_error_code: 'SCANNER_OUTCOME_UNKNOWN' };
    } finally {
      // No snapshot is taken on stop. The hard VM deadline also covers a lost response.
      if (box) await box.stop().catch(() => undefined);
    }
  } };
}
