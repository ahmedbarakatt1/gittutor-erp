import { z } from 'zod';
import { identityRpc,type IdentityRpcClient } from '../identity/commands';
import { notificationContentSchema } from './templates';
const id=z.uuid(),version=z.number().int().positive(),instant=z.iso.datetime({offset:true});
export const notificationStates=z.enum(['queued','sent','delivered','bounced','suppressed','failed','unknown']);
export const notificationSchema=z.object({delivery_id:id,event_id:z.guid(),state:notificationStates,created_at:instant,content:notificationContentSchema}).strict();
export const deliverySchema=z.object({delivery_id:id,event_type:z.string().max(100),audience:z.enum(['customer','tutor','staff']),channel:z.enum(['email','in_app']),state:notificationStates,safe_error_code:z.string().nullable(),masked_recipient:z.string(),created_at:instant,version,can_retry:z.boolean(),can_reconcile:z.boolean()}).strict();
export const preferencesSchema=z.object({email_enabled:z.boolean(),version}).strict();
export type Notification=z.infer<typeof notificationSchema>;
export type Delivery=z.infer<typeof deliverySchema>;
const page=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item),next_cursor:id.nullable()}).strict();
export async function listNotifications(client:IdentityRpcClient,query:Record<string,unknown>={}){const args=z.object({p_limit:z.number().int().min(1).max(100).default(25),p_cursor:id.nullable().default(null)}).strict().parse(query);return page(notificationSchema).parse(await identityRpc(client,'list_my_notifications',args));}
export async function listDeliveries(client:IdentityRpcClient,query:Record<string,unknown>={}){const args=z.object({p_limit:z.number().int().min(1).max(100).default(25),p_cursor:id.nullable().default(null),p_state:notificationStates.nullable().default(null)}).strict().parse(query);return page(deliverySchema).parse(await identityRpc(client,'list_notification_deliveries',args));}
export async function getNotificationPreferences(client:IdentityRpcClient){return preferencesSchema.parse(await identityRpc(client,'get_notification_preferences'));}
const common=z.object({command_id:id,resource_id:id,version});
export const notificationCommands={
 retry_notification:{input:z.object({p_delivery_id:id,p_reason:z.string().trim().min(1).max(2000),p_idempotency_key:z.string().min(1).max(200)}).strict(),output:common.extend({delivery_id:id,attempt_id:id}).strict()},
 reconcile_notification:{input:z.object({p_delivery_id:id,p_reason:z.string().trim().min(1).max(2000),p_idempotency_key:z.string().min(1).max(200)}).strict(),output:common.extend({delivery_id:id,attempt_id:id,job_id:id}).strict()},
 set_notification_preferences:{input:z.object({p_email_enabled:z.boolean(),p_expected_version:version,p_idempotency_key:z.string().min(1).max(200)}).strict(),output:common.extend({email_enabled:z.boolean()}).strict()},
 assign_notification_queue:{input:z.object({p_queue:z.enum(['general','payments','completion']),p_account_id:id,p_expected_version:z.number().int().nonnegative(),p_idempotency_key:z.string().min(1).max(200)}).strict(),output:common.extend({queue:z.enum(['general','payments','completion']),account_id:id}).strict()},
};
export async function invokeNotificationCommand(client:IdentityRpcClient,name:keyof typeof notificationCommands,input:unknown){const command=notificationCommands[name];return {data:command.output.parse(await identityRpc(client,name,command.input.parse(input))),status:200};}
