-- Preserve the advertised session length for existing requests while admitting
-- any approved price for a compatible occurrence. Each request keeps its terms.
create table app_private.request_duration_policies (
  version text primary key,
  duration_minutes_min integer not null check (duration_minutes_min > 0),
  duration_minutes_max integer not null check (duration_minutes_max >= duration_minutes_min)
);
insert into app_private.request_duration_policies values ('2026-11-15.1', 90, 105);
alter table app_private.request_duration_policies enable row level security;
revoke all on app_private.request_duration_policies from public, anon, authenticated, service_role, git_tutor_worker;
grant select on app_private.request_duration_policies to git_tutor_commands;
create policy request_duration_read on app_private.request_duration_policies for select to git_tutor_commands using (true);
create trigger immutable_request_duration_policy before update or delete on app_private.request_duration_policies
  for each row execute function app_private.reject_immutable_change();
alter table app_private.tutoring_requests add column duration_policy_version text not null
  default '2026-11-15.1' references app_private.request_duration_policies(version);

grant create on schema app_private to git_tutor_commands;

-- Ordinary booking admission honours the target tier, provisional seats,
-- unexpired holds and the first eligible waitlisted learner.
create function app_private.booking_available_seats(o app_private.occurrences) returns integer
language sql stable set search_path = '' as $$
  select case when o.state = 'forming' and o.confirmation_deadline_at > now() and not exists (
    select 1 from app_private.waitlist_entries w where w.occurrence_id = o.id and app_private.booking_waitlist_eligible(w.id)
  ) then greatest(0, least(o.capacity - count(*), coalesce(o.target_tier, 1) - count(*) filter (where hold_kind = 'ordinary')))::integer
  else 0 end
  from app_private.enrollments where occurrence_id = o.id and (state = 'confirmed' or (state = 'held' and hold_expires_at > now()))
$$;

create or replace function app_private.booking_occurrence_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;price jsonb;amount bigint;tutor_name text;remaining integer;begin
 select * into o from app_private.occurrences where id=p_id;if o.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select customer_pricing into price from app_private.pricing_versions where id=o.pricing_version_id;
 if o.format='private' then amount:=(price->>'private_seat_price_minor')::bigint;else select (value->>'seat_price_minor')::bigint into amount from jsonb_array_elements(price->'group_tiers') where (value->>'group_size')::int=o.target_tier;end if;
 select p.display_name into tutor_name from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id where t.id=o.tutor_id;
 remaining:=app_private.booking_available_seats(o);
 return jsonb_build_object('occurrence_id',o.id,'version',o.version,'offer_id',o.offer_id,'tutor',jsonb_build_object('tutor_id',o.tutor_id,'display_name',coalesce(tutor_name,'Tutor')),'start_at',o.start_at,'end_at',o.end_at,'time_zone',o.time_zone,'state',o.state,'format',o.format,'target_tier',o.target_tier,'capacity',o.capacity,'available_seats',remaining,'waitlist_available',o.state='forming' and o.confirmation_deadline_at>now(),'customer_price_minor',amount,'currency','EGP','policy_version_id',o.policy_version_id,'pricing_version_id',o.pricing_version_id);
end $$;

create function app_private.request_staff_can_read(p_actor uuid, p_state text) returns boolean
language sql stable set search_path = '' as $$
  select (p_state <> 'draft' and app_private.has_role(p_actor, 'admin'))
    or (p_state in ('submitted', 'reviewing', 'needs_information', 'matched') and app_private.has_role(p_actor, 'customer_service'))
$$;

create function app_private.request_confirmed_match(r app_private.tutoring_requests) returns boolean
language sql stable set search_path = '' as $$
  select r.state = 'matched' and exists (
    select 1 from app_private.enrollments e where e.occurrence_id = r.matched_occurrence_id
      and e.learner_id = r.learner_id and e.state = 'confirmed'
  )
$$;

create or replace function app_private.request_match_available(p_occurrence app_private.occurrences, p_request app_private.tutoring_requests) returns boolean
language sql stable set search_path = '' as $$
  select p_occurrence.start_at > now()
    and app_private.booking_offer_sellable(p_occurrence.offer_id)
    and not exists (select 1 from app_private.calendar_booking_pilots pilot
      where pilot.occurrence_id = p_occurrence.id and pilot.learner_id <> p_request.learner_id)
    and exists (select 1 from app_private.tutors t where t.id = p_occurrence.tutor_id and app_private.has_role(t.account_id, 'tutor'))
    and (p_request.format = 'undecided' or p_request.format = case when p_occurrence.format = 'private' then 'individual' else 'group' || p_occurrence.target_tier end)
    and p_occurrence.end_at - p_occurrence.start_at = make_interval(mins => p_occurrence.duration_minutes)
    and exists (
      select 1 from app_private.policy_versions policy
      join app_private.pricing_versions price on price.id = policy.pricing_version_id
      join app_private.request_duration_policies duration on duration.version = p_request.duration_policy_version
      where policy.id = p_occurrence.policy_version_id and price.id = p_occurrence.pricing_version_id
        and policy.status = 'published' and price.status = 'published' and policy.effective_at <= now() and price.effective_at <= now()
        and policy.scope = p_occurrence.format and price.scope = p_occurrence.format
        and (policy.content->>'duration_minutes')::integer = p_occurrence.duration_minutes
        and p_occurrence.duration_minutes between duration.duration_minutes_min and duration.duration_minutes_max
    )
    and (
      (p_occurrence.state = 'forming' and p_occurrence.confirmation_deadline_at > now() and app_private.booking_available_seats(p_occurrence) > 0)
      or exists (
        select 1 from app_private.enrollments e where e.occurrence_id = p_occurrence.id and e.learner_id = p_request.learner_id
          and ((p_occurrence.state in ('forming','confirmed') and e.state = 'confirmed')
            or (p_occurrence.state = 'forming' and p_occurrence.confirmation_deadline_at > now() and e.state = 'held'
              and e.hold_kind = 'ordinary' and e.hold_expires_at > now()))
      )
    )
$$;

create or replace function app_private.request_match_dto(p_occurrence app_private.occurrences) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('occurrence_id', p_occurrence.id, 'offer_id', o.id, 'title', s.title,
    'start_at', p_occurrence.start_at, 'end_at', p_occurrence.end_at,
    'available_seats', terms->'available_seats', 'customer_price_minor', terms->'customer_price_minor')
  from app_private.offers o join app_private.subjects s on s.id = o.subject_id
  cross join app_private.booking_occurrence_dto(p_occurrence.id) terms where o.id = p_occurrence.offer_id
$$;

create or replace function api.review_tutoring_request(p_request_id uuid, p_state text, p_customer_reply text,
  p_expected_version integer, p_idempotency_key text, p_occurrence_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
  occurrence app_private.occurrences%rowtype;
  context jsonb;
begin
  perform app_private.request_assert_staff(actor);
  select * into request from app_private.tutoring_requests where id = p_request_id and state <> 'draft' for update;
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  -- A CS agent may retry their own close to recover its acknowledgment.
  if not app_private.request_staff_can_read(actor, request.state) and not exists (
    select 1 from app_private.command_results c where p_state = 'closed' and c.actor_account_id = actor
      and c.command_name = 'review_tutoring_request' and c.idempotency_key = p_idempotency_key
      and c.result->>'resource_id' = request.id::text and c.result->>'version' = request.version::text
  ) then raise exception 'NOT_FOUND'; end if;
  if p_state is null or p_state not in ('reviewing', 'needs_information', 'matched', 'closed') or length(p_customer_reply) > 2000
    or ((p_state = 'matched') <> (p_occurrence_id is not null)) then raise exception 'VALIDATION_ERROR'; end if;
  context := app_private.booking_begin(actor, 'review_tutoring_request', jsonb_build_object('request_id', p_request_id,
    'state', p_state, 'customer_reply', p_customer_reply, 'occurrence_id', p_occurrence_id, 'expected_version', p_expected_version), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;
  if request.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if request.state = 'closed' then raise exception 'STATE_CONFLICT'; end if;
  -- Seat holds, confirmation and transfer serialize on the occurrence. Lock
  -- both ends before rechecking so a concurrent confirmation cannot lose its files.
  perform 1 from app_private.occurrences where id in (request.matched_occurrence_id, p_occurrence_id) order by id for share;
  if app_private.request_confirmed_match(request) then raise exception 'STATE_CONFLICT'; end if;
  if p_state = 'matched' then
    select * into occurrence from app_private.occurrences where id = p_occurrence_id;
    if occurrence.id is null or not app_private.request_match_available(occurrence, request) then raise exception 'NOT_FOUND'; end if;
  end if;

  update app_private.tutoring_requests set state = p_state, customer_reply = nullif(btrim(p_customer_reply), ''),
    matched_occurrence_id = p_occurrence_id, version = version + 1, updated_at = now() where id = request.id returning * into request;
  return app_private.booking_finish(context, request.id, request.version, '{}'::jsonb, 'tutoring_request_reviewed', jsonb_build_object('request_id', request.id));
end $$;

create or replace function app_private.file_current_access(p_file uuid, p_actor uuid, p_operation text default 'read') returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  request app_private.tutoring_requests%rowtype;
  clean_finalized boolean;
begin
  select r.* into request from app_private.file_upload_intents i
  join app_private.tutoring_requests r on r.id = i.parent_id
  where i.id = p_file and i.parent_type = 'tutoring_request' and i.purpose = 'request_material';
  if request.id is null then return app_private.file_current_access_pre_request(p_file, p_actor, p_operation); end if;
  if exists (select 1 from app_private.tutoring_request_file_removals where file_id = p_file) then return false; end if;
  if not coalesce(app_private.payment_verified_account(p_actor), false) then return false; end if;
  clean_finalized := exists (select 1 from app_private.file_upload_states where file_id = p_file and state = 'finalized')
    and app_private.file_is_clean(p_file);
  if p_operation = 'download' and not clean_finalized then return false; end if;
  if (request.owner_account_id = p_actor or request.state <> 'draft') and app_private.request_customer_scope(p_actor, request.learner_id) then return true; end if;
  if app_private.request_staff_can_read(p_actor, request.state) then return true; end if;
  return clean_finalized and request.state = 'matched' and app_private.has_role(p_actor, 'tutor') and exists (
    select 1 from app_private.enrollments e join app_private.occurrences o on e.occurrence_id = o.id
    join app_private.tutor_assignments a on a.occurrence_id = o.id and a.active and a.tutor_id = o.tutor_id
    join app_private.tutors t on t.id = a.tutor_id
    where e.occurrence_id = request.matched_occurrence_id and e.learner_id = request.learner_id
      and e.state = 'confirmed' and o.state <> 'cancelled' and t.account_id = p_actor
  );
end $$;

create or replace function app_private.request_dto(p_request app_private.tutoring_requests, p_actor uuid) returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object('request_id', p_request.id, 'learner', jsonb_build_object('learner_id', l.id, 'display_name', p.display_name),
    'topic', p_request.topic, 'course', p_request.course, 'description', p_request.description, 'preferred_times', p_request.preferred_times,
    'format', p_request.format, 'state', p_request.state, 'version', p_request.version, 'customer_reply', p_request.customer_reply,
    'matched_session', (select app_private.request_match_dto(o) || jsonb_build_object('enrollment_id', (
      select e.id from app_private.enrollments e where app_private.request_customer_scope(p_actor, p_request.learner_id)
        and e.occurrence_id = o.id and e.learner_id = p_request.learner_id
        and (e.state = 'confirmed' or (e.state = 'held' and e.hold_kind = 'ordinary' and e.hold_expires_at > now()))
    )) from app_private.occurrences o where o.id = p_request.matched_occurrence_id),
    'created_at', p_request.created_at, 'updated_at', p_request.updated_at,
    'can_edit', p_request.state in ('draft', 'needs_information') and p_request.owner_account_id = p_actor,
    'can_review', p_request.state not in ('draft', 'closed') and app_private.request_staff_can_read(p_actor, p_request.state)
      and not app_private.request_confirmed_match(p_request),
    'files', coalesce((select jsonb_agg(app_private.file_dto(i.id, p_actor) order by i.created_at, i.id)
      from app_private.file_upload_intents i where i.parent_type = 'tutoring_request' and i.parent_id = p_request.id and i.purpose = 'request_material'
      and app_private.file_current_access(i.id, p_actor)), '[]'::jsonb))
  from app_private.learners l join app_private.people p on p.id = l.person_id where l.id = p_request.learner_id
$$;

create or replace function api.get_tutoring_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
begin
  select * into request from app_private.tutoring_requests r where r.id = p_request_id and (
    ((r.owner_account_id = actor or r.state <> 'draft') and app_private.request_customer_scope(actor, r.learner_id))
    or app_private.request_staff_can_read(actor, r.state)
  );
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  return app_private.request_dto(request, actor);
end $$;

create or replace function app_private.request_page(p_queue boolean, p_cursor text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  cursor_at timestamptz;
  cursor_id uuid;
  rows jsonb;
begin
  if p_queue and not app_private.request_staff_scope(actor) then raise exception 'FORBIDDEN'; end if;
  select after_at, after_id into cursor_at, cursor_id from app_private.request_cursor(p_cursor, p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'at', r.created_at, 'data', app_private.request_dto(r, actor)) order by r.created_at desc, r.id desc), '[]')
  into rows from (
    select x.* from app_private.tutoring_requests x where (
      (p_queue and app_private.request_staff_can_read(actor, x.state)) or (not p_queue and (x.owner_account_id = actor or x.state <> 'draft') and app_private.request_customer_scope(actor, x.learner_id))
    ) and (p_cursor is null or (x.created_at, x.id) < (cursor_at, cursor_id))
    order by x.created_at desc, x.id desc limit p_limit + 1
  ) r;
  return app_private.package_page(rows, p_limit);
end $$;

create or replace function api.list_tutoring_request_matches(p_request_id uuid, p_cursor text default null, p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
  cursor_at timestamptz;
  cursor_id uuid;
  rows jsonb;
begin
  if not app_private.request_staff_scope(actor) then raise exception 'FORBIDDEN'; end if;
  select * into request from app_private.tutoring_requests where id = p_request_id and state not in ('draft', 'closed');
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  if app_private.request_confirmed_match(request) then raise exception 'STATE_CONFLICT'; end if;
  select after_at, after_id into cursor_at, cursor_id from app_private.request_cursor(p_cursor, p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'at', o.start_at, 'data', app_private.request_match_dto(o)) order by o.start_at, o.id), '[]')
  into rows from (
    select x.* from app_private.occurrences x where x.start_at > now() and x.state in ('forming', 'confirmed')
    and app_private.request_match_available(x, request)
    and (p_cursor is null or (x.start_at, x.id) > (cursor_at, cursor_id))
    order by x.start_at, x.id limit p_limit + 1
  ) o;
  return app_private.package_page(rows, p_limit);
end $$;

alter function app_private.booking_available_seats(app_private.occurrences) owner to git_tutor_commands;
alter function app_private.request_staff_can_read(uuid, text) owner to git_tutor_commands;
alter function app_private.request_confirmed_match(app_private.tutoring_requests) owner to git_tutor_commands;
revoke all on function app_private.booking_available_seats(app_private.occurrences), app_private.request_staff_can_read(uuid, text),
  app_private.request_confirmed_match(app_private.tutoring_requests) from public, anon, authenticated, service_role, git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
notify pgrst, 'reload schema';
