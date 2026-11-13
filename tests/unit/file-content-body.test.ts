import { expect, test } from 'vitest';
import { attachmentDisposition, readBoundedFileBody } from '../../src/server/file-content-body';

test('binary upload bounds the actual stream even without a declared length', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } });
  await expect(readBoundedFileBody(new Request('http://example.test', { method: 'PUT', body: stream, duplex: 'half' } as RequestInit), 5)).rejects.toThrow('FILE_TOO_LARGE');
  expect(cancelled).toBe(true);
  const valid = new Request('http://example.test', { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { 'content-length': '3' } });
  expect(await readBoundedFileBody(valid, 3)).toEqual(new Uint8Array([1, 2, 3]));
  await expect(readBoundedFileBody(new Request('http://example.test', { method: 'PUT', body: new Uint8Array([1]), headers: { 'content-length': '2' } }))).rejects.toThrow('FILE_SIZE_MISMATCH');
});
test('attachment headers preserve Unicode names without header or quoted-field injection', () => {
  const value = attachmentDisposition('lesson";\r\nX-Test:yes.pdf');
  expect(value).not.toMatch(/[\r\n]/); expect(value).toContain('filename="lesson____X-Test:yes.pdf"');
  expect(attachmentDisposition('notes.pdf')).toBe("attachment; filename=\"notes.pdf\"; filename*=UTF-8''notes.pdf");
});
