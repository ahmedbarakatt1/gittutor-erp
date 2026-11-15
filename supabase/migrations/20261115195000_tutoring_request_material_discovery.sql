-- Discover request materials through their matched learner's enrollment.
grant create on schema api, app_private to git_tutor_commands;

create index tutoring_request_match on app_private.tutoring_requests (matched_occurrence_id, learner_id) where state = 'matched';

alter function api.list_files(uuid, uuid, text, text, integer) rename to list_session_files;
alter function api.list_session_files(uuid, uuid, text, text, integer) set schema app_private;
revoke all on function app_private.list_session_files(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role, git_tutor_worker;

create function api.list_files(p_enrollment_id uuid default null, p_occurrence_id uuid default null,
  p_purpose text default null, p_cursor text default null, p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  enrollment app_private.enrollments%rowtype;
  learner_or_admin boolean;
  cursor_at timestamptz;
  cursor_id uuid;
  rows jsonb;
begin
  if p_purpose is distinct from 'request_material' then
    return app_private.list_session_files(p_enrollment_id, p_occurrence_id, p_purpose, p_cursor, p_limit);
  end if;
  actor := app_private.require_actor();
  if p_enrollment_id is null or p_occurrence_id is not null then raise exception 'VALIDATION_ERROR'; end if;
  select * into enrollment from app_private.enrollments where id = p_enrollment_id;
  learner_or_admin := app_private.file_material_scope(actor, enrollment.learner_id) or app_private.has_role(actor, 'admin');
  if enrollment.id is null or not (
    learner_or_admin or (
      app_private.has_role(actor, 'tutor') and exists (
        select 1 from app_private.occurrences o
        join app_private.tutor_assignments a on a.occurrence_id = o.id and a.active and a.tutor_id = o.tutor_id
        join app_private.tutors t on t.id = a.tutor_id
        where o.id = enrollment.occurrence_id and o.state <> 'cancelled' and t.account_id = actor
      )
    )
  ) then raise exception 'NOT_FOUND'; end if;

  select after_at, after_id into cursor_at, cursor_id from app_private.request_cursor(p_cursor, p_limit);
  if not learner_or_admin and enrollment.state <> 'confirmed' then return app_private.package_page('[]'::jsonb, p_limit); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'at', f.created_at, 'data', app_private.file_dto(f.id, actor))
    order by f.created_at desc, f.id desc), '[]') into rows
  from (
    select i.id, i.created_at from app_private.tutoring_requests r
    join app_private.file_upload_intents i on i.parent_type = 'tutoring_request' and i.parent_id = r.id and i.purpose = 'request_material'
    where r.matched_occurrence_id = enrollment.occurrence_id and r.learner_id = enrollment.learner_id and r.state = 'matched'
      and app_private.file_current_access(i.id, actor, 'download')
      and (p_cursor is null or (i.created_at, i.id) < (cursor_at, cursor_id))
    order by i.created_at desc, i.id desc limit p_limit + 1
  ) f;
  return app_private.package_page(rows, p_limit);
end $$;

alter function api.list_files(uuid, uuid, text, text, integer) owner to git_tutor_commands;
revoke all on function api.list_files(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role, git_tutor_worker;
grant execute on function api.list_files(uuid, uuid, text, text, integer) to authenticated;
revoke create on schema api, app_private from git_tutor_commands;
notify pgrst, 'reload schema';
