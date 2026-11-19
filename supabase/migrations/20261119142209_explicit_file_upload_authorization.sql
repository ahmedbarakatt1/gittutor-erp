-- Explicit final upload boundaries, including draft request attachment removal and scanner retries.
-- Existing applied migrations retain their original text and checksums.
grant create on schema app_private to git_tutor_commands;

-- A handout, including an assigned quiz PDF, follows the active teaching assignment.
create or replace function app_private.file_resolve_target(p_actor uuid, p_purpose text, p_action text, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request app_private.tutoring_requests%rowtype;
begin
  if p_purpose = 'shared_handout' and not app_private.has_role(p_actor, 'admin') then
    perform 1 from app_private.occurrences o
      join app_private.tutor_assignments a on a.occurrence_id = o.id and a.tutor_id = o.tutor_id and a.active
      join app_private.tutors t on t.id = a.tutor_id
      where o.id = p_target and t.account_id = p_actor and app_private.has_role(p_actor, 'tutor') for share of o, a;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
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

-- Extend the session-file branch; request materials retain their own reviewed policies.
alter function app_private.file_current_access_pre_request(uuid, uuid, text) rename to file_current_access_pre_handout_assignment;
create function app_private.file_current_access_pre_request(p_file uuid, p_actor uuid, p_operation text default 'read')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  intent app_private.file_upload_intents%rowtype;
  publication text;
  assigned boolean;
begin
  select * into intent from app_private.file_upload_intents where id = p_file and purpose = 'shared_handout';
  if not found then return app_private.file_current_access_pre_handout_assignment(p_file, p_actor, p_operation); end if;
  if not coalesce(app_private.payment_verified_account(p_actor), false) then return false; end if;
  if p_operation = 'download' and (not app_private.file_is_clean(p_file) or not exists(
    select 1 from app_private.file_upload_states where file_id = p_file and state = 'finalized')) then return false; end if;
  if app_private.has_role(p_actor, 'admin') then return true; end if;
  select publication_state into publication from app_private.file_access_states where file_id = p_file;
  select exists(select 1 from app_private.occurrences o
    join app_private.tutor_assignments a on a.occurrence_id = o.id and a.tutor_id = o.tutor_id and a.active
    join app_private.tutors t on t.id = a.tutor_id where o.id = intent.parent_id and t.account_id = p_actor
    and app_private.has_role(p_actor, 'tutor')) into assigned;
  if assigned then return p_operation <> 'download' or p_actor = intent.actor_id or publication <> 'withdrawn'; end if;
  return coalesce(publication = 'published', false) and exists(select 1 from app_private.enrollments e
    where e.occurrence_id = intent.parent_id and e.state = 'confirmed' and app_private.file_material_scope(p_actor, e.learner_id));
end $$;
alter function app_private.file_current_access_pre_request(uuid, uuid, text) owner to git_tutor_commands;
revoke all on function app_private.file_current_access_pre_request(uuid, uuid, text)
  from public, anon, authenticated, service_role, git_tutor_worker;

create function app_private.file_assert_upload_actor(p_actor uuid, p_intent app_private.file_upload_intents)
returns void language plpgsql set search_path = '' as $$
begin
  if p_intent.id is null or p_intent.actor_id is distinct from p_actor then raise exception 'NOT_FOUND'; end if;
  perform app_private.file_resolve_target(p_actor, p_intent.purpose, p_intent.evidence_action, p_intent.parent_target_id);
  if p_intent.purpose = 'request_material' then perform app_private.request_assert_attached_file(p_intent.id); end if;
end $$;
alter function app_private.file_assert_upload_actor(uuid, app_private.file_upload_intents) owner to git_tutor_commands;
revoke all on function app_private.file_assert_upload_actor(uuid, app_private.file_upload_intents)
  from public, anon, authenticated, service_role, git_tutor_worker;

create or replace function api.create_file_upload(p_purpose text, p_parent_id uuid, p_filename text, p_declared_type text,
  p_size_bytes bigint, p_checksum_sha256 text, p_evidence_action text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  target jsonb;
  ctx jsonb;
  file_id uuid := gen_random_uuid();
begin
  target := app_private.file_resolve_target(actor, p_purpose, p_evidence_action, p_parent_id);
  if p_filename is null or length(p_filename) not between 1 and 255 or p_filename <> btrim(p_filename)
    or p_filename ~ '[[:cntrl:]/\\]' or p_filename in ('.', '..')
    or p_size_bytes is null or p_size_bytes < 1
    or p_size_bytes > (case when p_purpose in ('receipt', 'review_evidence') then 5242880 else 26214400 end)
    or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR'; end if;
  if p_declared_type is null or not (case
    when p_purpose = 'statement_evidence' then p_declared_type in ('text/csv', 'application/pdf')
    when p_purpose in ('private_preparation', 'shared_handout', 'request_material') then p_declared_type in (
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    else p_declared_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') end) then raise exception 'FILE_TYPE_INVALID'; end if;
  ctx := app_private.booking_begin(actor, 'create_file_upload', jsonb_build_object('purpose', p_purpose, 'parent_id', p_parent_id,
    'filename', p_filename, 'declared_type', p_declared_type, 'size_bytes', p_size_bytes, 'checksum_sha256', p_checksum_sha256,
    'evidence_action', p_evidence_action), p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then
    if p_purpose = 'request_material' then perform app_private.request_assert_attached_file((ctx->'replay_result'->>'file_id')::uuid); end if;
    return ctx->'replay_result';
  end if;
  insert into app_private.file_upload_intents(id, actor_id, session_id, purpose, evidence_action, parent_target_id, parent_type,
    parent_id, internal_purpose, learner_id, charge_id, filename, declared_type, size_bytes, checksum_sha256)
    values(file_id, actor, (current_setting('request.jwt.claims', true)::jsonb->>'session_id')::uuid, p_purpose, p_evidence_action,
      p_parent_id, target->>'parent_type', (target->>'parent_id')::uuid, target->>'internal_purpose', (target->>'learner_id')::uuid,
      (target->>'charge_id')::uuid, p_filename, p_declared_type, p_size_bytes, p_checksum_sha256);
  insert into app_private.file_upload_states(file_id) values(file_id);
  perform set_config('response.status', '201', true);
  return app_private.booking_finish(ctx, file_id, 1, jsonb_build_object('file_id', file_id, 'upload_path',
    '/api/v1/files/' || file_id || '/content'), 'file_upload_created', jsonb_build_object('file_id', file_id));
end $$;

create or replace function api.authorize_file_content(p_file_id uuid, p_operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.require_actor(); intent app_private.file_upload_intents%rowtype; ticket uuid;
begin
  if p_operation is null or p_operation not in ('upload', 'download') then raise exception 'VALIDATION_ERROR'; end if;
  select * into intent from app_private.file_upload_intents where id = p_file_id;
  if intent.id is null then raise exception 'NOT_FOUND'; end if;
  if p_operation = 'upload' then
    perform app_private.file_assert_upload_actor(actor, intent);
  elsif not app_private.file_current_access(intent.id, actor, 'download') then raise exception 'NOT_FOUND'; end if;
  insert into app_private.file_content_authorizations(file_id, actor_id, session_id, operation)
    values(intent.id, actor, (current_setting('request.jwt.claims', true)::jsonb->>'session_id')::uuid, p_operation)
    returning id into ticket;
  return jsonb_build_object('authorization_id', ticket);
end $$;

create or replace function app_private.file_check_authorization(p_file uuid, p_authorization uuid, p_operation text)
returns app_private.file_content_authorizations language plpgsql security definer set search_path = '' as $$
declare ticket app_private.file_content_authorizations%rowtype; intent app_private.file_upload_intents%rowtype;
begin
  select * into ticket from app_private.file_content_authorizations where id = p_authorization and file_id = p_file and operation = p_operation;
  if ticket.id is null or ticket.expires_at <= now() or not app_private.auth_session_active(ticket.actor_id, ticket.session_id)
    or not app_private.payment_verified_account(ticket.actor_id) then raise exception 'SESSION_REVOKED'; end if;
  if p_operation = 'upload' then
    select * into intent from app_private.file_upload_intents where id = p_file;
    perform app_private.file_assert_upload_actor(ticket.actor_id, intent);
  elsif not app_private.file_current_access(p_file, ticket.actor_id, 'download') then raise exception 'NOT_FOUND'; end if;
  return ticket;
end $$;

create or replace function api.finalize_file_upload(p_file_id uuid, p_checksum_sha256 text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  intent app_private.file_upload_intents%rowtype;
  upload app_private.file_upload_states%rowtype;
  ctx jsonb;
  job uuid;
begin
  select * into intent from app_private.file_upload_intents where id = p_file_id;
  perform app_private.file_assert_upload_actor(actor, intent);
  ctx := app_private.booking_begin(actor, 'finalize_file_upload', jsonb_build_object('file_id', p_file_id,
    'checksum_sha256', p_checksum_sha256), p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then return ctx->'replay_result'; end if;
  select * into upload from app_private.file_upload_states where file_id = p_file_id for update;
  if intent.checksum_sha256 is distinct from p_checksum_sha256 then raise exception 'FILE_CHECKSUM_MISMATCH'; end if;
  if upload.adopted_attempt_id is null then raise exception 'UPLOAD_REQUIRED'; end if;
  job := upload.scan_job_id;
  if exists(select 1 from app_private.file_access_states where file_id = intent.id and scan_state = 'quarantined') then
    update app_private.file_access_states set scan_generation = scan_generation + 1, scan_state = 'pending', safe_error_code = null,
      version = version + 1, updated_at = now() where file_id = intent.id;
    job := null;
  end if;
  if job is null then
    job := app_private.enqueue_event(gen_random_uuid(), 'file_scan_requested', intent.id, jsonb_build_object('file_id', intent.id), 'files.scan');
    update app_private.file_upload_states set state = 'finalized', scan_job_id = job, version = version + 1, updated_at = now()
      where file_id = intent.id returning * into upload;
    perform set_config('response.status', '202', true);
  end if;
  return app_private.booking_finish(ctx, intent.id, upload.version, jsonb_build_object('scan_state',
    (select scan_state from app_private.file_access_states where file_id = intent.id), 'scan_job_id', job),
    'file_upload_finalized', jsonb_build_object('file_id', intent.id));
end $$;

revoke create on schema app_private from git_tutor_commands;
notify pgrst, 'reload schema';
