-- NULL is evidence from the legacy protocol, which cannot distinguish a claim from a send.
-- Tracked claims explicitly record false before returning to the process.
alter table app_private.job_attempts add column dispatch_started boolean;

create function app_private.claim_worker_job(p_purpose text,p_excluded_purpose text)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,
              lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid,requires_reconciliation boolean)
language plpgsql security definer set search_path='' as $$
declare claimed record;
begin
  select * into claimed from app_private.claim_jobs(p_purpose,1,60,p_excluded_purpose);
  if not found then return; end if;
  update app_private.job_attempts set dispatch_started=false where job_attempts.id=claimed.lease_token;
  -- Count all prior attempts. A second crash during reconciliation cannot erase ambiguity
  -- from an earlier attempt. Missing history is treated conservatively as well.
  return query select claimed.id,claimed.event_id,claimed.purpose,claimed.event_type,
    claimed.aggregate_id,claimed.payload,claimed.lease_token,claimed.lease_expires_at,
    claimed.attempt_count,claimed.correlation_id,claimed.attempt_count-1 > count(*)
    from app_private.job_attempts a where a.job_id=claimed.id and a.attempt_number<claimed.attempt_count
      and (a.dispatch_started=false or a.outcome='failed');
end $$;

create function app_private.start_job_dispatch(p_id uuid,p_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare expires_at timestamptz;
begin
  -- Serialize the checkpoint against reclamation. Never hold this lock over the network.
  select j.lease_expires_at into expires_at from app_private.outbox_jobs j
    where j.id=p_id and j.state='leased' and j.lease_token=p_token for update;
  if not found or expires_at<=clock_timestamp() then raise exception 'LEASE_LOST' using errcode='40001'; end if;
  update app_private.job_attempts set dispatch_started=true
    where job_id=p_id and id=p_token and dispatch_started is distinct from true;
  if not found then raise exception 'LEASE_LOST' using errcode='40001'; end if;
end $$;

create function app_private.fail_job_execution(p_id uuid,p_token uuid)
returns text language plpgsql security definer set search_path='' as $$
declare job app_private.outbox_jobs%rowtype; uncertain boolean; result_state text;
begin
  select * into job from app_private.outbox_jobs j
    where j.id=p_id and j.state='leased' and j.lease_token=p_token for update;
  if not found or job.lease_expires_at<=clock_timestamp() then raise exception 'LEASE_LOST' using errcode='40001'; end if;
  -- Include this lease. An error may follow a committed checkpoint whose acknowledgement
  -- was lost. The worker's memory cannot distinguish that from a pre-dispatch failure.
  select job.attempt_count > count(*) into uncertain from app_private.job_attempts a
    where a.job_id=p_id and (a.dispatch_started=false or a.outcome='failed');
  perform app_private.fail_job(p_id,p_token,
    case when uncertain then 'HANDLER_OUTCOME_UNKNOWN' else 'DISPATCH_PREPARATION_FAILED' end,uncertain);
  select state into strict result_state from app_private.outbox_jobs where id=p_id;
  return result_state;
end $$;

do $$
declare needs_create boolean := not has_schema_privilege('git_tutor_worker_api','app_private','CREATE');
begin
  if needs_create then grant create on schema app_private to git_tutor_worker_api; end if;
  alter function app_private.claim_worker_job(text,text) owner to git_tutor_worker_api;
  alter function app_private.start_job_dispatch(uuid,uuid) owner to git_tutor_worker_api;
  alter function app_private.fail_job_execution(uuid,uuid) owner to git_tutor_worker_api;
  if needs_create then revoke create on schema app_private from git_tutor_worker_api; end if;
end $$;
revoke all on function app_private.claim_worker_job(text,text), app_private.start_job_dispatch(uuid,uuid), app_private.fail_job_execution(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.claim_worker_job(text,text), app_private.start_job_dispatch(uuid,uuid), app_private.fail_job_execution(uuid,uuid) to git_tutor_worker;

create or replace function app_private.claim_jobs(p_purpose text,p_limit integer,p_lease_seconds integer,p_excluded_purpose text)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 1 and 300 then raise exception 'VALIDATION_ERROR'; end if;
  -- A final expired dispatch has an unknown outcome. An expired tracked attempt
  -- that never started can safely yield its execution slot to the next lease.
  update app_private.outbox_jobs j set
    state=case when j.state='leased' then 'reconciliation' else 'failed' end,
    last_error_code=case when j.state='leased' then 'PROVIDER_OUTCOME_UNKNOWN' else 'MAX_ATTEMPTS_EXCEEDED' end,
    lease_expires_at=null,updated_at=now()
    where j.purpose is distinct from p_excluded_purpose and j.attempt_count>=j.max_attempts
      and (j.state='pending' or (j.state='leased' and j.lease_expires_at<=now()
        and not exists(select 1 from app_private.job_attempts a where a.id=j.lease_token and a.dispatch_started=false)));
  return query
  with candidates as (
    select j.id from app_private.outbox_jobs j
    where j.purpose is distinct from p_excluded_purpose and (p_purpose is null or j.purpose=p_purpose)
      and j.available_at<=now() and (j.attempt_count<j.max_attempts or (j.state='leased' and exists(select 1 from app_private.job_attempts a where a.id=j.lease_token and a.dispatch_started=false)))
      and (j.state='pending' or (j.state='leased' and j.lease_expires_at<=now()))
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

-- Repeated pre-dispatch crashes can push the lease count past the integer backoff range.
create or replace function app_private.fail_job(p_id uuid,p_token uuid,p_code text,p_uncertain boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_code !~ '^[A-Z0-9_]{1,80}$' then raise exception 'SAFE_ERROR_CODE_REQUIRED'; end if;
  update app_private.outbox_jobs set
    state=case when p_uncertain then 'reconciliation' when attempt_count>=max_attempts then 'failed' else 'pending' end,
    lease_expires_at=null,last_error_code=p_code,
    available_at=now()+make_interval(secs=>least(3600,power(2,least(12,attempt_count))::integer)+floor(random()*5)::integer),updated_at=now()
    where id=p_id and state='leased' and lease_token=p_token and lease_expires_at>now();
  if not found then raise exception 'LEASE_LOST' using errcode='40001'; end if;
  update app_private.job_attempts set ended_at=now(),outcome=case when p_uncertain then 'unknown' else 'failed' end,error_code=p_code where id=p_token;
end $$;

