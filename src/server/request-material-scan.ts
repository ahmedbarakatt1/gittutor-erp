import 'server-only';
import { z } from 'zod';
import { fileScanHandler } from '../worker/file-scan';
import { executeLeasedJob } from '../worker/execute';
import type { Job } from '../worker/claims';
import { createDatabasePool, databaseUrl } from './database';
import { createPrivateObjectStore } from './files';
import { parseServerConfig } from './config';
import { createSandboxClamavScanAdapter } from './providers/sandbox-clamav';

let pool: ReturnType<typeof createDatabasePool> | undefined;

export async function runRequestMaterialScan(fileId?: string): Promise<{attempted: number; state: string | null}> {
  if (process.env.REQUEST_MATERIAL_SCAN_ADAPTER !== 'vercel_sandbox') return { attempted: 0, state: null };
  if (fileId !== undefined) z.uuid().parse(fileId);
  pool ??= createDatabasePool(databaseUrl('worker'));
  const result = await pool.query<Job>('select * from app_private.claim_request_material_scan($1)', [fileId ?? null]);
  const job = result.rows[0];
  if (!job) return { attempted: 0, state: null };
  const store = createPrivateObjectStore(parseServerConfig(process.env));
  const scanner = createSandboxClamavScanAdapter(process.env.REQUEST_MATERIAL_SCAN_SNAPSHOT);
  const handler = fileScanHandler(pool, file => store.read(file), () => scanner);
  const state = await executeLeasedJob(pool, job, handler);
  return { attempted: 1, state };
}
