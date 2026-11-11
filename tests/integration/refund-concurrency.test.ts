import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { paymentFixture } from '../helpers/payments';
import { createVerifiedRefund } from '../helpers/refunds';
import { raceBookingCalls } from '../helpers/booking';

test('independent refund approval and failed-attempt retry races conserve one original cash source', async () => {
  const f = await paymentFixture();
  try {
    await f.rpc('grant_staff_role', { p_account_id: f.actor.id, p_role: 'admin', p_reason: 'Synthetic independent refund approver', p_idempotency_key: randomUUID() });
    const first = await createVerifiedRefund(f, 40000), second = await createVerifiedRefund(f, 40000, first.transferId);
    const refunds = [first, second], clients = [f.admin, f.tutor];
    const approvals = refunds.map((refund, index) => ({ client: clients[index], name: 'approve_refund', args: { p_refund_id: refund.refundId, p_remedy_id: null, p_destination_version_id: refund.destinationVersionId, p_amount_minor: 40000, p_reason: 'Synthetic competing surplus refund', p_expected_version: refund.version, p_idempotency_key: randomUUID() } }));
    const results = await raceBookingCalls(approvals);
    expect(results.filter(row => !row.error)).toHaveLength(1);
    const winnerIndex = results.findIndex(row => !row.error), loserIndex = 1 - winnerIndex;
    if (results[loserIndex].error === 'RETRYABLE_CONFLICT') {
      const retry = await clients[loserIndex].rpc('approve_refund', approvals[loserIndex].args);
      expect(retry.error?.message).toBe('INSUFFICIENT_FUNDS');
    } else expect(results[loserIndex].error).toBe('INSUFFICIENT_FUNDS');
    const winner = refunds[winnerIndex], loser = refunds[loserIndex], approved = results[winnerIndex].data;
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [first.transferId])).rows[0].data).toMatchObject({ gross_settled_minor: 55000, refund_reserved_minor: 40000, refund_settled_minor: 0, available_minor: 15000 });
    expect((await f.database.query("select count(*)::int count from finance_private.refunds where id=any($1::uuid[]) and state='approved'", [[first.refundId, second.refundId]])).rows[0].count).toBe(1);
    expect(await f.rpc('approve_refund', approvals[winnerIndex].args, clients[winnerIndex])).toEqual(approved);
    await expect(f.rpc('approve_refund', { ...approvals[winnerIndex].args, p_amount_minor: 39999 }, clients[winnerIndex])).rejects.toThrow('IDEMPOTENCY_CONFLICT');

    const attempt = await f.rpc('record_refund_attempt', { p_refund_id: winner.refundId, p_external_reference: `synthetic-failed-${randomUUID()}`, p_expected_version: approved.version, p_idempotency_key: randomUUID() }, clients[winnerIndex]);
    const evidence = await f.evidence({ purpose: 'refund_outcome', parentType: 'refund_attempt', parentId: String(attempt.attempt_id) });
    const failed = await f.rpc('reconcile_refund', { p_refund_id: winner.refundId, p_attempt_id: attempt.attempt_id, p_outcome: 'failed', p_evidence_file_id: evidence, p_external_reference: `synthetic-failure-evidence-${randomUUID()}`, p_settled_at: null, p_expected_version: attempt.version, p_idempotency_key: randomUUID() }, clients[winnerIndex]);
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [first.transferId])).rows[0].data).toMatchObject({ refund_reserved_minor: 0, refund_settled_minor: 0, available_minor: 55000 });
    const retryArgs = { p_refund_id: winner.refundId, p_external_reference: `synthetic-evidenced-retry-${randomUUID()}`, p_expected_version: failed.version, p_idempotency_key: randomUUID() };
    const racing = [{ client: clients[winnerIndex], name: 'record_refund_attempt', args: retryArgs }, approvals[loserIndex]];
    const retryResults = await raceBookingCalls(racing);
    expect(retryResults.filter(row => !row.error)).toHaveLength(1);
    const failedIndex = retryResults.findIndex(row => row.error);
    if (retryResults[failedIndex].error === 'RETRYABLE_CONFLICT') {
      expect((await racing[failedIndex].client.rpc(racing[failedIndex].name, racing[failedIndex].args)).error?.message).toBe('INSUFFICIENT_FUNDS');
    } else expect(retryResults[failedIndex].error).toBe('INSUFFICIENT_FUNDS');
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [first.transferId])).rows[0].data).toMatchObject({ gross_settled_minor: 55000, refund_reserved_minor: 40000, refund_settled_minor: 0, available_minor: 15000 });
    const attempts = (await f.database.query('select id,previous_attempt_id,destination_version_id,state from finance_private.refund_attempts where refund_id=$1 order by started_at,id', [winner.refundId])).rows;
    expect(attempts[0]).toMatchObject({ id: attempt.attempt_id, destination_version_id: winner.destinationVersionId, state: 'failed' });
    if (!retryResults[0].error) {
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toMatchObject({ previous_attempt_id: attempt.attempt_id, destination_version_id: winner.destinationVersionId, state: 'pending' });
    } else {
      expect(attempts).toHaveLength(1);
      expect((await f.database.query('select state from finance_private.refunds where id=$1', [loser.refundId])).rows[0].state).toBe('approved');
    }
    expect((await f.database.query('select account_code,sum(signed_minor)::int total from finance_private.ledger_lines where transfer_id=$1 group by account_code order by account_code', [first.transferId])).rows).toEqual([{ account_code: 'channel_cash', total: 55000 }, { account_code: 'unapplied_customer_funds', total: -55000 }]);
  } finally { await f.close(); }
});
