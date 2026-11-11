-- T04 scoped provisional consent, server-derived sale eligibility and bounded UTC instants.
grant create on schema app_private to git_tutor_commands;
create function app_private.booking_validate_times(p_start_at timestamptz,p_end_at timestamptz) returns void language plpgsql immutable security definer set search_path='' as $$
begin
 if p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at) or p_start_at<timestamptz '0001-01-01 00:00:00+00' or p_end_at<timestamptz '0001-01-01 00:00:00+00' or p_start_at>=timestamptz '10000-01-01 00:00:00+00' or p_end_at>=timestamptz '10000-01-01 00:00:00+00' or p_end_at<=p_start_at then raise exception 'INVALID_TIME';end if;
end $$;
create function app_private.booking_offer_sellable(p_offer_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.offers o join app_private.subjects s on s.id=o.subject_id join app_private.policy_versions p on p.id=o.policy_version_id join app_private.pricing_versions price on price.id=o.pricing_version_id
 where o.id=p_offer_id and o.status='published' and o.effective_at<=now() and s.active and p.status='published' and p.effective_at<=now() and price.status='published' and price.effective_at<=now() and p.pricing_version_id=price.id and p.scope=o.format and price.scope=o.format
 and p.environment_scope=case when app_private.catalog_environment() in ('test','development') then 'development_test' else 'production' end and price.environment_scope=p.environment_scope
 and p.is_synthetic=(app_private.catalog_environment() in ('test','development')) and price.is_synthetic=p.is_synthetic)
$$;
alter function app_private.booking_validate_times(timestamptz,timestamptz) owner to git_tutor_commands;
alter function app_private.booking_offer_sellable(uuid) owner to git_tutor_commands;
revoke all on function app_private.booking_validate_times(timestamptz,timestamptz),app_private.booking_offer_sellable(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
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
  if not app_private.booking_offer_sellable(offer.id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  policy:=app_private.policy_content(offer.policy_version_id);
  perform app_private.assert_catalog_publication(app_private.catalog_environment(),(select environment_scope from app_private.policy_versions where id=offer.policy_version_id),(select is_synthetic from app_private.policy_versions where id=offer.policy_version_id));
  select * into teacher from app_private.tutors where id=(p_input->>'tutor_id')::uuid for update;
  if teacher.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.require_role(teacher.account_id,'tutor');
  if not exists(select 1 from app_private.tutor_profile_versions p where p.id=teacher.approved_profile_version_id and p.state='approved' and offer.subject_id=any(p.subject_ids)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  start_at:=(p_input->>'start_at')::timestamptz;end_at:=(p_input->>'end_at')::timestamptz;perform app_private.booking_validate_times(start_at,end_at);
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
  if p_name in ('reserve_enrollment','join_waitlist') and not app_private.booking_offer_sellable(occ.offer_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if p_name in ('reserve_enrollment','join_waitlist','confirm_occurrence','approve_tutor_fee') then perform app_private.require_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor');end if;
  if p_name='reserve_enrollment' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
   if count_seats>=occ.capacity or count_ordinary>=coalesce(occ.target_tier,1) or exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=occ.id and app_private.booking_waitlist_eligible(w.id)) then raise exception 'CAPACITY_CONFLICT';end if;
   seat:=app_private.booking_new_hold(occ.id,(p_input->>'learner_id')::uuid,actor);select * into quote from app_private.quotes where id=seat.current_quote_id;
   resource:=seat.id;version:=seat.version;result:=jsonb_build_object('enrollment_id',seat.id,'hold_expires_at',seat.hold_expires_at,'quote_id',quote.id,'customer_price_minor',quote.customer_price_minor,'currency',quote.currency);perform set_config('response.status','201',true);
  elsif p_name='accept_quote' then
   select * into seat from app_private.enrollments where id=seat.id for update;
   if seat.hold_kind='amendment' then raise exception 'STATE_CONFLICT';end if;
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
create or replace function app_private.booking_assert_schedule(p_tutor_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_excluded_occurrence_id uuid default null) returns integer language plpgsql security definer set search_path='' as $$
declare rules app_private.availability_rules%rowtype;exceptions jsonb;begin
 perform app_private.booking_validate_times(p_start_at,p_end_at);
 select * into rules from app_private.availability_rules where tutor_id=p_tutor_id;
 select coalesce(jsonb_agg(jsonb_build_object('local_date',local_date,'intervals',intervals)),'[]') into exceptions from app_private.availability_exceptions where tutor_id=p_tutor_id;
 if rules.id is null or not app_private.booking_schedule_covered(rules.weekly_intervals,exceptions,p_start_at,p_end_at) or exists(select 1 from app_private.tutor_reservations where tutor_id=p_tutor_id and active and (p_excluded_occurrence_id is null or occurrence_id<>p_excluded_occurrence_id) and tstzrange(start_at,end_at,'[)')&&tstzrange(p_start_at,p_end_at,'[)')) then raise exception 'SCHEDULE_CONFLICT';end if;return rules.version;
end $$;
create or replace function app_private.booking_apply_schedule(p_occurrence_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_actor uuid,p_command_id uuid) returns app_private.occurrences language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;available_version integer;event_id uuid:=gen_random_uuid();job_id uuid;begin
 perform app_private.booking_validate_times(p_start_at,p_end_at);
 occ:=app_private.booking_lock_occurrence(p_occurrence_id);
 if occ.state not in ('forming','confirmed') or p_start_at<=now() or p_end_at-p_start_at<>make_interval(mins=>occ.duration_minutes) then raise exception 'INVALID_TIME';end if;
 if occ.state='forming' and p_start_at-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
 available_version:=app_private.booking_assert_schedule(occ.tutor_id,p_start_at,p_end_at,occ.id);
 job_id:=app_private.enqueue_event(event_id,'occurrence_rescheduled',occ.id,jsonb_build_object('occurrence_id',occ.id,'occurrence_version',occ.version+1,'command_id',p_command_id),'calendar.sync');
 update app_private.occurrences set start_at=p_start_at,end_at=p_end_at,availability_version=available_version,version=occ.version+1,quote_terms_version=occ.quote_terms_version+1,meeting_status='pending',calendar_job_id=job_id,confirmation_deadline_at=p_start_at-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int),updated_at=now() where id=occ.id returning * into occ;
 update app_private.tutor_reservations set start_at=p_start_at,end_at=p_end_at where occurrence_id=occ.id;if occ.state='forming' then perform app_private.booking_enqueue_due(occ.id,occ.confirmation_deadline_at);end if;return occ;
end $$;
create or replace function app_private.booking_quote_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q app_private.quotes%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;accepted timestamptz;begin
 select * into q from app_private.quotes where id=p_id;if q.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into e from app_private.enrollments where id=q.enrollment_id;select * into o from app_private.occurrences where id=q.occurrence_id;
 select min(accepted_at) into accepted from app_private.quote_acceptances where quote_id=q.id;
 return jsonb_build_object('quote_id',q.id,'version',q.version,'enrollment_id',q.enrollment_id,'learner_id',e.learner_id,'occurrence_id',q.occurrence_id,'occurrence_version',q.base_occurrence_version,'start_at',q.customer_terms->'start_at','end_at',q.customer_terms->'end_at','time_zone','Africa/Cairo','target_tier',q.target_tier,'customer_price_minor',q.customer_price_minor,'currency',q.currency,'policy_version_id',q.policy_version_id,'pricing_version_id',q.pricing_version_id,'customer_policy',q.customer_terms->'customer_policy','quote_hash',q.terms_hash,'expires_at',q.expires_at,'accepted_at',accepted,'is_current',e.hold_kind='ordinary' and e.current_quote_id=q.id and q.base_terms_version=o.quote_terms_version and(e.state='confirmed' or(e.state='held' and e.hold_expires_at>now() and q.expires_at>now())));
end $$;
create or replace function app_private.booking_enrollment_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;q app_private.quotes%rowtype;name text;begin
 select * into e from app_private.enrollments where id=p_id;select * into q from app_private.quotes where id=e.current_quote_id;
 select p.display_name into name from app_private.learners l join app_private.people p on p.id=l.person_id where l.id=e.learner_id;
 return jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner',jsonb_build_object('learner_id',e.learner_id,'display_name',coalesce(name,'Learner')),'occurrence',app_private.booking_occurrence_dto(e.occurrence_id),'state',e.state,'is_provisional',e.hold_kind='amendment','hold_expires_at',e.hold_expires_at,'quote',app_private.booking_quote_dto(e.current_quote_id),'funding',app_private.booking_funding_status(e.id,q.id,q.policy_version_id),'meeting_status',(select meeting_status from app_private.occurrences where id=e.occurrence_id),'authorized_file_ids','[]'::jsonb,'pending_proposals',app_private.booking_pending_proposals(e.occurrence_id,e.learner_id,null));
end $$;
create or replace function app_private.booking_read(p_kind text,p_filters jsonb,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;teacher uuid;rows jsonb;items jsonb;after_at timestamptz;after_id uuid;from_at timestamptz;to_at timestamptz;next_cursor text;target uuid;learner uuid;begin
 actor:=app_private.require_actor();if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_kind in ('admin_occurrences','admin_fees','admin_availability','learners_admin') then perform app_private.require_role(actor,'admin');
 elsif p_kind in ('tutor_occurrences','tutor_fees','availability') then perform app_private.require_role(actor,'tutor');select id into teacher from app_private.tutors where account_id=actor;if teacher is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;end if;
 if p_kind in ('availability','admin_availability') then target:=coalesce(teacher,(p_filters->>'tutor_id')::uuid);if not exists(select 1 from app_private.tutors where id=target) then raise exception 'NOT_FOUND' using errcode='P0002';end if;return app_private.booking_availability_dto(target);end if;
 if p_kind in ('enrollment','quote') then
  if p_kind='quote' then select e.learner_id into learner from app_private.quotes q join app_private.enrollments e on e.id=q.enrollment_id where q.id=(p_filters->>'quote_id')::uuid;
  else select learner_id into learner from app_private.enrollments where id=(p_filters->>'enrollment_id')::uuid;end if;
  if learner is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,learner,'booking',true);
  return case when p_kind='quote' then app_private.booking_quote_dto((p_filters->>'quote_id')::uuid) else app_private.booking_enrollment_dto((p_filters->>'enrollment_id')::uuid) end;
 end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;end if;
 from_at:=coalesce((p_filters->>'from')::timestamptz,now());to_at:=coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days');if not isfinite(from_at) or not isfinite(to_at) or(from_at>=to_at and(p_filters->>'occurrence_id' is null or(p_filters->>'from' is not null and p_filters->>'to' is not null))) then raise exception 'INVALID_TIME';end if;
 if p_filters->>'format' is not null and p_filters->>'format' not in ('private','group') then raise exception 'VALIDATION_ERROR';end if;
 if p_kind in ('enrollments','waitlist') and p_filters->>'learner_id' is not null then perform app_private.assert_learner_scope(actor,(p_filters->>'learner_id')::uuid,'booking');end if;
 if p_kind in ('occurrences','admin_occurrences','tutor_occurrences') then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('draft','forming','confirmed','in_progress','completion_pending','completed','cancelled') then raise exception 'VALIDATION_ERROR';end if;
  if p_kind='occurrences' and not app_private.booking_offer_sellable((p_filters->>'offer_id')::uuid) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',case when p_kind='occurrences' then app_private.booking_occurrence_dto(x.id) else app_private.booking_staff_occurrence_dto(x.id,p_kind='admin_occurrences') end) order by x.start_at,x.id),'[]') into rows from(
   select o.* from app_private.occurrences o where((p_filters->>'occurrence_id' is not null and p_filters->>'from' is null) or o.start_at>=from_at) and((p_filters->>'occurrence_id' is not null and p_filters->>'to' is null) or o.start_at<to_at) and(p_filters->>'occurrence_id' is null or o.id=(p_filters->>'occurrence_id')::uuid) and(p_cursor is null or(o.start_at,o.id)>(after_at,after_id)) and(p_filters->>'state' is null or o.state=p_filters->>'state') and(p_filters->>'format' is null or o.format=p_filters->>'format') and(p_filters->>'tutor_id' is null or o.tutor_id=(p_filters->>'tutor_id')::uuid)
   and(p_kind<>'occurrences' or(o.offer_id=(p_filters->>'offer_id')::uuid and (o.state='confirmed' or(o.state='forming' and o.confirmation_deadline_at>now())) and o.start_at>now() and app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor'))) and(p_kind<>'tutor_occurrences' or o.tutor_id=teacher) order by o.start_at,o.id limit p_limit+1)x;
 elsif p_kind='enrollments' then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('held','confirmed','cancelled','expired') then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',app_private.booking_enrollment_dto(x.id)) order by x.start_at,x.id),'[]') into rows from(
   select e.id,o.start_at from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id where app_private.booking_can_access(actor,e.learner_id) and(p_filters->>'learner_id' is null or e.learner_id=(p_filters->>'learner_id')::uuid) and(p_filters->>'state' is null or e.state=p_filters->>'state') and o.start_at>=from_at and o.start_at<to_at and(p_cursor is null or(o.start_at,e.id)>(after_at,after_id)) order by o.start_at,e.id limit p_limit+1)x;
 elsif p_kind in ('tutor_fees','admin_fees') then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.booking_fee_dto(x.id)) order by x.created_at,x.id),'[]') into rows from(
   select f.id,f.approved_at as created_at from finance_private.tutor_fee_agreements f join app_private.occurrences o on o.id=f.occurrence_id where(p_kind<>'tutor_fees' or(f.tutor_id=teacher and o.start_at>=from_at and o.start_at<to_at)) and(p_kind<>'admin_fees' or f.occurrence_id=(p_filters->>'occurrence_id')::uuid) and(p_cursor is null or(f.approved_at,f.id)>(after_at,after_id)) order by f.approved_at,f.id limit p_limit+1)x;
 elsif p_kind in ('learners','learners_admin') then
  if p_filters->>'q' is not null and length(p_filters->>'q')>200 then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',jsonb_build_object('learner_id',x.id,'display_name',x.display_name)) order by x.created_at,x.id),'[]') into rows from(
   select l.id,l.created_at,p.display_name from app_private.learners l join app_private.people p on p.id=l.person_id join app_private.accounts a on a.id=l.account_id
   where a.active and(p_kind='learners_admin' or app_private.booking_can_access(actor,l.id)) and exists(select 1 from app_private.auth_account(a.id) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) and(p_filters->>'q' is null or p.display_name ilike '%'||(p_filters->>'q')||'%') and(p_cursor is null or(l.created_at,l.id)>(after_at,after_id)) order by l.created_at,l.id limit p_limit+1)x;
 elsif p_kind='waitlist' then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('waiting','offered','accepted','expired','cancelled','ineligible') then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',jsonb_build_object('waitlist_entry_id',x.id,'version',x.version,'learner_id',x.learner_id,'occurrence',app_private.booking_occurrence_dto(x.occurrence_id),'state',x.state,'position',case when x.state='waiting' then(select count(*) from app_private.waitlist_entries w where w.occurrence_id=x.occurrence_id and w.state='waiting' and(w.created_at,w.id)<=(x.created_at,x.id)) else null end,'offered_enrollment_id',x.offered_enrollment_id,'offer_expires_at',(select hold_expires_at from app_private.enrollments where id=x.offered_enrollment_id))) order by x.created_at,x.id),'[]') into rows from(
   select w.* from app_private.waitlist_entries w where app_private.booking_can_access(actor,w.learner_id) and(p_filters->>'learner_id' is null or w.learner_id=(p_filters->>'learner_id')::uuid) and(p_filters->>'state' is null or w.state=p_filters->>'state') and(p_cursor is null or(w.created_at,w.id)>(after_at,after_id)) order by w.created_at,w.id limit p_limit+1)x;
 else raise exception 'VALIDATION_ERROR';end if;
 select coalesce(jsonb_agg(value->'data' order by ordinality),'[]') into items from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit;
 if jsonb_array_length(rows)>p_limit then next_cursor:=(rows->(p_limit-1)->>'at')||'|'||(rows->(p_limit-1)->>'id');end if;return jsonb_build_object('items',items,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;
create or replace function app_private.catalog_read_page(p_kind text,p_filters jsonb,p_cursor text,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; items jsonb; next_cursor text:=null; after_time timestamptz; after_id uuid; scope_name text; actor uuid; env text; begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_kind<>'public_offers' then actor:=app_private.require_actor(); perform app_private.require_role(actor,'admin'); end if;
  if p_cursor is not null then
    if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR'; end if;
    after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
  end if;
  scope_name:=coalesce(p_filters->>'format',p_filters->>'scope');
  if scope_name is not null and scope_name not in ('group','private') then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'status' is not null and p_filters->>'status' not in ('draft','approved','published','retired') then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'kind' is not null and p_filters->>'kind'<>'booking' then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'from' is not null and p_filters->>'to' is not null and (p_filters->>'from')::timestamptz>(p_filters->>'to')::timestamptz then raise exception 'INVALID_TIME'; end if;
  if p_kind in ('public_offers','offers') then
    if p_kind='public_offers' then env:=app_private.catalog_environment(); end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',case when p_kind='offers' then app_private.catalog_offer_dto(x.id,true) else app_private.booking_public_offer_dto(x.id,p_filters) end) order by x.created_at desc,x.id desc),'[]') into rows from (
      select o.* from app_private.offers o join app_private.subjects s on s.id=o.subject_id join app_private.policy_versions p on p.id=o.policy_version_id
      where (scope_name is null or o.format=scope_name) and (p_filters->>'status' is null or o.status=p_filters->>'status')
        and (p_filters->>'offer_id' is null or o.id=(p_filters->>'offer_id')::uuid) and (p_filters->>'subject_id' is null or o.subject_id=(p_filters->>'subject_id')::uuid)
        and (p_cursor is null or (o.created_at,o.id)<(after_time,after_id))
        and (p_kind='offers' or (app_private.booking_offer_sellable(o.id)
          and p.environment_scope=case when env in ('test','development') then 'development_test' else 'production' end
          and p.is_synthetic=(env in ('test','development'))
          -- T04 filters actual scheduled occurrences before catalog pagination.
          and ((p_filters->>'from' is null and p_filters->>'to' is null) or exists(select 1 from app_private.occurrences scheduled where scheduled.offer_id=o.id and (scheduled.state='confirmed' or(scheduled.state='forming' and scheduled.confirmation_deadline_at>now())) and app_private.has_role((select account_id from app_private.tutors where id=scheduled.tutor_id),'tutor') and scheduled.start_at>now() and scheduled.start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and scheduled.start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days')))))
      order by o.created_at desc,o.id desc limit p_limit+1
    ) x;
  elsif p_kind='policies' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_policy_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select p.* from app_private.policy_versions p where (scope_name is null or p.scope=scope_name) and (p_filters->>'status' is null or p.status=p_filters->>'status') and (p_cursor is null or (p.created_at,p.id)<(after_time,after_id)) order by p.created_at desc,p.id desc limit p_limit+1
    ) x;
  elsif p_kind='pricing' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_pricing_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select p.* from app_private.pricing_versions p where (scope_name is null or p.scope=scope_name) and (p_filters->>'status' is null or p.status=p_filters->>'status') and (p_cursor is null or (p.created_at,p.id)<(after_time,after_id)) order by p.created_at desc,p.id desc limit p_limit+1
    ) x;
  elsif p_kind='tutors' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_tutor_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select t.* from app_private.tutors t left join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id
      where (p_filters->>'subject_id' is null or (p_filters->>'subject_id')::uuid=any(p.subject_ids))
        and (p_filters->>'active' is null or app_private.has_role(t.account_id,'tutor')=(p_filters->>'active')::boolean)
        and (p_cursor is null or (t.created_at,t.id)<(after_time,after_id)) order by t.created_at desc,t.id desc limit p_limit+1
    ) x;
  else raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(jsonb_agg(value->'data' order by ordinality),'[]') into items from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit;
  if jsonb_array_length(rows)>p_limit then next_cursor:=(rows->(p_limit-1)->>'at')||'|'||(rows->(p_limit-1)->>'id'); end if;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
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
 if occ.state='forming' and app_private.booking_offer_sellable(occ.offer_id) and occ.confirmation_deadline_at>now() and app_private.has_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor') and count_seats<occ.capacity and count_ordinary<coalesce(occ.target_tier,1) then
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
 if occ.state='forming' and app_private.booking_offer_sellable(occ.offer_id) and occ.confirmation_deadline_at>now() and app_private.has_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor') and count_seats<occ.capacity and count_ordinary<coalesce(occ.target_tier,1) and exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=occ.id and app_private.booking_waitlist_eligible(w.id)) then next_due:=now();end if;
 if next_due is not null and(seat.id is null or next_due<seat.hold_expires_at) then perform app_private.booking_enqueue_due(occ.id,next_due);end if;
 result:=jsonb_build_object('expired_enrollment_ids',to_jsonb(expired),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end,'enrollment_id',seat.id,'next_due_at',next_due);
 insert into app_private.booking_due_runs(id,occurrence_id,idempotency_key,request_hash,result) values(run_id,occ.id,p_idempotency_key,app_private.catalog_hash(jsonb_build_object('occurrence_id',occ.id)),result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run_id,'booking_due_processed',occ.id,jsonb_build_object('actor_kind','worker','expired_count',cardinality(expired),'expired_proposal_count',cardinality(proposals),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end));
 perform app_private.enqueue_event(run_id,'booking_due_processed',occ.id,jsonb_build_object('occurrence_id',occ.id,'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end),'notifications.route');return result;
end $$;
notify pgrst,'reload schema';
