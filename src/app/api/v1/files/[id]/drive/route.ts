import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestSupabase } from '@/server/supabase';
import { DomainError, safeError } from '@/server/http';

export async function GET(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  let scoped: ReturnType<typeof requestSupabase> | undefined;
  try {
    scoped = requestSupabase(request);
    const auth = await scoped.client.auth.getClaims();
    if (auth.error || !auth.data?.claims.sub) throw new DomainError('AUTH_REQUIRED');
    const {id} = await params;
    if (!z.uuid().safeParse(id).success || request.nextUrl.searchParams.size) throw new DomainError('NOT_FOUND');
    let url: string | null = null;
    if (process.env.REQUEST_DRIVE_ADAPTER === 'google') {
      const result = await scoped.client.rpc('get_request_drive_link', {p_file_id: id});
      if (result.error && !['NOT_FOUND','FORBIDDEN'].includes(result.error.message)) throw new DomainError('DEPENDENCY_UNAVAILABLE');
      if (result.data && !result.error) {
        const link = z.object({ drive_file_id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict().parse(result.data);
        url = `https://drive.google.com/open?id=${encodeURIComponent(link.drive_file_id)}`;
      }
    }
    return scoped.finish(NextResponse.json({data: {url}}, {headers}));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code }, {status: safe.status, headers});
    return scoped ? scoped.finish(response) : response;
  }
}
