import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from '../helpers/supabase';
import type { WorkflowSnapshot } from '../../src/modules/workflow-import/model';

const ownerId = randomUUID(), sourceHash = createHash('sha256').update(ownerId).digest('hex');
const empty = { columns: [], rows: [] };
const snapshot: WorkflowSnapshot = { version: 1, source_name: 'synthetic-test.xlsx', source_sha256: sourceHash, as_of: null,
  tables: { sessions: empty, students: empty, tutors: { columns: [{ key: 'fee', label: 'Internal fee', type: 'money' }], rows: [{ source_row: 2, values: { fee: 123456 }, issues: [] }] }, packages: empty, marketing: empty, distributions: empty, balances: empty }, courses: [] };
let database: Awaited<ReturnType<typeof adminDatabase>>;
const owner = anonymousClient();
const peers: ReturnType<typeof anonymousClient>[] = [];
beforeAll(async () => {
  const local = loadLocalSupabase(); database = await adminDatabase();
  const auth = createClient(local.url, local.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `import-test-${ownerId}@example.test`, password = `Test-${randomUUID()}`;
  const made = await auth.auth.admin.createUser({ id: ownerId, email, password, email_confirm: true }); expect(made.error).toBeNull();
  await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','synthetic import regression')", [ownerId]);
  await database.query("insert into app_private.workflow_import_batches(owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$2,'synthetic',$3)", [ownerId, sourceHash, JSON.stringify(snapshot)]);
  expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
});
afterAll(async () => { await Promise.all([owner, ...peers].map(client => client.auth.signOut({ scope: 'local' }))); await database?.end(); });

test('only the current owning admin receives the private snapshot', async () => {
  const result = await owner.rpc('get_workflow_import'); expect(result.error).toBeNull(); expect(result.data.snapshot).toEqual(snapshot);
  const other = await authClient('admin_a'); peers.push(other);
  const denied = await other.rpc('get_workflow_import'); expect(denied.error).toBeNull(); expect(denied.data).toBeNull();
});
test('customer, guardian, tutor, service and anonymous callers cannot read compensation or source rows', async () => {
  for (const role of ['learner_a', 'guardian_a', 'tutor_a', 'cs_a']) {
    const client = await authClient(role); peers.push(client);
    const result = await client.rpc('get_workflow_import'); expect(result.error?.message).toBe('FORBIDDEN'); expect(result.data).toBeNull();
  }
  const result = await anonymousClient().rpc('get_workflow_import'); expect(result.error).not.toBeNull(); expect(result.data).toBeNull();
  const grants = await database.query("select has_table_privilege('authenticated','app_private.workflow_import_batches','select') allowed"); expect(grants.rows[0].allowed).toBe(false);
});
test('same-owner source identity cannot be inserted twice', async () => {
  await expect(database.query("insert into app_private.workflow_import_batches(owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$2,'synthetic',$3)", [ownerId, sourceHash, JSON.stringify(snapshot)])).rejects.toMatchObject({ code: '23505' });
  expect((await database.query('select count(*)::int n from app_private.workflow_import_batches where owner_account_id=$1', [ownerId])).rows[0].n).toBe(1);
});
test('revoked admin role immediately removes owner access on an existing session', async () => {
  await database.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='admin'", [ownerId]);
  const result = await owner.rpc('get_workflow_import'); expect(result.error?.message).toBe('FORBIDDEN'); expect(result.data).toBeNull();
});
