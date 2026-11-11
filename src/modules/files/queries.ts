import { z } from 'zod';
import { fileRpc,FileRpcError,publicFilePurposeSchema,type FileRpcClient } from './commands';
export type { PublicFilePurpose } from './commands';
const id=z.uuid(),instant=z.iso.datetime({offset:true}),version=z.number().int().positive().max(2147483647);
export const fileViewSchema=z.object({file_id:id,purpose:publicFilePurposeSchema,filename:z.string().min(1).max(255),detected_type:z.string().nullable(),size_bytes:z.number().int().positive().max(26214400),created_at:instant,upload_state:z.enum(['created','uploading','uploaded','finalized','rejected','expired']),scan_state:z.enum(['pending','clean','quarantined']),publication_state:z.enum(['private','unpublished','published','withdrawn']),integration_state:z.enum(['simulated','verification_required','verified']),source_provenance:z.enum(['stored_object','metadata_only']),version,can_download:z.boolean(),can_publish:z.boolean(),can_withdraw:z.boolean(),content_path:z.string().regex(/^\/api\/v1\/files\/[a-f0-9-]{36}\/content$/).nullable(),safe_error_code:z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable()}).strict();
export type FileView=z.infer<typeof fileViewSchema>;
const pages=z.object({cursor:z.string().max(200).nullable().optional(),limit:z.number().int().min(1).max(100).optional()}).strict();
const page=<S extends z.ZodType>(s:S)=>z.object({items:z.array(s),next_cursor:z.string().nullable()}).strict();
const filters=pages.extend({enrollment_id:id.optional(),occurrence_id:id.optional(),purpose:publicFilePurposeSchema.optional()}).strict().refine(v=>Boolean(v.enrollment_id)!==Boolean(v.occurrence_id));
async function read<S extends z.ZodType>(client:FileRpcClient,name:string,schema:S,args:Record<string,unknown>):Promise<z.output<S>>{const parsed=schema.safeParse((await fileRpc(client,name,args)).data);if(!parsed.success)throw new FileRpcError('DEPENDENCY_UNAVAILABLE');return parsed.data;}
function parameters<S extends z.ZodType>(schema:S,input:unknown){const parsed=schema.safeParse(input);if(!parsed.success)throw new FileRpcError('VALIDATION_ERROR');return Object.fromEntries(Object.entries(parsed.data as Record<string,unknown>).map(([k,v])=>[`p_${k}`,v]));}
export const getFile=(client:FileRpcClient,fileId:string)=>read(client,'get_file',fileViewSchema,parameters(z.object({file_id:id}),{file_id:fileId}));
export const listFiles=(client:FileRpcClient,options:z.input<typeof filters>)=>read(client,'list_files',page(fileViewSchema),parameters(filters,options));
export const materialEnrollmentSchema=z.object({enrollment_id:id,learner:z.object({learner_id:id,display_name:z.string()}).strict(),occurrence:z.object({occurrence_id:id,title:z.string(),start_at:instant,end_at:instant}).strict()}).strict();
export const listMyMaterialEnrollments=(client:FileRpcClient,options:z.input<typeof pages>={})=>read(client,'list_my_material_enrollments',page(materialEnrollmentSchema),parameters(pages,options));
