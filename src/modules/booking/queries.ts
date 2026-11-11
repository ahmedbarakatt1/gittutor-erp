import { z } from 'zod';
import { publicPolicySummarySchema } from '../catalog/queries';
import { bookingRpc, BookingRpcError, enrollmentStateSchema, proposalStateSchema, waitlistStateSchema, type BookingRpcClient } from './commands';
import { datedExceptionSchema, weeklyIntervalSchema } from './scheduling';
import { meetingStatusSchema, occurrenceStateSchema, occurrenceSummarySchema, publicOccurrenceSchema } from './public-occurrence';
import { packageProposalSchema } from '../packages/proposal-contract';

const id=z.uuid(),version=z.number().int().positive().max(2147483647),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),integer=z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const instant=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/),target=z.union([z.literal(2),z.literal(3),z.literal(4)]).nullable();
const learner=z.object({learner_id:id,display_name:z.string()}).strict();
const pending=z.array(z.object({proposal_id:id,kind:z.enum(['operation','amendment'])}).strict());
const unavailableFundingSchema=z.object({integration_state:z.literal('awaiting_T06_integration'),eligible:z.literal(false),reason:z.literal('T06_INTEGRATION_REQUIRED'),
  charge_id:id.nullable(),net_charge_minor:minor.nullable(),allocated_minor:minor.nullable(),balance_minor:minor.nullable(),required_for_confirmation_minor:minor,
  reserved_credit_quanta:minor.nullable(),allocated_package_value_minor:minor.nullable(),top_up_minor:minor.nullable(),
}).strict().superRefine((value,context)=>{
  if(value.integration_state==='awaiting_T06_integration'&&(value.eligible||value.reason!=='T06_INTEGRATION_REQUIRED'||
    (['charge_id','net_charge_minor','allocated_minor','balance_minor','reserved_credit_quanta','allocated_package_value_minor','top_up_minor'] as const).some(field=>value[field]!==null)))
    context.addIssue({code:'custom',message:'Unavailable funding cannot assert settlement'});
});
export const readyFundingSchema=z.object({integration_state:z.literal('ready'),eligible:z.boolean(),financially_eligible:z.boolean(),reason:z.enum(['ELIGIBLE','INSUFFICIENT_FUNDS','INSUFFICIENT_ENTITLEMENT','QUOTE_NOT_ACCEPTED','QUOTE_EXPIRED','POLICY_INCOMPLETE','AMENDMENT_PENDING','FINANCING_HOLD','RECONCILIATION_REQUIRED','HOLD_EXPIRED','OCCURRENCE_CANCELLED']),
  charge_id:id.nullable(),net_charge_minor:minor.nullable(),allocated_minor:minor.nullable(),balance_minor:minor.nullable(),required_for_confirmation_minor:minor,
  reserved_credit_quanta:minor.nullable(),allocated_package_value_minor:minor.nullable(),top_up_minor:minor.nullable(),additional_required_minor:minor,
  conditional_amendment_id:id.nullable(),funding_quote_id:id.nullable(),reconciliation_state:z.enum(['clear','requires_review']),
}).strict().superRefine((value,context)=>{
  if(value.eligible&&(!value.financially_eligible||value.reason!=='ELIGIBLE'||value.conditional_amendment_id!==null||value.reconciliation_state!=='clear'))context.addIssue({code:'custom',message:'Booking eligibility requires current unconditional reconciled funding'});
  if(value.financially_eligible&&(value.additional_required_minor!==0||value.reconciliation_state!=='clear'))context.addIssue({code:'custom',message:'Unmet or unresolved funds cannot qualify'});
});
export const fundingSchema=z.union([unavailableFundingSchema,readyFundingSchema]);
export type ReadyFunding=z.infer<typeof readyFundingSchema>;
export const quoteSchema=z.object({quote_id:id,version,enrollment_id:id,learner_id:id,occurrence_id:id,occurrence_version:version,start_at:instant,end_at:instant,time_zone:z.literal('Africa/Cairo'),target_tier:target,customer_price_minor:minor,currency:z.literal('EGP'),policy_version_id:id,pricing_version_id:id,customer_policy:publicPolicySummarySchema,quote_hash:hash,expires_at:instant,accepted_at:instant.nullable(),is_current:z.boolean()}).strict();
export const customerEnrollmentSchema=z.object({enrollment_id:id,version,learner,occurrence:occurrenceSummarySchema,state:enrollmentStateSchema,is_provisional:z.boolean(),hold_expires_at:instant.nullable(),quote:quoteSchema,funding:fundingSchema,meeting_status:meetingStatusSchema,authorized_file_ids:z.array(id),pending_proposals:pending}).strict();
export const availabilitySchema=z.object({tutor_id:id,version:z.number().int().min(0).max(2147483647),time_zone:z.literal('Africa/Cairo'),weekly_intervals:z.array(weeklyIntervalSchema),dated_exceptions:z.array(datedExceptionSchema),committed_occurrence_ids:z.array(id)}).strict();
export const feeAgreementSchema=z.object({fee_agreement_id:id,occurrence_id:id,occurrence_version:version,tutor_id:id,target_tier:target,fee_minor:minor,currency:z.literal('EGP'),duration_minutes:version,compensation_policy_version_id:id,purpose:z.enum(['initial','amendment']),is_current:z.boolean(),approved_at:instant,accepted_at:instant.nullable()}).strict();
const tutorRoster=z.object({enrollment_id:id,learner_id:id,display_name:z.string(),state:enrollmentStateSchema}).strict();
export const tutorOccurrenceSchema=z.object({occurrence:occurrenceSummarySchema,roster:z.array(tutorRoster),fee_agreement:feeAgreementSchema.nullable(),pending_proposals:pending}).strict();
const adminRoster=tutorRoster.extend({version,hold_expires_at:instant.nullable(),quote_id:id,quote_accepted_at:instant.nullable(),funding:fundingSchema,provisional_amendment_id:id.nullable()});
export const adminOccurrenceSchema=z.object({occurrence:occurrenceSummarySchema,roster:z.array(adminRoster),fee_agreement:feeAgreementSchema.nullable(),confirmation_deadline:instant,pending_proposals:pending,
  formation_resolution:z.object({decision_id:id,action:z.enum(['offer_revised_quote_or_cancel','cancel_and_resolve_funding']),recorded_at:instant}).strict().nullable(),
}).strict();
const waitlist=z.object({waitlist_entry_id:id,version,learner_id:id,occurrence:occurrenceSummarySchema,state:waitlistStateSchema,position:z.number().int().positive().nullable(),offered_enrollment_id:id.nullable(),offer_expires_at:instant.nullable()}).strict();

export const customerProposalTermsSchema=z.object({learner_id:id,enrollment_id:id,old_occurrence_id:id,new_occurrence_id:id,old_start_at:instant,old_end_at:instant,start_at:instant,end_at:instant,time_zone:z.literal('Africa/Cairo'),old_customer_price_minor:minor,customer_price_minor:minor,customer_adjustment_minor:integer,currency:z.literal('EGP'),policy_version_id:id,customer_policy:publicPolicySummarySchema,remedy:z.enum(['none','policy_default','cash_refund','monetary_account_credit','package_entitlement_restoration']),remedy_amount_minor:minor.nullable(),restored_credit_quanta:minor.nullable(),released_credit_quanta:minor.optional().default(0),released_value_minor:minor.nullable().optional().default(null),extinguished_credit_quanta:minor.optional().default(0),extinguished_value_minor:minor.optional().default(0)}).strict();
const tutorProposalTerms=z.object({tutor_id:id,occurrence_id:id,start_at:instant,end_at:instant,time_zone:z.literal('Africa/Cairo'),target_tier:target,duration_minutes:version,fee_agreement_id:id.nullable(),fee_minor:minor.nullable(),currency:z.literal('EGP'),compensation_policy_version_id:id.nullable(),fee_agreement_state:z.enum(['pending_approval','approved','reviewed_cancellation']),cancellation_compensation_id:id.nullable().optional().default(null)}).strict();
const proposalBase={proposal_id:id,replaces_proposal_id:id.nullable().optional().default(null),superseded_by_proposal_id:id.nullable().optional().default(null),version,kind:z.enum(['reschedule','cancellation_remedy']),target_type:z.enum(['occurrence','enrollment']),target_id:id,base_version:version,policy_version_id:id,state:proposalStateSchema,expires_at:instant,terms_hash:hash,accepted_at:instant.nullable(),can_accept:z.boolean(),required_actions:z.array(z.string())};
const acceptances=z.array(z.object({participant_type:z.enum(['learner','tutor']),participant_id:id,accepted_at:instant.nullable()}).strict());
function scopedProposal<S extends z.ZodRawShape>(base:S){return z.discriminatedUnion('view',[
  z.object({...base,view:z.literal('customer'),terms:customerProposalTermsSchema}).strict(),
  z.object({...base,view:z.literal('tutor'),terms:tutorProposalTerms}).strict(),
  z.object({...base,view:z.literal('admin'),terms:z.object({customers:z.array(customerProposalTermsSchema),tutor:tutorProposalTerms.nullable()}).strict(),required_acceptances:acceptances}).strict(),
]);}
export const bookingOperationProposalSchema=scopedProposal(proposalBase);
export const operationProposalSchema=z.union([bookingOperationProposalSchema,packageProposalSchema]);
const {proposal_id:unused,...amendmentBase}=proposalBase;void unused;
const groupViews=scopedProposal({...amendmentBase,amendment_id:id,kind:z.literal('group_amendment'),target_type:z.literal('occurrence'),occurrence_id:id,replacement_policy_version_id:id});
export const groupAmendmentSchema=z.discriminatedUnion('view',[groupViews.options[0],groupViews.options[1],groupViews.options[2].extend({add_learner_ids:z.array(id),remove_enrollment_ids:z.array(id)})]);
export type CustomerEnrollment=z.infer<typeof customerEnrollmentSchema>;
export type Quote=z.infer<typeof quoteSchema>;
export type Availability=z.infer<typeof availabilitySchema>;
export type FeeAgreement=z.infer<typeof feeAgreementSchema>;
export type Funding=z.infer<typeof fundingSchema>;
export type TutorOccurrence=z.infer<typeof tutorOccurrenceSchema>;
export type AdminOccurrence=z.infer<typeof adminOccurrenceSchema>;
export type WaitlistEntry=z.infer<typeof waitlist>;
export type CustomerProposalTerms=z.infer<typeof customerProposalTermsSchema>;
export type TutorProposalTerms=z.infer<typeof tutorProposalTerms>;
export type OperationProposal=z.infer<typeof operationProposalSchema>;
export type GroupAmendment=z.infer<typeof groupAmendmentSchema>;
export type { PublicOccurrence, OccurrenceSummary } from './public-occurrence';

const page={cursor:z.string().max(200).nullable().optional(),limit:z.number().int().min(1).max(100).optional()};
const pagination=z.object(page).strict();
const dates={from:instant.optional(),to:instant.optional()};
const offerFilters=z.object({...page,...dates,offer_id:id,occurrence_id:id.optional()}).strict();
const enrollmentsFilters=z.object({...page,...dates,learner_id:id.optional(),state:enrollmentStateSchema.optional()}).strict();
const waitingFilters=z.object({...page,learner_id:id.optional(),state:waitlistStateSchema.optional()}).strict();
const tutorFilters=z.object({...page,...dates,state:occurrenceStateSchema.optional(),occurrence_id:id.optional()}).strict();
const adminFilters=z.object({...page,...dates,state:occurrenceStateSchema.optional(),format:z.enum(['private','group']).optional(),tutor_id:id.optional(),occurrence_id:id.optional()}).strict();
const dateFilters=z.object({...page,...dates}).strict();
const learnerFilters=z.object({...page,q:z.string().trim().max(120).optional()}).strict();
const viewFilters=z.object({view:z.enum(['customer','tutor','admin']).optional(),learner_id:id.optional()}).strict();
function parameters<S extends z.ZodType>(schema:S,input:unknown,paginated=true){
  const parsed=schema.safeParse(input);if(!parsed.success)throw new BookingRpcError('VALIDATION_ERROR');
  const data=parsed.data as Record<string,unknown>;
  if(data.from&&data.to&&Date.parse(String(data.from))>=Date.parse(String(data.to)))throw new BookingRpcError('INVALID_TIME');
  return Object.fromEntries(Object.entries(paginated?{...data,cursor:data.cursor??null,limit:data.limit??25}:data).map(([key,value])=>[`p_${key}`,value]));
}
const collection=<S extends z.ZodType>(item:S)=>z.object({items:z.array(item),next_cursor:z.string().nullable()}).strict();
async function read<S extends z.ZodType>(client:BookingRpcClient,name:string,schema:S,args?:Record<string,unknown>):Promise<z.output<S>>{
  const parsed=schema.safeParse((await bookingRpc(client,name,args)).data);
  if(!parsed.success)throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');return parsed.data;
}
function oneId(value:string,name:string){if(!id.safeParse(value).success)throw new BookingRpcError('VALIDATION_ERROR');return {[`p_${name}`]:value};}
export const listOfferOccurrences=(client:BookingRpcClient,options:z.input<typeof offerFilters>)=>read(client,'list_offer_occurrences',collection(publicOccurrenceSchema),parameters(offerFilters,options));
export const listMyBookingLearners=(client:BookingRpcClient,options:z.input<typeof pagination>={})=>read(client,'list_my_booking_learners',collection(learner),parameters(pagination,options));
export const listMyEnrollments=(client:BookingRpcClient,options:z.input<typeof enrollmentsFilters>={})=>read(client,'list_my_enrollments',collection(customerEnrollmentSchema),parameters(enrollmentsFilters,options));
export const getEnrollment=(client:BookingRpcClient,enrollmentId:string)=>read(client,'get_enrollment',customerEnrollmentSchema,oneId(enrollmentId,'enrollment_id'));
export const getQuote=(client:BookingRpcClient,quoteId:string)=>read(client,'get_quote',quoteSchema,oneId(quoteId,'quote_id'));
export const listMyWaitlist=(client:BookingRpcClient,options:z.input<typeof waitingFilters>={})=>read(client,'list_my_waitlist',collection(waitlist),parameters(waitingFilters,options));
export const getTutorAvailability=(client:BookingRpcClient)=>read(client,'get_tutor_availability',availabilitySchema);
export const getAdminTutorAvailability=(client:BookingRpcClient,tutorId:string)=>read(client,'get_admin_tutor_availability',availabilitySchema,oneId(tutorId,'tutor_id'));
export const listTutorFeeAgreements=(client:BookingRpcClient,options:z.input<typeof dateFilters>={})=>read(client,'list_tutor_fee_agreements',collection(feeAgreementSchema),parameters(dateFilters,options));
export const listAdminFeeAgreements=(client:BookingRpcClient,occurrenceId:string,options:z.input<typeof pagination>={})=>read(client,'list_admin_fee_agreements',collection(feeAgreementSchema),{...oneId(occurrenceId,'occurrence_id'),...parameters(pagination,options)});
export const listTutorOccurrences=(client:BookingRpcClient,options:z.input<typeof tutorFilters>={})=>read(client,'list_tutor_occurrences',collection(tutorOccurrenceSchema),parameters(tutorFilters,options));
export const listAdminOccurrences=(client:BookingRpcClient,options:z.input<typeof adminFilters>={})=>read(client,'list_admin_occurrences',collection(adminOccurrenceSchema),parameters(adminFilters,options));
export const listBookingLearners=(client:BookingRpcClient,options:z.input<typeof learnerFilters>={})=>read(client,'list_booking_learners',collection(learner),parameters(learnerFilters,options));
export async function getOperationProposal(client:BookingRpcClient,proposalId:string,options:z.input<typeof viewFilters>={}){
  const result=await read(client,'get_operation_proposal',operationProposalSchema,{...oneId(proposalId,'proposal_id'),p_view:'customer',...parameters(viewFilters,options,false)});
  if(result.view!==(options.view??'customer'))throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');return result;
}
export async function getGroupAmendment(client:BookingRpcClient,amendmentId:string,options:z.input<typeof viewFilters>={}){
  const result=await read(client,'get_group_amendment',groupAmendmentSchema,{...oneId(amendmentId,'amendment_id'),p_view:'customer',...parameters(viewFilters,options,false)});
  if(result.view!==(options.view??'customer'))throw new BookingRpcError('DEPENDENCY_UNAVAILABLE');return result;
}
