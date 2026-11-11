import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { listCreditConversionSources, listCreditConversionPolicies } from '../../src/modules/payments/queries';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';

test('actual source payer authorizes exact source-credit conversion with current beneficiary scope and bounded consent deadline', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 60000);
    const source = (await f.database.query('select l.id,a.version from finance_private.customer_credit_lots l join finance_private.credit_lot_accounts a on a.credit_lot_id=l.id where l.transfer_id=$1', [transfer.id])).rows[0];
    const policy = await f.rpc('create_package_grant_policy', { p_content: { name: `Synthetic actual credit ${randomUUID()}`, eligible_package_contract_version_ids: [f.policyId], currency: 'EGP', valuation_rule: 'reviewed_exact_source_credit', maximum_credit_quanta_per_grant: 3000, maximum_carrying_value_minor_per_grant: 60000 }, p_idempotency_key: randomUUID() });
    await f.rpc('approve_package_grant_policy', { p_grant_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Explicit real synthetic settled source conversion, no promotional subsidy', p_expected_version: 1, p_idempotency_key: randomUUID() });
    expect((await listCreditConversionSources(f.learner,f.purchaseId,{limit:100})).items.map(row=>row.source_credit_id)).toContain(source.id);
    expect((await listCreditConversionPolicies(f.learner,f.purchaseId,source.id,{limit:100})).items.map(row=>row.grant_policy_version_id)).toContain(policy.resource_id);
    const args = { p_source_credit_id: source.id, p_package_purchase_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_grant_policy_version_id: policy.resource_id, p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_expected_version: source.version, p_idempotency_key: randomUUID() };
    expect((await f.admin.rpc('authorize_credit_conversion', args)).error?.message).toBe('FORBIDDEN');
    const first = await invokePaymentCommandWithStatus(f.learner, 'authorize_credit_conversion', args);
    expect(first.status).toBe(201); expect(first.data.state).toBe('authorized');
    expect((await invokePaymentCommandWithStatus(f.learner, 'authorize_credit_conversion', args)).data).toEqual(first.data);
    expect((await f.learner.rpc('authorize_credit_conversion', { ...args, p_expires_at: new Date(Date.now() + 25 * 3600000).toISOString(), p_idempotency_key: randomUUID() })).error?.message).toBe('INVALID_TIME');
    expect((await f.learner.rpc('authorize_credit_conversion', { ...args, p_carrying_value_minor: 60001, p_idempotency_key: randomUUID() })).error).not.toBeNull();
    expect((await f.database.query('select count(*)::int count from finance_private.credit_reservations where credit_lot_id=$1', [source.id])).rows[0].count).toBe(0);
    expect((await f.database.query('select count(*)::int count from app_private.package_lots where purchase_id=$1', [f.purchaseId])).rows[0].count).toBe(0);
  } finally { await f.close(); }
});
