import { DomainError } from './http';

export const maximumFileBytes = 25 * 1024 * 1024;
/** Call only after the content service has verified bytes and current download authority. */
export function streamFileBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
    cancel() { offset = bytes.byteLength; },
  });
}
export async function readBoundedFileBody(request: Request, maximum = maximumFileBytes): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new DomainError('VALIDATION_ERROR');
  if (length !== null && Number(length) > maximum) throw new DomainError('FILE_TOO_LARGE');
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new DomainError('VALIDATION_ERROR');
  if (!request.body) throw new DomainError('UPLOAD_REQUIRED');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; total += result.value.byteLength; if (total > maximum) { await reader.cancel(); throw new DomainError('FILE_TOO_LARGE'); } chunks.push(result.value); }
  } finally { reader.releaseLock(); }
  if (!total) throw new DomainError('UPLOAD_REQUIRED');
  if (length !== null && Number(length) !== total) throw new DomainError('FILE_SIZE_MISMATCH');
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\;]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
