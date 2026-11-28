import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {expect,test} from 'vitest';
import {groupCompletionFixture} from '../helpers/group-completion';
import {completeLearningFixture,internalLearningCanary} from '../helpers/learning-records';
import {anonymousClient,loadLocalSupabase} from '../helpers/supabase';
import {getLearningRecords,publishLearningRecord} from '../../src/modules/teaching/learning-records';

test('GT-803 explicit group publication, private learner feedback, immutable revisions and current scope govern read and notification',async()=>{
 const f=await groupCompletionFixture({isolatedLearners:true}),guardian=anonymousClient();try{
  const args={p_occurrence_id:f.occurrenceId,p_learner_id:null,p_content:'Shared algebra practice',p_expected_version:0,p_idempotency_key:randomUUID()};
  expect((await f.tutor.rpc('publish_learning_record',args)).error?.message).toBe('STATE_CONFLICT');
  await completeLearningFixture(f);
  const unpublished=await getLearningRecords(f.students[0],f.occurrenceId,'customer',f.learners[0]);expect(unpublished).toMatchObject({group_summary:null,feedback:[]});expect(JSON.stringify(unpublished)).not.toContain(internalLearningCanary);
  expect((await f.students[0].rpc('publish_learning_record',args)).error?.message).toBe('FORBIDDEN');expect((await f.reviewer.rpc('publish_learning_record',args)).error?.message).toBe('FORBIDDEN');
  const group=await publishLearningRecord(f.tutor,args);expect(await publishLearningRecord(f.tutor,args)).toEqual(group);
  expect((await f.tutor.rpc('publish_learning_record',{...args,p_content:'Wrong retry'})).error?.message).toBe('IDEMPOTENCY_CONFLICT');
  const feedbackA=await publishLearningRecord(f.tutor,{...args,p_learner_id:f.learners[0],p_content:'PRIVATE_A practice fractions',p_idempotency_key:randomUUID()});
  await publishLearningRecord(f.admin,{...args,p_learner_id:f.learners[1],p_content:'PRIVATE_B revise equations',p_idempotency_key:randomUUID()});
  for(let i=0;i<3;i++){const data=await getLearningRecords(f.students[i],f.occurrenceId,'customer',f.learners[i]);expect(data.group_summary?.content).toBe(args.p_content);expect(data.feedback.map(r=>r.content)).toEqual(i===0?['PRIVATE_A practice fractions']:i===1?['PRIVATE_B revise equations']:[]);expect(data).not.toHaveProperty('roster');expect(data.group_summary).not.toHaveProperty('revisions');expect(JSON.stringify(data)).not.toContain(internalLearningCanary);}
  expect((await f.students[1].rpc('get_learning_records',{p_occurrence_id:f.occurrenceId,p_view:'customer',p_learner_id:f.learners[0]})).error?.message).toBe('NOT_FOUND');expect((await f.students[3].rpc('get_learning_records',{p_occurrence_id:f.occurrenceId,p_view:'customer',p_learner_id:f.learners[3]})).error?.message).toBe('NOT_FOUND');
  const revised=await publishLearningRecord(f.tutor,{...args,p_content:'Shared algebra practice revision two',p_expected_version:1,p_idempotency_key:randomUUID()});expect(revised.version).toBe(2);
  expect((await f.tutor.rpc('publish_learning_record',{...args,p_idempotency_key:randomUUID()})).error?.message).toBe('VERSION_CONFLICT');
  const author=await getLearningRecords(f.tutor,f.occurrenceId,'tutor');if(author.view==='customer')throw new Error('WRONG_VIEW');expect(author.group_summary?.revisions.map(r=>r.content)).toEqual(['Shared algebra practice revision two',args.p_content]);
  await expect(f.database.query('update app_private.learning_record_revisions set content=$2 where id=$1',[group.revision_id,'rewritten'])).rejects.toThrow();expect((await f.database.query('select content from app_private.learning_record_revisions where id=$1',[group.revision_id])).rows[0].content).toBe(args.p_content);
  const config=loadLocalSupabase(),provider=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}}),email=`learning.${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
  const created=await provider.auth.admin.createUser({email,password,email_confirm:true});if(created.error||!created.data.user)throw new Error('GUARDIAN_FIXTURE_AUTH_FAILED');expect((await guardian.auth.signInWithPassword({email,password})).error).toBeNull();const guardianId=created.data.user.id;
  const contact=(await f.database.query('select id from app_private.verified_contacts where account_id=$1 and revoked_at is null',[guardianId])).rows[0].id;
  const invitation=await f.rpc('create_guardian_invitation',{p_contact_id:contact,p_scopes:['materials','notifications'],p_expires_at:new Date(Date.now()+3600000).toISOString(),p_idempotency_key:randomUUID()},f.students[0]);
  const token=(await f.database.query("select payload->>'single_use_token' token from app_private.domain_events where aggregate_id=$1 and event_type='guardian_invitation_created'",[invitation.invitation_id])).rows[0].token;
  const link=await f.rpc('accept_guardian_invitation',{p_invitation_id:invitation.invitation_id,p_single_use_token:token,p_expected_version:1,p_idempotency_key:randomUUID()},guardian);
  expect((await getLearningRecords(guardian,f.occurrenceId,'customer',f.learners[0])).feedback[0].content).toBe('PRIVATE_A practice fractions');
  const event=async(revision:string)=>(await f.database.query("select id from app_private.domain_events where event_type='learning_record_published' and payload->>'revision_id'=$1",[revision])).rows[0].id as string;
  const privateEvent=await event(feedbackA.revision_id),groupEvent=await event(group.revision_id);
  const recipients=async(id:string)=>(await f.database.query('select *from app_private.notification_recipients($1)',[id])).rows;
  const learnerA=(await f.students[0].auth.getUser()).data.user!.id;
  const individual=await recipients(privateEvent);expect(individual.map(r=>r.account_id)).toEqual(expect.arrayContaining([learnerA,guardianId]));expect(individual.map(r=>r.account_id)).not.toContain(f.learnerActors[1].id);expect(individual.map(r=>r.account_id)).not.toContain(f.learnerActors[2].id);for(const r of individual){expect(Object.keys(r.content).sort()).toEqual(['action_path','audience','kind','locale','starts_at']);expect(r.content.kind).toBe('completion');expect(r.content.action_path).toBe('/learn/bookings');}expect(JSON.stringify(individual)).not.toMatch(/PRIVATE_|Shared algebra|learner_id|record_id/);
  const shared=await recipients(groupEvent);expect(shared.map(r=>r.account_id)).toEqual(expect.arrayContaining([learnerA,guardianId,f.learnerActors[1].id,f.learnerActors[2].id]));
  await f.rpc('revoke_guardian_link',{p_guardian_link_id:link.guardian_link_id,p_reason:'Withdraw teaching content scope',p_expected_version:1,p_idempotency_key:randomUUID()},f.students[0]);expect((await guardian.rpc('get_learning_records',{p_occurrence_id:f.occurrenceId,p_view:'customer',p_learner_id:f.learners[0]})).error?.message).toBe('NOT_FOUND');expect((await recipients(privateEvent)).map(r=>r.account_id)).not.toContain(guardianId);
  const role=(await f.database.query("select id,version from app_private.account_roles where account_id=$1 and role='tutor'and revoked_at is null",[f.actor.id])).rows[0];await f.rpc('revoke_staff_role',{p_role_grant_id:role.id,p_reason:'End current tutor authority',p_expected_version:role.version,p_idempotency_key:randomUUID()});
  expect((await f.tutor.rpc('publish_learning_record',args)).error?.message).toBe('FORBIDDEN');expect((await f.tutor.rpc('get_learning_records',{p_occurrence_id:f.occurrenceId,p_view:'tutor'})).error?.message).toBe('FORBIDDEN');
 }finally{await guardian.auth.signOut({scope:'local'});await f.close();}
},90000);
