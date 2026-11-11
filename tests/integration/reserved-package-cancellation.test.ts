import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { getOperationProposal } from '../../src/modules/booking/queries';
import { getPackageProposal } from '../../src/modules/packages/queries';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { raceBookingCalls } from '../helpers/booking';

async function dispositionFixture(coverageRule: 'named_entitlement_covers_eligible_occurrence' | 'allocated_value_with_explicit_top_up', carryingValue = 50001) {
  const f = await paymentFixture({ coverageRule, cancellationRefundBasisPoints: 5000 });
  const grant = await f.grant(f.purchaseId, await f.grantPolicy(carryingValue), carryingValue, 1000);
  const originalLot = (await f.database.query('select expires_at,original_lot_id from app_private.package_lots where id=$1', [grant.lot_id])).rows[0];
  const held = await f.hold();
  await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Exact reserved cancellation fixture fee', p_expected_version: 1, p_idempotency_key: randomUUID() });
  let coverageId: string | null = null;
  if (coverageRule === 'allocated_value_with_explicit_top_up') {
    const coverage = await f.rpc('create_operation_proposal', { p_kind: 'package_coverage', p_target_id: held.enrollmentId, p_requested_terms: { target_type: 'enrollment', package_purchase_id: f.purchaseId, expected_package_version: 2, credit_quanta: 1000, remaining_service_price_minor: null, expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Exact value coverage consent', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    coverageId = coverage.proposal_id as string;
    const terms = await getPackageProposal(f.learner, coverageId);
    await f.rpc('accept_operation_proposal', { p_proposal_id: coverageId, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() }, f.learner);
  }
  const reservation = await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: held.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: coverageId, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
  const chargeId = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [held.enrollmentId])).rows[0].id as string;
  const paid = coverageRule === 'allocated_value_with_explicit_top_up' ? await settleEnrollment(f, held.enrollmentId, 0, 57500 - carryingValue, await f.receiving()) : null;
  const seat = (await f.database.query('select version from app_private.enrollments where id=$1', [held.enrollmentId])).rows[0];
  const original = await f.rpc('create_operation_proposal', { p_kind: 'cancellation_remedy', p_target_id: held.enrollmentId, p_requested_terms: { target_type: 'enrollment', remedy: 'policy_default', expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Review exact reserved entitlement disposition', p_expected_version: seat.version, p_idempotency_key: randomUUID() }, f.learner);
  const args = { p_proposal_id: original.proposal_id, p_tutor_compensation_minor: 10000, p_package_dispositions: [{ enrollment_id: held.enrollmentId, released_credit_quanta: 500, extinguished_credit_quanta: 500 }], p_reason: 'Explicit half release and half extinguishment, not delivery', p_expected_version: 1, p_idempotency_key: randomUUID() };
  return { ...f, grant, originalLot, held, reservation, chargeId, paid, seat, original, args };
}

test.each(['named_entitlement_covers_eligible_occurrence', 'allocated_value_with_explicit_top_up'] as const)('%s reviewed cancellation conserves released and extinguished reservation sources without delivery', async coverageRule => {
  const f = await dispositionFixture(coverageRule);
  try {
    const reviewed = await f.rpc('revise_cancellation_proposal', f.args);
    const customer = await getOperationProposal(f.learner, reviewed.proposal_id as string);
    expect(customer.terms).toMatchObject({ released_credit_quanta: 500, released_value_minor: 25000, extinguished_credit_quanta: 500, extinguished_value_minor: 25001, restored_credit_quanta: 0, old_customer_price_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 57500, customer_adjustment_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : -28750, customer_price_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 28750, remedy_amount_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 3750 });
    expect(JSON.stringify(customer)).not.toMatch(/fee_minor|compensation|ledger_lines|approved_by/);
    const tutor = await getOperationProposal(f.tutor, reviewed.proposal_id as string, { view: 'tutor' });
    for (const [client, terms] of [[f.learner, customer], [f.tutor, tutor]] as const) await f.rpc('accept_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() }, client);
    const admin = await getOperationProposal(f.admin, reviewed.proposal_id as string, { view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: admin.terms_hash, p_decision: 'approved', p_reason: 'All exact service and compensation terms accepted', p_expected_version: admin.version, p_idempotency_key: randomUUID() });
    const cancelArgs = { p_enrollment_id: f.held.enrollmentId, p_remedy_proposal_id: reviewed.proposal_id, p_reason: 'Commit reviewed reservation disposition', p_expected_version: f.seat.version, p_idempotency_key: randomUUID() };
    const cancelled = await f.rpc('cancel_enrollment', cancelArgs, f.learner);
    expect(cancelled.state).toBe('cancelled');
    expect(await f.rpc('cancel_enrollment', cancelArgs, f.learner)).toEqual(cancelled);
    const lot = (await f.database.query('select balances,expires_at,original_lot_id from app_private.package_lots where id=$1', [f.grant.lot_id])).rows[0];
    expect(lot.original_lot_id).toBe(f.grant.lot_id);
    expect(lot.expires_at).toEqual(f.originalLot.expires_at);
    expect(lot.balances).toMatchObject({ granted_credit_quanta: 1000, granted_value_minor: 50001, available_credit_quanta: 500, available_value_minor: 25000, reserved_credit_quanta: 0, reserved_value_minor: 0, consumed_credit_quanta: 0, consumed_value_minor: 0, adjustment_credit_quanta: -500, adjustment_value_minor: -25001 });
    expect((await f.database.query("select count(*)::int n from app_private.entitlement_movements where reservation_id=$1 and kind='consume'", [f.reservation.reservation_id])).rows[0].n).toBe(0);
    expect((await f.database.query('select finance_private.finance_charge_balance($1) result', [f.chargeId])).rows[0].result).toMatchObject({ commercial_net_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 28750, allocated_package_value_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 25001, allocated_cash_minor: coverageRule === 'named_entitlement_covers_eligible_occurrence' ? 0 : 3749, receivable_minor: 0 });
    if (f.paid) expect((await f.database.query('select finance_private.finance_transfer_balance($1) result', [f.paid.transferId])).rows[0].result).toMatchObject({ gross_settled_minor: 7499, available_minor: 3750, net_allocated_minor: 3749 });
    expect((await f.database.query("select sum(signed_minor)::text amount from finance_private.ledger_lines where lot_id=$1 and account_code='deferred_cancellation_obligation'", [f.grant.lot_id])).rows[0].amount).toBe('-25001');
    expect((await f.rpc('get_my_package', { p_package_id: f.purchaseId }, f.learner)).package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0, charge: { balance_minor: 150000 } });
  } finally { await f.close(); }
});

test('zero-value reserved units have exact review bounds and cancellation rolls back every effect before a single concurrent commit', async () => {
  const f = await dispositionFixture('named_entitlement_covers_eligible_occurrence', 0);
  try {
    expect((await f.learner.rpc('revise_cancellation_proposal', f.args)).error?.message).toBe('FORBIDDEN');
    for (const row of [
      { ...f.args.p_package_dispositions[0], released_credit_quanta: 499 },
      { ...f.args.p_package_dispositions[0], extinguished_credit_quanta: 500.5 },
      { ...f.args.p_package_dispositions[0], released_value_minor: 0 },
    ]) {
      expect((await f.admin.rpc('revise_cancellation_proposal', { ...f.args, p_package_dispositions: [row], p_idempotency_key: randomUUID() })).error).not.toBeNull();
    }
    const { p_package_dispositions: omitted, ...withoutDisposition } = f.args;
    expect(omitted).toHaveLength(1);
    expect((await f.admin.rpc('revise_cancellation_proposal', withoutDisposition)).error?.message).toBe('CONSENT_REQUIRED');
    const reviewed = await f.rpc('revise_cancellation_proposal', f.args);
    for (const [client, view] of [[f.learner, 'customer'], [f.tutor, 'tutor']] as const) {
      const terms = await getOperationProposal(client, reviewed.proposal_id as string, { view });
      if (terms.view === 'customer') expect(terms.terms).toMatchObject({ released_credit_quanta: 500, extinguished_credit_quanta: 500, released_value_minor: 0, extinguished_value_minor: 0 });
      await f.rpc('accept_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() }, client);
    }
    const admin = await getOperationProposal(f.admin, reviewed.proposal_id as string, { view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: reviewed.proposal_id, p_terms_hash: admin.terms_hash, p_decision: 'approved', p_reason: 'Reviewed zero-value quantities remain finite', p_expected_version: admin.version, p_idempotency_key: randomUUID() });
    const args = { p_enrollment_id: f.held.enrollmentId, p_remedy_proposal_id: reviewed.proposal_id, p_reason: 'Commit exact zero-value unit disposition', p_expected_version: f.seat.version, p_idempotency_key: randomUUID() };
    const before = (await f.database.query('select balances,version from app_private.package_lots where id=$1', [f.grant.lot_id])).rows[0];
    const session = (await f.learner.auth.getSession()).data.session!;
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
    await f.database.query('begin');
    try {
      await f.database.query("create function pg_temp.fail_cancellation_disposition() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_DISPOSITION_FAILURE';end $$");
      await f.database.query('create trigger synthetic_disposition_failure before insert on finance_private.package_cancellation_dispositions for each row execute function pg_temp.fail_cancellation_disposition()');
      await f.database.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      await f.database.query('set local role authenticated');
      await expect(f.database.query('select api.cancel_enrollment($1,$2,$3,$4,$5)', [args.p_enrollment_id, args.p_reason, args.p_remedy_proposal_id, args.p_expected_version, args.p_idempotency_key])).rejects.toThrow('SYNTHETIC_DISPOSITION_FAILURE');
    } finally { await f.database.query('rollback'); }
    expect((await f.database.query('select balances,version from app_private.package_lots where id=$1', [f.grant.lot_id])).rows[0]).toEqual(before);
    expect((await f.database.query('select count(*)::int n from finance_private.package_cancellation_dispositions where proposal_id=$1', [reviewed.proposal_id])).rows[0].n).toBe(0);
    const results = await raceBookingCalls([{ client: f.learner, name: 'cancel_enrollment', args }, { client: f.learner, name: 'cancel_enrollment', args: { ...args, p_idempotency_key: randomUUID() } }]);
    expect(results.filter(result => !result.error)).toHaveLength(1);
    expect(results.find(result => result.error)?.error).toBe('VERSION_CONFLICT');
    expect((await f.database.query('select count(*)::int n from finance_private.package_cancellation_dispositions where proposal_id=$1', [reviewed.proposal_id])).rows[0].n).toBe(1);
    expect((await f.database.query('select balances from app_private.package_lots where id=$1', [f.grant.lot_id])).rows[0].balances).toMatchObject({ available_credit_quanta: 500, reserved_credit_quanta: 0, consumed_credit_quanta: 0, adjustment_credit_quanta: -500, available_value_minor: 0, adjustment_value_minor: 0 });
  } finally { await f.close(); }
});
