// Stay below function-host request limits without reducing the declared file limit.
export const fileChunkBytes = 3 * 1024 * 1024;
const maximumFileBytes = 25 * 1024 * 1024;
export type FileRange = { start: number; end: number; total: number };

export function fileRanges(total: number): FileRange[] {
  if (!Number.isSafeInteger(total) || total < 1 || total > maximumFileBytes) throw new Error('VALIDATION_ERROR');
  return Array.from({ length: Math.ceil(total / fileChunkBytes) }, (_, index) => ({
    start: index * fileChunkBytes, end: Math.min((index + 1) * fileChunkBytes, total) - 1, total,
  }));
}

export function parseFileRange(value: string | null): FileRange | null {
  if (value === null) return null;
  const match = /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match) throw new Error('VALIDATION_ERROR');
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || total < 1 || total > maximumFileBytes
    || start >= total || start % fileChunkBytes !== 0 || end !== Math.min(start + fileChunkBytes, total) - 1) throw new Error('VALIDATION_ERROR');
  return { start, end, total };
}
