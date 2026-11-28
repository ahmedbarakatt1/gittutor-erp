import { timingSafeEqual } from 'node:crypto';
import { syncRequestDrive } from '@/server/request-drive-sync';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const headers = { 'Cache-Control': 'private, no-store' };
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null, { status: 401, headers });
  let scanFailed = false;
  if (process.env.REQUEST_MATERIAL_SCAN_ADAPTER === 'vercel_sandbox') {
    try {
      const { runRequestMaterialScan } = await import('@/server/request-material-scan');
      await runRequestMaterialScan();
    } catch { scanFailed = true; }
  }
  try {
    const result = await syncRequestDrive({}, 25);
    return Response.json(result, { headers, status: scanFailed || result.failed ? 503 : 200 });
  } catch { return new Response(null, { status: 503, headers }); }
}
