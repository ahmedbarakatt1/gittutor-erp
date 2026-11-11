import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { fixtureId } from '../../tools/db-seed';
import { policyFixture } from '../unit/policy-vectors';
import { getGroupAmendment } from '../../src/modules/booking/queries';
import { listChargeAmendmentFundingOptions } from '../../src/modules/payments/queries';

async function proposal(initialTier: 2 | 3, funded: boolean) {
  const f = await paymentFixture();
  const content = { ...policyFixture('group'), ...(await f.database.query('select content from app_private.policy_versions where id=$1', [f.policyId])).rows[0].content };
  content.group_target_size = 3; content.package_contract.package_policy_version_id = null;
  const policy = await f.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'group', p_content: content, p_idempotency_key: randomUUID() });
  const offer = await f.rpc('create_offer', { p_subject_id: fixtureId('subject_calculus'), p_format: 'group', p_duration_minutes: 60, p_capacity: 4, p_target_tier: 3, p_pricing_version_id: catalogFixtureIds.group_pricing, p_policy_version_id: policy.resource_id, p_idempotency_key: randomUUID() });
  content.package_contract.package_policy_version_id = policy.resource_id;
  content.package_contract.eligible_offer_ids = [offer.resource_id];
  await f.rpc('update_policy_draft', { p_policy_version_id: policy.resource_id, p_content: content, p_expected_version: 1, p_idempotency_key: randomUUID() });
  await f.rpc('approve_policy_version', { p_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Synthetic group-three selector policy', p_expected_version: 2, p_idempotency_key: randomUUID() });
  await f.rpc('publish_offer', { p_offer_id: offer.resource_id, p_effective_at: new Date().toISOString(), p_expected_version: 1, p_idempotency_key: randomUUID() });
  const times = f.interval(), occurrence = await f.rpc('create_occurrence', { p_offer_id: initialTier === 3 ? offer.resource_id : f.offerId, p_tutor_id: f.tutorId, p_start_at: times.start_at, p_end_at: times.end_at, p_time_zone: 'Africa/Cairo', p_target_tier: initialTier, p_idempotency_key: randomUUID() });
  const seats: string[] = [];
  for (let index = 0; index < initialTier; index++) {
    const seat = await f.reserve(String(occurrence.occurrence_id), index);
    const quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, f.students[index]);
    await f.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[index]);
    seats.push(String(seat.enrollment_id));
  }
  await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrence.occurrence_id, p_tutor_id: f.tutorId, p_fee_minor: initialTier === 3 ? 62500 : 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: initialTier, p_purpose: 'initial', p_reason: 'Synthetic exact initial agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
  if (funded) {
    const account = await f.receiving();
    for (let index = 0; index < initialTier; index++) await settleEnrollment(f, seats[index], index, initialTier === 3 ? 27500 : 28750, account);
  }
  const current = (await f.database.query('select state,version from app_private.occurrences where id=$1', [occurrence.occurrence_id])).rows[0];
  expect(current.state).toBe(funded ? 'confirmed' : 'forming');
  const tier = initialTier === 3 ? 2 : 3;
  const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrence.occurrence_id, p_tutor_id: f.tutorId, p_fee_minor: tier === 3 ? 62500 : 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: tier, p_purpose: 'amendment', p_reason: 'Synthetic exact revised agreement', p_expected_version: current.version, p_idempotency_key: randomUUID() });
  const amendment = await f.rpc('propose_group_amendment', { p_occurrence_id: occurrence.occurrence_id, p_add_learner_ids: initialTier === 2 ? [f.learners[2]] : [], p_remove_enrollment_ids: initialTier === 3 ? [seats[2]] : [], p_target_tier: tier, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: tier === 3 ? policy.resource_id : f.policyId, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Synthetic exact selector scenario', p_expected_version: current.version, p_idempotency_key: randomUUID() });
  const chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [seats[0]])).rows[0].id as string;
  const accept = async () => {
    const view = await getGroupAmendment(f.learner, String(amendment.amendment_id));
    return f.rpc('accept_group_amendment', { p_amendment_id: amendment.amendment_id, p_terms_hash: view.terms_hash, p_expected_version: view.version, p_idempotency_key: randomUUID() }, f.learner);
  };
  return { f, amendmentId: String(amendment.amendment_id), chargeId, enrollmentId: seats[0], accept };
}

test('only an accepted positive future debit is discoverable with current payments authority', async () => {
  const s = await proposal(3, true), { f } = s;
  try {
    expect((await listChargeAmendmentFundingOptions(f.learner, s.chargeId)).items).toEqual([]);
    await s.accept();
    const page = await listChargeAmendmentFundingOptions(f.learner, s.chargeId, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ amendment_id: s.amendmentId, enrollment_id: s.enrollmentId, additional_required_minor: 1250 });
    expect(JSON.stringify(page)).not.toMatch(/fee_minor|compensation|margin|encrypted|internal_notes/);
    await expect(listChargeAmendmentFundingOptions(f.students[1], s.chargeId)).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);

    // A new payments-only relationship may discover the learner's own accepted terms.
    const contacts = (await f.rpc('get_my_verified_contacts', {}, f.tutor)).items as { contact_id: string }[];
    const invitation = await f.rpc('create_guardian_invitation', { p_contact_id: contacts[0].contact_id, p_scopes: ['payments'], p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_idempotency_key: randomUUID() }, f.learner);
    const token = (await f.database.query("select payload->>'single_use_token' as token from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitation.invitation_id])).rows[0].token;
    const link = await f.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: token, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.tutor);
    expect((await listChargeAmendmentFundingOptions(f.tutor, s.chargeId)).items).toEqual(page.items);
    await f.rpc('revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_reason: 'Synthetic payment authority withdrawn', p_expected_version: link.version, p_idempotency_key: randomUUID() }, f.learner);
    await expect(listChargeAmendmentFundingOptions(f.tutor, s.chargeId)).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
    expect((await listChargeAmendmentFundingOptions(f.admin, s.chargeId)).items).toEqual(page.items);
    await f.rpc('decline_group_amendment', { p_amendment_id: s.amendmentId, p_reason: 'Synthetic proposal withdrawn', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    expect((await listChargeAmendmentFundingOptions(f.learner, s.chargeId)).items).toEqual([]);
  } finally { await f.close(); }
});

test('a price-reducing amendment cannot appear merely because the original charge is unfunded', async () => {
  const s = await proposal(2, false);
  try {
    await s.accept();
    expect((await listChargeAmendmentFundingOptions(s.f.learner, s.chargeId)).items).toEqual([]);
  } finally { await s.f.close(); }
});
