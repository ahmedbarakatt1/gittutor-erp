-- Run only on the hosted Git Tutor production database after staging a protected
-- POST /api/cron/worker. Store the two matching secrets in Supabase Vault first.
begin;
do $check$
begin
  if (select environment from app_private.environment_metadata where singleton) is distinct from 'production' then
    raise exception 'Expected the production application database';
  end if;
end $check$;
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
do $check$
begin
  if (select count(*) from vault.decrypted_secrets where name in
    ('git_tutor_worker_wake','git_tutor_vercel_protection') and length(decrypted_secret) >= 20) <> 2 then
    raise exception 'Missing worker or deployment authentication';
  end if;
  if exists (select from unnest(array['anon','authenticated']) as r(role_name)
    where has_table_privilege(role_name,'vault.decrypted_secrets','select')) then
    raise exception 'Scheduler credentials would be readable outside the operator boundary';
  end if;
end $check$;
create or replace function app_private.wake_vercel_worker() returns void
language plpgsql security invoker set search_path='' as $worker$
declare
  job_purpose text;
  status_code integer;
  failures integer := 0;
begin
  for job_purpose in
  with due as (
    select j.purpose, min(j.available_at) as due_at
    from app_private.outbox_jobs j
    where (j.state='pending' or (j.state='leased' and j.lease_expires_at <= now()))
      and j.available_at <= now()
      and j.purpose in ('files.scan','calendar.sync','identity.staff_invitation','booking.process_due',
        'packages.process_due','payments.validate_statement','notifications.route','notifications.send','exports.render','foundation.healthcheck')
    group by j.purpose
    union all
    select 'drive.reconcile', now() where exists (select from app_private.drive_material_work(null,null,1))
  )
    select purpose from due order by due_at, purpose
  loop
    begin
      select (extensions.http((
    'POST', 'https://gittutor-erp-production.vercel.app/api/cron/worker',
    array[
      extensions.http_header('authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='git_tutor_worker_wake')),
      extensions.http_header('x-vercel-protection-bypass',(select decrypted_secret from vault.decrypted_secrets where name='git_tutor_vercel_protection')),
      extensions.http_header('x-git-tutor-purpose',job_purpose),
      extensions.http_header('prefer','respond-async')
    ], 'application/json', '{}'
      )::extensions.http_request)).status into status_code;
      if status_code is distinct from 202 then failures := failures + 1; end if;
    exception when others then
      failures := failures + 1;
    end;
  end loop;
  if failures > 0 then raise exception 'Worker wake was not acknowledged for % queues', failures; end if;
end $worker$;
revoke all on function app_private.wake_vercel_worker() from public, anon, authenticated, service_role, git_tutor_worker;
select cron.schedule('git-tutor-vercel-worker', '* * * * *', 'select app_private.wake_vercel_worker()');
commit;
