import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';
import { compensationSchema, customerPricingSchema, policyContentSchema } from './policies';

export type CatalogRpcClient = IdentityRpcClient;
const codes=new Set(['AUTH_REQUIRED','SESSION_REVOKED','VERIFIED_ACCOUNT_REQUIRED','FORBIDDEN','NOT_FOUND','VALIDATION_ERROR','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','STATE_CONFLICT','POLICY_INCOMPLETE','DESTINATION_UNVERIFIED','RETRYABLE_CONFLICT']);
export class CatalogRpcError extends Error { constructor(public readonly code:string){super(code);this.name='CatalogRpcError';} }
export async function catalogRpc(client:CatalogRpcClient,name:string,args?:Record<string,unknown>){
  const result=await client.rpc(name,args);
  if(result.error) throw new CatalogRpcError(codes.has(result.error.message)?result.error.message:'DEPENDENCY_UNAVAILABLE');
  return result;
}
const id=z.uuid(); const version=z.number().int().positive().max(2147483647); const key=z.string().trim().min(1).max(200);
const scope=z.enum(['group','private']); const instant=z.iso.datetime({offset:true}); const note=z.string().trim().min(1).max(2000);
const common=z.object({command_id:id,resource_id:id,version}); const errors=z.array(z.string());
export const catalogCommands={
  create_policy_draft:{input:z.object({p_kind:z.literal('booking'),p_scope:scope,p_content:policyContentSchema,p_idempotency_key:key}).strict(),output:common.extend({policy_version_id:id,validation_errors:errors}).strict()},
  update_policy_draft:{input:z.object({p_policy_version_id:id,p_content:policyContentSchema,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({validation_errors:errors}).strict()},
  approve_policy_version:{input:z.object({p_policy_version_id:id,p_effective_at:instant,p_approval_note:note,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({policy_version_id:id,approved_at:instant}).strict()},
  create_pricing_draft:{input:z.object({p_scope:scope,p_customer_pricing:customerPricingSchema,p_compensation:compensationSchema,p_idempotency_key:key}).strict(),output:common.extend({pricing_version_id:id,validation_errors:errors}).strict()},
  update_pricing_draft:{input:z.object({p_pricing_version_id:id,p_customer_pricing:customerPricingSchema,p_compensation:compensationSchema,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({validation_errors:errors}).strict()},
  approve_pricing_version:{input:z.object({p_pricing_version_id:id,p_effective_at:instant,p_approval_note:note,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({pricing_version_id:id,approved_at:instant}).strict()},
  create_offer:{input:z.object({p_subject_id:id,p_format:scope,p_duration_minutes:z.number().int().positive().max(2147483647),p_capacity:z.number().int().min(1).max(4),p_target_tier:z.union([z.literal(2),z.literal(3),z.literal(4)]).nullable(),p_pricing_version_id:id,p_policy_version_id:id,p_idempotency_key:key}).strict(),output:common.extend({offer_id:id}).strict()},
  publish_offer:{input:z.object({p_offer_id:id,p_effective_at:instant,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({published_at:instant}).strict()},
  approve_tutor_profile:{input:z.object({p_tutor_id:id,p_profile_version_id:id,p_decision:z.enum(['approved','rejected']),p_reason:note,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({approved_profile_version_id:id.nullable()}).strict()},
} as const;
export type CatalogCommandName=keyof typeof catalogCommands;
export async function invokeCatalogCommandWithStatus(client:CatalogRpcClient,name:CatalogCommandName,args:Record<string,unknown>){
  if(!Object.hasOwn(catalogCommands,name)) throw new CatalogRpcError('VALIDATION_ERROR');
  const contract=catalogCommands[name]; const parsed=contract.input.safeParse(args);
  if(!parsed.success) throw new CatalogRpcError('VALIDATION_ERROR');
  const response=await catalogRpc(client,name,parsed.data); const result=contract.output.safeParse(response.data);
  if(!result.success || ![200,201,202].includes(response.status??0)) throw new CatalogRpcError('DEPENDENCY_UNAVAILABLE');
  return {data:result.data,status:response.status as 200|201|202};
}
