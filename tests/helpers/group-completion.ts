import {randomUUID} from 'node:crypto';
import {groupRemovalFixture} from './group-removal';
import {settleEnrollment} from './financial-booking';
/** Historical admission only is seeded. Payments, attendance, approval and earnings use actual commands. */
export async function groupCompletionFixture(options: {isolatedLearners?: boolean} = {}){const f=await groupRemovalFixture(3,true,options);try{
 const occurrenceId=randomUUID(),end=new Date(Date.now()-3600000),start=new Date(end.getTime()-3600000),accepted=new Date(start.getTime()-86400000),seats:string[]=[];
 const original=(await f.database.query('select * from app_private.occurrences where id=$1',[f.occurrenceId])).rows[0];
 await f.database.query(`insert into app_private.occurrences select(jsonb_populate_record(null::app_private.occurrences,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'start_at',$3::timestamptz,'end_at',$4::timestamptz,'confirmation_deadline_at',$3::timestamptz-interval '1 hour','state','forming','current_fee_agreement_id',null,'version',1,'meeting_status','not_requested'))).* from app_private.occurrences o where id=$1`,[f.occurrenceId,occurrenceId,start,end]);
 await f.database.query('insert into app_private.tutor_assignments(occurrence_id,tutor_id)values($1,$2)',[occurrenceId,f.tutorId]);
 await f.database.query('insert into app_private.tutor_reservations(occurrence_id,tutor_id,start_at,end_at)values($1,$2,$3,$4)',[occurrenceId,f.tutorId,start,end]);
 const fee=await f.rpc('approve_tutor_fee',{p_occurrence_id:occurrenceId,p_tutor_id:f.tutorId,p_fee_minor:62500,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:original.pricing_version_id,p_target_tier:3,p_purpose:'initial',p_reason:'Historical three-person group exact agreement',p_expected_version:1,p_idempotency_key:randomUUID()});
 for(let index=0;index<3;index++){
  const enrollmentId=randomUUID(),quoteId=randomUUID(),accountId=(await f.students[index].auth.getUser()).data.user!.id,oldQuote=(await f.database.query('select current_quote_id from app_private.enrollments where id=$1',[f.seats[index]])).rows[0].current_quote_id;
  await f.database.query("insert into app_private.enrollments(id,occurrence_id,learner_id,booker_account_id,state)values($1,$2,$3,$4,'confirmed')",[enrollmentId,occurrenceId,f.learners[index],accountId]);
  await f.database.query(`with original as(select q.*,q.customer_terms||jsonb_build_object('quote_id',$2::uuid,'enrollment_id',$3::uuid,'occurrence_id',$4::uuid,'start_at',$5::timestamptz,'end_at',$6::timestamptz,'expires_at',$5::timestamptz-interval '1 hour') terms from app_private.quotes q where id=$1)insert into app_private.quotes(id,enrollment_id,occurrence_id,version,base_occurrence_version,base_terms_version,policy_version_id,pricing_version_id,target_tier,customer_price_minor,currency,expires_at,customer_terms,terms_hash,created_at)select $2,$3,$4,1,2,1,policy_version_id,pricing_version_id,target_tier,customer_price_minor,currency,$5::timestamptz-interval '1 hour',terms,app_private.catalog_hash(terms),$7 from original`,[oldQuote,quoteId,enrollmentId,occurrenceId,start,end,accepted]);
  await f.database.query('update app_private.enrollments set current_quote_id=$2 where id=$1',[enrollmentId,quoteId]);
  await f.database.query('insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash,accepted_at)select id,$2,$3,terms_hash,$4 from app_private.quotes where id=$1',[quoteId,accountId,f.learners[index],accepted]);
  await f.rpc('prepare_enrollment_charge',{p_enrollment_id:enrollmentId,p_expected_version:1,p_idempotency_key:randomUUID()},f.students[index]);seats.push(enrollmentId);
 }
 await f.database.query("update app_private.occurrences set state='confirmed'where id=$1",[occurrenceId]);
 for(let i=0;i<3;i++)await settleEnrollment(f,seats[i],i,55000,f.account);
 return {...f,occurrenceId,seats,feeId:fee.fee_agreement_id as string,actualStart:start.toISOString(),actualEnd:end.toISOString()};
 }catch(error){await f.close();throw error;}}
