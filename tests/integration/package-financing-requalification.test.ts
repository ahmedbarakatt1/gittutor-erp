import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { paymentFixture } from '../helpers/payments';
import { adminDatabase, anonymousClient } from '../helpers/supabase';
import { getMyPackage } from '../../src/modules/packages/queries';
import { invokePaymentCommandWithStatus } from '../../src/modules/payments/commands';

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
type Receiving = Awaited<ReturnType<Fixture['receiving']>>;
async function purchaseVersion(f: Fixture, id = f.purchaseId) {
  return (await f.database.query('select version from app_private.package_purchases where id=$1', [id])).rows[0].version as number;
}
async function allocate(f: Fixture, account: Receiving, amount: number) {
  const transfer = await f.transfer(account.id, amount), receipt = await f.receipt(account.versionId, amount);
  const claim = await f.rpc('claim_review_case', { p_case_id: receipt.case_id, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.reviewer);
  const posted = await f.rpc('allocate_transfer', { p_case_id: receipt.case_id, p_transfer_id: transfer.id, p_evidence_version: 1, p_payment_plan_id: null, p_allocations: [{ charge_id: f.chargeId, amount_minor: amount }], p_expected_version: claim.version, p_idempotency_key: randomUUID() }, f.reviewer);
  return { transfer, allocationId: (posted.allocation_ids as string[])[0] };
}
async function reverse(f: Fixture, transferId: string, amount: number) {
  const file = await f.evidence({ purpose: 'transfer_reversal', parentType: 'transfer', parentId: transferId });
  const version = (await f.database.query('select version from finance_private.incoming_transfers where id=$1', [transferId])).rows[0].version;
  return f.rpc('record_transfer_reversal', { p_transfer_id: transferId, p_external_reversal_id: randomUUID(), p_amount_minor: amount, p_effective_at: new Date(Date.now() - 1000).toISOString(), p_evidence_file_id: file, p_expected_version: version, p_idempotency_key: randomUUID() });
}
async function resolutionArgs(f: Fixture) {
  return { p_package_purchase_id: f.purchaseId, p_reason: 'Review actual restored source qualification', p_evidence_file_id: await f.evidence({ purpose: 'financing_hold', parentType: 'package_purchase', parentId: f.purchaseId }), p_expected_version: await purchaseVersion(f), p_idempotency_key: randomUUID() };
}
async function approvedCredit(f: Fixture, transferId: string) {
  const credit = (await f.database.query('select l.id,a.version from finance_private.customer_credit_lots l join finance_private.credit_lot_accounts a on a.credit_lot_id=l.id where l.transfer_id=$1', [transferId])).rows[0];
  const policy = await f.rpc('create_package_grant_policy', { p_content: { name: 'Synthetic source hold qualification', eligible_package_contract_version_ids: [f.policyId], currency: 'EGP', valuation_rule: 'reviewed_exact_source_credit', maximum_credit_quanta_per_grant: 1000, maximum_carrying_value_minor_per_grant: 50000 }, p_idempotency_key: randomUUID() });
  await f.rpc('approve_package_grant_policy', { p_grant_policy_version_id: policy.resource_id, p_effective_at: new Date(Date.now() - 1000).toISOString(), p_approval_note: 'Exact source policy', p_expected_version: 1, p_idempotency_key: randomUUID() });
  const intent = await f.rpc('authorize_credit_conversion', { p_source_credit_id: credit.id, p_package_purchase_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_grant_policy_version_id: policy.resource_id, p_expires_at: new Date(Date.now() + 600000).toISOString(), p_expected_version: credit.version, p_idempotency_key: randomUUID() }, f.learner);
  return f.rpc('approve_package_grant', { p_package_id: f.purchaseId, p_credit_quanta: 1000, p_carrying_value_minor: 50000, p_currency: 'EGP', p_grant_kind: 'approved_credit', p_grant_policy_version_id: policy.resource_id, p_source_credit_id: credit.id, p_credit_conversion_intent_id: intent.credit_conversion_intent_id, p_reason: 'Exact source conversion', p_evidence_file_id: null, p_expected_version: await purchaseVersion(f), p_idempotency_key: randomUUID() });
}
async function history(f: Fixture) {
  return (await f.database.query(`select
    (select jsonb_agg(jsonb_build_object('id',id,'balances',balances,'expires_at',expires_at) order by id) from app_private.package_lots where learner_id=$1) lots,
    (select count(*)::int from app_private.entitlement_movements where purchase_id in(select id from app_private.package_purchases where learner_id=$1)) movements,
    (select count(*)::int from finance_private.ledger_lines where package_purchase_id in(select id from app_private.package_purchases where learner_id=$1)) postings`, [f.learnerId])).rows[0];
}

test('purchased replacement funding releases original and descendant holds without a new grant, then replacement loss holds them again', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), original = await allocate(f, account, 150000);
    const origin = (await f.database.query("select id from app_private.package_lots where purchase_id=$1 and origin_kind='purchase'", [f.purchaseId])).rows[0].id;
    const successor = await f.purchase();
    await f.rpc('transfer_package_credit', { p_package_id: f.purchaseId, p_target_package_id: successor.resource_id, p_credit_quanta: 1000, p_conversion_proposal_id: null, p_reason: 'Preserve original ancestry', p_expected_target_version: 1, p_expected_version: await purchaseVersion(f), p_idempotency_key: randomUUID() }, f.learner);
    await f.grant(f.purchaseId, await f.grantPolicy(5000), 5000, 1000, await purchaseVersion(f));
    const loss = await reverse(f, original.transfer.id, 150000);
    expect((await getMyPackage(f.learner, f.purchaseId)).package).toMatchObject({ financing_state: 'held', usable_available_credit_quanta: 1000, usable_available_value_minor: 5000 });
    expect((await getMyPackage(f.learner, successor.resource_id as string)).package.financing_state).toBe('held');
    await f.rpc('resolve_transfer_reversal', { p_reversal_id: loss.reversal_id, p_allocations: [{ allocation_id: original.allocationId, amount_minor: 150000 }], p_unapplied_minor: 0, p_reason: 'Exact original purchase loss', p_expected_version: loss.version, p_idempotency_key: randomUUID() });
    const replacement = await allocate(f, account, 149999);
    expect((await f.admin.rpc('resolve_package_financing_hold', await resolutionArgs(f))).error?.message).toBe('RECONCILIATION_REQUIRED');
    await allocate(f, account, 1);
    const args = await resolutionArgs(f), before = await history(f);
    const wrongFile = await f.evidence({ purpose: 'financing_hold', parentType: 'package_purchase', parentId: successor.resource_id as string });
    expect((await f.admin.rpc('resolve_package_financing_hold', { ...args, p_evidence_file_id: wrongFile })).error?.message).toBe('EVIDENCE_REQUIRED');
    expect((await f.reviewer.rpc('resolve_package_financing_hold', args)).error?.message).toBe('FORBIDDEN');
    expect((await f.learner.rpc('resolve_package_financing_hold', args)).error?.message).toBe('FORBIDDEN');
    expect((await f.admin.rpc('resolve_package_financing_hold', { ...args, p_expected_version: args.p_expected_version - 1 })).error?.message).toBe('VERSION_CONFLICT');
    const result = await invokePaymentCommandWithStatus(f.admin, 'resolve_package_financing_hold', args);
    expect(result.data).toMatchObject({ state: 'clear', released_original_lot_ids: [origin] });
    expect(await invokePaymentCommandWithStatus(f.admin, 'resolve_package_financing_hold', args)).toEqual(result);
    expect((await f.admin.rpc('resolve_package_financing_hold', { ...args, p_reason: 'Changed committed intent' })).error?.message).toBe('IDEMPOTENCY_CONFLICT');
    expect(await history(f)).toEqual(before);
    expect((await getMyPackage(f.learner, successor.resource_id as string)).package).toMatchObject({ financing_state: 'clear', usable_available_credit_quanta: 1000 });
    expect((await f.database.query('select count(*)::int n from finance_private.package_funding_sources where original_lot_id=$1', [origin])).rows[0].n).toBe(3);
    expect((await f.database.query("select count(*)::int n from app_private.reconciliation_exceptions where source_type='package_financing_hold' and source_id=any($1::uuid[]) and state='open'", [[f.purchaseId, successor.resource_id]])).rows[0].n).toBe(0);
    await reverse(f, replacement.transfer.id, 1);
    expect((await getMyPackage(f.learner, f.purchaseId)).package.financing_state).toBe('held');
    expect((await getMyPackage(f.learner, successor.resource_id as string)).package.financing_state).toBe('held');
  } finally { await f.close(); }
}, 30000);

test('approved-credit release requires its exact unchanged backing; cleared unused loss qualifies but converted loss does not', async () => {
  const f = await paymentFixture();
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 55000);
    const grant = await approvedCredit(f, transfer.id), loss = await reverse(f, transfer.id, 5000);
    expect((await f.admin.rpc('resolve_package_financing_hold', await resolutionArgs(f))).error?.message).toBe('RECONCILIATION_REQUIRED');
    await f.rpc('resolve_transfer_reversal', { p_reversal_id: loss.reversal_id, p_allocations: [], p_unapplied_minor: 5000, p_reason: 'Only unused original source cash lost', p_expected_version: loss.version, p_idempotency_key: randomUUID() });
    const isolatedAdmin = await f.rpc('grant_staff_role', { p_account_id: f.actor.id, p_role: 'admin', p_reason: 'Isolated requalification authority', p_idempotency_key: randomUUID() });
    const args = await resolutionArgs(f), before = await history(f);
    const pending = await f.evidence({ purpose: 'financing_hold', parentType: 'package_purchase', parentId: f.purchaseId, scanState: 'pending' });
    expect((await f.tutor.rpc('resolve_package_financing_hold', { ...args, p_evidence_file_id: pending })).error?.message).toBe('FILE_REJECTED');
    const resolved = await f.rpc('resolve_package_financing_hold', args, f.tutor);
    expect(resolved).toMatchObject({ state: 'clear', released_original_lot_ids: [grant.lot_id] });
    expect(await history(f)).toEqual(before);
    const independent = anonymousClient();
    await independent.auth.signInWithPassword({ email: f.actor.email, password: f.actor.password });
    expect(await f.rpc('resolve_package_financing_hold', args, independent)).toEqual(resolved);
    const token = (await independent.auth.getSession()).data.session!.access_token;
    await independent.auth.signOut({ scope: 'local' });
    const denied = await fetch('http://127.0.0.1:54321/rest/v1/rpc/resolve_package_financing_hold', { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: (await import('../helpers/supabase')).loadLocalSupabase().publishable_key, 'Content-Type': 'application/json', 'Content-Profile': 'api' }, body: JSON.stringify(args) });
    expect(denied.ok).toBe(false);
    await f.rpc('revoke_staff_role', { p_role_grant_id: isolatedAdmin.role_grant_id, p_reason: 'End isolated permission', p_expected_version: 1, p_idempotency_key: randomUUID() });
    expect((await f.tutor.rpc('resolve_package_financing_hold', args)).error?.message).toBe('FORBIDDEN');
    await reverse(f, transfer.id, 1);
    const blocked = await f.admin.rpc('resolve_package_financing_hold', await resolutionArgs(f));
    expect(blocked.error?.message).toBe('RECONCILIATION_REQUIRED');
    expect((await getMyPackage(f.learner, f.purchaseId)).package).toMatchObject({ financing_state: 'held', usable_available_credit_quanta: 0, purchased_granted_credit_quanta: 0 });
  } finally { await f.close(); }
}, 30000);

for (const firstAction of ['release', 'reversal'] as const) test(`requalification and bank reversal serialize when ${firstAction} holds the shared graph first`, async () => {
  const f = await paymentFixture(), connections = await Promise.all([adminDatabase(), adminDatabase()]);
  try {
    const account = await f.receiving(), transfer = await f.transfer(account.id, 55000);
    await approvedCredit(f, transfer.id);
    const loss = await reverse(f, transfer.id, 5000);
    await f.rpc('resolve_transfer_reversal', { p_reversal_id: loss.reversal_id, p_allocations: [], p_unapplied_minor: 5000, p_reason: 'Resolved unused source loss', p_expected_version: loss.version, p_idempotency_key: randomUUID() });
    const release = await resolutionArgs(f), file = await f.evidence({ purpose: 'transfer_reversal', parentType: 'transfer', parentId: transfer.id });
    const transferVersion = (await f.database.query('select version from finance_private.incoming_transfers where id=$1', [transfer.id])).rows[0].version;
    const releaseSql = 'select api.resolve_package_financing_hold($1,$2,$3,$4,$5) data';
    const releaseValues = [release.p_package_purchase_id, release.p_reason, release.p_evidence_file_id, release.p_expected_version, release.p_idempotency_key];
    const reversalSql = 'select api.record_transfer_reversal($1,$2,$3,$4,$5,$6,$7) data';
    const reversalValues = [transfer.id, randomUUID(), 1, new Date(Date.now() - 1000).toISOString(), file, transferVersion, randomUUID()];
    const pids: number[] = [], token = (await f.admin.auth.getSession()).data.session!.access_token;
    for (const connection of connections) {
      await connection.query('begin');
      pids.push((await connection.query('select pg_backend_pid() pid')).rows[0].pid);
      await connection.query("select set_config('request.jwt.claims',$1,true)", [Buffer.from(token.split('.')[1], 'base64url').toString()]);
      await connection.query('set local role authenticated');
    }
    const run = (index: number, action: string) => connections[index].query(action === 'release' ? releaseSql : reversalSql, action === 'release' ? releaseValues : reversalValues).then(result => ({ data: result.rows[0].data, error: null as string | null }), error => ({ data: null, error: (error as Error).message }));
    expect((await run(0, firstAction)).error).toBeNull();
    const pending = run(1, firstAction === 'release' ? 'reversal' : 'release');
    let blocked = false;
    for (let retry = 0; retry < 100; retry++) {
      if (((await f.database.query('select pg_blocking_pids($1) ids', [pids[1]])).rows[0].ids as number[]).includes(pids[0])) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await connections[0].query('commit');
    const second = await pending;
    await connections[1].query(second.error ? 'rollback' : 'commit');
    if (firstAction === 'release') expect(second.error).toBeNull();
    else expect(['VERSION_CONFLICT', 'RECONCILIATION_REQUIRED']).toContain(second.error);
    expect((await getMyPackage(f.learner, f.purchaseId)).package.financing_state).toBe('held');
    expect((await f.database.query('select finance_private.finance_transfer_balance($1) data', [transfer.id])).rows[0].data).toMatchObject({ recovery_exposure_minor: 1, reconciliation_state: 'requires_review' });
  } finally { await Promise.all(connections.map(async connection => { await connection.query('rollback'); await connection.end(); })); await f.close(); }
}, 30000);
