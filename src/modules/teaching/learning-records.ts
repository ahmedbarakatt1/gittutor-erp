import {z} from 'zod';
import {bookingRpc,type BookingRpcClient} from '../booking/commands';
const id=z.uuid(),version=z.number().int().positive(),instant=z.iso.datetime({offset:true});
const revision=z.object({revision_id:id,version,content:z.string(),published_at:instant}).strict();
const record=revision.extend({record_id:id,learner_id:id.nullable()}).strict(),staffRecord=record.extend({revisions:z.array(revision)}).strict();
const base={occurrence_id:id,can_publish:z.boolean()};
export const learningRecordsSchema=z.discriminatedUnion('view',[
 z.object({...base,view:z.literal('customer'),can_publish:z.literal(false),group_summary:record.nullable(),feedback:z.array(record).max(1)}).strict(),
 z.object({...base,view:z.enum(['tutor','admin']),group_summary:staffRecord.nullable(),feedback:z.array(staffRecord),roster:z.array(z.object({learner_id:id,display_name:z.string()}).strict())}).strict(),
]);
export type LearningRecords=z.infer<typeof learningRecordsSchema>;
const publish=z.object({p_occurrence_id:id,p_learner_id:id.nullable(),p_content:z.string().trim().min(1).max(5000),p_expected_version:z.number().int().nonnegative(),p_idempotency_key:z.string().min(1).max(200)}).strict();
export async function publishLearningRecord(client:BookingRpcClient,input:unknown){const args=publish.parse(input);return z.object({command_id:id,resource_id:id,version,record_id:id,revision_id:id,occurrence_id:id,learner_id:id.nullable()}).strict().parse((await bookingRpc(client,'publish_learning_record',args)).data);}
export async function getLearningRecords(client:BookingRpcClient,occurrenceId:string,view:'customer'|'tutor'|'admin',learnerId:string|null=null){const args=z.object({p_occurrence_id:id,p_view:z.enum(['customer','tutor','admin']),p_learner_id:id.nullable()}).strict().parse({p_occurrence_id:occurrenceId,p_view:view,p_learner_id:learnerId});return learningRecordsSchema.parse((await bookingRpc(client,'get_learning_records',args)).data);}
