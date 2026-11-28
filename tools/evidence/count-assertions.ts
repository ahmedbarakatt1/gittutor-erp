import { afterEach, expect } from 'vitest';

// The JSON reporter retains task metadata. Capture Vitest's worker-local
// counter before the runner resets it for the next test.
afterEach(({ task }) => {
  Object.assign(task.meta, { acceptanceAssertions: expect.getState().assertionCalls });
});
