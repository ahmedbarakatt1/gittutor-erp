import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { adminDatabase, loadLocalSupabase } from '../helpers/supabase';
import { getApplicationSubjects, getMyAccount, getMyVerifiedContacts, getStaffInvitations, getTutorApplications, getTutorProfile } from '../../src/modules/identity/queries';
import { invokeIdentityCommand } from '../../src/modules/identity/commands';

function createActorClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
type Actor = { id: string; client: ReturnType<typeof createActorClient> };
type Result = Record<string, unknown>;

describe('T02 verified identity and current database authorization', () => {
  let database: Client;
  const actors: Record<string, Actor> = {};
  const run = randomUUID().slice(0, 8);
  const subjectId = randomUUID();

  beforeAll(async () => {
    const config = loadLocalSupabase();
    database = await adminDatabase();
    const authAdmin = createActorClient(config.url, config.secret_key);
    for (const name of ['learner_a', 'learner_b', 'guardian', 'stranger', 'admin', 'staff', 'applicant', 'inactive', 'logout', 'limited_guardian', 'pending_applicant', 'concurrent_target']) {
      const email = `identity.${run}.${name}@example.test`;
      const password = `Synthetic-${randomUUID()}!`;
      const created = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'admin', roles: ['admin', 'tutor'] } });
      if (created.error || !created.data.user) throw new Error(`AUTH_FIXTURE_FAILED:${created.error?.code}`);
      const client = createActorClient(config.url, config.publishable_key);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw new Error(`AUTH_FIXTURE_SIGNIN_FAILED:${signed.error?.code}`);
      actors[name] = { id: created.data.user.id, client };
    }
    // Bootstrap privileges only in the guarded synthetic fixture target. Missing identity schema
    // is left to the first RPC assertion so the initial RED run records the absent implementation.
    const tables = await database.query("select to_regclass('app_private.account_roles') as roles");
    if (tables.rows[0].roles) {
      await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','isolated identity test bootstrap')", [actors.admin.id]);
      await database.query("insert into app_private.subjects(id,slug,title) values($1,$2,'Synthetic calculus')", [subjectId, `calculus-${run}`]);
    }
  }, 90000);
  test('updating a verified identity preserves withdrawal from the learner workspace', async () => {
    const owner = actors.admin.id;
    await database.query('begin');
    try {
      await database.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='student' and revoked_at is null", [owner]);
      await database.query('delete from app_private.learners where account_id=$1', [owner]);
      await database.query('update auth.users set email=email where id=$1', [owner]);
      const result = await database.query(`select
        app_private.has_role($1,'admin') as admin, app_private.has_role($1,'student') as student,
        exists(select 1 from app_private.learners where account_id=$1) as learner,
        exists(select 1 from app_private.verified_contacts where account_id=$1 and revoked_at is null and verified_at is not null) as verified`, [owner]);
      expect(result.rows[0]).toEqual({ admin: true, student: false, learner: false, verified: true });
    } finally {
      await database.query('rollback');
    }
  });

  afterAll(async () => {
    await Promise.all(Object.values(actors).map(actor => actor.client.auth.signOut()));
    await database?.end();
  });
  const client = (name: string) => actors[name].client;
  async function rpc(name: string, command: string, args: Record<string, unknown> = {}): Promise<Result> {
    const { data, error } = await client(name).rpc(command, args);
    expect(error, `${command}: ${error?.message}`).toBeNull();
    expect(data).toBeTruthy();
    return data as Result;
  }
  async function identity(name: string) {
    const result = await database.query(`select l.id as learner_id,c.id as contact_id from app_private.learners l
      join app_private.verified_contacts c on c.account_id=l.account_id and c.revoked_at is null
      where l.account_id=$1`, [actors[name].id]);
    return result.rows[0] as { learner_id: string; contact_id: string };
  }
  async function invitation(learner: string, guardian = 'guardian') {
    const contact = await identity(guardian);
    const created = await rpc(learner, 'create_guardian_invitation', {
      p_contact_id: contact.contact_id, p_scopes: ['profile', 'booking', 'materials'],
      p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID(),
    });
    expect(created).not.toHaveProperty('single_use_token');
    const event = await database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [created.invitation_id]);
    return { id: created.invitation_id, token: event.rows[0].payload.single_use_token as string };
  }
  const accept = (invite: { id: unknown; token: string }, key = randomUUID()) => ({
    p_invitation_id: invite.id, p_single_use_token: invite.token, p_expected_version: 1, p_idempotency_key: key,
  });

  test('GT-1213 signup metadata cannot assign staff and customer DTO has an explicit allowlist', async () => {
    const me = await rpc('learner_a', 'get_my_account');
    expect(me.roles).toEqual(['student']);
    expect(me.verified).toBe(true);
    expect(me.account_id).toBe(actors.learner_a.id);
    expect(Object.keys(me).sort()).toEqual(['account_id', 'authorized_learner_ids', 'locale', 'roles', 'verified'].sort());
    const denied = await client('learner_a').rpc('grant_staff_role', {
      p_account_id: actors.learner_a.id, p_role: 'admin', p_reason: 'forged escalation', p_idempotency_key: randomUUID(),
    });
    expect(denied.error?.message).toContain('FORBIDDEN');
  });

  test('GT-101 GT-105 unrelated guardians and another learner cannot read learner records', async () => {
    const target = await identity('learner_a');
    for (const actor of ['stranger', 'learner_b']) {
      const denied = await client(actor).rpc('get_learner_summary', { p_learner_id: target.learner_id });
      expect(denied.error?.message).toContain('NOT_FOUND');
    }
    const own = await rpc('learner_a', 'get_learner_summary', { p_learner_id: target.learner_id });
    expect(own.learner_id).toBe(target.learner_id);
  });

  test('GT-103 GT-102 guardian links preserve two learner identities and revocation takes immediate effect', async () => {
    const first = await invitation('learner_a');
    const second = await invitation('learner_b');
    const link = await rpc('guardian', 'accept_guardian_invitation', accept(first));
    await rpc('guardian', 'accept_guardian_invitation', accept(second));
    const a = await identity('learner_a');
    const b = await identity('learner_b');
    expect(a.learner_id).not.toBe(b.learner_id);
    const me = await rpc('guardian', 'get_my_account');
    expect(me.authorized_learner_ids).toEqual(expect.arrayContaining([a.learner_id, b.learner_id]));
    await rpc('learner_a', 'revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_reason: 'withdraw consent', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const denied = await client('guardian').rpc('get_learner_summary', { p_learner_id: a.learner_id });
    expect(denied.error?.message).toContain('NOT_FOUND');
    expect((await rpc('guardian', 'get_learner_summary', { p_learner_id: b.learner_id })).learner_id).toBe(b.learner_id);
  });

  test('GT-104 invitations bind a verified recipient and reject forwarded or changed tokens', async () => {
    const invite = await invitation('learner_a');
    const forwarded = await client('stranger').rpc('accept_guardian_invitation', accept(invite));
    expect(forwarded.error?.message).toContain('NOT_FOUND');
    const wrong = await client('guardian').rpc('accept_guardian_invitation', accept({ ...invite, token: 'wrong-token' }));
    expect(wrong.error?.message).toContain('NOT_FOUND');
    const key = randomUUID();
    const once = await rpc('guardian', 'accept_guardian_invitation', accept(invite, key));
    const again = await rpc('guardian', 'accept_guardian_invitation', accept(invite, key));
    expect(again).toEqual(once);
    const reused = await client('guardian').rpc('accept_guardian_invitation', accept(invite));
    expect(reused.error?.message).toMatch(/VERSION_CONFLICT|STATE_CONFLICT/);
  });

  test('GT-104 expired invitations confer no relationship', async () => {
    const invite = await invitation('learner_a', 'stranger');
    await database.query("update app_private.guardian_invitations set expires_at=now()-interval '1 second' where id=$1", [invite.id]);
    const result = await client('stranger').rpc('accept_guardian_invitation', accept(invite));
    expect(result.error?.message).toContain('NOT_FOUND');
  });

  test('GT-106 role revocation checks current membership before idempotent replay', async () => {
    const grant = await rpc('admin', 'grant_staff_role', { p_account_id: actors.staff.id, p_role: 'admin', p_reason: 'temporary synthetic duty', p_idempotency_key: randomUUID() });
    const args = { p_account_id: actors.stranger.id, p_role: 'customer_service', p_reason: 'synthetic assignment', p_idempotency_key: randomUUID() };
    await rpc('staff', 'grant_staff_role', args);
    await rpc('admin', 'revoke_staff_role', { p_role_grant_id: grant.role_grant_id, p_reason: 'end duty', p_expected_version: 1, p_idempotency_key: randomUUID() });
    expect((await client('staff').rpc('grant_staff_role', args)).error?.message).toContain('FORBIDDEN');
    expect((await rpc('staff', 'get_my_account')).roles).not.toContain('admin');
  });

  test('GT-106 disabled application accounts immediately reject an existing Auth token', async () => {
    await database.query('update app_private.accounts set active=false where id=$1', [actors.inactive.id]);
    expect((await client('inactive').rpc('get_my_account')).error?.message).toContain('SESSION_REVOKED');
  });

  test('GT-1213 a revoked Auth session cannot reuse its unexpired JWT', async () => {
    const signed = await client('logout').auth.getSession();
    const token = signed.data.session!.access_token;
    const sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id as string;
    await database.query('delete from auth.sessions where id=$1 and user_id=$2', [sessionId, actors.logout.id]);
    const config = loadLocalSupabase();
    const response = await fetch(`${config.url}/rest/v1/rpc/get_my_account`, { method: 'POST', headers: {
      apikey: config.publishable_key, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'api',
    }, body: '{}' });
    expect(response.ok).toBe(false);
    expect((await response.json()).message).toContain('SESSION_REVOKED');
  });

  test('GT-1213 direct private reads and extra writable RPC properties fail closed', async () => {
    const privateRead = await client('learner_a').schema('app_private').from('account_roles').select('*');
    expect(privateRead.error).toBeTruthy();
    const spoofed = await client('learner_a').rpc('get_my_account', { p_actor_id: actors.admin.id });
    expect(spoofed.error).toBeTruthy();
  });

  test('GT-1607 pending tutor applications grant nothing; reviewed approval grants tutor once with audit', async () => {
    const profile = await identity('applicant');
    const args = { p_display_name: 'Synthetic applicant', p_subject_ids: [subjectId], p_bio: 'Synthetic teaching profile for calculus.', p_contact_id: profile.contact_id, p_idempotency_key: randomUUID() };
    const application = await rpc('applicant', 'submit_tutor_application', args);
    expect((await rpc('applicant', 'get_my_account')).roles).toEqual(['student']);
    const review = { p_application_id: application.application_id, p_decision: 'approved', p_reason: 'verified synthetic qualifications', p_approved_subject_ids: [subjectId], p_expected_version: 1, p_idempotency_key: randomUUID() };
    expect((await client('applicant').rpc('review_tutor_application', review)).error?.message).toContain('FORBIDDEN');
    const approved = await rpc('admin', 'review_tutor_application', review);
    expect(approved.tutor_id).toBeTruthy();
    expect(await rpc('admin', 'review_tutor_application', review)).toEqual(approved);
    expect((await rpc('applicant', 'get_my_account')).roles).toContain('tutor');
    const count = await database.query("select count(*)::int as count from app_private.account_roles where account_id=$1 and role='tutor' and revoked_at is null", [actors.applicant.id]);
    expect(count.rows[0].count).toBe(1);
    const audit = await database.query("select action from app_private.audit_events where aggregate_id in ($1,$2)", [application.application_id, approved.tutor_id]);
    expect(audit.rows.map(row => row.action)).toContain('tutor_application_reviewed');
  });

  test('GT-1607 idempotency conflicts reject changed arguments and tutor profile edits enforce versions', async () => {
    const profile = await identity('applicant');
    const tutor = await rpc('applicant', 'get_tutor_profile');
    const args = { p_display_name: 'Synthetic tutor', p_bio: 'A revised biography awaiting review.', p_subject_ids: [subjectId], p_contact_id: profile.contact_id, p_locale: 'en', p_expected_version: tutor.version, p_idempotency_key: randomUUID() };
    const updated = await rpc('applicant', 'update_tutor_profile', args);
    expect(updated.review_required_fields).toEqual(['display_name', 'bio', 'subject_ids']);
    expect(await rpc('applicant', 'update_tutor_profile', args)).toEqual(updated);
    expect((await client('applicant').rpc('update_tutor_profile', { ...args, p_bio: 'different request' })).error?.message).toContain('IDEMPOTENCY_CONFLICT');
    expect((await client('applicant').rpc('update_tutor_profile', { ...args, p_idempotency_key: randomUUID() })).error?.message).toContain('VERSION_CONFLICT');
  });

  test('T02 query wrappers parse actual allowlists and ordinary contacts remain private', async () => {
    const contacts = await getMyVerifiedContacts(client('learner_a'));
    expect(contacts.items).toHaveLength(1);
    expect(contacts.items[0].contact_id).toBe((await identity('learner_a')).contact_id);
    expect(contacts.items[0].masked_destination).not.toContain(`identity.${run}`);
    expect((await getMyAccount(client('learner_a')))).toHaveProperty('account_id', actors.learner_a.id);
    expect((await getApplicationSubjects(client('learner_a'))).items).toContainEqual({ subject_id: subjectId, title: 'Synthetic calculus' });
    expect((await getTutorProfile(client('applicant'))).approved_profile).toBeNull();
    const config = loadLocalSupabase();
    const anonymous = createActorClient(config.url, config.publishable_key);
    expect((await anonymous.rpc('get_my_verified_contacts')).error).toBeTruthy();
    expect((await anonymous.rpc('list_application_subjects')).error).toBeTruthy();
    const service = createActorClient(config.url, config.secret_key);
    expect((await service.rpc('get_my_account')).error).toBeTruthy();
  });

  test('GT-104 consent scope, expiry and revoked invitation replay are rechecked', async () => {
    const contact = await identity('limited_guardian');
    const created = await rpc('learner_b', 'create_guardian_invitation', {
      p_contact_id: contact.contact_id, p_scopes: ['booking'], p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID(),
    });
    const event = await database.query('select payload from app_private.domain_events where id=$1', [created.command_id]);
    const args = accept({ id: created.invitation_id, token: event.rows[0].payload.single_use_token });
    const link = await rpc('limited_guardian', 'accept_guardian_invitation', args);
    const target = await identity('learner_b');
    expect((await client('limited_guardian').rpc('get_learner_summary', { p_learner_id: target.learner_id })).error?.message).toContain('NOT_FOUND');
    await rpc('learner_b', 'revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_expected_version: 1, p_reason: 'scope withdrawn', p_idempotency_key: randomUUID() });
    expect((await client('limited_guardian').rpc('accept_guardian_invitation', args)).error?.message).toContain('CONSENT_REQUIRED');
  });

  test('GT-1213 direct RPC null, duplicate and unapproved subject inputs cannot commit', async () => {
    const own = await identity('pending_applicant');
    const args = { p_display_name: 'Another synthetic applicant', p_bio: 'Synthetic profile requiring approved subjects.', p_contact_id: own.contact_id, p_idempotency_key: randomUUID() };
    const count = async () => (await database.query('select count(*)::int as count from app_private.command_results where actor_account_id=$1', [actors.pending_applicant.id])).rows[0].count;
    const before = await count();
    for (const subjects of [null, [], [randomUUID()], [subjectId, subjectId]]) {
      expect((await client('pending_applicant').rpc('submit_tutor_application', { ...args, p_subject_ids: subjects })).error).toBeTruthy();
    }
    expect((await client('pending_applicant').rpc('submit_tutor_application', { ...args, p_subject_ids: [subjectId], p_contact_id: null })).error).toBeTruthy();
    expect((await client('pending_applicant').rpc('submit_tutor_application', { ...args, p_subject_ids: [subjectId], p_idempotency_key: null })).error).toBeTruthy();
    expect(await count()).toBe(before);
  });

  test('T02 reviewed applications leave the admin pending queue; own history remains accessible with stable pages', async () => {
    const own = await identity('pending_applicant');
    const args = { p_display_name: 'Pending synthetic applicant', p_bio: 'Synthetic profile awaiting qualification review.', p_contact_id: own.contact_id, p_subject_ids: [subjectId], p_idempotency_key: randomUUID() };
    const pending = await invokeIdentityCommand(client('pending_applicant'), 'submit_tutor_application', args);
    const ownHistory = await getTutorApplications(client('applicant'));
    expect(ownHistory.items).toHaveLength(1);
    expect(ownHistory.items[0].state).toBe('approved');
    expect((await getTutorApplications(client('learner_a'))).items).toEqual([]);
    const page = await getTutorApplications(client('admin'), { limit: 1 });
    expect(page.items.every(item => item.state === 'pending')).toBe(true);
    expect((await getTutorApplications(client('pending_applicant'))).items[0].application_id).toBe(pending.resource_id);
    if (page.next_cursor) {
      const next = await getTutorApplications(client('admin'), { limit: 1, cursor: page.next_cursor });
      expect(next.items[0].application_id).not.toBe(page.items[0].application_id);
    }
    expect((await client('admin').rpc('get_tutor_applications', { p_limit: 101 })).error?.message).toContain('VALIDATION_ERROR');
    expect((await client('admin').rpc('get_tutor_applications', { p_cursor: 'forged' })).error?.message).toContain('VALIDATION_ERROR');
  });

  test('T02 an active tutor edits their profile instead of creating another onboarding application', async () => {
    const own = await identity('applicant');
    const result = await client('applicant').rpc('submit_tutor_application', { p_display_name: 'Duplicate tutor', p_bio: 'Already has an approved teaching identity.', p_contact_id: own.contact_id, p_subject_ids: [subjectId], p_idempotency_key: randomUUID() });
    expect(result.error?.message).toContain('STATE_CONFLICT');
  });

  test('T02 independent database requests replay one durable grant and conflicting profile versions permit one edit', async () => {
    const args = { p_account_id: actors.concurrent_target.id, p_role: 'customer_service', p_reason: 'concurrent synthetic assignment', p_idempotency_key: randomUUID() };
    const responses = await Promise.all([client('admin').rpc('grant_staff_role', args), client('admin').rpc('grant_staff_role', args)]);
    expect(responses.map(result => result.error)).toEqual([null, null]);
    expect(responses[0].data).toEqual(responses[1].data);
    const saved = await database.query('select count(*)::int as count from app_private.command_results where actor_account_id=$1 and idempotency_key=$2', [actors.admin.id, args.p_idempotency_key]);
    expect(saved.rows[0].count).toBe(1);
    const tutor = await getTutorProfile(client('applicant'));
    const update = { p_display_name: 'Concurrent tutor', p_bio: 'Concurrent profile changes retain version checks.', p_contact_id: (await identity('applicant')).contact_id, p_subject_ids: [subjectId], p_locale: 'en', p_expected_version: tutor.version };
    const edits = await Promise.all([client('applicant').rpc('update_tutor_profile', { ...update, p_idempotency_key: randomUUID() }), client('applicant').rpc('update_tutor_profile', { ...update, p_idempotency_key: randomUUID() })]);
    expect(edits.filter(result => !result.error)).toHaveLength(1);
    expect(edits.find(result => result.error)?.error?.message).toContain('VERSION_CONFLICT');
  });

  test('T02 staff invitations commit before dispatch and never expose token or full email to queue reads', async () => {
    const args = { p_email: `identity.${run}.prospective@example.test`, p_role: 'customer_service' as const, p_reason: 'synthetic prospective staff', p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() };
    expect((await client('learner_a').rpc('create_staff_invitation', args)).error?.message).toContain('FORBIDDEN');
    const invite = await invokeIdentityCommand(client('admin'), 'create_staff_invitation', args);
    expect(await invokeIdentityCommand(client('admin'), 'create_staff_invitation', args)).toEqual(invite);
    expect((await client('stranger').rpc('accept_staff_invitation', { p_invitation_id: invite.resource_id, p_expected_version: 1, p_idempotency_key: randomUUID() })).error?.message).toContain('NOT_FOUND');
    const queued = await database.query('select d.event_type,j.purpose from app_private.domain_events d join app_private.outbox_jobs j on j.event_id=d.id where d.id=$1', [invite.command_id]);
    expect(queued.rows).toEqual([{ event_type: 'staff_invitation_created', purpose: 'identity.staff_invitation' }]);
    let cursor: string | null = null;
    let found = false;
    do {
      const queue = await getStaffInvitations(client('admin'), { cursor, limit: 100 });
      expect(JSON.stringify(queue)).not.toContain(args.p_email);
      found = queue.items.some(item => item.invitation_id === invite.resource_id);
      cursor = queue.next_cursor;
    } while (!found && cursor);
    expect(found).toBe(true);
    expect((await client('learner_a').rpc('list_staff_invitations')).error?.message).toContain('FORBIDDEN');
    const existingEmail = (await client('learner_a').auth.getUser()).data.user!.email!;
    expect((await client('admin').rpc('create_staff_invitation', { ...args, p_email: existingEmail, p_idempotency_key: randomUUID() })).error?.message).toContain('STATE_CONFLICT');
  });

  test('GT-1213 grants retain private RLS ownership and Auth bridges cannot be called by user roles', async () => {
    const roles = await database.query("select rolname,rolcanlogin,rolbypassrls from pg_roles where rolname in ('git_tutor_commands','git_tutor_identity_sync','git_tutor_workflow_reader','git_tutor_operational_reader')");
    expect(roles.rows).toHaveLength(4);
    expect(roles.rows.every(row => !row.rolcanlogin && !row.rolbypassrls)).toBe(true);
    const privileges = await database.query(`select
      has_function_privilege('authenticated','app_private.auth_account(uuid)','EXECUTE') as auth_bridge,
      has_table_privilege('authenticated','app_private.accounts','SELECT') as accounts,
      has_table_privilege('git_tutor_commands','app_private.command_results','UPDATE') as update_results,
      has_table_privilege('git_tutor_worker','app_private.staff_invitations','SELECT') as worker_table`);
    expect(privileges.rows[0]).toEqual({ auth_bridge: false, accounts: false, update_results: false, worker_table: false });
    const functions = await database.query("select p.oid::regprocedure::text signature,p.proname,p.proconfig,r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='api'");
    const readOwners: Record<string,string> = { 'api.get_workflow_import()': 'git_tutor_workflow_reader', 'api.get_workflow_operations()': 'git_tutor_operational_reader', 'api.get_workspace_operations(text)': 'git_tutor_operational_reader' };
    expect(functions.rows.length).toBeGreaterThan(0);
    expect(functions.rows.every(row => row.rolname === (readOwners[row.signature] ?? 'git_tutor_commands') && row.proconfig.includes('search_path=""'))).toBe(true);
  });

  test('T02 creation, durable queuing and replay retain transport status without expanding result DTOs', async () => {
    const grantArgs = { p_account_id: actors.concurrent_target.id, p_role: 'tutor', p_reason: 'transport status fixture', p_idempotency_key: randomUUID() };
    const created = await client('admin').rpc('grant_staff_role', grantArgs);
    expect(created.error).toBeNull();
    expect(created.status).toBe(201);
    const replay = await client('admin').rpc('grant_staff_role', grantArgs);
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(created.data);
    const queued = await client('admin').rpc('create_staff_invitation', { p_email: `identity.${run}.status@example.test`, p_role: 'customer_service', p_reason: 'transport status fixture', p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() });
    expect(queued.error).toBeNull();
    expect(queued.status).toBe(202);
  });

  test('T02 reapproving a revoked tutor preserves immutable drafts and advances the profile version', async () => {
    const previous = await getTutorProfile(client('applicant'));
    const role = (await database.query("select id,version from app_private.account_roles where account_id=$1 and role='tutor' and revoked_at is null", [actors.applicant.id])).rows[0];
    await rpc('admin', 'revoke_staff_role', { p_role_grant_id: role.id, p_expected_version: role.version, p_reason: 'synthetic requalification', p_idempotency_key: randomUUID() });
    const submitted = await rpc('applicant', 'submit_tutor_application', { p_display_name: 'Requalified synthetic tutor', p_bio: 'New qualifications for a previously revoked tutor.', p_contact_id: (await identity('applicant')).contact_id, p_subject_ids: [subjectId], p_idempotency_key: randomUUID() });
    await rpc('admin', 'review_tutor_application', { p_application_id: submitted.resource_id, p_decision: 'approved', p_reason: 'new qualifications reviewed', p_approved_subject_ids: [subjectId], p_expected_version: 1, p_idempotency_key: randomUUID() });
    const current = await getTutorProfile(client('applicant'));
    expect(current.tutor_id).toBe(previous.tutor_id);
    expect(current.version).toBe(previous.version + 1);
    expect(current.draft_profile_version_id).not.toBe(previous.draft_profile_version_id);
    const preserved = (await database.query('select display_name,version from app_private.tutor_profile_versions where id=$1', [previous.draft_profile_version_id])).rows[0];
    expect(preserved).toEqual({ display_name: previous.display_name, version: previous.version });
  });

  test('T02 guardian management reads expose current scoped links and server-owned revoke versions', async () => {
    const owner = await rpc('learner_b', 'get_my_guardian_links', { p_limit: 100 });
    const items = owner.items as Result[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ learner_id: (await identity('learner_b')).learner_id, can_revoke: true, version: 1 });
    expect(Object.keys(items[0]).sort()).toEqual(['guardian_link_id', 'learner_id', 'learner_name', 'guardian_masked_contact', 'scopes', 'version', 'can_revoke'].sort());
    expect(items[0].guardian_masked_contact).not.toContain(`identity.${run}`);
    const guardian = await rpc('guardian', 'get_my_guardian_links', { p_limit: 1 });
    expect((guardian.items as Result[])).toHaveLength(1);
    expect((guardian.items as Result[])[0].can_revoke).toBe(false);
    expect(guardian.next_cursor).toBeTypeOf('string');
    const next = await rpc('guardian', 'get_my_guardian_links', { p_limit: 1, p_cursor: guardian.next_cursor });
    expect((next.items as Result[])[0].guardian_link_id).not.toBe((guardian.items as Result[])[0].guardian_link_id);
    expect((await rpc('limited_guardian', 'get_my_guardian_links')).items).toEqual([]);
    expect((await rpc('stranger', 'get_my_guardian_links')).items).toEqual([]);
    expect((await client('guardian').rpc('get_my_guardian_links', { p_account_id: actors.learner_b.id })).error).toBeTruthy();
  });

  test('T02 staff role management reads are current-admin only, paginated and omit inactive grants', async () => {
    expect((await client('learner_a').rpc('list_staff_role_grants')).error?.message).toContain('FORBIDDEN');
    expect((await client('staff').rpc('list_staff_role_grants')).error?.message).toContain('FORBIDDEN');
    let cursor: string | null = null;
    const all: Result[] = [];
    do {
      const page = await rpc('admin', 'list_staff_role_grants', { p_limit: 100, p_cursor: cursor });
      all.push(...page.items as Result[]);
      cursor = page.next_cursor as string | null;
    } while (cursor);
    expect(all.some(item => item.account_id === actors.concurrent_target.id && item.role === 'customer_service')).toBe(true);
    expect(all.some(item => item.account_id === actors.staff.id && item.role === 'admin')).toBe(false);
    expect(Object.keys(all[0]).sort()).toEqual(['role_grant_id', 'account_id', 'display_name', 'masked_email', 'role', 'version'].sort());
    expect(all.every(item => !String(item.masked_email).includes(`identity.${run}`))).toBe(true);
    expect((await client('admin').rpc('list_staff_role_grants', { p_limit: 101 })).error?.message).toContain('VALIDATION_ERROR');
  });
});
