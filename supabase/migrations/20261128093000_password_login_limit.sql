-- Reserve a slot before the password provider is contacted, including concurrent requests.
create table app_private.password_login_windows (
  bucket text primary key,
  started_at timestamptz not null,
  attempts integer not null check (attempts between 0 and 11)
);
create index password_login_window_age on app_private.password_login_windows(started_at);
alter table app_private.password_login_windows enable row level security;
revoke all on app_private.password_login_windows from public,anon,authenticated,service_role,git_tutor_worker;
grant select,insert,update,delete on app_private.password_login_windows to git_tutor_commands;
create policy password_login_window_access on app_private.password_login_windows
  for all to git_tutor_commands using (true) with check (true);

create function app_private.password_login_slot(p_bucket text,p_success_window timestamptz)
returns table(window_start timestamptz,retry_seconds integer)
language plpgsql security definer set search_path='' as $$
declare
  stamp timestamptz := date_trunc('second',clock_timestamp());
  current_window app_private.password_login_windows%rowtype;
begin
  if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR'; end if;
  if p_success_window is not null then
    update app_private.password_login_windows set attempts=greatest(attempts-1,0)
      where bucket=p_bucket and started_at=p_success_window;
    return;
  end if;
  insert into app_private.password_login_windows as w values(p_bucket,stamp,1)
    on conflict(bucket) do update set
      attempts=case when w.started_at <= stamp-interval '1 minute' then 1 else least(11,w.attempts+1) end,
      started_at=case when w.started_at <= stamp-interval '1 minute' then stamp else w.started_at end
    returning * into current_window;
  delete from app_private.password_login_windows where bucket in (
    select old.bucket from app_private.password_login_windows old
    where old.started_at < stamp-interval '2 minutes' order by old.started_at limit 32 for update skip locked
  );
  return query select current_window.started_at, case when current_window.attempts>10 then
    greatest(1,ceil(extract(epoch from current_window.started_at+interval '1 minute'-stamp))::integer) else 0 end;
end $$;
grant create on schema app_private to git_tutor_commands;
alter function app_private.password_login_slot(text,timestamptz) owner to git_tutor_commands;
revoke create on schema app_private from git_tutor_commands;
revoke all on function app_private.password_login_slot(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.password_login_slot(text,timestamptz) to git_tutor_worker;
