import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { adminDatabase, anonymousClient, loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { staffInvitationHandler } from '../../src/worker/auth-invitations';

type MailSearch = { messages: { ID: string; To: { Address: string }[] }[] };
async function mailFor(email: string) {
  const response = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!response.ok) throw new Error('LOCAL_MAIL_READ_FAILED');
  return ((await response.json()) as MailSearch).messages.filter(message => message.To.some(to => to.Address === email));
}

test('durable staff invitation reconciles a crashed worker without resending and grants access only after verified acceptance', async () => {
  const database = await adminDatabase();
  const config = loadLocalSupabase();
  if (!config.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  const worker = new Pool({ connectionString: config.worker_database_url, max: 2 });
  const admin = anonymousClient();
  const recipient = anonymousClient();
  try {
    const run = randomUUID();
    const email = `invitation.worker.${run}@example.test`;
    const adminEmail = `invitation.approver.${run}@example.test`;
    const password = `Synthetic-${randomUUID()}!`;
    const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
    const created = await provider.auth.admin.createUser({ email: adminEmail, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`AUTH_FIXTURE_FAILED:${created.error?.code || 'NO_USER'}`);
    await database.query("insert into app_private.account_roles(account_id,role,reason) values($1,'admin','isolated mail worker test bootstrap')", [created.data.user.id]);
    expect((await admin.auth.signInWithPassword({ email: adminEmail, password })).error?.code).toBeUndefined();
    const args = { p_email: email, p_role: 'customer_service', p_reason: 'Synthetic staff invitation worker test', p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_idempotency_key: randomUUID() };
    const invitation = await admin.rpc('create_staff_invitation', args);
    expect(invitation.error?.message).toBeUndefined();
    const id = invitation.data.invitation_id as string;
    const replay = await admin.rpc('create_staff_invitation', args);
    expect(replay.error?.message).toBeUndefined();
    expect(replay.data.invitation_id).toBe(id);
    expect((await database.query('select count(*)::int as count from auth.users where email=$1', [email])).rows[0].count).toBe(0);
    const queued = await database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='identity.staff_invitation'", [id]);
    expect(queued.rows).toHaveLength(1);
    const jobId = queued.rows[0].id as string;
    // Lock unrelated invitation jobs briefly. SKIP LOCKED claims only this test's job,
    // preserving the payload, purpose, states and leases of existing synthetic fixtures.
    async function claimOwn() {
      await database.query('begin');
      try {
        await database.query("select id from app_private.outbox_jobs where purpose='identity.staff_invitation' and id<>$1 for update", [jobId]);
        return await claimJobs(worker, 'identity.staff_invitation', 1, 60);
      } finally { await database.query('rollback'); }
    }
    const first = await claimOwn();
    expect(first.map(job => job.id)).toEqual([jobId]);
    expect(first[0].attempt_count).toBe(1);
    const handler = staffInvitationHandler(worker);
    const providerId = await handler.execute(first[0]);
    expect(typeof providerId).toBe('string');
    // Simulate process death after Auth accepted the send but before outbox completion.
    await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
    const second = await claimOwn();
    expect(second.map(job => job.id)).toEqual([jobId]);
    expect(second[0].attempt_count).toBe(2);
    expect(await executeLeasedJob(worker, second[0], handler)).toBe('completed');
    expect(await handler.execute(second[0])).toBe(providerId);
    const job = (await database.query('select state,attempt_count,provider_reference from app_private.outbox_jobs where id=$1', [jobId])).rows[0];
    expect(job).toEqual({ state: 'completed', attempt_count: 2, provider_reference: providerId });
    await expect.poll(async () => (await mailFor(email)).length).toBe(1);
    const messages = await mailFor(email);
    const mail = await fetch(`http://127.0.0.1:54324/api/v1/message/${messages[0].ID}`);
    const content = await mail.json() as { HTML: string; Text: string };
    const href = content.HTML.match(/href="([^"]+\/auth\/callback[^\"]+)"/)?.[1]?.replaceAll('&amp;', '&');
    if (!href) throw new Error('EXPECTED_LOCAL_INVITATION_LINK');
    const link = new URL(href);
    expect(link.origin).toBe('http://127.0.0.1:3000');
    expect(link.pathname).toBe('/auth/callback');
    expect(link.searchParams.get('type')).toBe('invite');
    expect(link.searchParams.get('staff_invitation_id')).toBe(id);
    expect(JSON.stringify(content).match(/tutor_fee|margin_minor|payout_destination|internal_notes/)).toBeNull();
    expect((await database.query('select count(*)::int as count from auth.users where email=$1', [email])).rows[0].count).toBe(1);
    expect((await database.query("select count(*)::int as count from app_private.account_roles where account_id=$1 and role='customer_service' and revoked_at is null", [providerId])).rows[0].count).toBe(0);
    const token = link.searchParams.get('token_hash');
    if (!token) throw new Error('EXPECTED_LOCAL_VERIFICATION_TOKEN');
    const verified = await recipient.auth.verifyOtp({ token_hash: token, type: 'invite' });
    expect(verified.error?.code).toBeUndefined();
    expect(verified.data.user?.id).toBe(providerId);
    const before = await recipient.rpc('get_my_account');
    expect(before.error?.message).toBeUndefined();
    expect(before.data.roles).toEqual(['student']);
    const acceptArgs = { p_invitation_id: id, p_expected_version: 1, p_idempotency_key: randomUUID() };
    const accepted = await recipient.rpc('accept_staff_invitation', acceptArgs);
    expect(accepted.error?.message).toBeUndefined();
    const duplicate = await recipient.rpc('accept_staff_invitation', acceptArgs);
    expect(duplicate.error?.message).toBeUndefined();
    expect(duplicate.data.role_grant_id).toBe(accepted.data.role_grant_id);
    expect((await recipient.rpc('get_my_account')).data.roles).toContain('customer_service');
    expect((await database.query("select count(*)::int as count from app_private.account_roles where account_id=$1 and role='customer_service' and revoked_at is null", [providerId])).rows[0].count).toBe(1);
    expect((await database.query("select count(*)::int as count from app_private.audit_events where action='staff_invitation_accepted' and aggregate_id=$1", [id])).rows[0].count).toBe(1);
    expect((await mailFor(email)).length).toBe(1);
  } finally {
    await Promise.all([admin.auth.signOut(), recipient.auth.signOut()]);
    await worker.end();
    await database.end();
  }
}, 60000);
