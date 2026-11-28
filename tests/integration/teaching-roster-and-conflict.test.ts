import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';

test('GT-TUT-005 and GT-ADM-021 preserve confirmed tutor rosters and identify an overlapping session', async () => {
  const f = await paymentFixture({isolatedLearners:true});
  try {
    const times = f.interval();
    const occurrence = await f.occurrence('group', times);
    const id = occurrence.occurrence_id as string;
    const conflict = await f.admin.rpc('create_occurrence', {
      p_offer_id: catalogFixtureIds.group2_offer, p_tutor_id: f.tutorId, p_start_at: times.start_at,
      p_end_at: times.end_at, p_time_zone: 'Africa/Cairo', p_target_tier: 2, p_idempotency_key: randomUUID(),
    });
    expect(conflict.error?.message).toBe('SCHEDULE_CONFLICT');
    expect(JSON.parse(conflict.error!.details)).toEqual({ conflicting_occurrence_ids: [id] });

    await f.rpc('approve_tutor_fee', {
      p_occurrence_id: id, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP',
      p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing,
      p_target_tier: 2, p_purpose: 'initial', p_reason: 'Synthetic roster test', p_expected_version: 1,
      p_idempotency_key: randomUUID(),
    });
    const released = await f.reserve(id, 2);
    await f.rpc('cancel_enrollment', {
      p_enrollment_id: released.enrollment_id, p_expected_version: released.version,
      p_reason: 'Synthetic learner released their hold', p_remedy_proposal_id: null, p_idempotency_key: randomUUID(),
    }, f.students[2]);
    const account = await f.receiving();
    for (const index of [0, 1]) {
      const seat = await f.reserve(id, index);
      const quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, f.students[index]);
      await f.rpc('accept_quote', {
        p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version,
        p_idempotency_key: randomUUID(),
      }, f.students[index]);
      await settleEnrollment(f, String(seat.enrollment_id), index, 57500, account);
    }
    const tutor = await f.tutor.rpc('list_tutor_occurrences', { p_occurrence_id: id });
    expect(tutor.error).toBeNull();
    const roster = tutor.data.items[0].roster as {learner_id: string; state: string}[];
    expect(roster.map(row => row.learner_id).sort()).toEqual(f.learners.slice(0, 2).sort());
    expect(roster.every(row => row.state === 'confirmed')).toBe(true);
    const admin = await f.admin.rpc('list_admin_occurrences', { p_occurrence_id: id });
    expect(admin.error).toBeNull();
    expect(admin.data.items[0].roster).toContainEqual(expect.objectContaining({ enrollment_id: released.enrollment_id, state: 'cancelled' }));
  } finally {
    await f.close();
  }
}, 90000);
