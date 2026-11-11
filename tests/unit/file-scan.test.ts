import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { expect, test } from 'vitest';
import { createClamavScanAdapter, createFakeScanAdapter } from '../../src/server/providers/file-scan';

const bytes = Buffer.from('%PDF-1.4\nSynthetic scanner fixture\n%%EOF');
const file = { file_id: randomUUID(), object_version: randomUUID(), checksum_sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
test('fake scan states remain explicit and reject mismatched immutable bytes', async () => {
  expect(await createFakeScanAdapter('clean', true).scan(file)).toMatchObject({ outcome: 'clean', adapter_mode: 'fake' });
  for (const state of ['infected', 'error', 'unknown'] as const) expect((await createFakeScanAdapter(state, true).scan(file)).outcome).toBe(state);
  expect(() => createFakeScanAdapter('clean', false)).toThrow('FAKE_SCANNER_REQUIRES_ISOLATION');
  await expect(createFakeScanAdapter('clean', true).scan({ ...file, bytes: Buffer.from('changed') })).rejects.toThrow('FILE_CHECKSUM_MISMATCH');
});
test('ClamD adapter streams exact bytes, checks signatures and interprets bounded replies', async () => {
  let received = Buffer.alloc(0), reply = 'stream: OK', version = `ClamAV 1.4.3/28000/${new Date().toUTCString()}`;
  const server = createServer(socket => { let input = Buffer.alloc(0); socket.on('data', chunk => {
    input = Buffer.concat([input, chunk]);
    if (input.subarray(0, 10).toString() === 'zVERSION\0') socket.end(`${version}\0`);
    if (input.subarray(0, 10).toString() !== 'zINSTREAM\0') return;
    let offset = 10; const parts: Buffer[] = [];
    while (offset + 4 <= input.length) { const length = input.readUInt32BE(offset); offset += 4; if (!length) { received = Buffer.concat(parts); socket.end(`${reply}\0`); return; } if (offset + length > input.length) return; parts.push(input.subarray(offset, offset + length)); offset += length; }
  }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TEST_SERVER');
  try {
    const adapter = createClamavScanAdapter(`tcp://127.0.0.1:${address.port}`);
    expect(await adapter.scan(file)).toMatchObject({ outcome: 'clean', adapter_mode: 'clamav', signature_version: '28000' }); expect(received).toEqual(bytes);
    reply = 'stream: Synthetic-Test FOUND'; expect((await adapter.scan(file)).outcome).toBe('infected');
    version = 'ClamAV 1.4.3/28000/Thu, 01 Jan 1970 00:00:00 GMT'; expect(await adapter.scan(file)).toMatchObject({ outcome: 'error', safe_error_code: 'SCANNER_SIGNATURES_STALE' });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
