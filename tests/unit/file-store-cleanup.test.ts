import { expect, test, vi } from 'vitest';
const provider = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from: () => ({ remove: provider.remove }) } }) }));
import { createPrivateObjectStore } from '../../src/server/files';
import { parseServerConfig } from '../../src/server/config';

test('a returned Storage cleanup error remains a failed operation', async () => {
  const config = parseServerConfig({ APP_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SUPABASE_SECRET_KEY: 'synthetic-secret' });
  provider.remove.mockResolvedValueOnce({ data: null, error: { message: 'Storage temporarily unavailable' } });
  await expect(createPrivateObjectStore(config).removeParts(['synthetic-private-part'])).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  provider.remove.mockResolvedValueOnce({ data: [], error: null });
  await expect(createPrivateObjectStore(config).removeParts(['synthetic-private-part'])).resolves.toBeUndefined();
});
