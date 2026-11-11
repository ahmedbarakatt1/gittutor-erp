-- T01: all business storage is private; narrow functions receive explicit grants.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_commands') then create role git_tutor_commands nologin nobypassrls; end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_worker_api') then create role git_tutor_worker_api nologin nobypassrls; end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_worker') then create role git_tutor_worker nologin nobypassrls; end if;
end $$;
create schema if not exists api;
create schema if not exists app_private;
create schema if not exists finance_private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
revoke all on schema app_private,finance_private from public,anon,authenticated;
revoke all on schema api from public;
grant usage on schema api to anon,authenticated;
grant usage on schema app_private to git_tutor_commands,git_tutor_worker_api,git_tutor_worker;
grant usage on schema extensions to git_tutor_commands,git_tutor_worker_api;
alter default privileges revoke execute on functions from public;
alter default privileges in schema app_private,finance_private,api revoke all on tables from public,anon,authenticated;
alter default privileges in schema app_private,finance_private,api revoke all on sequences from public,anon,authenticated;
alter default privileges for role git_tutor_commands revoke execute on functions from public;
alter default privileges for role git_tutor_worker_api revoke execute on functions from public;

create table app_private.environment_metadata (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('development','test','staging','production')),
  fixture_marker text,
  created_at timestamptz not null default now()
);
create table app_private.synthetic_fixture_registry (
  id uuid primary key,
  label text not null unique,
  kind text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);
create table app_private.command_results (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid not null,
  command_name text not null,
  idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_account_id,command_name,idempotency_key)
);
create table app_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid,
  command_id uuid,
  action text not null,
  aggregate_id uuid not null,
  details jsonb not null default '{}',
  effective_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);
create table app_private.domain_events (
  id uuid primary key,
  event_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);
create table app_private.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app_private.domain_events(id),
  purpose text not null,
  state text not null default 'pending' check(state in ('pending','leased','completed','failed','reconciliation')),
  attempt_count integer not null default 0 check(attempt_count>=0),
  max_attempts integer not null default 8 check(max_attempts between 1 and 100),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  provider_request_id uuid not null default gen_random_uuid(),
  provider_reference text,
  owner_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,purpose),
  check((state='leased') = (lease_expires_at is not null))
);
create index outbox_jobs_due on app_private.outbox_jobs(available_at,id) where state in ('pending','leased');
create table app_private.job_attempts (
  id uuid primary key,
  job_id uuid not null references app_private.outbox_jobs(id),
  attempt_number integer not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  error_code text,
  unique(job_id,attempt_number)
);

alter table app_private.environment_metadata enable row level security;
alter table app_private.synthetic_fixture_registry enable row level security;
alter table app_private.command_results enable row level security;
alter table app_private.audit_events enable row level security;
alter table app_private.domain_events enable row level security;
alter table app_private.outbox_jobs enable row level security;
alter table app_private.job_attempts enable row level security;
grant select,insert on app_private.domain_events,app_private.command_results,app_private.audit_events to git_tutor_commands;
grant select,insert on app_private.outbox_jobs to git_tutor_commands;
grant select on app_private.domain_events to git_tutor_worker_api;
grant select,update on app_private.outbox_jobs to git_tutor_worker_api;
grant select,insert,update on app_private.job_attempts to git_tutor_worker_api;
create policy commands_events on app_private.domain_events to git_tutor_commands using(true) with check(true);
create policy commands_outbox on app_private.outbox_jobs to git_tutor_commands using(true) with check(true);
create policy commands_results on app_private.command_results to git_tutor_commands using(true) with check(true);
create policy commands_audit on app_private.audit_events to git_tutor_commands using(true) with check(true);
create policy worker_events on app_private.domain_events for select to git_tutor_worker_api using(true);
create policy worker_outbox on app_private.outbox_jobs to git_tutor_worker_api using(true) with check(true);
create policy worker_attempts on app_private.job_attempts to git_tutor_worker_api using(true) with check(true);

create function app_private.reject_immutable_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_RECORD' using errcode='55000'; end $$;
create trigger immutable_events before update or delete on app_private.domain_events for each row execute function app_private.reject_immutable_change();
create trigger immutable_audit before update or delete on app_private.audit_events for each row execute function app_private.reject_immutable_change();
create trigger immutable_command_results before update or delete on app_private.command_results for each row execute function app_private.reject_immutable_change();

create function app_private.enqueue_event(p_event_id uuid,p_type text,p_aggregate_id uuid,p_payload jsonb,p_purpose text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event app_private.domain_events%rowtype; v_job uuid;
begin
  if length(p_type) not between 1 and 100 or length(p_purpose) not between 1 and 200 or jsonb_typeof(p_payload)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
  insert into app_private.domain_events(id,event_type,aggregate_id,payload,correlation_id)
  values(p_event_id,p_type,p_aggregate_id,p_payload,p_event_id) on conflict(id) do nothing;
  select * into strict v_event from app_private.domain_events where id=p_event_id;
  if v_event.event_type<>p_type or v_event.aggregate_id<>p_aggregate_id or v_event.payload<>p_payload then raise exception 'EVENT_IDENTITY_CONFLICT' using errcode='23505'; end if;
  insert into app_private.outbox_jobs(event_id,purpose) values(p_event_id,p_purpose) on conflict(event_id,purpose) do nothing;
  select id into strict v_job from app_private.outbox_jobs where event_id=p_event_id and purpose=p_purpose;
  return v_job;
end $$;
alter function app_private.enqueue_event(uuid,text,uuid,jsonb,text) owner to git_tutor_commands;
revoke all on function app_private.enqueue_event(uuid,text,uuid,jsonb,text) from public,anon,authenticated;

create function app_private.claim_jobs(p_purpose text default null,p_limit integer default 10,p_lease_seconds integer default 60)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 1 and 300 then raise exception 'VALIDATION_ERROR'; end if;
  update app_private.outbox_jobs j set state='failed',lease_expires_at=null,last_error_code='MAX_ATTEMPTS_EXCEEDED',updated_at=now()
    where j.state in ('pending','leased') and j.attempt_count>=j.max_attempts and (j.lease_expires_at is null or j.lease_expires_at<=now());
  return query
  with candidates as (
    select j.id from app_private.outbox_jobs j
    where (p_purpose is null or j.purpose=p_purpose) and j.available_at<=now()
      and j.attempt_count<j.max_attempts and (j.state='pending' or (j.state='leased' and j.lease_expires_at<=now()))
    order by j.available_at,j.id for update skip locked limit p_limit
  ), claimed as (
    update app_private.outbox_jobs j set state='leased',attempt_count=j.attempt_count+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
    from candidates c where j.id=c.id returning j.*
  ), attempts as (
    insert into app_private.job_attempts(id,job_id,attempt_number) select c.lease_token,c.id,c.attempt_count from claimed c returning job_id
  )
  select c.id,c.event_id,c.purpose,e.event_type,e.aggregate_id,e.payload,c.lease_token,c.lease_expires_at,c.attempt_count,e.correlation_id
  from claimed c join app_private.domain_events e on e.id=c.event_id join attempts a on a.job_id=c.id;
end $$;
alter function app_private.claim_jobs(text,integer,integer) owner to git_tutor_worker_api;
revoke all on function app_private.claim_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function app_private.claim_jobs(text,integer,integer) to git_tutor_worker;

create function app_private.complete_job(p_id uuid,p_token uuid,p_reference text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update app_private.outbox_jobs set state='completed',lease_expires_at=null,provider_reference=p_reference,updated_at=now()
    where id=p_id and state='leased' and lease_token=p_token and lease_expires_at>now();
  if not found then
    if exists(select 1 from app_private.outbox_jobs where id=p_id and state='completed' and lease_token=p_token and provider_reference is not distinct from p_reference) then return; end if;
    raise exception 'LEASE_LOST' using errcode='40001';
  end if;
  update app_private.job_attempts set ended_at=now(),outcome='completed' where id=p_token;
end $$;
alter function app_private.complete_job(uuid,uuid,text) owner to git_tutor_worker_api;
revoke all on function app_private.complete_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function app_private.complete_job(uuid,uuid,text) to git_tutor_worker;

create function app_private.fail_job(p_id uuid,p_token uuid,p_code text,p_uncertain boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_code !~ '^[A-Z0-9_]{1,80}$' then raise exception 'SAFE_ERROR_CODE_REQUIRED'; end if;
  update app_private.outbox_jobs set
    state=case when p_uncertain then 'reconciliation' when attempt_count>=max_attempts then 'failed' else 'pending' end,
    lease_expires_at=null,last_error_code=p_code,
    available_at=now()+make_interval(secs=>least(3600,power(2,attempt_count)::integer)+floor(random()*5)::integer),updated_at=now()
    where id=p_id and state='leased' and lease_token=p_token and lease_expires_at>now();
  if not found then raise exception 'LEASE_LOST' using errcode='40001'; end if;
  update app_private.job_attempts set ended_at=now(),outcome=case when p_uncertain then 'unknown' else 'failed' end,error_code=p_code where id=p_token;
end $$;
alter function app_private.fail_job(uuid,uuid,text,boolean) owner to git_tutor_worker_api;
revoke all on function app_private.fail_job(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function app_private.fail_job(uuid,uuid,text,boolean) to git_tutor_worker;
