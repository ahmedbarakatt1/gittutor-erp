-- Disabled channels keep their queued jobs, retry counters and reconciliation history.
create function app_private.claim_jobs(p_purpose text,p_limit integer,p_lease_seconds integer,p_excluded_purpose text)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 1 and 300 then raise exception 'VALIDATION_ERROR'; end if;
  update app_private.outbox_jobs j set state='failed',lease_expires_at=null,last_error_code='MAX_ATTEMPTS_EXCEEDED',updated_at=now()
    where j.purpose is distinct from p_excluded_purpose and j.state in ('pending','leased')
      and j.attempt_count>=j.max_attempts and (j.lease_expires_at is null or j.lease_expires_at<=now());
  return query
  with candidates as (
    select j.id from app_private.outbox_jobs j
    where j.purpose is distinct from p_excluded_purpose and (p_purpose is null or j.purpose=p_purpose)
      and j.available_at<=now() and j.attempt_count<j.max_attempts
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
-- PostgreSQL checks the new owner's schema CREATE permission during transfer.
do $$
declare needs_create boolean := not has_schema_privilege('git_tutor_worker_api','app_private','CREATE');
begin
  if needs_create then grant create on schema app_private to git_tutor_worker_api; end if;
  alter function app_private.claim_jobs(text,integer,integer,text) owner to git_tutor_worker_api;
  if needs_create then revoke create on schema app_private from git_tutor_worker_api; end if;
end $$;
revoke all on function app_private.claim_jobs(text,integer,integer,text) from public,anon,authenticated;
grant execute on function app_private.claim_jobs(text,integer,integer,text) to git_tutor_worker;

-- Existing callers retain the original signature and unrestricted queue selection.
create or replace function app_private.claim_jobs(p_purpose text default null,p_limit integer default 10,p_lease_seconds integer default 60)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid)
language sql security definer set search_path='' as $$
  select * from app_private.claim_jobs(p_purpose,p_limit,p_lease_seconds,null::text);
$$;
