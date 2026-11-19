import { expect, test, vi } from 'vitest';
const provider = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from: () => ({ remove: provider.remove }) } }) }));
import { randomUUID } from 'node:crypto';
import { createPrivateObjectStore, createFileContentService } from '../../src/server/files';
import { fileChunkBytes, fileRanges } from '../../src/modules/files/transport';
import { parseServerConfig } from '../../src/server/config';

test('a returned Storage cleanup error remains a failed operation', async () => {
  const config = parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SUPABASE_SECRET_KEY: 'synthetic-secret' });
  provider.remove.mockResolvedValueOnce({ data: null, error: { message: 'Storage temporarily unavailable' } });
  await expect(createPrivateObjectStore(config).removeParts(['synthetic-private-part'])).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  provider.remove.mockResolvedValueOnce({ data: [], error: null });
  await expect(createPrivateObjectStore(config).removeParts(['synthetic-private-part'])).resolves.toBeUndefined();
});

test('out-of-order chunks share a verified cleanup manifest and retry a failed setup before staging', async () => {
  const fileId = randomUUID(), checksum = 'a'.repeat(64), size = fileChunkBytes * 3;
  const prepared = {
    file_id: fileId, object_key: `${fileId}/original`, object_version: randomUUID(),
    filename: 'practice.pdf', size_bytes: size, checksum_sha256: checksum,
    attempt_id: randomUUID(), lease_token: randomUUID(), purpose: 'request_material',
    declared_type: 'application/pdf', already_uploaded: false, version: 1,
  };
  const config = parseServerConfig({ APP_ENV: 'test' });
  const database = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ data: prepared }] }) };
  const client = { rpc: vi.fn().mockResolvedValue({ data: { authorization_id: randomUUID() }, error: null }) };
  const storage = {
    put: vi.fn().mockRejectedValueOnce(new Error('manifest unavailable')).mockResolvedValue(undefined),
    putPart: vi.fn(), readPart: vi.fn(), removeParts: vi.fn(), read: vi.fn(),
  };
  const makeService = () => createFileContentService(database, config, storage);
  const service = makeService(), ranges = fileRanges(size), bytes = new Uint8Array(fileChunkBytes);
  await expect(service.uploadChunk(client, fileId, bytes, ranges[1])).rejects.toThrow('manifest unavailable');
  expect(storage.putPart).not.toHaveBeenCalled();
  await Promise.all([1, 0].map(index => service.uploadChunk(client, fileId, bytes, ranges[index])));
  await service.uploadChunk(client, fileId, bytes, ranges[0]);
  expect(storage.put).toHaveBeenCalledTimes(2);
  const manifest = JSON.parse(new TextDecoder().decode(storage.put.mock.calls[1][1]));
  expect(manifest.part_keys).toEqual([0, 1, 2].map(index => `${fileId}/parts/${checksum}/${index}`));
  expect(storage.putPart.mock.calls.map(call => call[0]).sort()).toEqual([
    manifest.part_keys[0], manifest.part_keys[0], manifest.part_keys[1],
  ]);
  await makeService().uploadChunk(client, fileId, bytes, ranges[1]);
  expect(storage.put).toHaveBeenCalledTimes(3);
  expect(client.rpc).toHaveBeenCalledTimes(5);
  expect(database.query).toHaveBeenCalledTimes(5);
});
