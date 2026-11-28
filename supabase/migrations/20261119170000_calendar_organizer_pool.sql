-- Keep each occurrence on its original calendar, including while a provider
-- mutation has an unknown outcome. Older rooms and OAuth requests retain IDs.
drop index app_private.one_connected_calendar;
drop index app_private.one_preview_organizer;
alter table app_private.calendar_connection_requests
  drop constraint calendar_connection_requests_connection_id_key,
  add column expected_connection_version integer check (expected_connection_version > 0);
alter table app_private.provider_connections add column google_subject text;
create unique index calendar_google_subject on app_private.provider_connections(google_subject)
  where google_subject is not null;
alter table app_private.calendar_events add column reserved_slots tstzmultirange not null default '{}';
update app_private.calendar_events m
  set reserved_slots = tstzmultirange(tstzrange(o.start_at,o.end_at,'[)'))
  from app_private.occurrences o where o.id=m.occurrence_id
    and o.state <> 'completed' and not (o.state='cancelled' and m.meeting_status='revoked');
create index calendar_reserved_organizer_slots on app_private.calendar_events using gist(connection_id,reserved_slots);

-- A durable row lock also detects stale snapshots at REPEATABLE READ. Neither
-- the allocation nor the wait registration is visible before its job commits.
create table app_private.calendar_allocator (
  singleton boolean primary key check (singleton), revision bigint not null
);
insert into app_private.calendar_allocator values(true,0);
create table app_private.calendar_capacity_waits (
  occurrence_id uuid primary key references app_private.occurrences(id),
  occurrence_version integer not null
);
create table app_private.calendar_dispatches (
  job_id uuid primary key references app_private.outbox_jobs(id),
  lease_token uuid not null, occurrence_id uuid not null references app_private.occurrences(id),
  occurrence_version integer not null, connection_id uuid not null references app_private.provider_connections(id),
  connection_version integer not null, meeting_generation integer not null
);
do $$
declare relation text;
begin
  foreach relation in array array['calendar_allocator','calendar_capacity_waits','calendar_dispatches'] loop
    execute format('alter table app_private.%I enable row level security', relation);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,git_tutor_worker', relation);
    execute format('grant select,update on app_private.%I to git_tutor_commands', relation);
    execute format('create policy calendar_commands on app_private.%I to git_tutor_commands using(true) with check(true)', relation);
  end loop;
end $$;
grant insert,delete on app_private.calendar_capacity_waits to git_tutor_commands;
grant insert on app_private.calendar_dispatches to git_tutor_commands;
grant create on schema api,app_private to git_tutor_commands;

create function app_private.calendar_lock_allocator() returns void language sql
  volatile security definer set search_path='' as $$
  update app_private.calendar_allocator set revision=revision+1 where singleton
$$;

-- A new connection can help unassigned sessions; a reconnected organizer
-- can also refresh its own rooms. A released interval wakes overlapping waiters.
create function app_private.calendar_wake_sessions(
  organizer uuid, released tstzmultirange default null
) returns void language plpgsql security definer set search_path='' as $$
declare target record;
begin
  for target in
    select o.id,o.version
    from app_private.occurrences o
    left join app_private.calendar_events m on m.occurrence_id=o.id
    left join app_private.calendar_capacity_waits w on w.occurrence_id=o.id
    where o.state in ('confirmed','in_progress','cancelled') and o.end_at>now()
      and (m.occurrence_id is not null or o.state<>'cancelled')
      and (m.occurrence_id is not null or not exists (
        select 1 from app_private.calendar_booking_pilots p where p.occurrence_id=o.id))
      and (m.connection_id=organizer or m.occurrence_id is null)
      and (released is null or (w.occurrence_version=o.version and
        released && tstzrange(o.start_at,o.end_at,'[)')))
      and not exists (select 1 from app_private.domain_events e join app_private.outbox_jobs j on j.event_id=e.id
        where e.aggregate_id=o.id and j.purpose='calendar.sync' and j.state='pending')
  loop
    perform app_private.enqueue_event(gen_random_uuid(),'calendar_connection_changed',target.id,
      jsonb_build_object('occurrence_id',target.id,'occurrence_version',target.version),'calendar.sync');
  end loop;
end $$;

create function app_private.calendar_summary(c app_private.provider_connections)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('connection_id',c.id,'version',coalesce(c.version,0),
    'mode',coalesce(c.mode,'fake'),'state',coalesce(c.state,'not_connected'),
    'integration_state',case when c.mode='fake' then 'simulated' when c.verified_at is not null then 'verified' else 'verification_required' end,
    'organizer_masked_email',case when c.organizer_email is not null then
      case when length(split_part(c.organizer_email,'@',1))>=5 then left(c.organizer_email,2)||'***'||right(split_part(c.organizer_email,'@',1),1)
        when length(split_part(c.organizer_email,'@',1))>=2 then left(c.organizer_email,1)||'***' else '***' end
      ||'@'||split_part(c.organizer_email,'@',2) end,
    'last_verified_at',c.verified_at,'safe_error_code',null)
$$;
create function api.list_calendar_connections() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app_private.require_role(app_private.require_actor(),'admin');
  return (select coalesce(jsonb_agg(app_private.calendar_summary(c) order by
    (state='preview_connected') desc,(state='connected') desc,created_at,id),'[]'::jsonb)
    from app_private.provider_connections c);
end $$;
create or replace function api.get_calendar_connection() returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.provider_connections%rowtype;
begin
  perform app_private.require_role(app_private.require_actor(),'admin');
  select * into c from app_private.provider_connections order by (state='preview_connected') desc,(state='connected') desc,created_at desc,id desc limit 1;
  return app_private.calendar_summary(c);
end $$;

create function app_private.calendar_fake_command(command_name text, target uuid, expected integer, command_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); ctx jsonb; c app_private.provider_connections%rowtype;
  cid uuid:=gen_random_uuid(); addr text; request_body jsonb:='{}';
begin
  perform app_private.require_role(actor,'admin');
  if app_private.catalog_environment() not in ('development','test') then raise exception 'FORBIDDEN'; end if;
  if command_name='reconnect_fake_calendar_organizer' then
    request_body:=jsonb_build_object('connection_id',target,'expected_version',expected);
  end if;
  ctx:=app_private.booking_begin(actor,command_name,request_body,command_key);
  if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result'; end if;
  perform app_private.calendar_lock_allocator();
  if command_name='reconnect_fake_calendar_organizer' then
    select * into c from app_private.provider_connections where id=target and mode='fake' for update;
    if c.id is null then raise exception 'NOT_FOUND'; end if;
    if c.version is distinct from expected then raise exception 'VERSION_CONFLICT'; end if;
    if exists (select 1 from app_private.provider_connections other where other.mode='fake' and other.state='connected'
      and other.id<>c.id and other.calendar_id=c.calendar_id) then raise exception 'STATE_CONFLICT'; end if;
    update app_private.provider_connections set state='connected',approved_by=actor,
      version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif command_name='connect_fake_calendar' then
    select * into c from app_private.provider_connections where mode='fake' and state='connected'
      order by (calendar_id='synthetic@example.test') desc,created_at,id limit 1;
    if c.id is null then
      select * into c from app_private.provider_connections where mode='fake' and calendar_id='synthetic@example.test'
        order by updated_at desc,id limit 1 for update;
      if c.id is not null then
        update app_private.provider_connections set state='connected',approved_by=actor,
          version=version+1,updated_at=now() where id=c.id returning * into c;
      end if;
    end if;
  elsif command_name<>'add_fake_calendar_organizer' then raise exception 'VALIDATION_ERROR';
  end if;
  if c.id is null then
    addr:=case when command_name='connect_fake_calendar' and not exists (
      select 1 from app_private.provider_connections where mode='fake' and state='connected' and calendar_id='synthetic@example.test')
      then 'synthetic@example.test' else 'room-'||cid||'@example.test' end;
    insert into app_private.provider_connections(id,provider,mode,state,organizer_email,calendar_id,approved_by)
      values(cid,'google','fake','connected',case when addr='synthetic@example.test' then 'organizer@example.test' else addr end,addr,actor)
      returning * into c;
  end if;
  perform app_private.calendar_wake_sessions(c.id);
  perform set_config('response.status','201',true);
  return app_private.booking_finish(ctx,c.id,c.version,jsonb_build_object('connection_id',c.id,'integration_state','simulated'),
    'calendar_connected',jsonb_build_object('connection_id',c.id));
end $$;
create or replace function api.connect_fake_calendar(p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
  select app_private.calendar_fake_command('connect_fake_calendar',null,null,p_idempotency_key)
$$;
create function api.add_fake_calendar_organizer(p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
  select app_private.calendar_fake_command('add_fake_calendar_organizer',null,null,p_idempotency_key)
$$;
create function api.reconnect_fake_calendar_organizer(p_connection_id uuid,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$
  select app_private.calendar_fake_command('reconnect_fake_calendar_organizer',p_connection_id,p_expected_version,p_idempotency_key)
$$;

create function api.create_calendar_reconnection_request(p_connection_id uuid,p_expected_version integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); ctx jsonb; c app_private.provider_connections%rowtype;
  r app_private.calendar_connection_requests%rowtype;
begin
  perform app_private.require_role(actor,'admin');
  ctx:=app_private.booking_begin(actor,'create_calendar_reconnection_request',
    jsonb_build_object('connection_id',p_connection_id,'expected_version',p_expected_version),p_idempotency_key);
  if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result'; end if;
  select * into c from app_private.provider_connections where id=p_connection_id and mode='google' for update;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if c.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into app_private.calendar_connection_requests(connection_id,expected_connection_version,actor_account_id,session_id,command_id)
    values(c.id,c.version,actor,(current_setting('request.jwt.claims',true)::jsonb->>'session_id')::uuid,(ctx->>'command_id')::uuid)
    returning * into r;
  perform set_config('response.status','201',true);
  return app_private.booking_finish(ctx,r.id,1,jsonb_build_object('request_id',r.id,'connection_id',c.id,'expires_at',r.expires_at),
    'calendar_connection_requested',jsonb_build_object('request_id',r.id));
end $$;

create function app_private.calendar_save_grant(p_request_id uuid,p_connection_id uuid,p_credential_version uuid,
  p_organizer_email text,p_calendar_id text,p_encrypted_credentials jsonb,p_credential_key_id text,p_subject text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r app_private.calendar_connection_requests%rowtype; c app_private.provider_connections%rowtype;
  email text:=lower(btrim(p_organizer_email)); next_state text; effective_calendar text;
begin
  select * into r from app_private.calendar_connection_requests where id=p_request_id for update;
  if r.id is null or r.connection_id is distinct from p_connection_id or r.expires_at<=clock_timestamp()
    or not app_private.auth_session_active(r.actor_account_id,r.session_id) or not app_private.payment_verified_account(r.actor_account_id)
    then raise exception 'AUTH_REQUIRED'; end if;
  perform app_private.require_role(r.actor_account_id,'admin');
  if p_credential_version is null or email is null or length(email) not between 3 and 254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_calendar_id is null or length(btrim(p_calendar_id)) not between 1 and 500
    or not app_private.calendar_envelope_valid(p_encrypted_credentials,p_credential_key_id)
    then raise exception 'VALIDATION_ERROR'; end if;
  perform app_private.calendar_lock_allocator();
  select * into c from app_private.provider_connections where id=r.connection_id for update;
  if r.consumed_at is not null then
    if c.credential_version is distinct from p_credential_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('connection_id',c.id,'version',c.version,'integration_state','verification_required');
  end if;
  next_state:=case when app_private.catalog_environment() in ('development','test') then 'preview_connected' else 'connected' end;
  if r.expected_connection_version is not null then
    if c.version is distinct from r.expected_connection_version then raise exception 'VERSION_CONFLICT'; end if;
    if c.mode<>'google' or (c.google_subject is not null and c.google_subject is distinct from p_subject)
      or (c.google_subject is null and lower(c.organizer_email)<>email) then raise exception 'STATE_CONFLICT'; end if;
  elsif c.id is not null then raise exception 'STATE_CONFLICT';
  end if;
  effective_calendar:=coalesce(c.calendar_id,btrim(p_calendar_id));
  if exists (select 1 from app_private.provider_connections other where other.id<>r.connection_id and other.mode='google'
    and (other.google_subject=p_subject or (
      (r.expected_connection_version is null or other.state in ('connected','preview_connected')) and (
        lower(other.organizer_email)=email or
        lower(case when other.calendar_id='primary' then other.organizer_email else other.calendar_id end)=
        lower(case when effective_calendar='primary' then email else effective_calendar end)))))
    then raise exception 'STATE_CONFLICT'; end if;
  if c.id is null then
    insert into app_private.provider_connections(id,provider,mode,state,organizer_email,calendar_id,approved_by,credential_version,google_subject)
      values(r.connection_id,'google','google',next_state,email,effective_calendar,r.actor_account_id,p_credential_version,p_subject)
      returning * into c;
  else
    update app_private.provider_connections set state=next_state,google_subject=p_subject,organizer_email=email,approved_by=r.actor_account_id,
      credential_version=p_credential_version,version=version+1,verified_at=null,updated_at=now() where id=c.id returning * into c;
  end if;
  insert into app_private.provider_credential_versions(id,connection_id,encrypted_credentials,credential_key_id)
    values(p_credential_version,c.id,p_encrypted_credentials,p_credential_key_id);
  update app_private.calendar_connection_requests set consumed_at=now() where id=r.id;
  if next_state='connected' then perform app_private.calendar_wake_sessions(c.id); end if;
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details)
    values(r.actor_account_id,r.command_id,'calendar_connection_authorized',c.id,jsonb_build_object('credential_version',p_credential_version));
  return jsonb_build_object('connection_id',c.id,'version',c.version,'integration_state','verification_required');
end $$;
create or replace function app_private.record_calendar_connection(p_request_id uuid,p_connection_id uuid,p_credential_version uuid,
  p_organizer_email text,p_calendar_id text,p_encrypted_credentials jsonb,p_credential_key_id text)
returns jsonb language sql security definer set search_path='' as $$
  select app_private.calendar_save_grant(p_request_id,p_connection_id,p_credential_version,p_organizer_email,
    p_calendar_id,p_encrypted_credentials,p_credential_key_id,null)
$$;
create function app_private.record_calendar_organizer(p_request_id uuid,p_connection_id uuid,p_credential_version uuid,
  p_organizer_email text,p_calendar_id text,p_encrypted_credentials jsonb,p_credential_key_id text,p_subject text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_subject is null or length(p_subject) not between 1 and 255 or p_subject !~ '^[!-~]+$' then raise exception 'VALIDATION_ERROR'; end if;
  return app_private.calendar_save_grant(p_request_id,p_connection_id,p_credential_version,p_organizer_email,
    p_calendar_id,p_encrypted_credentials,p_credential_key_id,p_subject);
end $$;
-- Even an old connected Google record in a copied development database
-- cannot authorize ordinary lessons. Preserve the pilot's complete predicate.
alter function app_private.calendar_connection_in_scope(app_private.provider_connections,uuid)
  rename to calendar_existing_scope;
create function app_private.calendar_connection_in_scope(c app_private.provider_connections,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.calendar_existing_scope(c,target) and (
    (c.state='preview_connected' and c.mode='google')
    or (c.state='connected' and c.mode=case when app_private.catalog_environment() in ('test','development') then 'fake' else 'google' end)
  )
$$;

create or replace function app_private.calendar_assert_job(p_occurrence_id uuid,p_job_id uuid,p_lease_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id
    where j.id=p_job_id and j.purpose='calendar.sync' and j.state='leased' and j.lease_token=p_lease_token
      and j.lease_expires_at>clock_timestamp() and e.aggregate_id=p_occurrence_id and e.payload->>'occurrence_id'=p_occurrence_id::text)
    then raise exception 'LEASE_LOST'; end if;
end $$;

create or replace function app_private.prepare_calendar_sync(p_occurrence_id uuid,p_job_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.occurrences%rowtype; c app_private.provider_connections%rowtype;
  m app_private.calendar_events%rowtype; tutor_email text; slot tstzrange; has_authority boolean;
begin
  perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);
  o:=app_private.booking_lock_occurrence(p_occurrence_id);
  if o.state not in ('confirmed','in_progress','cancelled') then
    return jsonb_build_object('state','suppressed','reason','OCCURRENCE_NOT_ACTIVE');
  end if;
  select u.email into tutor_email from app_private.tutors t cross join lateral app_private.auth_account(t.account_id) u
    where t.id=o.tutor_id and app_private.has_role(t.account_id,'tutor') and app_private.payment_verified_account(t.account_id);
  if tutor_email is null and o.state<>'cancelled' then
    return jsonb_build_object('state','suppressed','reason','TUTOR_AUTHORITY_REQUIRED');
  end if;
  -- Cancellation only deletes this occurrence's recorded event. It sends no
  -- invitation even when the old tutor no longer has an active account.
  tutor_email:=coalesce((select p.tutor_google_email from app_private.calendar_booking_pilots p where p.occurrence_id=o.id),
    tutor_email,'cancelled@example.test');
  perform app_private.calendar_lock_allocator();
  perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);
  select * into m from app_private.calendar_events where occurrence_id=o.id for update;
  if o.state='cancelled' and m.occurrence_id is null then
    return jsonb_build_object('state','suppressed','reason','CALENDAR_EVENT_ABSENT');
  end if;
  slot:=tstzrange(o.start_at,o.end_at,'[)');
  -- Keep an existing room pinned, including across consent changes. A reschedule
  -- waits for that organizer rather than leaking/orphaning a second provider event.
  select pc.* into c from app_private.provider_connections pc
  where (m.occurrence_id is null or pc.id=m.connection_id)
    and pc.state in ('connected','preview_connected') and app_private.calendar_connection_in_scope(pc,o.id)
    and app_private.has_role(pc.approved_by,'admin') and app_private.payment_verified_account(pc.approved_by)
    and (o.state='cancelled' or (m.reserved_slots @> slot and m.connection_id=pc.id) or not exists (
      select 1 from app_private.calendar_events other where other.connection_id=pc.id
        and other.occurrence_id<>o.id and other.reserved_slots && slot))
  order by (lower(pc.organizer_email)=lower(tutor_email)) desc,pc.created_at,pc.id limit 1 for share of pc;
  if c.id is null then
    select exists(select 1 from app_private.provider_connections pc where (m.occurrence_id is null or pc.id=m.connection_id)
      and pc.state in ('connected','preview_connected') and app_private.calendar_connection_in_scope(pc,o.id)
      and app_private.has_role(pc.approved_by,'admin') and app_private.payment_verified_account(pc.approved_by)) into has_authority;
    if not has_authority then return jsonb_build_object('state','suppressed','reason','CALENDAR_CONNECTION_REQUIRED'); end if;
    insert into app_private.calendar_capacity_waits values(o.id,o.version)
      on conflict(occurrence_id) do update set occurrence_version=excluded.occurrence_version;
    return jsonb_build_object('state','suppressed','reason','CALENDAR_ORGANIZER_CAPACITY');
  end if;
  delete from app_private.calendar_capacity_waits where occurrence_id=o.id;
  if m.occurrence_id is null then
    insert into app_private.calendar_events(occurrence_id,connection_id,connection_version,provider_event_id,reserved_slots)
      values(o.id,c.id,c.version,'gt'||replace(o.id::text,'-',''),tstzmultirange(slot)) returning * into m;
  else
    update app_private.calendar_events set connection_version=c.version,
      reserved_slots=case when o.state='cancelled' then reserved_slots else reserved_slots+tstzmultirange(slot) end
      where occurrence_id=o.id returning * into m;
  end if;
  insert into app_private.calendar_dispatches(job_id,lease_token,occurrence_id,occurrence_version,connection_id,connection_version,meeting_generation)
    values(p_job_id,p_lease_token,o.id,o.version,c.id,c.version,m.meeting_generation)
    on conflict(job_id) do update set lease_token=excluded.lease_token,occurrence_version=excluded.occurrence_version,
      connection_version=excluded.connection_version,meeting_generation=excluded.meeting_generation;
  return jsonb_build_object('state','ready','mode',c.mode,'desired',jsonb_build_object(
    'occurrence_id',o.id,'occurrence_version',o.version,'connection_id',c.id,'connection_version',c.version,
    'credential_version',c.credential_version,'calendar_id',c.calendar_id,'provider_event_id',m.provider_event_id,
    'meeting_generation',m.meeting_generation,'conference_request_id',m.conference_request_id,
    'action',case when o.state='cancelled' then 'cancel' else 'upsert' end,
    'start_at',o.start_at,'end_at',o.end_at,'tutor_email',tutor_email,'title','Git Tutor session'));
end $$;

create or replace function app_private.get_calendar_credentials(p_connection_id uuid,p_connection_version integer,p_job_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; occ uuid;
begin
  select e.aggregate_id into occ from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.id=p_job_id;
  perform app_private.calendar_assert_job(occ,p_job_id,p_lease_token);
  select jsonb_build_object('provider','google','connection_id',c.id,'credential_version',v.id,'envelope',v.encrypted_credentials)
    into result from app_private.calendar_dispatches d
    join app_private.occurrences o on o.id=d.occurrence_id and o.version=d.occurrence_version
    join app_private.calendar_events m on m.occurrence_id=o.id and m.connection_id=d.connection_id
      and m.meeting_generation=d.meeting_generation and m.connection_version=d.connection_version
    join app_private.provider_connections c on c.id=m.connection_id and c.version=m.connection_version and c.mode='google'
    join app_private.provider_credential_versions v on v.id=c.credential_version and v.connection_id=c.id
    where d.job_id=p_job_id and d.lease_token=p_lease_token and o.id=occ
      and c.id=p_connection_id and c.version=p_connection_version and app_private.calendar_connection_in_scope(c,occ)
      and app_private.has_role(c.approved_by,'admin') and app_private.payment_verified_account(c.approved_by)
      and (o.state='cancelled' or exists(select 1 from app_private.tutors t where t.id=o.tutor_id
        and app_private.has_role(t.account_id,'tutor') and app_private.payment_verified_account(t.account_id)));
  if result is null then raise exception 'STATE_CONFLICT'; end if;
  return result;
end $$;

-- Preserve the established observation, reconciliation, notification and access
-- contracts. Only a dispatch made by this lease can finalize a reservation.
alter function app_private.finalize_calendar_sync(uuid,integer,uuid,integer,integer,uuid,uuid,jsonb)
  rename to calendar_apply_observation;
revoke all on function app_private.calendar_apply_observation(uuid,integer,uuid,integer,integer,uuid,uuid,jsonb) from git_tutor_worker;
create function app_private.finalize_calendar_sync(p_occurrence_id uuid,p_occurrence_version integer,p_connection_id uuid,
  p_connection_version integer,p_meeting_generation integer,p_job_id uuid,p_lease_token uuid,p_observation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.occurrences%rowtype; previous_slots tstzmultirange; current_slots tstzmultirange; result jsonb;
begin
  perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);
  o:=app_private.booking_lock_occurrence(p_occurrence_id);
  perform app_private.calendar_lock_allocator();
  if not exists (select 1 from app_private.calendar_dispatches d where d.job_id=p_job_id and d.lease_token=p_lease_token
    and d.occurrence_id=o.id and d.occurrence_version=p_occurrence_version and d.connection_id=p_connection_id
    and d.connection_version=p_connection_version and d.meeting_generation=p_meeting_generation)
    then raise exception 'STATE_CONFLICT'; end if;
  perform 1 from app_private.provider_connections where id=p_connection_id for share;
  -- A retry of an already observed job cannot shed reservations acquired by a
  -- later provider operation, even if the original response was successful.
  if exists(select 1 from app_private.calendar_observations where job_id=p_job_id and lease_token=p_lease_token) then
    return app_private.calendar_apply_observation(p_occurrence_id,p_occurrence_version,p_connection_id,p_connection_version,
      p_meeting_generation,p_job_id,p_lease_token,p_observation);
  end if;
  if o.version=p_occurrence_version and o.state='cancelled' and p_observation->>'outcome'='ready' then raise exception 'STATE_CONFLICT'; end if;
  select reserved_slots into previous_slots from app_private.calendar_events where occurrence_id=o.id;
  result:=app_private.calendar_apply_observation(p_occurrence_id,p_occurrence_version,p_connection_id,p_connection_version,
    p_meeting_generation,p_job_id,p_lease_token,p_observation);
  if (result->>'applied')::boolean then
    if o.state='cancelled' and p_observation->>'outcome'='revoked' then current_slots:='{}';
    elsif o.state<>'cancelled' and p_observation->>'outcome'='ready' then current_slots:=tstzmultirange(tstzrange(o.start_at,o.end_at,'[)'));
    end if;
    if current_slots is not null and current_slots<>previous_slots then
      update app_private.calendar_events set reserved_slots=current_slots where occurrence_id=o.id;
      perform app_private.calendar_wake_sessions(p_connection_id,previous_slots-current_slots);
    end if;
  end if;
  return result;
end $$;

alter function api.get_occurrence_meeting(uuid,text,uuid) set schema app_private;
alter function app_private.get_occurrence_meeting(uuid,text,uuid) rename to calendar_meeting_view;
revoke all on function app_private.calendar_meeting_view(uuid,text,uuid) from authenticated;
create function api.get_occurrence_meeting(p_occurrence_id uuid,p_view text default 'customer',p_learner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=app_private.calendar_meeting_view(p_occurrence_id,p_view,p_learner_id);
  if result->>'reason'='PROVISIONING' and exists(select 1 from app_private.calendar_capacity_waits w
    where w.occurrence_id=p_occurrence_id and w.occurrence_version=(result->>'occurrence_version')::integer) then
    return result||jsonb_build_object('meeting_status','pending','reason',case when p_view='admin'
      then 'CALENDAR_ORGANIZER_CAPACITY' else 'PROVISIONING' end);
  end if;
  return result;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,n.nspname,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' and p.proname in ('calendar_lock_allocator','calendar_wake_sessions','calendar_summary',
      'calendar_fake_command','calendar_save_grant','calendar_connection_in_scope','record_calendar_organizer','finalize_calendar_sync'))
      or (n.nspname='api' and p.proname in ('list_calendar_connections','add_fake_calendar_organizer',
      'reconnect_fake_calendar_organizer','create_calendar_reconnection_request','get_occurrence_meeting'))
  loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
    if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);
    elsif f.proname in ('record_calendar_organizer','finalize_calendar_sync') then
      execute format('grant execute on function %s to git_tutor_worker',f.signature);
    end if;
  end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
