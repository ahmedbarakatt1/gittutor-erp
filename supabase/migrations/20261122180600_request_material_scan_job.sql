-- On-demand scanning consumes only a current upload enrolled in the owner's Drive workflow.
grant create on schema app_private to git_tutor_commands,git_tutor_worker_api;

create function app_private.request_material_scan_allowed(p_file uuid,p_job uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.request_drive_materials m
    join app_private.file_upload_states u on u.file_id=m.file_id and u.state='finalized' and u.scan_job_id=p_job
    where m.file_id=p_file and not exists(select 1 from app_private.tutoring_request_file_removals r where r.file_id=p_file))
$$;
alter function app_private.request_material_scan_allowed(uuid,uuid) owner to git_tutor_commands;
revoke all on function app_private.request_material_scan_allowed(uuid,uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function app_private.request_material_scan_allowed(uuid,uuid) to git_tutor_worker_api;

create function app_private.claim_request_material_scan(p_file uuid)
returns table(id uuid,event_id uuid,purpose text,event_type text,aggregate_id uuid,payload jsonb,
  lease_token uuid,lease_expires_at timestamptz,attempt_count integer,correlation_id uuid,requires_reconciliation boolean)
language sql security definer set search_path='' as $$
  with candidate as (
    select j.id from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id
    where j.purpose='files.scan' and e.event_type='file_scan_requested' and (p_file is null or e.aggregate_id=p_file)
      and e.payload=jsonb_build_object('file_id',e.aggregate_id)
      and (j.state='pending' or (j.state='leased' and j.lease_expires_at<=now())) and j.available_at<=now()
      and (j.attempt_count<j.max_attempts or (j.state='leased' and j.lease_expires_at<=now()))
      and app_private.request_material_scan_allowed(e.aggregate_id,j.id)
    order by j.available_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update app_private.outbox_jobs j set state='leased',attempt_count=j.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '5 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*
  ), attempt as (
    insert into app_private.job_attempts(id,job_id,attempt_number,dispatch_started)
      select c.lease_token,c.id,c.attempt_count,false from claimed c returning job_id
  )
  select c.id,c.event_id,c.purpose,e.event_type,e.aggregate_id,e.payload,c.lease_token,c.lease_expires_at,
    c.attempt_count,e.correlation_id,c.attempt_count>1 from claimed c join attempt a on a.job_id=c.id
    join app_private.domain_events e on e.id=c.event_id
$$;
alter function app_private.claim_request_material_scan(uuid) owner to git_tutor_worker_api;
revoke all on function app_private.claim_request_material_scan(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function app_private.claim_request_material_scan(uuid) to git_tutor_worker;
revoke create on schema app_private from git_tutor_commands,git_tutor_worker_api;
