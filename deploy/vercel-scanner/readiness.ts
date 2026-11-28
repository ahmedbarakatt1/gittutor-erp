import { setTimeout as delay } from 'node:timers/promises';

type Observation = {
  outcome: string;
  safe_error_code: string | null;
  engine_version: string;
  signature_version: string;
};

export async function waitForScanner({ scan, deadline, allowStale, signal, log }: {
  scan: () => Promise<Observation>;
  deadline: number;
  allowStale: boolean;
  signal: AbortSignal;
  log: (event: string, details: { reason: string; engine: string; signatures: string }) => void;
}) {
  let lastReason = '';
  for (;;) {
    const observation = await scan();
    if (observation.outcome === 'clean' || (allowStale && observation.safe_error_code === 'SCANNER_SIGNATURES_STALE')) {
      return { name: 'ready', observation };
    }
    const detail = {
      reason: observation.safe_error_code ?? observation.outcome,
      engine: observation.engine_version,
      signatures: observation.signature_version,
    };
    const reason = `${detail.reason} engine=${detail.engine} signatures=${detail.signatures}`;
    if (reason !== lastReason) {
      log('private_scanner_waiting', detail);
      lastReason = reason;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`SCANNER_READINESS_TIMEOUT ${reason}`);
    await delay(Math.min(2000, remaining), null, { signal });
  }
}
