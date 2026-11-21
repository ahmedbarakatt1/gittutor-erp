-- A quiz assigns one existing private handout. Scores are append-only and scoped per learner.
grant create on schema api, app_private to git_tutor_commands;

create table app_private.session_quizzes (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references app_private.occurrences,
  file_id uuid not null unique references app_private.files,
  title text not null check (length(btrim(title)) between 1 and 160),
  max_score numeric(7,2) not null check (max_score > 0 and max_score <= 10000),
  actor_account_id uuid not null references app_private.accounts,
  command_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (id, max_score)
);
create index session_quizzes_by_occurrence on app_private.session_quizzes(occurrence_id, created_at desc, id desc);
create table app_private.quiz_grade_revisions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null,
  learner_id uuid not null references app_private.learners,
  version integer not null check (version > 0),
  score numeric(7,2) not null,
  max_score numeric(7,2) not null,
  actor_account_id uuid not null references app_private.accounts,
  command_id uuid not null unique,
  created_at timestamptz not null default now(),
  foreign key (quiz_id, max_score) references app_private.session_quizzes(id, max_score),
  check (score >= 0 and score <= max_score),
  unique (quiz_id, learner_id, version)
);
create trigger immutable_row before update or delete on app_private.session_quizzes
  for each row execute function app_private.reject_immutable_change();
create trigger immutable_row before update or delete on app_private.quiz_grade_revisions
  for each row execute function app_private.reject_immutable_change();
alter table app_private.session_quizzes enable row level security;
alter table app_private.quiz_grade_revisions enable row level security;
create policy commands_access on app_private.session_quizzes to git_tutor_commands using (true) with check (true);
create policy commands_access on app_private.quiz_grade_revisions to git_tutor_commands using (true) with check (true);
revoke all on app_private.session_quizzes, app_private.quiz_grade_revisions from public, anon, authenticated, service_role, git_tutor_worker;
grant select, insert on app_private.session_quizzes, app_private.quiz_grade_revisions to git_tutor_commands;

create function app_private.quiz_assert_tutor(p_actor uuid, p_occurrence_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform app_private.require_role(p_actor, 'tutor');
  perform 1 from app_private.occurrences o
    join app_private.tutor_assignments a on a.occurrence_id = o.id and a.tutor_id = o.tutor_id and a.active
    join app_private.tutors t on t.id = a.tutor_id
    where o.id = p_occurrence_id and t.account_id = p_actor and o.state <> 'cancelled' for share of o, a;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create function api.create_session_quiz(p_occurrence_id uuid, p_file_id uuid, p_title text, p_max_score numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  ctx jsonb;
  file app_private.file_upload_intents%rowtype;
  access_state app_private.file_access_states%rowtype;
  quiz_id uuid;
begin
  perform app_private.quiz_assert_tutor(actor, p_occurrence_id);
  if p_title is null or length(btrim(p_title)) not between 1 and 160 or p_max_score is null
    or not (p_max_score > 0 and p_max_score <= 10000 and p_max_score = round(p_max_score, 2))
    then raise exception 'VALIDATION_ERROR'; end if;
  ctx := app_private.booking_begin(actor, 'create_session_quiz', jsonb_build_object('occurrence_id', p_occurrence_id,
    'file_id', p_file_id, 'title', btrim(p_title), 'max_score', trim_scale(p_max_score)), p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then return ctx->'replay_result'; end if;
  select * into file from app_private.file_upload_intents where id = p_file_id and purpose = 'shared_handout'
    and parent_type = 'occurrence' and parent_id = p_occurrence_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if file.declared_type <> 'application/pdf' then raise exception 'FILE_TYPE_INVALID'; end if;
  select * into access_state from app_private.file_access_states where file_id = file.id for update;
  if not found or not app_private.file_is_clean(file.id) or not exists (
    select 1 from app_private.file_upload_states u join app_private.files f on f.id = u.file_id
    where f.id = file.id and u.state = 'finalized' and f.source_provenance = 'stored_object' and f.detected_mime = 'application/pdf'
  ) then raise exception 'SCAN_REQUIRED'; end if;
  if access_state.publication_state not in ('unpublished', 'published')
    or exists (select 1 from app_private.session_quizzes q where q.file_id = file.id)
    then raise exception 'STATE_CONFLICT'; end if;
  if access_state.publication_state = 'unpublished' then
    perform app_private.file_publication_command(file.id, 'published', null, access_state.version, ctx->>'command_id');
  end if;
  insert into app_private.session_quizzes(occurrence_id, file_id, title, max_score, actor_account_id, command_id)
    values(p_occurrence_id, file.id, btrim(p_title), p_max_score, actor, (ctx->>'command_id')::uuid) returning id into quiz_id;
  perform set_config('response.status', '201', true);
  return app_private.booking_finish(ctx, quiz_id, 1, jsonb_build_object('quiz_id', quiz_id),
    'session_quiz_assigned', jsonb_build_object('quiz_id', quiz_id, 'occurrence_id', p_occurrence_id));
end $$;

create function api.record_quiz_grade(p_quiz_id uuid, p_learner_id uuid, p_score numeric, p_expected_version integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  quiz app_private.session_quizzes%rowtype;
  ctx jsonb;
  current_version integer;
  revision_id uuid;
begin
  perform app_private.require_role(actor, 'tutor');
  select * into quiz from app_private.session_quizzes where id = p_quiz_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app_private.quiz_assert_tutor(actor, quiz.occurrence_id);
  -- Lock the confirmed enrollment even before the first grade exists.
  perform 1 from app_private.enrollments where learner_id = p_learner_id and occurrence_id = quiz.occurrence_id
    and state = 'confirmed' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_score is null or not (p_score >= 0 and p_score <= quiz.max_score and p_score = round(p_score, 2))
    or p_expected_version is null or p_expected_version < 0 then raise exception 'VALIDATION_ERROR'; end if;
  ctx := app_private.booking_begin(actor, 'record_quiz_grade', jsonb_build_object('quiz_id', quiz.id, 'learner_id', p_learner_id,
    'score', trim_scale(p_score), 'expected_version', p_expected_version), p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then return ctx->'replay_result'; end if;
  select coalesce(max(g.version), 0) into current_version from app_private.quiz_grade_revisions g
    where g.quiz_id = quiz.id and g.learner_id = p_learner_id;
  if current_version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into app_private.quiz_grade_revisions(quiz_id, learner_id, version, score, max_score, actor_account_id, command_id)
    values(quiz.id, p_learner_id, current_version + 1, p_score, quiz.max_score, actor, (ctx->>'command_id')::uuid) returning id into revision_id;
  return app_private.booking_finish(ctx, revision_id, current_version + 1,
    jsonb_build_object('quiz_id', quiz.id, 'learner_id', p_learner_id, 'score', p_score),
    'quiz_grade_recorded', jsonb_build_object('quiz_id', quiz.id, 'revision_id', revision_id));
end $$;

create function app_private.quiz_metadata(p_quiz app_private.session_quizzes, p_actor uuid) returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object('quiz_id', p_quiz.id, 'title', p_quiz.title, 'max_score', p_quiz.max_score,
    'file_id', f.id, 'filename', f.filename, 'content_path', case when app_private.file_current_access(f.id, p_actor, 'download')
      and s.publication_state = 'published' then '/api/v1/files/' || f.id::text || '/content' end)
  from app_private.file_upload_intents f join app_private.file_access_states s on s.file_id = f.id where f.id = p_quiz.file_id
$$;

create function app_private.learner_quiz(p_quiz app_private.session_quizzes, p_actor uuid, p_learner_id uuid) returns jsonb
language sql set search_path = '' as $$
  select app_private.quiz_metadata(p_quiz, p_actor) || jsonb_build_object('grade', (
    select jsonb_build_object('score', g.score, 'version', g.version) from app_private.quiz_grade_revisions g
    where g.quiz_id = p_quiz.id and g.learner_id = p_learner_id order by g.version desc limit 1))
$$;

create function api.get_session_quizzes(p_occurrence_id uuid, p_view text, p_learner_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.require_actor(); roster jsonb; quizzes jsonb;
begin
  if p_view = 'customer' and p_learner_id is not null then
    perform app_private.assert_learner_scope(actor, p_learner_id, 'materials', false);
    perform 1 from app_private.enrollments e join app_private.occurrences o on o.id = e.occurrence_id
      where e.occurrence_id = p_occurrence_id and e.learner_id = p_learner_id and e.state = 'confirmed' and o.state <> 'cancelled';
    if not found then raise exception 'NOT_FOUND'; end if;
    select coalesce(jsonb_agg(app_private.learner_quiz(q, actor, p_learner_id) order by q.created_at desc, q.id desc), '[]')
      into quizzes from app_private.session_quizzes q where q.occurrence_id = p_occurrence_id;
    return jsonb_build_object('occurrence_id', p_occurrence_id, 'view', p_view, 'quizzes', quizzes);
  end if;
  if p_view is distinct from 'tutor' or p_learner_id is not null then raise exception 'VALIDATION_ERROR'; end if;
  perform app_private.quiz_assert_tutor(actor, p_occurrence_id);
  select coalesce(jsonb_agg(jsonb_build_object('learner_id', l.id, 'display_name', p.display_name) order by p.display_name, l.id), '[]')
    into roster from app_private.enrollments e join app_private.learners l on l.id = e.learner_id
    join app_private.people p on p.id = l.person_id where e.occurrence_id = p_occurrence_id and e.state = 'confirmed';
  select coalesce(jsonb_agg(app_private.quiz_metadata(q, actor) || jsonb_build_object('grades', (
    select coalesce(jsonb_agg(jsonb_build_object('learner_id', latest.learner_id, 'score', latest.score, 'version', latest.version)
      order by latest.learner_id), '[]') from (
      select distinct on (g.learner_id) g.learner_id, g.score, g.version from app_private.quiz_grade_revisions g
      join app_private.enrollments e on e.occurrence_id = q.occurrence_id and e.learner_id = g.learner_id and e.state = 'confirmed'
      where g.quiz_id = q.id order by g.learner_id, g.version desc) latest)) order by q.created_at desc, q.id desc), '[]')
    into quizzes from app_private.session_quizzes q where q.occurrence_id = p_occurrence_id;
  return jsonb_build_object('occurrence_id', p_occurrence_id, 'view', p_view, 'quizzes', quizzes, 'roster', roster);
end $$;

create function api.list_my_quiz_results(p_learner_id uuid default null, p_cursor text default null, p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  after_at timestamptz;
  after_quiz uuid;
  after_learner uuid;
  page jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_learner_id is not null then perform app_private.assert_learner_scope(actor, p_learner_id, 'materials', false); end if;
  if p_cursor is not null then
    if length(p_cursor) > 200 or cardinality(string_to_array(p_cursor, '|')) <> 3 then raise exception 'VALIDATION_ERROR'; end if;
    begin
      after_at := split_part(p_cursor, '|', 1)::timestamptz;
      after_quiz := split_part(p_cursor, '|', 2)::uuid;
      after_learner := split_part(p_cursor, '|', 3)::uuid;
      if not isfinite(after_at) then raise exception 'VALIDATION_ERROR'; end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
    end;
  end if;
  with authorized_learners as (
    select l.id from app_private.learners l where l.account_id = actor
    union select g.learner_id from app_private.guardian_links g where g.guardian_account_id = actor and g.revoked_at is null
      and g.valid_from <= now() and g.valid_until > now() and 'materials' = any(g.scopes)
  ), slice as materialized (
    select q as quiz, q.created_at, q.id, l.id as learner_id, p.display_name as learner_name, s.title as session_title, o.start_at
      from authorized_learners allowed join app_private.learners l on l.id = allowed.id
      join app_private.people p on p.id = l.person_id
      join app_private.enrollments e on e.learner_id = l.id and e.state = 'confirmed'
      join app_private.occurrences o on o.id = e.occurrence_id and o.state <> 'cancelled'
      join app_private.offers f on f.id = o.offer_id join app_private.subjects s on s.id = f.subject_id
      join app_private.session_quizzes q on q.occurrence_id = o.id
      where (p_learner_id is null or l.id = p_learner_id)
        and (p_cursor is null or (q.created_at, q.id, l.id) < (after_at, after_quiz, after_learner))
      order by q.created_at desc, q.id desc, l.id desc limit p_limit + 1
  ), visible as (select * from slice order by created_at desc, id desc, learner_id desc limit p_limit)
  select jsonb_build_object('items', coalesce(jsonb_agg(app_private.learner_quiz(v.quiz, actor, v.learner_id) ||
    jsonb_build_object('learner_id', v.learner_id, 'learner_name', v.learner_name, 'occurrence_id', (v.quiz).occurrence_id,
      'session_title', v.session_title, 'start_at', v.start_at) order by v.created_at desc, v.id desc, v.learner_id desc), '[]'),
    'next_cursor', case when (select count(*) from slice) > p_limit then
      (select concat_ws('|', created_at::text, id::text, learner_id::text) from visible order by created_at, id, learner_id limit 1) end)
    into page from visible v;
  return page;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'api' and p.proname in ('create_session_quiz', 'record_quiz_grade', 'get_session_quizzes', 'list_my_quiz_results'))
    or (n.nspname = 'app_private' and p.proname in ('quiz_assert_tutor', 'quiz_metadata', 'learner_quiz'))
  loop
    execute format('alter function %s owner to git_tutor_commands', f.signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, git_tutor_worker', f.signature);
    if f.nspname = 'api' then execute format('grant execute on function %s to authenticated', f.signature); end if;
  end loop;
end $$;
revoke create on schema api, app_private from git_tutor_commands;
notify pgrst, 'reload schema';
