import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { groupRemovalFixture } from '../helpers/group-removal';
import { createVerifiedRefund } from '../helpers/refunds';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { raceBookingCalls } from '../helpers/booking';
import { getGroupAmendment } from '../../src/modules/booking/queries';
import { catalogFixtureIds } from '../../tools/catalog-seed';


test.each(['policy_default', 'cash_refund'] as const)('confirmed four-to-three dropout retains three accepted50000 charges and the exact72500 agreement with %s resolution', async (remedy) => {
  const f = await groupRemovalFixture();
  try {
    expect(f.current.state).toBe('confirmed');
    const args = { p_occurrence_id: f.occurrenceId, p_add_learner_ids: [], p_remove_enrollment_ids: [f.seats[3]], p_target_tier: 3, p_fee_agreement_id: f.feeId, p_replacement_policy_version_id: catalogFixtureIds.group3_policy, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Guaranteed dropout retains exact accepted price and fee', p_expected_version: f.current.version, p_idempotency_key: randomUUID(), ...(remedy === 'cash_refund' ? { p_removed_remedy: remedy } : {}) };
    const proposal = await f.rpc('propose_group_amendment', args);
    expect(await f.rpc('propose_group_amendment', args)).toEqual(proposal);
    for (let index = 0; index < 4; index++) {
      const customer = await getGroupAmendment(f.students[index], proposal.amendment_id as string);
      expect(customer.can_accept).toBe(true);
      expect(customer.terms).toMatchObject({ old_customer_price_minor: 50000, customer_price_minor: index === 3 ? 0 : 50000, customer_adjustment_minor: index === 3 ? -50000 : 0, remedy_amount_minor: index === 3 ? 50000 : null });
      expect(JSON.stringify(customer)).not.toMatch(/72500|fee_minor|fee_basis|compensation/);
      await f.rpc('accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: customer.terms_hash, p_expected_version: customer.version, p_idempotency_key: randomUUID() }, f.students[index]);
    }
    const tutor = await getGroupAmendment(f.tutor, proposal.amendment_id as string, { view: 'tutor' });
    expect(tutor.terms).toMatchObject({ fee_minor: 72500, fee_agreement_id: f.feeId, fee_basis: 'retained_previous_agreement' });
    await f.rpc('accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: tutor.terms_hash, p_expected_version: tutor.version, p_idempotency_key: randomUUID() }, f.tutor);
    const commit = { p_amendment_id: proposal.amendment_id, p_expected_version: tutor.version, p_idempotency_key: randomUUID() };
    const result = await f.rpc('commit_group_amendment', commit);
    expect(await f.rpc('commit_group_amendment', commit)).toEqual(result);
    expect((await f.database.query('select state,target_tier,current_fee_agreement_id from app_private.occurrences where id=$1', [f.occurrenceId])).rows[0]).toEqual({ state: 'confirmed', target_tier: 3, current_fee_agreement_id: f.feeId });
    for (let index = 0; index < 4; index++) {
      expect((await f.database.query('select state from app_private.enrollments where id=$1', [f.seats[index]])).rows[0].state).toBe(index === 3 ? 'cancelled' : 'confirmed');
      expect((await f.database.query('select finance_private.finance_charge_balance($1) result', [f.paid[index].chargeId])).rows[0].result).toMatchObject({ commercial_net_minor: index === 3 ? 0 : 50000, allocated_cash_minor: index === 3 ? 0 : 50000, receivable_minor: 0 });
      expect((await f.database.query('select finance_private.finance_transfer_balance($1) result', [f.paid[index].transferId])).rows[0].result).toMatchObject({ gross_settled_minor: 50000, available_minor: index === 3 ? 50000 : 0 });
    }
    expect((await f.database.query('select count(*)::int n from app_private.booking_commitments where occurrence_id=$1', [f.occurrenceId])).rows[0].n).toBe(2);
    const plans = (await f.database.query('select id,mode,value_minor from finance_private.financial_remedy_plans where proposal_id=$1', [proposal.amendment_id])).rows;
    expect(plans).toEqual([expect.objectContaining({ mode: remedy === 'cash_refund' ? 'cash' : 'account_credit', value_minor: '50000' })]);
    expect((await f.database.query('select count(*)::int n from finance_private.cancellation_compensation_obligations where proposal_id=$1', [proposal.amendment_id])).rows[0].n).toBe(0);
    if (remedy === 'cash_refund') {
      const payer = f.students[3], payerId = (await payer.auth.getUser()).data.user!.id;
      const refund = await createVerifiedRefund({ ...f, learner: payer, learnerId: f.learners[3], learnerAccountId: payerId }, 50000, f.paid[3].transferId);
      const approved = await f.rpc('approve_refund', { p_refund_id: refund.refundId, p_remedy_id: plans[0].id, p_destination_version_id: refund.destinationVersionId, p_amount_minor: 50000, p_reason: 'Exact accepted removed-seat cash resolution', p_expected_version: refund.version, p_idempotency_key: randomUUID() });
      const attempt = await f.rpc('record_refund_attempt', { p_refund_id: refund.refundId, p_external_reference: `synthetic-dropout-${randomUUID()}`, p_expected_version: approved.version, p_idempotency_key: randomUUID() });
      const evidence = await f.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: attempt.attempt_id as string });
      const settleArgs = { p_refund_id: refund.refundId, p_attempt_id: attempt.attempt_id, p_outcome: 'settled', p_evidence_file_id: evidence, p_external_reference: `synthetic-dropout-settled-${randomUUID()}`, p_settled_at: new Date(Date.now() - 1000).toISOString(), p_expected_version: attempt.version, p_idempotency_key: randomUUID() };
      const settled = await f.rpc('reconcile_refund', settleArgs);
      expect(settled.state).toBe('settled');
      expect(await f.rpc('reconcile_refund', settleArgs)).toEqual(settled);
      expect((await f.database.query('select finance_private.finance_transfer_balance($1) result', [refund.transferId])).rows[0].result).toMatchObject({ gross_settled_minor: 50000, refund_settled_minor: 50000, refund_reserved_minor: 0, available_minor: 0 });
      const cash = (await f.database.query("select sum(signed_minor)::int amount from finance_private.ledger_lines where account_code='channel_cash' and transfer_id=any($1::uuid[])", [f.paid.map(row => row.transferId)])).rows[0].amount;
      expect(cash).toBe(150000);
      expect(cash - 72500).toBe(77500); // Contract contribution; no earning/delivery posting is asserted.
      expect((await f.database.query("select count(*)::int n from finance_private.ledger_lines where account_code='tuition_revenue' and enrollment_id=any($1::uuid[])", [f.seats])).rows[0].n).toBe(0);
    }
  } finally { await f.close(); }
});

test('forming three-to-two removal requires fresh increased-price consent and leaves an exact unpaid remainder without inventing removed-seat cash', async () => {
  const f = await groupRemovalFixture(3, false);
  try {
    expect(f.current.state).toBe('forming');
    const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: f.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'amendment', p_reason: 'Fresh exact smaller-tier agreement', p_expected_version: f.current.version, p_idempotency_key: randomUUID() });
    const proposed = await f.rpc('propose_group_amendment', { p_occurrence_id: f.occurrenceId, p_add_learner_ids: [], p_remove_enrollment_ids: [f.seats[2]], p_target_tier: 2, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: catalogFixtureIds.group2_policy, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Fresh smaller formation group', p_expected_version: f.current.version, p_idempotency_key: randomUUID() });
    for (let index = 0; index < 3; index++) {
      const customer = await getGroupAmendment(f.students[index], proposed.amendment_id as string);
      expect(customer.terms).toMatchObject({ customer_price_minor: index === 2 ? 0 : 57500, customer_adjustment_minor: index === 2 ? -55000 : 2500 });
      await f.rpc('accept_group_amendment', { p_amendment_id: proposed.amendment_id, p_terms_hash: customer.terms_hash, p_expected_version: customer.version, p_idempotency_key: randomUUID() }, f.students[index]);
    }
    const teacher = await getGroupAmendment(f.tutor, proposed.amendment_id as string, { view: 'tutor' });
    await f.rpc('accept_group_amendment', { p_amendment_id: proposed.amendment_id, p_terms_hash: teacher.terms_hash, p_expected_version: teacher.version, p_idempotency_key: randomUUID() }, f.tutor);
    await f.rpc('commit_group_amendment', { p_amendment_id: proposed.amendment_id, p_expected_version: teacher.version, p_idempotency_key: randomUUID() });
    for (const paid of f.paid) expect((await f.database.query('select finance_private.finance_charge_balance($1) result', [paid.chargeId])).rows[0].result).toMatchObject({ commercial_net_minor: 57500, allocated_cash_minor: 55000, receivable_minor: 2500 });
    expect((await f.database.query('select count(*)::int n from finance_private.financial_remedy_plans where proposal_id=$1', [proposed.amendment_id])).rows[0].n).toBe(0);
  } finally { await f.close(); }
});

test('removed reserved package uses the accepted exact disposition with complete rollback and one concurrent amendment winner', async () => {
  const f = await paymentFixture({ coverageRule: 'named_entitlement_covers_eligible_occurrence', cancellationRefundBasisPoints: 5000, groupTargetSize: 3 });
  try {
    const grant = await f.grant(f.purchaseId, await f.grantPolicy(50001), 50001, 1000);
    const held = await f.hold(), seats = [held.enrollmentId];
    const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 62500, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 3, p_purpose: 'initial', p_reason: 'Exact package removal agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const reservation = await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: held.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const receiving = await f.receiving();
    for (const index of [1, 2]) {
      const seat = await f.reserve(held.occurrenceId, index), quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, f.students[index]);
      seats.push(seat.enrollment_id as string);
      await f.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[index]);
      await settleEnrollment(f, seat.enrollment_id as string, index, 55000, receiving);
    }
    const beforeOccurrence = (await f.database.query('select state,version,current_fee_agreement_id from app_private.occurrences where id=$1', [held.occurrenceId])).rows[0];
    expect(beforeOccurrence.state).toBe('confirmed');
    const proposal = await f.rpc('propose_group_amendment', { p_occurrence_id: held.occurrenceId, p_add_learner_ids: [], p_remove_enrollment_ids: [held.enrollmentId], p_target_tier: 2, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: catalogFixtureIds.group2_policy, p_package_dispositions: [{ enrollment_id: held.enrollmentId, released_credit_quanta: 500, extinguished_credit_quanta: 500 }], p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Explicit removed package half-disposition', p_expected_version: beforeOccurrence.version, p_idempotency_key: randomUUID() });
    for (const index of [0, 1, 2]) {
      const terms = await getGroupAmendment(f.students[index], proposal.amendment_id as string);
      if (index === 0) expect(terms.terms).toMatchObject({ old_customer_price_minor: 0, customer_price_minor: 0, customer_adjustment_minor: 0, released_credit_quanta: 500, released_value_minor: 25000, extinguished_credit_quanta: 500, extinguished_value_minor: 25001, remedy_amount_minor: 0 });
      await f.rpc('accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() }, f.students[index]);
    }
    const tutor = await getGroupAmendment(f.tutor, proposal.amendment_id as string, { view: 'tutor' });
    await f.rpc('accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: tutor.terms_hash, p_expected_version: tutor.version, p_idempotency_key: randomUUID() }, f.tutor);
    const args = { p_amendment_id: proposal.amendment_id, p_expected_version: tutor.version, p_idempotency_key: randomUUID() };
    const beforeLot = (await f.database.query('select balances,version,expires_at,original_lot_id from app_private.package_lots where id=$1', [grant.lot_id])).rows[0];
    const session = (await f.admin.auth.getSession()).data.session!, claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
    await f.database.query('begin');
    try {
      await f.database.query("create function pg_temp.fail_removed_commit() returns trigger language plpgsql as $$begin if new.kind='amendment' then raise exception 'SYNTHETIC_REMOVAL_ROLLBACK';end if;return new;end $$");
      await f.database.query('create trigger synthetic_removed_commit before insert on app_private.booking_commitments for each row execute function pg_temp.fail_removed_commit()');
      await f.database.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      await f.database.query('set local role authenticated');
      await expect(f.database.query('select api.commit_group_amendment($1,$2,$3)', [args.p_amendment_id, args.p_expected_version, args.p_idempotency_key])).rejects.toThrow('SYNTHETIC_REMOVAL_ROLLBACK');
    } finally { await f.database.query('rollback'); }
    expect((await f.database.query('select balances,version,expires_at,original_lot_id from app_private.package_lots where id=$1', [grant.lot_id])).rows[0]).toEqual(beforeLot);
    expect((await f.database.query('select state,version,current_fee_agreement_id from app_private.occurrences where id=$1', [held.occurrenceId])).rows[0]).toEqual(beforeOccurrence);
    expect((await f.database.query('select count(*)::int n from app_private.booking_cancellation_effects where proposal_id=$1', [proposal.amendment_id])).rows[0].n).toBe(0);
    const outcomes = await raceBookingCalls([{ client: f.admin, name: 'commit_group_amendment', args }, { client: f.admin, name: 'commit_group_amendment', args: { ...args, p_idempotency_key: randomUUID() } }]);
    expect(outcomes.filter(row => !row.error)).toHaveLength(1);
    expect(outcomes.find(row => row.error)?.error).toBe('VERSION_CONFLICT');
    const lot = (await f.database.query('select balances,expires_at,original_lot_id from app_private.package_lots where id=$1', [grant.lot_id])).rows[0];
    expect(lot).toMatchObject({ expires_at: beforeLot.expires_at, original_lot_id: beforeLot.original_lot_id, balances: { available_credit_quanta: 500, available_value_minor: 25000, reserved_credit_quanta: 0, reserved_value_minor: 0, consumed_credit_quanta: 0, consumed_value_minor: 0, adjustment_credit_quanta: -500, adjustment_value_minor: -25001 } });
    expect((await f.database.query("select count(*)::int n from app_private.entitlement_movements where reservation_id=$1 and kind='consume'", [reservation.reservation_id])).rows[0].n).toBe(0);
    expect((await f.database.query('select count(*)::int n from finance_private.package_cancellation_dispositions where proposal_id=$1', [proposal.amendment_id])).rows[0].n).toBe(1);
    expect((await f.database.query('select current_fee_agreement_id,target_tier from app_private.occurrences where id=$1', [held.occurrenceId])).rows[0]).toEqual({ current_fee_agreement_id: fee.fee_agreement_id, target_tier: 2 });
    expect((await f.rpc('get_my_package', { p_package_id: f.purchaseId }, f.learner)).package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0, charge: { balance_minor: 150000 } });
  } finally { await f.close(); }
});
