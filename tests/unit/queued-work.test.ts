import { beforeEach, expect, it, vi } from 'vitest';
import { drainQueuedWork } from '../../src/server/queued-work';

const jobs = vi.hoisted(() => ({ query: vi.fn(), claim: vi.fn(), run: vi.fn(), handler: {} }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/database', () => ({ createDatabasePool: () => ({query:jobs.query}), databaseUrl: () => 'test' }));
vi.mock('../../src/server/config', () => ({ parseServerConfig: () => ({providers:{file_scan:'clamav'}}) }));
vi.mock('../../src/server/providers/sandbox-clamav', () => ({ createSandboxClamavScanAdapter: () => ({}) }));
vi.mock('../../src/worker/handlers', () => ({ createWorkerHandlers: () => ({
  channelMode: 'manual', handlers: { 'files.scan': jobs.handler, 'calendar.sync': jobs.handler },
}) }));
vi.mock('../../src/worker/claims', () => ({ claimWorkerJobs: jobs.claim }));
vi.mock('../../src/worker/execute', () => ({ executeLeasedJob: jobs.run }));
beforeEach(() => vi.resetAllMocks());

it('claims one scan with time for an isolated sandbox and retains the failed outcome', async () => {
  jobs.query.mockResolvedValue({rows:[{id:'scan'}]});
  jobs.run.mockResolvedValue('reconciliation');
  expect(await drainQueuedWork('files.scan')).toEqual({processed:1,completed:0});
  expect(jobs.query).toHaveBeenCalledExactlyOnceWith('select * from app_private.claim_jobs($1,1,300,$2)', ['files.scan','support.whatsapp_send']);
  expect(jobs.claim).not.toHaveBeenCalled();
});

it('stops a backlog at the invocation budget without preclaiming more work', async () => {
  jobs.claim.mockResolvedValue([{id:'calendar'}]);
  jobs.run.mockResolvedValue('completed');
  expect(await drainQueuedWork('calendar.sync')).toEqual({processed:16,completed:16});
  expect(jobs.claim).toHaveBeenCalledTimes(16);
});

it('leaves manual WhatsApp and unknown purposes untouched', async () => {
  await expect(drainQueuedWork('support.whatsapp_send')).rejects.toThrow('UNKNOWN_JOB_PURPOSE');
  expect(jobs.query).not.toHaveBeenCalled();
  expect(jobs.claim).not.toHaveBeenCalled();
});
