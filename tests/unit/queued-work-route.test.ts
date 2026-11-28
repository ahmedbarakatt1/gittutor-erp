import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/cron/worker/route';

const mocks = vi.hoisted(() => ({ drain: vi.fn(), sync: vi.fn() }));
vi.mock('../../src/server/queued-work', () => ({ drainQueuedWork: mocks.drain }));
vi.mock('../../src/server/request-drive-sync', () => ({ syncRequestDrive: mocks.sync }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function wake(purpose: string, token = 'worker-test') {
  return POST(new Request('https://example.test/api/cron/worker', { method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'x-git-tutor-purpose': purpose } }));
}

it('never loads work when disabled or unauthenticated', async () => {
  vi.stubEnv('WORKER_WAKE_SECRET', '');
  expect((await wake('files.scan')).status).toBe(401);
  vi.stubEnv('WORKER_WAKE_SECRET', 'worker-test');
  expect((await wake('files.scan','wrong-token')).status).toBe(401);
  expect(mocks.drain).not.toHaveBeenCalled();
});

it('only accepts a purpose and reports failed or unknown work to the scheduler', async () => {
  vi.stubEnv('WORKER_WAKE_SECRET', 'worker-test');
  expect((await wake('../files')).status).toBe(400);
  mocks.drain.mockResolvedValueOnce({processed: 1, completed: 0}).mockResolvedValueOnce({processed: 0, completed: 0});
  expect((await wake('files.scan')).status).toBe(503);
  expect((await wake('files.scan')).status).toBe(200);
  expect(mocks.drain.mock.calls).toEqual([['files.scan'],['files.scan']]);
});

it('keeps failed Drive revocations eligible for retry', async () => {
  vi.stubEnv('WORKER_WAKE_SECRET', 'worker-test');
  mocks.sync.mockResolvedValue({attempted:1,failed:1});
  expect((await wake('drive.reconcile')).status).toBe(503);
  expect(mocks.sync).toHaveBeenCalledWith({},3);
  expect(mocks.drain).not.toHaveBeenCalled();
});
