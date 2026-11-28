import { readFile, rename, writeFile } from 'node:fs/promises';

export function heartbeatIsFresh(value: string, now = Date.now()): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const at = Number(value.trim());
  return Number.isSafeInteger(at) && at > 0 && at <= now && now - at <= 180_000;
}

export async function writeHeartbeat(path: string | undefined) {
  if (!path) return;
  await writeFile(`${path}.tmp`, `${Date.now()}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function workerIsHealthy(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  try { return heartbeatIsFresh(await readFile(path, 'utf8')); }
  catch { return false; }
}
