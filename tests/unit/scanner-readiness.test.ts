import { describe, expect, test, vi } from 'vitest';
import { waitForScanner } from '../../deploy/vercel-scanner/readiness';

const stale = { outcome: 'error', safe_error_code: 'SCANNER_SIGNATURES_STALE', engine_version: '1.4.7', signature_version: '28194' };

describe('private scanner readiness', () => {
  test('stale definitions allow the updater to start and still block worker launch', async () => {
    const log = vi.fn();
    const options = { scan: async () => stale, deadline: Date.now(), log, signal: new AbortController().signal };
    await expect(waitForScanner({ ...options, allowStale: true })).resolves.toMatchObject({name:'ready',observation:stale});
    await expect(waitForScanner({ ...options, allowStale: false })).rejects.toThrow('SCANNER_READINESS_TIMEOUT SCANNER_SIGNATURES_STALE engine=1.4.7 signatures=28194');
    expect(log).toHaveBeenCalledWith('private_scanner_waiting', {reason:'SCANNER_SIGNATURES_STALE',engine:'1.4.7',signatures:'28194'});
  });

  test('only an actual clean scan passes the final probe', async () => {
    const options = { deadline: Date.now(), allowStale: false, log: vi.fn(), signal: new AbortController().signal };
    const unknown = { ...stale, outcome: 'unknown', safe_error_code: 'SCANNER_OUTCOME_UNKNOWN' };
    await expect(waitForScanner({ ...options, scan: async () => unknown })).rejects.toThrow('SCANNER_OUTCOME_UNKNOWN');
    const clean = { ...stale, outcome: 'clean', safe_error_code: null };
    await expect(waitForScanner({ ...options, scan: async () => clean })).resolves.toEqual({name:'ready',observation:clean});
  });
});
