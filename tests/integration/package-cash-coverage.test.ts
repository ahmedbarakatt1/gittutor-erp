import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { getEnrollment } from '../../src/modules/booking/queries';
import { getPackageProposal } from '../../src/modules/packages/queries';

test.each(['named_entitlement_covers_eligible_occurrence', 'allocated_value_with_explicit_top_up'] as const)('%s after settled cash releases traceable payer credit without changing incoming cash', async coverageRule => {
  const f = await paymentFixture({ coverageRule });
  try {
    await f.grant(f.purchaseId, await f.grantPolicy(50000), 50000, 1000);
    const held = await f.hold(), charge = (await f.database.query('select id from finance_private.charges where enrollment_id=$1', [held.enrollmentId])).rows[0].id;
    const account = await f.receiving(), transfer = await f.transfer(account.id, 50000);
    const fileId = await f.evidence({ purpose: 'payment_receipt', parentType: 'charge', parentId: charge, uploaderId: f.learnerAccountId, learnerId: f.learnerId, chargeId: charge });
    const receipt = await f.rpc('submit_receipt', { p_enrollment_id: held.enrollmentId, p_charge_id: charge, p_file_id: fileId, p_receiving_account_version_id: account.versionId, p_channel: 'instapay', p_transferred_amount_minor: 50000, p_currency: 'EGP', p_reference: 'Actual synthetic cash before named coverage', p_transferred_at: null, p_idempotency_key: randomUUID() }, f.learner);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: charge, amount_minor: 50000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    let proposalId: string | null = null;
    if (coverageRule === 'allocated_value_with_explicit_top_up') {
      const proposal = await f.rpc('create_operation_proposal', { p_kind: 'package_coverage', p_target_id: held.enrollmentId, p_requested_terms: { target_type: 'enrollment', package_purchase_id: f.purchaseId, expected_package_version: 2, credit_quanta: 1000, remaining_service_price_minor: null, expires_at: new Date(Date.now() + 600000).toISOString() }, p_reason: 'Accept value coverage after the cash allocation', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
      proposalId = proposal.proposal_id as string;
      const terms = await getPackageProposal(f.learner, proposalId);
      await f.rpc('accept_operation_proposal', { p_proposal_id: proposalId, p_terms_hash: terms.terms_hash, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    }
    const reserved = await f.rpc('reserve_package_credit', { p_package_id: f.purchaseId, p_enrollment_id: held.enrollmentId, p_credit_quanta: 1000, p_coverage_proposal_id: proposalId, p_expected_version: 2, p_idempotency_key: randomUUID() }, f.learner);
    const retainedCash = coverageRule === 'allocated_value_with_explicit_top_up' ? 7500 : 0;
    expect((await getEnrollment(f.learner, held.enrollmentId)).funding).toMatchObject({ net_charge_minor: coverageRule === 'allocated_value_with_explicit_top_up' ? 57500 : 0, allocated_minor: retainedCash, balance_minor: 0 });
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) balance', [transfer.id])).rows[0].balance).toMatchObject({ gross_settled_minor: 50000, net_allocated_minor: retainedCash, available_minor: 50000 - retainedCash });
    const lineage = (await f.database.query("select l.transfer_id,l.payer_account_id,l.original_minor,a.domain_source_id from finance_private.customer_credit_lots l join finance_private.allocation_reversals a on a.command_id=l.command_id and a.source_line_key=l.source_line_key where l.transfer_id=$1 and l.origin_kind='allocation_release'", [transfer.id])).rows;
    expect(lineage).toEqual([{ transfer_id: transfer.id, payer_account_id: f.learnerAccountId, original_minor: String(50000 - retainedCash), domain_source_id: expect.any(String) }]);
    expect((await f.database.query('select count(*)::int n from (select reservation_id from finance_private.package_coverage_postings union all select reservation_id from finance_private.package_value_allocations) p where reservation_id=$1', [reserved.reservation_id])).rows[0].n).toBe(1);
  } finally { await f.close(); }
});
