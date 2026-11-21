import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getFinanceSummary } from '../../src/modules/analytics/finance';
import { getMyPackage } from '../../src/modules/packages/queries';
import { cairoDate } from '../../src/modules/shared/primitives';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { paymentFixture } from '../helpers/payments';

test('GT-1510 one approved group delivery earns 50000 of the settled 150000 package and moves no cash', async () => {
  const f = await paymentFixture({ coverageRule: 'named_entitlement_covers_eligible_occurrence' });
  try {
    const held = await f.hold();
    // The group needs a second confirmed seat. Its zero-value grant earns no tuition.
    const peer = f.students[1];
    const contract = await f.rpc('get_package_contract', { p_package_contract_version_id: f.policyId, p_learner_id: f.learners[1] }, peer);
    const peerPurchase = await f.rpc('purchase_package', { p_package_contract_version_id: f.policyId, p_learner_id: f.learners[1],
      p_accepted_terms_hash: contract.terms_hash, p_idempotency_key: randomUUID() }, peer);
    await f.grant(peerPurchase.resource_id as string, await f.grantPolicy(0), 0, 1000);
    const peerSeat = await f.reserve(held.occurrenceId, 1);
    const peerQuote = await f.rpc('get_quote', { p_quote_id: peerSeat.quote_id }, peer);
    await f.rpc('accept_quote', { p_quote_id: peerSeat.quote_id, p_quote_hash: peerQuote.quote_hash,
      p_expected_version: peerQuote.version, p_idempotency_key: randomUUID() }, peer);
    await f.rpc('reserve_package_credit', { p_package_id: peerPurchase.resource_id, p_enrollment_id: peerSeat.enrollment_id,
      p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: 2, p_idempotency_key: randomUUID() }, peer);
    const report = () => getFinanceSummary(f.admin, {
      p_from: '2000-01-01', p_to: cairoDate(new Date()), p_as_of: new Date().toISOString(),
    });
    const opening = await report();
    async function checkReport(liability: number, revenue: number) {
      const actual = await report();
      expect(actual.ledger_balanced).toBe(true);
      expect(BigInt(actual.balances.cash_minor) - BigInt(opening.balances.cash_minor)).toBe(150000n);
      expect(BigInt(actual.balances.package_obligation_minor) - BigInt(opening.balances.package_obligation_minor)).toBe(BigInt(liability));
      expect(BigInt(actual.period.earned_revenue_minor) - BigInt(opening.period.earned_revenue_minor)).toBe(BigInt(revenue));
    }

    const purchase = await f.purchase(), purchaseId = purchase.resource_id as string, chargeId = purchase.charge_id as string;
    const receiving = await f.receiving(), transfer = await f.transfer(receiving.id, 150000);
    const file = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: chargeId,
      chargeId, uploaderId: f.learnerAccountId, learnerId: f.learnerId });
    const receipt = await f.rpc('submit_receipt', { p_enrollment_id: null, p_charge_id: chargeId, p_file_id: file,
      p_receiving_account_version_id: receiving.versionId, p_channel: 'instapay', p_transferred_amount_minor: 150000,
      p_currency: 'EGP', p_reference: transfer.externalId, p_transferred_at: null, p_idempotency_key: randomUUID() }, f.learner);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const paid = await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id,
      p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: chargeId, amount_minor: 150000 }],
      p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const funded = (await getMyPackage(f.learner, purchaseId)).package;
    expect(funded).toMatchObject({ purchase_state: 'activated', purchase_value_minor: 150000, purchased_granted_credit_quanta: 3000,
      charge: { allocated_minor: 150000, balance_minor: 0 }, balances: { available_credit_quanta: 3000, reserved_credit_quanta: 0 } });
    const sources = await f.database.query(`select s.original_lot_id, s.allocation_id, s.amount_minor::int
      from finance_private.package_funding_sources s join finance_private.transfer_settlements t on t.transfer_id=s.transfer_id
      where s.purchase_id=$1 and s.transfer_id=$2 and s.origin_kind='purchased'`, [purchaseId, transfer.id]);
    expect(sources.rows).toEqual([{ original_lot_id: expect.any(String), allocation_id: (paid.allocation_ids as string[])[0], amount_minor: 150000 }]);
    await checkReport(150000, 0);

    const reservation = await f.rpc('reserve_package_credit', { p_package_id: purchaseId, p_enrollment_id: held.enrollmentId,
      p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: funded.version, p_idempotency_key: randomUUID() }, f.learner);
    expect((await getMyPackage(f.learner, purchaseId)).package.balances).toMatchObject({
      available_credit_quanta: 2000, reserved_credit_quanta: 1000, reserved_value_minor: 50000,
    });
    await checkReport(150000, 0);
    const fee = await f.rpc('approve_tutor_fee', { p_occurrence_id: held.occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000,
      p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing,
      p_target_tier: 2, p_purpose: 'initial', p_reason: 'Synthetic group agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const confirmed = await f.rpc('confirm_occurrence', { p_occurrence_id: held.occurrenceId, p_expected_version: fee.version, p_idempotency_key: randomUUID() });
    expect(confirmed.confirmed_enrollment_ids).toEqual(expect.arrayContaining([held.enrollmentId, peerSeat.enrollment_id]));

    // Move only this disposable booking's schedule into the past so factual attendance can be recorded.
    const actualEnd = new Date(Date.now() - 60000), actualStart = new Date(actualEnd.getTime() - 3600000);
    await f.database.query('update app_private.occurrences set start_at=$2,end_at=$3 where id=$1', [held.occurrenceId, actualStart, actualEnd]);
    const start = await f.rpc('start_occurrence', { p_occurrence_id: held.occurrenceId, p_actual_start_at: actualStart.toISOString(),
      p_expected_version: confirmed.version, p_idempotency_key: randomUUID() }, f.tutor);
    const seen = await f.rpc('record_attendance', { p_occurrence_id: held.occurrenceId, p_actual_start_at: actualStart.toISOString(),
      p_actual_end_at: actualEnd.toISOString(), p_entries: [held.enrollmentId, peerSeat.enrollment_id].map(enrollment_id =>
        ({ enrollment_id, attendance: 'present', attended_seconds: 3600, reason: null })), p_expected_version: start.version, p_idempotency_key: randomUUID() }, f.tutor);
    const submitted = await f.rpc('submit_completion', { p_occurrence_id: held.occurrenceId, p_attendance_version: seen.attendance_version,
      p_topic_summary: 'Synthetic full group lesson', p_delivery_exception_ids: [], p_expected_version: seen.version, p_idempotency_key: randomUUID() }, f.tutor);
    await checkReport(150000, 0);
    const approve = { p_occurrence_id: held.occurrenceId, p_completion_version: 1, p_approved_remedy_ids: [],
      p_expected_version: submitted.version, p_idempotency_key: randomUUID() };
    const completed = await f.rpc('approve_completion', approve);
    expect(await f.rpc('approve_completion', approve)).toEqual(completed);
    await checkReport(100000, 50000);
    expect((await getMyPackage(f.learner, purchaseId)).package.balances).toMatchObject({
      available_credit_quanta: 2000, available_value_minor: 100000, reserved_credit_quanta: 0,
      consumed_credit_quanta: 1000, consumed_value_minor: 50000,
    });
    const posting = await f.database.query(`select l.account_code,l.signed_minor::int
      from app_private.entitlement_movements m
      join app_private.completion_approvals a on a.command_id=m.command_id
      join finance_private.ledger_transactions t on t.source_type='package_consumption' and t.source_id=m.id
      join finance_private.ledger_lines l on l.transaction_id=t.id
      where m.reservation_id=$1 and m.lot_id=$2 and m.enrollment_id=$3 and m.kind='consume' and a.completion_id=$4
      order by l.account_code`, [reservation.reservation_id, sources.rows[0].original_lot_id, held.enrollmentId, completed.completion_id]);
    expect(posting.rows).toEqual([
      { account_code: 'deferred_package_obligation', signed_minor: 50000 }, { account_code: 'tuition_revenue', signed_minor: -50000 },
    ]);
  } finally { await f.close(); }
}, 60000);
