import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { getReviewCase } from '../../src/modules/payments/queries';
import { adminDatabase } from '../helpers/supabase';
import { paymentFixture } from '../helpers/payments';
import { allocateOnConnection, beginAuthenticatedReview, claimedSettledReceipt } from '../helpers/payment-review';

test('GT-1405 a valid original token and active claim cannot approve payment after staff membership revocation', async () => {
  const f = await paymentFixture({ charge: 'enrollment' }), connection = await adminDatabase();
  try {
    // Give this fixture's unique actor a temporary review duty. Shared seeded roles stay intact.
    const grant = await f.rpc('grant_staff_role', { p_account_id: f.actor.id, p_role: 'customer_service',
      p_reason: 'Isolated synthetic payment reviewer', p_idempotency_key: randomUUID() });
    const token = (await f.tutor.auth.getSession()).data.session!.access_token;
    const { caseId, approval } = await claimedSettledReceipt(f, f.tutor);
    expect((await getReviewCase(f.tutor, caseId)).case.state).toBe('claimed');
    const snapshot = async () => (await f.database.query(`
      select rc.state, rc.version, rc.owner_id, rc.claim_expires_at > now() as claim_active,
        finance_private.finance_transfer_balance($2) as source, finance_private.finance_charge_balance($3) as charge,
        (select count(*)::int from finance_private.payment_allocations where review_case_id=rc.id) as allocations,
        (select count(*)::int from app_private.review_case_events where case_id=rc.id and event_type='transfer_allocated') as decisions,
        (select count(*)::int from app_private.domain_events where aggregate_id=rc.id and event_type='transfer_allocated') as notifications,
        (select count(*)::int from finance_private.ledger_lines where transfer_id=$2) as ledger_lines
      from app_private.review_cases rc where rc.id=$1`, [caseId, approval.p_transfer_id, f.chargeId])).rows[0];
    const before = await snapshot();
    expect(before).toMatchObject({ state: 'claimed', version: approval.p_expected_version, owner_id: f.actor.id,
      claim_active: true, allocations: 0, decisions: 0, notifications: 0, source: { gross_settled_minor: 50000,
        net_allocated_minor: 0, available_minor: 50000 }, charge: { allocated_cash_minor: 0, receivable_minor: 50000 } });

    // Begin the resolver transaction with its original claims, then wait for the separate admin RPC to commit.
    await beginAuthenticatedReview(connection, token);
    await f.rpc('revoke_staff_role', { p_role_grant_id: grant.role_grant_id, p_expected_version: grant.version,
      p_reason: 'End isolated payment review duty', p_idempotency_key: randomUUID() });
    expect((await f.tutor.auth.getUser(token)).data.user?.id).toBe(f.actor.id);
    await expect(allocateOnConnection(connection, approval)).rejects.toThrow('FORBIDDEN');
    await connection.query('rollback');
    expect((await f.tutor.rpc('allocate_transfer', approval)).error?.message).toBe('FORBIDDEN');
    expect(await snapshot()).toEqual(before);
  } finally {
    await connection.query('rollback');
    await connection.end();
    await f.close();
  }
}, 30000);
