import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';
import { availabilityInputSchema, datedExceptionSchema, weeklyIntervalSchema } from './scheduling';
import { meetingStatusSchema, occurrenceStateSchema } from './public-occurrence';

export type BookingRpcClient=IdentityRpcClient;
const codes=new Set(['AUTH_REQUIRED','SESSION_REVOKED','VERIFIED_ACCOUNT_REQUIRED','FORBIDDEN','CONSENT_REQUIRED','OWNER_REQUIRED','NOT_FOUND','VALIDATION_ERROR','AMOUNT_OUT_OF_RANGE','INVALID_TIME','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','CAPACITY_CONFLICT','SCHEDULE_CONFLICT','INSUFFICIENT_FUNDS','INSUFFICIENT_ENTITLEMENT','POLICY_INCOMPLETE','STATE_CONFLICT','WINDOW_CLOSED','DEPENDENCY_UNAVAILABLE','RETRYABLE_CONFLICT']);
export class BookingRpcError extends Error{constructor(public readonly code:string,public readonly field_errors?:{conflicting_occurrence_ids:string[]}){super(code);this.name='BookingRpcError';}}
const conflictDetails=z.object({conflicting_occurrence_ids:z.array(z.uuid()).max(100)}).strict();
export async function bookingRpc(client:BookingRpcClient,name:string,args?:Record<string,unknown>){
  const result=await client.rpc(name,args);
  if(result.error){
    const code=codes.has(result.error.message)?result.error.message:'DEPENDENCY_UNAVAILABLE';
    let details: z.infer<typeof conflictDetails>|undefined;
    if(code==='SCHEDULE_CONFLICT'&&'details' in result.error&&typeof result.error.details==='string'&&result.error.details.length<=5000){
      try{const parsed=conflictDetails.safeParse(JSON.parse(result.error.details));if(parsed.success)details=parsed.data;}catch{/* Never expose unstructured provider/database details. */}
    }
    throw new BookingRpcError(code,details);
  }
  return result;
}
const id=z.uuid(),key=z.string().min(1).max(200),version=z.number().int().positive().max(2147483647),reason=z.string().trim().min(1).max(2000);
const instant=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const target=z.union([z.literal(2),z.literal(3),z.literal(4)]).nullable();
const ids=z.array(id).max(100).refine(value=>new Set(value).size===value.length);
export const proposalStateSchema=z.enum(['proposed','accepted','approved','committed','declined','expired']);
export const enrollmentStateSchema=z.enum(['held','confirmed','expired','cancelled']);
export const waitlistStateSchema=z.enum(['waiting','offered','accepted','expired','cancelled','ineligible']);
const common=z.object({command_id:id,resource_id:id,version});
const write={p_expected_version:version,p_idempotency_key:key};
const finish=<S extends z.ZodRawShape>(shape:S)=>common.extend(shape).strict();
const schedule={p_start_at:instant,p_end_at:instant,p_time_zone:z.literal('Africa/Cairo')};
const scheduleTerms=z.object({target_type:z.literal('occurrence'),start_at:instant,end_at:instant,time_zone:z.literal('Africa/Cairo'),expires_at:instant}).strict().refine(value=>Date.parse(value.end_at)>Date.parse(value.start_at));
const transferTerms=z.object({target_type:z.literal('enrollment'),destination_occurrence_id:id,expires_at:instant}).strict();
const cancellationTerms=z.object({target_type:z.enum(['enrollment','occurrence']),remedy:z.enum(['policy_default','cash_refund','monetary_account_credit','package_entitlement_restoration']),expires_at:instant}).strict();
const proposalInput={p_target_id:id,p_reason:reason,...write};
const availability=z.object({p_tutor_id:id,p_weekly_intervals:z.array(weeklyIntervalSchema).max(70),p_dated_exceptions:z.array(datedExceptionSchema).max(366),p_reason:reason,p_expected_version:z.number().int().min(0).max(2147483647),p_idempotency_key:key}).strict()
  .transform((value,context)=>{
    const parsed=availabilityInputSchema.safeParse({weekly_intervals:value.p_weekly_intervals,dated_exceptions:value.p_dated_exceptions});
    if(!parsed.success){context.addIssue({code:'custom',message:'INVALID_TIME'});return z.NEVER;}
    return {...value,p_weekly_intervals:parsed.data.weekly_intervals,p_dated_exceptions:parsed.data.dated_exceptions};
  });

export const bookingCommands={
  set_availability:{input:availability,output:finish({conflicting_occurrence_ids:ids})},
  create_occurrence:{input:z.object({p_offer_id:id,p_tutor_id:id,...schedule,p_target_tier:target,p_idempotency_key:key}).strict().refine(value=>Date.parse(value.p_end_at)>Date.parse(value.p_start_at)),output:finish({occurrence_id:id,state:occurrenceStateSchema})},
  reserve_enrollment:{input:z.object({p_occurrence_id:id,p_learner_id:id,p_idempotency_key:key}).strict(),output:finish({enrollment_id:id,hold_expires_at:instant,quote_id:id,customer_price_minor:minor,currency:z.literal('EGP')})},
  accept_quote:{input:z.object({p_quote_id:id,p_quote_hash:hash,...write}).strict(),output:finish({accepted_at:instant})},
  confirm_occurrence:{input:z.object({p_occurrence_id:id,...write}).strict(),output:finish({state:occurrenceStateSchema,confirmed_enrollment_ids:ids,meeting_status:meetingStatusSchema})},
  change_occurrence_capacity:{input:z.object({p_occurrence_id:id,p_capacity:z.number().int().min(1).max(4),p_reason:reason,...write}).strict(),output:finish({capacity:z.number().int().min(1).max(4)})},
  join_waitlist:{input:z.object({p_occurrence_id:id,p_learner_id:id,p_idempotency_key:key}).strict(),output:finish({waitlist_entry_id:id,state:waitlistStateSchema})},
  leave_waitlist:{input:z.object({p_waitlist_entry_id:id,...write}).strict(),output:finish({state:waitlistStateSchema})},
  approve_tutor_fee:{input:z.object({p_occurrence_id:id,p_tutor_id:id,p_fee_minor:minor,p_currency:z.literal('EGP'),p_duration_minutes:z.number().int().positive().max(2147483647),p_compensation_policy_version_id:id,p_target_tier:target,p_purpose:z.enum(['initial','amendment']),p_reason:reason,...write}).strict(),output:finish({fee_agreement_id:id})},
  propose_group_amendment:{input:z.object({p_occurrence_id:id,p_add_learner_ids:ids,p_remove_enrollment_ids:ids,p_target_tier:z.union([z.literal(2),z.literal(3),z.literal(4)]),p_fee_agreement_id:id,p_replacement_policy_version_id:id,p_expires_at:instant,p_reason:reason,...write}).strict(),output:finish({amendment_id:id,affected_quote_ids:ids})},
  accept_group_amendment:{input:z.object({p_amendment_id:id,p_terms_hash:hash,...write}).strict(),output:finish({accepted_at:instant})},
  decline_group_amendment:{input:z.object({p_amendment_id:id,p_reason:reason,...write}).strict(),output:finish({state:proposalStateSchema})},
  commit_group_amendment:{input:z.object({p_amendment_id:id,...write}).strict(),output:finish({occurrence_version:version,charge_adjustment_ids:ids})},
  create_operation_proposal:{input:z.discriminatedUnion('p_kind',[
    z.object({...proposalInput,p_kind:z.literal('reschedule'),p_requested_terms:z.union([scheduleTerms,transferTerms])}).strict(),
    z.object({...proposalInput,p_kind:z.literal('cancellation_remedy'),p_requested_terms:cancellationTerms}).strict(),
  ]),output:finish({proposal_id:id,terms_hash:hash,expires_at:instant,required_actions:z.array(z.string())})},
  accept_operation_proposal:{input:z.object({p_proposal_id:id,p_terms_hash:hash,...write}).strict(),output:finish({accepted_at:instant})},
  decline_operation_proposal:{input:z.object({p_proposal_id:id,p_reason:reason,...write}).strict(),output:finish({state:proposalStateSchema})},
  approve_operation_proposal:{input:z.object({p_proposal_id:id,p_terms_hash:hash,p_decision:z.enum(['approved','rejected']),p_reason:reason,...write}).strict(),output:finish({approval_id:id,state:proposalStateSchema})},
  cancel_enrollment:{input:z.object({p_enrollment_id:id,p_reason:reason,p_remedy_proposal_id:id.nullable(),...write}).strict(),output:finish({state:enrollmentStateSchema,remedy_id:id.nullable()})},
  reschedule_occurrence:{input:z.object({p_occurrence_id:id,...schedule,p_reason:reason,p_accepted_proposal_id:id.nullable(),...write}).strict(),output:finish({meeting_status:meetingStatusSchema,calendar_job_id:id})},
  cancel_occurrence:{input:z.object({p_occurrence_id:id,p_reason:reason,p_remedy_proposal_id:id.nullable(),...write}).strict(),output:finish({state:occurrenceStateSchema,affected_enrollment_ids:ids})},
  transfer_enrollment:{input:z.object({p_enrollment_id:id,p_destination_occurrence_id:id,p_accepted_proposal_id:id,...write}).strict(),output:finish({state:enrollmentStateSchema,new_enrollment_id:id,charge_adjustment_ids:ids})},
} as const;
export type BookingCommandName=keyof typeof bookingCommands;
export async function invokeBookingCommandWithStatus(client:BookingRpcClient,name:BookingCommandName,args:Record<string,unknown>){
  if(!Object.hasOwn(bookingCommands,name))throw new BookingRpcError('VALIDATION_ERROR');
  const contract=bookingCommands[name];const parsed=contract.input.safeParse(args);
  if(!parsed.success)throw new BookingRpcError('VALIDATION_ERROR');
  const response=await bookingRpc(client,name,parsed.data);const result=contract.output.safeParse(response.data);
  if(!result.success||![200,201,202].includes(response.status??0))throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');
  return {data:result.data,status:response.status as 200|201|202};
}
