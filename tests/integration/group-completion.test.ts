import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {groupCompletionFixture} from '../helpers/group-completion';
import {getTutorStatement} from '../../src/modules/tutor_pay/payroll';
test('three-person approved completion requires every attendance outcome, posts62500 once and appends2500 correction',async()=>{
 const f=await groupCompletionFixture();try{
  const start=await f.rpc('start_occurrence',{p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_expected_version:2,p_idempotency_key:randomUUID()},f.tutor);
  const entries=f.seats.map(enrollment_id=>({enrollment_id,attendance:'present',attended_seconds:3600,reason:null})),attendance={p_occurrence_id:f.occurrenceId,p_actual_start_at:f.actualStart,p_actual_end_at:f.actualEnd,p_entries:entries,p_expected_version:start.version,p_idempotency_key:randomUUID()};
  expect((await f.tutor.rpc('record_attendance',{...attendance,p_entries:entries.slice(0,2)})).error?.message).toBe('VALIDATION_ERROR');
  const recorded=await f.rpc('record_attendance',attendance,f.tutor),submission={p_occurrence_id:f.occurrenceId,p_attendance_version:recorded.attendance_version,p_topic_summary:'Three learners completed the shared derivatives exercise.',p_delivery_exception_ids:[],p_expected_version:recorded.version,p_idempotency_key:randomUUID()};
  const submitted=await f.rpc('submit_completion',submission,f.tutor);expect(await f.rpc('submit_completion',submission,f.tutor)).toEqual(submitted);
  const args={p_occurrence_id:f.occurrenceId,p_completion_version:1,p_approved_remedy_ids:[],p_expected_version:submitted.version,p_idempotency_key:randomUUID()},approved=await f.rpc('approve_completion',args);for(let i=0;i<5;i++)expect(await f.rpc('approve_completion',args)).toEqual(approved);
  expect((await f.database.query('select amount_minor,fee_agreement_id from finance_private.tutor_earnings where occurrence_id=$1',[f.occurrenceId])).rows).toEqual([{amount_minor:'62500',fee_agreement_id:f.feeId}]);
  const source=(await f.database.query("select id,signed_minor from finance_private.ledger_lines where enrollment_id=any($1::uuid[])order by id",[f.seats])).rows;
  const evidence=await f.evidence({purpose:'earning_adjustment',parentType:'tutor_earning',parentId:approved.base_earning_id as string});
  const correction={p_earning_id:approved.base_earning_id,p_delta_minor:2500,p_effective_at:new Date().toISOString(),p_evidence_file_id:evidence,p_reason:'Approved exact correction to65000 without rewriting62500',p_expected_version:1,p_idempotency_key:randomUUID()};
  const adjusted=await f.rpc('adjust_tutor_earning',correction);expect(await f.rpc('adjust_tutor_earning',correction)).toEqual(adjusted);expect(await getTutorStatement(f.tutor)).toMatchObject({earned_minor:65000,owed_minor:65000});
  expect((await f.database.query('select amount_minor from finance_private.tutor_earnings where id=$1',[approved.base_earning_id])).rows[0].amount_minor).toBe('62500');expect((await f.database.query("select id,signed_minor from finance_private.ledger_lines where enrollment_id=any($1::uuid[])order by id",[f.seats])).rows).toEqual(source);
 }finally{await f.close();}
},90000);
