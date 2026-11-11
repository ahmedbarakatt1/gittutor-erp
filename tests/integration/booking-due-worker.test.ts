import { Pool } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { bookingFixture } from '../helpers/booking';
import { anonymousClient, loadLocalSupabase } from '../helpers/supabase';
import { claimJobs } from '../../src/worker/claims';
import { executeLeasedJob } from '../../src/worker/execute';
import { bookingDueHandler } from '../../src/worker/booking-due';

let fixture: Awaited<ReturnType<typeof bookingFixture>>;
let worker: Pool;
beforeAll(async () => {
  fixture = await bookingFixture();
  await fixture.availability();
  const config = loadLocalSupabase();
  if (!config.worker_database_url) throw new Error('LOCAL_WORKER_REQUIRED');
  worker = new Pool({ connectionString: config.worker_database_url });
});
afterAll(async () => { await worker?.end(); await fixture?.close(); });

async function claimOnly(jobId: string) {
  await fixture.database.query('begin');
  try {
    await fixture.database.query("select id from app_private.outbox_jobs where purpose='booking.process_due' and id<>$1 for update", [jobId]);
    const jobs = await claimJobs(worker, 'booking.process_due', 1, 60);
    expect(jobs.map(job => job.id)).toEqual([jobId]);
    return jobs[0];
  } finally { await fixture.database.query('rollback'); }
}

test('a lost worker acknowledgement replays one expiry/promotion and the next expired offer advances once', async () => {
  const occurrenceId = (await fixture.occurrence()).occurrence_id as string;
  const held = await fixture.reserve(occurrenceId);
  const queued = [];
  for (const index of [1, 2]) queued.push(await fixture.rpc('join_waitlist', {
    p_occurrence_id: occurrenceId, p_learner_id: fixture.learners[index], p_idempotency_key: randomUUID(),
  }, fixture.students[index]));

  // Only this test's hold/job timestamps move; the business command never accepts a clock.
  await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [held.enrollment_id]);
  const pending = await fixture.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='booking.process_due' and j.state='pending' order by j.available_at,j.id limit 1", [occurrenceId]);
  expect(pending.rows).toHaveLength(1);
  const jobId = pending.rows[0].id as string;
  await fixture.database.query('update app_private.outbox_jobs set available_at=now() where id=$1', [jobId]);
  const first = await claimOnly(jobId);
  const handler = bookingDueHandler(worker);
  await handler.execute(first); // Domain transaction commits, then the process loses its lease before acknowledgement.
  const promoted = (await fixture.database.query('select state,offered_enrollment_id from app_private.waitlist_entries where id=$1', [queued[0].waitlist_entry_id])).rows[0];
  expect(promoted.state).toBe('offered');
  expect(promoted.offered_enrollment_id).toBeTruthy();

  await fixture.database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
  const reclaimed = await claimOnly(jobId);
  expect(reclaimed.attempt_count).toBe(2);
  expect(await executeLeasedJob(worker, reclaimed, handler)).toBe('completed');
  const firstRunCount = await fixture.database.query('select count(*)::int as count from app_private.booking_due_runs where occurrence_id=$1 and idempotency_key=$2', [occurrenceId, `booking-due:${jobId}`]);
  expect(firstRunCount.rows[0].count).toBe(1);
  const firstPromotionCount = await fixture.database.query('select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and learner_id=$2', [occurrenceId, fixture.learners[1]]);
  expect(firstPromotionCount.rows[0].count).toBe(1);
  expect((await fixture.database.query('select state from app_private.waitlist_entries where id=$1', [queued[1].waitlist_entry_id])).rows[0].state).toBe('waiting');

  await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [promoted.offered_enrollment_id]);
  const next = await fixture.database.query("select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=$1 and j.purpose='booking.process_due' and j.state='pending' order by j.available_at,j.id limit 1", [occurrenceId]);
  expect(next.rows).toHaveLength(1);
  await fixture.database.query('update app_private.outbox_jobs set available_at=now() where id=$1', [next.rows[0].id]);
  expect(await executeLeasedJob(worker, await claimOnly(next.rows[0].id), handler)).toBe('completed');
  expect((await fixture.database.query('select state from app_private.waitlist_entries where id=$1', [queued[0].waitlist_entry_id])).rows[0].state).toBe('expired');
  expect((await fixture.database.query('select state from app_private.waitlist_entries where id=$1', [queued[1].waitlist_entry_id])).rows[0].state).toBe('offered');
  expect((await fixture.database.query("select count(*)::int as count from app_private.enrollments where occurrence_id=$1 and state='held' and hold_expires_at>now()", [occurrenceId])).rows[0].count).toBe(1);
});

test('promotion rechecks withdrawn guardian consent and skips to the next eligible learner', async () => {
  const config = loadLocalSupabase();
  const provider = createClient(config.url, config.secret_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `waitlist.guardian.${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}!`;
  const created = await provider.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('WAITLIST_GUARDIAN_FIXTURE_FAILED');
  const guardian = anonymousClient();
  if ((await guardian.auth.signInWithPassword({ email, password })).error) throw new Error('WAITLIST_GUARDIAN_SIGNIN_FAILED');
  try {
    const contact = (await fixture.rpc('get_my_verified_contacts', {}, guardian)).items as { contact_id: string }[];
    const invitation = await fixture.rpc('create_guardian_invitation', {
      p_contact_id: contact[0].contact_id, p_scopes: ['booking'],
      p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_idempotency_key: randomUUID(),
    }, fixture.students[1]);
    const token = (await fixture.database.query("select payload->>'single_use_token' as token from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitation.invitation_id])).rows[0].token;
    const link = await fixture.rpc('accept_guardian_invitation', {
      p_invitation_id: invitation.invitation_id, p_single_use_token: token, p_expected_version: 1, p_idempotency_key: randomUUID(),
    }, guardian);
    const occurrenceId = (await fixture.occurrence()).occurrence_id as string;
    const held = await fixture.reserve(occurrenceId);
    const first = await fixture.rpc('join_waitlist', {
      p_occurrence_id: occurrenceId, p_learner_id: fixture.learners[1], p_idempotency_key: randomUUID(),
    }, guardian);
    const second = await fixture.rpc('join_waitlist', {
      p_occurrence_id: occurrenceId, p_learner_id: fixture.learners[2], p_idempotency_key: randomUUID(),
    }, fixture.students[2]);
    await fixture.rpc('revoke_guardian_link', {
      p_guardian_link_id: link.guardian_link_id, p_reason: 'Withdraw synthetic booking consent',
      p_expected_version: link.version, p_idempotency_key: randomUUID(),
    }, fixture.students[1]);
    await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [held.enrollment_id]);
    const due = await worker.query('select app_private.process_occurrence_booking_due($1,$2) as result', [occurrenceId, `revoked-consent:${randomUUID()}`]);
    expect(due.rows[0].result.promoted_waitlist_entry_id).toBe(second.waitlist_entry_id);
    expect((await fixture.database.query('select state,offered_enrollment_id from app_private.waitlist_entries where id=$1', [first.waitlist_entry_id])).rows[0]).toEqual({ state: 'ineligible', offered_enrollment_id: null });
    expect((await guardian.rpc('get_enrollment', { p_enrollment_id: due.rows[0].result.enrollment_id })).error?.message).toBe('NOT_FOUND');
  } finally { await guardian.auth.signOut({ scope: 'local' }); }
});
