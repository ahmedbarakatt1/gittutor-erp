import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { getMyPackage } from '../../src/modules/packages/queries';
import { raceBookingCalls } from '../helpers/booking';

test('source payer consent converts exact settled credit to a separate valued grant without settling the package purchase', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 50000);
    const credit = (await f.database.query('select l.id,a.version from finance_private.customer_credit_lots l join finance_private.credit_lot_accounts a on a.credit_lot_id=l.id where l.transfer_id=$1', [transfer.id])).rows[0];
    const policy = await f.rpc('create_package_grant_policy', { p_content: { name: 'Synthetic reviewed real-credit conversion', eligible_package_contract_version_ids: [f.policyId], currency: 'EGP', valuation_rule: 'reviewed_exact_source_credit', maximum_credit_quanta_per_grant: 1000, maximum_carrying_value_minor_per_grant: 50000 }, p_idempotency_key: randomUUID() });
    await f.rpc('approve_package_grant_policy', { p_grant_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Explicit actual source credit valuation', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const intentArgs = { p_source_credit_id: credit.id, p_package_purchase_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_grant_policy_version_id: policy.resource_id, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_expected_version: credit.version, p_idempotency_key: randomUUID() };
    expect((await f.admin.rpc('authorize_credit_conversion', intentArgs)).error).not.toBeNull();
    const intent = await f.rpc('authorize_credit_conversion', intentArgs, f.learner);
    const grantArgs = { p_package_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_currency: 'EGP', p_grant_kind: 'approved_credit', p_grant_policy_version_id: policy.resource_id, p_source_credit_id: credit.id, p_credit_conversion_intent_id: intent.credit_conversion_intent_id, p_reason: 'Consume the exact source owner authorization', p_evidence_file_id: null, p_expected_version: 1, p_idempotency_key: randomUUID() };
    expect((await f.admin.rpc('approve_package_grant', { ...grantArgs, p_carrying_value_minor: 49999 })).error?.message).toBe('CONSENT_REQUIRED');
    const competingArgs = [grantArgs, { ...grantArgs, p_idempotency_key: randomUUID() }];
    const raced = await raceBookingCalls(competingArgs.map(args => ({ client: f.admin, name: 'approve_package_grant', args })));
    expect(raced.filter(result => !result.error)).toHaveLength(1);
    expect(['VERSION_CONFLICT', 'RETRYABLE_CONFLICT']).toContain(raced.find(result => result.error)?.error);
    const winningIndex = raced.findIndex(result => !result.error), grant = raced[winningIndex].data as Record<string, unknown>;
    expect(await f.rpc('approve_package_grant', competingArgs[winningIndex])).toEqual(grant);
    const detail = await getMyPackage(f.learner, f.purchaseId);
    expect(detail.package).toMatchObject({ purchase_state: 'pending_funding', purchased_granted_credit_quanta: 0, usable_available_credit_quanta: 1000, usable_available_value_minor: 50000, charge: { allocated_minor: 0, balance_minor: 150000 } });
    const lot = (await f.database.query("select created_at,expires_at from app_private.package_lots where id=$1 and origin_kind='approved_credit'", [grant.lot_id])).rows[0];
    expect(new Date(lot.expires_at).getTime() - new Date(lot.created_at).getTime()).toBe(90 * 86400000);
    const sources = (await f.database.query("select origin_kind,transfer_id,credit_application_id,amount_minor from finance_private.package_funding_sources where original_lot_id=$1", [grant.lot_id])).rows;
    expect(sources).toEqual([{ origin_kind: 'approved_credit', transfer_id: transfer.id, credit_application_id: expect.any(String), amount_minor: '50000' }]);
    const lines = (await f.database.query('select account_code,sum(signed_minor)::text amount from finance_private.ledger_lines where lot_id=$1 group by account_code order by account_code', [grant.lot_id])).rows;
    expect(lines).toEqual([{ account_code: 'deferred_package_obligation', amount: '-50000' }, { account_code: 'unapplied_customer_funds', amount: '50000' }]);
    expect((await f.rpc('get_my_transfer', { p_transfer_id: transfer.id }, f.learner)).transfer).toMatchObject({ available_minor: 0 });
  } finally { await f.close(); }
});

test('a payment-only guardian source owner loses grant authority immediately when the relationship is revoked', async () => {
  const f = await paymentFixture();
  try {
    const contacts = await f.rpc('get_my_verified_contacts', {}, f.tutor);
    const contact = (contacts.items as { contact_id: string }[])[0];
    const invitation = await f.rpc('create_guardian_invitation', { p_contact_id: contact.contact_id, p_scopes: ['payments'], p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_idempotency_key: randomUUID() }, f.learner);
    const event = (await f.database.query("select payload from app_private.domain_events where aggregate_id=$1 and event_type='guardian_invitation_created'", [invitation.invitation_id])).rows[0].payload;
    const link = await f.rpc('accept_guardian_invitation', { p_invitation_id: invitation.invitation_id, p_single_use_token: event.single_use_token, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.tutor);
    const account = await f.receiving(), transfer = await f.transfer(account.id, 50000, true, false);
    const ownership = await f.evidence({ purpose: 'payer_ownership', parentType: 'transfer', parentId: transfer.id });
    await f.rpc('bind_transfer_payer', { p_transfer_id: transfer.id, p_payer_account_id: f.actor.id, p_evidence_file_id: ownership, p_reason: 'Isolated guardian is actual source payer', p_expected_version: transfer.version, p_idempotency_key: randomUUID() }, f.reviewer);
    const credit = (await f.database.query('select l.id,a.version from finance_private.customer_credit_lots l join finance_private.credit_lot_accounts a on a.credit_lot_id=l.id where l.transfer_id=$1', [transfer.id])).rows[0];
    const policy = await f.rpc('create_package_grant_policy', { p_content: { name: 'Exact isolated guardian credit', eligible_package_contract_version_ids: [f.policyId], currency: 'EGP', valuation_rule: 'reviewed_exact_source_credit', maximum_credit_quanta_per_grant: 1000, maximum_carrying_value_minor_per_grant: 50000 }, p_idempotency_key: randomUUID() });
    await f.rpc('approve_package_grant_policy', { p_grant_policy_version_id: policy.resource_id, p_effective_at: new Date().toISOString(), p_approval_note: 'Reviewed exact source', p_expected_version: 1, p_idempotency_key: randomUUID() });
    const intent = await f.rpc('authorize_credit_conversion', { p_source_credit_id: credit.id, p_package_purchase_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_grant_policy_version_id: policy.resource_id, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_expected_version: credit.version, p_idempotency_key: randomUUID() }, f.tutor);
    await f.rpc('revoke_guardian_link', { p_guardian_link_id: link.guardian_link_id, p_reason: 'End payment authority', p_expected_version: 1, p_idempotency_key: randomUUID() }, f.learner);
    const args = { p_package_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_currency: 'EGP', p_grant_kind: 'approved_credit', p_grant_policy_version_id: policy.resource_id, p_source_credit_id: credit.id, p_credit_conversion_intent_id: intent.credit_conversion_intent_id, p_reason: 'Cannot consume revoked beneficiary authority', p_evidence_file_id: null, p_expected_version: 1, p_idempotency_key: randomUUID() };
    const results = await raceBookingCalls([{ client: f.admin, name: 'approve_package_grant', args }, { client: f.admin, name: 'approve_package_grant', args: { ...args, p_idempotency_key: randomUUID() } }]);
    expect(results.map(result => result.error)).toEqual(['NOT_FOUND', 'NOT_FOUND']);
    expect((await f.database.query("select count(*)::int n from app_private.package_lots where purchase_id=$1 and origin_kind='approved_credit'", [f.purchaseId])).rows[0].n).toBe(0);
    expect((await f.database.query('select finance_private.finance_credit_available($1) amount', [credit.id])).rows[0].amount).toBe('50000');
  } finally { await f.close(); }
});
