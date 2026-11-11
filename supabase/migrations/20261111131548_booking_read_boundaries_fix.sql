-- T04 exact occurrence filters, canonical availability hashes, strict direct RPC validation.
create or replace function app_private.booking_validate_intervals(p_weekly jsonb,p_exceptions jsonb) returns void language plpgsql immutable set search_path='' as $$
declare item jsonb;entry jsonb;day text;intervals jsonb;previous_end text;begin
 if jsonb_typeof(p_weekly) is distinct from 'array' or jsonb_typeof(p_exceptions) is distinct from 'array' or jsonb_array_length(p_weekly)>70 or jsonb_array_length(p_exceptions)>366 then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_weekly) loop
  if jsonb_typeof(item)<>'object' or (item-array['weekday','start_local','end_local'])<>'{}'::jsonb or not(item?'weekday' and item?'start_local' and item?'end_local') or jsonb_typeof(item->'weekday')<>'number' or (item->>'weekday')::numeric not in (1,2,3,4,5,6,7) then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_exceptions) e group by e->>'local_date' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_exceptions) loop
  if jsonb_typeof(item)<>'object' or (item-array['local_date','intervals'])<>'{}'::jsonb or not(item?'local_date' and item?'intervals') or coalesce(item->>'local_date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(item->'intervals') is distinct from 'array' or jsonb_array_length(item->'intervals')>10 then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_array_elements(item->'intervals') e where jsonb_typeof(e)<>'object' or(e-array['start_local','end_local'])<>'{}'::jsonb) then raise exception 'VALIDATION_ERROR';end if;
  day:=((item->>'local_date')::date)::text;if day<>item->>'local_date' then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 for intervals in select jsonb_agg(value order by value->>'start_local') from jsonb_array_elements(p_weekly) group by value->>'weekday'
 union all select value->'intervals' from jsonb_array_elements(p_exceptions) loop
  previous_end:=null;
  for entry in select value from jsonb_array_elements(intervals) order by value->>'start_local' loop
   if jsonb_typeof(entry)<>'object' or (entry-array['weekday','start_local','end_local'])<>'{}'::jsonb or jsonb_typeof(entry->'start_local') is distinct from 'string' or jsonb_typeof(entry->'end_local') is distinct from 'string' or entry->>'start_local'!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or entry->>'end_local'!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or entry->>'start_local'>=entry->>'end_local' or (previous_end is not null and entry->>'start_local'<previous_end) then raise exception 'VALIDATION_ERROR';end if;
   previous_end:=entry->>'end_local';
  end loop;
 end loop;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'VALIDATION_ERROR';end $$;
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
  resource:=occ.id;version:=1;result:=jsonb_build_object('occurrence_id',occ.id,'state',occ.state);perform set_config('response.status','201',true);
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
   if count_seats>=occ.capacity or count_ordinary>=coalesce(occ.target_tier,1) then raise exception 'CAPACITY_CONFLICT';end if;
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
  if p_kind='occurrences' and not exists(select 1 from app_private.offers o where o.id=(p_filters->>'offer_id')::uuid and o.status='published' and o.effective_at<=now()) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',case when p_kind='occurrences' then app_private.booking_occurrence_dto(x.id) else app_private.booking_staff_occurrence_dto(x.id,p_kind='admin_occurrences') end) order by x.start_at,x.id),'[]') into rows from(
   select o.* from app_private.occurrences o where((p_filters->>'occurrence_id' is not null and p_filters->>'from' is null) or o.start_at>=from_at) and((p_filters->>'occurrence_id' is not null and p_filters->>'to' is null) or o.start_at<to_at) and(p_filters->>'occurrence_id' is null or o.id=(p_filters->>'occurrence_id')::uuid) and(p_cursor is null or(o.start_at,o.id)>(after_at,after_id)) and(p_filters->>'state' is null or o.state=p_filters->>'state') and(p_filters->>'format' is null or o.format=p_filters->>'format') and(p_filters->>'tutor_id' is null or o.tutor_id=(p_filters->>'tutor_id')::uuid)
   and(p_kind<>'occurrences' or(o.offer_id=(p_filters->>'offer_id')::uuid and o.state in ('forming','confirmed') and o.start_at>now() and app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor'))) and(p_kind<>'tutor_occurrences' or o.tutor_id=teacher) order by o.start_at,o.id limit p_limit+1)x;
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
create or replace function app_private.booking_public_offer_dto(p_id uuid,p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;rows jsonb;total integer;next_start timestamptz;begin
 result:=app_private.catalog_offer_dto(p_id,false);
 select count(*),min(start_at) into total,next_start from app_private.occurrences where offer_id=p_id and app_private.has_role((select account_id from app_private.tutors where id=tutor_id),'tutor') and state in ('forming','confirmed') and start_at>now() and start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days');
 select coalesce(jsonb_agg(app_private.booking_occurrence_dto(id) order by start_at,id),'[]') into rows from(select id,start_at from app_private.occurrences where offer_id=p_id and app_private.has_role((select account_id from app_private.tutors where id=tutor_id),'tutor') and state in ('forming','confirmed') and start_at>now() and start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days') order by start_at,id limit 5) current_schedule;
 return jsonb_set(result,'{availability}',jsonb_build_object('scheduled_occurrences',total,'next_start_at',next_start,'next_occurrences',rows,'has_more',total>5));
end $$;
grant create on schema api to git_tutor_commands;
drop function api.list_admin_occurrences(timestamptz,timestamptz,text,text,uuid,text,integer);
create function api.list_admin_occurrences(p_from timestamptz default null,p_to timestamptz default null,p_state text default null,p_format text default null,p_tutor_id uuid default null,p_cursor text default null,p_limit integer default 25,p_occurrence_id uuid default null) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('admin_occurrences',jsonb_build_object('occurrence_id',p_occurrence_id,'from',p_from,'to',p_to,'state',p_state,'format',p_format,'tutor_id',p_tutor_id),p_cursor,p_limit) $$;
drop function api.list_tutor_occurrences(timestamptz,timestamptz,text,text,integer);
create function api.list_tutor_occurrences(p_from timestamptz default null,p_to timestamptz default null,p_state text default null,p_cursor text default null,p_limit integer default 25,p_occurrence_id uuid default null) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('tutor_occurrences',jsonb_build_object('occurrence_id',p_occurrence_id,'from',p_from,'to',p_to,'state',p_state),p_cursor,p_limit) $$;
drop function api.list_offer_occurrences(uuid,timestamptz,timestamptz,text,integer);
create function api.list_offer_occurrences(p_offer_id uuid,p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 25,p_occurrence_id uuid default null) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('occurrences',jsonb_build_object('occurrence_id',p_occurrence_id,'offer_id',p_offer_id,'from',p_from,'to',p_to),p_cursor,p_limit) $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and p.proname in ('list_admin_occurrences','list_tutor_occurrences','list_offer_occurrences') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
revoke create on schema api from git_tutor_commands;
notify pgrst,'reload schema';

