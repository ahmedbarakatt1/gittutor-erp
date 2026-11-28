import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createVerifiedRefund } from '../helpers/refunds';
import { getRefund, listMyRefunds } from '../../src/modules/payments/queries';
import { paymentFixture } from '../helpers/payments';
import { settleEnrollment } from '../helpers/financial-booking';
import { getOperationProposal, getEnrollment } from '../../src/modules/booking/queries';
import { catalogFixtureIds } from '../../tools/catalog-seed';

test('reviewed cancellation replaces immutable terms, gathers exact consent and releases original payer cash without inventing tutor earnings', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const enrollmentId = f.enrollmentId!;
    const occurrenceId = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [enrollmentId])).rows[0].occurrence_id;
    await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Exact private agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const account = await f.receiving(), paid = await settleEnrollment(f, enrollmentId, 0, 50000, account);
    const seat = await getEnrollment(f.learner, enrollmentId);
    const original = await f.rpc('create_operation_proposal', { p_kind: 'cancellation_remedy', p_target_id: enrollmentId, p_requested_terms: { target_type: 'enrollment', remedy: 'cash_refund', expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Prestart learner cancellation request', p_expected_version: seat.version, p_idempotency_key: randomUUID() }, f.learner);
    expect((await getEnrollment(f.learner, enrollmentId)).state).toBe('confirmed');
    const review = { p_proposal_id: original.proposal_id, p_tutor_compensation_minor: 10000, p_reason: 'Exact bounded compensation review', p_expected_version: 1, p_idempotency_key: randomUUID() };
    expect((await f.learner.rpc('revise_cancellation_proposal', review)).error?.message).toBe('FORBIDDEN');
    expect((await f.admin.rpc('revise_cancellation_proposal', { ...review, p_tutor_compensation_minor: 25001, p_idempotency_key: randomUUID() })).error?.message).toBe('AMOUNT_OUT_OF_RANGE');
    const revised = await f.rpc('revise_cancellation_proposal', review);
    expect(revised.proposal_id).not.toBe(original.proposal_id);
    expect(await f.rpc('revise_cancellation_proposal', review)).toEqual(revised);
    expect((await getOperationProposal(f.learner, original.proposal_id as string))).toMatchObject({ state: 'declined', superseded_by_proposal_id: revised.proposal_id });
    const customer = await getOperationProposal(f.learner, revised.proposal_id as string);
    expect(customer).toMatchObject({ can_accept: true, replaces_proposal_id: original.proposal_id, terms: { customer_price_minor: 0, customer_adjustment_minor: -50000, remedy: 'cash_refund', remedy_amount_minor: 50000, restored_credit_quanta: 0 } });
    expect(JSON.stringify(customer)).not.toMatch(/compensation|fee_minor|approved_by/);
    const tutor = await getOperationProposal(f.tutor, revised.proposal_id as string, { view: 'tutor' });
    expect(tutor).toMatchObject({ can_accept: true, terms: { fee_minor: 10000, fee_agreement_state: 'reviewed_cancellation' } });
    for (const [client, view] of [[f.learner, customer], [f.tutor, tutor]] as const) await f.rpc('accept_operation_proposal', { p_proposal_id: revised.proposal_id, p_terms_hash: view.terms_hash, p_expected_version: view.version, p_idempotency_key: randomUUID() }, client);
    const admin = await getOperationProposal(f.admin, revised.proposal_id as string, { view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: revised.proposal_id, p_terms_hash: admin.terms_hash, p_decision: 'approved', p_reason: 'Exact accepted cancellation', p_expected_version: admin.version, p_idempotency_key: randomUUID() });
    const args = { p_enrollment_id: enrollmentId, p_remedy_proposal_id: revised.proposal_id, p_reason: 'Execute approved cancellation', p_expected_version: seat.version, p_idempotency_key: randomUUID() };
    const cancelled = await f.rpc('cancel_enrollment', args, f.learner);
    expect(cancelled.state).toBe('cancelled'); expect(cancelled.remedy_id).toEqual(expect.any(String));
    expect(await f.rpc('cancel_enrollment', args, f.learner)).toEqual(cancelled);
    expect((await f.database.query('select finance_private.finance_charge_balance($1) result', [paid.chargeId])).rows[0].result).toMatchObject({ commercial_net_minor: 0, allocated_cash_minor: 0, receivable_minor: 0 });
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) result', [paid.transferId])).rows[0].result).toMatchObject({ gross_settled_minor: 50000, available_minor: 50000 });
    expect((await f.database.query('select mode,value_minor,credit_quanta,source_ancestry from finance_private.financial_remedy_plans where id=$1', [cancelled.remedy_id])).rows[0]).toMatchObject({ mode: 'cash', value_minor: '50000', credit_quanta: '0', source_ancestry: { allocation_ids: paid.allocation.allocation_ids } });
    expect((await f.database.query('select state,amount_minor from finance_private.cancellation_compensation_obligations where proposal_id=$1', [revised.proposal_id])).rows[0]).toEqual({ state: 'approved_pending_T08_posting', amount_minor: '10000' });
    // J4 follows the actual cash released by this cancellation through the payer's refund history.
    const refund = await createVerifiedRefund(f, 50000, paid.transferId);
    const approved = await f.rpc('approve_refund', { p_refund_id: refund.refundId, p_remedy_id: cancelled.remedy_id, p_destination_version_id: refund.destinationVersionId, p_amount_minor: 50000, p_reason: 'Apply agreed cancellation remedy', p_expected_version: refund.version, p_idempotency_key: randomUUID() });
    const attempt = await f.rpc('record_refund_attempt', { p_refund_id: refund.refundId, p_external_reference: randomUUID(), p_expected_version: approved.version, p_idempotency_key: randomUUID() });
    const evidence = await f.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: String(attempt.attempt_id) });
    await f.rpc('reconcile_refund', { p_refund_id: refund.refundId, p_attempt_id: attempt.attempt_id, p_outcome: 'settled', p_evidence_file_id: evidence, p_external_reference: randomUUID(), p_settled_at: new Date().toISOString(), p_expected_version: attempt.version, p_idempotency_key: randomUUID() });
    expect((await listMyRefunds(f.learner)).items.map(row => row.refund_id)).toContain(refund.refundId);
    const history = await getRefund(f.learner, refund.refundId);
    expect(history).toMatchObject({ state: 'settled', settled_minor: 50000, destination: { verification_status: 'verified', masked_identifier: expect.any(String) } });
    expect(JSON.stringify(history)).not.toContain('synthetic-');
    expect((await f.database.query('select amount_minor::int as original from finance_private.charges where id=$1', [paid.chargeId])).rows[0].original).toBe(50000);
  } finally { await f.close(); }
});

test('reviewed cancellation balances require current guardian booking and payments scope at read, acceptance and consumption', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const enrollmentId = f.enrollmentId!;
    const occurrenceId = (await f.database.query('select occurrence_id from app_private.enrollments where id=$1', [enrollmentId])).rows[0].occurrence_id;
    await f.rpc('approve_tutor_fee', { p_occurrence_id: occurrenceId, p_tutor_id: f.tutorId, p_fee_minor: 25000, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: catalogFixtureIds.private_pricing, p_target_tier: null, p_purpose: 'initial', p_reason: 'Scoped cancellation agreement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const account = await f.receiving(), paid = await settleEnrollment(f, enrollmentId, 0, 50000, account);
    const contacts = await f.rpc('get_my_verified_contacts', {}, f.tutor);
    const contactId = (contacts.items as { contact_id: string }[])[0].contact_id;
    const linkGuardian = async (scopes: string[]) => {
      const invitation = await f.rpc('create_guardian_invitation', { p_contact_id: contactId, p_scopes: scopes, p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_idempotency_key: randomUUID() }, f.learner);
      const event = (await f.database.query("select payload from app_private.domain_events where aggregate_id=$1 and event_type='guardian_invitation_created'", [invitation.invitation_id])).rows[0].payload;
      return f.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: event.single_use_token, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.tutor);
    };
    const revoke = async (link: Record<string, unknown>) => f.rpc('revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_reason: 'Replace explicitly scoped guardian authority', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    const bookingOnly = await linkGuardian(['booking']);
    const seat = await getEnrollment(f.learner, enrollmentId);
    const original = await f.rpc('create_operation_proposal', { p_kind: 'cancellation_remedy', p_target_id: enrollmentId, p_requested_terms: { target_type: 'enrollment', remedy: 'cash_refund', expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Cancellation scope regression', p_expected_version: seat.version, p_idempotency_key: randomUUID() }, f.learner);
    expect((await getOperationProposal(f.tutor, original.proposal_id as string, { view: 'customer', learner_id: seat.learner.learner_id })).proposal_id).toBe(original.proposal_id);
    const revised = await f.rpc('revise_cancellation_proposal', { p_proposal_id: original.proposal_id, p_tutor_compensation_minor: 10000, p_reason: 'Exact scoped financial replacement', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const customer = await getOperationProposal(f.learner, revised.proposal_id as string);
    const readArgs = { p_proposal_id: revised.proposal_id, p_view: 'customer', p_learner_id: seat.learner.learner_id };
    const acceptArgs = { p_proposal_id: revised.proposal_id, p_terms_hash: customer.terms_hash, p_expected_version: customer.version, p_idempotency_key: randomUUID() };
    expect.soft((await f.tutor.rpc('get_operation_proposal', readArgs)).error?.message).toBe('NOT_FOUND');
    expect.soft((await f.tutor.rpc('accept_operation_proposal', acceptArgs)).error?.message).toBe('NOT_FOUND');
    await revoke(bookingOnly);
    const fullScope = await linkGuardian(['booking', 'payments']);
    expect((await getOperationProposal(f.tutor, revised.proposal_id as string, { view: 'customer', learner_id: seat.learner.learner_id })).terms).toEqual(customer.terms);
    await f.rpc('accept_operation_proposal', acceptArgs, f.tutor);
    const tutor = await getOperationProposal(f.tutor, revised.proposal_id as string, { view: 'tutor' });
    await f.rpc('accept_operation_proposal', { p_proposal_id: revised.proposal_id, p_terms_hash: tutor.terms_hash, p_expected_version: tutor.version, p_idempotency_key: randomUUID() }, f.tutor);
    const admin = await getOperationProposal(f.admin, revised.proposal_id as string, { view: 'admin' });
    await f.rpc('approve_operation_proposal', { p_proposal_id: revised.proposal_id, p_terms_hash: admin.terms_hash, p_decision: 'approved', p_reason: 'Exact guardian and tutor consent', p_expected_version: admin.version, p_idempotency_key: randomUUID() });
    await revoke(fullScope);
    await linkGuardian(['booking']);
    expect((await getOperationProposal(f.tutor, original.proposal_id as string, { view: 'customer', learner_id: seat.learner.learner_id })).proposal_id).toBe(original.proposal_id);
    expect.soft((await f.tutor.rpc('get_operation_proposal', readArgs)).error?.message).toBe('NOT_FOUND');
    expect.soft((await f.tutor.rpc('accept_operation_proposal', acceptArgs)).error?.message).toBe('NOT_FOUND');
    const cancellation = await f.admin.rpc('cancel_enrollment', { p_enrollment_id: enrollmentId, p_remedy_proposal_id: revised.proposal_id, p_reason: 'Must reject revoked financial consent', p_expected_version: seat.version, p_idempotency_key: randomUUID() });
    expect.soft(cancellation.error?.message).toBe('NOT_FOUND');
    expect.soft((await f.database.query('select state from app_private.enrollments where id=$1', [enrollmentId])).rows[0].state).toBe('confirmed');
    expect.soft((await f.database.query('select finance_private.finance_charge_balance($1) result', [paid.chargeId])).rows[0].result).toMatchObject({ commercial_net_minor: 50000, allocated_cash_minor: 50000, receivable_minor: 0 });
  } finally { await f.close(); }
});
