import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { authClient } from '../helpers/supabase';
import { getMyPackage } from '../../src/modules/packages/queries';

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

async function approveGroupFee(f: Fixture, occurrenceId: string) {
  await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 45000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.group_pricing, p_target_tier: 2, p_purpose: 'initial', p_reason: 'Exact synthetic group agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
}

async function deliver(f: Fixture, occurrenceId: string, enrollments: string[], absent?: string) {
  // Advance only this guarded fixture's scheduled interval for the delivery time gates.
  // Keep the accepted quotes, posted charges, allocation sources, entitlements and identities.
  const { rows: [occurrence] } = await f.database.query(
    "update app_private.occurrences set start_at=date_trunc('second',now())-interval '2 hours', end_at=date_trunc('second',now())-interval '1 hour',confirmation_deadline_at=now()-interval '3 hours' where id=$1 and state='confirmed' returning version,start_at,end_at", [occurrenceId]);
  expect(occurrence).toBeDefined();
  const startAt = occurrence.start_at.toISOString(), endAt = occurrence.end_at.toISOString();
  const started = await f.rpc('start_occurrence', { p_occurrence_id: occurrenceId, p_actual_start_at: startAt, p_expected_version: occurrence.version, p_idempotency_key: randomUUID() }, f.tutor);
  const entries = enrollments.map(id => ({ enrollment_id: id, attendance: id === absent ? 'absent' : 'present', attended_seconds: id === absent ? 0 : 3600, reason: id === absent ? 'Learner did not attend the lesson' : null }));
  const recorded = await f.rpc('record_attendance', { p_occurrence_id: occurrenceId, p_actual_start_at: startAt, p_actual_end_at: endAt, p_entries: entries, p_expected_version: started.version, p_idempotency_key: randomUUID() }, f.tutor);
  const submission = await f.rpc('submit_completion', { p_occurrence_id: occurrenceId, p_attendance_version: recorded.attendance_version, p_topic_summary: 'Delivered this group lesson', p_delivery_exception_ids: [], p_expected_version: recorded.version, p_idempotency_key: randomUUID() }, f.tutor);
  await f.rpc('approve_completion', { p_occurrence_id: occurrenceId, p_completion_version: 1, p_approved_remedy_ids: [], p_expected_version: submission.version, p_idempotency_key: randomUUID() });
  expect((await f.database.query("select amount_minor::int fee from finance_private.tutor_earnings where occurrence_id=$1 and source_type='base_completion'", [occurrenceId])).rows).toEqual([{ fee: 45000 }]);
}

test('J2 guardian bookings share a settled transfer and one delivered group earning', async () => {
  const f = await paymentFixture(), guardian = await authClient('guardian_a');
  try {
    const occurrence = await f.occurrence('group'), id = String(occurrence.occurrence_id);
    await approveGroupFee(f, id);
    expect((await f.database.query('select state from app_private.occurrences where id=$1', [id])).rows[0].state).toBe('forming');
    const account = await f.receiving(), guardianId = (await guardian.auth.getUser()).data.user!.id;
    const seats: string[] = [];
    const charges: string[] = [];
    const cases: string[] = [];
    for (const learnerId of f.learners.slice(0, 2)) {
      const seat = await f.rpc('reserve_enrollment', { p_occurrence_id: id, p_learner_id: learnerId, p_idempotency_key: randomUUID() }, guardian);
      const quote = await f.rpc('get_quote', { p_quote_id: seat.quote_id }, guardian);
      expect(quote.customer_price_minor).toBe(57500);
      await f.rpc('accept_quote', { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, guardian);
      const enrollmentId = String(seat.enrollment_id);
      const charge = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [enrollmentId])).rows[0].id;
      const file = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: charge, uploaderId: guardianId, learnerId, chargeId: charge });
      const receipt = await f.rpc('submit_receipt', { p_enrollment_id: enrollmentId, p_charge_id: charge, p_file_id: file, p_receiving_account_version_id: account.versionId, p_channel: 'instapay', p_transferred_amount_minor: 57500, p_currency: 'EGP', p_reference: randomUUID(), p_transferred_at: null, p_idempotency_key: randomUUID() }, guardian);
      seats.push(enrollmentId); charges.push(charge); cases.push(String(receipt.case_id));
    }
    expect((await f.database.query("select state from app_private.review_cases where id=any($1)", [cases])).rows).toEqual([{ state: 'unassigned' }, { state: 'unassigned' }]);
    const transfer = await f.transfer(account.id, 115000, true, false);
    const ownership = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
    await f.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: guardianId, p_evidence_file_id: ownership, p_reason: 'Verified guardian source', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, f.reviewer);
    for (const [index, caseId] of cases.entries()) {
      const claim = await f.rpc('claim_review_case', { p_case_id: caseId, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
      await f.rpc('allocate_transfer', { p_case_id: caseId, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: charges[index], amount_minor: 57500 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    }
    expect((await f.database.query('select amount_minor::int amount from finance_private.payment_allocations where transfer_id=$1', [transfer.id])).rows).toEqual([{ amount: 57500 }, { amount: 57500 }]);
    expect((await f.database.query('select state from app_private.enrollments where id=any($1)', [seats])).rows).toEqual([{ state: 'confirmed' }, { state: 'confirmed' }]);
    const contacts = await f.rpc('get_my_verified_contacts', {}, f.tutor);
    const invitation = await f.rpc('create_guardian_invitation', { p_contact_id: (contacts.items as {contact_id: string}[])[0].contact_id, p_scopes: ['booking'], p_expires_at: new Date(Date.now()+86400000).toISOString(), p_idempotency_key: randomUUID() }, f.learner);
    const event = (await f.database.query("select payload from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1", [invitation.invitation_id])).rows[0];
    await f.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: event.payload.single_use_token, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.tutor);
    expect((await f.tutor.rpc('get_payment_instructions', { p_charge_id: charges[0] })).error?.message).toMatch(/NOT_FOUND|FORBIDDEN/);
    await deliver(f, id, seats, seats[1]);
  } finally { await guardian.auth.signOut({ scope: 'local' }); await f.close(); }
}, 120000);

test('J5 purchased package funding flows through reservation, delivery, consumption and recognized lot revenue', async () => {
  const f = await paymentFixture();
  try {
    const pending = await getMyPackage(f.learner, f.purchaseId);
    expect(pending.package.purchase_state).toBe('pending_funding');
    const price = pending.package.charge.net_minor, account = await f.receiving();
    const receipt = await f.receipt(account.versionId, price);
    const transfer = await f.transfer(account.id, price);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: price }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const funded = (await getMyPackage(f.learner, f.purchaseId)).package;
    expect(funded.purchase_state).toBe('activated');
    expect(funded.balances.available_credit_quanta).toBeGreaterThanOrEqual(1000);
    const first = await f.hold();
    await approveGroupFee(f, first.occurrenceId);
    await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: first.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: null, p_expected_version: funded.version, p_idempotency_key: randomUUID() }, f.learner);
    const reserved = (await getMyPackage(f.learner, f.purchaseId)).package.balances;
    expect(reserved.reserved_credit_quanta).toBe(1000);
    const second = await f.reserve(first.occurrenceId, 1);
    const quote = await f.rpc('get_quote', { p_quote_id: second.quote_id }, f.students[1]);
    await f.rpc('accept_quote', { p_quote_id: second.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() }, f.students[1]);
    await settleEnrollment(f, String(second.enrollment_id), 1, 57500, account);
    await deliver(f, first.occurrenceId, [first.enrollmentId, String(second.enrollment_id)]);
    expect((await getMyPackage(f.learner, f.purchaseId)).package.balances).toMatchObject({ reserved_credit_quanta: 0, consumed_credit_quanta: 1000, consumed_value_minor: reserved.reserved_value_minor });
    const { rows: [revenue] } = await f.database.query("select -sum(l.signed_minor)::int amount from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id join app_private.entitlement_movements m on m.id=t.source_id where m.enrollment_id=$1 and l.account_code='tuition_revenue'", [first.enrollmentId]);
    expect(revenue.amount).toBe(reserved.reserved_value_minor);
  } finally { await f.close(); }
}, 120000);
