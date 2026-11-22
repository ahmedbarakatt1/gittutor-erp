import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createSandboxClamavScanAdapter } from '../../src/server/providers/sandbox-clamav';
vi.mock('server-only', () => ({}));
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@vercel/sandbox', () => ({ Sandbox: sdk }));
const bytes = Buffer.from('synthetic scanner fixture');
const file = { bytes, checksum_sha256: createHash('sha256').update(bytes).digest('hex'), file_id: 'file', object_version: 'v1' };
const path = '/tmp/git-tutor-request-material';
function sandbox(status: string, exitCode = 0, signatureDate = new Date()) {
  const calls: string[] = [];
  const box = {
    runCommand: vi.fn(async ({ cmd, args }: { cmd: string; args: string[] }) => {
      calls.push(cmd);
      const version = args.includes('--version');
      return { exitCode: !version && cmd === 'clamscan' ? exitCode : 0, stdout: async () =>
        version ? 'ClamAV 1.5.4/28191/' + signatureDate.toUTCString()
          : cmd === 'sha256sum' ? file.checksum_sha256 + '  ' + path : status, stderr: async () => '' };
    }),
    updateNetworkPolicy: vi.fn(async (p: string) => { calls.push(p); }),
    writeFiles: vi.fn(async () => { calls.push('private-file'); }),
    stop: vi.fn(async () => { calls.push('stop'); }),
  };
  sdk.create.mockResolvedValue(box);
  return { box, calls };
}
test.each([
  [path + ': OK', 0, 'clean'], [path + ': Eicar-Signature FOUND', 1, 'infected'],
  ['unexpected success output', 0, 'error'], [path + ': OK', 2, 'error'],
])('validates scanner output and destroys the isolated VM (%s)', async (output, code, outcome) => {
  const { box, calls } = sandbox(String(output), Number(code));
  const result = await createSandboxClamavScanAdapter().scan(file);
  expect(result).toMatchObject({ outcome, adapter_mode: 'clamav', engine_version: '1.5.4', signature_version: '28191' });
  expect(sdk.create.mock.lastCall?.[0]).toMatchObject({ persistent: false, ports: [] });
  expect(calls.indexOf('deny-all')).toBeLessThan(calls.indexOf('private-file'));
  expect(calls.at(-1)).toBe('stop');
  expect(box.writeFiles).toHaveBeenCalledTimes(1);
});
test('rejects stale signatures without writing a file', async () => {
  const { box } = sandbox('', 0, new Date(Date.now() - 49 * 3600_000));
  expect(await createSandboxClamavScanAdapter().scan(file)).toMatchObject({ outcome: 'error', safe_error_code: 'SCANNER_SIGNATURES_STALE' });
  expect(box.writeFiles).not.toHaveBeenCalled();
  expect(box.stop).toHaveBeenCalled();
});
test('provider connection failures withhold clean evidence and never expose diagnostics', async () => {
  const { box } = sandbox('');
  box.updateNetworkPolicy.mockRejectedValue(new Error('private-provider-debug'));
  expect(await createSandboxClamavScanAdapter().scan(file)).toMatchObject({ outcome: 'unknown', safe_error_code: 'SCANNER_OUTCOME_UNKNOWN' });
  expect(box.writeFiles).not.toHaveBeenCalled();
  expect(box.stop).toHaveBeenCalled();
});
