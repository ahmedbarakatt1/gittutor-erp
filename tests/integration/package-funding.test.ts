import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { packageFixture } from '../helpers/packages';
import { getEnrollment } from '../../src/modules/booking/queries';
import { getPackageProposal } from '../../src/modules/packages/queries';

test('full named reservation posts a referenced zero-debt coverage credit without activating the separate purchased grant', async () => {
  const f = await packageFixture();
  try {
    const purchase = await f.purchase(), policy = await f.grantPolicy(50000);
    await f.grant(purchase.resource_id as string, policy, 50000, 1000);
    const hold = await f.hold();
    const reserved = await f.rpc('reserve_package_credit', { p_package_id: purchase.resource_id, p_enrollment_id: hold.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const enrollment = await getEnrollment(f.learner, hold.enrollmentId);
    expect(enrollment.funding).toMatchObject({ integration_state: 'ready', eligible: true, net_charge_minor: 0, balance_minor: 0, top_up_minor: 0, reserved_credit_quanta: 1000, allocated_package_value_minor: 0 });
    const charge = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [hold.enrollmentId])).rows[0];
    expect((await f.database.query('select signed_minor,kind,domain_source_id from finance_private.charge_adjustments where charge_id=$1', [charge.id])).rows).toEqual([{ signed_minor: '-57500', kind: 'named_coverage', domain_source_id: reserved.reservation_id }]);
    expect((await f.database.query('select purchase_state from app_private.package_purchases where id=$1', [purchase.resource_id])).rows[0].purchase_state).toBe('pending_funding');
    expect((await f.database.query("select count(*)::int n from app_private.package_lots where purchase_id=$1 and origin_kind='purchase'", [purchase.resource_id])).rows[0].n).toBe(0);
    await f.rpc('release_package_reservation', { p_reservation_id: reserved.reservation_id, p_reason: 'Choose another funding source before confirmation', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    expect((await getEnrollment(f.learner, hold.enrollmentId)).funding).toMatchObject({ net_charge_minor: 57500, balance_minor: 57500, eligible: false });
  } finally { await f.close(); }
});

test('explicit value coverage applies its carrying value once and preserves the accepted gross deposit basis', async () => {
  const f = await packageFixture({ coverageRule: 'allocated_value_with_explicit_top_up' });
  try {
    const purchase = await f.purchase(), policy = await f.grantPolicy(25000);
    await f.grant(purchase.resource_id as string, policy, 25000, 1000);
    const hold = await f.hold();
    const created = await f.rpc('create_operation_proposal', { p_kind: 'package_coverage', p_target_id: hold.enrollmentId, p_requested_terms: { target_type: 'enrollment', package_purchase_id: purchase.resource_id, expected_package_version: 2, credit_quanta: 1000, remaining_service_price_minor: null, expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Explicit value and remaining cash agreement', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    const terms = await getPackageProposal(f.learner, created.proposal_id as string);
    await f.rpc('accept_operation_proposal', { p_proposal_id: created.proposal_id, p_terms_hash: terms.terms_hash, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    await f.rpc('reserve_package_credit', { p_package_id: purchase.resource_id, p_enrollment_id: hold.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: created.proposal_id, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    expect((await getEnrollment(f.learner, hold.enrollmentId)).funding).toMatchObject({ integration_state: 'ready', eligible: false, net_charge_minor: 57500, allocated_package_value_minor: 25000, required_for_confirmation_minor: 28750, balance_minor: 32500, additional_required_minor: 3750, top_up_minor: 32500 });
    const rows = (await f.database.query("select l.account_code,sum(l.signed_minor)::text amount from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where l.enrollment_id=$1 and t.source_type='package_value_applied' group by l.account_code order by l.account_code", [hold.enrollmentId])).rows;
    expect(rows).toEqual([{ account_code: 'deferred_tuition', amount: '25000' }, { account_code: 'receivable', amount: '-25000' }]);
  } finally { await f.close(); }
});

test('exact full named entitlements confirm the target roster atomically without synthetic cash or purchased activation', async () => {
  const f = await packageFixture();
  try {
    const policy = await f.grantPolicy(50000), first = await f.purchase();
    await f.grant(first.resource_id as string, policy, 50000, 1000);
    const hold = await f.hold();
    await f.rpc('reserve_package_credit', { p_package_id: first.resource_id, p_enrollment_id: hold.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const contract = await f.rpc('get_package_contract', { p_package_contract_version_id: f.policyId, p_learner_id: f.learners[1] }, f.students[1]);
    const second = await f.rpc('purchase_package', { p_learner_id: f.learners[1], p_package_contract_version_id: f.policyId, p_accepted_terms_hash: contract.terms_hash, p_idempotency_key: randomUUID() }, f.students[1]);
    await f.grant(second.resource_id as string, policy, 50000, 1000);
    const seat = await f.reserve(hold.occurrenceId, 1), quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, f.students[1]);
    await f.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[1]);
    await f.rpc('reserve_package_credit', { p_package_id: second.resource_id, p_enrollment_id: seat.enrollment_id, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.students[1]);
    const pricing = (await f.database.query('select pricing_version_id from app_private.occurrences where id=$1', [hold.occurrenceId])).rows[0].pricing_version_id;
    const preview = async () => (await f.database.query('select app_private.booking_confirmation_status($1) result', [hold.occurrenceId])).rows[0].result;
    expect(await preview()).toMatchObject({ state: 'awaiting_requirements', reason: 'FEE_NOT_APPROVED' });
    await f.rpc('approve_tutor_fee', { p_occurrence_id: hold.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Exact confirmed contract fee', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const args = { p_occurrence_id: hold.occurrenceId, p_expected_version: 2, p_idempotency_key: randomUUID() };
    expect(await preview()).toMatchObject({ state: 'awaiting_requirements', reason: 'ELIGIBLE' });
    expect((await f.database.query('select state,version from app_private.occurrences where id=$1', [hold.occurrenceId])).rows[0]).toEqual({ state: 'forming', version: 2 });
    expect((await f.database.query('select count(*)::int n from app_private.booking_commitments where occurrence_id=$1', [hold.occurrenceId])).rows[0].n).toBe(0);
    const result = await f.rpc('confirm_occurrence', args);
    expect(result).toMatchObject({ state: 'confirmed', confirmed_enrollment_ids: expect.arrayContaining([hold.enrollmentId, seat.enrollment_id]), meeting_status: 'pending' });
    expect(await f.rpc('confirm_occurrence', args)).toEqual(result);
    expect(await preview()).toMatchObject({ state: 'already_confirmed', reason: 'ELIGIBLE' });
    expect((await f.database.query('select state from app_private.enrollments where occurrence_id=$1', [hold.occurrenceId])).rows.every(row => row.state === 'confirmed')).toBe(true);
    const snapshots = (await f.database.query('select roster,pricing_version_id from app_private.booking_commitments where occurrence_id=$1', [hold.occurrenceId])).rows;
    expect(snapshots).toHaveLength(1); expect(snapshots[0].roster).toHaveLength(2); expect(snapshots[0].pricing_version_id).toBe(pricing);
    const jobs = (await f.database.query("select count(*)::int n from app_private.domain_events e join app_private.outbox_jobs j on j.event_id=e.id where e.aggregate_id=$1 and j.purpose='calendar.sync' and e.event_type='occurrence_confirmed'", [hold.occurrenceId])).rows[0];
    expect(jobs.n).toBe(1);
  } finally { await f.close(); }
});
