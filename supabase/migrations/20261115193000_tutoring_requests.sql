-- A tutoring request can precede the catalog, quote and enrollment lifecycle.
grant create on schema api, app_private to git_tutor_commands;

create table app_private.tutoring_requests (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references app_private.accounts(id),
  learner_id uuid not null references app_private.learners(id),
  topic text not null check (topic ~ '[^[:space:]]' and length(topic) <= 160),
  course text not null default '' check (length(course) <= 160),
  description text not null check (description ~ '[^[:space:]]' and length(description) <= 4000),
  preferred_times text not null check (preferred_times ~ '[^[:space:]]' and length(preferred_times) <= 1000),
  format text not null check (format in ('individual', 'group2', 'group3', 'group4', 'undecided')),
  state text not null default 'draft' check (state in ('draft', 'submitted', 'reviewing', 'needs_information', 'matched', 'closed')),
  customer_reply text check (length(customer_reply) <= 2000),
  matched_occurrence_id uuid references app_private.occurrences(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'matched') = (matched_occurrence_id is not null))
);
alter table app_private.tutoring_requests enable row level security;
revoke all on app_private.tutoring_requests from public, anon, authenticated, service_role, git_tutor_worker;
grant select, insert, update on app_private.tutoring_requests to git_tutor_commands;
create policy commands_access on app_private.tutoring_requests to git_tutor_commands using (true) with check (true);
create index tutoring_request_learner on app_private.tutoring_requests (learner_id, created_at desc, id desc);
create index tutoring_request_queue on app_private.tutoring_requests (created_at desc, id desc) where state <> 'draft';

create table app_private.tutoring_request_file_removals (
  file_id uuid primary key references app_private.file_upload_intents(id),
  removed_at timestamptz not null default now()
);
alter table app_private.tutoring_request_file_removals enable row level security;
revoke all on app_private.tutoring_request_file_removals from public, anon, authenticated, service_role, git_tutor_worker;
grant select, insert on app_private.tutoring_request_file_removals to git_tutor_commands;
create policy commands_access on app_private.tutoring_request_file_removals to git_tutor_commands using (true) with check (true);
create trigger immutable_request_file_removal before update or delete on app_private.tutoring_request_file_removals
for each row execute function app_private.reject_immutable_change();

create function app_private.request_customer_scope(p_actor uuid, p_learner uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from app_private.learners where id = p_learner and account_id = p_actor)
    or exists (
      select 1 from app_private.guardian_links
      where learner_id = p_learner and guardian_account_id = p_actor and revoked_at is null
        and valid_from <= now() and valid_until > now() and scopes @> array['booking', 'materials']
    )
$$;

create function app_private.request_assert_customer(p_actor uuid, p_learner uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform app_private.assert_learner_scope(p_actor, p_learner, 'booking', false);
  perform app_private.assert_learner_scope(p_actor, p_learner, 'materials', false);
end $$;

create function app_private.request_staff_scope(p_actor uuid) returns boolean
language sql stable set search_path = '' as $$
  select app_private.has_role(p_actor, 'admin') or app_private.has_role(p_actor, 'customer_service')
$$;

create function app_private.request_assert_staff(p_actor uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if app_private.has_role(p_actor, 'admin') then
    perform app_private.require_role(p_actor, 'admin');
  else
    perform app_private.require_role(p_actor, 'customer_service');
  end if;
end $$;

create function app_private.request_validate_details(p_topic text, p_course text, p_description text, p_preferred_times text, p_format text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_topic is null or p_topic !~ '[^[:space:]]' or length(p_topic) > 160
    or length(p_course) > 160 or p_description is null or p_description !~ '[^[:space:]]' or length(p_description) > 4000
    or p_preferred_times is null or p_preferred_times !~ '[^[:space:]]' or length(p_preferred_times) > 1000
    or p_format is null or p_format not in ('individual', 'group2', 'group3', 'group4', 'undecided') then
    raise exception 'VALIDATION_ERROR';
  end if;
end $$;

create function app_private.request_match_available(p_occurrence app_private.occurrences, p_request app_private.tutoring_requests) returns boolean
language sql stable set search_path = '' as $$
  select p_occurrence.start_at > now()
    and app_private.booking_offer_sellable(p_occurrence.offer_id)
    and exists (select 1 from app_private.tutors t where t.id = p_occurrence.tutor_id and app_private.has_role(t.account_id, 'tutor'))
    and (
      (p_occurrence.state = 'forming' and p_occurrence.confirmation_deadline_at > now())
      or (p_occurrence.state = 'confirmed' and exists (
        select 1 from app_private.enrollments
        where occurrence_id = p_occurrence.id and learner_id = p_request.learner_id and state = 'confirmed'
      ))
    )
    and p_occurrence.duration_minutes between 90 and 105
    and p_occurrence.end_at - p_occurrence.start_at = make_interval(mins => p_occurrence.duration_minutes)
    and (p_request.format = 'undecided' or p_request.format = case when p_occurrence.format = 'private' then 'individual' else 'group' || p_occurrence.target_tier end)
    -- Match the customer price used by booking_new_hold, using the public tariff version 2026-11-15.1.
    and exists (
      select 1 from app_private.policy_versions policy join app_private.pricing_versions price on price.id = policy.pricing_version_id
      where policy.id = p_occurrence.policy_version_id and price.customer_pricing->>'currency' = 'EGP' and (
        (p_occurrence.format = 'private' and price.customer_pricing->>'private_seat_price_minor' = '65000')
        or (p_occurrence.format = 'group' and exists (
          select 1 from jsonb_array_elements(price.customer_pricing->'group_tiers') tier
          where tier->>'group_size' = p_occurrence.target_tier::text and tier->>'seat_price_minor' = case p_occurrence.target_tier
            when 2 then '57500' when 3 then '55000' when 4 then '50000' end
        ))
      )
    )
$$;

create function app_private.request_match_dto(p_occurrence app_private.occurrences) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('occurrence_id', p_occurrence.id, 'offer_id', o.id, 'title', s.title,
    'start_at', p_occurrence.start_at, 'end_at', p_occurrence.end_at)
  from app_private.offers o join app_private.subjects s on s.id = o.subject_id where o.id = p_occurrence.offer_id
$$;

create function app_private.request_cursor(p_cursor text, p_limit integer, out after_at timestamptz, out after_id uuid)
language plpgsql stable set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is null then return; end if;
  if length(p_cursor) > 200 or cardinality(string_to_array(p_cursor, '|')) <> 2 then raise exception 'VALIDATION_ERROR'; end if;
  after_at := split_part(p_cursor, '|', 1)::timestamptz;
  after_id := split_part(p_cursor, '|', 2)::uuid;
  if not isfinite(after_at) then raise exception 'VALIDATION_ERROR'; end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'VALIDATION_ERROR';
end $$;

create function api.create_tutoring_request(p_learner_id uuid, p_topic text, p_description text, p_preferred_times text,
  p_format text, p_idempotency_key text, p_course text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  context jsonb;
  request_id uuid;
begin
  perform app_private.request_assert_customer(actor, p_learner_id);
  perform app_private.request_validate_details(p_topic, p_course, p_description, p_preferred_times, p_format);
  context := app_private.booking_begin(actor, 'create_tutoring_request', jsonb_build_object('learner_id', p_learner_id,
    'topic', p_topic, 'course', p_course, 'description', p_description, 'preferred_times', p_preferred_times, 'format', p_format), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;

  insert into app_private.tutoring_requests (owner_account_id, learner_id, topic, course, description, preferred_times, format)
  values (actor, p_learner_id, btrim(p_topic), coalesce(btrim(p_course), ''), btrim(p_description), btrim(p_preferred_times), p_format)
  returning id into request_id;
  perform set_config('response.status', '201', true);
  return app_private.booking_finish(context, request_id, 1, '{}'::jsonb, 'tutoring_request_created', jsonb_build_object('request_id', request_id));
end $$;

create function api.update_tutoring_request(p_request_id uuid, p_topic text, p_description text, p_preferred_times text,
  p_format text, p_expected_version integer, p_idempotency_key text, p_course text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
  context jsonb;
begin
  select * into request from app_private.tutoring_requests where id = p_request_id and owner_account_id = actor for update;
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  perform app_private.request_assert_customer(actor, request.learner_id);
  perform app_private.request_validate_details(p_topic, p_course, p_description, p_preferred_times, p_format);
  context := app_private.booking_begin(actor, 'update_tutoring_request', jsonb_build_object('request_id', p_request_id,
    'topic', p_topic, 'course', p_course, 'description', p_description, 'preferred_times', p_preferred_times,
    'format', p_format, 'expected_version', p_expected_version), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;
  if request.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if request.state not in ('draft', 'needs_information') then raise exception 'STATE_CONFLICT'; end if;

  update app_private.tutoring_requests set topic = btrim(p_topic), course = coalesce(btrim(p_course), ''),
    description = btrim(p_description), preferred_times = btrim(p_preferred_times), format = p_format,
    version = version + 1, updated_at = now() where id = request.id returning * into request;
  return app_private.booking_finish(context, request.id, request.version, '{}'::jsonb, 'tutoring_request_updated', jsonb_build_object('request_id', request.id));
end $$;

create function api.submit_tutoring_request(p_request_id uuid, p_expected_version integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
  context jsonb;
begin
  select * into request from app_private.tutoring_requests where id = p_request_id and owner_account_id = actor for update;
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  perform app_private.request_assert_customer(actor, request.learner_id);
  context := app_private.booking_begin(actor, 'submit_tutoring_request', jsonb_build_object('request_id', p_request_id,
    'expected_version', p_expected_version), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;
  if request.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if request.state not in ('draft', 'needs_information') then raise exception 'STATE_CONFLICT'; end if;
  if not exists (
    select 1 from app_private.file_upload_intents i
    where i.parent_type = 'tutoring_request' and i.parent_id = request.id and i.purpose = 'request_material'
      and not exists (select 1 from app_private.tutoring_request_file_removals f where f.file_id = i.id)
  ) then raise exception 'EVIDENCE_REQUIRED'; end if;
  if exists (
    select 1 from app_private.file_upload_intents i join app_private.file_upload_states u on u.file_id = i.id
    where i.parent_type = 'tutoring_request' and i.parent_id = request.id and i.purpose = 'request_material'
      and not exists (select 1 from app_private.tutoring_request_file_removals f where f.file_id = i.id)
      and (u.state <> 'finalized' or not app_private.file_is_clean(i.id))
  ) then raise exception 'SCAN_REQUIRED'; end if;

  update app_private.tutoring_requests set state = 'submitted', version = version + 1, updated_at = now()
    where id = request.id returning * into request;
  return app_private.booking_finish(context, request.id, request.version, '{}'::jsonb, 'tutoring_request_submitted', jsonb_build_object('request_id', request.id));
end $$;

create function api.remove_tutoring_request_file(p_request_id uuid, p_file_id uuid, p_expected_version integer, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
  context jsonb;
begin
  select * into request from app_private.tutoring_requests where id = p_request_id and owner_account_id = actor for update;
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  perform app_private.request_assert_customer(actor, request.learner_id);
  context := app_private.booking_begin(actor, 'remove_tutoring_request_file', jsonb_build_object('request_id', p_request_id,
    'file_id', p_file_id, 'expected_version', p_expected_version), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;
  if request.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if request.state not in ('draft', 'needs_information') then raise exception 'STATE_CONFLICT'; end if;
  if not exists (select 1 from app_private.file_upload_intents where id = p_file_id and parent_type = 'tutoring_request'
    and parent_id = request.id and purpose = 'request_material') then raise exception 'NOT_FOUND'; end if;
  perform app_private.request_assert_attached_file(p_file_id);

  insert into app_private.tutoring_request_file_removals (file_id) values (p_file_id);
  update app_private.tutoring_requests set version = version + 1, updated_at = now() where id = request.id returning * into request;
  return app_private.booking_finish(context, request.id, request.version, '{}'::jsonb,
    'tutoring_request_file_removed', jsonb_build_object('request_id', request.id, 'file_id', p_file_id));
end $$;

create function api.review_tutoring_request(p_request_id uuid, p_state text, p_customer_reply text,
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
  if p_state is null or p_state not in ('reviewing', 'needs_information', 'matched', 'closed') or length(p_customer_reply) > 2000
    or ((p_state = 'matched') <> (p_occurrence_id is not null)) then raise exception 'VALIDATION_ERROR'; end if;
  context := app_private.booking_begin(actor, 'review_tutoring_request', jsonb_build_object('request_id', p_request_id,
    'state', p_state, 'customer_reply', p_customer_reply, 'occurrence_id', p_occurrence_id, 'expected_version', p_expected_version), p_idempotency_key);
  if context->'replay_result' <> 'null'::jsonb then return context->'replay_result'; end if;
  if request.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if request.state = 'closed' then raise exception 'STATE_CONFLICT'; end if;
  if p_state = 'matched' then
    select * into occurrence from app_private.occurrences where id = p_occurrence_id for share;
    if occurrence.id is null or not app_private.request_match_available(occurrence, request) then raise exception 'NOT_FOUND'; end if;
  end if;

  update app_private.tutoring_requests set state = p_state, customer_reply = nullif(btrim(p_customer_reply), ''),
    matched_occurrence_id = p_occurrence_id, version = version + 1, updated_at = now() where id = request.id returning * into request;
  return app_private.booking_finish(context, request.id, request.version, '{}'::jsonb, 'tutoring_request_reviewed', jsonb_build_object('request_id', request.id));
end $$;

-- The request row lock serializes submission with uploads, object adoption and finalization.
create function app_private.request_assert_attached_file(p_file uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from app_private.tutoring_request_file_removals where file_id = p_file) then raise exception 'NOT_FOUND'; end if;
end $$;

alter function app_private.file_resolve_target(uuid, text, text, uuid) rename to file_resolve_target_pre_request;
create function app_private.file_resolve_target(p_actor uuid, p_purpose text, p_action text, p_target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request app_private.tutoring_requests%rowtype;
begin
  if p_purpose is distinct from 'request_material' then
    return app_private.file_resolve_target_pre_request(p_actor, p_purpose, p_action, p_target);
  end if;
  if p_action is not null then raise exception 'VALIDATION_ERROR'; end if;
  select * into request from app_private.tutoring_requests where id = p_target and owner_account_id = p_actor for share;
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  perform app_private.request_assert_customer(p_actor, request.learner_id);
  if request.state not in ('draft', 'needs_information') then raise exception 'STATE_CONFLICT'; end if;
  return jsonb_build_object('internal_purpose', 'request_material', 'parent_type', 'tutoring_request',
    'parent_id', request.id, 'learner_id', request.learner_id, 'charge_id', null);
end $$;

alter function app_private.file_current_access(uuid, uuid, text) rename to file_current_access_pre_request;
create function app_private.file_current_access(p_file uuid, p_actor uuid, p_operation text default 'read') returns boolean
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
  if request.state <> 'draft' and app_private.request_staff_scope(p_actor) then return true; end if;
  return clean_finalized and request.state = 'matched' and app_private.has_role(p_actor, 'tutor') and exists (
    select 1 from app_private.enrollments e join app_private.occurrences o on e.occurrence_id = o.id
    join app_private.tutor_assignments a on a.occurrence_id = o.id and a.active and a.tutor_id = o.tutor_id
    join app_private.tutors t on t.id = a.tutor_id
    where e.occurrence_id = request.matched_occurrence_id and e.learner_id = request.learner_id
      and e.state = 'confirmed' and o.state <> 'cancelled' and t.account_id = p_actor
  );
end $$;

-- Retain the shared file pipeline and add the request checks at its existing upload boundaries.
do $$
declare edit record; prior text; extended text;
begin
  for edit in select * from (values
    ('api.create_file_upload(text,uuid,text,text,bigint,text,text,text)',
      'p_purpose in(''private_preparation'',''shared_handout'')', 'p_purpose in(''private_preparation'',''shared_handout'',''request_material'')'),
    ('api.create_file_upload(text,uuid,text,text,bigint,text,text,text)',
      'then return ctx->''replay_result'';', 'then if p_purpose = ''request_material'' then perform app_private.request_assert_attached_file((ctx->''replay_result''->>''file_id'')::uuid); end if; return ctx->''replay_result'';'),
    ('api.authorize_file_content(uuid,text)',
      'perform app_private.file_resolve_target(actor,i.purpose,i.evidence_action,i.parent_target_id);',
      'perform app_private.file_resolve_target(actor,i.purpose,i.evidence_action,i.parent_target_id); if i.purpose = ''request_material'' then perform app_private.request_assert_attached_file(i.id); end if;'),
    ('api.finalize_file_upload(uuid,text,text)',
      'perform app_private.file_resolve_target(actor,i.purpose,i.evidence_action,i.parent_target_id);',
      'perform app_private.file_resolve_target(actor,i.purpose,i.evidence_action,i.parent_target_id); if i.purpose = ''request_material'' then perform app_private.request_assert_attached_file(i.id); end if;'),
    ('app_private.file_check_authorization(uuid,uuid,text)',
      'perform app_private.file_resolve_target(ticket.actor_id,i.purpose,i.evidence_action,i.parent_target_id);',
      'perform app_private.file_resolve_target(ticket.actor_id,i.purpose,i.evidence_action,i.parent_target_id); if i.purpose = ''request_material'' then perform app_private.request_assert_attached_file(i.id); end if;')
  ) edits(signature, old_code, new_code)
  loop
    prior := pg_get_functiondef(edit.signature::regprocedure);
    extended := replace(prior, edit.old_code, edit.new_code);
    if extended = prior then raise exception 'FILE_UPLOAD_BOUNDARY_NOT_FOUND: %', edit.signature; end if;
    execute extended;
  end loop;
end $$;

create function app_private.request_dto(p_request app_private.tutoring_requests, p_actor uuid) returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object('request_id', p_request.id, 'learner', jsonb_build_object('learner_id', l.id, 'display_name', p.display_name),
    'topic', p_request.topic, 'course', p_request.course, 'description', p_request.description, 'preferred_times', p_request.preferred_times,
    'format', p_request.format, 'state', p_request.state, 'version', p_request.version, 'customer_reply', p_request.customer_reply,
    'matched_session', (select app_private.request_match_dto(o) from app_private.occurrences o where o.id = p_request.matched_occurrence_id),
    'created_at', p_request.created_at, 'updated_at', p_request.updated_at,
    'can_edit', p_request.state in ('draft', 'needs_information') and p_request.owner_account_id = p_actor,
    'can_review', p_request.state not in ('draft', 'closed') and app_private.request_staff_scope(p_actor),
    'files', coalesce((select jsonb_agg(app_private.file_dto(i.id, p_actor) order by i.created_at, i.id)
      from app_private.file_upload_intents i where i.parent_type = 'tutoring_request' and i.parent_id = p_request.id and i.purpose = 'request_material'
      and app_private.file_current_access(i.id, p_actor)), '[]'::jsonb))
  from app_private.learners l join app_private.people p on p.id = l.person_id where l.id = p_request.learner_id
$$;

create function api.get_tutoring_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  request app_private.tutoring_requests%rowtype;
begin
  select * into request from app_private.tutoring_requests r where r.id = p_request_id and (
    ((r.owner_account_id = actor or r.state <> 'draft') and app_private.request_customer_scope(actor, r.learner_id))
    or (r.state <> 'draft' and app_private.request_staff_scope(actor))
  );
  if request.id is null then raise exception 'NOT_FOUND'; end if;
  return app_private.request_dto(request, actor);
end $$;

create function app_private.request_page(p_queue boolean, p_cursor text, p_limit integer) returns jsonb
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
      (p_queue and x.state <> 'draft') or (not p_queue and (x.owner_account_id = actor or x.state <> 'draft') and app_private.request_customer_scope(actor, x.learner_id))
    ) and (p_cursor is null or (x.created_at, x.id) < (cursor_at, cursor_id))
    order by x.created_at desc, x.id desc limit p_limit + 1
  ) r;
  return app_private.package_page(rows, p_limit);
end $$;

create function api.list_tutoring_requests(p_cursor text default null, p_limit integer default 25) returns jsonb
language sql security definer set search_path = '' as $$ select app_private.request_page(false, p_cursor, p_limit) $$;

create function api.list_tutoring_request_queue(p_cursor text default null, p_limit integer default 25) returns jsonb
language sql security definer set search_path = '' as $$ select app_private.request_page(true, p_cursor, p_limit) $$;

create function api.list_tutoring_request_matches(p_request_id uuid, p_cursor text default null, p_limit integer default 25) returns jsonb
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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure::text signature, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'app_private' and (p.proname like 'request\_%' escape '\' or p.proname in ('file_resolve_target', 'file_current_access')))
      or (n.nspname = 'api' and p.proname in ('create_tutoring_request', 'update_tutoring_request', 'submit_tutoring_request', 'review_tutoring_request', 'remove_tutoring_request_file',
        'get_tutoring_request', 'list_tutoring_requests', 'list_tutoring_request_queue', 'list_tutoring_request_matches'))
  loop
    execute format('alter function %s owner to git_tutor_commands', f.signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, git_tutor_worker', f.signature);
    if f.nspname = 'api' then execute format('grant execute on function %s to authenticated', f.signature); end if;
  end loop;
end $$;
revoke create on schema api, app_private from git_tutor_commands;
notify pgrst, 'reload schema';
