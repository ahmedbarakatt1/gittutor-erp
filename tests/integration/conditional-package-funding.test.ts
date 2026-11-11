import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { packageFixture } from '../helpers/packages';
import { getEnrollment, getGroupAmendment } from '../../src/modules/booking/queries';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { policyFixture } from '../unit/policy-vectors';
import { getPackageCoverageOptions, getPackageProposal } from '../../src/modules/packages/queries';

test.each(['named_entitlement_covers_eligible_occurrence', 'allocated_value_with_explicit_top_up'] as const)('accepted added-seat Q2 supports %s without ordinary Q1 consent and decline releases only that coverage', async coverageRule => {
  const f = await packageFixture({ coverageRule });
  try {
    const learner = f.students[2], learnerId = f.learners[2];
    const contract = await f.rpc('get_package_contract', { p_package_contract_version_id: f.policyId, p_learner_id: learnerId }, learner);
    const purchase = await f.rpc('purchase_package', { p_learner_id: learnerId, p_package_contract_version_id: f.policyId, p_accepted_terms_hash: contract.terms_hash, p_idempotency_key: randomUUID() }, learner);
    await f.grant(purchase.resource_id as string, await f.grantPolicy(50000), 50000, 1000);
    const held = await f.hold();
    await f.reserve(held.occurrenceId, 1);
    const content = { ...policyFixture('group'), ...(await f.database.query('select content from app_private.policy_versions where id=$1', [f.policyId])).rows[0].content };
    content.group_target_size = 3; content.package_contract.package_policy_version_id = null;
    const draft = await f.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'group', p_content: content, p_idempotency_key: randomUUID() });
    expect(draft.validation_errors).toEqual([]);
    await f.rpc('approve_policy_version', { p_policy_version_id: draft.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Synthetic exact replacement terms for named coverage', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 62500, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 3, p_purpose: 'amendment', p_reason: 'Exact proposed third-seat agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const proposal = await f.rpc('propose_group_amendment', { p_occurrence_id: held.occurrenceId, p_add_learner_ids: [learnerId], p_remove_enrollment_ids: [], p_target_tier: 3, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: draft.resource_id, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Added learner uses explicitly granted named entitlement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const terms = await getGroupAmendment(learner, proposal.amendment_id as string);
    await f.rpc('accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() }, learner);
    const seat = (await f.database.query('select id,current_quote_id from app_private.enrollments where amendment_id=$1', [proposal.amendment_id])).rows[0];
    const options = await getPackageCoverageOptions(learner, seat.id, { package_id: purchase.resource_id as string });
    expect(options.items[0]).toMatchObject({ eligible: true, standalone_reference_price_minor: 55000 });
    expect(options.enrollment.quote_id).not.toBe(seat.current_quote_id);
    let coverageProposalId: string | null = null;
    if (coverageRule === 'allocated_value_with_explicit_top_up') {
      const coverage = await f.rpc('create_operation_proposal', { p_kind: 'package_coverage', p_target_id: seat.id, p_requested_terms: { target_type: 'enrollment', package_purchase_id: purchase.resource_id, expected_package_version: 2, credit_quanta: 1000, remaining_service_price_minor: null, expires_at: new Date(Date.now() + 500000).toISOString() }, p_reason: 'Accept actual proposed price and exact value coverage', p_expected_version: 1, p_idempotency_key: randomUUID() }, learner);
      coverageProposalId = coverage.proposal_id as string;
      const coverageTerms = await getPackageProposal(learner, coverageProposalId);
      expect(coverageTerms.terms).toMatchObject({ conditional_amendment_id: proposal.amendment_id, standalone_reference_price_minor: 55000, agreed_top_up_minor: 5000 });
      await f.rpc('accept_operation_proposal', { p_proposal_id: coverageProposalId, p_terms_hash: coverageTerms.terms_hash, p_expected_version: 1, p_idempotency_key: randomUUID() }, learner);
    }
    const reserved = await f.rpc('reserve_package_credit', { p_package_id: purchase.resource_id, p_enrollment_id: seat.id, p_credit_quanta: 1000, p_coverage_proposal_id: coverageProposalId, p_expected_version: 2, p_idempotency_key: randomUUID() }, learner);
    const enrollment = await getEnrollment(learner, seat.id);
    expect(enrollment.funding.integration_state).toBe('ready');
    if (enrollment.funding.integration_state !== 'ready') throw new Error('READY_FUNDING_REQUIRED');
    expect(enrollment.funding).toMatchObject({ eligible: false, financially_eligible: true, reason: 'AMENDMENT_PENDING', conditional_amendment_id: proposal.amendment_id, net_charge_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 55000 });
    expect(enrollment.funding.funding_quote_id).not.toBe(seat.current_quote_id);
    expect((await f.database.query('select quote_id,conditional_amendment_id from app_private.package_reservations where id=$1', [reserved.reservation_id])).rows[0]).toEqual({ quote_id: enrollment.funding.funding_quote_id, conditional_amendment_id: proposal.amendment_id });
    await f.rpc('decline_group_amendment', { p_amendment_id: proposal.amendment_id, p_reason: 'Existing learner declines the new terms', p_expected_version: terms.version, p_idempotency_key: randomUUID() }, f.students[1]);
    expect((await f.database.query('select state from app_private.package_reservations where id=$1', [reserved.reservation_id])).rows[0].state).toBe('released');
    expect((await getEnrollment(learner, seat.id)).funding).toMatchObject({ eligible: false, net_charge_minor: 55000, reason: 'OCCURRENCE_CANCELLED' });
  } finally { await f.close(); }
});
