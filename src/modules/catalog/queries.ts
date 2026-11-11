import { z } from 'zod';
import schemas from '../../../contracts/runtime/catalog-schemas.json';
import { catalogRpc, CatalogRpcError, type CatalogRpcClient } from './commands';
import { compensationSchema, customerPricingSchema, policyContentSchema, policyRequiredCommon, type JsonObject } from './policies';
import { publicOccurrenceSchema } from '../booking/public-occurrence';

const id=z.uuid(); const version=z.number().int().positive(); const scope=z.enum(['group','private']); const instant=z.iso.datetime({offset:true});
const status=z.enum(['draft','approved','published','retired']);
const subject=z.object({subject_id:id,title:z.string(),slug:z.string()}).strict();
// Fixed field list: never derive customer permissions by forwarding or spreading a source record.
export const publicPolicyFields=['offer_format','currency','pricing_unit','duration_minutes','customer_pricing_version','private_seat_price_minor',
  'group_target_size','group_capacity','group_minimum_size','hold_minutes','confirmation_deadline_minutes_before_start','formation_failure_action',
  'deposit_basis_points','deposit_rounding','confirmation_funding_sources','amendment_acceptance_rule','amendment_acceptance_minutes',
  'latest_amendment_minutes_before_start','post_confirmation_dropout_price_guarantee','below_minimum_group_action','customer_cancellation_windows',
  'platform_or_tutor_cancellation_remedy','learner_no_show_rule','individual_early_departure_rule','partial_class_remedy_rule','partial_class_rounding',
  'allowed_refund_remedies','package_enabled','package_contract'] as const;
export type PublicPolicySummary=JsonObject & {
  duration_minutes:number;hold_minutes:number;deposit_basis_points:number;deposit_rounding:string;package_enabled:boolean;
  customer_cancellation_windows:{minimum_minutes_before_start:number;maximum_minutes_before_start_exclusive:number|null;refund_basis_points:number}[];
  allowed_refund_remedies:string[];confirmation_funding_sources:string[];
};
const publicRequired=policyRequiredCommon.filter(field=>(publicPolicyFields as readonly string[]).includes(field));
const summarySchema=z.fromJSONSchema({type:'object',additionalProperties:false,
  properties:Object.fromEntries(publicPolicyFields.map(field=>[field,(publicRequired as readonly string[]).includes(field)?schemas.policy_content.properties[field].anyOf[0]:schemas.policy_content.properties[field]])),
  required:publicRequired,
} as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<PublicPolicySummary>;
export { summarySchema as publicPolicySummarySchema };
export function projectCustomerPolicy(content:unknown):PublicPolicySummary {
  const source=typeof content==='object' && content!==null && !Array.isArray(content)?content as JsonObject:{};
  const candidate=Object.fromEntries(publicPolicyFields.filter(field=>Object.hasOwn(source,field)).map(field=>[field,source[field]]));
  const parsed=summarySchema.safeParse(candidate);
  if(!parsed.success) throw new CatalogRpcError('POLICY_INCOMPLETE');
  return parsed.data;
}
const publicOffer=z.object({offer_id:id,title:z.string(),subject,format:scope,duration_minutes:version,capacity:z.number().int().min(1).max(4),target_tier:z.number().int().nullable(),
  seat_price_minor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),currency:z.literal('EGP'),pricing_version_id:id,policy_version_id:id,
  customer_terms_hash:z.string().regex(/^[a-f0-9]{64}$/),policy_summary:summarySchema,
  availability:z.object({scheduled_occurrences:z.number().int().nonnegative(),next_start_at:instant.nullable(),next_occurrences:z.array(publicOccurrenceSchema).max(5),has_more:z.boolean()}).strict()}).strict();
const publicTutor=z.object({tutor_id:id,display_name:z.string(),bio:z.string(),subjects:z.array(subject),photo_reference:z.string().nullable()}).strict();
const provenance={version,environment_scope:z.enum(['production','development_test']),is_synthetic:z.boolean(),approved_by:id.nullable(),approved_at:instant.nullable(),effective_at:instant.nullable(),content_hash:z.string().regex(/^[a-f0-9]{64}$/),validation_errors:z.array(z.string())};
const policy=z.object({policy_version_id:id,kind:z.literal('booking'),scope,status,content:policyContentSchema,...provenance}).strict();
const pricing=z.object({pricing_version_id:id,scope,status,customer_pricing:customerPricingSchema,compensation:compensationSchema,...provenance}).strict();
const adminOffer=z.object({offer_id:id,title:z.string(),subject,format:scope,duration_minutes:version,capacity:z.number().int().min(1).max(4),target_tier:z.number().int().nullable(),pricing_version_id:id,policy_version_id:id,status:z.enum(['draft','published','retired']),version,published_at:instant.nullable(),effective_at:instant.nullable()}).strict();
const profileVersion=z.object({profile_version_id:id,version,display_name:z.string(),bio:z.string(),subject_ids:z.array(id),state:z.enum(['draft','approved','rejected'])}).strict();
const adminTutor=z.object({tutor_id:id,account_id:id,display_name:z.string(),contact_verified:z.boolean(),approved_profile_version_id:id.nullable(),draft_profile_version_id:id.nullable(),version,profile_versions:z.array(profileVersion),approved_subject_ids:z.array(id)}).strict();
export type PublicOffer=z.infer<typeof publicOffer>;
export type PublicTutor=z.infer<typeof publicTutor>;
export type AdminPolicy=z.infer<typeof policy>;
export type AdminPricing=z.infer<typeof pricing>;
export type AdminOffer=z.infer<typeof adminOffer>;
export type AdminTutor=z.infer<typeof adminTutor>;
const page={cursor:z.string().max(150).nullable().optional(),limit:z.number().int().min(1).max(100).optional()};
const publicFilters=z.object({...page,subject_id:id.optional(),format:scope.optional(),from:instant.optional(),to:instant.optional(),offer_id:id.optional()}).strict();
const policyFilters=z.object({...page,kind:z.literal('booking').optional(),scope:scope.optional(),status:status.optional()}).strict();
const pricingFilters=z.object({...page,format:scope.optional(),status:status.optional()}).strict();
const offerFilters=z.object({...page,format:scope.optional(),status:z.enum(['draft','published','retired']).optional()}).strict();
const tutorFilters=z.object({...page,subject_id:id.optional(),active:z.boolean().optional()}).strict();
function filters<S extends z.ZodType>(schema:S,value:unknown){
  const parsed=schema.safeParse(value);if(!parsed.success) throw new CatalogRpcError('VALIDATION_ERROR');
  const data=parsed.data as JsonObject;
  if(data.from && data.to && Date.parse(String(data.from))>=Date.parse(String(data.to))) throw new CatalogRpcError('VALIDATION_ERROR');
  return Object.fromEntries(Object.entries({...data,cursor:data.cursor??null,limit:data.limit??25}).map(([key,value])=>[`p_${key}`,value]));
}
async function read<S extends z.ZodType>(client:CatalogRpcClient,name:string,schema:S,args?:Record<string,unknown>):Promise<z.output<S>>{
  const result=schema.safeParse((await catalogRpc(client,name,args)).data);
  if(!result.success) throw new CatalogRpcError('DEPENDENCY_UNAVAILABLE');return result.data;
}
const collection=<S extends z.ZodType>(item:S)=>z.object({items:z.array(item),next_cursor:z.string().nullable()}).strict();
export const listPublicOffers=(client:CatalogRpcClient,options:z.input<typeof publicFilters>={})=>read(client,'list_public_offers',collection(publicOffer),filters(publicFilters,options));
export function getPublicTutor(client:CatalogRpcClient,tutorId:string){if(!id.safeParse(tutorId).success) throw new CatalogRpcError('VALIDATION_ERROR');return read(client,'get_public_tutor',publicTutor,{p_tutor_id:tutorId});}
export const listPolicies=(client:CatalogRpcClient,options:z.input<typeof policyFilters>={})=>read(client,'list_policies',collection(policy),filters(policyFilters,options));
export const listPricingVersions=(client:CatalogRpcClient,options:z.input<typeof pricingFilters>={})=>read(client,'list_pricing_versions',collection(pricing),filters(pricingFilters,options));
export const listAdminOffers=(client:CatalogRpcClient,options:z.input<typeof offerFilters>={})=>read(client,'list_admin_offers',collection(adminOffer),filters(offerFilters,options));
export const listAdminTutors=(client:CatalogRpcClient,options:z.input<typeof tutorFilters>={})=>read(client,'list_admin_tutors',collection(adminTutor),filters(tutorFilters,options));
