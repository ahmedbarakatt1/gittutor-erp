-- Ordinary live lessons require proof of the actual organizer's calendar.
-- Existing rooms can still be deleted with a current grant after reconsent.
create or replace function app_private.calendar_connection_in_scope(c app_private.provider_connections,target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.calendar_existing_scope(c,target) and (
    (c.state='preview_connected' and c.mode='google') or
    (c.state='connected' and case when app_private.catalog_environment() in ('test','development') then c.mode='fake'
     else c.mode='google' and (c.verified_at is not null or exists (
       select 1 from app_private.calendar_events m join app_private.occurrences o on o.id=m.occurrence_id
       where o.id=target and o.state='cancelled' and m.connection_id=c.id)) end))
$$;

-- The legacy provider record did not persist the dispatched interval. A pending
-- or stale result cannot establish whether the old time is still occupied.
-- Keep the known interval and separately quarantine new bookings on its
-- organizer until current-version reconciliation proves the provider's state.
alter table app_private.calendar_events add column legacy_schedule_unknown boolean not null default false;
update app_private.calendar_events m set legacy_schedule_unknown=true
  from app_private.occurrences o,app_private.provider_connections c
  where o.id=m.occurrence_id and c.id=m.connection_id and c.mode='google'
    and o.state in ('confirmed','in_progress','cancelled')
    and (m.synced_occurrence_version is distinct from o.version or m.meeting_status in ('pending','failed')
      or (o.state='cancelled' and o.end_at>now() and m.meeting_status='revoked'))
    and not exists(select 1 from app_private.calendar_observations proof where proof.occurrence_id=o.id
      and proof.connection_id=m.connection_id and proof.occurrence_version=o.version and proof.applied
      and proof.observation->>'outcome'='revoked' and proof.observation->>'safe_error_code'='CALENDAR_DELETION_CONFIRMED');
create index calendar_unresolved_legacy_organizer on app_private.calendar_events(connection_id) where legacy_schedule_unknown;

grant create on schema app_private to git_tutor_commands;

create or replace function app_private.calendar_wake_sessions(
  organizer uuid, released tstzmultirange default null
) returns void language plpgsql security definer set search_path='' as $$
declare target record;
begin
  if released is null and exists(select 1 from app_private.provider_connections c
    where c.id=organizer and c.mode='google' and c.verified_at is null) then return; end if;
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

create or replace function app_private.record_calendar_organizer(p_request_id uuid,p_connection_id uuid,p_credential_version uuid,
  p_organizer_email text,p_calendar_id text,p_encrypted_credentials jsonb,p_credential_key_id text,p_subject text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
  if p_subject is null or length(p_subject) not between 1 and 255 or p_subject !~ '^[!-~]+$' then raise exception 'VALIDATION_ERROR'; end if;
  saved:=app_private.calendar_save_grant(p_request_id,p_connection_id,p_credential_version,p_organizer_email,
    p_calendar_id,p_encrypted_credentials,p_credential_key_id,p_subject);
  return saved||(select jsonb_build_object('calendar_id',c.calendar_id,'verification_allowed',
    app_private.catalog_environment()='production' and c.state='connected' and c.mode='google')
    from app_private.provider_connections c where c.id=p_connection_id);
end $$;

create function app_private.verify_calendar_organizer(p_request_id uuid,p_connection_id uuid,p_expected_version integer,p_credential_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r app_private.calendar_connection_requests%rowtype; c app_private.provider_connections%rowtype;
begin
  if app_private.catalog_environment()<>'production' then raise exception 'FORBIDDEN'; end if;
  select * into r from app_private.calendar_connection_requests where id=p_request_id for update;
  if r.id is null or r.connection_id is distinct from p_connection_id or r.consumed_at is null or r.expires_at<=clock_timestamp()
     or not app_private.auth_session_active(r.actor_account_id,r.session_id)
     or not app_private.payment_verified_account(r.actor_account_id) then raise exception 'AUTH_REQUIRED'; end if;
  perform app_private.require_role(r.actor_account_id,'admin');
  perform app_private.calendar_lock_allocator();
  select * into c from app_private.provider_connections where id=r.connection_id for update;
  if c.version is distinct from p_expected_version or c.credential_version is distinct from p_credential_version
    then raise exception 'VERSION_CONFLICT'; end if;
  if c.id is null or c.state<>'connected' or c.mode<>'google' or c.approved_by<>r.actor_account_id
    or not exists (select 1 from app_private.audit_events a where a.command_id=r.command_id and a.aggregate_id=c.id
      and a.actor_account_id=r.actor_account_id and a.action='calendar_connection_authorized'
      and a.details->>'credential_version'=p_credential_version::text)
    then raise exception 'STATE_CONFLICT'; end if;
  if c.verified_at is null then
    update app_private.provider_connections set verified_at=clock_timestamp(),updated_at=now() where id=c.id;
    insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details)
      values(r.actor_account_id,r.command_id,'calendar_organizer_verified',c.id,
        jsonb_build_object('connection_version',c.version,'credential_version',p_credential_version));
    perform app_private.calendar_wake_sessions(c.id);
  end if;
  return jsonb_build_object('connection_id',c.id,'version',c.version,'integration_state','verified');
end $$;
alter function app_private.verify_calendar_organizer(uuid,uuid,integer,uuid) owner to git_tutor_commands;
revoke all on function app_private.verify_calendar_organizer(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function app_private.verify_calendar_organizer(uuid,uuid,integer,uuid) to git_tutor_worker;

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
        and other.occurrence_id<>o.id and (other.legacy_schedule_unknown or other.reserved_slots && slot)))
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


create or replace function app_private.finalize_calendar_sync(p_occurrence_id uuid,p_occurrence_version integer,p_connection_id uuid,
  p_connection_version integer,p_meeting_generation integer,p_job_id uuid,p_lease_token uuid,p_observation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.occurrences%rowtype; previous_slots tstzmultirange; current_slots tstzmultirange; result jsonb; legacy_unknown boolean; google boolean;
begin
  perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);
  o:=app_private.booking_lock_occurrence(p_occurrence_id);
  perform app_private.calendar_lock_allocator();
  if not exists (select 1 from app_private.calendar_dispatches d where d.job_id=p_job_id and d.lease_token=p_lease_token
    and d.occurrence_id=o.id and d.occurrence_version=p_occurrence_version and d.connection_id=p_connection_id
    and d.connection_version=p_connection_version and d.meeting_generation=p_meeting_generation)
    then raise exception 'STATE_CONFLICT'; end if;
  select mode='google' into google from app_private.provider_connections where id=p_connection_id for share;
  -- Preparing a Google upsert persistently creates the room mapping before
  -- network I/O. A 404 can race a POST from an earlier lease. The immutable
  -- event ID's authenticated tombstone or acknowledged DELETE fences that POST.
  -- Older workers reported unqualified "revoked" for a 404. Retain the
  -- reservation on those responses and use the existing bounded poll queue.
  if google and o.state='cancelled' and o.version=p_occurrence_version and
      (p_observation->>'outcome'='absent' or (p_observation->>'outcome'='revoked'
        and p_observation->>'safe_error_code' is distinct from 'CALENDAR_DELETION_CONFIRMED')) then
    p_observation:=p_observation||jsonb_build_object('outcome','absent','join_url',null,'safe_error_code','CALENDAR_DELETION_UNCONFIRMED');
  end if;
  -- A retry of an already observed job cannot shed reservations acquired by a
  -- later provider operation, even if the original response was successful.
  if exists(select 1 from app_private.calendar_observations where job_id=p_job_id and lease_token=p_lease_token) then
    return app_private.calendar_apply_observation(p_occurrence_id,p_occurrence_version,p_connection_id,p_connection_version,
      p_meeting_generation,p_job_id,p_lease_token,p_observation);
  end if;
  if o.version=p_occurrence_version and o.state='cancelled' and p_observation->>'outcome'='ready' then raise exception 'STATE_CONFLICT'; end if;
  select reserved_slots,legacy_schedule_unknown into previous_slots,legacy_unknown from app_private.calendar_events where occurrence_id=o.id;
  result:=app_private.calendar_apply_observation(p_occurrence_id,p_occurrence_version,p_connection_id,p_connection_version,
    p_meeting_generation,p_job_id,p_lease_token,p_observation);
  if (result->>'applied')::boolean then
    if o.state='cancelled' and p_observation->>'outcome'='revoked' then current_slots:='{}';
    elsif o.state<>'cancelled' and p_observation->>'outcome'='ready' then current_slots:=tstzmultirange(tstzrange(o.start_at,o.end_at,'[)'));
    end if;
    if current_slots is not null and (current_slots<>previous_slots or legacy_unknown) then
      update app_private.calendar_events set reserved_slots=current_slots,legacy_schedule_unknown=false where occurrence_id=o.id;
      perform app_private.calendar_wake_sessions(p_connection_id,case when legacy_unknown
        then tstzmultirange(tstzrange(null,null,'()')) else previous_slots-current_slots end);
    end if;
  end if;
  return result;
end $$;


revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';

