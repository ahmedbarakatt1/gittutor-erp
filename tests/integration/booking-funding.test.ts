import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { proposalFixture } from '../helpers/proposal-fixtures';
import { getGroupAmendment } from '../../src/modules/booking/queries';

let fixture: Awaited<ReturnType<typeof bookingFixture>>;
beforeAll(async () => { fixture = await bookingFixture(); await fixture.availability(); }, 60_000);
afterAll(async () => { await fixture?.close(); });

test('genuine quote acceptance atomically issues one enrollment charge with immutable consent provenance', async () => {
  const occurrence = await fixture.occurrence();
  const seat = await fixture.reserve(occurrence.resource_id as string);
  const quote = await fixture.rpc('get_quote', { p_quote_id: seat.quote_id }, fixture.students[0]);
  const rows = () => fixture.database.query('select id,amount_minor,accepted_terms_hash,responsible_account_id from finance_private.charges where enrollment_id=$1', [seat.enrollment_id]);
  expect((await rows()).rows).toHaveLength(0);
  const args = { p_quote_id: seat.quote_id, p_quote_hash: quote.quote_hash, p_expected_version: quote.version, p_idempotency_key: randomUUID() };
  const accepted = await fixture.rpc('accept_quote', args, fixture.students[0]);
  const issued = (await rows()).rows;
  expect(issued).toHaveLength(1);
  expect(issued[0]).toMatchObject({ amount_minor: String(quote.customer_price_minor), accepted_terms_hash: quote.quote_hash, responsible_account_id: (await fixture.students[0].auth.getUser()).data.user!.id });
  expect(await fixture.rpc('accept_quote', args, fixture.students[0])).toEqual(accepted);
  expect((await rows()).rows).toEqual(issued);
  const consent = (await fixture.database.query('select source_kind,quote_id,quote_acceptance_id,accepted_terms_hash from finance_private.charge_acceptance_sources where charge_id=$1', [issued[0].id])).rows;
  expect(consent).toEqual([{ source_kind: 'quote', quote_id: seat.quote_id, quote_acceptance_id: expect.any(String), accepted_terms_hash: quote.quote_hash }]);
  const lines = (await fixture.database.query('select account_code,sum(signed_minor)::text as amount from finance_private.ledger_lines where charge_id=$1 group by account_code order by account_code', [issued[0].id])).rows;
  expect(lines).toEqual([{ account_code: 'deferred_tuition', amount: String(-Number(quote.customer_price_minor)) }, { account_code: 'receivable', amount: String(quote.customer_price_minor) }]);
});

test('added-learner consent issues conditional proposed-quote debt without changing the provisional roster fingerprint', async () => {
  const f = await proposalFixture();
  try {
    const occurrence = await f.occurrence('group');
    await f.hold(occurrence.id); await f.hold(occurrence.id, 'sibling');
    const policy = await f.makePolicy('group', 3);
    const fee = await f.rpc(f.clients.admin, 'approve_tutor_fee', { p_occurrence_id: occurrence.id, p_tutor_id: f.tutorId, p_fee_minor: 62500, p_currency: 'EGP', p_duration_minutes: 60, p_compensation_policy_version_id: f.pricingIds.group, p_target_tier: 3, p_purpose: 'amendment', p_reason: 'Prospective exact agreement', p_expected_version: occurrence.version, p_idempotency_key: randomUUID() });
    const proposal = await f.rpc(f.clients.admin, 'propose_group_amendment', { p_occurrence_id: occurrence.id, p_add_learner_ids: [f.learnerIds.stranger], p_remove_enrollment_ids: [], p_target_tier: 3, p_fee_agreement_id: fee.fee_agreement_id, p_replacement_policy_version_id: policy, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_reason: 'Conditional genuine third learner charge', p_expected_version: occurrence.version, p_idempotency_key: randomUUID() });
    const snapshot = async () => (await f.database.query('select e.id,e.version,e.current_quote_id,app_private.booking_roster_fingerprint(e.occurrence_id) fingerprint from app_private.enrollments e where e.amendment_id=$1', [proposal.amendment_id])).rows[0];
    const before = await snapshot();
    expect((await f.database.query('select id from finance_private.charges where enrollment_id=$1', [before.id])).rows).toHaveLength(0);
    const terms = await getGroupAmendment(f.clients.stranger, proposal.amendment_id as string);
    await f.rpc(f.clients.stranger, 'accept_group_amendment', { p_amendment_id: proposal.amendment_id, p_terms_hash: terms.terms_hash, p_expected_version: terms.version, p_idempotency_key: randomUUID() });
    const issued = (await f.database.query('select c.id,c.amount_minor,c.accepted_terms_hash,a.commitment_state,a.conditional_amendment_id,s.source_kind,s.quote_id,s.proposal_acceptance_id from finance_private.charges c join finance_private.charge_accounts a on a.charge_id=c.id join finance_private.charge_acceptance_sources s on s.charge_id=c.id where c.enrollment_id=$1', [before.id])).rows;
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ amount_minor: '55000', accepted_terms_hash: terms.terms_hash, commitment_state: 'awaiting_amendment', conditional_amendment_id: proposal.amendment_id, source_kind: 'amendment', proposal_acceptance_id: expect.any(String) });
    expect(issued[0].quote_id).not.toBe(before.current_quote_id);
    expect(await snapshot()).toEqual(before);
    expect((await f.clients.stranger.rpc('accept_quote', { p_quote_id: before.current_quote_id, p_quote_hash: terms.terms_hash, p_expected_version: 1, p_idempotency_key: randomUUID() })).error?.message).toBe('STATE_CONFLICT');
    await f.rpc(f.clients.sibling, 'decline_group_amendment', { p_amendment_id: proposal.amendment_id, p_reason: 'Keep the current commitment', p_expected_version: terms.version, p_idempotency_key: randomUUID() });
    expect((await f.database.query('select commitment_state from finance_private.charge_accounts where charge_id=$1', [issued[0].id])).rows[0].commitment_state).toBe('resolution_required');
    expect((await f.database.query('select amount_minor from finance_private.charges where id=$1', [issued[0].id])).rows[0].amount_minor).toBe('55000');
    expect((await f.database.query('select policy_version_id,state from app_private.booking_financial_resolutions where charge_id=$1', [issued[0].id])).rows).toEqual([{ policy_version_id: policy, state: 'open' }]);
  } finally { await f.close(); }
});
