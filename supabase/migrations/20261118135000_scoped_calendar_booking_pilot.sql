-- An operator binds a new private practice slot before making it available.
-- Only its approved learner can reserve it. All other slots use the ordinary organizer.
create table app_private.calendar_booking_pilots (
  occurrence_id uuid primary key references app_private.occurrences(id),
  learner_id uuid not null references app_private.learners(id),
  tutor_id uuid not null references app_private.tutors(id),
  connection_id uuid not null references app_private.provider_connections(id),
  connection_version integer not null check (connection_version > 0),
  start_at timestamptz not null,
  end_at timestamptz not null check (isfinite(end_at) and isfinite(start_at) and end_at > start_at),
  tutor_google_email text not null check (length(tutor_google_email) between 3 and 254 and tutor_google_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);
alter table app_private.calendar_booking_pilots enable row level security;
revoke all on app_private.calendar_booking_pilots from public, anon, authenticated, service_role, git_tutor_worker;
grant select on app_private.calendar_booking_pilots to git_tutor_commands;
create policy calendar_pilot_reader on app_private.calendar_booking_pilots
  for select to git_tutor_commands using (true);

create function app_private.validate_calendar_pilot() returns trigger
language plpgsql security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;
begin
  o := app_private.booking_lock_occurrence(new.occurrence_id);
  if app_private.catalog_environment() not in ('test','development')
    or o.state <> 'forming' or o.format <> 'private' or o.capacity <> 1
    or o.tutor_id <> new.tutor_id or o.start_at <> new.start_at or o.end_at <> new.end_at
    or o.start_at <= now()
    or exists (select 1 from app_private.enrollments where occurrence_id=o.id)
    or exists (select 1 from app_private.waitlist_entries where occurrence_id=o.id)
    or exists (select 1 from app_private.calendar_events where occurrence_id=o.id)
    or not exists (
      select 1 from app_private.provider_connections c where c.id=new.connection_id and c.version=new.connection_version
      and c.state='preview_connected' and c.mode='google' and c.verified_at is not null
      and app_private.has_role(c.approved_by,'admin') and app_private.payment_verified_account(c.approved_by)
    ) then raise exception 'STATE_CONFLICT';
  end if;
  return new;
end $$;
create trigger validate_pilot before insert on app_private.calendar_booking_pilots
  for each row execute function app_private.validate_calendar_pilot();
create trigger immutable_pilot before update or delete on app_private.calendar_booking_pilots
  for each row execute function app_private.reject_immutable_change();

create function app_private.guard_pilot_roster() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from app_private.calendar_booking_pilots p
             where p.occurrence_id = new.occurrence_id and p.learner_id <> new.learner_id) then
    raise exception 'NOT_FOUND';
  end if;
  return new;
end $$;
create trigger pilot_enrollment before insert or update of learner_id, occurrence_id on app_private.enrollments
  for each row execute function app_private.guard_pilot_roster();
create trigger pilot_waitlist before insert or update of learner_id, occurrence_id on app_private.waitlist_entries
  for each row execute function app_private.guard_pilot_roster();

-- Fail closed if a pilot is rescheduled, reassigned, unfunded, or its organizer
-- is replaced. A cancellation can still remove the existing Google event.
create function app_private.calendar_connection_in_scope(c app_private.provider_connections, target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select case when p.occurrence_id is null then c.state = 'connected'
    else app_private.catalog_environment() in ('test', 'development')
     and c.state = 'preview_connected' and c.mode = 'google' and c.verified_at is not null
     and c.id = p.connection_id and c.version = p.connection_version
     and o.format = 'private' and o.capacity = 1
     and o.tutor_id = p.tutor_id and o.start_at = p.start_at and o.end_at = p.end_at
     and (o.state = 'cancelled' or (
       o.state in ('confirmed','in_progress') and o.end_at > now()
       and exists (select 1 from app_private.enrollments e where e.occurrence_id = o.id and e.learner_id = p.learner_id and e.state = 'confirmed')
       and not exists (select 1 from app_private.enrollments e where e.occurrence_id = o.id and e.learner_id <> p.learner_id and e.state in ('held','confirmed'))
     ))
    end
  from app_private.occurrences o left join app_private.calendar_booking_pilots p on p.occurrence_id = o.id
  where o.id = target
$$;

grant create on schema app_private to git_tutor_commands;
alter function app_private.validate_calendar_pilot() owner to git_tutor_commands;
alter function app_private.guard_pilot_roster() owner to git_tutor_commands;
alter function app_private.calendar_connection_in_scope(app_private.provider_connections,uuid) owner to git_tutor_commands;
revoke create on schema app_private from git_tutor_commands;
revoke all on function app_private.validate_calendar_pilot(),app_private.guard_pilot_roster(),app_private.calendar_connection_in_scope(app_private.provider_connections,uuid)
  from public,anon,authenticated,service_role,git_tutor_worker;

create or replace function app_private.prepare_calendar_sync(p_occurrence_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare o app_private.occurrences%rowtype;c app_private.provider_connections%rowtype;m app_private.calendar_events%rowtype;email text;begin
 perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);o:=app_private.booking_lock_occurrence(p_occurrence_id);select pc.* into c from app_private.provider_connections pc
 where pc.state in ('connected','preview_connected') and app_private.calendar_connection_in_scope(pc,o.id)
 order by pc.created_at desc,pc.id desc limit 1;
 if c.id is null or not app_private.has_role(c.approved_by,'admin') or not app_private.payment_verified_account(c.approved_by) then return jsonb_build_object('state','suppressed','reason','CALENDAR_CONNECTION_REQUIRED');end if;
 if o.state not in('confirmed','in_progress','cancelled') then return jsonb_build_object('state','suppressed','reason','OCCURRENCE_NOT_ACTIVE');end if;
 select u.email into email from app_private.tutors t cross join lateral app_private.auth_account(t.account_id) u where t.id=o.tutor_id and app_private.has_role(t.account_id,'tutor') and app_private.payment_verified_account(t.account_id);
 if email is null then return jsonb_build_object('state','suppressed','reason','TUTOR_AUTHORITY_REQUIRED');end if;
 -- Only a bound pilot uses the tutor's approved Google address instead of the practice login.
 select coalesce((select p.tutor_google_email from app_private.calendar_booking_pilots p where p.occurrence_id=o.id),email) into email;
 insert into app_private.calendar_events(occurrence_id,connection_id,connection_version,provider_event_id) values(o.id,c.id,c.version,'gt'||replace(o.id::text,'-','')) on conflict(occurrence_id) do nothing;select * into m from app_private.calendar_events where occurrence_id=o.id for update;
 if m.connection_id<>c.id or m.connection_version<>c.version then update app_private.calendar_events set connection_id=c.id,connection_version=c.version,meeting_generation=meeting_generation+1,conference_request_id=gen_random_uuid(),synced_occurrence_version=null,meeting_status='pending',join_url=null,updated_at=now() where occurrence_id=o.id returning * into m;end if;
 return jsonb_build_object('state','ready','mode',c.mode,'desired',jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'connection_id',c.id,'connection_version',c.version,'credential_version',c.credential_version,'calendar_id',c.calendar_id,'provider_event_id',m.provider_event_id,'meeting_generation',m.meeting_generation,'conference_request_id',m.conference_request_id,'action',case when o.state='cancelled' then 'cancel' else 'upsert' end,'start_at',o.start_at,'end_at',o.end_at,'tutor_email',email,'title','Git Tutor session'));
end $$;

create or replace function app_private.get_calendar_credentials(p_connection_id uuid,p_connection_version integer,p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c app_private.provider_connections%rowtype;v app_private.provider_credential_versions%rowtype;occ uuid;begin
 select e.aggregate_id into occ from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.id=p_job_id;perform app_private.calendar_assert_job(occ,p_job_id,p_lease_token);
 select pc.* into c from app_private.provider_connections pc where pc.id=p_connection_id and pc.version=p_connection_version
 and app_private.calendar_connection_in_scope(pc,occ) and app_private.payment_verified_account(pc.approved_by);if c.id is null or c.mode<>'google' or not app_private.has_role(c.approved_by,'admin') then raise exception 'STATE_CONFLICT';end if;
 if not exists(select 1 from app_private.calendar_events where occurrence_id=occ and connection_id=c.id and connection_version=c.version) then raise exception 'STATE_CONFLICT';end if;select * into v from app_private.provider_credential_versions where id=c.credential_version;
 return jsonb_build_object('provider','google','connection_id',c.id,'credential_version',v.id,'envelope',v.encrypted_credentials);
end $$;

create or replace function app_private.finalize_calendar_sync(p_occurrence_id uuid,p_occurrence_version integer,p_connection_id uuid,p_connection_version integer,p_meeting_generation integer,p_job_id uuid,p_lease_token uuid,p_observation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare o app_private.occurrences%rowtype;c app_private.provider_connections%rowtype;m app_private.calendar_events%rowtype;applied boolean;outcome text:=p_observation->>'outcome';status text;prior app_private.calendar_observations%rowtype;event_id uuid;begin
 perform app_private.calendar_assert_job(p_occurrence_id,p_job_id,p_lease_token);o:=app_private.booking_lock_occurrence(p_occurrence_id);select * into m from app_private.calendar_events where occurrence_id=o.id for update;select * into c from app_private.provider_connections where id=p_connection_id;
 if outcome is null or outcome not in('absent','pending','ready','failed','unknown','revoked') or p_observation->>'provider_event_id' is distinct from m.provider_event_id or length(p_observation::text)>10000 then raise exception 'VALIDATION_ERROR';end if;
 if outcome='ready' and(p_observation->>'join_url' is null or not((c.mode='google' and p_observation->>'join_url' ~ '^https://meet[.]google[.]com/[a-z0-9-]+$')or(c.mode='fake' and p_observation->>'join_url' ~ '^https://meet[.]example[.]test/[a-f0-9-]+/[0-9]+$'))) then raise exception 'VALIDATION_ERROR';end if;
 select * into prior from app_private.calendar_observations where job_id=p_job_id and lease_token=p_lease_token;if prior.id is not null then return jsonb_build_object('applied',prior.applied,'outcome',prior.observation->>'outcome');end if;
 applied:=o.version=p_occurrence_version and m.connection_id=p_connection_id and m.connection_version=p_connection_version and m.meeting_generation=p_meeting_generation and c.version=p_connection_version and app_private.calendar_connection_in_scope(c,o.id) and app_private.has_role(c.approved_by,'admin') and app_private.payment_verified_account(c.approved_by);
 insert into app_private.calendar_observations(occurrence_id,connection_id,connection_version,occurrence_version,meeting_generation,job_id,lease_token,observation,applied) values(o.id,p_connection_id,p_connection_version,p_occurrence_version,p_meeting_generation,p_job_id,p_lease_token,p_observation,applied);
 if applied then status:=case when o.state='cancelled' and outcome='revoked' then 'revoked' when outcome='ready' then 'ready' when outcome='failed' then 'failed' when outcome='revoked' then 'revoked' when outcome in('pending','absent') and m.poll_count>=8 then 'failed' else 'pending' end;
 update app_private.calendar_events set synced_occurrence_version=o.version,meeting_status=status,join_url=case when status='ready' then p_observation->>'join_url' end,etag=p_observation->>'etag',safe_error_code=p_observation->>'safe_error_code',updated_at=now() where occurrence_id=o.id;
 update app_private.occurrences set meeting_status=status where id=o.id;
 if status='ready' and(m.notified_occurrence_version is distinct from o.version or m.notified_generation is distinct from m.meeting_generation) then perform app_private.enqueue_event(gen_random_uuid(),'meeting_ready',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'meeting_generation',m.meeting_generation),'notifications.route');update app_private.calendar_events set notified_occurrence_version=o.version,notified_generation=m.meeting_generation,poll_count=0 where occurrence_id=o.id;end if;
 if status='failed' then perform app_private.enqueue_event(gen_random_uuid(),'meeting_provisioning_failed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'notifications.route');end if;
 end if;
 if not applied or(outcome in('pending','absent') and m.poll_count<8) then event_id:=gen_random_uuid();insert into app_private.domain_events(id,event_type,aggregate_id,payload,correlation_id) values(event_id,'calendar_reconciliation_requested',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),event_id);insert into app_private.outbox_jobs(event_id,purpose,available_at) values(event_id,'calendar.sync',now()+make_interval(secs=>least(30*power(2,m.poll_count)::integer,3600)));if applied then update app_private.calendar_events set poll_count=poll_count+1 where occurrence_id=o.id;end if;end if;
 return jsonb_build_object('applied',applied,'outcome',outcome);
end $$;

create or replace function api.get_occurrence_meeting(p_occurrence_id uuid,p_view text default 'customer',p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare actor uuid:=app_private.require_actor();o app_private.occurrences%rowtype;m app_private.calendar_events%rowtype;c app_private.provider_connections%rowtype;reason text;status text;integration text;begin
 o:=app_private.calendar_assert_access(actor,p_occurrence_id,p_view,p_learner_id);select * into m from app_private.calendar_events where occurrence_id=o.id;select * into c from app_private.provider_connections where id=m.connection_id;
 integration:=case when c.mode='fake' then 'simulated' when c.verified_at is not null then 'verified' else 'verification_required' end;status:=coalesce(m.meeting_status,o.meeting_status);
 if o.state in('cancelled','completed') or o.end_at<=now() then reason:=case when o.state='cancelled' then 'ACCESS_REVOKED' else 'SESSION_ENDED' end;status:='revoked';
 elsif o.state not in('confirmed','in_progress') then reason:='NOT_CONFIRMED';
 elsif p_view='customer' and not exists(select 1 from app_private.enrollments e where e.occurrence_id=o.id and e.state='confirmed' and(p_learner_id is null or e.learner_id=p_learner_id) and app_private.booking_can_access(actor,e.learner_id)) then reason:='ACCESS_REVOKED';status:='revoked';
 elsif c.id is null then reason:='PROVISIONING';status:='pending';
 elsif not app_private.calendar_connection_in_scope(c,o.id) or not app_private.has_role(c.approved_by,'admin') or not app_private.payment_verified_account(c.approved_by) then reason:='AUTHORIZATION_REQUIRED';status:='failed';
 elsif not exists(select 1 from app_private.tutors t where t.id=o.tutor_id and app_private.has_role(t.account_id,'tutor') and app_private.payment_verified_account(t.account_id)) then reason:='ACCESS_REVOKED';status:='revoked';
 elsif m.synced_occurrence_version is distinct from o.version or m.connection_version<>c.version then reason:='PROVISIONING';status:='pending';
 elsif m.meeting_status='failed' then reason:='PROVIDER_FAILED';
 elsif m.meeting_status<>'ready' or m.join_url is null then reason:='PROVISIONING';
 elsif integration='verification_required' and p_view<>'admin' then reason:='LIVE_VERIFICATION_REQUIRED';end if;
 return jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'meeting_generation',coalesce(m.meeting_generation,0),'start_at',o.start_at,'end_at',o.end_at,'server_now',now(),'meeting_status',status,'integration_state',integration,'can_join',reason is null,'join_path',case when reason is null then '/api/v1/occurrences/'||o.id||'/meeting/access' end,'reason',reason);
end $$;

create or replace function app_private.rotate_calendar_credentials(p_connection_id uuid,p_connection_version integer,p_previous_credential_version uuid,p_credential_version uuid,p_encrypted_credentials jsonb,p_credential_key_id text,p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c app_private.provider_connections%rowtype;proof jsonb;begin
 proof:=app_private.get_calendar_credentials(p_connection_id,p_connection_version,p_job_id,p_lease_token);select * into c from app_private.provider_connections where id=p_connection_id for update;
 if c.state not in ('connected','preview_connected') or c.version<>p_connection_version or c.credential_version is distinct from p_previous_credential_version then raise exception 'VERSION_CONFLICT';end if;
 if p_credential_version is null or p_credential_version=p_previous_credential_version or not app_private.calendar_envelope_valid(p_encrypted_credentials,p_credential_key_id) then raise exception 'VALIDATION_ERROR';end if;
 insert into app_private.provider_credential_versions(id,connection_id,encrypted_credentials,credential_key_id) values(p_credential_version,c.id,p_encrypted_credentials,p_credential_key_id);update app_private.provider_connections set credential_version=p_credential_version,updated_at=now() where id=c.id;return jsonb_build_object('credential_version',p_credential_version);
end $$;
