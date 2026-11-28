import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestSupabase } from '@/server/supabase';
import { allowedOrigin, DomainError, safeError } from '@/server/http';
import { uploadFileContent, uploadFileChunk, downloadFileContent } from '@/server/files';
import { attachmentDisposition, readBoundedFileBody, streamFileBytes } from '@/server/file-content-body';
import { fileChunkBytes, parseFileRange } from '@/modules/files/transport';

export const runtime = 'nodejs';
type Context = ReturnType<typeof requestSupabase>;
function failure(error: unknown, requestId: string, context?: Context) { const safe = safeError(error); const result = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId }, { status: safe.status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); return context ? context.finish(result) : result; }
async function authorize(request: NextRequest, rawId: string) {
  if (!z.uuid().safeParse(rawId).success || request.nextUrl.searchParams.size) throw new DomainError('VALIDATION_ERROR');
  const context = requestSupabase(request); const { data, error } = await context.client.auth.getClaims(); if (error || !data?.claims.sub) throw new DomainError('AUTH_REQUIRED'); return context;
}
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID(); let context: Context | undefined;
  try {
    const { id } = await params; context = await authorize(request, id);
    if (!allowedOrigin(request.headers.get('origin'), context.config.app_base_url, context.config.isolated)) throw new DomainError('FORBIDDEN');
    let range: ReturnType<typeof parseFileRange>;
    try { range = parseFileRange(request.headers.get('content-range')); } catch { throw new DomainError('VALIDATION_ERROR'); }
    const result = range
      ? await uploadFileChunk(context.client, id, await readBoundedFileBody(request, fileChunkBytes), range)
      : await uploadFileContent(context.client, id, await readBoundedFileBody(request));
    return context.finish(NextResponse.json({ data: result, request_id: requestId }, { status: result.upload_state === 'uploading' ? 202 : 200, headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) { return failure(error, requestId, context); }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID(); let context: Context | undefined;
  try {
    const { id } = await params; context = await authorize(request, id);
    const file = await downloadFileContent(context.client, id);
    const bytes = new Uint8Array(file.bytes);
    return context.finish(new NextResponse(streamFileBytes(bytes), { headers: { 'Content-Type': file.detected_type, 'Content-Length': String(bytes.byteLength), 'Content-Disposition': attachmentDisposition(file.filename), 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer' } }));
  } catch (error) { return failure(error, requestId, context); }
}
