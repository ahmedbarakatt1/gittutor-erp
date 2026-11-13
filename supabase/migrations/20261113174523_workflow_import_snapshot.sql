-- Authorized historical workbook snapshots. No operational ledger or outbox writes.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='git_tutor_workflow_reader') then
    create role git_tutor_workflow_reader nologin nobypassrls;
  end if;
end $$;
grant git_tutor_workflow_reader to postgres;
grant usage on schema app_private,api to git_tutor_workflow_reader;
grant create on schema api to git_tutor_workflow_reader;

create table app_private.workflow_import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references app_private.accounts(id),
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  source_kind text not null check(source_kind in ('real','synthetic')),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and snapshot->>'version'='1' and snapshot->>'source_sha256'=source_sha256 and jsonb_typeof(snapshot->'tables')='object' and octet_length(snapshot::text)<=10485760),
  imported_at timestamptz not null default now(),
  unique(owner_account_id,source_sha256)
);
alter table app_private.workflow_import_batches enable row level security;
alter table app_private.workflow_import_batches force row level security;
revoke all on app_private.workflow_import_batches from public,anon,authenticated;
grant select on app_private.workflow_import_batches to git_tutor_workflow_reader;
create policy workflow_snapshot_reader on app_private.workflow_import_batches for select to git_tutor_workflow_reader using(true);
grant execute on function app_private.require_actor(boolean),app_private.require_role(uuid,text) to git_tutor_workflow_reader;

create function api.get_workflow_import() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor:=app_private.require_actor();
  perform app_private.require_role(actor,'admin');
  select jsonb_build_object('id',b.id,'imported_at',b.imported_at,'snapshot',b.snapshot)
    into result from app_private.workflow_import_batches b
    where b.owner_account_id=actor order by b.imported_at desc,b.id desc limit 1;
  return result;
end $$;
alter function api.get_workflow_import() owner to git_tutor_workflow_reader;
revoke all on function api.get_workflow_import() from public,anon;
grant execute on function api.get_workflow_import() to authenticated;
revoke create on schema api from git_tutor_workflow_reader;
comment on table app_private.workflow_import_batches is 'Private owner-scoped source snapshots; legacy_reported only, never settled postings, entitlement grants or attendance verification.';
notify pgrst,'reload schema';
