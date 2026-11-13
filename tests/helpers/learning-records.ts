import {randomUUID} from 'node:crypto';
import {groupCompletionFixture} from './group-completion';
export const internalLearningCanary='INTERNAL_COMPLETION_CANARY_803_DO_NOT_PUBLISH';
export async function completeLearningFixture(f:Awaited<ReturnType<typeof groupCompletionFixture>>){
 const start=await f.rpc('start_occurrence',{p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_expected_version:2,p_idempotency_key:randomUUID()},f.tutor);
 const recorded=await f.rpc('record_attendance',{p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_actual_end_at:f.actualEnd,p_entries:f.seats.map(enrollment_id=>({enrollment_id,attendance:'present',attended_seconds:3600,reason:null})),p_expected_version:start.version,p_idempotency_key:randomUUID()},f.tutor);
 const submitted=await f.rpc('submit_completion',{p_occurrence_id:f.occurrenceId,p_attendance_version:recorded.attendance_version,p_topic_summary:internalLearningCanary,p_delivery_exception_ids:[],p_expected_version:recorded.version,p_idempotency_key:randomUUID()},f.tutor);
 await f.rpc('approve_completion',{p_occurrence_id:f.occurrenceId,p_completion_version:1,p_approved_remedy_ids:[],p_expected_version:submitted.version,p_idempotency_key:randomUUID()});
}
