import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getOperationProposal } from '../../src/modules/booking/queries';
import { completionFixture } from '../helpers/completion';
import { beginAuthenticatedReview } from '../helpers/payment-review';
import { adminDatabase } from '../helpers/supabase';

test('GT-1317 a previously eligible cancellation conflicts with completion of the same package reservation', async () => {
  const value = 50001;
  const f = await completionFixture({ packageValue: value, startsInSeconds: 20 });
  const [cancel, complete] = await Promise.all([adminDatabase(), adminDatabase()]);
  try {
    const initial = (await f.database.query(`select o.version, e.version as seat_version, r.version as reservation_version,
      a.id as allocation, m.id as reserve, l.original_lot_id, l.expires_at
      from app_private.occurrences o join app_private.enrollments e on e.occurrence_id=o.id
      join app_private.package_reservations r on r.enrollment_id=e.id
      join app_private.package_reservation_allocations a on a.reservation_id=r.id
      join app_private.entitlement_movements m on m.allocation_id=a.id and m.kind='reserve'
      join app_private.package_lots l on l.id=a.lot_id where o.id=$1 and r.id=$2`, [f.occurrenceId, f.reservationId])).rows[0];
    const original = await f.rpc('create_operation_proposal', {
      p_kind: 'cancellation_remedy', p_target_id: f.occurrenceId, p_expected_version: initial.version,
      p_requested_terms: { target_type: 'occurrence', remedy: 'package_entitlement_restoration', expires_at: f.actualStart },
      p_reason: 'Review return of the named session credit', p_idempotency_key: randomUUID(),
    });
    const revised = await f.rpc('revise_cancellation_proposal', {
      p_proposal_id: original.proposal_id, p_tutor_compensation_minor: 0, p_expected_version: original.version,
      p_reason: 'Restore the original package allocation in full before class', p_idempotency_key: randomUUID(),
    });
    const proposal = String(revised.proposal_id);
    for (const [actor, view] of [[f.learner, 'customer'], [f.tutor, 'tutor']] as const) {
      const terms = await getOperationProposal(actor, proposal, { view });
      await f.rpc('accept_operation_proposal', { p_proposal_id: proposal, p_terms_hash: terms.terms_hash,
        p_expected_version: terms.version, p_idempotency_key: randomUUID() }, actor);
    }
    const terms = await getOperationProposal(f.admin, proposal, { view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: proposal, p_terms_hash: terms.terms_hash,
      p_expected_version: terms.version, p_decision: 'approved', p_reason: 'Approve the signed restoration', p_idempotency_key: randomUUID() });

    const token = (await f.admin.auth.getSession()).data.session!.access_token;
    const cancelPid = await beginAuthenticatedReview(cancel, token);
    const cancelArgs = [f.occurrenceId, 'Execute the approved restoration', proposal, initial.version, randomUUID()];
    const cancelCommand = () => cancel.query('select api.cancel_occurrence($1,$2,$3,$4,$5) as result', cancelArgs);
    // This identical command really can release this reservation while the proposal is fresh.
    // The savepoint restores the untouched, confirmed occurrence before teaching begins.
    await cancel.query('savepoint eligible_cancellation');
    expect((await cancelCommand()).rows[0].result).toMatchObject({ state: 'cancelled', affected_enrollment_ids: [f.enrollmentId] });
    await cancel.query('reset role');
    const proof = (await cancel.query(`select m.original_movement_id, m.credit_quanta::int, m.value_minor::int, l.balances
      from app_private.entitlement_movements m join app_private.package_lots l on l.id=m.lot_id
      where m.reservation_id=$1 and m.kind='release'`, [f.reservationId])).rows;
    expect(proof).toMatchObject([{ original_movement_id: initial.reserve, credit_quanta: 1000, value_minor: value,
      balances: { available_credit_quanta: 1000, available_value_minor: value, consumed_credit_quanta: 0 } }]);
    await cancel.query('rollback to savepoint eligible_cancellation');
    await cancel.query('commit');

    // Cancellation closes at the scheduled start. Delivery approval follows actual teaching,
    // recorded attendance and submission; a fresh cancellation and approval never share a version.
    const actualEnd = new Date(Date.parse(f.actualStart) + 1000).toISOString();
    await f.database.query('select pg_sleep_until($1::timestamptz)', [actualEnd]);
    const started = await f.rpc('start_occurrence', { p_occurrence_id: f.occurrenceId, p_actual_start_at: f.actualStart,
      p_expected_version: initial.version, p_idempotency_key: randomUUID() }, f.tutor);
    const attendance = await f.rpc('record_attendance', { p_occurrence_id: f.occurrenceId, p_actual_start_at: f.actualStart,
      p_actual_end_at: actualEnd, p_entries: [{ enrollment_id: f.enrollmentId, attendance: 'present', attended_seconds: 1, reason: null }],
      p_expected_version: started.version, p_idempotency_key: randomUUID() }, f.tutor);
    const evidence = await f.evidence({ purpose: 'delivery_exception', parentType: 'occurrence', parentId: f.occurrenceId });
    const review = await f.rpc('review_delivery_exception', { p_occurrence_id: f.occurrenceId, p_attendance_version: attendance.attendance_version,
      p_tutor_fee_minor: 0, p_enrollment_outcomes: [{ enrollment_id: f.enrollmentId, retained_charge_minor: 0, consume_credit_quanta: 1000, remedy_mode: 'none' }],
      p_reason: 'Synthetic shortened delivery with an explicitly reviewed whole named credit', p_evidence_file_id: evidence,
      p_expected_version: attendance.version, p_idempotency_key: randomUUID() });
    const remedies = [review.delivery_exception_id];
    const submitted = await f.rpc('submit_completion', { p_occurrence_id: f.occurrenceId, p_attendance_version: attendance.attendance_version,
      p_topic_summary: 'Reviewed synthetic package delivery', p_delivery_exception_ids: remedies,
      p_expected_version: review.version, p_idempotency_key: randomUUID() }, f.tutor);
    const beforeApproval = (await f.database.query(`select e.version as seat_version, r.version as reservation_version, r.state, l.balances
      from app_private.package_reservations r join app_private.enrollments e on e.id=r.enrollment_id
      join app_private.package_lots l on l.id=$2 where r.id=$1`, [f.reservationId, f.lotId])).rows[0];
    expect(beforeApproval).toMatchObject({ seat_version: initial.seat_version, reservation_version: initial.reservation_version, state: 'reserved',
      balances: { reserved_credit_quanta: 1000, reserved_value_minor: value, consumed_value_minor: 0 } });

    const completePid = await beginAuthenticatedReview(complete, token);
    await beginAuthenticatedReview(cancel, token);
    const completionKey = randomUUID();
    const approved = (await complete.query('select api.approve_completion($1,$2,$3,$4,$5) as result',
      [f.occurrenceId, 1, remedies, submitted.version, completionKey])).rows[0].result;
    const waitingCancellation = cancelCommand().then(() => 'CANCELLED', (e: Error) => e.message);
    await expect.poll(async () => (await f.database.query('select pg_blocking_pids($1) as blockers', [cancelPid])).rows[0].blockers,
      { timeout: 5000, interval: 25 }).toContain(completePid);
    await complete.query('commit');
    expect(await waitingCancellation).toBe('VERSION_CONFLICT');
    await cancel.query('rollback');
    expect(await f.rpc('approve_completion', { p_occurrence_id: f.occurrenceId, p_completion_version: 1,
      p_approved_remedy_ids: remedies, p_expected_version: submitted.version, p_idempotency_key: completionKey })).toEqual(approved);

    const final = (await f.database.query(`select o.state, e.state as seat_state, r.state as reservation_state, l.balances,
      l.original_lot_id, l.expires_at, p.state as proposal_state, finance_private.finance_charge_balance($5) as charge
      from app_private.occurrences o join app_private.enrollments e on e.occurrence_id=o.id
      join app_private.package_reservations r on r.enrollment_id=e.id join app_private.package_lots l on l.id=$3
      join app_private.operation_proposals p on p.id=$4 where o.id=$1 and r.id=$2`, [f.occurrenceId, f.reservationId, f.lotId, proposal, f.chargeId])).rows[0];
    expect(final).toMatchObject({ state: 'completed', seat_state: 'confirmed', reservation_state: 'consumed',
      original_lot_id: initial.original_lot_id, expires_at: initial.expires_at,
      balances: { available_credit_quanta: 0, reserved_credit_quanta: 0, consumed_credit_quanta: 1000,
        available_value_minor: 0, reserved_value_minor: 0, consumed_value_minor: value },
      charge: { commercial_net_minor: 0, allocated_cash_minor: 0 } });
    expect(final.proposal_state).not.toBe('committed');
    const terminal = (await f.database.query(`select id, kind, allocation_id, original_movement_id, credit_quanta::int, value_minor::int
      from app_private.entitlement_movements where lot_id=$1 and kind not in ('grant','reserve')`, [f.lotId])).rows;
    expect(terminal).toMatchObject([{ kind: 'consume', allocation_id: initial.allocation,
      original_movement_id: initial.reserve, credit_quanta: 1000, value_minor: value }]);
    const posting = (await f.database.query(`select l.account_code, l.signed_minor::int from finance_private.ledger_transactions t
      join finance_private.ledger_lines l on l.transaction_id=t.id where t.source_type='package_consumption'
      and t.source_id=$1 order by l.account_code`, [terminal[0].id])).rows;
    expect(posting).toEqual([{ account_code: 'deferred_package_obligation', signed_minor: value }, { account_code: 'tuition_revenue', signed_minor: -value }]);
    expect((await f.database.query('select 1 from finance_private.package_cancellation_dispositions where proposal_id=$1', [proposal])).rowCount).toBe(0);
  } finally {
    // Release a winner still holding its lock before trying to roll back a blocked contender.
    await complete.query('rollback');
    await cancel.query('rollback');
    await Promise.all([complete.end(), cancel.end(), f.close()]);
  }
}, 60000);
