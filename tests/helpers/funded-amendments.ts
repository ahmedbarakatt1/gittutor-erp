import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { paymentFixture } from './payments';
import { settleEnrollment } from './financial-booking';
import { getGroupAmendment } from '../../src/modules/booking/queries';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { policyFixture, pricingFixture } from '../unit/policy-vectors';

/** Genuine accepted and settled local scenario; future-debit money remains unreserved. */
export async function fundedAmendmentFixture({ newPrice = 60000, named = false, proposalLifetimeMs = 600000 } = {}) {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), first = await f.hold();
    const second = await f.reserve(first.occurrenceId, 1), quote = await f.rpc('get_quote', { p_quote_id: second.quote_id }, f.students[1]);
    await f.rpc('accept_quote', { p_quote_id: second.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.students[1]);
    await f.rpc('approve_tutor_fee', { p_occurrence_id: first.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Exact initial contract', p_expected_version: 1, p_idempotency_key: randomUUID() });
    let coverageId: string | undefined;
    const paid: Awaited<ReturnType<typeof settleEnrollment>>[] = [];
    if (named) {
      const grantPolicy = await f.grantPolicy(50000); await f.grant(f.purchaseId, grantPolicy, 50000, 1000);
      const coverage = await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: first.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
      coverageId = coverage.reservation_id as string;
    } else paid.push(await settleEnrollment(f, first.enrollmentId, 0, 57500, account));
    paid.push(await settleEnrollment(f, second.enrollment_id as string, 1, 57500, account));
    const occurrence = (await f.database.query('select state,version from app_private.occurrences where id=$1', [first.occurrenceId])).rows[0];
    assert.equal(occurrence.state, 'confirmed');
    const content = { ...policyFixture('group'), ...(await f.database.query('select content from app_private.policy_versions where id=$1', [f.policyId])).rows[0].content };
    content.group_target_size = 3; content.package_contract.package_policy_version_id = null;
    if (newPrice > 57500) content.deposit_basis_points = 10000;
    let pricingId = catalogFixtureIds.group_pricing;
    if (newPrice === 60000) {
      const pricing = pricingFixture('group'); pricing.customer_pricing.group_tiers![1].seat_price_minor = newPrice;
      const created = await f.rpc('create_pricing_draft', { p_scope: 'group', p_customer_pricing: pricing.customer_pricing, p_compensation: pricing.compensation, p_idempotency_key: randomUUID() });
      await f.rpc('approve_pricing_version', { p_pricing_version_id: created.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Explicit synthetic replacement pricing contract', p_expected_version: 1, p_idempotency_key: randomUUID() });
      pricingId = created.resource_id as string; content.customer_pricing_version = pricingId; content.compensation_policy_version = pricingId;
    }
    const policy = await f.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'group', p_content: content, p_idempotency_key: randomUUID() });
    await f.rpc('approve_policy_version', { p_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Exact new immutable group3 agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: first.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 62500, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: pricingId, p_target_tier: 3, p_purpose: 'amendment', p_reason: 'Exact replacement agreement', p_expected_version: occurrence.version, p_idempotency_key: randomUUID() });
    const proposed = await f.rpc('propose_group_amendment', { p_occurrence_id: first.occurrenceId, p_add_learner_ids: [f.learners[2]], p_remove_enrollment_ids: [], p_target_tier: 3, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: policy.resource_id, p_expires_at: new Date(Date.now() + proposalLifetimeMs).toISOString(), p_reason: 'Exact funded group amendment', p_expected_version: occurrence.version, p_idempotency_key: randomUUID() });
    for (const student of f.students.slice(0, 3)) {
      const view = await getGroupAmendment(student, proposed.amendment_id as string);
      await f.rpc('accept_group_amendment', { p_amendment_id: proposed.amendment_id, p_terms_hash: view.terms_hash, p_expected_version: view.version, p_idempotency_key: randomUUID() }, student);
    }
    const tutor = await getGroupAmendment(f.tutor, proposed.amendment_id as string, { view: 'tutor' });
    await f.rpc('accept_group_amendment', { p_amendment_id: proposed.amendment_id, p_terms_hash: tutor.terms_hash, p_expected_version: tutor.version, p_idempotency_key: randomUUID() }, f.tutor);
    const added = (await f.database.query('select id from app_private.enrollments where amendment_id=$1', [proposed.amendment_id])).rows[0].id;
    await settleEnrollment(f, added, 2, newPrice, account);
    return { f, account, first, second, paid, proposed, added, coverageId };
  } catch (error) { await f.close(); throw error; }
}
