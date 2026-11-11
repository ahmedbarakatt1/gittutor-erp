import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { adminDatabase, anonymousClient, authClient, loadLocalSupabase } from './supabase';
import { fixtureId } from '../../tools/db-seed';
import { catalogFixtureIds } from '../../tools/catalog-seed';

export type BookingJson = Record<string, unknown>;
export async function bookingFixture() {
  const database=await adminDatabase(),config=loadLocalSupabase();
  const admin=await authClient('admin_a');
  const provider=createClient(config.url,config.secret_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`booking.${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}!`;
  const created=await provider.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user) throw new Error('BOOKING_FIXTURE_AUTH_FAILED');
  const tutor=anonymousClient();
  if((await tutor.auth.signInWithPassword({email,password})).error) throw new Error('BOOKING_FIXTURE_AUTH_FAILED');
  async function rpc(name:string,args:BookingJson={},client=admin):Promise<BookingJson> {
    const result=await client.rpc(name,args);
    if(result.error) throw new Error(`${name}:${result.error.message}`);
    return result.data as BookingJson;
  }
  await rpc('grant_staff_role',{p_account_id:created.data.user.id,p_role:'tutor',p_reason:'Isolated booking fixture',p_idempotency_key:randomUUID()});
  const teacher=(await database.query('select id,contact_id,version from app_private.tutors where account_id=$1',[created.data.user.id])).rows[0];
  await rpc('update_tutor_profile',{p_display_name:'Synthetic booking tutor',p_bio:'Isolated scheduling verification profile.',p_subject_ids:[fixtureId('subject_calculus')],p_contact_id:teacher.contact_id,p_locale:'en',p_expected_version:teacher.version,p_idempotency_key:randomUUID()},tutor);
  const profile=(await database.query('select version,draft_profile_version_id from app_private.tutors where id=$1',[teacher.id])).rows[0];
  await rpc('approve_tutor_profile',{p_tutor_id:teacher.id,p_profile_version_id:profile.draft_profile_version_id,p_decision:'approved',p_reason:'Synthetic booking verification',p_expected_version:profile.version,p_idempotency_key:randomUUID()});
  const students=await Promise.all(['learner_a','learner_b','learner_c','learner_d'].map(authClient));
  const accountIds=['learner_a','learner_b','learner_c','learner_d'].map(label=>config.actors[label].id);
  const learners=(await database.query('select id from app_private.learners where account_id=any($1::uuid[]) order by array_position($1::uuid[],account_id)',[accountIds])).rows.map(row=>row.id as string);
  const weekly=Array.from({length:7},(_,index)=>({weekday:index+1,start_local:'06:00',end_local:'23:00'}));
  async function availability() {
    const current=await rpc('get_admin_tutor_availability',{p_tutor_id:teacher.id});
    return rpc('set_availability',{p_tutor_id:teacher.id,p_weekly_intervals:weekly,p_dated_exceptions:[],p_reason:'Isolated synthetic availability',p_expected_version:current.version,p_idempotency_key:randomUUID()});
  }
  let day=2;
  function interval(offset=day++) { const start=new Date();start.setUTCDate(start.getUTCDate()+offset);start.setUTCHours(10,0,0,0);return {start_at:start.toISOString(),end_at:new Date(start.getTime()+3600000).toISOString()}; }
  async function occurrence(format:'private'|'group'='private',times=interval()) {
    return rpc('create_occurrence',{p_offer_id:format==='private'?catalogFixtureIds.private_offer:catalogFixtureIds.group2_offer,p_tutor_id:teacher.id,p_start_at:times.start_at,p_end_at:times.end_at,p_time_zone:'Africa/Cairo',p_target_tier:format==='private'?null:2,p_idempotency_key:randomUUID()});
  }
  async function reserve(id:string,index=0,key=randomUUID()) {return rpc('reserve_enrollment',{p_occurrence_id:id,p_learner_id:learners[index],p_idempotency_key:key},students[index]);}
  async function close(){await Promise.all([admin,tutor,...students].map(client=>client.auth.signOut({scope:'local'})));await database.end();}
  return {database,admin,tutor,students,learners,actor:{id:created.data.user.id,email,password},tutorId:teacher.id as string,rpc,weekly,availability,interval,occurrence,reserve,close};
}

/** Independent transactions use claims from genuine local Auth sessions; no invented auth.users/session records. */
export async function raceBookingCalls(calls:{client:ReturnType<typeof anonymousClient>;name:string;args:BookingJson}[]) {
  const connections=await Promise.all(calls.map(()=>adminDatabase()));
  let release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  let ready=0;
  const work=calls.map(async(call,index)=>{
    const database=connections[index];
    let reachedBarrier=false;
    try {
      const session=(await call.client.auth.getSession()).data.session;
      if(!session) throw new Error('REAL_AUTH_SESSION_REQUIRED');
      const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString('utf8'));
      await database.query('begin');
      await database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
      await database.query('set local role authenticated');
      reachedBarrier=true;ready++;if(ready===calls.length) release();
      await barrier;
      if(!/^[a-z_]+$/.test(call.name)||Object.keys(call.args).some(key=>!/^p_[a-z_]+$/.test(key))) throw new Error('INVALID_TEST_RPC');
      const entries=Object.entries(call.args);
      const jsonParameters=new Set(['p_weekly_intervals','p_dated_exceptions','p_requested_terms']);
      const result=await database.query(`select api.${call.name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as data`,entries.map(([key,value])=>jsonParameters.has(key)?JSON.stringify(value):value));
      await database.query('commit');
      return {data:result.rows[0].data,error:null};
    } catch(error) {if(!reachedBarrier){ready++;if(ready===calls.length) release();}await database.query('rollback');return {data:null,error:error instanceof Error?error.message:'DATABASE_ERROR'};}
    finally {await database.end();}
  });
  return Promise.all(work);
}
