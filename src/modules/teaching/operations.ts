import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';
import { MeetingRpcError } from './meetings';
const id=z.uuid(),version=z.number().int().positive().max(2147483647),instant=z.iso.datetime({offset:true}),key=z.string().min(1).max(200),reason=z.string().trim().min(1).max(2000),common=z.object({command_id:id,resource_id:id,version}).strict();
const ids=z.array(id).min(1).max(100).refine(values=>new Set(values).size===values.length),page={cursor:z.string().max(200).optional(),limit:z.number().int().min(1).max(100).optional()};
export const unavailabilityCaseSchema=z.object({case_id:id,incident_id:id,occurrence_id:id,tutor_id:id,start_at:instant,end_at:instant,owner:z.object({account_id:id,display_name:z.string()}).strict(),status:z.enum(['open','resolved']),version,can_assign:z.boolean(),can_resolve:z.boolean(),resolution_proposal_id:id.nullable()}).strict();
export type UnavailabilityCase=z.infer<typeof unavailabilityCaseSchema>;
const seriesSummary=z.object({series_id:id,title:z.string(),version,created_at:instant}).strict();
const seriesOccurrence=z.object({occurrence_id:id,tutor_id:id,version,start_at:instant,end_at:instant,state:z.enum(['draft','forming','confirmed','in_progress','completion_pending','completed','cancelled'])}).strict();
const changeItem=z.object({occurrence_id:id,proposal_id:id,base_version:version,state:z.enum(['proposed','accepted','approved','committed','declined','expired'])}).strict();
export const occurrenceSeriesSchema=z.object({series_id:id,title:z.string(),version,items:z.array(seriesOccurrence),next_cursor:z.string().nullable()}).strict();
export const seriesChangeSetSchema=z.object({change_set_id:id,series_id:id,state:z.enum(['proposed','partially_committed','committed','closed']),items:z.array(changeItem),next_cursor:z.string().nullable()}).strict();
export type OccurrenceSeries=z.infer<typeof occurrenceSeriesSchema>;
export type SeriesSummary=z.infer<typeof seriesSummary>;
export type SeriesChangeSet=z.infer<typeof seriesChangeSetSchema>;
const change=z.object({occurrence_id:id,expected_version:version,start_at:instant,end_at:instant}).strict().refine(value=>Date.parse(value.end_at)>Date.parse(value.start_at));
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/),proposalState=z.enum(['proposed','accepted','approved','committed','declined','expired']);
const tutorIdentity=z.object({tutor_id:id,display_name:z.string()}).strict();
const reassignmentBase={proposal_id:id,occurrence_id:id,base_occurrence_version:version,version,state:proposalState,expires_at:instant,start_at:instant,end_at:instant,old_tutor:tutorIdentity,new_tutor:tutorIdentity,terms_hash:hash,accepted_at:instant.nullable(),can_accept:z.boolean(),can_approve:z.boolean(),can_commit:z.boolean(),can_decline:z.boolean(),required_actions:z.array(z.enum(['PENDING_ACCEPTANCES','STALE_VERSION','ROLE_REVOKED','AVAILABILITY_CONFLICT','EXPIRED','ADMIN_APPROVAL_REQUIRED']))};
export const reassignmentCustomerTermsSchema=z.object({kind:z.literal('tutor_reassignment'),learner_id:id,enrollment_id:id,source_quote_id:id,policy_version_id:id,customer_price_minor:minor,currency:z.literal('EGP'),charges_unchanged:z.literal(true)}).strict();
export const reassignmentTutorTermsSchema=z.object({tutor_id:id,role:z.enum(['previous','replacement']),amount_kind:z.enum(['release_compensation','teaching_fee']),amount_minor:minor,reference_fee_minor:minor.nullable(),currency:z.literal('EGP'),duration_minutes:version,source_fee_agreement_id:id.nullable(),compensation_policy_version_id:id}).strict();
export const tutorReassignmentSchema=z.discriminatedUnion('view',[
 z.object({...reassignmentBase,view:z.literal('customer'),terms:reassignmentCustomerTermsSchema}).strict(),
 z.object({...reassignmentBase,view:z.literal('tutor'),terms:reassignmentTutorTermsSchema}).strict(),
 z.object({...reassignmentBase,view:z.literal('admin'),terms:z.object({customers:z.array(reassignmentCustomerTermsSchema),previous_tutor:reassignmentTutorTermsSchema,replacement_tutor:reassignmentTutorTermsSchema}).strict(),required_acceptances:z.array(z.object({kind:z.enum(['learner','previous_tutor','replacement_tutor']),participant_id:id,accepted_at:instant.nullable(),current:z.boolean()}).strict())}).strict(),
]);
export type TutorReassignment=z.infer<typeof tutorReassignmentSchema>;
export type ReassignmentCustomerTerms=z.infer<typeof reassignmentCustomerTermsSchema>;
export type ReassignmentTutorTerms=z.infer<typeof reassignmentTutorTermsSchema>;
export const teachingCommands={
 propose_tutor_reassignment:{input:z.object({p_occurrence_id:id,p_new_tutor_id:id,p_new_fee_minor:minor,p_old_tutor_compensation_minor:minor,p_expires_at:instant,p_reason:reason,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({proposal_id:id,state:proposalState}).strict()},
 accept_tutor_reassignment:{input:z.object({p_proposal_id:id,p_terms_hash:hash,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({state:proposalState}).strict()},
 approve_tutor_reassignment:{input:z.object({p_proposal_id:id,p_terms_hash:hash,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({state:z.literal('approved')}).strict()},
 decline_tutor_reassignment:{input:z.object({p_proposal_id:id,p_reason:reason,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({state:z.literal('declined')}).strict()},
 commit_tutor_reassignment:{input:z.object({p_proposal_id:id,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({state:z.literal('committed'),assignment_id:id,fee_agreement_id:id}).strict()},
 report_tutor_unavailability:{input:z.object({p_tutor_id:id,p_from_at:instant,p_to_at:instant,p_reason:reason,p_expected_version:z.number().int().nonnegative().max(2147483647),p_idempotency_key:key}).strict().refine(value=>Date.parse(value.p_to_at)>Date.parse(value.p_from_at)&&Date.parse(value.p_to_at)-Date.parse(value.p_from_at)<=366*86400000),output:common.extend({incident_id:id,affected_count:z.number().int().nonnegative()}).strict()},
 assign_unavailability_case:{input:z.object({p_case_id:id,p_owner_account_id:id,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({owner_account_id:id}).strict()},
 resolve_unavailability_case:{input:z.object({p_case_id:id,p_resolution_proposal_id:id.nullable(),p_reason:reason,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({status:z.literal('resolved')}).strict()},
 create_occurrence_series:{input:z.object({p_title:z.string().trim().min(1).max(120),p_occurrence_ids:ids,p_idempotency_key:key}).strict(),output:common.extend({series_id:id}).strict()},
 create_series_change_set:{input:z.object({p_series_id:id,p_selection:z.discriminatedUnion('mode',[z.object({mode:z.literal('selected'),occurrence_ids:ids}).strict(),z.object({mode:z.literal('from'),from_at:instant}).strict()]),p_changes:z.array(change).min(1).max(100).refine(values=>new Set(values.map(value=>value.occurrence_id)).size===values.length),p_expires_at:instant,p_reason:reason,p_idempotency_key:key}).strict(),output:common.extend({change_set_id:id,proposal_ids:z.array(id).min(1).max(100)}).strict()},
}as const;
const errors=new Set(['AUTH_REQUIRED','SESSION_REVOKED','VERIFIED_ACCOUNT_REQUIRED','FORBIDDEN','NOT_FOUND','VALIDATION_ERROR','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','STATE_CONFLICT','SCHEDULE_CONFLICT','INVALID_TIME','CONSENT_REQUIRED','RETRYABLE_CONFLICT','POLICY_INCOMPLETE']);
async function call(client:IdentityRpcClient,name:string,args:Record<string,unknown>){const result=await client.rpc(name,args);if(result.error)throw new MeetingRpcError(errors.has(result.error.message)?result.error.message:'DEPENDENCY_UNAVAILABLE');return result;}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new MeetingRpcError('DEPENDENCY_UNAVAILABLE');return result.data;}
export async function invokeTeachingCommandWithStatus(client:IdentityRpcClient,name:string,args:Record<string,unknown>){if(!Object.hasOwn(teachingCommands,name))throw new MeetingRpcError('VALIDATION_ERROR');const command=teachingCommands[name as keyof typeof teachingCommands],input=command.input.safeParse(args);if(!input.success)throw new MeetingRpcError('VALIDATION_ERROR');const result=await call(client,name,input.data);return {data:parse(command.output as z.ZodType,result.data),status:result.status??200};}
function parameters(value:Record<string,unknown>){return Object.fromEntries(Object.entries(value).map(([name,item])=>[`p_${name}`,item]));}
const casesFilter=z.object({...page,tutor_id:id.optional(),state:z.enum(['open','resolved']).optional()}).strict(),seriesFilter=z.object({...page,tutor_id:id.optional()}).strict();
const collection=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item),next_cursor:z.string().nullable()}).strict();
export async function listUnavailabilityCases(client:IdentityRpcClient,filters:z.input<typeof casesFilter>={}){return parse(collection(unavailabilityCaseSchema),(await call(client,'list_unavailability_cases',parameters(casesFilter.parse(filters)))).data);}
export async function listOccurrenceSeries(client:IdentityRpcClient,filters:z.input<typeof seriesFilter>={}){return parse(collection(seriesSummary),(await call(client,'list_occurrence_series',parameters(seriesFilter.parse(filters)))).data);}
export async function getOccurrenceSeries(client:IdentityRpcClient,seriesId:string,filters:z.input<z.ZodObject<typeof page>>={}){return parse(occurrenceSeriesSchema,(await call(client,'get_occurrence_series',{p_series_id:id.parse(seriesId),...parameters(z.object(page).strict().parse(filters))})).data);}
export async function getSeriesChangeSet(client:IdentityRpcClient,changeSetId:string,filters:z.input<z.ZodObject<typeof page>>={}){return parse(seriesChangeSetSchema,(await call(client,'get_series_change_set',{p_change_set_id:id.parse(changeSetId),...parameters(z.object(page).strict().parse(filters))})).data);}
const reassignmentView=z.object({view:z.enum(['customer','tutor','admin']).optional(),learner_id:id.optional()}).strict();
const reassignmentFilters=reassignmentView.extend({...page,occurrence_id:id.optional(),state:proposalState.optional()}).strict();
export async function getTutorReassignment(client:IdentityRpcClient,proposalId:string,filters:z.input<typeof reassignmentView>={}){return parse(tutorReassignmentSchema,(await call(client,'get_tutor_reassignment',{p_proposal_id:id.parse(proposalId),...parameters(reassignmentView.parse(filters))})).data);}
export async function listTutorReassignments(client:IdentityRpcClient,filters:z.input<typeof reassignmentFilters>={}){return parse(collection(tutorReassignmentSchema),(await call(client,'list_tutor_reassignments',parameters(reassignmentFilters.parse(filters)))).data);}
