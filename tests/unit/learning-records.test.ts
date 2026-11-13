import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
import {publishLearningRecord,learningRecordsSchema} from '../../src/modules/teaching/learning-records';
test('learning publication accepts only explicit customer teaching content and exact audience',async()=>{
 const rpc=vi.fn();const input={p_occurrence_id:randomUUID(),p_learner_id:null,p_content:'Explicitly published class summary',p_expected_version:0,p_idempotency_key:randomUUID()};
 await expect(publishLearningRecord({rpc}, {...input,p_internal_completion_notes:'private'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 expect(learningRecordsSchema.safeParse({view:'customer',occurrence_id:input.p_occurrence_id,can_publish:false,group_summary:null,feedback:[],roster:[{learner_id:randomUUID(),display_name:'Unrelated classmate'}]}).success).toBe(false);
});
