import { expect, test } from 'vitest';
import { fileChunkBytes, fileRanges, parseFileRange } from '../../src/modules/files/transport';
import { streamFileBytes } from '../../src/server/file-content-body';

test('file ranges cover the full 25 MiB limit with requests below the host payload limit', () => {
  const total = 25 * 1024 * 1024;
  const ranges = fileRanges(total);
  expect(fileChunkBytes).toBe(3 * 1024 * 1024);
  expect(ranges).toHaveLength(9);
  expect(ranges.reduce((count, range) => count + range.end - range.start + 1, 0)).toBe(total);
  ranges.forEach((range, index) => {
    expect(range.start).toBe(index * fileChunkBytes);
    expect(range.end - range.start + 1).toBeLessThanOrEqual(fileChunkBytes);
    expect(parseFileRange(`bytes ${range.start}-${range.end}/${total}`)).toEqual(range);
  });
});

test('chunk declarations reject gaps, overlaps, oversized and ambiguous ranges', () => {
  expect(parseFileRange(null)).toBeNull();
  for (const value of ['bytes 0-1/*', 'bytes 1-3145728/5000000', 'bytes 0-9/5000000', 'bytes 0-3145728/5000000', 'bytes 0-3145727/26214401', 'bytes 0-3145727/1', 'bytes 0-3145727/5000000,bytes 0-1/2', 'bytes 0-9007199254740992/9007199254740993']) {
    expect(() => parseFileRange(value)).toThrow('VALIDATION_ERROR');
  }
});

test('authorized download bytes stream in bounded chunks without changing content', async () => {
  const bytes = Uint8Array.from({ length: 200_001 }, (_, index) => index % 251);
  const reader = streamFileBytes(bytes).getReader();
  const received: number[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    expect(result.value.byteLength).toBeLessThanOrEqual(64 * 1024);
    received.push(...result.value);
  }
  expect(Uint8Array.from(received)).toEqual(bytes);
});
