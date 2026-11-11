import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { fundedAmendmentFixture } from '../helpers/funded-amendments';
import { getGroupAmendment } from '../../src/modules/booking/queries';
import { reserveFutureAmendment, retryFinancialConflict } from '../helpers/financial-booking';

test.each([{ newPrice: 55000, outcome: 'commit', named: false }, { newPrice: 55000, outcome: 'commit', named: true }, { newPrice: 60000, outcome: 'commit', named: false }, { newPrice: 60000, outcome: 'decline', named: false }, { newPrice: 60000, outcome: 'expire', named: false }])('funded group2 to3 $newPrice $outcome named=$named preserves original cash and fee/roster history', async ({ newPrice, outcome, named }) => {
  const { f, account, first, second, paid, proposed, coverageId } = await fundedAmendmentFixture({ newPrice, named, proposalLifetimeMs: outcome === 'expire' ? 10000 : 600000 });
  try {
    const earmarks = (await f.database.query('select finance_private.finance_amendment_funding_balance($1,$2) result', [proposed.amendment_id, first.enrollmentId])).rows[0].result;
    expect(earmarks).toEqual({ reserved_minor: 0, reservation_ids: [], reconciliation_state: 'clear' });
    const basis = (await f.database.query('select app_private.booking_amendment_financial_basis($1,$2) result', [proposed.amendment_id, first.enrollmentId])).rows[0].result;
    expect(basis).toMatchObject({ current_net_minor: named ? 0 : 57500, proposed_net_minor: named ? 0 : newPrice, positive_future_debit_minor: Math.max(0, newPrice - 57500), additional_required_minor: Math.max(0, newPrice - 57500), eligible: newPrice < 57500 });
    if (newPrice > 57500) {
      const denied = await f.admin.rpc('commit_group_amendment', { p_amendment_id: proposed.amendment_id, p_expected_version: 1, p_idempotency_key: randomUUID() });
      expect(denied.error?.message).toBe('INSUFFICIENT_FUNDS');
      const earmarked = [await reserveFutureAmendment(f, proposed.amendment_id as string, first.enrollmentId, 0, 2500, account), await reserveFutureAmendment(f, proposed.amendment_id as string, second.enrollment_id as string, 1, 2500, account)];
      if (outcome !== 'commit') {
        if (outcome === 'decline') await f.rpc('decline_group_amendment', { p_amendment_id: proposed.amendment_id, p_reason: 'Retain original meeting and release future earmarks', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.students[0]);
        else {
          const expiry = (await getGroupAmendment(f.students[0], proposed.amendment_id as string)).expires_at;
          await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiry) - Date.now() + 50)));
          await f.database.query('select app_private.process_occurrence_booking_due($1,$2)', [first.occurrenceId, randomUUID()]);
        }
        for (const item of earmarked) {
          expect((await f.database.query('select finance_private.finance_transfer_balance($1) result', [item.transferId])).rows[0].result).toMatchObject({ gross_settled_minor: 2500, net_allocated_minor: 0, available_minor: 2500 });
          expect((await f.database.query('select state from finance_private.amendment_funding_reservations where id=$1', [item.reservationId])).rows[0].state).toBe('released');
        }
        expect((await f.database.query('select state,target_tier from app_private.occurrences where id=$1', [first.occurrenceId])).rows[0]).toEqual({ state: 'confirmed', target_tier: 2 });
        return;
      }
      // Later admin consumption uses current source consent; the original review lease is not a funding condition.
      await f.database.query("update app_private.review_cases set claim_expires_at=now()-interval '1 second' where id=any($1::uuid[])", [earmarked.map(item => item.caseId)]);
    }
    const args = { p_amendment_id: proposed.amendment_id, p_expected_version: 1, p_idempotency_key: randomUUID() };
    const committed = await retryFinancialConflict(() => f.rpc('commit_group_amendment', args));
    expect((committed.charge_adjustment_ids as string[])).toHaveLength(named ? 3 : 2);
    expect(await f.rpc('commit_group_amendment', args)).toEqual(committed);
    const seats = (await f.database.query('select e.state,e.hold_kind,q.customer_price_minor,a.commitment_state,a.conditional_amendment_id from app_private.enrollments e join app_private.quotes q on q.id=e.current_quote_id join finance_private.charges c on c.enrollment_id=e.id join finance_private.charge_accounts a on a.charge_id=c.id where e.occurrence_id=$1 order by e.id', [first.occurrenceId])).rows;
    expect(seats).toHaveLength(3);
    for (const seat of seats) expect(seat).toMatchObject({ state: 'confirmed', hold_kind: 'ordinary', customer_price_minor: String(newPrice), commitment_state: 'committed', conditional_amendment_id: null });
    for (const item of paid) expect((await f.database.query('select finance_private.finance_transfer_balance($1) b', [item.transferId])).rows[0].b).toMatchObject({ gross_settled_minor: 57500, net_allocated_minor: Math.min(57500, newPrice), available_minor: Math.max(0, 57500 - newPrice) });
    expect((await f.database.query('select kind,jsonb_array_length(roster) n from app_private.booking_commitments where occurrence_id=$1 order by occurrence_version', [first.occurrenceId])).rows).toEqual([{ kind: 'initial', n: 2 }, { kind: 'amendment', n: 3 }]);
    if (coverageId) {
      expect(Number((await f.database.query('select finance_private.finance_named_coverage_remaining($1) amount', [coverageId])).rows[0].amount)).toBe(55000);
      // Guarded rollback tests the exact inverse kernel only; no user remedy is asserted or committed.
      await f.database.query('begin');
      try {
        await f.database.query('select app_private.booking_lock_occurrence_finances(array[$1::uuid])', [first.occurrenceId]);
        await f.database.query('select finance_private.finance_release_package_coverage($1,$2,$3)', [coverageId, 'isolated referenced inverse verification', { actor_account_id: f.adminId, command_id: randomUUID() }]);
        expect(Number((await f.database.query('select finance_private.finance_named_coverage_remaining($1) amount', [coverageId])).rows[0].amount)).toBe(0);
        expect((await f.database.query('select finance_private.finance_charge_balance(id) result from finance_private.charges where enrollment_id=$1', [first.enrollmentId])).rows[0].result).toMatchObject({ commercial_net_minor: 55000 });
      } finally { await f.database.query('rollback'); }
    }
  } finally { await f.close(); }
});
