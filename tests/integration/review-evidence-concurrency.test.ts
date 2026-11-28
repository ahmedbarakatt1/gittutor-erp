import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getReviewCase } from '../../src/modules/payments/queries';
import { adminDatabase } from '../helpers/supabase';
import { paymentFixture } from '../helpers/payments';
import { allocateOnConnection, beginAuthenticatedReview, claimedSettledReceipt } from '../helpers/payment-review';

test('GT-1403 a replacement commits while an eligible approval is waiting on the original receipt', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  const [replacement, reviewer] = await Promise.all([adminDatabase(), adminDatabase()]);
  try {
    const { caseId, receiptId, approval } = await claimedSettledReceipt(f);
    const inspected = await getReviewCase(f.reviewer, caseId);
    expect(inspected.receipt.evidence).toMatchObject({ evidence_version: 1, state: 'ready_for_review' });
    const file = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: f.chargeId,
      uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId: f.chargeId });
    const learnerToken = (await f.learner.auth.getSession()).data.session!.access_token;
    const reviewerToken = (await f.reviewer.auth.getSession()).data.session!.access_token;
    const writerPid = await beginAuthenticatedReview(replacement, learnerToken);
    const reviewerPid = await beginAuthenticatedReview(reviewer, reviewerToken);
    // Prove this exact version-one command can allocate before either contender changes the case.
    await reviewer.query('savepoint eligible_approval');
    expect((await allocateOnConnection(reviewer, approval)).rows[0].data.allocation_ids).toHaveLength(1);
    await reviewer.query('rollback to savepoint eligible_approval');
    const updated = await replacement.query('select api.replace_receipt($1,$2,$3,$4,$5) as data',
      [receiptId, file, 'Clearer synthetic receipt', 1, randomUUID()]);
    expect(updated.rows[0].data.new_evidence_version).toBe(2);
    // The replacement is still uncommitted. Observe its row lock blocking the real approval.
    const pending = allocateOnConnection(reviewer, approval).then(() => 'APPROVED', (error: Error) => error.message);
    await expect.poll(async () => (await f.database.query('select pg_blocking_pids($1) ids', [reviewerPid])).rows[0].ids,
      { timeout: 5000, interval: 25 }).toContain(writerPid);
    await replacement.query('commit');
    expect(await pending).toBe('VERSION_CONFLICT');
    await reviewer.query('rollback');
    const allocations = async () => (await f.database.query(
      'select evidence_version, amount_minor::int from finance_private.payment_allocations where receipt_id=$1', [receiptId])).rows;
    expect(await allocations()).toEqual([]);
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) b', [approval.p_transfer_id])).rows[0].b)
      .toMatchObject({ gross_settled_minor: 50000, net_allocated_minor: 0, available_minor: 50000 });
    const history = await f.database.query('select evidence_version,state,file_id from app_private.receipt_evidence where receipt_id=$1 order by evidence_version', [receiptId]);
    expect(history.rows).toEqual([
      { evidence_version: 1, state: 'superseded', file_id: inspected.receipt.evidence.file_id },
      { evidence_version: 2, state: 'ready_for_review', file_id: file },
    ]);
    const current = (await f.database.query('select state,owner_id,version from app_private.review_cases where id=$1', [caseId])).rows[0];
    expect(current).toMatchObject({ state: 'unassigned', owner_id: null });
    const claim = await f.rpc('claim_review_case', { p_case_id: caseId, p_expected_version: current.version, p_idempotency_key: randomUUID() }, f.reviewer);
    expect((await getReviewCase(f.reviewer, caseId)).receipt.evidence.evidence_version).toBe(2);
    const reclaimed = { ...approval, p_expected_version: claim.version, p_idempotency_key: randomUUID() };
    expect((await f.reviewer.rpc('allocate_transfer', reclaimed)).error?.message).toBe('EVIDENCE_REQUIRED');
    const fresh = { ...reclaimed, p_evidence_version: 2, p_idempotency_key: randomUUID() };
    const applied = await f.rpc('allocate_transfer', fresh, f.reviewer);
    expect(await f.rpc('allocate_transfer', fresh, f.reviewer)).toEqual(applied);
    expect(await allocations()).toEqual([{ evidence_version: 2, amount_minor: 50000 }]);
  } finally {
    await replacement.query('rollback');
    await reviewer.query('rollback');
    await Promise.all([replacement.end(), reviewer.end(), f.close()]);
  }
}, 30000);
