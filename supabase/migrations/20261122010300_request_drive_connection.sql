-- One independently consented Drive grant. Browser roles cannot read its envelope.
create table app_private.request_drive_connection (
  singleton boolean primary key default true check (singleton),
  connection_id uuid not null default gen_random_uuid(),
  consent_version uuid not null default gen_random_uuid(),
  credential_version uuid not null default gen_random_uuid(),
  connected_by uuid references app_private.accounts(id),
  google_subject text,
  envelope jsonb,
  authorized_at timestamptz,
  check ((connected_by is null) = (google_subject is null)),
  check (envelope is null or (connected_by is not null and jsonb_typeof(envelope) = 'object'))
);
alter table app_private.request_drive_connection add constraint request_drive_envelope_valid
  check (envelope is null or app_private.calendar_envelope_valid(envelope,envelope->>'kid'));
insert into app_private.request_drive_connection(singleton) values (true);
alter table app_private.request_drive_connection enable row level security;
revoke all on app_private.request_drive_connection from public, anon, authenticated, service_role, git_tutor_worker;
grant select, update on app_private.request_drive_connection to git_tutor_commands;
create policy request_drive_commands on app_private.request_drive_connection
  to git_tutor_commands using (true) with check (true);

grant create on schema api,app_private to git_tutor_commands;

create function app_private.request_drive_owner(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select app_private.payment_verified_account(p_actor)
    and app_private.has_role(p_actor,'admin')
    and exists (select 1 from app_private.auth_account(p_actor) a where lower(a.email)='gittutor2@gmail.com')
$$;

create function app_private.request_drive_connected() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.request_drive_connection
    where envelope is not null and app_private.request_drive_owner(connected_by))
$$;

create function api.get_request_drive_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := app_private.require_actor();
  owner boolean := app_private.request_drive_owner(actor);
  c app_private.request_drive_connection%rowtype;
begin
  perform app_private.require_role(actor,'admin');
  select * into strict c from app_private.request_drive_connection where singleton;
  return jsonb_build_object('can_connect',owner,'state',
    case when app_private.request_drive_connected() then 'connected'
      when c.authorized_at is not null then 'reconnect' else 'awaiting_consent' end)
    || case when owner then jsonb_build_object('actor_id',actor,
       'session_id',current_setting('request.jwt.claims',true)::jsonb->>'session_id',
       'connection_id',c.connection_id,'consent_version',c.consent_version)
       else '{}'::jsonb end;
end $$;

create function app_private.record_request_drive_grant(
  p_actor uuid, p_session uuid, p_consent_version uuid, p_version uuid,
  p_google_email text, p_subject text, p_envelope jsonb
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform app_private.payment_server_actor(p_actor,p_session,true);
  if not app_private.request_drive_owner(p_actor) or lower(p_google_email) is distinct from 'gittutor2@gmail.com'
    then raise exception 'FORBIDDEN'; end if;
  if p_subject is null or length(p_subject) not between 1 and 255 or p_version is null
    or jsonb_typeof(p_envelope) is distinct from 'object' then raise exception 'VALIDATION_ERROR'; end if;
  update app_private.request_drive_connection set consent_version=gen_random_uuid(), credential_version=p_version,
    google_subject=p_subject, connected_by=p_actor, authorized_at=now(), envelope=p_envelope
    where singleton and consent_version=p_consent_version and (google_subject is null or google_subject=p_subject);
  if not found then raise exception 'STATE_CONFLICT'; end if;
end $$;

create function app_private.read_request_drive_grant() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('connection_id',connection_id,'credential_version',credential_version,'envelope',envelope)
  from app_private.request_drive_connection where envelope is not null and app_private.request_drive_owner(connected_by)
$$;

-- A superseded refresh or invalid_grant must never replace a newer consent.
create function app_private.update_request_drive_token(p_expected uuid,p_version uuid,p_envelope jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_version is null or (p_envelope is not null and jsonb_typeof(p_envelope)<>'object') then raise exception 'VALIDATION_ERROR'; end if;
  update app_private.request_drive_connection set credential_version=p_version, envelope=p_envelope
    where singleton and credential_version=p_expected and envelope is not null and app_private.request_drive_owner(connected_by);
  return found;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='api' and p.proname='get_request_drive_status') or
      (n.nspname='app_private' and p.proname in ('request_drive_owner','request_drive_connected',
        'record_request_drive_grant','read_request_drive_grant','update_request_drive_token'))
  loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
    if f.proname='get_request_drive_status' then
      execute format('grant execute on function %s to authenticated',f.signature);
    elsif f.proname<>'request_drive_owner' then
      execute format('grant execute on function %s to git_tutor_worker',f.signature);
    end if;
  end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
