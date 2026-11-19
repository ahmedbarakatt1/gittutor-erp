import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixtureId } from '../../tools/db-seed';
import { bookingFixture } from './booking';

export async function requestFixture() {
  const f = await bookingFixture();
  async function eligibleOccurrence(priceMinor = 65000, durationMinutes = 90) {
    const privateFee = { currency: 'EGP', fee_min_minor: 25000, fee_max_minor: 25000, exact_occurrence_approval_required: true };
    const effectiveAt = new Date(Date.now() - 60000).toISOString();
    const price = await f.rpc('create_pricing_draft', {
      p_scope: 'private',
      p_customer_pricing: { currency: 'EGP', pricing_unit: 'per_occurrence', duration_minutes: durationMinutes, group_tiers: null, private_seat_price_minor: priceMinor },
      p_compensation: { currency: 'EGP', group_fee_bands: null, private_fee_rule: privateFee },
      p_idempotency_key: randomUUID(),
    });
    const pricing = price.pricing_version_id;
    const approval = { p_effective_at: effectiveAt, p_expected_version: 1, p_approval_note: 'Synthetic request matching fixture' };
    await f.rpc('approve_pricing_version', { ...approval, p_pricing_version_id: pricing, p_idempotency_key: randomUUID() });
    const settings = JSON.parse(readFileSync('contracts/policy-settings.json', 'utf8')) as { development_examples: { fixture_id: string; policy: Record<string, unknown> }[] };
    const content = settings.development_examples.find(item => item.fixture_id === 'synthetic_private_booking_policy_v1')!.policy;
    for (const key of ['policy_version_id', 'status', 'environment_scope', 'is_synthetic', 'approved_by', 'approved_at', 'effective_at']) delete content[key];
    const policy = await f.rpc('create_policy_draft', {
      p_kind: 'booking', p_scope: 'private', p_content: {
        ...content, duration_minutes: durationMinutes, private_fee_rule: privateFee, private_seat_price_minor: priceMinor,
        customer_pricing_version: pricing, compensation_policy_version: pricing,
      }, p_idempotency_key: randomUUID(),
    });
    await f.rpc('approve_policy_version', { ...approval, p_policy_version_id: policy.policy_version_id, p_idempotency_key: randomUUID() });
    const offer = await f.rpc('create_offer', {
      p_subject_id: fixtureId('subject_calculus'), p_format: 'private', p_duration_minutes: durationMinutes, p_capacity: 1, p_target_tier: null,
      p_pricing_version_id: pricing, p_policy_version_id: policy.policy_version_id, p_idempotency_key: randomUUID(),
    });
    await f.rpc('publish_offer', { p_offer_id: offer.offer_id, p_effective_at: effectiveAt, p_expected_version: 1, p_idempotency_key: randomUUID() });
    const { start_at } = f.interval();
    return f.rpc('create_occurrence', {
      p_offer_id: offer.offer_id, p_tutor_id: f.tutorId, p_start_at: start_at,
      p_end_at: new Date(Date.parse(start_at) + durationMinutes * 60_000).toISOString(), p_time_zone: 'Africa/Cairo',
      p_target_tier: null, p_idempotency_key: randomUUID(),
    });
  }
  return { ...f, eligibleOccurrence };
}
