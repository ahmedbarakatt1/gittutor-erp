import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bookingFixture } from '../helpers/booking';
import { policyFixture } from '../unit/policy-vectors';
import { catalogFixtureIds } from '../../tools/catalog-seed';
import { fixtureId } from '../../tools/db-seed';
import { getMyPackage, getPackageContract, listPackageContracts } from '../../src/modules/packages/queries';

let f: Awaited<ReturnType<typeof bookingFixture>>;
let policyId: string, offerId: string, purchaseId: string, termsHash: string;
let original: { content: Record<string, unknown>; content_hash: string; contract_snapshot: Record<string, unknown>; contract_hash: string };
const snapshot = async () => (await f.database.query('select p.content,p.content_hash,b.contract_snapshot,b.contract_hash from app_private.policy_versions p join app_private.package_purchases b on b.contract_version_id=p.id where p.id=$1 and b.id=$2', [policyId, purchaseId])).rows[0];

beforeAll(async () => {
  f = await bookingFixture();
  const content = policyFixture('group');
  Object.assign(content, { group_target_size: 2, group_minimum_size: 2, group_capacity: 4, customer_pricing_version: catalogFixtureIds.group_pricing, compensation_policy_version: catalogFixtureIds.group_pricing });
  const pack = content.package_contract as Record<string, unknown>;
  Object.assign(pack, { package_policy_version_id: null, eligible_offer_ids: null, expiry_mode: 'none' });
  delete pack.expiry_days; // Valid source contract: this field is inapplicable and may be omitted.
  policyId = (await f.rpc('create_policy_draft', { p_kind: 'booking', p_scope: 'group', p_content: content, p_idempotency_key: randomUUID() })).resource_id as string;
  offerId = (await f.rpc('create_offer', { p_subject_id: fixtureId('subject_calculus'), p_format: 'group', p_duration_minutes: 60, p_capacity: 4, p_target_tier: 2, p_pricing_version_id: catalogFixtureIds.group_pricing, p_policy_version_id: policyId, p_idempotency_key: randomUUID() })).resource_id as string;
  Object.assign(pack, { package_policy_version_id: policyId, eligible_offer_ids: [offerId] });
  await f.rpc('update_policy_draft', { p_policy_version_id: policyId, p_content: content, p_expected_version: 1, p_idempotency_key: randomUUID() });
  await f.rpc('approve_policy_version', { p_policy_version_id: policyId, p_effective_at: new Date().toISOString(), p_approval_note: 'Synthetic no-expiry contract with omitted inapplicable days', p_expected_version: 2, p_idempotency_key: randomUUID() });
  await f.rpc('publish_offer', { p_offer_id: offerId, p_effective_at: new Date().toISOString(), p_expected_version: 1, p_idempotency_key: randomUUID() });
  const raw = await f.rpc('get_package_contract', { p_package_contract_version_id: policyId, p_learner_id: f.learners[0] }, f.students[0]);
  termsHash = raw.terms_hash as string;
  purchaseId = (await f.rpc('purchase_package', { p_learner_id: f.learners[0], p_package_contract_version_id: policyId, p_accepted_terms_hash: termsHash, p_idempotency_key: randomUUID() }, f.students[0])).resource_id as string;
  original = await snapshot();
}, 30000);
afterAll(async () => { await f?.close(); });

test('valid no-expiry contracts round-trip through exact and paged customer/admin selectors', async () => {
  expect(original.contract_snapshot).not.toHaveProperty('expiry_days');
  for (const actor of [f.students[0], f.admin]) {
    const exact = await getPackageContract(actor, policyId, f.learners[0]);
    expect(exact.contract).toMatchObject({ expiry_mode: 'none', expiry_days: null });
    expect(exact.terms_hash).toBe(termsHash);
    const page = await listPackageContracts(actor, { learner_id: f.learners[0], offer_id: offerId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(exact);
    // Also exercise unfiltered discovery, which includes previously published no-expiry fixtures.
    expect((await listPackageContracts(actor, { learner_id: f.learners[0] })).items.length).toBeGreaterThan(0);
  }
  expect(await snapshot()).toEqual(original);
});

test('purchase and renewal preserve original no-expiry source snapshots and hashes while detail is complete', async () => {
  const detail = await getMyPackage(f.students[0], purchaseId);
  expect(detail.contract).toMatchObject({ expiry_mode: 'none', expiry_days: null });
  expect(detail.purchase_terms_hash).toBe(termsHash);
  expect(original.contract_hash).toBe(termsHash);
  const recomputed = (await f.database.query("select app_private.catalog_hash(jsonb_build_object('contract_version_id',$1::uuid,'contract',$2::jsonb)) as hash", [policyId, original.contract_snapshot])).rows[0].hash;
  expect(recomputed).toBe(termsHash);
  const renewed = await f.rpc('renew_package', { p_package_id: purchaseId, p_new_contract_version_id: policyId, p_transfer_credit_quanta: 0, p_accepted_terms_hash: termsHash, p_conversion_proposal_id: null, p_expected_version: 1, p_idempotency_key: randomUUID() }, f.students[0]);
  const next = await getMyPackage(f.students[0], renewed.resource_id as string);
  expect(next.contract.expiry_days).toBeNull();
  expect(next.purchase_terms_hash).toBe(termsHash);
  const saved = (await f.database.query('select contract_snapshot,contract_hash from app_private.package_purchases where id=$1', [renewed.resource_id])).rows[0];
  expect(saved).toEqual({ contract_snapshot: original.contract_snapshot, contract_hash: termsHash });
  expect(await snapshot()).toEqual(original);
});
