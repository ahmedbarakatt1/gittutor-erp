import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {packageFixture} from '../helpers/packages';
import {adminDatabase} from '../helpers/supabase';
describe('T05 private historical movement kernel, without a T08 qualification claim',()=>{
 let f:Awaited<ReturnType<typeof packageFixture>>;beforeAll(async()=>{f=await packageFixture()},60000);afterAll(async()=>{await f?.close()});
 test('half-session consumption, remaining release and bounded restoration conserve exact quantity and value',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy(50001);await f.grant(purchase.resource_id as string,policy,50001,1000);const hold=await f.hold();
  const reservation=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const allocation=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reservation.resource_id])).rows[0].id;
  // Guarded DBA fixture invokes only the private mechanics, not a deployed qualification endpoint.
  const consume=(await f.database.query('select app_private.package_consume_allocation_kernel($1,$2,$3) as result',[allocation,500,{command_id:randomUUID()}])).rows[0].result;
  expect(consume).toMatchObject({consumed_credit_quanta:500,consumed_value_minor:25000});
  const release=(await f.database.query('select app_private.package_release_reservation_kernel($1,$2,$3) as result',[reservation.resource_id,'synthetic_partial_delivery_remainder',{command_id:randomUUID()}])).rows[0].result;
  expect(release).toMatchObject({released_credit_quanta:500,released_value_minor:25001});
  const remedy=(await f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6) as id',[consume.movement_id,randomUUID(),500,25000,'restoration',{command_id:randomUUID()}])).rows[0].id;
  const restore=(await f.database.query('select app_private.package_restore_kernel($1,$2,$3) as result',[remedy,consume.movement_id,{command_id:randomUUID()}])).rows[0].result;
  expect(restore).toMatchObject({restored_credit_quanta:500,restored_value_minor:25000});
  await expect(f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6)',[consume.movement_id,randomUUID(),1,0,'restoration',{command_id:randomUUID()}])).rejects.toThrow('REMEDY_RESERVED');
  expect((await f.database.query('select app_private.package_balance($1) as b',[purchase.resource_id])).rows[0].b).toMatchObject({available_credit_quanta:1000,available_value_minor:50001,consumed_credit_quanta:0,consumed_value_minor:0});
  const value=(await f.database.query("select coalesce(sum(signed_minor),0)::int as value from finance_private.ledger_lines where package_purchase_id=$1 and account_code='tuition_revenue'",[purchase.resource_id])).rows[0].value;expect(value).toBe(0);
  const currentVersion=(await f.database.query('select version from app_private.package_purchases where id=$1',[purchase.resource_id])).rows[0].version;
  expect((await f.admin.rpc('restore_package_credit',{p_consumption_id:consume.movement_id,p_credit_quanta:1,p_remedy_id:randomUUID(),p_reason:'No invented T06 financial remedy',p_expected_version:currentVersion,p_idempotency_key:randomUUID()})).error?.message).toBe('REMEDY_REQUIRED');
 });
 test('zero-value consumed quantity still has an independent remedy cap',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy();await f.grant(purchase.resource_id as string,policy,0,1000);const hold=await f.hold();
  const reservation=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const allocation=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reservation.resource_id])).rows[0].id;
  const consume=(await f.database.query('select app_private.package_consume_allocation_kernel($1,$2,$3) as r',[allocation,1000,{command_id:randomUUID()}])).rows[0].r;
  await f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6)',[consume.movement_id,randomUUID(),1000,0,'restoration',{command_id:randomUUID()}]);
  await expect(f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6)',[consume.movement_id,randomUUID(),1,0,'cash',{command_id:randomUUID()}])).rejects.toThrow('REMEDY_RESERVED');
 });
 test('independent private consume and release transactions cannot consume a released allocation',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy(50001);await f.grant(purchase.resource_id as string,policy,50001,1000);const hold=await f.hold();
  const reservation=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const allocation=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reservation.resource_id])).rows[0].id;
  const clients=await Promise.all([adminDatabase(),adminDatabase()]);let ready=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve});
  try{
   const results=await Promise.all(clients.map(async(client,index)=>{try{await client.query('begin');if(++ready===2)release();await barrier;
    const result=index===0?await client.query('select app_private.package_consume_allocation_kernel($1,$2,$3)',[allocation,500,{command_id:randomUUID()}]):await client.query('select app_private.package_lock_purchase($1)',[purchase.resource_id]).then(()=>client.query('select app_private.package_release_reservation_kernel($1,$2,$3)',[reservation.resource_id,'synthetic_concurrent_release',{command_id:randomUUID()}]));
    await client.query('commit');return {ok:true,result:result.rows[0]};
   }catch(error){release();await client.query('rollback');return {ok:false,error:(error as Error).message};}}));
   expect(results[1].ok).toBe(true);if(!results[0].ok)expect(results[0].error).toBe('INSUFFICIENT_ENTITLEMENT');
   const balance=(await f.database.query('select app_private.package_balance($1) as b',[purchase.resource_id])).rows[0].b;expect(balance.reserved_credit_quanta).toBe(0);expect(balance.available_credit_quanta+balance.consumed_credit_quanta).toBe(1000);expect(balance.available_value_minor+balance.consumed_value_minor).toBe(50001);
  }finally{await Promise.all(clients.map(client=>client.end()));}
 });
 test('repeated partial consumption and remedies preserve the remaining original allocation and final residual',async()=>{
  const purchase=await f.purchase(),policy=await f.grantPolicy(100001);await f.grant(purchase.resource_id as string,policy,100001,1000);const hold=await f.hold();
  const reservation=await f.rpc('reserve_package_credit',{p_package_id:purchase.resource_id,p_enrollment_id:hold.enrollmentId,p_credit_quanta:1000,p_coverage_proposal_id:null,p_expected_version:2,p_idempotency_key:randomUUID()},f.learner);
  const allocation=(await f.database.query('select id from app_private.package_reservation_allocations where reservation_id=$1',[reservation.resource_id])).rows[0].id;
  const consumptions=[];for(const [q,v] of [[333,33300],[333,33300],[334,33401]]){
   const context={command_id:randomUUID()};const run=()=>f.database.query('select app_private.package_consume_allocation_kernel($1,$2,$3) as r',[allocation,q,context]);const result=(await run()).rows[0].r;expect(result.consumed_value_minor).toBe(v);expect((await run()).rows[0].r).toEqual(result);consumptions.push(result);
  }
  const source=consumptions[2];
  await expect(f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6)',[source.movement_id,randomUUID(),0,1,'cash',{command_id:randomUUID()}])).rejects.toThrow('VALIDATION_ERROR');
  await expect(f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6)',[source.movement_id,randomUUID(),100,1,'restoration',{command_id:randomUUID()}])).rejects.toThrow('VALIDATION_ERROR');
  for(const [q,v] of [[100,10000],[234,23401]]){
   const remedy=(await f.database.query('select app_private.package_reserve_remedy_kernel($1,$2,$3,$4,$5,$6) as id',[source.movement_id,randomUUID(),q,v,'restoration',{command_id:randomUUID()}])).rows[0].id;
   const run=()=>f.database.query('select app_private.package_restore_kernel($1,$2,$3) as r',[remedy,source.movement_id,{command_id:randomUUID()}]);const result=(await run()).rows[0].r;expect(result.restored_value_minor).toBe(v);expect((await run()).rows[0].r).toEqual(result);
  }
  const b=(await f.database.query('select app_private.package_balance($1) as b',[purchase.resource_id])).rows[0].b;expect(b).toMatchObject({available_credit_quanta:334,available_value_minor:33401,consumed_credit_quanta:666,consumed_value_minor:66600,reserved_credit_quanta:0,reserved_value_minor:0});
 });
});
