import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GET as driveLink } from '@/app/api/v1/files/[id]/drive/route';
import { GET as retry } from '@/app/api/cron/request-drive/route';

const deps = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), sync: vi.fn() }));
vi.mock('@/server/supabase', () => ({ requestSupabase: () => ({
  client: { auth: { getClaims: deps.auth }, rpc: deps.rpc }, finish: (response: Response) => response,
}) }));
vi.mock('@/server/request-drive-sync', () => ({ syncRequestDrive: deps.sync }));

const id = '11111111-0000-4000-8000-000000000001';
function requestLink() {
  return driveLink(new NextRequest('https://example.test/api/v1/files/' + id + '/drive'), {params: Promise.resolve({id})});
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('REQUEST_DRIVE_ADAPTER', 'google');
  vi.stubEnv('REQUEST_MATERIAL_SCAN_ADAPTER', 'disabled');
  deps.auth.mockResolvedValue({data: {claims: {sub: 'principal'}}});
});
afterEach(() => vi.unstubAllEnvs());

test('an unauthenticated request cannot resolve Drive file identifiers', async () => {
  deps.auth.mockResolvedValue({data: null});
  expect((await requestLink()).status).toBe(401);
  expect(deps.rpc).not.toHaveBeenCalled();
});
test('the viewer route returns only the scoped link and disables shared caching', async () => {
  deps.rpc.mockResolvedValueOnce({data: null, error: {message: 'FORBIDDEN'}})
    .mockResolvedValueOnce({data: {drive_file_id: 'sample_drive_id'}});
  expect(await (await requestLink()).json()).toEqual({data: {url: null}});
  const response = await requestLink();
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({data: {url: 'https://drive.google.com/open?id=sample_drive_id'}});
  expect(deps.rpc).toHaveBeenCalledWith('get_request_drive_link', {p_file_id: id});
});
test('the cron requires its bearer secret before looking for work', async () => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
  const url = 'https://example.test/api/cron/request-drive';
  expect((await retry(new Request(url))).status).toBe(401);
  expect(deps.sync).not.toHaveBeenCalled();
  deps.sync.mockResolvedValue({attempted: 0, failed: 0});
  expect((await retry(new Request(url, {headers: {authorization:'Bearer synthetic-cron-secret'}}))).status).toBe(200);
  expect(deps.sync).toHaveBeenCalledOnce();
});
