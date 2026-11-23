import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const secret = process.env.WORKER_WAKE_SECRET;
  const expected = Buffer.from('Bearer ' + (secret ?? ''));
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new Response(null, { status: 401, headers });
  }
  const purpose = request.headers.get('x-git-tutor-purpose') ?? '';
  if (!/^[a-z_]{1,32}\.[a-z_]{1,32}$/.test(purpose)) return new Response(null, { status: 400, headers });
  if (request.headers.get('prefer') === 'respond-async') {
    after(async () => {
      const result = await execute(purpose);
      if (!result.ok) console.warn('Git Tutor worker needs retry', { purpose, status: result.status });
    });
    return new Response(null, { status: 202, headers });
  }
  return execute(purpose);
}

async function execute(purpose: string) {
  try {
    if (purpose === 'drive.reconcile') {
      const { syncRequestDrive } = await import('@/server/request-drive-sync');
      const result = await syncRequestDrive({}, 3);
      return Response.json(result, { headers, status: result.failed ? 503 : 200 });
    }
    const { drainQueuedWork } = await import('@/server/queued-work');
    const result = await drainQueuedWork(purpose);
    return Response.json(result, { headers, status: result.processed === result.completed ? 200 : 503 });
  } catch (error) {
    const status = error instanceof Error && error.message === 'UNKNOWN_JOB_PURPOSE' ? 400 : 503;
    return new Response(null, { status, headers });
  }
}
