-- Only requests created while the designated Google account is connected participate.
-- An existing draft, a workbook import or a replay of request creation is never enrolled.
create table app_private.request_drive_requests (
  request_id uuid primary key references app_private.tutoring_requests(id)
);
create table app_private.request_drive_materials (
  file_id uuid primary key references app_private.file_upload_intents(id),
  request_id uuid not null references app_private.request_drive_requests(request_id),
  drive_file_id text unique check (length(drive_file_id)<=256 and drive_file_id ~ '^[A-Za-z0-9_-]+$'),
  copy_uploaded boolean not null default false check (not copy_uploaded or drive_file_id is not null),
  revision integer not null default 1,
  verified_tutor_email text,
  next_attempt_at timestamptz default now(),
  check (verified_tutor_email is null or copy_uploaded)
);
create index request_drive_request_files on app_private.request_drive_materials(request_id,file_id);
create index request_drive_due on app_private.request_drive_materials(next_attempt_at,file_id) where next_attempt_at is not null;
alter table app_private.request_drive_requests enable row level security;
alter table app_private.request_drive_materials enable row level security;
revoke all on app_private.request_drive_requests, app_private.request_drive_materials from public,anon,authenticated,service_role,git_tutor_worker;
grant select, insert on app_private.request_drive_requests to git_tutor_commands;
grant select, insert, update on app_private.request_drive_materials to git_tutor_commands;
create policy drive_commands on app_private.request_drive_requests to git_tutor_commands using (true) with check (true);
create policy drive_commands on app_private.request_drive_materials to git_tutor_commands using (true) with check (true);

grant create on schema api,app_private to git_tutor_commands;
create function app_private.drive_enroll_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if app_private.request_drive_connected() then
    insert into app_private.request_drive_requests(request_id) values(new.id);
  end if;
  return null;
end $$;
create trigger drive_enroll_request after insert on app_private.tutoring_requests
for each row execute function app_private.drive_enroll_request();

create function app_private.drive_queue_upload() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='finalized' then
    insert into app_private.request_drive_materials(file_id,request_id)
      select i.id,r.request_id from app_private.file_upload_intents i
      join app_private.request_drive_requests r on r.request_id=i.parent_id
      where i.id=new.file_id and i.purpose='request_material' and i.parent_type='tutoring_request'
      on conflict(file_id) do update set revision=request_drive_materials.revision+1,
        next_attempt_at=clock_timestamp(),verified_tutor_email=null;
  else
    update app_private.request_drive_materials set revision=revision+1,next_attempt_at=clock_timestamp(),
      verified_tutor_email=null where file_id=new.file_id;
  end if;
  return null;
end $$;
create trigger drive_queue_upload after insert or update of state on app_private.file_upload_states
for each row execute function app_private.drive_queue_upload();

create function app_private.drive_queue_file_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update app_private.request_drive_materials set revision=revision+1,next_attempt_at=clock_timestamp(),
    verified_tutor_email=null where file_id=coalesce(new.file_id,old.file_id);
  return null;
end $$;
create trigger drive_scan_change after insert or update of scan_state,integration_state or delete on app_private.file_access_states
for each row execute function app_private.drive_queue_file_change();
create trigger drive_file_removal after insert on app_private.tutoring_request_file_removals
for each row execute function app_private.drive_queue_file_change();

create function app_private.drive_queue_request_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update app_private.request_drive_materials set revision=revision+1,next_attempt_at=clock_timestamp(),
    verified_tutor_email=null where request_id=new.id;
  return null;
end $$;
create trigger drive_match_change after update of state,matched_occurrence_id,learner_id on app_private.tutoring_requests
for each row execute function app_private.drive_queue_request_change();

create function app_private.drive_queue_session_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare sessions uuid[]; learners uuid[];
begin
  if tg_table_name='occurrences' then
    sessions:=array[new.id,old.id];
  else
    sessions:=array[new.occurrence_id,old.occurrence_id];
    if tg_table_name='enrollments' then learners:=array[new.learner_id,old.learner_id]; end if;
  end if;
  update app_private.request_drive_materials m set revision=revision+1,next_attempt_at=clock_timestamp(),
    verified_tutor_email=null from app_private.tutoring_requests r where m.request_id=r.id
      and r.matched_occurrence_id=any(sessions) and (learners is null or r.learner_id=any(learners));
  return null;
end $$;
create trigger drive_enrollment_change after insert or update of state,occurrence_id,learner_id or delete on app_private.enrollments
for each row execute function app_private.drive_queue_session_change();
create trigger drive_assignment_change after insert or update of active,tutor_id,occurrence_id or delete on app_private.tutor_assignments
for each row execute function app_private.drive_queue_session_change();
create trigger drive_session_change after update of tutor_id,state on app_private.occurrences
for each row execute function app_private.drive_queue_session_change();

create function app_private.drive_queue_tutor_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare affected_accounts uuid[]; affected_tutors uuid[];
begin
  if tg_table_name='tutors' then
    affected_tutors:=array[new.id,old.id];
  else
    if tg_table_name='account_roles' then
      if old.role is distinct from 'tutor' and new.role is distinct from 'tutor' then return null; end if;
      affected_accounts:=array[old.account_id,new.account_id];
    else
      affected_accounts:=array[old.id,new.id];
    end if;
    select array_agg(t.id) into affected_tutors from app_private.tutors t where t.account_id=any(affected_accounts);
  end if;
  if affected_tutors is not null then
    update app_private.request_drive_materials m set revision=revision+1,next_attempt_at=clock_timestamp(),
      verified_tutor_email=null from app_private.tutoring_requests r join app_private.occurrences o on o.id=r.matched_occurrence_id
      where m.request_id=r.id and o.tutor_id=any(affected_tutors);
  end if;
  return null;
end $$;
create trigger drive_tutor_role after insert or update of account_id,role,revoked_at or delete on app_private.account_roles
for each row execute function app_private.drive_queue_tutor_change();
create trigger drive_tutor_identity after update of account_id on app_private.tutors
for each row execute function app_private.drive_queue_tutor_change();
create trigger drive_active_account after update of active on app_private.accounts
for each row execute function app_private.drive_queue_tutor_change();
create trigger drive_registered_address after update of email,email_confirmed_at,deleted_at,banned_until,is_anonymous on auth.users
for each row execute function app_private.drive_queue_tutor_change();

create function app_private.drive_material_work(p_request_id uuid,p_file_id uuid,p_limit integer)
returns table(file_id uuid) language sql stable security definer set search_path='' as $$
  select m.file_id from app_private.request_drive_materials m
  where m.next_attempt_at<=statement_timestamp() and (p_request_id is null or m.request_id=p_request_id)
    and (p_file_id is null or m.file_id=p_file_id)
  order by m.next_attempt_at,m.file_id limit least(100,greatest(0,coalesce(p_limit,0)))
$$;

-- Narrow the same download check to its tutor arm. An admin/guardian who also teaches only
-- receives a Drive reader permission on the particular confirmed learner's assigned session.
create function app_private.drive_material_tutor(p_file uuid) returns table(account_id uuid,email text)
language sql stable security definer set search_path='' as $$
  select t.account_id,lower(u.email)
  from app_private.request_drive_materials m join app_private.tutoring_requests r on r.id=m.request_id
  join app_private.occurrences o on o.id=r.matched_occurrence_id
  join app_private.tutor_assignments a on a.occurrence_id=o.id and a.active and a.tutor_id=o.tutor_id
  join app_private.tutors t on t.id=a.tutor_id cross join lateral app_private.auth_account(t.account_id) u
  where m.file_id=p_file and app_private.request_confirmed_match(r) and o.state<>'cancelled'
    and app_private.has_role(t.account_id,'tutor') and nullif(u.email,'') is not null
    and app_private.file_current_access(p_file,t.account_id,'download')
$$;

create function app_private.drive_material_projection(p_file_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('file_id',m.file_id,'request_id',m.request_id,'drive_file_id',m.drive_file_id,
    'copy_uploaded',m.copy_uploaded,'revision',m.revision,'want_copy',d.wanted,
    'tutor_email',case when d.wanted then (select t.email from app_private.drive_material_tutor(m.file_id) t) end,
    'object_key',case when d.wanted then f.object_key end,'object_version',f.object_version,'filename',i.filename,
    'detected_type',f.detected_mime,'size_bytes',f.byte_size,'checksum_sha256',f.checksum_sha256)
  from app_private.request_drive_materials m join app_private.file_upload_intents i on i.id=m.file_id
  left join app_private.files f on f.id=i.id and f.parent_id=m.request_id and f.parent_type='tutoring_request'
    and f.purpose='request_material' and f.source_provenance='stored_object'
  left join app_private.file_upload_states s on s.file_id=i.id
  left join app_private.file_access_states a on a.file_id=i.id
  cross join lateral (select coalesce(s.state='finalized' and f.id is not null and s.adopted_attempt_id is not null
    and a.scan_state in ('pending','clean') and not exists (
      select 1 from app_private.tutoring_request_file_removals x where x.file_id=i.id),false) as wanted) d
  where m.file_id=p_file_id and app_private.request_drive_connected()
$$;

create function app_private.drive_material_reserve_id(p_file_id uuid,p_drive_file_id text) returns text
language plpgsql security definer set search_path='' as $$
declare saved text;
begin
  if p_drive_file_id is null or length(p_drive_file_id)>256 or p_drive_file_id !~ '^[A-Za-z0-9_-]+$' then raise exception 'VALIDATION_ERROR'; end if;
  update app_private.request_drive_materials set drive_file_id=coalesce(drive_file_id,p_drive_file_id)
    where file_id=p_file_id returning drive_file_id into saved;
  return saved;
end $$;
create function app_private.drive_material_mark_uploaded(p_file_id uuid,p_drive_file_id text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update app_private.request_drive_materials set copy_uploaded=true where file_id=p_file_id and drive_file_id=p_drive_file_id;
  return found;
end $$;
create function app_private.drive_material_finish(p_file_id uuid,p_revision integer,p_success boolean,p_verified_tutor_email text)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_projection jsonb;
begin
  perform 1 from app_private.request_drive_materials where file_id=p_file_id and revision=p_revision for update;
  if not found then return false; end if;
  if p_success then
    current_projection:=app_private.drive_material_projection(p_file_id);
    if current_projection is null or (current_projection->>'tutor_email') is distinct from lower(p_verified_tutor_email)
      or ((current_projection->>'want_copy')::boolean and not (current_projection->>'copy_uploaded')::boolean)
      then return false; end if;
  end if;
  update app_private.request_drive_materials set
    verified_tutor_email=case when p_success then lower(p_verified_tutor_email) end,
    next_attempt_at=case when not coalesce(p_success,false) then clock_timestamp()+interval '2 minutes'
      when (current_projection->>'want_copy')::boolean then clock_timestamp()+interval '24 hours' end
    where file_id=p_file_id;
  return true;
end $$;

create function api.get_request_drive_link(p_file_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); remote_id text;
begin
  select m.drive_file_id into remote_id from app_private.request_drive_materials m
  join app_private.drive_material_tutor(p_file_id) t on t.account_id=actor and t.email=m.verified_tutor_email
  where m.file_id=p_file_id and m.copy_uploaded and app_private.request_drive_connected();
  if remote_id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('drive_file_id',remote_id);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='api' and p.proname='get_request_drive_link') or (n.nspname='app_private' and p.proname in (
      'drive_enroll_request','drive_queue_upload','drive_queue_file_change','drive_queue_request_change','drive_queue_session_change',
      'drive_queue_tutor_change','drive_material_work','drive_material_tutor','drive_material_projection','drive_material_reserve_id',
      'drive_material_mark_uploaded','drive_material_finish'))
  loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
    if f.proname='get_request_drive_link' then
      execute format('grant execute on function %s to authenticated',f.signature);
    elsif f.proname in ('drive_material_work','drive_material_projection','drive_material_reserve_id',
                         'drive_material_mark_uploaded','drive_material_finish') then
      execute format('grant execute on function %s to git_tutor_worker',f.signature);
    end if;
  end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
