-- Explicit retry preserves old observations and fences each new generation.
grant create on schema api,app_private to git_tutor_commands;
alter table app_private.file_scan_scenarios add column scan_generation integer not null default 1 check(scan_generation>0);
alter table app_private.file_scan_scenarios drop constraint file_scan_scenarios_pkey;
alter table app_private.file_scan_scenarios add primary key(file_id,scan_generation);
create or replace function app_private.prepare_file_scan(p_file_id uuid,p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f app_private.files%rowtype;a app_private.file_access_states%rowtype;scenario text:='clean';completed jsonb;begin
 if not exists(select 1 from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.id=p_job_id and j.purpose='files.scan' and j.state='leased' and j.lease_token=p_lease_token and j.lease_expires_at>now() and e.aggregate_id=p_file_id and e.event_type='file_scan_requested' and e.payload=jsonb_build_object('file_id',p_file_id)) then raise exception 'LEASE_LOST';end if;
 select * into f from app_private.files where id=p_file_id;select * into a from app_private.file_access_states where file_id=p_file_id;if f.id is null or a.file_id is null then raise exception 'NOT_FOUND';end if;
 insert into app_private.file_scan_attempts(file_id,scan_generation,job_id,lease_token,object_version,checksum_sha256)values(f.id,a.scan_generation,p_job_id,p_lease_token,f.object_version,f.checksum_sha256)on conflict do nothing;
 if exists(select 1 from app_private.environment_metadata where environment in('test','development') and fixture_marker is not null)then select coalesce((select s.scenario from app_private.file_scan_scenarios s where s.file_id=p_file_id and s.scan_generation=a.scan_generation),'clean')into scenario;end if;select result into completed from app_private.file_scan_results where job_id=p_job_id;
 return jsonb_build_object('file_id',f.id,'scan_generation',a.scan_generation,'object_key',f.object_key,'object_version',f.object_version,'checksum_sha256',f.checksum_sha256,'detected_type',f.detected_mime,'size_bytes',f.byte_size,'scenario',scenario,'completed_result',completed);
end $$;
create or replace function api.finalize_file_upload(p_file_id uuid,p_checksum_sha256 text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();i app_private.file_upload_intents%rowtype;s app_private.file_upload_states%rowtype;ctx jsonb;job uuid;begin
 select * into i from app_private.file_upload_intents where id=p_file_id;if i.id is null or i.actor_id<>actor then raise exception 'NOT_FOUND';end if;perform app_private.file_resolve_target(actor,i.purpose,i.evidence_action,i.parent_target_id);ctx:=app_private.booking_begin(actor,'finalize_file_upload',jsonb_build_object('file_id',p_file_id,'checksum_sha256',p_checksum_sha256),p_idempotency_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 select * into s from app_private.file_upload_states where file_id=p_file_id for update;if i.checksum_sha256 is distinct from p_checksum_sha256 then raise exception 'FILE_CHECKSUM_MISMATCH';end if;if s.adopted_attempt_id is null then raise exception 'UPLOAD_REQUIRED';end if;
 job:=s.scan_job_id;
 if exists(select 1 from app_private.file_access_states where file_id=i.id and scan_state='quarantined')then
  update app_private.file_access_states set scan_generation=scan_generation+1,scan_state='pending',safe_error_code=null,version=version+1,updated_at=now()where file_id=i.id;job:=null;
 end if;
 if job is null then job:=app_private.enqueue_event(gen_random_uuid(),'file_scan_requested',i.id,jsonb_build_object('file_id',i.id),'files.scan');update app_private.file_upload_states set state='finalized',scan_job_id=job,version=version+1,updated_at=now()where file_id=i.id returning * into s;perform set_config('response.status','202',true);end if;
 return app_private.booking_finish(ctx,i.id,s.version,jsonb_build_object('scan_state',(select scan_state from app_private.file_access_states where file_id=i.id),'scan_job_id',job),'file_upload_finalized',jsonb_build_object('file_id',i.id));
end $$;
revoke create on schema api,app_private from git_tutor_commands;notify pgrst,'reload schema';
