-- An organizer may test Google in a development installation while booked
-- practice sessions continue using their simulated rooms and original mappings.
alter table app_private.provider_connections drop constraint provider_connections_state_check;
alter table app_private.provider_connections add constraint provider_connections_state_check
 check (state in ('connected','reauthorization_required','revoked') or
       (state='preview_connected' and mode='google'));
create unique index one_preview_organizer on app_private.provider_connections(provider)
 where state='preview_connected';

create or replace function app_private.record_calendar_connection(p_request_id uuid,p_connection_id uuid,p_credential_version uuid,p_organizer_email text,p_calendar_id text,p_encrypted_credentials jsonb,p_credential_key_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare r app_private.calendar_connection_requests%rowtype;c app_private.provider_connections%rowtype;
 preview_only boolean := app_private.catalog_environment() in ('development','test');
begin
 select * into r from app_private.calendar_connection_requests where id=p_request_id for update;
 if r.id is null or r.connection_id is distinct from p_connection_id or r.expires_at<=now() or not app_private.auth_session_active(r.actor_account_id,r.session_id) or not app_private.payment_verified_account(r.actor_account_id) then raise exception 'AUTH_REQUIRED';end if;perform app_private.require_role(r.actor_account_id,'admin');
 if p_credential_version is null or p_organizer_email is null or length(p_organizer_email) not between 3 and 254 or p_organizer_email not like '%@%' or p_calendar_id is null or length(p_calendar_id) not between 1 and 500 or not app_private.calendar_envelope_valid(p_encrypted_credentials,p_credential_key_id) then raise exception 'VALIDATION_ERROR';end if;
 if r.consumed_at is not null then select * into c from app_private.provider_connections where id=r.connection_id;if c.credential_version is distinct from p_credential_version then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('connection_id',c.id,'version',c.version,'integration_state','verification_required');end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-organizer',0));
 -- The preview worker continues to resolve its original simulated connection.
 update app_private.provider_connections
    set state='revoked', version=version+1, updated_at=now()
  where state='preview_connected' or (not preview_only and state='connected');
 insert into app_private.provider_connections(id,provider,mode,state,organizer_email,calendar_id,approved_by,credential_version) values(r.connection_id,'google','google',case when preview_only then 'preview_connected' else 'connected' end,p_organizer_email,p_calendar_id,r.actor_account_id,p_credential_version);
 insert into app_private.provider_credential_versions(id,connection_id,encrypted_credentials,credential_key_id) values(p_credential_version,r.connection_id,p_encrypted_credentials,p_credential_key_id);
 update app_private.calendar_connection_requests set consumed_at=now() where id=r.id;
 if not preview_only then perform app_private.calendar_queue_current(); end if;
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(r.actor_account_id,r.command_id,'calendar_connection_authorized',r.connection_id,jsonb_build_object('credential_version',p_credential_version));
 return jsonb_build_object('connection_id',r.connection_id,'version',1,'integration_state','verification_required');
end $$;
create or replace function api.get_calendar_connection() returns jsonb language plpgsql security definer set search_path='' as $$declare actor uuid:=app_private.require_actor();c app_private.provider_connections%rowtype;begin
 perform app_private.require_role(actor,'admin');select * into c from app_private.provider_connections order by (state='preview_connected') desc,(state='connected') desc,created_at desc,id desc limit 1;
 return jsonb_build_object('connection_id',c.id,'version',coalesce(c.version,0),'mode',coalesce(c.mode,'fake'),'state',coalesce(c.state,'not_connected'),'integration_state',case when c.mode='fake' then 'simulated' when c.verified_at is not null then 'verified' else 'verification_required' end,'organizer_masked_email',case when c.organizer_email is not null then left(c.organizer_email,1)||'***@'||split_part(c.organizer_email,'@',2) end,'last_verified_at',c.verified_at,'safe_error_code',null);
end $$;
