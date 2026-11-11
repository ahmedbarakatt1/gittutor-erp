import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { getTransferReversal, listFinancialExceptions } from '../../src/modules/payments/queries';

test('admin reversal reads expose current bounded source choices and deny customer, service and revoked staff access', async () => {
  const f = await paymentFixture({ charge: 'enrollment' });
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 55000), receipt = await f.receipt(account.versionId, 20000);
    const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
    const paid = await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: 20000 }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const evidence = await f.evidence({ purpose: 'transfer_reversal', parentType: 'transfer', parentId: transfer.id });
    const version = (await f.database.query('select version from finance_private.incoming_transfers where id=$1', [transfer.id])).rows[0].version;
    const reversed = await f.rpc('record_transfer_reversal', { p_transfer_id: transfer.id, p_external_reversal_id: randomUUID(), p_amount_minor: 55000, p_effective_at: new Date(Date.now() - 1000).toISOString(), p_evidence_file_id: evidence, p_expected_version: version, p_idempotency_key: randomUUID() });
    const reversalId = String(reversed.reversal_id);
    const before = (await f.database.query('select count(*)::int count from finance_private.ledger_lines where transfer_id=$1', [transfer.id])).rows[0].count;
    const detail = await getTransferReversal(f.admin, reversalId, { limit: 1 });
    expect(detail).toMatchObject({ amount_minor: 55000, resolved_minor: 0, remaining_unresolved_minor: 55000, unapplied_resolvable_minor: 35000, version: reversed.version });
    expect(detail.allocation_page.items).toHaveLength(1);
    expect(detail.allocation_page.items[0]).toMatchObject({ allocation_id: (paid.allocation_ids as string[])[0], charge_id: f.chargeId, remaining_resolvable_minor: 20000 });
    expect((await listFinancialExceptions(f.admin, { state: 'open', limit: 100 })).items.find(row => row.exception_id === reversed.reconciliation_exception_id)).toMatchObject({ signed_exposure_minor: -20000, resolution_target: { kind: 'transfer_reversal', reversal_id: reversalId } });
    for (const client of [f.learner, f.reviewer]) {
      await expect(getTransferReversal(client, reversalId)).rejects.toThrow('FORBIDDEN');
      await expect(listFinancialExceptions(client)).rejects.toThrow('FORBIDDEN');
    }
    expect((await f.database.query('select count(*)::int count from finance_private.ledger_lines where transfer_id=$1', [transfer.id])).rows[0].count).toBe(before);
    const resolved = await f.rpc('resolve_transfer_reversal', { p_reversal_id: reversalId, p_allocations: [{ allocation_id: detail.allocation_page.items[0].allocation_id, amount_minor: 10000 }], p_unapplied_minor: 5000, p_reason: 'Synthetic partial original source attribution', p_expected_version: detail.version, p_idempotency_key: randomUUID() });
    const after = await getTransferReversal(f.admin, reversalId);
    expect(after).toMatchObject({ version: resolved.version, resolved_minor: 15000, remaining_unresolved_minor: 40000, unapplied_resolvable_minor: 30000 });
    expect(after.allocation_page.items[0].remaining_resolvable_minor).toBe(10000);
    expect((await listFinancialExceptions(f.admin, { state: 'open', limit: 100 })).items.find(row => row.exception_id === reversed.reconciliation_exception_id)?.signed_exposure_minor).toBe(-10000);
    expect((await f.database.query('select signed_exposure_minor from app_private.reconciliation_exceptions where id=$1', [reversed.reconciliation_exception_id])).rows[0].signed_exposure_minor).toBe('-20000');
    const page = await listFinancialExceptions(f.admin, { limit: 1 });
    if (page.next_cursor) expect((await listFinancialExceptions(f.admin, { limit: 1, cursor: page.next_cursor })).items.map(row => row.exception_id)).not.toContain(page.items[0].exception_id);
    const grant = await f.rpc('grant_staff_role', { p_account_id: f.actor.id, p_role: 'admin', p_reason: 'Synthetic temporary exception reviewer', p_idempotency_key: randomUUID() });
    expect((await getTransferReversal(f.tutor, reversalId)).reversal_id).toBe(reversalId);
    await f.rpc('revoke_staff_role', { p_role_grant_id: grant.role_grant_id, p_reason: 'Synthetic exception review duty ended', p_expected_version: 1, p_idempotency_key: randomUUID() });
    await expect(getTransferReversal(f.tutor, reversalId)).rejects.toThrow('FORBIDDEN');
    await expect(listFinancialExceptions(f.tutor)).rejects.toThrow('FORBIDDEN');
  } finally { await f.close(); }
});
