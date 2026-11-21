import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from '../helpers/supabase';
import { workflowOperationsSchema, type WorkflowOperationsData } from '../../src/modules/workflow-import/operational-model';

const ownerId = randomUUID(), batchId = randomUUID(), unresolvedId = randomUUID(), guardianId = randomUUID(), guardianLinkId = randomUUID();
const hash = createHash('sha256').update(batchId).digest('hex');
const table = (rows: Array<Record<string, string | number | null>>) => ({ columns: [], rows: rows.map((values, index) => ({ source_row: index + 2, values, issues: [] })) });
const snapshot = { version: 1, source_sha256: hash, source_name: 'synthetic-operations.xlsx', as_of: null, courses: ['Synthetic course'], tables: {
  sessions: table([
    { col_a: '2026-10-20', col_e: 'Synthetic learner A', col_f: 'Synthetic course', col_h: 'Synthetic tutor A', col_i: 'Completed', col_q: 10000, col_ad: 4500, col_w: 1500, col_ae: 3000, col_j: 'CONFIDENTIAL_SOURCE_NOTE' },
    { col_a: '2026-10-21', col_e: 'Synthetic learner B', col_f: 'Synthetic course', col_h: 'Synthetic tutor B', col_i: 'Scheduled', col_q: 11000, col_ad: 4600 },
    { col_a: null, col_e: 'Unresolved synthetic name', col_f: 'Synthetic course', col_h: 'Unresolved synthetic tutor', col_i: 'Completed', col_ad: 4700 },
  ]),
  students: table([{ col_a: 'Synthetic learner A', col_e: 'source-a@example.test' }, { col_a: 'Synthetic learner B', col_e: 'source-b@example.test' }]),
  tutors: table([{ col_a: 'Synthetic tutor A', col_c: 4500 }, { col_a: 'Synthetic tutor B', col_c: 4600 }]),
  packages: table([]), marketing: table([]), distributions: table([]), balances: table([]),
} };
let database: Awaited<ReturnType<typeof adminDatabase>>;
let learnerId: string, tutorId: string;
const owner = anonymousClient(), guardian = anonymousClient(), clients: ReturnType<typeof anonymousClient>[] = [];
let customer: ReturnType<typeof anonymousClient>, tutor: ReturnType<typeof anonymousClient>, service: ReturnType<typeof anonymousClient>, otherAdmin: ReturnType<typeof anonymousClient>;
const enabled = (data: WorkflowOperationsData) => { if (!data.enabled) throw new Error('Expected enabled synthetic view'); return data; };
beforeAll(async () => {
  database = await adminDatabase(); const local = loadLocalSupabase();
  const auth = createClient(local.url, local.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `operations-owner-${ownerId}@example.test`, password = `Test-${randomUUID()}`;
  expect((await auth.auth.admin.createUser({ id: ownerId, email, password, email_confirm: true })).error).toBeNull();
  await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','Synthetic workbook operations regression')", [ownerId]);
  await database.query("insert into app_private.workflow_import_batches(id,owner_account_id,source_sha256,content_sha256,source_kind,snapshot) values($1,$2,$3,$3,'synthetic',$4)", [batchId, ownerId, hash, JSON.stringify(snapshot)]);
  const ids = async (kind: 'learners' | 'tutors', label: string) => (await database.query(`select id from app_private.${kind} where account_id=$1`, [local.actors[label].id])).rows[0].id as string;
  learnerId = await ids('learners', 'learner_a'); tutorId = await ids('tutors', 'tutor_a');
  const guardianEmail = `operations-guardian-${guardianId}@example.test`, guardianPassword = `Test-${randomUUID()}`;
  expect((await auth.auth.admin.createUser({ id: guardianId, email: guardianEmail, password: guardianPassword, email_confirm: true })).error).toBeNull();
  await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'guardian','Synthetic scoped guardian regression')", [guardianId]);
  const invitationId = randomUUID();
  await database.query("insert into app_private.guardian_invitations(id,learner_id,recipient_account_id,contact_id,scopes,token_hash,expires_at,accepted_at) select $1,$2,$3,id,array['booking'],$4,now()+interval '1 hour',now() from app_private.verified_contacts where account_id=$3 and channel='email' and revoked_at is null", [invitationId, learnerId, guardianId, hash]);
  await database.query("insert into app_private.guardian_links(id,guardian_account_id,learner_id,invitation_id,scopes,valid_until) values($1,$2,$3,$4,array['booking'],now()+interval '1 hour')", [guardianLinkId, guardianId, learnerId, invitationId]);
  expect((await guardian.auth.signInWithPassword({ email: guardianEmail, password: guardianPassword })).error).toBeNull();
  const learnerB = await ids('learners', 'learner_b'), tutorB = await ids('tutors', 'tutor_b');
  for (const [source, row, learner, teacher] of [['students', 2, learnerId, null], ['students', 3, learnerB, null], ['tutors', 2, null, tutorId], ['tutors', 3, null, tutorB], ['sessions', 2, learnerId, tutorId], ['sessions', 3, learnerB, tutorB]] as const) {
    await database.query("insert into app_private.operational_workbook_links(batch_id,source_table,source_row,learner_id,tutor_id,review_state) values($1,$2,$3,$4,$5,'linked')", [batchId, source, row, learner, teacher]);
  }
  await database.query("insert into app_private.operational_workbook_links(id,batch_id,source_table,source_row) values($1,$2,'sessions',4)", [unresolvedId, batchId]);
  await database.query('insert into app_private.operational_workbook_access(batch_id,account_id,created_by) values($1,$2,$3)', [batchId, local.actors.cs_a.id, ownerId]);
  expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
  [customer, tutor, service, otherAdmin] = await Promise.all(['learner_a', 'tutor_a', 'cs_a', 'admin_a'].map(authClient)); clients.push(customer, tutor, service, otherAdmin);
});
afterAll(async () => { await Promise.all([owner, guardian, ...clients].map(client => client.auth.signOut({ scope: 'local' }))); await database?.end(); });

test('owner gets source records and mapping options; unrelated admin and anonymous get no batch', async () => {
  const result = await owner.rpc('get_workflow_operations'); expect(result.error).toBeNull();
  const view = enabled(workflowOperationsSchema.parse(result.data)); expect(view.role).toBe('owner');
  expect(view.mapping_options.learners).toHaveLength(2); expect(view.sections.find(s => s.key === 'sessions')?.records).toHaveLength(3);
  expect(view.sections.find(s => s.key === 'overview')?.metrics.find(m => m.key === 'source_students')?.value).toBe(2);
  expect(view.sections.find(s => s.key === 'sessions')?.metrics.find(m => m.key === 'completed_sessions')?.value).toBe(2);
  expect(view.sections.find(s => s.key === 'customers')?.records[0].actions[0].href).toMatch(/^\/admin\/customers\?learner=/);
  const outsider = await otherAdmin.rpc('get_workflow_operations'); expect(outsider.error).toBeNull(); expect(outsider.data).toEqual({ enabled: false });
  expect((await anonymousClient().rpc('get_workflow_operations')).error).not.toBeNull();
});
test('customer and service responses exclude compensation and source notes at the database boundary', async () => {
  for (const [client, role, count] of [[customer, 'customer', 1], [service, 'service', 3]] as const) {
    const result = await client.rpc('get_workflow_operations'); expect(result.error).toBeNull();
    const view = enabled(workflowOperationsSchema.parse(result.data)); expect(view.role).toBe(role);
    expect(view.sections.find(s => s.key === 'sessions')?.records).toHaveLength(count);
    expect(JSON.stringify(result.data)).not.toMatch(/CONFIDENTIAL_SOURCE_NOTE|tutor_fee|tutor_rate|google_account/);
    expect(view.mapping_options).toEqual({ learners: [], tutors: [] });
  }
});
test('tutors see only assigned history and their own reported fees', async () => {
  const result = await tutor.rpc('get_workflow_operations'); expect(result.error).toBeNull();
  const view = enabled(workflowOperationsSchema.parse(result.data)); expect(view.role).toBe('tutor');
  const rows = view.sections.find(s => s.key === 'sessions')!.records; expect(rows).toHaveLength(1);
  expect(rows[0].fields.find(f => f.key === 'tutor_fee_due_minor')?.value).toBe(4500);
  expect(JSON.stringify(result.data)).not.toMatch(/Synthetic learner B|CONFIDENTIAL_SOURCE_NOTE|tuition_minor|source-a@example/);
});
test('a service worker who is also a guardian gets separate service and family workbook views', async () => {
  await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'customer_service','Synthetic multi-role regression')", [guardianId]);
  await database.query('insert into app_private.operational_workbook_access(batch_id,account_id,created_by) values($1,$2,$3)', [batchId, guardianId, ownerId]);
  try {
    const staff = await guardian.rpc('get_workspace_operations', { p_workspace: 'service' });
    expect(staff.error).toBeNull();
    const staffView = enabled(workflowOperationsSchema.parse(staff.data));
    expect(staffView.role).toBe('service');
    expect(staffView.sections.find(s => s.key === 'sessions')?.records).toHaveLength(3);
    const family = await guardian.rpc('get_workspace_operations', { p_workspace: 'learn' });
    expect(family.error).toBeNull();
    const familyView = enabled(workflowOperationsSchema.parse(family.data));
    expect(familyView.role).toBe('customer');
    expect(familyView.sections.find(s => s.key === 'sessions')?.records).toHaveLength(1);
    expect(JSON.stringify(familyView)).not.toMatch(/Synthetic learner B|tuition_minor|tutor_fee|CONFIDENTIAL_SOURCE_NOTE/);
    const ownerRead = await guardian.rpc('get_workspace_operations', { p_workspace: 'admin' });
    expect(ownerRead.error?.message).toBe('FORBIDDEN');
    expect((await anonymousClient().rpc('get_workspace_operations', { p_workspace: 'learn' })).error).not.toBeNull();
  } finally {
    await database.query('delete from app_private.operational_workbook_access where batch_id=$1 and account_id=$2', [batchId, guardianId]);
    await database.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='customer_service' and revoked_at is null", [guardianId]);
  }
});
test('guardian booking-only scope excludes financial fields and revocation removes history immediately', async () => {
  const result = await guardian.rpc('get_workflow_operations'); expect(result.error).toBeNull();
  const view = enabled(workflowOperationsSchema.parse(result.data)); expect(view.role).toBe('customer');
  expect(view.sections.find(s => s.key === 'sessions')?.records).toHaveLength(1);
  expect(view.sections.find(s => s.key === 'customers')?.records).toHaveLength(0);
  expect(JSON.stringify(result.data)).not.toMatch(/tuition_minor|collected_minor|student_balance_minor|tutor_fee/);
  await database.query("update app_private.guardian_links set revoked_at=now(),revoked_by=$2,revocation_reason='Synthetic scope test' where id=$1", [guardianLinkId, ownerId]);
  expect((await guardian.rpc('get_workflow_operations')).data).toEqual({ enabled: false });
});
test('owner mapping reviews are versioned, idempotent and create no financial or attendance records', async () => {
  const before = (await database.query('select (select count(*) from finance_private.ledger_transactions) ledger,(select count(*) from app_private.completions) completions')).rows[0];
  const args = { p_link_id: unresolvedId, p_expected_version: 1, p_review_state: 'reviewed', p_links: { learner_id: learnerId, tutor_id: tutorId }, p_reason: 'Synthetic reviewed identity mapping only', p_idempotency_key: randomUUID() };
  expect((await otherAdmin.rpc('review_workflow_operation', args)).error?.message).toBe('FORBIDDEN');
  expect((await customer.rpc('review_workflow_operation', args)).error?.message).toBe('FORBIDDEN');
  const result = await owner.rpc('review_workflow_operation', args); expect(result.error).toBeNull(); expect(result.data).toEqual({ link_id: unresolvedId, version: 2, review_state: 'reviewed' });
  expect((await owner.rpc('review_workflow_operation', args)).data).toEqual(result.data);
  expect((await owner.rpc('review_workflow_operation', { ...args, p_reason: 'Changed request' })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
  expect((await owner.rpc('review_workflow_operation', { ...args, p_idempotency_key: randomUUID() })).error?.message).toBe('VERSION_CONFLICT');
  const view = enabled(workflowOperationsSchema.parse((await customer.rpc('get_workflow_operations')).data)); expect(view.sections.find(s => s.key === 'sessions')?.records).toHaveLength(2);
  const after = (await database.query('select (select count(*) from finance_private.ledger_transactions) ledger,(select count(*) from app_private.completions) completions')).rows[0]; expect(after).toEqual(before);
  expect((await database.query('select count(*)::int n from app_private.operational_workbook_reviews where link_id=$1', [unresolvedId])).rows[0].n).toBe(1);
});
test('current membership revocation and raw-table denial apply immediately', async () => {
  await database.query('delete from app_private.operational_workbook_access where batch_id=$1', [batchId]);
  expect((await service.rpc('get_workflow_operations')).data).toEqual({ enabled: false });
  await database.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='admin' and revoked_at is null", [ownerId]);
  expect((await owner.rpc('get_workflow_operations')).data).toEqual({ enabled: false });
  expect((await owner.rpc('review_workflow_operation', { p_link_id: unresolvedId, p_expected_version: 2, p_review_state: 'reviewed', p_links: {}, p_reason: 'Denied revoked owner', p_idempotency_key: randomUUID() })).error?.message).toBe('FORBIDDEN');
  const grants = await database.query("select has_table_privilege('authenticated','app_private.operational_workbook_links','select') links,has_table_privilege('authenticated','app_private.operational_workbook_reviews','insert') reviews"); expect(grants.rows[0]).toEqual({ links: false, reviews: false });
});
