import { randomUUID } from 'node:crypto';
import { expect,test } from 'vitest';
import { authClient } from '../helpers/supabase';
import { packageFixture } from '../helpers/packages';
import { raceBookingCalls } from '../helpers/booking';
import { additionalPackageContract } from '../helpers/package-proposals';
import { invokePackageCommandWithStatus } from '../../src/modules/packages/commands';
import { getPackageProposal,listPackageOperationProposals } from '../../src/modules/packages/queries';

test('partial named coverage requires reviewed immutable cash terms and current customer consent before reservation',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),policy=await f.grantPolicy(150000);await f.grant(purchase.resource_id as string,policy,150000);
  const hold=await f.hold();const input={p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_expected_version:1,p_reason:'Customer asks for reviewed partial service',p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:2,credit_quanta:500,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()}};
  const request=await f.rpc('create_operation_proposal',{...input,p_idempotency_key:randomUUID()},f.learner);
  const initial=await getPackageProposal(f.learner,request.proposal_id as string);expect(initial.can_accept).toBe(false);expect(initial.kind).toBe('package_coverage');
  const forbidden=await f.learner.rpc('accept_operation_proposal',{p_proposal_id:request.proposal_id,p_terms_hash:initial.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()});expect(forbidden.error?.message).toBe('DEPENDENCY_UNAVAILABLE');
  const reviewed=await f.rpc('create_operation_proposal',{...input,p_requested_terms:{...input.p_requested_terms,remaining_service_price_minor:12345,replaces_proposal_id:request.proposal_id,expected_replaced_version:1},p_idempotency_key:randomUUID()});
  expect((await getPackageProposal(f.learner,request.proposal_id as string)).state).toBe('expired');
  const terms=await getPackageProposal(f.learner,reviewed.proposal_id as string);expect(terms.can_accept).toBe(true);if(terms.kind!=='package_coverage')throw Error('wrong proposal');expect(terms.terms.agreed_top_up_minor).toBe(12345);expect(terms.terms.carrying_value_minor).toBe(25000);
  expect((await f.students[1].rpc('get_operation_proposal',{p_proposal_id:reviewed.proposal_id,p_view:'customer'})).error?.message).toBe('NOT_FOUND');
  expect(JSON.stringify(terms)).not.toMatch(/tutor_fee|compensation|margin|internal_note/);
  await f.rpc('accept_operation_proposal',{p_proposal_id:reviewed.proposal_id,p_terms_hash:terms.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  const beforeReview=await f.learner.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:500,p_coverage_proposal_id:reviewed.proposal_id,p_expected_version:2,p_idempotency_key:randomUUID()});expect(beforeReview.error?.message).toBe('CONSENT_REQUIRED');
  await f.rpc('approve_operation_proposal',{p_proposal_id:reviewed.proposal_id,p_terms_hash:terms.terms_hash,p_decision:'approved',p_reason:'Exact remaining service reviewed',p_expected_version:1,p_idempotency_key:randomUUID()});
  const args={p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:500,p_coverage_proposal_id:reviewed.proposal_id,p_expected_version:2,p_idempotency_key:randomUUID()};
  const reserved=await f.rpc('reserve_package_credit',args,f.learner);expect(reserved.top_up_minor).toBe(12345);expect(await f.rpc('reserve_package_credit',args,f.learner)).toEqual(reserved);
  expect((await getPackageProposal(f.learner,reviewed.proposal_id as string)).state).toBe('committed');
  expect((await f.database.query('select purchase_state from app_private.package_purchases where id=$1',[purchase.resource_id])).rows[0].purchase_state).toBe('pending_funding');
 }finally{await f.close()}
});

test('T05 package coverage commands recognize the typed kind and fail closed for a missing target',async()=>{
 const client=await authClient('admin_a');
 try{
  const response=await client.rpc('create_operation_proposal',{p_kind:'package_coverage',p_target_id:randomUUID(),p_requested_terms:{target_type:'enrollment',package_purchase_id:randomUUID(),expected_package_version:1,credit_quanta:1000,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Synthetic missing package target',p_expected_version:1,p_idempotency_key:randomUUID()});
  expect(response.error?.message).toBe('NOT_FOUND');
 }finally{await client.auth.signOut({scope:'local'})}
});

test('payments-only guardian can consent to package renewal but never enrollment coverage, and revocation invalidates saved consent',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase();const contact=(await f.database.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null',[f.actor.id])).rows[0].id;
  const invitation=await f.rpc('create_guardian_invitation',{p_contact_id:contact,p_scopes:['payments'],p_expires_at:new Date(Date.now()+3600000).toISOString(),p_idempotency_key:randomUUID()},f.learner);
  const token=(await f.database.query("select payload->>'single_use_token' token from app_private.domain_events where event_type='guardian_invitation_created' and aggregate_id=$1",[invitation.invitation_id])).rows[0].token;
  const link=await f.rpc('accept_guardian_invitation',{p_invitation_id:invitation.invitation_id,p_single_use_token:token,p_expected_version:1,p_idempotency_key:randomUUID()},f.tutor);
  const created=await f.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:f.policyId,expected_target_version:null,source_credit_quanta:0,target_credit_quanta:0,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Renewal purchase with no carryover',p_expected_version:1,p_idempotency_key:randomUUID()});
  const proposal=await getPackageProposal(f.tutor,created.proposal_id as string);expect(proposal.can_accept).toBe(true);if(proposal.kind!=='package_conversion')throw Error('wrong proposal');expect(proposal.terms).toMatchObject({creates_new_purchase:true,new_purchase_credit_quanta:3000,new_purchase_value_minor:150000,source_credit_quanta:0,target_credit_quanta:0,lot_allocations:[]});
  const hold=await f.hold();const denied=await f.tutor.rpc('create_operation_proposal',{p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:1,credit_quanta:500,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Unauthorized booking scope',p_expected_version:1,p_idempotency_key:randomUUID()});expect(denied.error?.message).toBe('NOT_FOUND');
  const accept={p_proposal_id:created.proposal_id,p_terms_hash:proposal.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()};await f.rpc('accept_operation_proposal',accept,f.tutor);
  await f.rpc('approve_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:proposal.terms_hash,p_decision:'approved',p_reason:'Reviewed exact new purchase terms',p_expected_version:1,p_idempotency_key:randomUUID()});
  await f.rpc('revoke_guardian_link',{p_guardian_link_id:link.guardian_link_id,p_reason:'Withdraw payment authority',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  expect((await f.tutor.rpc('accept_operation_proposal',accept)).error?.message).toBe('NOT_FOUND');
  const deniedRenewal=await f.admin.rpc('renew_package',{p_package_id:purchase.resource_id,p_new_contract_version_id:f.policyId,p_transfer_credit_quanta:0,p_accepted_terms_hash:proposal.terms.new_contract_terms_hash,p_conversion_proposal_id:created.proposal_id,p_expected_version:1,p_idempotency_key:randomUUID()});expect(deniedRenewal.error?.message).toBe('CONSENT_REQUIRED');
 }finally{await f.close()}
});

test('current source versions, exact direct-RPC terms and expiry prevent stale or malformed consent',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),grantPolicy=await f.grantPolicy();await f.grant(purchase.resource_id as string,grantPolicy);
  const hold=await f.hold();const input={p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_expected_version:1,p_reason:'Exact package coverage consent',p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:2,credit_quanta:1000,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()}};
  for(const extra of [{expires_at:'tomorrow'},{credit_quanta:1.5},{carrying_value_minor:50000}]){const invalid=await f.learner.rpc('create_operation_proposal',{...input,p_requested_terms:{...input.p_requested_terms,...extra},p_idempotency_key:randomUUID()});expect(['INVALID_TIME','VALIDATION_ERROR']).toContain(invalid.error?.message)}
  const created=await f.rpc('create_operation_proposal',{...input,p_idempotency_key:randomUUID()},f.learner);const view=await getPackageProposal(f.learner,created.proposal_id as string);
  await f.grant(purchase.resource_id as string,grantPolicy,0,1000,2);
  expect((await getPackageProposal(f.learner,created.proposal_id as string)).can_accept).toBe(false);
  const stale=await f.learner.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()});expect(stale.error?.message).toBe('VERSION_CONFLICT');
  const ending=await f.rpc('create_operation_proposal',{...input,p_requested_terms:{...input.p_requested_terms,expected_package_version:3,expires_at:new Date(Date.now()+750).toISOString()},p_idempotency_key:randomUUID()},f.learner);
  await new Promise(resolve=>setTimeout(resolve,800));
  const expired=(await f.database.query('select app_private.package_expire_proposals($1) ids',[purchase.resource_id])).rows[0].ids;expect(expired).toContain(ending.proposal_id);expect((await getPackageProposal(f.learner,ending.proposal_id as string)).state).toBe('expired');
 }finally{await f.close()}
});

test('independent accepted coverage proposals cannot reserve the same final entitlement twice',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),policy=await f.grantPolicy();await f.grant(purchase.resource_id as string,policy,0,1000);
  const calls=[];
  for(let index=0;index<2;index++){
   const hold=await f.hold();const created=await f.rpc('create_operation_proposal',{p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:2,credit_quanta:1000,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Explicit last-credit coverage',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
   const view=await getPackageProposal(f.learner,created.proposal_id as string);await f.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
   calls.push({client:f.learner,name:'reserve_package_credit',args:{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:created.proposal_id,p_expected_version:2,p_idempotency_key:randomUUID()}});
  }
  const results=await raceBookingCalls(calls);expect(results.filter(row=>row.error===null)).toHaveLength(1);expect(results.find(row=>row.error)?.error).toBe('VERSION_CONFLICT');
  const balance=(await f.database.query('select app_private.package_balance($1) value',[purchase.resource_id])).rows[0].value;expect(balance.reserved_credit_quanta).toBe(1000);expect(balance.available_credit_quanta).toBe(0);
  expect((await f.database.query('select count(*)::int count from app_private.package_proposal_consumptions c join app_private.package_operation_terms t on t.proposal_id=c.proposal_id where t.source_purchase_id=$1',[purchase.resource_id])).rows[0].count).toBe(1);
 }finally{await f.close()}
});

test('value coverage requires explicit 7500 top-up consent while named coverage does not infer a debt',async()=>{
 const f=await packageFixture({coverageRule:'allocated_value_with_explicit_top_up'});try{
  const purchase=await f.purchase(),policy=await f.grantPolicy(150000);await f.grant(purchase.resource_id as string,policy,150000);const hold=await f.hold();
  const args={p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()};expect((await f.learner.rpc('reserve_package_credit',args)).error?.message).toBe('CONSENT_REQUIRED');
  const created=await f.rpc('create_operation_proposal',{p_kind:'package_coverage',p_target_id:hold.enrollmentId,p_requested_terms:{target_type:'enrollment',package_purchase_id:purchase.resource_id,expected_package_version:2,credit_quanta:1000,remaining_service_price_minor:null,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Accept exact value top-up',p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  const view=await getPackageProposal(f.learner,created.proposal_id as string);if(view.kind!=='package_coverage')throw Error('wrong proposal');expect(view.terms).toMatchObject({carrying_value_minor:50000,standalone_reference_price_minor:57500,agreed_top_up_minor:7500});
  await f.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  const reserved=await invokePackageCommandWithStatus(f.learner,'reserve_package_credit',{...args,p_coverage_proposal_id:created.proposal_id,p_idempotency_key:randomUUID()});expect(reserved.data.top_up_minor).toBe(7500);
  expect((await f.learner.rpc('confirm_occurrence',{p_occurrence_id:hold.occurrenceId,p_expected_version:1,p_idempotency_key:randomUUID()})).error).toBeTruthy();
 }finally{await f.close()}
});

test('approved duration conversion preserves original value and expiry through an explicit signed quantity adjustment',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),policy=await f.grantPolicy(50000);const granted=await f.grant(purchase.resource_id as string,policy,50000,1000);const target=await additionalPackageContract(f);
  const created=await f.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:target.policyId,expected_target_version:null,source_credit_quanta:1000,target_credit_quanta:666,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Reviewed 60 to90 minute conversion',p_expected_version:2,p_idempotency_key:randomUUID()});
  const view=await getPackageProposal(f.learner,created.proposal_id as string);if(view.kind!=='package_conversion')throw Error('wrong proposal');expect(view.terms).toMatchObject({source_credit_quanta:1000,target_credit_quanta:666,carrying_value_minor:50000,service_duration_delta_second_quanta:-3600});expect(view.terms.lot_allocations).toHaveLength(1);expect(view.terms.lot_allocations[0]).toMatchObject({lot_id:granted.lot_id,source_credit_quanta:1000,target_credit_quanta:666,value_minor:50000});
  await f.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  await f.rpc('approve_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_decision:'approved',p_reason:'Approved exact duration/value/expiry consequences',p_expected_version:1,p_idempotency_key:randomUUID()});
  const args={p_package_id:purchase.resource_id,p_new_contract_version_id:target.policyId,p_transfer_credit_quanta:1000,p_accepted_terms_hash:target.contract.terms_hash,p_conversion_proposal_id:created.proposal_id,p_expected_version:2,p_idempotency_key:randomUUID()};
  const renewed=await invokePackageCommandWithStatus(f.admin,'renew_package',args);expect(renewed.status).toBe(201);expect((await invokePackageCommandWithStatus(f.admin,'renew_package',args)).status).toBe(200);
  const rows=(await f.database.query('select balances,expires_at from app_private.package_lots where purchase_id=$1',[renewed.data.successor_package_id])).rows;expect(rows).toHaveLength(1);expect(rows[0].balances).toMatchObject({transferred_in_credit_quanta:1000,adjustment_credit_quanta:-334,available_credit_quanta:666,available_value_minor:50000,adjustment_value_minor:0});expect(new Date(rows[0].expires_at).toISOString()).toBe(new Date(view.terms.original_expiry_at!).toISOString());
  const acceptance=(await f.database.query('select actor_account_id from app_private.package_purchase_acceptances where purchase_id=$1',[renewed.data.successor_package_id])).rows[0];expect(acceptance.actor_account_id).toBe((await f.learner.auth.getUser()).data.user!.id);
  expect((await getPackageProposal(f.learner,created.proposal_id as string)).state).toBe('committed');
 }finally{await f.close()}
});

test('zero-carryover admin renewal requires customer purchase consent and keeps a paged immutable renewal edge',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),contract=await f.contract();const args={p_package_id:purchase.resource_id,p_new_contract_version_id:f.policyId,p_transfer_credit_quanta:0,p_accepted_terms_hash:contract.terms_hash,p_conversion_proposal_id:null,p_expected_version:1,p_idempotency_key:randomUUID()};
  expect((await f.admin.rpc('renew_package',args)).error?.message).toBe('CONSENT_REQUIRED');
  const created=await f.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:f.policyId,expected_target_version:null,source_credit_quanta:0,target_credit_quanta:0,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'New purchase only with no carryover',p_expected_version:1,p_idempotency_key:randomUUID()});
  const view=await getPackageProposal(f.learner,created.proposal_id as string);await f.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  await f.rpc('approve_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_decision:'approved',p_reason:'Exact new purchase reviewed',p_expected_version:1,p_idempotency_key:randomUUID()});
  const renewed=await invokePackageCommandWithStatus(f.admin,'renew_package',{...args,p_conversion_proposal_id:created.proposal_id,p_idempotency_key:randomUUID()});expect(renewed.data.transfer_ids).toEqual([]);
  const edges=await f.rpc('list_package_renewals',{p_package_id:purchase.resource_id,p_limit:1},f.learner);expect(edges.items).toEqual([expect.objectContaining({source_package_id:purchase.resource_id,target_package_id:renewed.data.successor_package_id})]);
  const row=(await f.database.query('select purchase_state,charge_id from app_private.package_purchases where id=$1',[renewed.data.successor_package_id])).rows[0];expect(row.purchase_state).toBe('pending_funding');expect(row.charge_id).toBe(renewed.data.charge_id);expect(row.charge_id).not.toBe(purchase.charge_id);
  expect((await f.database.query('select count(*)::int count from app_private.package_lots where purchase_id=$1',[renewed.data.successor_package_id])).rows[0].count).toBe(0);
 }finally{await f.close()}
});

test('per-lot service expansion from rounding is rejected before customer conversion consent',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase(),policy=await f.grantPolicy();await f.grant(purchase.resource_id as string,policy,0,1);await f.grant(purchase.resource_id as string,policy,0,2,2);const target=await additionalPackageContract(f);
  const result=await f.admin.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:target.policyId,expected_target_version:null,source_credit_quanta:3,target_credit_quanta:2,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Must not shift service into one source expiry bucket',p_expected_version:3,p_idempotency_key:randomUUID()});expect(result.error?.message).toBe('VALIDATION_ERROR');
 }finally{await f.close()}
});

test('package proposal discovery returns scoped names, state filters and stable cursors',async()=>{
 const f=await packageFixture();try{
  const purchase=await f.purchase();const created=await f.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:f.policyId,expected_target_version:null,source_credit_quanta:0,target_credit_quanta:0,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Discoverable exact renewal request',p_expected_version:1,p_idempotency_key:randomUUID()});
  await f.rpc('create_operation_proposal',{p_kind:'package_conversion',p_target_id:purchase.resource_id,p_requested_terms:{target_type:'package_purchase',target_package_id:null,new_contract_version_id:f.policyId,expected_target_version:null,source_credit_quanta:0,target_credit_quanta:0,expires_at:new Date(Date.now()+600000).toISOString()},p_reason:'Second discoverable request exercises cursor',p_expected_version:1,p_idempotency_key:randomUUID()});
  async function findOwn(client:typeof f.learner,state:'proposed'|'approved'){
   const seen=new Set<string>();let cursor:string|null=null;
   do{const page=await listPackageOperationProposals(client,{learner_id:f.learnerId,state,cursor,limit:1});for(const row of page.items){expect(seen.has(row.proposal_id)).toBe(false);seen.add(row.proposal_id);expect(row.state).toBe(state)}const own=page.items.find(row=>row.proposal_id===created.proposal_id);if(own)return own;cursor=page.next_cursor;}while(cursor);
   throw Error('Own proposal missing from scoped paginated collection');
  }
  const own=await findOwn(f.learner,'proposed');expect(own).toMatchObject({proposal_id:created.proposal_id,learner:{learner_id:f.learnerId},state:'proposed',can_accept:true});expect(own.learner.display_name.length).toBeGreaterThan(0);
  expect((await findOwn(f.admin,'proposed')).can_accept).toBe(false);
  const view=await getPackageProposal(f.learner,created.proposal_id as string);await f.rpc('accept_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_expected_version:1,p_idempotency_key:randomUUID()},f.learner);
  await f.rpc('approve_operation_proposal',{p_proposal_id:created.proposal_id,p_terms_hash:view.terms_hash,p_decision:'approved',p_reason:'Test approved discovery',p_expected_version:1,p_idempotency_key:randomUUID()});expect((await findOwn(f.admin,'approved')).version).toBe(2);expect((await findOwn(f.learner,'approved')).can_accept).toBe(false);
  await expect(listPackageOperationProposals(f.students[1],{learner_id:f.learnerId,state:'proposed'})).rejects.toThrow('NOT_FOUND');
 }finally{await f.close()}
});
