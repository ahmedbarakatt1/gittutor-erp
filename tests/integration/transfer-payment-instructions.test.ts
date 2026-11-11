import { expect, test } from 'vitest';
import { enrollmentTransferFixture } from '../helpers/enrollment-transfer';
import { getPaymentInstructions } from '../../src/modules/payments/queries';

test('conditional transfer instructions subtract planned carryover without inventing posted cash', async () => {
  const f = await enrollmentTransferFixture({ carryoverMinor: 10000 });
  try {
    await f.acceptLearner();
    const charge = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [f.destinationId])).rows[0].id;
    const data = await getPaymentInstructions(f.learner, charge);
    expect(data).toMatchObject({ required_for_confirmation_minor: 25000, additional_required_minor: 15000, charge: { net_minor: 50000, allocated_cash_minor: 0, balance_minor: 50000, commitment_state: 'awaiting_transfer', conditional_transfer_proposal_id: f.proposalId } });
    expect(data.confirmation.state).toBe('awaiting_requirements');
    expect((await f.database.query('select state from app_private.enrollments where id=$1', [f.sourceId])).rows[0].state).toBe('confirmed');
    expect((await f.database.query('select state from app_private.enrollments where id=$1', [f.destinationId])).rows[0].state).toBe('held');
  } finally { await f.close(); }
});
