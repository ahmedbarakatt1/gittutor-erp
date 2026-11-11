import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {adminDatabase,authClient} from '../helpers/supabase';
import {catalogFixtureIds} from '../../tools/catalog-seed';
import {policyFixture} from '../unit/policy-vectors';
import {packageFixture} from '../helpers/packages';
import {raceBookingCalls} from '../helpers/booking';
import {packageGrantPolicyContentSchema} from '../../src/modules/packages/commands';

let database:Awaited<ReturnType<typeof adminDatabase>>;
let learner:Awaited<ReturnType<typeof authClient>>;
beforeAll(async()=>{database=await adminDatabase();learner=await authClient('learner_a')});
afterAll(async()=>{await learner?.auth.signOut({scope:'local'});await database?.end()});

test('new package approvals require explicit activation and UTC expiry rules',async()=>{
 const content=policyFixture('group');const pack=content.package_contract as Record<string,unknown>;
 delete pack.purchase_activation_rule;delete pack.expiry_clock;
 const errors=(await database.query('select app_private.catalog_policy_errors($1,$2,true) as errors',[content,'group'])).rows[0].errors;
 expect(errors).toContain('package_contract.purchase_activation_rule');expect(errors).toContain('package_contract.expiry_clock');
});

test('legacy approved package contracts cannot be used for new package purchases',async()=>{
 const user=await learner.rpc('get_my_account');expect(user.error).toBeNull();
 const result=await learner.rpc('purchase_package',{p_learner_id:user.data.authorized_learner_ids[0],p_package_contract_version_id:catalogFixtureIds.group4_policy,p_accepted_terms_hash:'0'.repeat(64),p_idempotency_key:randomUUID()});
 expect(result.error?.message).toBe('POLICY_INCOMPLETE');
});

describe('T05 real package purchases and explicitly approved bonus grants',()=>{
 let fixture:Awaited<ReturnType<typeof packageFixture>>;
 beforeAll(async()=>{fixture=await packageFixture()},60000);
 afterAll(async()=>{await fixture?.close()});
 test('a purchase issues one immutable balanced charge and no usable purchased grant',async()=>{
  const contract=await fixture.contract();
  const args={p_learner_id:fixture.learnerId,p_package_contract_version_id:fixture.policyId,p_accepted_terms_hash:contract.terms_hash,p_idempotency_key:randomUUID()};
  const created=await fixture.rpc('purchase_package',args,fixture.learner);
  expect(await fixture.rpc('purchase_package',args,fixture.learner)).toEqual(created);
  const saved=(await fixture.database.query('select p.purchase_state,c.state,c.amount_minor from app_private.package_purchases p join finance_private.charges c on c.id=p.charge_id where p.id=$1',[created.package_purchase_id])).rows[0];
  expect(saved).toEqual({purchase_state:'pending_funding',state:'issued',amount_minor:'150000'});
  expect((await fixture.database.query('select count(*)::int as n from app_private.package_lots where purchase_id=$1',[created.package_purchase_id])).rows[0].n).toBe(0);
  const journal=(await fixture.database.query('select sum(l.signed_minor)::text as total,count(*)::int as lines from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where t.source_id=$1',[created.charge_id])).rows[0];
  expect(journal).toEqual({total:'0',lines:2});
  await expect(fixture.database.query('update finance_private.charges set amount_minor=1 where id=$1',[created.charge_id])).rejects.toThrow('IMMUTABLE_RECORD');
 });
 test('zero and explicitly subsidized bonus lots cannot settle or activate the purchase',async()=>{
  const purchase=await fixture.purchase();const zero=await fixture.grantPolicy();
  await fixture.grant(purchase.resource_id as string,zero,0,1000);
  const subsidy=await fixture.grantPolicy(100000);
  await fixture.grant(purchase.resource_id as string,subsidy,100000,2000,2);
  const read=await fixture.rpc('get_my_package',{p_package_id:purchase.resource_id},fixture.learner);
  expect(read.package).toMatchObject({purchase_state:'pending_funding',purchased_granted_credit_quanta:0,balances:{available_credit_quanta:3000,available_value_minor:100000},charge:{state:'issued',original_minor:150000,allocated_minor:null,balance_minor:null}});
  expect(JSON.stringify(read)).not.toMatch(/compensation|fee_minor|promotional_subsidy_expense|approved_by|source_credit_id/);
  const accounts=(await fixture.database.query('select distinct account_code from finance_private.ledger_lines where package_purchase_id=$1',[purchase.resource_id])).rows.map(row=>row.account_code);
  expect(accounts).not.toContain('channel_cash');expect(accounts).toContain('promotional_subsidy_expense');
 });
 test('ordinary learners cannot grant and approved-credit cannot invent a funding source',async()=>{
  const purchase=await fixture.purchase();const policy=await fixture.grantPolicy();
  const args={p_package_id:purchase.resource_id,p_grant_policy_version_id:policy,p_credit_quanta:1000,p_carrying_value_minor:0,p_currency:'EGP',p_grant_kind:'complimentary',p_source_credit_id:null,p_reason:'Unauthorized grant regression',p_evidence_file_id:null,p_expected_version:1,p_idempotency_key:randomUUID()};
  expect((await fixture.learner.rpc('approve_package_grant',args)).error?.message).toBe('FORBIDDEN');
  expect((await fixture.admin.rpc('approve_package_grant',{...args,p_grant_kind:'approved_credit',p_source_credit_id:randomUUID(),p_idempotency_key:randomUUID()})).error?.message).toBe('DEPENDENCY_UNAVAILABLE');
 });
 test('available lot allocation excludes expired history and preserves the exact sequential residual',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy(100001);
  await fixture.historicalBonus({purchaseId:purchase.resource_id as string,grantPolicyId:policy,creditQuanta:3000,valueMinor:100001,expired:true});
  await expect(fixture.database.query('select app_private.package_allocate_available($1,$2,null)',[purchase.resource_id,1000])).rejects.toThrow('INSUFFICIENT_ENTITLEMENT');
  const active=await fixture.historicalBonus({purchaseId:purchase.resource_id as string,grantPolicyId:policy,creditQuanta:3000,valueMinor:100001});
  for(const expected of [33333,33334,33334]){
   const allocations=(await fixture.database.query('select app_private.package_allocate_available($1,$2,null) as allocations',[purchase.resource_id,1000])).rows[0].allocations;
   expect(allocations).toHaveLength(1);expect(allocations[0]).toMatchObject({lot_id:active.lotId,credit_quanta:1000,value_minor:expected});
   await fixture.database.query('select app_private.package_append_movement($1,$2,$3,$4,$5,$6)',[active.lotId,'reserve',{available_credit_quanta:-1000,reserved_credit_quanta:1000,available_value_minor:-expected,reserved_value_minor:expected},{credit_quanta:1000,value_minor:expected,from_bucket:'available',to_bucket:'reserved',customer_reason_code:'synthetic_kernel_reservation'},{command_id:randomUUID()},randomUUID()]);
  }
  expect((await fixture.database.query('select balances from app_private.package_lots where id=$1',[active.lotId])).rows[0].balances).toMatchObject({available_credit_quanta:0,available_value_minor:0,reserved_credit_quanta:3000,reserved_value_minor:100001});
 });
 test('due expiry is idempotent and moves only available historical quantity and value',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy(100000);
  const expired=await fixture.historicalBonus({purchaseId:purchase.resource_id as string,grantPolicyId:policy,creditQuanta:2000,valueMinor:100000,expired:true});
  const key=randomUUID();const run=()=>fixture.database.query('select app_private.process_package_due($1,$2) as result',[purchase.resource_id,key]);
  const result=(await run()).rows[0].result;expect(result).toEqual({expired_lot_ids:[expired.lotId],next_due_at:null});expect((await run()).rows[0].result).toEqual(result);
  expect((await fixture.database.query('select balances from app_private.package_lots where id=$1',[expired.lotId])).rows[0].balances).toMatchObject({available_credit_quanta:0,available_value_minor:0,expired_credit_quanta:2000,expired_value_minor:100000});
  expect((await fixture.database.query("select count(*)::int as n from app_private.entitlement_movements where lot_id=$1 and kind='expire'",[expired.lotId])).rows[0].n).toBe(1);
 });
 test('expired ledger availability is excluded from usable balances before any worker mutation',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy(100000);
  const lot=await fixture.historicalBonus({purchaseId:purchase.resource_id as string,grantPolicyId:policy,creditQuanta:2000,valueMinor:100000,expired:true});
  const before=(await fixture.database.query('select balances,version from app_private.package_lots where id=$1',[lot.lotId])).rows[0];
  const detail=await fixture.rpc('get_my_package',{p_package_id:purchase.resource_id},fixture.learner);
  expect(detail.package).toMatchObject({usable_available_credit_quanta:0,usable_available_value_minor:0,balances:{available_credit_quanta:2000,available_value_minor:100000}});
  expect((await fixture.database.query('select balances,version from app_private.package_lots where id=$1',[lot.lotId])).rows[0]).toEqual(before);
 });
 test('aggregate carrying-value overflow returns a canonical error and rolls back the second grant',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy(Number.MAX_SAFE_INTEGER);
  await fixture.grant(purchase.resource_id as string,policy,Number.MAX_SAFE_INTEGER,1000);
  await expect(fixture.grant(purchase.resource_id as string,policy,1,1000,2)).rejects.toThrow('AMOUNT_OUT_OF_RANGE');
  expect((await fixture.database.query('select count(*)::int as n from app_private.package_lots where purchase_id=$1',[purchase.resource_id])).rows[0].n).toBe(1);
 });
 test('full named entitlement carrying50000 covers reference57500 with zero top-up while funding stays unavailable',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy(50000);await fixture.grant(purchase.resource_id as string,policy,50000,1000);
  const hold=await fixture.hold();expect(hold.quote.customer_price_minor).toBe(57500);
  const reservation=await fixture.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},fixture.learner);
  expect(reservation).toMatchObject({reserved_credit_quanta:1000,carrying_value_minor:50000,top_up_minor:0});
  const booking=await fixture.rpc('get_enrollment',{p_enrollment_id:hold.enrollmentId},fixture.learner);expect(booking.funding).toMatchObject({eligible:false,integration_state:'awaiting_T06_integration'});
  await fixture.database.query("update app_private.enrollments set hold_expires_at=now()-interval '1 second' where id=$1",[hold.enrollmentId]);
  await fixture.database.query('select app_private.process_occurrence_booking_due($1,$2)',[hold.occurrenceId,randomUUID()]);
  const read=await fixture.rpc('get_my_package',{p_package_id:purchase.resource_id},fixture.learner);
  expect(read.package).toMatchObject({balances:{available_credit_quanta:1000,reserved_credit_quanta:0,available_value_minor:50000,reserved_value_minor:0}});
 });
 test('independent reservation connections cannot consume the same final1000 quanta twice',async()=>{
  const purchase=await fixture.purchase(),policy=await fixture.grantPolicy();await fixture.grant(purchase.resource_id as string,policy,0,1000);
  const holds=[await fixture.hold(),await fixture.hold()];
  const results=await raceBookingCalls(holds.map(hold=>({client:fixture.learner,name:'reserve_package_credit',args:{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()}})));
  expect(results.filter(result=>!result.error)).toHaveLength(1);expect(['VERSION_CONFLICT','INSUFFICIENT_ENTITLEMENT']).toContain(results.find(result=>result.error)?.error);
  expect((await fixture.database.query('select app_private.package_balance($1) as balances',[purchase.resource_id])).rows[0].balances).toMatchObject({available_credit_quanta:0,reserved_credit_quanta:1000});
 });
 test('direct grant-policy RPC matches strict TypeScript shape for malformed names and contract identities',async()=>{
  const base={name:'Synthetic strict grant',eligible_package_contract_version_ids:[fixture.policyId],currency:'EGP',valuation_rule:'zero_value',maximum_credit_quanta_per_grant:1000,maximum_carrying_value_minor_per_grant:0};
  const invalid=[{...base,name:123},{...base,eligible_package_contract_version_ids:[fixture.policyId,fixture.policyId]},{...base,eligible_package_contract_version_ids:[fixture.policyId.replaceAll('-','')]}];
  for(const content of invalid){expect(packageGrantPolicyContentSchema.safeParse(content).success).toBe(false);expect((await fixture.admin.rpc('create_package_grant_policy',{p_content:content,p_idempotency_key:randomUUID()})).error?.message).toBe('VALIDATION_ERROR');}
 });
});
