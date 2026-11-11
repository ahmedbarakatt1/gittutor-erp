-- T04 preserve formation windows and deterministic current-consent queue priority.
grant create on schema app_private to git_tutor_commands;
create function app_private.booking_waitlist_eligible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from app_private.waitlist_entries w where w.id=p_id and w.state='waiting' and app_private.booking_can_access(w.requested_by,w.learner_id) and exists(select 1 from app_private.auth_account(w.requested_by) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) and not exists(select 1 from app_private.enrollments e where e.occurrence_id=w.occurrence_id and e.learner_id=w.learner_id and(e.state='confirmed' or(e.state='held' and e.hold_expires_at>now()))))
$$;
alter function app_private.booking_waitlist_eligible(uuid) owner to git_tutor_commands;
revoke all on function app_private.booking_waitlist_eligible(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
create or replace function app_private.booking_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;context jsonb;target uuid;resource uuid;occ app_private.occurrences%rowtype;offer app_private.offers%rowtype;seat app_private.enrollments%rowtype;quote app_private.quotes%rowtype;wait app_private.waitlist_entries%rowtype;teacher app_private.tutors%rowtype;policy jsonb;rules app_private.availability_rules%rowtype;version integer;expected integer;result jsonb:='{}';event_name text;start_at timestamptz;end_at timestamptz;available_version integer;amount bigint;fee_id uuid;count_seats integer;count_ordinary integer;accepted timestamptz;item jsonb;normalized jsonb;begin
 actor:=app_private.require_actor();expected:=(p_input->>'expected_version')::int;
 if p_name in ('set_availability','create_occurrence','change_occurrence_capacity','confirm_occurrence','approve_tutor_fee') then
  if p_name='set_availability' then
   select * into teacher from app_private.tutors where id=(p_input->>'tutor_id')::uuid;
   if teacher.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   if teacher.account_id=actor then perform app_private.require_role(actor,'tutor');else perform app_private.require_role(actor,'admin');end if;
  else perform app_private.require_role(actor,'admin');end if;
 elsif p_name in ('reserve_enrollment','join_waitlist') then perform app_private.assert_learner_scope(actor,(p_input->>'learner_id')::uuid,'booking');
 elsif p_name='accept_quote' then
  select * into quote from app_private.quotes where id=(p_input->>'quote_id')::uuid;select * into seat from app_private.enrollments where id=quote.enrollment_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking');
 elsif p_name='leave_waitlist' then select * into wait from app_private.waitlist_entries where id=(p_input->>'waitlist_entry_id')::uuid;if wait.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,wait.learner_id,'booking');
 else raise exception 'VALIDATION_ERROR';end if;
 if p_name='set_availability' then
  perform app_private.booking_validate_intervals(p_input->'weekly_intervals',p_input->'dated_exceptions');
  select coalesce(jsonb_agg(value order by(value->>'weekday')::int,value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(p_input->'weekly_intervals');
  p_input:=jsonb_set(p_input,'{weekly_intervals}',normalized);
  select coalesce(jsonb_agg(jsonb_build_object('local_date',value->>'local_date','intervals',(select coalesce(jsonb_agg(i order by i->>'start_local',i->>'end_local'),'[]') from jsonb_array_elements(value->'intervals') i)) order by value->>'local_date'),'[]') into normalized from jsonb_array_elements(p_input->'dated_exceptions');
  p_input:=jsonb_set(p_input,'{dated_exceptions}',normalized);
 end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_input?'reason' and (p_input->>'reason' is null or length(btrim(p_input->>'reason')) not between 1 and 2000) then raise exception 'VALIDATION_ERROR';end if;
 if p_name='set_availability' then
  perform app_private.booking_validate_intervals(p_input->'weekly_intervals',p_input->'dated_exceptions');perform 1 from app_private.tutors where id=teacher.id for update;
  select * into rules from app_private.availability_rules where tutor_id=teacher.id for update;if expected is distinct from coalesce(rules.version,0) then raise exception 'VERSION_CONFLICT';end if;
  if exists(select 1 from app_private.tutor_reservations r where r.tutor_id=teacher.id and r.active and r.end_at>now() and not app_private.booking_schedule_covered(p_input->'weekly_intervals',p_input->'dated_exceptions',r.start_at,r.end_at)) then
   raise exception 'SCHEDULE_CONFLICT' using detail=(select jsonb_build_object('conflicting_occurrence_ids',jsonb_agg(occurrence_id order by start_at,occurrence_id))::text from(select occurrence_id,start_at from app_private.tutor_reservations r where r.tutor_id=teacher.id and r.active and r.end_at>now() and not app_private.booking_schedule_covered(p_input->'weekly_intervals',p_input->'dated_exceptions',r.start_at,r.end_at) order by start_at,occurrence_id limit 100) conflicts);
  end if;
  select coalesce(jsonb_agg(value order by(value->>'weekday')::int,value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(p_input->'weekly_intervals');
  insert into app_private.availability_rules(tutor_id,weekly_intervals) values(teacher.id,normalized) on conflict(tutor_id) do update set weekly_intervals=excluded.weekly_intervals,version=app_private.availability_rules.version+1,updated_at=now() returning * into rules;
  delete from app_private.availability_exceptions where tutor_id=teacher.id;
  for item in select value from jsonb_array_elements(p_input->'dated_exceptions') loop
   select coalesce(jsonb_agg(value order by value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(item->'intervals');insert into app_private.availability_exceptions(tutor_id,local_date,intervals) values(teacher.id,(item->>'local_date')::date,normalized);
  end loop;
  resource:=teacher.id;version:=rules.version;result:=jsonb_build_object('conflicting_occurrence_ids','[]'::jsonb);
 elsif p_name='create_occurrence' then
  select * into offer from app_private.offers where id=(p_input->>'offer_id')::uuid;
  if offer.id is null or offer.status<>'published' or offer.effective_at>now() or not exists(select 1 from app_private.policy_versions p join app_private.pricing_versions price on price.id=offer.pricing_version_id where p.id=offer.policy_version_id and p.status='published' and price.status='published' and p.effective_at<=now() and price.effective_at<=now()) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  policy:=app_private.policy_content(offer.policy_version_id);
  perform app_private.assert_catalog_publication(app_private.catalog_environment(),(select environment_scope from app_private.policy_versions where id=offer.policy_version_id),(select is_synthetic from app_private.policy_versions where id=offer.policy_version_id));
  select * into teacher from app_private.tutors where id=(p_input->>'tutor_id')::uuid for update;
  if teacher.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.require_role(teacher.account_id,'tutor');
  if not exists(select 1 from app_private.tutor_profile_versions p where p.id=teacher.approved_profile_version_id and p.state='approved' and offer.subject_id=any(p.subject_ids)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  start_at:=(p_input->>'start_at')::timestamptz;end_at:=(p_input->>'end_at')::timestamptz;
  if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or start_at<=now() or end_at-start_at<>make_interval(mins=>offer.duration_minutes) or p_input->>'time_zone' is distinct from 'Africa/Cairo' or (p_input->>'target_tier')::int is distinct from offer.target_tier then raise exception 'INVALID_TIME';end if;
  available_version:=app_private.booking_assert_schedule(teacher.id,start_at,end_at);
  if start_at-make_interval(mins=>least((policy->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
  insert into app_private.occurrences(offer_id,tutor_id,format,target_tier,capacity,duration_minutes,start_at,end_at,time_zone,policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at) values(offer.id,teacher.id,offer.format,offer.target_tier,offer.capacity,offer.duration_minutes,start_at,end_at,'Africa/Cairo',offer.policy_version_id,offer.pricing_version_id,available_version,start_at-make_interval(mins=>least((policy->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)) returning * into occ;
  insert into app_private.tutor_assignments(occurrence_id,tutor_id) values(occ.id,teacher.id);insert into app_private.tutor_reservations(occurrence_id,tutor_id,start_at,end_at) values(occ.id,teacher.id,start_at,end_at);
  perform app_private.booking_enqueue_due(occ.id,occ.confirmation_deadline_at);resource:=occ.id;version:=1;result:=jsonb_build_object('occurrence_id',occ.id,'state',occ.state);perform set_config('response.status','201',true);
 else
  target:=case when p_name='accept_quote' then seat.occurrence_id when p_name='leave_waitlist' then wait.occurrence_id else(p_input->>'occurrence_id')::uuid end;
  occ:=app_private.booking_lock_occurrence(target);perform app_private.booking_expire_holds(occ.id);perform app_private.booking_expire_proposals(occ.id);
  if p_name not in ('reserve_enrollment','join_waitlist','accept_quote','leave_waitlist') and expected is distinct from occ.version then raise exception 'VERSION_CONFLICT';end if;
  resource:=occ.id;version:=occ.version;
  if p_name in ('reserve_enrollment','confirm_occurrence','approve_tutor_fee') then perform app_private.require_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor');end if;
  if p_name='reserve_enrollment' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
   if count_seats>=occ.capacity or count_ordinary>=coalesce(occ.target_tier,1) or exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=occ.id and app_private.booking_waitlist_eligible(w.id)) then raise exception 'CAPACITY_CONFLICT';end if;
   seat:=app_private.booking_new_hold(occ.id,(p_input->>'learner_id')::uuid,actor);select * into quote from app_private.quotes where id=seat.current_quote_id;
   resource:=seat.id;version:=seat.version;result:=jsonb_build_object('enrollment_id',seat.id,'hold_expires_at',seat.hold_expires_at,'quote_id',quote.id,'customer_price_minor',quote.customer_price_minor,'currency',quote.currency);perform set_config('response.status','201',true);
  elsif p_name='accept_quote' then
   select * into seat from app_private.enrollments where id=seat.id for update;
   if expected is distinct from quote.version then raise exception 'VERSION_CONFLICT';end if;
   if seat.state<>'held' or seat.hold_expires_at<=now() or quote.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if seat.current_quote_id<>quote.id or quote.base_terms_version<>occ.quote_terms_version or p_input->>'quote_hash' is distinct from quote.terms_hash then raise exception 'VERSION_CONFLICT';end if;
   insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash) values(quote.id,actor,seat.learner_id,quote.terms_hash) on conflict(quote_id,actor_account_id) do nothing;
   select accepted_at into accepted from app_private.quote_acceptances where quote_id=quote.id and actor_account_id=actor;
   update app_private.waitlist_entries set state='accepted',version=app_private.waitlist_entries.version+1,updated_at=now() where offered_enrollment_id=seat.id and state='offered';resource:=quote.id;version:=quote.version;result:=jsonb_build_object('accepted_at',accepted);
  elsif p_name='change_occurrence_capacity' then
   policy:=app_private.policy_content(occ.policy_version_id);
   if occ.state not in ('forming','confirmed') or (p_input->>'capacity')::int is null or(occ.format='private' and(p_input->>'capacity')::int<>1) or(occ.format='group' and((p_input->>'capacity')::int<occ.target_tier or(p_input->>'capacity')::numeric>(policy->>'group_capacity')::numeric)) then raise exception 'CAPACITY_CONFLICT';end if;
   select count(*) into count_seats from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');if(p_input->>'capacity')::int<count_seats then raise exception 'CAPACITY_CONFLICT';end if;
   update app_private.occurrences set capacity=(p_input->>'capacity')::int,version=occ.version+1,updated_at=now() where id=occ.id returning * into occ;version:=occ.version;result:=jsonb_build_object('capacity',occ.capacity);
  elsif p_name='join_waitlist' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   insert into app_private.waitlist_entries(occurrence_id,learner_id,requested_by) values(occ.id,(p_input->>'learner_id')::uuid,actor) returning * into wait;
   resource:=wait.id;version:=wait.version;result:=jsonb_build_object('waitlist_entry_id',wait.id,'state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());perform set_config('response.status','201',true);
  elsif p_name='leave_waitlist' then
   select * into wait from app_private.waitlist_entries where id=wait.id for update;if expected is distinct from wait.version then raise exception 'VERSION_CONFLICT';end if;
   if wait.state not in ('waiting','offered') then raise exception 'VERSION_CONFLICT';end if;
   if wait.offered_enrollment_id is not null then update app_private.enrollments set state='expired',version=app_private.enrollments.version+1,updated_at=now() where id=wait.offered_enrollment_id and state='held';end if;
   update app_private.waitlist_entries set state='cancelled',version=wait.version+1,updated_at=now() where id=wait.id returning * into wait;resource:=wait.id;version:=wait.version;result:=jsonb_build_object('state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());
  elsif p_name='approve_tutor_fee' then
   if (occ.format='private' and p_input->>'target_tier' is not null) or(occ.format='group' and(p_input->>'target_tier' is null or(p_input->>'target_tier')::int not in(2,3,4))) or not exists(select 1 from app_private.pricing_versions p where p.id=(p_input->>'compensation_policy_version_id')::uuid and p.scope=occ.format) then raise exception 'VALIDATION_ERROR';end if;
   if occ.state not in ('forming','confirmed') or(p_input->>'tutor_id')::uuid is distinct from occ.tutor_id or(p_input->>'duration_minutes')::int is distinct from occ.duration_minutes or p_input->>'purpose' is null or p_input->>'purpose' not in ('initial','amendment') then raise exception 'VALIDATION_ERROR';end if;
   if p_input->>'purpose'='initial' and(occ.state<>'forming' or occ.current_fee_agreement_id is not null or(p_input->>'target_tier')::int is distinct from occ.target_tier or(p_input->>'compensation_policy_version_id')::uuid<>occ.pricing_version_id) then raise exception 'STATE_CONFLICT';end if;
   if occ.format='group' and(p_input->>'target_tier')::int>occ.capacity then raise exception 'CAPACITY_CONFLICT';end if;
   perform app_private.assert_exact_tutor_fee((p_input->>'compensation_policy_version_id')::uuid,(p_input->>'target_tier')::int,(p_input->>'fee_minor')::bigint,p_input->>'currency',(p_input->>'duration_minutes')::int);
   insert into finance_private.tutor_fee_agreements(occurrence_id,tutor_id,pricing_version_id,target_tier,purpose,fee_minor,currency,duration_minutes,base_occurrence_version,approved_by) values(occ.id,occ.tutor_id,(p_input->>'compensation_policy_version_id')::uuid,(p_input->>'target_tier')::int,p_input->>'purpose',(p_input->>'fee_minor')::bigint,p_input->>'currency',occ.duration_minutes,occ.version,actor) returning id into fee_id;
   if p_input->>'purpose'='initial' then update app_private.occurrences set current_fee_agreement_id=fee_id,version=occ.version+1,updated_at=now() where id=occ.id returning * into occ;end if;version:=occ.version;result:=jsonb_build_object('fee_agreement_id',fee_id);perform set_config('response.status','201',true);
  elsif p_name='confirm_occurrence' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   perform app_private.booking_assert_schedule(occ.tutor_id,occ.start_at,occ.end_at,occ.id);
   select count(*) into count_seats from app_private.enrollments where occurrence_id=occ.id and state='held' and hold_kind='ordinary';if count_seats<>coalesce(occ.target_tier,1) then raise exception 'CAPACITY_CONFLICT';end if;
   if occ.current_fee_agreement_id is null then raise exception 'POLICY_INCOMPLETE';end if;
   for seat in select * from app_private.enrollments where occurrence_id=occ.id and state='held' and hold_kind='ordinary' order by id for update loop
    select * into quote from app_private.quotes where id=seat.current_quote_id;
    if quote.base_terms_version<>occ.quote_terms_version or quote.expires_at<=now() or not exists(select 1 from app_private.quote_acceptances a where a.quote_id=quote.id and app_private.booking_can_access(a.actor_account_id,seat.learner_id)) then raise exception 'STATE_CONFLICT';end if;
    result:=app_private.booking_funding_status(seat.id,quote.id,quote.policy_version_id);if not coalesce((result->>'eligible')::boolean,false) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   end loop;
   -- No positive funding implementation is enabled here. T06 owns confirmed financial effects.
   raise exception 'DEPENDENCY_UNAVAILABLE';
  end if;
 end if;
 event_name:='booking_'||p_name;return app_private.booking_finish(context,resource,version,result,event_name,jsonb_build_object('resource_id',resource));
exception when exclusion_violation then raise exception 'SCHEDULE_CONFLICT';when unique_violation then raise exception 'STATE_CONFLICT';when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;
create or replace function app_private.booking_occurrence_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;price jsonb;amount bigint;tutor_name text;occupied integer;ordinary integer;remaining integer;begin
 select * into o from app_private.occurrences where id=p_id;if o.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select customer_pricing into price from app_private.pricing_versions where id=o.pricing_version_id;
 if o.format='private' then amount:=(price->>'private_seat_price_minor')::bigint;else select (value->>'seat_price_minor')::bigint into amount from jsonb_array_elements(price->'group_tiers') where (value->>'group_size')::int=o.target_tier;end if;
 select p.display_name into tutor_name from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id where t.id=o.tutor_id;
 select count(*),count(*) filter(where hold_kind='ordinary') into occupied,ordinary from app_private.enrollments where occurrence_id=o.id and (state='confirmed' or(state='held' and hold_expires_at>now()));
 remaining:=case when o.state='forming' and o.confirmation_deadline_at>now() then greatest(0,least(o.capacity-occupied,coalesce(o.target_tier,1)-ordinary)) else 0 end;
 if exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=o.id and app_private.booking_waitlist_eligible(w.id)) then remaining:=0;end if;
 return jsonb_build_object('occurrence_id',o.id,'version',o.version,'offer_id',o.offer_id,'tutor',jsonb_build_object('tutor_id',o.tutor_id,'display_name',coalesce(tutor_name,'Tutor')),'start_at',o.start_at,'end_at',o.end_at,'time_zone',o.time_zone,'state',o.state,'format',o.format,'target_tier',o.target_tier,'capacity',o.capacity,'available_seats',remaining,'waitlist_available',o.state='forming' and o.confirmation_deadline_at>now(),'customer_price_minor',amount,'currency','EGP','policy_version_id',o.policy_version_id,'pricing_version_id',o.pricing_version_id);
end $$;
create or replace function app_private.process_occurrence_booking_due(p_occurrence_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;previous app_private.booking_due_runs%rowtype;expired uuid[];proposals uuid[];wait app_private.waitlist_entries%rowtype;seat app_private.enrollments%rowtype;count_seats integer;count_ordinary integer;next_due timestamptz;result jsonb;run_id uuid:=gen_random_uuid();decision_id uuid;begin
 if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 occ:=app_private.booking_lock_occurrence(p_occurrence_id);
 select * into previous from app_private.booking_due_runs where occurrence_id=p_occurrence_id and idempotency_key=p_idempotency_key;if previous.id is not null then return previous.result;end if;
 expired:=app_private.booking_expire_holds(occ.id);proposals:=app_private.booking_expire_proposals(occ.id);
 if occ.format='group' and occ.state='forming' and occ.confirmation_deadline_at<=now() then
  insert into app_private.booking_formation_decisions(occurrence_id,occurrence_version,policy_version_id,deadline_at,action,reason) values(occ.id,occ.version,occ.policy_version_id,occ.confirmation_deadline_at,app_private.policy_content(occ.policy_version_id)->>'formation_failure_action','confirmation_deadline_elapsed') on conflict(occurrence_id,deadline_at) do nothing returning id into decision_id;
  if decision_id is not null then
   insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,decision_id,'booking_formation_resolution_required',occ.id,jsonb_build_object('decision_id',decision_id,'reason','confirmation_deadline_elapsed'));
   perform app_private.enqueue_event(decision_id,'booking_formation_resolution_required',occ.id,jsonb_build_object('occurrence_id',occ.id,'decision_id',decision_id),'notifications.route');
  end if;
 end if;
 select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
 if occ.state='forming' and occ.confirmation_deadline_at>now() and app_private.has_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor') and count_seats<occ.capacity and count_ordinary<coalesce(occ.target_tier,1) then
  for wait in select * from app_private.waitlist_entries where occurrence_id=occ.id and state='waiting' order by created_at,id for update loop
   if not app_private.booking_waitlist_eligible(wait.id) then
    update app_private.waitlist_entries set state='ineligible',version=version+1,updated_at=now() where id=wait.id;continue;
   end if;
   perform app_private.assert_learner_scope(wait.requested_by,wait.learner_id,'booking');
   seat:=app_private.booking_new_hold(occ.id,wait.learner_id,wait.requested_by);update app_private.waitlist_entries set state='offered',offered_enrollment_id=seat.id,version=version+1,updated_at=now() where id=wait.id;exit;
  end loop;
 end if;
 select min(hold_expires_at) into next_due from app_private.enrollments where occurrence_id=occ.id and state='held';next_due:=least(next_due,app_private.booking_next_proposal_due(occ.id),case when occ.state='forming' and occ.confirmation_deadline_at>now() then occ.confirmation_deadline_at else null end);
 select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
 if occ.state='forming' and occ.confirmation_deadline_at>now() and app_private.has_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor') and count_seats<occ.capacity and count_ordinary<coalesce(occ.target_tier,1) and exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=occ.id and app_private.booking_waitlist_eligible(w.id)) then next_due:=now();end if;
 if next_due is not null and(seat.id is null or next_due<seat.hold_expires_at) then perform app_private.booking_enqueue_due(occ.id,next_due);end if;
 result:=jsonb_build_object('expired_enrollment_ids',to_jsonb(expired),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end,'enrollment_id',seat.id,'next_due_at',next_due);
 insert into app_private.booking_due_runs(id,occurrence_id,idempotency_key,request_hash,result) values(run_id,occ.id,p_idempotency_key,app_private.catalog_hash(jsonb_build_object('occurrence_id',occ.id)),result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run_id,'booking_due_processed',occ.id,jsonb_build_object('actor_kind','worker','expired_count',cardinality(expired),'expired_proposal_count',cardinality(proposals),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end));
 perform app_private.enqueue_event(run_id,'booking_due_processed',occ.id,jsonb_build_object('occurrence_id',occ.id,'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end),'notifications.route');return result;
end $$;
create or replace function app_private.booking_apply_schedule(p_occurrence_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_actor uuid,p_command_id uuid) returns app_private.occurrences language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;available_version integer;event_id uuid:=gen_random_uuid();job_id uuid;begin
 occ:=app_private.booking_lock_occurrence(p_occurrence_id);
 if occ.state not in ('forming','confirmed') or p_start_at<=now() or p_end_at-p_start_at<>make_interval(mins=>occ.duration_minutes) then raise exception 'INVALID_TIME';end if;
 if occ.state='forming' and p_start_at-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
 available_version:=app_private.booking_assert_schedule(occ.tutor_id,p_start_at,p_end_at,occ.id);
 job_id:=app_private.enqueue_event(event_id,'occurrence_rescheduled',occ.id,jsonb_build_object('occurrence_id',occ.id,'occurrence_version',occ.version+1,'command_id',p_command_id),'calendar.sync');
 update app_private.occurrences set start_at=p_start_at,end_at=p_end_at,availability_version=available_version,version=occ.version+1,quote_terms_version=occ.quote_terms_version+1,meeting_status='pending',calendar_job_id=job_id,confirmation_deadline_at=p_start_at-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int),updated_at=now() where id=occ.id returning * into occ;
 update app_private.tutor_reservations set start_at=p_start_at,end_at=p_end_at where occurrence_id=occ.id;if occ.state='forming' then perform app_private.booking_enqueue_due(occ.id,occ.confirmation_deadline_at);end if;return occ;
end $$;
notify pgrst,'reload schema';

