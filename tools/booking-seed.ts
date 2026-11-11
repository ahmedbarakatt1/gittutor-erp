import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminDatabase,authClient,loadLocalSupabase } from '../tests/helpers/supabase';
import { fixtureId } from './db-seed';
import { catalogFixtureIds } from './catalog-seed';

export const bookingFixtureIds={private:fixtureId('fixture_private_occurrence_v1'),group2:fixtureId('fixture_group2_occurrence_v1'),group3:fixtureId('fixture_group3_occurrence_v1'),group4:fixtureId('fixture_group4_occurrence_v1')};
const weekly=Array.from({length:7},(_,index)=>({weekday:index+1,start_local:'06:00',end_local:'23:00'}));
const sourceVersion='t04-booking-seed-v1';

/** Deterministic isolated forming records only. No customer seat or funding success is seeded. */
export async function seedBooking(){
  const config=loadLocalSupabase(),database=await adminDatabase(),admin=await authClient('admin_a');
  let inTransaction=false;
  try{
    await database.query("select pg_advisory_lock(hashtextextended('git-tutor:booking-seed:v1',0))");
    const actor=await admin.rpc('get_my_account');if(actor.error||!actor.data.roles.includes('admin'))throw new Error('BOOKING_SEED_ADMIN_REQUIRED');
    if(!(await database.query("select to_regclass('app_private.occurrences') as id")).rows[0].id)throw new Error('BOOKING_MIGRATION_REQUIRED');
    const teacher=(await database.query("select t.id,t.approved_profile_version_id,app_private.has_role(t.account_id,'tutor') as active from app_private.tutors t where t.account_id=$1",[config.actors.tutor_a.id])).rows[0];
    if(!teacher?.approved_profile_version_id||!teacher.active)throw new Error('BOOKING_SEED_APPROVED_TUTOR_REQUIRED');
    const availability=await admin.rpc('get_admin_tutor_availability',{p_tutor_id:teacher.id});if(availability.error)throw new Error('BOOKING_SEED_AVAILABILITY_UNAVAILABLE');
    if(availability.data.version===0){
      const created=await admin.rpc('set_availability',{p_tutor_id:teacher.id,p_weekly_intervals:weekly,p_dated_exceptions:[],p_reason:'Synthetic development schedule',p_expected_version:0,p_idempotency_key:'booking-seed-v1:availability'});
      if(created.error)throw new Error('BOOKING_SEED_AVAILABILITY_CONFLICT');
    }
    await database.query('begin');inTransaction=true;
    await database.query('select id from app_private.tutors where id=$1 for update',[teacher.id]);
    await database.query("select app_private.require_role($1,'tutor')",[config.actors.tutor_a.id]);
    const approved=(await database.query("select p.subject_ids from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id and p.tutor_id=t.id and p.state='approved' where t.id=$1",[teacher.id])).rows[0];
    if(!approved)throw new Error('BOOKING_SEED_APPROVED_TUTOR_REQUIRED');
    const start=new Date();start.setUTCDate(start.getUTCDate()+7);start.setUTCHours(10,0,0,0);
    const clock=(await database.query("insert into app_private.synthetic_fixture_registry(id,label,kind,content) values($1,'booking_seed_clock_v1','booking_seed',$2) on conflict(label) do update set label=excluded.label returning content",[fixtureId('booking_seed_clock_v1'),{source_version:sourceVersion,first_start_at:start.toISOString()}])).rows[0].content as {source_version:string;first_start_at:string};
    if(clock.source_version!==sourceVersion)throw new Error('BOOKING_SEED_SOURCE_CONFLICT');
    const records=[{label:'private' as const,offer:catalogFixtureIds.private_offer,fee:25000},{label:'group2' as const,offer:catalogFixtureIds.group2_offer,fee:45000},{label:'group3' as const,offer:catalogFixtureIds.group3_offer,fee:62500},{label:'group4' as const,offer:catalogFixtureIds.group4_offer,fee:72500}];
    for(const [index,record]of records.entries()){
      const id=bookingFixtureIds[record.label],begin=new Date(Date.parse(clock.first_start_at)+index*86400000),end=new Date(begin.getTime()+3600000);
      const offer=(await database.query("select o.*,p.content as policy from app_private.offers o join app_private.policy_versions p on p.id=o.policy_version_id join app_private.pricing_versions price on price.id=o.pricing_version_id where o.id=$1 and o.status='published' and p.status='published' and price.status='published' and p.is_synthetic and p.environment_scope='development_test' and o.effective_at<=now()",[record.offer])).rows[0];
      if(!offer||offer.duration_minutes!==60)throw new Error('BOOKING_SEED_APPROVED_OFFER_REQUIRED');
      if(!(approved.subject_ids as string[]).includes(offer.subject_id))throw new Error('BOOKING_SEED_TUTOR_SUBJECT_CONFLICT: approved profile preserved');
      const existing=(await database.query('select * from app_private.occurrences where id=$1',[id])).rows[0];
      if(existing){
        if(existing.offer_id!==record.offer||existing.tutor_id!==teacher.id||existing.start_at.toISOString()!==begin.toISOString()||existing.end_at.toISOString()!==end.toISOString()||existing.policy_version_id!==offer.policy_version_id||existing.pricing_version_id!==offer.pricing_version_id||existing.target_tier!==offer.target_tier||existing.capacity!==offer.capacity)throw new Error('BOOKING_SEED_RECORD_CONFLICT: existing schedule preserved');
        continue;
      }
      if(begin.getTime()<=Date.now())throw new Error('BOOKING_SEED_CLOCK_EXPIRED: preserved prior fixture schedule');
      const availableVersion=(await database.query('select app_private.booking_assert_schedule($1,$2,$3) as version',[teacher.id,begin,end])).rows[0].version;
      const deadline=new Date(begin.getTime()-Number(offer.policy.confirmation_deadline_minutes_before_start)*60000);
      await database.query("insert into app_private.occurrences(id,offer_id,tutor_id,format,target_tier,capacity,duration_minutes,start_at,end_at,time_zone,policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at) values($1,$2,$3,$4,$5,$6,60,$7,$8,'Africa/Cairo',$9,$10,$11,$12)",[id,record.offer,teacher.id,offer.format,offer.target_tier,offer.capacity,begin,end,offer.policy_version_id,offer.pricing_version_id,availableVersion,deadline]);
      await database.query('insert into app_private.tutor_assignments(occurrence_id,tutor_id) values($1,$2)',[id,teacher.id]);
      await database.query('insert into app_private.tutor_reservations(occurrence_id,tutor_id,start_at,end_at) values($1,$2,$3,$4)',[id,teacher.id,begin,end]);
      const command=fixtureId(`booking-seed-command:${record.label}`);
      await database.query("insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values($1,$2,'synthetic_booking_seeded',$3,$4)",[config.actors.admin_a.id,command,id,{source_manifest_version:sourceVersion,fixture_label:record.label}]);
      await database.query("select app_private.enqueue_event($1,'synthetic_booking_seeded',$2,jsonb_build_object('occurrence_id',$2::uuid),'notifications.route')",[command,id]);
      await database.query('select app_private.booking_enqueue_due($1,$2)',[id,deadline]);
    }
    await database.query('commit');inTransaction=false;
    for(const record of records){
      const row=(await database.query('select version,state,current_fee_agreement_id,target_tier,pricing_version_id,start_at from app_private.occurrences where id=$1',[bookingFixtureIds[record.label]])).rows[0];
      if(row.state!=='forming'||row.start_at.getTime()<=Date.now())throw new Error('BOOKING_SEED_STATE_CHANGED: prior record preserved');
      if(!row.current_fee_agreement_id){
        const fee=await admin.rpc('approve_tutor_fee',{p_occurrence_id:bookingFixtureIds[record.label],p_tutor_id:teacher.id,p_fee_minor:record.fee,p_currency:'EGP',p_duration_minutes:60,p_compensation_policy_version_id:row.pricing_version_id,p_target_tier:row.target_tier,p_purpose:'initial',p_reason:'Exact synthetic development fee; no funds or confirmation asserted',p_expected_version:row.version,p_idempotency_key:`booking-seed-v1:initial-fee:${record.label}`});
        if(fee.error)throw new Error(`BOOKING_SEED_FEE_FAILED:${fee.error.code}`);
      }else{
        const fee=(await database.query('select fee_minor,tutor_id from finance_private.tutor_fee_agreements where id=$1',[row.current_fee_agreement_id])).rows[0];
        if(Number(fee?.fee_minor)!==record.fee||fee.tutor_id!==teacher.id)throw new Error('BOOKING_SEED_FEE_CONFLICT: prior agreement preserved');
      }
    }
    console.log('Synthetic booking schedule ready: four future forming occurrences with exact approved fees. This booking seed does not assert settled funding.');
  }catch(error){if(inTransaction)await database.query('rollback');throw error;}
  finally{await admin.auth.signOut({scope:'local'});await database.query("select pg_advisory_unlock(hashtextextended('git-tutor:booking-seed:v1',0))");await database.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await seedBooking();
