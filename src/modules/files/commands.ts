import { z } from 'zod';
import type { IdentityRpcClient } from '../identity/commands';
export type FileRpcClient=IdentityRpcClient;
export const publicFilePurposeSchema=z.enum(['private_preparation','shared_handout','receipt','statement_evidence','review_evidence']);
export type PublicFilePurpose=z.infer<typeof publicFilePurposeSchema>;
export const fileEvidenceActionSchema=z.enum(['submit_receipt','replace_receipt','create_statement_import','record_manual_transfer','verify_transfer_settlement','create_receiving_account','bind_transfer_payer','record_transfer_reversal','propose_refund_destination','verify_refund_destination','reconcile_refund','record_refund_reversal','resolve_package_financing_hold']);
export const fileFilenameSchema=z.string().min(1).max(255).refine(value=>value===value.trim()&&!/[\\/\x00-\x1f\x7f]/.test(value)&&!['.','..'].includes(value));
const id=z.uuid(),version=z.number().int().positive().max(2147483647),hash=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().min(1).max(200);
const common={command_id:id,resource_id:id,version};
export const fileCommands={
 create_file_upload:{input:z.object({p_purpose:publicFilePurposeSchema,p_parent_id:id.nullable(),p_filename:fileFilenameSchema,p_declared_type:z.enum(['application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv']),p_size_bytes:z.number().int().positive().max(26214400),p_checksum_sha256:hash,p_evidence_action:fileEvidenceActionSchema.nullable().default(null),p_idempotency_key:key}).strict(),output:z.object({...common,file_id:id,upload_path:z.string().regex(/^\/api\/v1\/files\/[a-f0-9-]{36}\/content$/)}).strict()},
 finalize_file_upload:{input:z.object({p_file_id:id,p_checksum_sha256:hash,p_idempotency_key:key}).strict(),output:z.object({...common,scan_state:z.enum(['pending','clean','quarantined']),scan_job_id:id}).strict()},
 publish_shared_file:{input:z.object({p_file_id:id,p_expected_version:version,p_idempotency_key:key}).strict(),output:z.object({...common,publication_state:z.literal('published')}).strict()},
 withdraw_shared_file:{input:z.object({p_file_id:id,p_reason:z.string().trim().min(1).max(2000),p_expected_version:version,p_idempotency_key:key}).strict(),output:z.object({...common,publication_state:z.literal('withdrawn')}).strict()},
}as const;
const codes=new Set(['AUTH_REQUIRED','SESSION_REVOKED','VERIFIED_ACCOUNT_REQUIRED','FORBIDDEN','NOT_FOUND','VALIDATION_ERROR','CONSENT_REQUIRED','STATE_CONFLICT','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','DEPENDENCY_UNAVAILABLE','RETRYABLE_CONFLICT','FILE_TOO_LARGE','FILE_TYPE_INVALID','FILE_CHECKSUM_MISMATCH','FILE_SIZE_MISMATCH','FILE_ARCHIVE_INVALID','SCAN_REQUIRED','UPLOAD_REQUIRED','LEASE_LOST']);
export class FileRpcError extends Error{constructor(public readonly code:string){super(code);this.name='FileRpcError';}}
export async function fileRpc(client:FileRpcClient,name:string,args?:Record<string,unknown>){const result=await client.rpc(name,args);if(result.error)throw new FileRpcError(codes.has(result.error.message)?result.error.message:'DEPENDENCY_UNAVAILABLE');return result;}
export type FileCommandName=keyof typeof fileCommands;
export async function invokeFileCommandWithStatus<N extends FileCommandName>(client:FileRpcClient,name:N,args:Record<string,unknown>){const definition=fileCommands[name];if(!definition)throw new FileRpcError('VALIDATION_ERROR');const input=definition.input.safeParse(args);if(!input.success)throw new FileRpcError('VALIDATION_ERROR');const result=await fileRpc(client,name,input.data),output=definition.output.safeParse(result.data);if(!output.success||![200,201,202].includes(result.status??0))throw new FileRpcError('DEPENDENCY_UNAVAILABLE');return{data:output.data as z.output<(typeof fileCommands)[N]['output']>,status:result.status as 200|201|202};}
