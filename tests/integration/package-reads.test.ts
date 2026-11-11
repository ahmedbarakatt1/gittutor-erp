import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {packageFixture} from '../helpers/packages';
import {authClient} from '../helpers/supabase';
import {getMyPackage,getPackageCoverageOptions,getPackageReconciliation,listMyPackageLearners,listMyPackages,listPackageContracts,listPackageEnrollments,listPackageGrantPolicies,listPackageMovements} from '../../src/modules/packages/queries';

describe('T05 current-scope package projections and paged histories',()=>{
 let f:Awaited<ReturnType<typeof packageFixture>>,other:Awaited<ReturnType<typeof authClient>>;
 beforeAll(async()=>{f=await packageFixture();other=await authClient('learner_d')},60000);
 afterAll(async()=>{await f?.close();await other?.auth.signOut({scope:'local'})});
 test('actual typed selectors, histories and reconciliation expose only authorized customer fields',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy(100000);await f.grant(purchase.resource_id as string,policy,100000,2000);
  const learners=await listMyPackageLearners(f.learner);expect(learners.items.map(x=>x.learner_id)).toContain(f.learnerId);
  expect((await listPackageContracts(f.learner,{learner_id:f.learnerId,offer_id:f.offerId})).items.map(x=>x.contract_version_id)).toContain(f.policyId);
  expect((await listMyPackages(f.learner,{learner_id:f.learnerId})).items.map(x=>x.package_purchase_id)).toContain(purchase.resource_id);
  const detail=await getMyPackage(f.learner,purchase.resource_id as string);expect(detail.lot_page.items).toHaveLength(1);expect(detail.movement_page.items).toHaveLength(1);expect(detail.renewal_page).toEqual({items:[],next_cursor:null});
  expect(JSON.stringify(detail)).not.toMatch(/compensation|fee_minor|source_credit_id|approval_note|ledger_lines/);
  expect(await getPackageReconciliation(f.admin,purchase.resource_id as string)).toEqual({package_purchase_id:purchase.resource_id,consistent:true,checked_lots:1,violations:[]});
  await expect(getMyPackage(other,purchase.resource_id as string)).rejects.toThrow('NOT_FOUND');
  expect((await listPackageGrantPolicies(f.admin,{status:'approved'})).items.length).toBeGreaterThan(0);
  await expect(listPackageGrantPolicies(f.learner)).rejects.toThrow('FORBIDDEN');
 });
 test('released coverage is history and the next selection uses current available value',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy(50000);await f.grant(purchase.resource_id as string,policy,50000,1000);const hold=await f.hold();
  expect((await listPackageEnrollments(f.learner,{learner_id:f.learnerId,state:'held'})).items.map(x=>x.enrollment_id)).toContain(hold.enrollmentId);
  const option=await getPackageCoverageOptions(f.learner,hold.enrollmentId,{package_id:purchase.resource_id as string});expect(option.current_coverage).toBeNull();expect(option.items[0]).toMatchObject({eligible:true,carrying_value_minor:50000,agreed_top_up_minor:0});
  const saved=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  expect((await getPackageCoverageOptions(f.learner,hold.enrollmentId,{package_id:purchase.resource_id as string})).current_coverage).toMatchObject({reservation_id:saved.resource_id,can_release:true,state:'reserved'});
  await f.rpc('release_package_reservation',{p_reservation_id:saved.resource_id,p_reason:'Synthetic read projection check',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  expect((await getPackageCoverageOptions(f.learner,hold.enrollmentId,{package_id:purchase.resource_id as string})).current_coverage).toBeNull();
  expect((await getMyPackage(f.learner,purchase.resource_id as string)).coverage_page.items[0]).toMatchObject({state:'released',can_release:false});
  const first=await listPackageMovements(f.learner,purchase.resource_id as string,{limit:1});expect(first.items).toHaveLength(1);expect(first.next_cursor).not.toBeNull();
  const second=await listPackageMovements(f.learner,purchase.resource_id as string,{limit:1,cursor:first.next_cursor});expect(second.items).toHaveLength(1);expect(second.items[0].movement_id).not.toBe(first.items[0].movement_id);
 });
 test('value option returns the currently accepted exact coverage proposal and removes it when source changes',async()=>{
  const value=await packageFixture({coverageRule:'allocated_value_with_explicit_top_up'});try{
   const purchase=await value.purchase(),policy=await value.grantPolicy(50000);await value.grant(purchase.resource_id as string,policy,50000,1000);const hold=await value.hold();
   const created=await value.rpc('create_operation_proposal',{p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:2,credit_quanta:1000,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Explicit synthetic top-up option',p_expected_version:1,p_idempotency_key:randomUUID()},value.learner);
   const proposal=await value.rpc('get_operation_proposal',{p_proposal_id:created.proposal_id,p_view:'customer'},value.learner);
   await value.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:proposal.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},value.learner);
   const options=await getPackageCoverageOptions(value.learner,hold.enrollmentId,{package_id:purchase.resource_id as string});expect(options.items[0]).toMatchObject({eligible:true,coverage_proposal_id:created.proposal_id,agreed_top_up_minor:7500,reason:'ELIGIBLE'});
   await value.grant(purchase.resource_id as string,policy,0,1000,2);
   expect((await getPackageCoverageOptions(value.learner,hold.enrollmentId,{package_id:purchase.resource_id as string})).items[0].coverage_proposal_id).toBeNull();
  }finally{await value.close();}
 });
});
