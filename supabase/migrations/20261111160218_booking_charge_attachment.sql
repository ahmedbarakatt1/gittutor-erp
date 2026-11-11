-- T06 charge issuance is an effect of genuine quote consent, under the booking lock.
grant create on schema api,app_private,finance_private to git_tutor_commands;
create function finance_private.finance_ensure_enrollment_charge(p_enrollment_id uuid,p_quote_id uuid,p_quote_acceptance_id uuid,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;q app_private.quotes%rowtype;a app_private.quote_acceptances%rowtype;charge_id uuid;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;
 select * into q from app_private.quotes where id=p_quote_id;
 select * into a from app_private.quote_acceptances where id=p_quote_acceptance_id;
 if e.id is null or q.enrollment_id is distinct from e.id or a.quote_id is distinct from q.id or a.learner_id is distinct from e.learner_id or a.terms_hash is distinct from q.terms_hash then raise exception 'CONSENT_REQUIRED';end if;
 if e.hold_kind<>'ordinary' or e.current_quote_id<>q.id then raise exception 'STATE_CONFLICT';end if;
 if not app_private.booking_can_access(a.actor_account_id,e.learner_id) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.package_lock_learner(e.learner_id);
 select id into charge_id from finance_private.charges where enrollment_id=e.id;
 if charge_id is not null then return charge_id;end if;
 charge_id:=finance_private.finance_issue_charge('enrollment',e.learner_id,a.actor_account_id,null,e.id,q.policy_version_id,q.terms_hash,q.customer_price_minor,p_context);
 insert into finance_private.charge_acceptance_sources(charge_id,source_kind,quote_id,quote_acceptance_id,accepted_actor_account_id,accepted_at,accepted_terms_hash) values(charge_id,'quote',q.id,a.id,a.actor_account_id,a.accepted_at,a.terms_hash);
 return charge_id;
end $$;

create function api.prepare_enrollment_charge(p_enrollment_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;a app_private.quote_acceptances%rowtype;context jsonb;charge_id uuid;existing_id uuid;commitment text;begin
 actor:=app_private.require_actor();select * into e from app_private.enrollments where id=p_enrollment_id;
 if e.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform app_private.package_assert_scope(actor,e.learner_id,'payments',true);
 context:=app_private.booking_begin(actor,'prepare_enrollment_charge',jsonb_build_object('enrollment_id',p_enrollment_id,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 o:=app_private.booking_lock_occurrence(e.occurrence_id);select * into e from app_private.enrollments where id=e.id for update;
 if p_expected_version is distinct from e.version then raise exception 'VERSION_CONFLICT';end if;
 if e.hold_kind<>'ordinary' then raise exception 'STATE_CONFLICT';end if;
 select * into a from app_private.quote_acceptances where quote_id=e.current_quote_id and app_private.booking_can_access(actor_account_id,e.learner_id) order by accepted_at,id limit 1;
 if a.id is null then raise exception 'CONSENT_REQUIRED';end if;
 select id into existing_id from finance_private.charges where enrollment_id=e.id;
 charge_id:=finance_private.finance_ensure_enrollment_charge(e.id,e.current_quote_id,a.id,context);
 select commitment_state into commitment from finance_private.charge_accounts where finance_private.charge_accounts.charge_id=charge_id;
 if existing_id is null then perform set_config('response.status','201',true);end if;
 return app_private.booking_finish(context,charge_id,(select version from finance_private.charge_accounts where finance_private.charge_accounts.charge_id=charge_id),jsonb_build_object('charge_id',charge_id,'commitment_state',commitment),'enrollment_charge_prepared',jsonb_build_object('enrollment_id',e.id,'charge_id',charge_id));
end $$;
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
   perform finance_private.finance_ensure_enrollment_charge(seat.id,quote.id,(select id from app_private.quote_acceptances where quote_id=quote.id and actor_account_id=actor),context);
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
alter function finance_private.finance_ensure_enrollment_charge(uuid,uuid,uuid,jsonb) owner to git_tutor_commands;
alter function api.prepare_enrollment_charge(uuid,integer,text) owner to git_tutor_commands;
revoke all on function finance_private.finance_ensure_enrollment_charge(uuid,uuid,uuid,jsonb),api.prepare_enrollment_charge(uuid,integer,text) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.prepare_enrollment_charge(uuid,integer,text) to authenticated;
revoke create on schema api,app_private,finance_private from git_tutor_commands;

grant create on schema api,app_private,finance_private to git_tutor_commands;
create function finance_private.finance_ensure_amendment_charge(p_amendment_id uuid,p_enrollment_id uuid,p_proposal_acceptance_id uuid,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;t app_private.operation_customer_terms%rowtype;a app_private.operation_proposal_acceptances%rowtype;q app_private.quotes%rowtype;charge_id uuid;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;
 select * into o from app_private.occurrences where id=e.occurrence_id;
 select * into p from app_private.operation_proposals where id=p_amendment_id;
 select * into g from app_private.group_amendments where id=p_amendment_id;
 select * into t from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=e.id;
 select * into a from app_private.operation_proposal_acceptances where id=p_proposal_acceptance_id;
 select * into q from app_private.quotes where id=t.proposed_quote_id;
 if e.id is null or p.id is null or g.id is null or e.hold_kind<>'amendment' or e.amendment_id is distinct from p.id or not(e.learner_id=any(g.add_learner_ids)) or e.state<>'held' or e.hold_expires_at<=now() then raise exception 'STATE_CONFLICT';end if;
 if a.proposal_id is distinct from p.id or a.participant_type is distinct from 'learner' or a.participant_id is distinct from e.learner_id or a.terms_hash is distinct from t.terms_hash or not t.financial_terms_ready or not app_private.booking_can_access(a.actor_account_id,e.learner_id) then raise exception 'CONSENT_REQUIRED';end if;
 if p.state not in('proposed','accepted') or p.expires_at<=now() or not app_private.booking_proposal_fresh(p.id) or e.current_quote_id is distinct from t.source_quote_id or q.enrollment_id is distinct from e.id or q.base_terms_version is distinct from o.quote_terms_version+1 or q.policy_version_id is distinct from g.replacement_policy_version_id or q.customer_price_minor is distinct from(t.terms->>'customer_price_minor')::bigint then raise exception 'VERSION_CONFLICT';end if;
 perform app_private.package_lock_learner(e.learner_id);
 select c.id into charge_id from finance_private.charges c where c.enrollment_id=e.id;
 if charge_id is not null then
  if not exists(select 1 from finance_private.charge_acceptance_sources s where s.charge_id=charge_id and s.proposal_acceptance_id=a.id and s.quote_id=q.id) then raise exception 'STATE_CONFLICT';end if;return charge_id;
 end if;
 charge_id:=finance_private.finance_issue_charge('enrollment',e.learner_id,a.actor_account_id,null,e.id,q.policy_version_id,a.terms_hash,q.customer_price_minor,p_context);
 update finance_private.charge_accounts set commitment_state='awaiting_amendment',conditional_amendment_id=p.id where finance_private.charge_accounts.charge_id=charge_id;
 insert into finance_private.charge_acceptance_sources(charge_id,source_kind,quote_id,proposal_id,proposal_acceptance_id,accepted_actor_account_id,accepted_at,accepted_terms_hash) values(charge_id,'amendment',q.id,p.id,a.id,a.actor_account_id,a.accepted_at,a.terms_hash);
 return charge_id;
end $$;
create or replace function app_private.booking_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;context jsonb;occ app_private.occurrences%rowtype;destination app_private.occurrences%rowtype;seat app_private.enrollments%rowtype;
 p app_private.operation_proposals%rowtype;q app_private.quotes%rowtype;newq app_private.quotes%rowtype;policy app_private.policy_versions%rowtype;fee finance_private.tutor_fee_agreements%rowtype;
 ct app_private.operation_customer_terms%rowtype;acceptance app_private.operation_proposal_acceptances%rowtype;
 resource uuid:=gen_random_uuid();resource_version integer:=1;result jsonb:='{}';event_name text;terms jsonb;customer jsonb;tutor_terms jsonb;kind text;target_type text;target_id uuid;participant jsonb;
 start_time timestamptz;end_time timestamptz;expiry timestamptz;new_policy uuid;new_target integer;new_price bigint;old_price bigint;expected integer;reason text;financial_ready boolean;is_admin boolean;is_tutor boolean;
 adds uuid[];removes uuid[];learner uuid;active_count integer;removed_count integer;proposed_quotes uuid[]:='{}';approval_id uuid;h text;replay jsonb;
begin
 actor:=app_private.require_actor();is_admin:=app_private.has_role(actor,'admin');expected:=(p_input->>'expected_version')::int;
 if p_name='create_operation_proposal' then
  kind:=p_input->>'kind';terms:=p_input->'requested_terms';perform app_private.booking_proposal_validate_terms(kind,terms);target_type:=terms->>'target_type';target_id:=(p_input->>'target_id')::uuid;
  if target_type='enrollment' then select * into seat from app_private.enrollments where id=target_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking',true);occ:=app_private.booking_lock_occurrence(seat.occurrence_id);
  else occ:=app_private.booking_lock_occurrence(target_id);is_tutor:=exists(select 1 from app_private.tutors where id=occ.tutor_id and account_id=actor and app_private.has_role(actor,'tutor'));
   if is_admin then perform app_private.require_role(actor,'admin');elsif is_tutor and kind='reschedule' then perform app_private.require_role(actor,'tutor');
   elsif occ.format='private' and kind='reschedule' then select * into seat from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed') and app_private.booking_can_access(actor,learner_id);if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking');
   else raise exception 'NOT_FOUND' using errcode='P0002';end if;
  end if;
 elsif p_name='propose_group_amendment' then perform app_private.require_role(actor,'admin');occ:=app_private.booking_lock_occurrence((p_input->>'occurrence_id')::uuid);kind:='group_amendment';target_type:='occurrence';target_id:=occ.id;
 elsif p_name in ('reschedule_occurrence','cancel_occurrence','cancel_enrollment','transfer_enrollment') then
  if p_name in ('cancel_enrollment','transfer_enrollment') then select * into seat from app_private.enrollments where id=(p_input->>'enrollment_id')::uuid;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking',true);occ:=app_private.booking_lock_occurrence(seat.occurrence_id);resource:=seat.id;
  else perform app_private.require_role(actor,'admin');occ:=app_private.booking_lock_occurrence((p_input->>'occurrence_id')::uuid);resource:=occ.id;end if;
 else
  select * into p from app_private.operation_proposals where id=coalesce((p_input->>'proposal_id')::uuid,(p_input->>'amendment_id')::uuid);
  if p.id is null or(p.kind='group_amendment') is distinct from(p_name in ('accept_group_amendment','decline_group_amendment','commit_group_amendment')) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  occ:=app_private.booking_lock_occurrence(p.occurrence_id);select * into p from app_private.operation_proposals where id=p.id for update;resource:=p.id;
  if p_name in ('approve_operation_proposal','commit_group_amendment') then perform app_private.require_role(actor,'admin');
  elsif p_name in ('accept_operation_proposal','accept_group_amendment') then participant:=app_private.booking_proposal_participant(actor,p.id,p_input->>'terms_hash');
  elsif p_name in ('decline_operation_proposal','decline_group_amendment') then
   if is_admin and p_name='decline_group_amendment' then perform app_private.require_role(actor,'admin');else
    select terms_hash into h from app_private.operation_customer_terms where proposal_id=p.id and app_private.booking_can_access(actor,learner_id) order by learner_id limit 1;
    if h is null then select t.terms_hash into h from finance_private.operation_tutor_terms t join app_private.tutors person on person.id=t.tutor_id where t.proposal_id=p.id and person.account_id=actor;end if;
    participant:=app_private.booking_proposal_participant(actor,p.id,h);
   end if;
  else raise exception 'VALIDATION_ERROR';end if;
 end if;
 if seat.id is not null then select * into seat from app_private.enrollments where id=seat.id for update;if seat.occurrence_id<>occ.id then raise exception 'VERSION_CONFLICT';end if;end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);replay:=context->'replay_result';if replay is not null and replay<>'null'::jsonb then return replay;end if;
 if p_name in ('create_operation_proposal','propose_group_amendment','reschedule_occurrence','cancel_occurrence','cancel_enrollment','transfer_enrollment') then
  if expected is null or expected is distinct from(case when(p_name='create_operation_proposal' and target_type='enrollment') or p_name in ('cancel_enrollment','transfer_enrollment') then seat.version else occ.version end) then raise exception 'VERSION_CONFLICT';end if;
 else if expected is null or expected<>p.version then raise exception 'VERSION_CONFLICT';end if;end if;
 if p_name not in ('accept_operation_proposal','accept_group_amendment','commit_group_amendment','transfer_enrollment') then reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;end if;

 if p_name in ('create_operation_proposal','propose_group_amendment') then
  if occ.state not in ('forming','confirmed') then raise exception 'STATE_CONFLICT';end if;
  perform app_private.booking_expire_holds(occ.id);perform app_private.booking_expire_proposals(occ.id);
  if target_type='enrollment' and(seat.state not in ('held','confirmed') or(seat.state='held' and seat.hold_expires_at<=now())) then raise exception 'WINDOW_CLOSED';end if;
  start_time:=occ.start_at;end_time:=occ.end_at;new_policy:=occ.policy_version_id;new_target:=occ.target_tier;financial_ready:=true;
  if p_name='create_operation_proposal' then
   expiry:=(terms->>'expires_at')::timestamptz;
   if kind='reschedule' and target_type='occurrence' then start_time:=(terms->>'start_at')::timestamptz;end_time:=(terms->>'end_at')::timestamptz;
    if not isfinite(start_time) or not isfinite(end_time) or start_time<=now() or end_time-start_time<>make_interval(mins=>occ.duration_minutes) then raise exception 'INVALID_TIME';end if;
    perform app_private.booking_assert_schedule(occ.tutor_id,start_time,end_time,occ.id);
    if occ.state='forming' and start_time-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
   elsif kind='reschedule' then
    select * into destination from app_private.occurrences where id=(terms->>'destination_occurrence_id')::uuid and state='forming' and start_at>now();
    if destination.id is null or destination.id=occ.id then raise exception 'NOT_FOUND' using errcode='P0002';end if;start_time:=destination.start_at;end_time:=destination.end_at;new_policy:=destination.policy_version_id;new_target:=destination.target_tier;financial_ready:=false;
   else financial_ready:=false;
    if terms->>'remedy'<>'policy_default' and not(app_private.policy_content(occ.policy_version_id)->'allowed_refund_remedies'?(terms->>'remedy')) then raise exception 'POLICY_INCOMPLETE';end if;
   end if;
  else
   if occ.format<>'group' or exists(select 1 from app_private.operation_proposals where occurrence_id=occ.id and kind='group_amendment' and state in ('proposed','accepted','approved')) then raise exception 'STATE_CONFLICT';end if;
   if jsonb_typeof(p_input->'add_learner_ids') is distinct from 'array' or jsonb_typeof(p_input->'remove_enrollment_ids') is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
   select coalesce(array_agg(value::uuid),'{}') into adds from jsonb_array_elements_text(p_input->'add_learner_ids');select coalesce(array_agg(value::uuid),'{}') into removes from jsonb_array_elements_text(p_input->'remove_enrollment_ids');
   if cardinality(adds)>4 or cardinality(removes)>4 or(select count(distinct x) from unnest(adds)x)<>cardinality(adds) or(select count(distinct x) from unnest(removes)x)<>cardinality(removes) then raise exception 'VALIDATION_ERROR';end if;
   new_target:=(p_input->>'target_tier')::int;new_policy:=(p_input->>'replacement_policy_version_id')::uuid;expiry:=(p_input->>'expires_at')::timestamptz;
   select * into policy from app_private.policy_versions where id=new_policy for share;
   if policy.id is null or policy.status not in ('approved','published') or policy.scope<>'group' or policy.effective_at>now() then raise exception 'POLICY_INCOMPLETE';end if;
   perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
   customer:=app_private.policy_content(policy.id);
   if new_target is null or new_target not between 2 and 4 or new_target>occ.capacity or(customer->>'group_target_size')::int<>new_target or(customer->>'group_capacity')::numeric<occ.capacity or(customer->>'duration_minutes')::numeric<>occ.duration_minutes then raise exception 'POLICY_INCOMPLETE';end if;
   if now()>=occ.start_at-make_interval(mins=>least((customer->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int) then raise exception 'WINDOW_CLOSED';end if;
   expiry:=least(expiry,now()+make_interval(mins=>least((customer->>'amendment_acceptance_minutes')::numeric,2147483647)::int),occ.start_at-make_interval(mins=>least((customer->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int));
   select * into fee from finance_private.tutor_fee_agreements where id=(p_input->>'fee_agreement_id')::uuid;
   if fee.id is null or fee.occurrence_id<>occ.id or fee.tutor_id<>occ.tutor_id or fee.purpose<>'amendment' or fee.base_occurrence_version<>occ.version or fee.target_tier<>new_target or fee.pricing_version_id<>policy.pricing_version_id or fee.duration_minutes<>occ.duration_minutes then raise exception 'POLICY_INCOMPLETE';end if;
   perform app_private.assert_exact_tutor_fee(fee.pricing_version_id,new_target,fee.fee_minor,fee.currency,fee.duration_minutes);
   select count(*) into active_count from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now()));
   select count(*) into removed_count from app_private.enrollments where occurrence_id=occ.id and id=any(removes) and(state='confirmed' or(state='held' and hold_expires_at>now()));
   if removed_count<>cardinality(removes) or active_count-removed_count+cardinality(adds)<>new_target or active_count+cardinality(adds)>occ.capacity then raise exception 'CAPACITY_CONFLICT';end if;
   foreach learner in array adds loop
    if not exists(select 1 from app_private.learners l join app_private.accounts a on a.id=l.account_id where l.id=learner and a.active) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=learner and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   end loop;
   terms:=jsonb_build_object('target_type','occurrence','target_tier',new_target,'replacement_policy_version_id',new_policy,'add_learner_ids',adds,'remove_enrollment_ids',removes,'expires_at',expiry);
  end if;
  if expiry is null or not isfinite(expiry) or expiry<=now() or expiry>least(occ.start_at,start_time) then raise exception 'INVALID_TIME';end if;
  select least(expiry,min(hold_expires_at)) into expiry from app_private.enrollments where occurrence_id=occ.id and state='held' and hold_expires_at>now() and(target_type='occurrence' or id=target_id);
  if p_name='propose_group_amendment' then foreach learner in array adds loop perform app_private.booking_new_hold(occ.id,learner,actor,resource,new_policy,new_target,expiry);end loop;end if;
  insert into app_private.operation_proposals(id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason)
   values(resource,kind,target_type,target_id,occ.id,case when target_type='enrollment' then seat.version else occ.version end,occ.version,app_private.booking_roster_fingerprint(occ.id),new_policy,terms,expiry,actor,reason) returning * into p;
  if p_name='propose_group_amendment' then insert into app_private.group_amendments(id,replacement_policy_version_id,pricing_version_id,target_tier,add_learner_ids,remove_enrollment_ids) values(p.id,new_policy,policy.pricing_version_id,new_target,adds,removes);end if;
  for seat in select * from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now())) and(target_type='occurrence' or id=target_id) order by id for update loop
   select * into q from app_private.quotes where id=seat.current_quote_id;new_price:=q.customer_price_minor;
   if p_name='propose_group_amendment' then
    select (value->>'seat_price_minor')::bigint into new_price from app_private.pricing_versions v,jsonb_array_elements(v.customer_pricing->'group_tiers') where v.id=policy.pricing_version_id and(value->>'group_size')::int=new_target;
    if seat.id=any(removes) then new_price:=0;end if;
    newq:=app_private.booking_proposal_new_quote(seat.id,new_policy,new_target,new_price,start_time,end_time,least(q.expires_at,expiry),true);proposed_quotes:=array_append(proposed_quotes,newq.id);
   elsif kind='reschedule' and target_type='enrollment' then new_price:=(app_private.booking_occurrence_dto(destination.id)->>'customer_price_minor')::bigint;end if;
   customer:=app_private.booking_proposal_customer_json(seat.id,new_policy,start_time,end_time,new_price,case when kind='cancellation_remedy' then terms->>'remedy' when p_name='propose_group_amendment' and seat.id=any(removes) then 'policy_default' else 'none' end,destination.id,p_name='propose_group_amendment' and seat.learner_id=any(adds));
   insert into app_private.operation_customer_terms(proposal_id,learner_id,enrollment_id,source_quote_id,proposed_quote_id,terms,terms_hash,financial_terms_ready)
    values(p.id,seat.learner_id,seat.id,q.id,newq.id,customer,app_private.booking_proposal_hash(p.id,'learner',seat.learner_id,customer,p.expires_at,p.base_target_version),financial_ready and not coalesce(seat.id=any(removes),false));
  end loop;
  tutor_terms:=app_private.booking_proposal_tutor_json(occ.id,case when not financial_ready then null when p_name='propose_group_amendment' then fee.id else occ.current_fee_agreement_id end,start_time,end_time,new_target);
  insert into finance_private.operation_tutor_terms(proposal_id,tutor_id,fee_agreement_id,terms,terms_hash) values(p.id,occ.tutor_id,case when not financial_ready then null when p_name='propose_group_amendment' then fee.id else occ.current_fee_agreement_id end,tutor_terms,app_private.booking_proposal_hash(p.id,'tutor',occ.tutor_id,tutor_terms,p.expires_at,p.base_target_version));
  perform app_private.booking_enqueue_due(occ.id,p.expires_at);
  if p_name='propose_group_amendment' then result:=jsonb_build_object('amendment_id',p.id,'affected_quote_ids',proposed_quotes);event_name:='group_amendment_proposed';
  else h:=case when is_admin then app_private.booking_proposal_admin_hash(p.id) when is_tutor then(select terms_hash from finance_private.operation_tutor_terms where proposal_id=p.id) else(select terms_hash from app_private.operation_customer_terms where proposal_id=p.id and app_private.booking_can_access(actor,learner_id) order by learner_id limit 1) end;
   result:=jsonb_build_object('proposal_id',p.id,'terms_hash',h,'expires_at',p.expires_at,'required_actions','["review_terms"]'::jsonb);event_name:='operation_proposal_created';end if;
  perform set_config('response.status','201',true);
 elsif p_name in ('accept_operation_proposal','accept_group_amendment','decline_operation_proposal','decline_group_amendment','approve_operation_proposal','commit_group_amendment') then
  if p.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
  if not app_private.booking_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
  if p_name in ('accept_operation_proposal','accept_group_amendment') then
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;if not(participant->>'financial_terms_ready')::boolean then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   insert into app_private.operation_proposal_acceptances(proposal_id,participant_type,participant_id,actor_account_id,terms_hash) values(p.id,participant->>'type',(participant->>'id')::uuid,actor,p_input->>'terms_hash') on conflict(proposal_id,participant_type,participant_id) do nothing;
   select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type=participant->>'type' and participant_id=(participant->>'id')::uuid;
   if acceptance.actor_account_id<>actor then raise exception 'STATE_CONFLICT';end if;
   if p_name='accept_group_amendment' and acceptance.participant_type='learner' and exists(select 1 from app_private.enrollments e where e.amendment_id=p.id and e.learner_id=acceptance.participant_id and e.hold_kind='amendment') then perform finance_private.finance_ensure_amendment_charge(p.id,(select id from app_private.enrollments e where e.amendment_id=p.id and e.learner_id=acceptance.participant_id),acceptance.id,context);end if;
   if app_private.booking_proposal_all_accepted(p.id) then update app_private.operation_proposals set state='accepted',updated_at=now() where id=p.id;end if;
   result:=jsonb_build_object('accepted_at',acceptance.accepted_at);event_name:='proposal_terms_accepted';resource_version:=p.version;
  elsif p_name in ('decline_operation_proposal','decline_group_amendment') then
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   update app_private.operation_proposals set state='declined',version=version+1,updated_at=now() where id=p.id returning version into resource_version;
   update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where amendment_id=p.id and state='held';perform app_private.booking_enqueue_due(occ.id,now());
   result:=jsonb_build_object('state','declined');event_name:='proposal_declined';
  elsif p_name='approve_operation_proposal' then
   if p_input->>'decision' is null or p_input->>'decision' not in ('approved','rejected') or p_input->>'terms_hash' is distinct from app_private.booking_proposal_admin_hash(p.id) then raise exception 'VALIDATION_ERROR';end if;
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   if p_input->>'decision'='approved' and not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
   if p_input->>'decision'='approved' and exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and not financial_terms_ready) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,p_input->>'terms_hash',p_input->>'decision',actor,reason) returning id into approval_id;
   update app_private.operation_proposals set state=case when p_input->>'decision'='approved' then 'approved' else 'declined' end,version=version+1,approved_by=actor,approved_at=now(),updated_at=now() where id=p.id returning * into p;
   resource_version:=p.version;result:=jsonb_build_object('approval_id',approval_id,'state',p.state);event_name:='operation_proposal_reviewed';
  else
   if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
   raise exception 'DEPENDENCY_UNAVAILABLE'; -- T06 owns atomic charge/credit/fee/roster postings.
  end if;
 elsif p_name='reschedule_occurrence' then
  if p_input->>'time_zone' is distinct from 'Africa/Cairo' then raise exception 'INVALID_TIME';end if;
  start_time:=(p_input->>'start_at')::timestamptz;end_time:=(p_input->>'end_at')::timestamptz;
  if p_input->>'accepted_proposal_id' is not null then
   select * into p from app_private.operation_proposals where id=(p_input->>'accepted_proposal_id')::uuid for update;
   if p.id is null or p.kind<>'reschedule' or p.target_type<>'occurrence' or p.target_id<>occ.id or p.state<>'approved' then raise exception 'STATE_CONFLICT';end if;
   if not app_private.booking_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
   if(p.requested_terms->>'start_at')::timestamptz is distinct from start_time or(p.requested_terms->>'end_at')::timestamptz is distinct from end_time or not app_private.has_role(p.approved_by,'admin') then raise exception 'CONSENT_REQUIRED';end if;
   perform app_private.require_role(p.approved_by,'admin');
   if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
  elsif exists(select 1 from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now()))) then raise exception 'CONSENT_REQUIRED';end if;
  occ:=app_private.booking_apply_schedule(occ.id,start_time,end_time,actor,(context->>'command_id')::uuid);
  if p.id is not null then
   for ct in select * from app_private.operation_customer_terms where proposal_id=p.id order by enrollment_id loop
    select * into seat from app_private.enrollments where id=ct.enrollment_id for update;select * into q from app_private.quotes where id=seat.current_quote_id;
    newq:=app_private.booking_proposal_new_quote(seat.id,q.policy_version_id,q.target_tier,q.customer_price_minor,start_time,end_time,least(q.expires_at,occ.confirmation_deadline_at),false);
    select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=ct.learner_id;
    insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash,accepted_at,acceptance_basis,source_proposal_acceptance_id,source_terms_hash) values(newq.id,acceptance.actor_account_id,ct.learner_id,newq.terms_hash,acceptance.accepted_at,'operation_proposal',acceptance.id,ct.terms_hash);
    update app_private.enrollments set current_quote_id=newq.id,hold_expires_at=case when state='held' then least(hold_expires_at,newq.expires_at) else hold_expires_at end,version=version+1,updated_at=now() where id=seat.id;
   end loop;
   update app_private.operation_proposals set state='committed',version=version+1,committed_at=now(),updated_at=now() where id=p.id;
  end if;
  resource_version:=occ.version;result:=jsonb_build_object('meeting_status',occ.meeting_status,'calendar_job_id',occ.calendar_job_id);event_name:='occurrence_rescheduled';
 elsif p_name='cancel_occurrence' then
  if occ.state not in ('draft','forming','confirmed') then raise exception 'STATE_CONFLICT';end if;
  if exists(select 1 from app_private.enrollments where occurrence_id=occ.id) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  update app_private.occurrences set state='cancelled',meeting_status='revoked',version=version+1,updated_at=now() where id=occ.id returning version into resource_version;update app_private.tutor_reservations set active=false where occurrence_id=occ.id;
  update app_private.waitlist_entries set state='cancelled',version=version+1,updated_at=now() where occurrence_id=occ.id and state in ('waiting','offered');
  result:=jsonb_build_object('state','cancelled','affected_enrollment_ids','[]'::jsonb);event_name:='occurrence_cancelled';
 elsif p_name in ('cancel_enrollment','transfer_enrollment') then raise exception 'DEPENDENCY_UNAVAILABLE';
 else raise exception 'VALIDATION_ERROR';end if;
 return app_private.booking_finish(context,resource,resource_version,result,event_name,jsonb_build_object('resource_id',resource,'occurrence_id',occ.id,'version',resource_version));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;
alter function finance_private.finance_ensure_amendment_charge(uuid,uuid,uuid,jsonb) owner to git_tutor_commands;
revoke all on function finance_private.finance_ensure_amendment_charge(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';

