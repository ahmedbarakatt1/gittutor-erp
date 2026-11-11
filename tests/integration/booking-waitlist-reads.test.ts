import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';

let fixture: Awaited<ReturnType<typeof bookingFixture>>;
beforeAll(async () => { fixture = await bookingFixture(); await fixture.availability(); });
afterAll(async () => { await fixture?.close(); });

test('offered waitlist pages contain only actionable seats without rewriting posted history', async () => {
  // This genuine Auth actor has an isolated learner, so prior test history cannot affect pagination.
  const learnerId = (await fixture.database.query('select id from app_private.learners where account_id=$1', [fixture.actor.id])).rows[0].id as string;
  const offers: { waitlistId: string; enrollmentId: string; occurrenceId: string }[] = [];
  for (let index = 0; index < 5; index++) {
    const occurrence = await fixture.occurrence();
    const waiting = await fixture.rpc('join_waitlist', { p_occurrence_id: occurrence.occurrence_id, p_learner_id: learnerId, p_idempotency_key: randomUUID() }, fixture.tutor);
    const promoted = (await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2) as result', [occurrence.occurrence_id, `waitlist-read:${randomUUID()}`])).rows[0].result;
    expect(promoted.promoted_waitlist_entry_id).toBe(waiting.waitlist_entry_id);
    offers.push({ waitlistId: waiting.waitlist_entry_id as string, enrollmentId: promoted.enrollment_id, occurrenceId: occurrence.occurrence_id as string });
  }
  // Only these fresh fixtures change. No worker runs after these transitions: reads must filter, not repair.
  await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1", [offers[0].enrollmentId]);
  await fixture.database.query("update app_private.enrollments set state='expired',version=version+1 where id=$1", [offers[1].enrollmentId]);
  await fixture.database.query("update app_private.occurrences set confirmation_deadline_at=now()-interval '1 second' where id=$1", [offers[2].occurrenceId]);
  const snapshot = async () => (await fixture.database.query('select id,state,version,offered_enrollment_id,updated_at from app_private.waitlist_entries where learner_id=$1 order by created_at,id', [learnerId])).rows;
  const before = await snapshot();
  expect(before).toHaveLength(5);
  expect(before.every(row => row.state === 'offered')).toBe(true);

  const first = await fixture.rpc('list_my_waitlist', { p_learner_id: learnerId, p_state: 'offered', p_limit: 1 }, fixture.tutor);
  expect(first.items).toMatchObject([{ waitlist_entry_id: offers[3].waitlistId, offered_enrollment_id: offers[3].enrollmentId }]);
  expect(first.next_cursor).toEqual(expect.any(String));
  const second = await fixture.rpc('list_my_waitlist', { p_learner_id: learnerId, p_state: 'offered', p_limit: 1, p_cursor: first.next_cursor }, fixture.tutor);
  expect(second.items).toMatchObject([{ waitlist_entry_id: offers[4].waitlistId, offered_enrollment_id: offers[4].enrollmentId }]);
  expect(second.next_cursor).toBeNull();
  const historical = await fixture.rpc('list_my_waitlist', { p_learner_id: learnerId, p_limit: 100 }, fixture.tutor);
  expect((historical.items as { waitlist_entry_id: string }[]).map(row => row.waitlist_entry_id)).toEqual(offers.map(offer => offer.waitlistId));
  expect(await snapshot()).toEqual(before);
  expect((await fixture.students[0].rpc('list_my_waitlist', { p_learner_id: learnerId, p_state: 'offered' })).error).not.toBeNull();

  // An inactive assigned tutor makes the still-posted offers non-actionable, while learner history remains scoped and readable.
  await fixture.database.query("update app_private.account_roles set revoked_at=now() where account_id=$1 and role='tutor' and revoked_at is null", [fixture.actor.id]);
  expect((await fixture.rpc('list_my_waitlist', { p_learner_id: learnerId, p_state: 'offered' }, fixture.tutor)).items).toEqual([]);
  expect((await fixture.rpc('list_my_waitlist', { p_learner_id: learnerId, p_limit: 100 }, fixture.tutor)).items).toHaveLength(5);
  expect(await snapshot()).toEqual(before);
}, 30000);
