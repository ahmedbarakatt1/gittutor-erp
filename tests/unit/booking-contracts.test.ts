import { expect, test } from 'vitest';
import { bookingCommands, bookingRpc, invokeBookingCommandWithStatus } from '../../src/modules/booking/commands';
import { publicOccurrenceSchema } from '../../src/modules/booking/public-occurrence';
import { fundingSchema, getOperationProposal } from '../../src/modules/booking/queries';

const id='ffcc33e4-147b-460a-a687-ea7be75d67fd';
test('reservation accepts only the learner and occurrence, never caller authority or quote prices',async()=>{
  const args={p_occurrence_id:id,p_learner_id:id,p_idempotency_key:'synthetic-key'};
  expect(bookingCommands.reserve_enrollment.input.safeParse(args).success).toBe(true);
  for(const field of ['p_actor','p_customer_price_minor','p_funded','p_now']){
    let called=false;
    await expect(invokeBookingCommandWithStatus({rpc:async()=>{called=true;return {data:null,error:null,status:200}}},'reserve_enrollment',{...args,[field]:123})).rejects.toThrow('VALIDATION_ERROR');
    expect(called).toBe(false);
  }
});
test('typed operation proposals reject arbitrary fee/funding JSON and preserve enrollment transfer shape',()=>{
  const args={p_kind:'reschedule',p_target_id:id,p_requested_terms:{target_type:'enrollment',destination_occurrence_id:id,expires_at:'2026-12-01T10:00:00Z'},p_reason:'Synthetic transfer request',p_expected_version:1,p_idempotency_key:'synthetic-key'};
  expect(bookingCommands.create_operation_proposal.input.safeParse(args).success).toBe(true);
  expect(bookingCommands.create_operation_proposal.input.safeParse({...args,p_requested_terms:{...args.p_requested_terms,fee_minor:62500}}).success).toBe(false);
  expect(bookingCommands.create_operation_proposal.input.safeParse({...args,p_kind:'package_coverage'}).success).toBe(false);
});
test('fee approval requires an explicit purpose and exact integer fee while availability allows initial version zero',()=>{
  const fee={p_occurrence_id:id,p_tutor_id:id,p_fee_minor:62500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:id,p_target_tier:3,p_purpose:'amendment',p_reason:'Future target approval',p_expected_version:1,p_idempotency_key:'key'};
  expect(bookingCommands.approve_tutor_fee.input.safeParse(fee).success).toBe(true);
  expect(bookingCommands.approve_tutor_fee.input.safeParse({...fee,p_fee_minor:62500.5}).success).toBe(false);
  expect(bookingCommands.approve_tutor_fee.input.safeParse({...fee,p_purpose:undefined}).success).toBe(false);
  expect(bookingCommands.set_availability.input.safeParse({p_tutor_id:id,p_weekly_intervals:[],p_dated_exceptions:[],p_reason:'Initial schedule',p_expected_version:0,p_idempotency_key:'key'}).success).toBe(true);
});
test('public occurrence DTO rejects confidential compensation and other learner rosters',()=>{
  const row={occurrence_id:id,version:1,offer_id:id,tutor:{tutor_id:id,display_name:'Synthetic Tutor'},start_at:'2026-12-01T10:00:00Z',end_at:'2026-12-01T11:00:00Z',time_zone:'Africa/Cairo',state:'forming',format:'group',target_tier:3,capacity:4,available_seats:1,waitlist_available:true,customer_price_minor:55000,currency:'EGP',policy_version_id:id,pricing_version_id:id};
  expect(publicOccurrenceSchema.safeParse(row).success).toBe(true);
  for(const field of ['fee_minor','fee_agreement_id','compensation_policy_version_id','roster','internal_notes']) expect(publicOccurrenceSchema.safeParse({...row,[field]:62500}).success).toBe(false);
});
test('customer proposal reads reject an admin response even when its privileged schema is otherwise valid',async()=>{
  const data={proposal_id:id,version:1,kind:'reschedule',target_type:'occurrence',target_id:id,base_version:1,policy_version_id:id,state:'proposed',expires_at:'2026-12-01T10:00:00Z',terms_hash:'a'.repeat(64),accepted_at:null,can_accept:false,required_actions:[],view:'admin',terms:{customers:[],tutor:null},required_acceptances:[]};
  const client={rpc:async()=>({data,error:null,status:200})};
  await expect(getOperationProposal(client,id)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  expect((await getOperationProposal(client,id,{view:'admin'})).view).toBe('admin');
});
test('unavailable funding must not claim eligibility or settled monetary values',()=>{
  const pending={integration_state:'awaiting_T06_integration',eligible:false,reason:'T06_INTEGRATION_REQUIRED',charge_id:null,net_charge_minor:null,allocated_minor:null,balance_minor:null,required_for_confirmation_minor:14375,reserved_credit_quanta:null,allocated_package_value_minor:null,top_up_minor:null};
  expect(fundingSchema.safeParse(pending).success).toBe(true);
  expect(fundingSchema.safeParse({...pending,eligible:true}).success).toBe(false);
  expect(fundingSchema.safeParse({...pending,allocated_minor:0}).success).toBe(false);
});
test('only bounded scoped conflict IDs can cross the database error boundary',async()=>{
  const error={message:'SCHEDULE_CONFLICT',details:JSON.stringify({conflicting_occurrence_ids:[id]})};
  await expect(bookingRpc({rpc:async()=>({data:null,error,status:409})},'set_availability')).rejects.toMatchObject({field_errors:{conflicting_occurrence_ids:[id]}});
  for(const changed of [{...error,message:'FORBIDDEN'},{...error,details:JSON.stringify({conflicting_occurrence_ids:[id],private_fee:62500})},{...error,details:JSON.stringify({conflicting_occurrence_ids:['private note']})},{...error,details:'PRIVATE_PROVIDER_ERROR'}]){
    try{await bookingRpc({rpc:async()=>({data:null,error:changed,status:409})},'set_availability');throw new Error('Expected denial');}
    catch(caught){expect(caught).toMatchObject({code:changed.message});expect((caught as {field_errors?:unknown}).field_errors).toBeUndefined();}
  }
});
