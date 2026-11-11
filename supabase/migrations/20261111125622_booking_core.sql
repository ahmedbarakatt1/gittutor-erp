-- T04 independent booking foundation. Funding is deliberately unavailable until T06.
create extension if not exists btree_gist with schema extensions;
grant create on schema api,app_private,finance_private to git_tutor_commands;
create table app_private.availability_rules(id uuid primary key default gen_random_uuid(),tutor_id uuid not null unique references app_private.tutors(id),time_zone text not null default 'Africa/Cairo' check(time_zone='Africa/Cairo'),weekly_intervals jsonb not null default '[]',version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table app_private.availability_exceptions(id uuid primary key default gen_random_uuid(),tutor_id uuid not null references app_private.tutors(id),local_date date not null,intervals jsonb not null,unique(tutor_id,local_date));
create table app_private.occurrences(
 id uuid primary key default gen_random_uuid(),offer_id uuid not null references app_private.offers(id),tutor_id uuid not null references app_private.tutors(id),format text not null check(format in ('private','group')),target_tier integer,capacity integer not null check(capacity between 1 and 4),duration_minutes integer not null check(duration_minutes>0),
 start_at timestamptz not null,end_at timestamptz not null,time_zone text not null check(time_zone='Africa/Cairo'),policy_version_id uuid not null references app_private.policy_versions(id),pricing_version_id uuid not null references app_private.pricing_versions(id),availability_version integer not null,confirmation_deadline_at timestamptz not null,
 state text not null default 'forming' check(state in ('draft','forming','confirmed','in_progress','completion_pending','completed','cancelled')),current_fee_agreement_id uuid,meeting_status text not null default 'not_requested' check(meeting_status in ('not_requested','pending','ready','failed','revoked')),version integer not null default 1 check(version>0),quote_terms_version integer not null default 1 check(quote_terms_version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(isfinite(start_at) and isfinite(end_at) and end_at>start_at),check((format='private' and capacity=1 and target_tier is null) or (format='group' and target_tier between 2 and 4 and target_tier<=capacity))
);
create index occurrences_schedule on app_private.occurrences(start_at,id);
create index occurrences_tutor on app_private.occurrences(tutor_id,start_at);
create table app_private.tutor_assignments(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),tutor_id uuid not null references app_private.tutors(id),version integer not null default 1,active boolean not null default true,created_at timestamptz not null default now(),unique(occurrence_id,version));
create unique index tutor_assignment_current on app_private.tutor_assignments(occurrence_id) where active;
create table app_private.tutor_reservations(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null unique references app_private.occurrences(id),tutor_id uuid not null references app_private.tutors(id),start_at timestamptz not null,end_at timestamptz not null,active boolean not null default true,check(end_at>start_at),exclude using gist(tutor_id with =,tstzrange(start_at,end_at,'[)') with &&) where(active));
create table app_private.enrollments(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),learner_id uuid not null references app_private.learners(id),booker_account_id uuid not null references app_private.accounts(id),state text not null default 'held' check(state in ('held','confirmed','expired','cancelled')),hold_expires_at timestamptz,current_quote_id uuid,hold_kind text not null default 'ordinary' check(hold_kind in ('ordinary','amendment')),amendment_id uuid,version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check((hold_kind='amendment')=(amendment_id is not null)));
create unique index enrollment_active_learner on app_private.enrollments(occurrence_id,learner_id) where state in ('held','confirmed');
create index enrollment_current on app_private.enrollments(occurrence_id,state,hold_expires_at);
create table app_private.quotes(id uuid primary key default gen_random_uuid(),enrollment_id uuid not null references app_private.enrollments(id),occurrence_id uuid not null references app_private.occurrences(id),version integer not null check(version>0),base_occurrence_version integer not null,base_terms_version integer not null,policy_version_id uuid not null references app_private.policy_versions(id),pricing_version_id uuid not null references app_private.pricing_versions(id),target_tier integer,customer_price_minor bigint not null check(customer_price_minor between 0 and 9007199254740991),currency text not null check(currency='EGP'),expires_at timestamptz not null,customer_terms jsonb not null,terms_hash text not null check(terms_hash~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),unique(enrollment_id,version));
alter table app_private.enrollments add foreign key(current_quote_id) references app_private.quotes(id);
create table app_private.quote_acceptances(id uuid primary key default gen_random_uuid(),quote_id uuid not null references app_private.quotes(id),actor_account_id uuid not null references app_private.accounts(id),learner_id uuid not null references app_private.learners(id),terms_hash text not null,accepted_at timestamptz not null default now(),unique(quote_id,actor_account_id));
create table finance_private.tutor_fee_agreements(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),tutor_id uuid not null references app_private.tutors(id),pricing_version_id uuid not null references app_private.pricing_versions(id),target_tier integer,purpose text not null check(purpose in ('initial','amendment')),fee_minor bigint not null check(fee_minor between 0 and 9007199254740991),currency text not null check(currency='EGP'),duration_minutes integer not null check(duration_minutes>0),base_occurrence_version integer not null,approved_by uuid not null references app_private.accounts(id),approved_at timestamptz not null default now(),version integer not null default 1 check(version=1));
alter table app_private.occurrences add foreign key(current_fee_agreement_id) references finance_private.tutor_fee_agreements(id);
create table app_private.waitlist_entries(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),learner_id uuid not null references app_private.learners(id),requested_by uuid not null references app_private.accounts(id),state text not null default 'waiting' check(state in ('waiting','offered','accepted','expired','cancelled','ineligible')),offered_enrollment_id uuid references app_private.enrollments(id),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index waitlist_active on app_private.waitlist_entries(occurrence_id,learner_id) where state in ('waiting','offered');
create table app_private.booking_due_runs(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),idempotency_key text not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),unique(occurrence_id,idempotency_key));
do $$ declare t text; begin
 foreach t in array array['availability_rules','availability_exceptions','occurrences','tutor_assignments','tutor_reservations','enrollments','quotes','quote_acceptances','waitlist_entries','booking_due_runs'] loop
 execute format('alter table app_private.%I enable row level security',t);execute format('grant select,insert,update,delete on app_private.%I to git_tutor_commands',t);execute format('create policy commands_access on app_private.%I to git_tutor_commands using(true) with check(true)',t);execute format('revoke all on app_private.%I from anon,authenticated,service_role,git_tutor_worker',t);
 end loop;
end $$;

create function app_private.booking_read(p_kind text,p_filters jsonb,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
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
 from_at:=coalesce((p_filters->>'from')::timestamptz,now());to_at:=coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days');if not isfinite(from_at) or not isfinite(to_at) or from_at>=to_at then raise exception 'INVALID_TIME';end if;
 if p_filters->>'format' is not null and p_filters->>'format' not in ('private','group') then raise exception 'VALIDATION_ERROR';end if;
 if p_kind in ('enrollments','waitlist') and p_filters->>'learner_id' is not null then perform app_private.assert_learner_scope(actor,(p_filters->>'learner_id')::uuid,'booking');end if;
 if p_kind in ('occurrences','admin_occurrences','tutor_occurrences') then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('draft','forming','confirmed','in_progress','completion_pending','completed','cancelled') then raise exception 'VALIDATION_ERROR';end if;
  if p_kind='occurrences' and not exists(select 1 from app_private.offers o where o.id=(p_filters->>'offer_id')::uuid and o.status='published' and o.effective_at<=now()) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',case when p_kind='occurrences' then app_private.booking_occurrence_dto(x.id) else app_private.booking_staff_occurrence_dto(x.id,p_kind='admin_occurrences') end) order by x.start_at,x.id),'[]') into rows from(
   select o.* from app_private.occurrences o where o.start_at>=from_at and o.start_at<to_at and(p_cursor is null or(o.start_at,o.id)>(after_at,after_id)) and(p_filters->>'state' is null or o.state=p_filters->>'state') and(p_filters->>'format' is null or o.format=p_filters->>'format') and(p_filters->>'tutor_id' is null or o.tutor_id=(p_filters->>'tutor_id')::uuid)
   and(p_kind<>'occurrences' or(o.offer_id=(p_filters->>'offer_id')::uuid and o.state in ('forming','confirmed') and o.start_at>now())) and(p_kind<>'tutor_occurrences' or o.tutor_id=teacher) order by o.start_at,o.id limit p_limit+1)x;
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

create function app_private.process_occurrence_booking_due(p_occurrence_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;previous app_private.booking_due_runs%rowtype;expired uuid[];proposals uuid[];wait app_private.waitlist_entries%rowtype;seat app_private.enrollments%rowtype;count_seats integer;count_ordinary integer;next_due timestamptz;result jsonb;run_id uuid:=gen_random_uuid();begin
 if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 occ:=app_private.booking_lock_occurrence(p_occurrence_id);
 select * into previous from app_private.booking_due_runs where occurrence_id=p_occurrence_id and idempotency_key=p_idempotency_key;if previous.id is not null then return previous.result;end if;
 expired:=app_private.booking_expire_holds(occ.id);proposals:=app_private.booking_expire_proposals(occ.id);
 select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
 if occ.state='forming' and occ.confirmation_deadline_at>now() and count_seats<occ.capacity and count_ordinary<coalesce(occ.target_tier,1) then
  for wait in select * from app_private.waitlist_entries where occurrence_id=occ.id and state='waiting' order by created_at,id for update loop
   if not app_private.booking_can_access(wait.requested_by,wait.learner_id) or not exists(select 1 from app_private.auth_account(wait.requested_by) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) or exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=wait.learner_id and state in ('held','confirmed')) then
    update app_private.waitlist_entries set state='ineligible',version=version+1,updated_at=now() where id=wait.id;continue;
   end if;
   perform app_private.assert_learner_scope(wait.requested_by,wait.learner_id,'booking');
   seat:=app_private.booking_new_hold(occ.id,wait.learner_id,wait.requested_by);update app_private.waitlist_entries set state='offered',offered_enrollment_id=seat.id,version=version+1,updated_at=now() where id=wait.id;exit;
  end loop;
 end if;
 select min(hold_expires_at) into next_due from app_private.enrollments where occurrence_id=occ.id and state='held';next_due:=least(next_due,app_private.booking_next_proposal_due(occ.id));
 if seat.id is null and next_due is not null then perform app_private.booking_enqueue_due(occ.id,next_due);end if;
 result:=jsonb_build_object('expired_enrollment_ids',to_jsonb(expired),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end,'enrollment_id',seat.id,'next_due_at',next_due);
 insert into app_private.booking_due_runs(id,occurrence_id,idempotency_key,request_hash,result) values(run_id,occ.id,p_idempotency_key,app_private.catalog_hash(jsonb_build_object('occurrence_id',occ.id)),result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run_id,'booking_due_processed',occ.id,jsonb_build_object('actor_kind','worker','expired_count',cardinality(expired),'expired_proposal_count',cardinality(proposals),'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end));
 perform app_private.enqueue_event(run_id,'booking_due_processed',occ.id,jsonb_build_object('occurrence_id',occ.id,'promoted_waitlist_entry_id',case when seat.id is not null then wait.id else null end),'notifications.route');return result;
end $$;
alter table finance_private.tutor_fee_agreements enable row level security;
grant select,insert on finance_private.tutor_fee_agreements to git_tutor_commands;
create policy commands_access on finance_private.tutor_fee_agreements to git_tutor_commands using(true) with check(true);
revoke all on finance_private.tutor_fee_agreements from anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_quote before update or delete on app_private.quotes for each row execute function app_private.reject_immutable_change();
create trigger immutable_quote_acceptance before update or delete on app_private.quote_acceptances for each row execute function app_private.reject_immutable_change();
create trigger immutable_fee before update or delete on finance_private.tutor_fee_agreements for each row execute function app_private.reject_immutable_change();
create trigger immutable_booking_due before update or delete on app_private.booking_due_runs for each row execute function app_private.reject_immutable_change();

create function app_private.booking_begin(p_actor uuid,p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous app_private.command_results%rowtype; hash text; begin
 if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 perform set_config('response.status','200',true);hash:=app_private.catalog_hash(p_input);
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_name||':'||p_key,0));
 select * into previous from app_private.command_results where actor_account_id=p_actor and command_name=p_name and idempotency_key=p_key;
 if previous.id is not null and previous.request_hash<>hash then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 return jsonb_build_object('actor_account_id',p_actor,'command_name',p_name,'idempotency_key',p_key,'command_id',coalesce(previous.id,gen_random_uuid()),'request_hash',hash,'replay_result',previous.result);
end $$;
create function app_private.booking_finish(p_context jsonb,p_resource_id uuid,p_version integer,p_result jsonb,p_event_type text,p_event_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; command_id uuid:=(p_context->>'command_id')::uuid;actor uuid:=(p_context->>'actor_account_id')::uuid; begin
 result:=p_result||jsonb_build_object('command_id',command_id,'resource_id',p_resource_id,'version',p_version);
 insert into app_private.command_results(id,actor_account_id,command_name,idempotency_key,request_hash,result) values(command_id,actor,p_context->>'command_name',p_context->>'idempotency_key',p_context->>'request_hash',result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(actor,command_id,p_event_type,p_resource_id,jsonb_build_object('version',p_version));
 perform app_private.enqueue_event(command_id,p_event_type,p_resource_id,p_event_payload,'notifications.route');return result;
end $$;
create function app_private.booking_lock_occurrence(p_occurrence_id uuid) returns app_private.occurrences language plpgsql security definer set search_path='' as $$
declare result app_private.occurrences%rowtype;tutor uuid;begin
 select tutor_id into tutor from app_private.occurrences where id=p_occurrence_id;if tutor is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform 1 from app_private.tutors where id=tutor for update;
 select * into result from app_private.occurrences where id=p_occurrence_id for update;
 if result.tutor_id<>tutor then raise exception 'RETRYABLE_CONFLICT';end if;return result;
end $$;
create function app_private.booking_can_access(p_actor uuid,p_learner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.accounts a where a.id=p_actor and a.active) and (exists(select 1 from app_private.learners l where l.id=p_learner and l.account_id=p_actor) or exists(select 1 from app_private.guardian_links g where g.guardian_account_id=p_actor and g.learner_id=p_learner and g.revoked_at is null and g.valid_from<=now() and g.valid_until>now() and 'booking'=any(g.scopes)))
$$;
create function app_private.booking_roster_fingerprint(p_occurrence_id uuid) returns text language sql stable security definer set search_path='' as $$
 select app_private.catalog_hash(coalesce(jsonb_agg(jsonb_build_object('id',id,'learner_id',learner_id,'state',state,'version',version,'quote_id',current_quote_id,'hold_kind',hold_kind,'amendment_id',amendment_id) order by id),'[]')) from app_private.enrollments where occurrence_id=p_occurrence_id and (state='confirmed' or (state='held' and hold_expires_at>now()))
$$;
create function app_private.booking_expire_holds(p_occurrence_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare ids uuid[];begin
 with changed as(update app_private.enrollments set state='expired',version=version+1,updated_at=now() where occurrence_id=p_occurrence_id and state='held' and hold_expires_at<=now() returning id) select coalesce(array_agg(id),'{}') into ids from changed;
 update app_private.waitlist_entries set state='expired',version=version+1,updated_at=now() where offered_enrollment_id=any(ids) and state in ('offered','accepted');return ids;
end $$;
create function app_private.booking_expire_proposals(p_occurrence_id uuid) returns uuid[] language sql security definer set search_path='' as $$ select '{}'::uuid[] $$;
create function app_private.booking_next_proposal_due(p_occurrence_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$ select null::timestamptz $$;
create function app_private.booking_pending_proposals(p_occurrence_id uuid,p_learner_id uuid default null,p_tutor_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$ select '[]'::jsonb $$;

create function app_private.booking_validate_intervals(p_weekly jsonb,p_exceptions jsonb) returns void language plpgsql immutable set search_path='' as $$
declare item jsonb;entry jsonb;day text;intervals jsonb;previous_end text;begin
 if jsonb_typeof(p_weekly) is distinct from 'array' or jsonb_typeof(p_exceptions) is distinct from 'array' or jsonb_array_length(p_weekly)>70 or jsonb_array_length(p_exceptions)>366 then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_weekly) loop
  if jsonb_typeof(item)<>'object' or (item-array['weekday','start_local','end_local'])<>'{}'::jsonb or not(item?'weekday' and item?'start_local' and item?'end_local') or jsonb_typeof(item->'weekday')<>'number' or (item->>'weekday')::numeric not in (1,2,3,4,5,6,7) then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_exceptions) e group by e->>'local_date' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_exceptions) loop
  if jsonb_typeof(item)<>'object' or (item-array['local_date','intervals'])<>'{}'::jsonb or not(item?'local_date' and item?'intervals') or coalesce(item->>'local_date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(item->'intervals') is distinct from 'array' or jsonb_array_length(item->'intervals')>10 then raise exception 'VALIDATION_ERROR';end if;
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
create function app_private.booking_schedule_covered(p_weekly jsonb,p_exceptions jsonb,p_start timestamptz,p_end timestamptz) returns boolean language plpgsql stable set search_path='' as $$
declare point timestamptz;local_point timestamp;rows jsonb;local_day date;begin
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '25 hours' then return false;end if;
 local_day:=(p_start at time zone 'Africa/Cairo')::date;
 if ((p_end-interval '1 microsecond') at time zone 'Africa/Cairo')::date<>local_day then return false;end if;
 select value->'intervals' into rows from jsonb_array_elements(p_exceptions) where (value->>'local_date')::date=local_day;
 if rows is null then select coalesce(jsonb_agg(value),'[]') into rows from jsonb_array_elements(p_weekly) where (value->>'weekday')::int=extract(isodow from local_day);end if;
 for point in select generate_series(p_start,p_end-interval '1 microsecond',interval '1 minute') union select p_end-interval '1 microsecond' loop
  local_point:=point at time zone 'Africa/Cairo';
  if not exists(select 1 from jsonb_array_elements(rows) where local_point::time>=(value->>'start_local')::time and local_point::time<(value->>'end_local')::time) then return false;end if;
 end loop;return true;
end $$;
create function app_private.booking_assert_schedule(p_tutor_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_excluded_occurrence_id uuid default null) returns integer language plpgsql security definer set search_path='' as $$
declare rules app_private.availability_rules%rowtype;exceptions jsonb;begin
 select * into rules from app_private.availability_rules where tutor_id=p_tutor_id;
 select coalesce(jsonb_agg(jsonb_build_object('local_date',local_date,'intervals',intervals)),'[]') into exceptions from app_private.availability_exceptions where tutor_id=p_tutor_id;
 if rules.id is null or not app_private.booking_schedule_covered(rules.weekly_intervals,exceptions,p_start_at,p_end_at) or exists(select 1 from app_private.tutor_reservations where tutor_id=p_tutor_id and active and (p_excluded_occurrence_id is null or occurrence_id<>p_excluded_occurrence_id) and tstzrange(start_at,end_at,'[)')&&tstzrange(p_start_at,p_end_at,'[)')) then raise exception 'SCHEDULE_CONFLICT';end if;return rules.version;
end $$;
create function app_private.booking_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare amount numeric;policy jsonb;required numeric;begin
 select customer_price_minor into amount from app_private.quotes where id=p_quote_id and enrollment_id=p_enrollment_id;policy:=app_private.policy_content(p_policy_version_id);
 required:=amount*(policy->>'deposit_basis_points')::numeric/10000;
 required:=case policy->>'deposit_rounding' when 'ceiling_minor_unit' then ceil(required) when 'floor_minor_unit' then floor(required) else floor(required+0.5) end;
 return jsonb_build_object('integration_state','awaiting_T06_integration','eligible',false,'reason','T06_INTEGRATION_REQUIRED','charge_id',null,'net_charge_minor',null,'allocated_minor',null,'balance_minor',null,'required_for_confirmation_minor',required,'reserved_credit_quanta',null,'allocated_package_value_minor',null,'top_up_minor',null);
end $$;
create function app_private.booking_enqueue_due(p_occurrence_id uuid,p_due_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid:=gen_random_uuid();job_id uuid;begin
 if p_due_at is null then return null;end if;
 insert into app_private.domain_events(id,event_type,aggregate_id,payload,correlation_id) values(event_id,'booking_due',p_occurrence_id,jsonb_build_object('occurrence_id',p_occurrence_id),event_id);
 insert into app_private.outbox_jobs(event_id,purpose,available_at) values(event_id,'booking.process_due',greatest(p_due_at,now())) returning id into job_id;return job_id;
end $$;
create function app_private.booking_new_hold(p_occurrence_id uuid,p_learner_id uuid,p_booker uuid,p_amendment_id uuid default null,p_policy_version_id uuid default null,p_target_tier integer default null,p_expires_at timestamptz default null) returns app_private.enrollments language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;seat app_private.enrollments%rowtype;policy jsonb;price jsonb;pricing_id uuid;policy_id uuid;target integer;amount bigint;expiry timestamptz;terms jsonb;quote_id uuid:=gen_random_uuid();begin
 select * into occ from app_private.occurrences where id=p_occurrence_id;
 policy_id:=coalesce(p_policy_version_id,occ.policy_version_id);policy:=app_private.policy_content(policy_id);
 select pricing_version_id into pricing_id from app_private.policy_versions where id=policy_id;select customer_pricing into price from app_private.pricing_versions where id=pricing_id;
 target:=coalesce(p_target_tier,occ.target_tier);expiry:=least(now()+make_interval(mins=>least((policy->>'hold_minutes')::numeric,2147483647)::int),occ.confirmation_deadline_at,coalesce(p_expires_at,'infinity'));
 if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
 if occ.format='private' then amount:=(price->>'private_seat_price_minor')::bigint;else select (value->>'seat_price_minor')::bigint into amount from jsonb_array_elements(price->'group_tiers') where (value->>'group_size')::int=target;end if;
 if amount is null then raise exception 'POLICY_INCOMPLETE';end if;
 insert into app_private.enrollments(occurrence_id,learner_id,booker_account_id,hold_expires_at,hold_kind,amendment_id) values(occ.id,p_learner_id,p_booker,expiry,case when p_amendment_id is null then 'ordinary' else 'amendment' end,p_amendment_id) returning * into seat;
 terms:=jsonb_build_object('quote_id',quote_id,'enrollment_id',seat.id,'learner_id',p_learner_id,'occurrence_id',occ.id,'start_at',occ.start_at,'end_at',occ.end_at,'time_zone',occ.time_zone,'target_tier',target,'customer_price_minor',amount,'currency','EGP','policy_version_id',policy_id,'pricing_version_id',pricing_id,'customer_policy',app_private.customer_policy_summary(policy_id),'expires_at',expiry);
 insert into app_private.quotes(id,enrollment_id,occurrence_id,version,base_occurrence_version,base_terms_version,policy_version_id,pricing_version_id,target_tier,customer_price_minor,currency,expires_at,customer_terms,terms_hash) values(quote_id,seat.id,occ.id,1,occ.version,occ.quote_terms_version,policy_id,pricing_id,target,amount,'EGP',expiry,terms,app_private.catalog_hash(terms));
 update app_private.enrollments set current_quote_id=quote_id where id=seat.id returning * into seat;perform app_private.booking_enqueue_due(occ.id,expiry);return seat;
end $$;

create function app_private.booking_occurrence_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;price jsonb;amount bigint;tutor_name text;occupied integer;ordinary integer;remaining integer;begin
 select * into o from app_private.occurrences where id=p_id;if o.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select customer_pricing into price from app_private.pricing_versions where id=o.pricing_version_id;
 if o.format='private' then amount:=(price->>'private_seat_price_minor')::bigint;else select (value->>'seat_price_minor')::bigint into amount from jsonb_array_elements(price->'group_tiers') where (value->>'group_size')::int=o.target_tier;end if;
 select p.display_name into tutor_name from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id where t.id=o.tutor_id;
 select count(*),count(*) filter(where hold_kind='ordinary') into occupied,ordinary from app_private.enrollments where occurrence_id=o.id and (state='confirmed' or(state='held' and hold_expires_at>now()));
 remaining:=case when o.state='forming' and o.confirmation_deadline_at>now() then greatest(0,least(o.capacity-occupied,coalesce(o.target_tier,1)-ordinary)) else 0 end;
 return jsonb_build_object('occurrence_id',o.id,'version',o.version,'offer_id',o.offer_id,'tutor',jsonb_build_object('tutor_id',o.tutor_id,'display_name',coalesce(tutor_name,'Tutor')),'start_at',o.start_at,'end_at',o.end_at,'time_zone',o.time_zone,'state',o.state,'format',o.format,'target_tier',o.target_tier,'capacity',o.capacity,'available_seats',remaining,'waitlist_available',o.state='forming' and o.confirmation_deadline_at>now(),'customer_price_minor',amount,'currency','EGP','policy_version_id',o.policy_version_id,'pricing_version_id',o.pricing_version_id);
end $$;
create function app_private.booking_quote_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q app_private.quotes%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;accepted timestamptz;begin
 select * into q from app_private.quotes where id=p_id;if q.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into e from app_private.enrollments where id=q.enrollment_id;select * into o from app_private.occurrences where id=q.occurrence_id;
 select min(accepted_at) into accepted from app_private.quote_acceptances where quote_id=q.id;
 return jsonb_build_object('quote_id',q.id,'version',q.version,'enrollment_id',q.enrollment_id,'learner_id',e.learner_id,'occurrence_id',q.occurrence_id,'occurrence_version',q.base_occurrence_version,'start_at',q.customer_terms->'start_at','end_at',q.customer_terms->'end_at','time_zone','Africa/Cairo','target_tier',q.target_tier,'customer_price_minor',q.customer_price_minor,'currency',q.currency,'policy_version_id',q.policy_version_id,'pricing_version_id',q.pricing_version_id,'customer_policy',q.customer_terms->'customer_policy','quote_hash',q.terms_hash,'expires_at',q.expires_at,'accepted_at',accepted,'is_current',e.current_quote_id=q.id and q.base_terms_version=o.quote_terms_version and(e.state='confirmed' or(e.state='held' and e.hold_expires_at>now() and q.expires_at>now())));
end $$;
create function app_private.booking_fee_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('fee_agreement_id',f.id,'occurrence_id',f.occurrence_id,'occurrence_version',f.base_occurrence_version,'tutor_id',f.tutor_id,'target_tier',f.target_tier,'fee_minor',f.fee_minor,'currency',f.currency,'duration_minutes',f.duration_minutes,'compensation_policy_version_id',f.pricing_version_id,'purpose',f.purpose,'is_current',o.current_fee_agreement_id=f.id,'approved_at',f.approved_at,'accepted_at',null) from finance_private.tutor_fee_agreements f join app_private.occurrences o on o.id=f.occurrence_id where f.id=p_id
$$;
create function app_private.booking_enrollment_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;q app_private.quotes%rowtype;name text;begin
 select * into e from app_private.enrollments where id=p_id;select * into q from app_private.quotes where id=e.current_quote_id;
 select p.display_name into name from app_private.learners l join app_private.people p on p.id=l.person_id where l.id=e.learner_id;
 return jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner',jsonb_build_object('learner_id',e.learner_id,'display_name',coalesce(name,'Learner')),'occurrence',app_private.booking_occurrence_dto(e.occurrence_id),'state',e.state,'hold_expires_at',e.hold_expires_at,'quote',app_private.booking_quote_dto(e.current_quote_id),'funding',app_private.booking_funding_status(e.id,q.id,q.policy_version_id),'meeting_status',(select meeting_status from app_private.occurrences where id=e.occurrence_id),'authorized_file_ids','[]'::jsonb,'pending_proposals',app_private.booking_pending_proposals(e.occurrence_id,e.learner_id,null));
end $$;
create function app_private.booking_availability_dto(p_tutor_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('tutor_id',p_tutor_id,'version',coalesce((select version from app_private.availability_rules where tutor_id=p_tutor_id),0),'time_zone','Africa/Cairo','weekly_intervals',coalesce((select weekly_intervals from app_private.availability_rules where tutor_id=p_tutor_id),'[]'),'dated_exceptions',coalesce((select jsonb_agg(jsonb_build_object('local_date',local_date,'intervals',intervals) order by local_date) from app_private.availability_exceptions where tutor_id=p_tutor_id),'[]'),'committed_occurrence_ids',coalesce((select jsonb_agg(occurrence_id order by start_at,occurrence_id) from app_private.tutor_reservations where tutor_id=p_tutor_id and active and end_at>now()),'[]'))
$$;
create function app_private.booking_staff_occurrence_dto(p_id uuid,p_admin boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;roster jsonb;result jsonb;begin
 select * into occ from app_private.occurrences where id=p_id;
 select coalesce(jsonb_agg(case when p_admin then jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner_id',e.learner_id,'display_name',p.display_name,'state',e.state,'hold_expires_at',e.hold_expires_at,'quote_id',e.current_quote_id,'quote_accepted_at',(select min(accepted_at) from app_private.quote_acceptances where quote_id=e.current_quote_id),'funding',app_private.booking_funding_status(e.id,e.current_quote_id,q.policy_version_id),'provisional_amendment_id',e.amendment_id) else jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'display_name',p.display_name,'state',e.state) end order by e.created_at,e.id),'[]') into roster from app_private.enrollments e join app_private.learners l on l.id=e.learner_id join app_private.people p on p.id=l.person_id join app_private.quotes q on q.id=e.current_quote_id where e.occurrence_id=p_id;
 result:=jsonb_build_object('occurrence',app_private.booking_occurrence_dto(p_id),'roster',roster,'fee_agreement',app_private.booking_fee_dto(occ.current_fee_agreement_id),'pending_proposals',app_private.booking_pending_proposals(p_id,null,case when p_admin then null else occ.tutor_id end));
 if p_admin then result:=result||jsonb_build_object('confirmation_deadline',occ.confirmation_deadline_at);end if;return result;
end $$;

create function app_private.booking_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if offer.id is null or offer.status<>'published' or offer.effective_at>now() then raise exception 'NOT_FOUND' using errcode='P0002';end if;
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
  if p_name='reserve_enrollment' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'DUPLICATE_ENROLLMENT';end if;
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
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'DUPLICATE_ENROLLMENT';end if;
   insert into app_private.waitlist_entries(occurrence_id,learner_id,requested_by) values(occ.id,(p_input->>'learner_id')::uuid,actor) returning * into wait;
   resource:=wait.id;version:=wait.version;result:=jsonb_build_object('waitlist_entry_id',wait.id,'state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());perform set_config('response.status','201',true);
  elsif p_name='leave_waitlist' then
   select * into wait from app_private.waitlist_entries where id=wait.id for update;if expected is distinct from wait.version then raise exception 'VERSION_CONFLICT';end if;
   if wait.state not in ('waiting','offered') then raise exception 'VERSION_CONFLICT';end if;
   if wait.offered_enrollment_id is not null then update app_private.enrollments set state='expired',version=app_private.enrollments.version+1,updated_at=now() where id=wait.offered_enrollment_id and state='held';end if;
   update app_private.waitlist_entries set state='cancelled',version=wait.version+1,updated_at=now() where id=wait.id returning * into wait;resource:=wait.id;version:=wait.version;result:=jsonb_build_object('state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());
  elsif p_name='approve_tutor_fee' then
   if occ.state not in ('forming','confirmed') or(p_input->>'tutor_id')::uuid is distinct from occ.tutor_id or(p_input->>'duration_minutes')::int is distinct from occ.duration_minutes or p_input->>'purpose' is null or p_input->>'purpose' not in ('initial','amendment') then raise exception 'VALIDATION_ERROR';end if;
   if p_input->>'purpose'='initial' and(occ.state<>'forming' or occ.current_fee_agreement_id is not null or(p_input->>'target_tier')::int is distinct from occ.target_tier or(p_input->>'compensation_policy_version_id')::uuid<>occ.pricing_version_id) then raise exception 'IMMUTABLE_RECORD';end if;
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
    if quote.base_terms_version<>occ.quote_terms_version or quote.expires_at<=now() or not exists(select 1 from app_private.quote_acceptances a where a.quote_id=quote.id and app_private.booking_can_access(a.actor_account_id,seat.learner_id)) then raise exception 'QUOTE_NOT_ACCEPTED';end if;
    result:=app_private.booking_funding_status(seat.id,quote.id,quote.policy_version_id);if not coalesce((result->>'eligible')::boolean,false) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   end loop;
   -- No positive funding implementation is enabled here. T06 owns confirmed financial effects.
   raise exception 'DEPENDENCY_UNAVAILABLE';
  end if;
 end if;
 event_name:='booking_'||p_name;return app_private.booking_finish(context,resource,version,result,event_name,jsonb_build_object('resource_id',resource));
exception when exclusion_violation then raise exception 'SCHEDULE_CONFLICT';when unique_violation then raise exception 'DUPLICATE_ENROLLMENT';when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;

create function api.set_availability(p_tutor_id uuid,p_weekly_intervals jsonb,p_dated_exceptions jsonb,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('set_availability',jsonb_build_object('tutor_id',p_tutor_id,'weekly_intervals',p_weekly_intervals,'dated_exceptions',p_dated_exceptions,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.create_occurrence(p_offer_id uuid,p_tutor_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_time_zone text,p_target_tier integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('create_occurrence',jsonb_build_object('offer_id',p_offer_id,'tutor_id',p_tutor_id,'start_at',p_start_at,'end_at',p_end_at,'time_zone',p_time_zone,'target_tier',p_target_tier),p_idempotency_key) $$;
create function api.reserve_enrollment(p_occurrence_id uuid,p_learner_id uuid,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('reserve_enrollment',jsonb_build_object('occurrence_id',p_occurrence_id,'learner_id',p_learner_id),p_idempotency_key) $$;
create function api.accept_quote(p_quote_id uuid,p_quote_hash text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('accept_quote',jsonb_build_object('quote_id',p_quote_id,'quote_hash',p_quote_hash,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.confirm_occurrence(p_occurrence_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('confirm_occurrence',jsonb_build_object('occurrence_id',p_occurrence_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.change_occurrence_capacity(p_occurrence_id uuid,p_capacity integer,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('change_occurrence_capacity',jsonb_build_object('occurrence_id',p_occurrence_id,'capacity',p_capacity,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.join_waitlist(p_occurrence_id uuid,p_learner_id uuid,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('join_waitlist',jsonb_build_object('occurrence_id',p_occurrence_id,'learner_id',p_learner_id),p_idempotency_key) $$;
create function api.leave_waitlist(p_waitlist_entry_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('leave_waitlist',jsonb_build_object('waitlist_entry_id',p_waitlist_entry_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.approve_tutor_fee(p_occurrence_id uuid,p_tutor_id uuid,p_fee_minor bigint,p_currency text,p_duration_minutes integer,p_compensation_policy_version_id uuid,p_target_tier integer,p_purpose text,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_command('approve_tutor_fee',jsonb_build_object('occurrence_id',p_occurrence_id,'tutor_id',p_tutor_id,'fee_minor',p_fee_minor,'currency',p_currency,'duration_minutes',p_duration_minutes,'compensation_policy_version_id',p_compensation_policy_version_id,'target_tier',p_target_tier,'purpose',p_purpose,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.get_tutor_availability() returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('availability',jsonb_build_object()) $$;
create function api.get_admin_tutor_availability(p_tutor_id uuid) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('admin_availability',jsonb_build_object('tutor_id',p_tutor_id)) $$;
create function api.get_enrollment(p_enrollment_id uuid) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('enrollment',jsonb_build_object('enrollment_id',p_enrollment_id)) $$;
create function api.get_quote(p_quote_id uuid) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('quote',jsonb_build_object('quote_id',p_quote_id)) $$;
create function api.list_offer_occurrences(p_offer_id uuid,p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('occurrences',jsonb_build_object('offer_id',p_offer_id,'from',p_from,'to',p_to),p_cursor,p_limit) $$;
create function api.list_my_enrollments(p_learner_id uuid default null,p_from timestamptz default null,p_to timestamptz default null,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('enrollments',jsonb_build_object('learner_id',p_learner_id,'from',p_from,'to',p_to,'state',p_state),p_cursor,p_limit) $$;
create function api.list_my_waitlist(p_learner_id uuid default null,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('waitlist',jsonb_build_object('learner_id',p_learner_id,'state',p_state),p_cursor,p_limit) $$;
create function api.list_tutor_occurrences(p_from timestamptz default null,p_to timestamptz default null,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('tutor_occurrences',jsonb_build_object('from',p_from,'to',p_to,'state',p_state),p_cursor,p_limit) $$;
create function api.list_admin_occurrences(p_from timestamptz default null,p_to timestamptz default null,p_state text default null,p_format text default null,p_tutor_id uuid default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('admin_occurrences',jsonb_build_object('from',p_from,'to',p_to,'state',p_state,'format',p_format,'tutor_id',p_tutor_id),p_cursor,p_limit) $$;
create function api.list_tutor_fee_agreements(p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('tutor_fees',jsonb_build_object('from',p_from,'to',p_to),p_cursor,p_limit) $$;
create function api.list_admin_fee_agreements(p_occurrence_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('admin_fees',jsonb_build_object('occurrence_id',p_occurrence_id),p_cursor,p_limit) $$;
create function api.list_my_booking_learners(p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('learners',jsonb_build_object(),p_cursor,p_limit) $$;
create function api.list_booking_learners(p_q text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_read('learners_admin',jsonb_build_object('q',p_q),p_cursor,p_limit) $$;

create function app_private.booking_public_offer_dto(p_id uuid,p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;rows jsonb;total integer;next_start timestamptz;begin
 result:=app_private.catalog_offer_dto(p_id,false);
 select count(*),min(start_at) into total,next_start from app_private.occurrences where offer_id=p_id and state in ('forming','confirmed') and start_at>now() and start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days');
 select coalesce(jsonb_agg(app_private.booking_occurrence_dto(id) order by start_at,id),'[]') into rows from(select id,start_at from app_private.occurrences where offer_id=p_id and state in ('forming','confirmed') and start_at>now() and start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days') order by start_at,id limit 5) current_schedule;
 return jsonb_set(result,'{availability}',jsonb_build_object('scheduled_occurrences',total,'next_start_at',next_start,'next_occurrences',rows,'has_more',total>5));
end $$;
alter table app_private.occurrences add calendar_job_id uuid references app_private.outbox_jobs(id);
create function app_private.booking_apply_schedule(p_occurrence_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_actor uuid,p_command_id uuid) returns app_private.occurrences language plpgsql security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;available_version integer;event_id uuid:=gen_random_uuid();job_id uuid;begin
 occ:=app_private.booking_lock_occurrence(p_occurrence_id);
 if occ.state not in ('forming','confirmed') or p_start_at<=now() or p_end_at-p_start_at<>make_interval(mins=>occ.duration_minutes) then raise exception 'INVALID_TIME';end if;
 available_version:=app_private.booking_assert_schedule(occ.tutor_id,p_start_at,p_end_at,occ.id);
 job_id:=app_private.enqueue_event(event_id,'occurrence_rescheduled',occ.id,jsonb_build_object('occurrence_id',occ.id,'occurrence_version',occ.version+1,'command_id',p_command_id),'calendar.sync');
 update app_private.occurrences set start_at=p_start_at,end_at=p_end_at,availability_version=available_version,version=occ.version+1,quote_terms_version=occ.quote_terms_version+1,meeting_status='pending',calendar_job_id=job_id,confirmation_deadline_at=p_start_at-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int),updated_at=now() where id=occ.id returning * into occ;
 update app_private.tutor_reservations set start_at=p_start_at,end_at=p_end_at where occurrence_id=occ.id;return occ;
end $$;

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
        and (p_kind='offers' or (o.status='published' and o.effective_at<=now() and s.active and p.status='published'
          and p.environment_scope=case when env in ('test','development') then 'development_test' else 'production' end
          and p.is_synthetic=(env in ('test','development'))
          -- T04 filters actual scheduled occurrences before catalog pagination.
          and ((p_filters->>'from' is null and p_filters->>'to' is null) or exists(select 1 from app_private.occurrences scheduled where scheduled.offer_id=o.id and scheduled.state in ('forming','confirmed') and scheduled.start_at>now() and scheduled.start_at>=coalesce((p_filters->>'from')::timestamptz,now()) and scheduled.start_at<coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days')))))
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

do $$ declare fn record;begin
 for fn in select p.oid::regprocedure::text as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and(p.proname like 'booking_%' or p.proname='process_occurrence_booking_due')) or(n.nspname='api' and p.proname in ('set_availability','create_occurrence','reserve_enrollment','accept_quote','confirm_occurrence','change_occurrence_capacity','join_waitlist','leave_waitlist','approve_tutor_fee','get_tutor_availability','get_admin_tutor_availability','get_enrollment','get_quote','list_offer_occurrences','list_my_enrollments','list_my_waitlist','list_tutor_occurrences','list_admin_occurrences','list_tutor_fee_agreements','list_admin_fee_agreements','list_my_booking_learners','list_booking_learners')) loop
 execute format('alter function %s owner to git_tutor_commands',fn.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',fn.signature);
 if fn.nspname='api' then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 if fn.proname='process_occurrence_booking_due' then execute format('grant execute on function %s to git_tutor_worker',fn.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';


