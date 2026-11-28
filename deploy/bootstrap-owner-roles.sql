-- Operator-only bootstrap for a new, empty hosted Git Tutor database.
-- Mirrors the owner-role preparation in tools/supabase-local.ts.
-- Do not change checksums of historical migrations to supply these prerequisites.
begin;
do $$
begin
  if exists (select 1 from auth.users)
     or exists (
       select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('api','app_private','finance_private')
         and c.relkind in ('r','p','v','m','S')
     ) then
    raise exception 'EMPTY_HOSTED_TARGET_REQUIRED';
  end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_commands') then
    create role git_tutor_commands nologin nobypassrls;
  end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_worker_api') then
    create role git_tutor_worker_api nologin nobypassrls;
  end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_identity_sync') then
    create role git_tutor_identity_sync nologin nobypassrls;
  end if;
end $$;
grant git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync to postgres;
create schema if not exists api;
create schema if not exists app_private;
grant usage,create on schema api,app_private
  to git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync;
commit;

-- After the complete migration chain, revoke the temporary CREATE grants:
-- revoke create on schema api,app_private
--   from git_tutor_commands,git_tutor_worker_api,git_tutor_identity_sync;
