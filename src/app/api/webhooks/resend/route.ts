import { parseServerConfig } from '@/server/config';
import { createDatabasePool, databaseUrl } from '@/server/database';
import { readResendEmailCallback } from '@/server/resend-callback';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };
let pool: ReturnType<typeof createDatabasePool> | undefined;

export async function POST(request: Request) {
  let configuration;
  try {
    configuration = parseServerConfig(process.env).resend;
  } catch {
    return Response.json({ code: 'NOT_CONFIGURED' }, { status: 503, headers });
  }
  if (!configuration) return Response.json({ code: 'NOT_CONFIGURED' }, { status: 503, headers });

  let observation;
  try {
    observation = await readResendEmailCallback(request, configuration.webhook_secret);
  } catch {
    return Response.json({ code: 'CALLBACK_REJECTED' }, { status: 400, headers });
  }

  if (observation) {
    try {
      pool ??= createDatabasePool(databaseUrl('worker'));
      await pool.query('select app_private.record_email_callback($1,$2,$3,$4,$5)', [
        observation.attempt_id,
        observation.provider_message_id,
        observation.callback_id,
        observation.outcome,
        observation.observed_at,
      ]);
    } catch {
      return Response.json({ code: 'CALLBACK_UNAVAILABLE' }, { status: 503, headers });
    }
  }
  return Response.json({ received: true }, { headers });
}
