import { describe, expect, it } from 'vitest';
import { heartbeatIsFresh } from '../../src/worker/health';

describe('worker health signal', () => {
  const now = 2_000_000;
  it('accepts a recent heartbeat and the inclusive age boundary', () => {
    expect(heartbeatIsFresh(String(now), now)).toBe(true);
    expect(heartbeatIsFresh(String(now - 180_000), now)).toBe(true);
  });
  it('rejects stalled, future, missing and malformed signals', () => {
    for (const value of ['', 'not-a-timestamp', 'NaN', '{}', '-1', '1.5', String(now + 1), String(now - 180_001)]) {
      expect(heartbeatIsFresh(value, now)).toBe(false);
    }
  });
});
