import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {packageFixture} from '../helpers/packages';
import {invokePackageCommandWithStatus} from '../../src/modules/packages/commands';
import {getMyPackage,getPackageReconciliation} from '../../src/modules/packages/queries';
import {raceBookingCalls} from '../helpers/booking';
describe('T05 immutable same-learner renewal and transfer lineage',()=>{
 let f:Awaited<ReturnType<typeof packageFixture>>;beforeAll(async()=>{f=await packageFixture()},60000);afterAll(async()=>{await f?.close()});
 test('renewal carries existing value without activating or paying the new purchase, then rejects a lineage cycle',async()=>{
  const source=await f.purchase(),policy=await f.grantPolicy(100001);await f.grant(source.resource_id as string,policy,100001,3000);const contract=await f.contract();
  const args={p_package_id:source.resource_id as string,p_new_contract_version_id:f.policyId,p_transfer_credit_quanta:1000,p_accepted_terms_hash:contract.terms_hash as string,p_conversion_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()};
  const result=await invokePackageCommandWithStatus(f.learner,'renew_package',args);expect(result.status).toBe(201);const successor=result.data.successor_package_id;
  expect((await invokePackageCommandWithStatus(f.learner,'renew_package',args)).status).toBe(200);
  const detail=await getMyPackage(f.learner,successor);expect(detail.package).toMatchObject({purchase_state:'pending_funding',purchased_granted_credit_quanta:0,balances:{available_credit_quanta:1000,available_value_minor:33333},charge:{original_minor:150000,balance_minor:null}});expect(detail.renewal_page.items).toHaveLength(1);
  const transfer=await invokePackageCommandWithStatus(f.learner,'transfer_package_credit',{p_package_id:source.resource_id as string,p_target_package_id:successor,p_credit_quanta:2000,p_conversion_proposal_id:null,p_reason:'Synthetic remaining carryover',p_expected_target_version:detail.package.version,p_expected_version:3,p_idempotency_key:randomUUID()});expect(transfer.status).toBe(201);expect(transfer.data.carrying_value_minor).toBe(66668);
  const final=await getMyPackage(f.learner,successor);expect(final.package.balances.available_value_minor).toBe(100001);expect(final.lineage_page.items).toHaveLength(2);
  expect((await f.learner.rpc('transfer_package_credit',{p_package_id:successor,p_target_package_id:source.resource_id,p_credit_quanta:1000,p_conversion_proposal_id:null,p_reason:'Reject synthetic cycle',p_expected_target_version:4,p_expected_version:final.package.version,p_idempotency_key:randomUUID()})).error?.message).toBe('STATE_CONFLICT');
  expect((await getPackageReconciliation(f.admin,successor)).consistent).toBe(true);
 });
 test('zero carryover keeps an immutable renewal edge and admin cannot invent acceptance',async()=>{
  const source=await f.purchase(),contract=await f.contract();const args={p_package_id:source.resource_id,p_new_contract_version_id:f.policyId,p_transfer_credit_quanta:0,p_accepted_terms_hash:contract.terms_hash,p_conversion_proposal_id:null,p_expected_version:1,p_idempotency_key:randomUUID()};
  expect((await f.admin.rpc('renew_package',args)).error?.message).toBe('CONSENT_REQUIRED');const result=await f.rpc('renew_package',{...args,p_idempotency_key:randomUUID()},f.learner);
  expect((await getMyPackage(f.learner,result.successor_package_id as string)).renewal_page.items).toHaveLength(1);
 });
 test('independent transfers cannot move the same final1000 credits twice',async()=>{
  const source=await f.purchase(),targets=[await f.purchase(),await f.purchase()],policy=await f.grantPolicy();await f.grant(source.resource_id as string,policy,0,1000);
  const results=await raceBookingCalls(targets.map(target=>({client:f.learner,name:'transfer_package_credit',args:{p_package_id:source.resource_id,p_target_package_id:target.resource_id,p_credit_quanta:1000,p_conversion_proposal_id:null,p_reason:'Synthetic transfer race',p_expected_target_version:1,p_expected_version:2,p_idempotency_key:randomUUID()}})));
  expect(results.filter(x=>!x.error)).toHaveLength(1);expect(results.find(x=>x.error)?.error).toBe('VERSION_CONFLICT');
 });
 test('booking reservation and available transfer share the learner financial lock',async()=>{
  const source=await f.purchase(),target=await f.purchase(),policy=await f.grantPolicy();await f.grant(source.resource_id as string,policy,0,1000);const hold=await f.hold();
  const results=await raceBookingCalls([{client:f.learner,name:'reserve_package_credit',args:{p_package_id:source.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()}},{client:f.learner,name:'transfer_package_credit',args:{p_package_id:source.resource_id,p_target_package_id:target.resource_id,p_credit_quanta:1000,p_conversion_proposal_id:null,p_reason:'Synthetic reserve-versus-transfer race',p_expected_target_version:1,p_expected_version:2,p_idempotency_key:randomUUID()}}]);
  expect(results.filter(row=>!row.error)).toHaveLength(1);expect(results.find(row=>row.error)?.error).toBe('VERSION_CONFLICT');
  expect((await getPackageReconciliation(f.admin,source.resource_id as string)).consistent).toBe(true);
 });
});
