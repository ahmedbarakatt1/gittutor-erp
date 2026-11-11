import { randomUUID } from 'node:crypto';
import { paymentFixture } from './payments';
import { settleEnrollment } from './financial-booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';

export async function groupRemovalFixture(target: 3 | 4 = 4, fundAll = true) {
  const f = await paymentFixture();
  const times = f.interval();
  const occurrence = await f.rpc('create_occurrence', { p_offer_id: target === 4 ? catalogFixtureIds.group4_offer : catalogFixtureIds.group3_offer, p_tutor_id: f.tutorId, p_start_at: times.start_at, p_end_at: times.end_at, p_time_zone: 'Africa/Cairo', p_target_tier: target, p_idempotency_key: randomUUID() });
  const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrence.resource_id, p_tutor_id: f.tutorId, p_fee_minor: target === 4 ? 72500 : 62500, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: target, p_purpose: 'initial', p_reason: 'Exact initial dropout agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const account = await f.receiving(), seats: string[] = [], paid: Awaited<ReturnType<typeof settleEnrollment>>[] = [];
  for (let index = 0; index < target; index++) {
    const seat = await f.reserve(occurrence.resource_id as string, index), quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, f.students[index]);
    await f.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[index]);
    seats.push(seat.enrollment_id as string);
    if (fundAll || index < target - 1) paid.push(await settleEnrollment(f, seats[index], index, target === 4 ? 50000 : 55000, account));
  }
  const current = (await f.database.query('select version,state,current_fee_agreement_id from app_private.occurrences where id=$1', [occurrence.resource_id])).rows[0];
  return { ...f, f, account, sourceFeeId: fee.fee_agreement_id as string, sourceVersion: current.version as number, replacementPolicyId: target === 4 ? catalogFixtureIds.group3_policy : catalogFixtureIds.group2_policy, occurrenceId: occurrence.resource_id as string, feeId: fee.fee_agreement_id as string, current, seats, paid };
}
