import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const f = vi.hoisted(() => ({
  list: vi.fn(), query: vi.fn(), release: vi.fn(), token: vi.fn(), generate: vi.fn(), put: vi.fn(), readers: vi.fn(), trash: vi.fn(), read: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/request-drive-auth', () => ({
  requestDriveDatabase: () => ({ query: f.list, connect: async () => ({ query: f.query, release: f.release }) }),
  getRequestDriveToken: f.token,
}));
vi.mock('@/server/request-drive-provider', () => ({
  generateRequestDriveId: f.generate, putRequestDriveFile: f.put, reconcileRequestDriveReaders: f.readers, trashRequestDriveFile: f.trash,
}));
vi.mock('@/server/files', () => ({createPrivateObjectStore: () => ({read: f.read})}));
vi.mock('@/server/config', () => ({parseServerConfig: () => ({})}));
import { syncRequestDrive } from '@/server/request-drive-sync';

const id = '11111111-0000-4000-8000-000000000001';
function state() {
  return {file_id:id, revision:1, want_copy:true, drive_file_id:null as string|null, copy_uploaded:false,
    tutor_email:null as string|null, object_key:'private/testing', checksum_sha256:'0'.repeat(64), size_bytes:3, filename:'Lesson.pdf', detected_type:'application/pdf'};
}
let item = state(), ack = true, locked = true;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('REQUEST_DRIVE_ADAPTER', 'google');
  item = state(); ack = true; locked = true;
  f.list.mockResolvedValue({rows:[{file_id:id}]});
  f.token.mockResolvedValue('synthetic');
  f.generate.mockResolvedValue('stable-id');
  f.read.mockResolvedValue(Uint8Array.from([1,2,3]));
  f.query.mockImplementation(async (sql: string, args?: unknown[]) => {
    if (sql.includes('drive_material_projection')) return {rows:[{item:{...item}}]};
    if (sql.includes('drive_material_reserve_id')) item.drive_file_id = String(args?.[1]);
    if (sql.includes('advisory')) return {rows:[{acquired:locked}]};
    if (sql.includes('mark_uploaded')) item.copy_uploaded = true;
    if (sql.includes('drive_material_finish')) return {rows:[{ok:ack}]};
    return {rows:[]};
  });
});
afterEach(() => vi.unstubAllEnvs());
test('reserves the remote identity before uploading and leaves an unmatched draft owner-only', async () => {
  expect(await syncRequestDrive({fileId:id})).toEqual({attempted:1,failed:0});
  expect(f.list.mock.calls[0][1]).toEqual([null,id,3]);
  expect(f.put).toHaveBeenCalledWith('synthetic','stable-id',expect.objectContaining({fileId:id,name:'Lesson.pdf'}));
  expect(f.readers).toHaveBeenCalledWith('synthetic','stable-id',id,null);
  const calls = f.query.mock.calls.map(([sql]) => sql);
  expect(calls.findIndex(sql => sql.includes('reserve_id'))).toBeLessThan(calls.findIndex(sql => sql.startsWith('begin')));
  expect(f.release).toHaveBeenCalledOnce();
});
test('reuses the uploaded copy and removes a grant when the entitlement changes during Google readback', async () => {
  Object.assign(item,{drive_file_id:'existing',copy_uploaded:true,tutor_email:'tutor@example.test'}); ack=false;
  await syncRequestDrive();
  expect(f.put).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.readers.mock.calls.map(args => args[3])).toEqual(['tutor@example.test',null]);
});
test('quarantine or removal drives cleanup without granting a tutor', async () => {
  Object.assign(item,{drive_file_id:'existing',copy_uploaded:true,want_copy:false});
  await syncRequestDrive();
  expect(f.trash).toHaveBeenCalledWith('synthetic','existing',id,false);
  expect(f.readers).not.toHaveBeenCalled();
});
test('a busy file cannot be granted or uploaded concurrently', async () => {
  locked=false;
  await syncRequestDrive();
  expect(f.readers).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
});
test('a transient storage failure leaves work retryable without granting access', async () => {
  f.read.mockRejectedValue(Error('test'));
  expect(await syncRequestDrive()).toEqual({attempted:1,failed:1});
  expect(f.query).toHaveBeenCalledWith(expect.stringContaining('false,null'),[id,1]);
  expect(f.readers).not.toHaveBeenCalled();
});
test('disabled and empty queues make no Google requests', async () => {
  vi.stubEnv('REQUEST_DRIVE_ADAPTER', '');
  await syncRequestDrive(); expect(f.list).not.toHaveBeenCalled();
  vi.stubEnv('REQUEST_DRIVE_ADAPTER', 'google'); f.list.mockResolvedValue({rows:[]});
  await syncRequestDrive(); expect(f.token).not.toHaveBeenCalled();
});
