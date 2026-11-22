-- File access stays blocked until a conclusive scan of the adopted object.
grant create on schema api, app_private to git_tutor_commands;
create or replace function app_private.finalize_file_scan(p_file_id uuid,p_scan_generation integer,p_job_id uuid,p_lease_token uuid,p_observation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb;attempt uuid;a app_private.file_access_states%rowtype;result jsonb;result_id uuid:=gen_random_uuid();scan text;mode text;publicpurpose text;begin
 prepared:=app_private.prepare_file_scan(p_file_id,p_job_id,p_lease_token);if prepared->'completed_result'<>'null'::jsonb then return prepared->'completed_result';end if;
 if p_observation is null or jsonb_typeof(p_observation)<>'object' or p_observation-array['outcome','adapter_mode','engine_version','signature_version','reference','safe_error_code']<>'{}'::jsonb or not(p_observation ?& array['outcome','adapter_mode','engine_version','signature_version','reference','safe_error_code']) or p_observation->>'outcome' not in('clean','infected','error','unknown') or p_observation->>'adapter_mode' not in('fake','clamav') then raise exception 'VALIDATION_ERROR';end if;
 mode:=p_observation->>'adapter_mode';if mode='fake' and not exists(select 1 from app_private.environment_metadata where environment in('test','development') and fixture_marker is not null)then raise exception 'FORBIDDEN';end if;
 if length(p_observation->>'engine_version')not between 1 and 200 or length(p_observation->>'signature_version')not between 1 and 200 or length(p_observation->>'reference')not between 1 and 200 or(p_observation->>'safe_error_code' is not null and p_observation->>'safe_error_code'!~'^[A-Z0-9_]{1,80}$')then raise exception 'VALIDATION_ERROR';end if;
 select * into a from app_private.file_access_states where file_id=p_file_id for update;select id into attempt from app_private.file_scan_attempts where job_id=p_job_id and lease_token=p_lease_token;
 scan:=case when p_observation->>'outcome'='clean' then 'clean' else 'quarantined' end;
 if a.scan_generation=p_scan_generation then update app_private.file_access_states set scan_state=scan,integration_state=case when mode='fake' then 'simulated' when p_observation->>'outcome' in ('clean','infected') then 'verified' else 'verification_required' end,safe_error_code=p_observation->>'safe_error_code',current_scan_result_id=result_id,version=version+1,updated_at=now()where file_id=p_file_id returning * into a;end if;
 result:=jsonb_build_object('file_id',p_file_id,'scan_state',a.scan_state,'version',a.version);insert into app_private.file_scan_results(id,file_id,scan_generation,job_id,attempt_id,observation,result)values(result_id,p_file_id,p_scan_generation,p_job_id,attempt,p_observation,result);
 select purpose into publicpurpose from app_private.file_upload_intents where id=p_file_id;if a.scan_generation=p_scan_generation and scan='clean' and publicpurpose='private_preparation' then perform app_private.enqueue_event(gen_random_uuid(),'preparation_ready',p_file_id,jsonb_build_object('file_id',p_file_id),'notifications.route');end if;
 return result;
end $$;

create or replace function api.finalize_file_upload(p_file_id uuid, p_checksum_sha256 text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.require_actor();
  intent app_private.file_upload_intents%rowtype;
  upload app_private.file_upload_states%rowtype;
  ctx jsonb;
  job uuid;
begin
  select * into intent from app_private.file_upload_intents where id = p_file_id;
  perform app_private.file_assert_upload_actor(actor, intent);
  ctx := app_private.booking_begin(actor, 'finalize_file_upload', jsonb_build_object('file_id', p_file_id,
    'checksum_sha256', p_checksum_sha256), p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then return ctx->'replay_result'; end if;
  select * into upload from app_private.file_upload_states where file_id = p_file_id for update;
  if intent.checksum_sha256 is distinct from p_checksum_sha256 then raise exception 'FILE_CHECKSUM_MISMATCH'; end if;
  if upload.adopted_attempt_id is null then raise exception 'UPLOAD_REQUIRED'; end if;
  job := upload.scan_job_id;
  if exists (
    select 1 from app_private.file_access_states a join app_private.file_scan_results r on r.id = a.current_scan_result_id
    where a.file_id = intent.id and a.scan_state = 'quarantined' and r.observation->>'outcome' in ('error','unknown')
  ) then
    update app_private.file_access_states set scan_generation = scan_generation + 1, scan_state = 'pending', integration_state = 'verification_required', safe_error_code = null,
      version = version + 1, updated_at = now() where file_id = intent.id;
    job := null;
  end if;
  if job is null then
    job := app_private.enqueue_event(gen_random_uuid(), 'file_scan_requested', intent.id, jsonb_build_object('file_id', intent.id), 'files.scan');
    update app_private.file_upload_states set state = 'finalized', scan_job_id = job, version = version + 1, updated_at = now()
      where file_id = intent.id returning * into upload;
    perform set_config('response.status', '202', true);
  end if;
  return app_private.booking_finish(ctx, intent.id, upload.version, jsonb_build_object('scan_state',
    (select scan_state from app_private.file_access_states where file_id = intent.id), 'scan_job_id', job),
    'file_upload_finalized', jsonb_build_object('file_id', intent.id));
end $$;

-- A quarantined current observation is the durable work item. Keep its original evidence immutable.
update app_private.file_access_states a set integration_state = 'verification_required',
  version = a.version + 1, updated_at = now()
from app_private.file_scan_results r
where r.id = a.current_scan_result_id and a.scan_state = 'quarantined'
  and a.integration_state = 'verified' and r.observation->>'adapter_mode' = 'clamav'
  and r.observation->>'outcome' in ('error','unknown');

create function api.list_file_scan_retries(p_cursor uuid default null, p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.require_actor(); result jsonb;
begin
  if not app_private.has_role(actor,'admin') then raise exception 'FORBIDDEN'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  with candidates as (
    select a.file_id, a.version, i.filename, coalesce(a.safe_error_code,'SCANNER_OUTCOME_UNKNOWN') as reason
    from app_private.file_access_states a
    join app_private.file_scan_results r on r.id = a.current_scan_result_id
    join app_private.file_upload_intents i on i.id = a.file_id
    where a.scan_state = 'quarantined' and r.observation->>'outcome' in ('error','unknown')
      and (p_cursor is null or a.file_id > p_cursor)
    order by a.file_id limit p_limit + 1
  ), page as (select * from candidates order by file_id limit p_limit)
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(page) order by file_id),'[]'::jsonb),
    'next_cursor', case when (select count(*) from candidates) > p_limit
      then (select file_id from page order by file_id desc limit 1) end)
    into result from page;
  return result;
end $$;

create function api.retry_file_scan(p_file_id uuid, p_expected_version integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.require_actor(); a app_private.file_access_states%rowtype; ctx jsonb; job uuid;
begin
  perform app_private.require_role(actor,'admin');
  ctx := app_private.booking_begin(actor,'retry_file_scan',
    jsonb_build_object('file_id',p_file_id,'expected_version',p_expected_version),p_idempotency_key);
  if ctx->'replay_result' <> 'null'::jsonb then return ctx->'replay_result'; end if;
  -- Take the same locks, in the same order, as the uploader's completion command.
  perform 1 from app_private.file_upload_states where file_id = p_file_id for update;
  select * into a from app_private.file_access_states where file_id = p_file_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if a.scan_state <> 'quarantined' or not exists (
    select 1 from app_private.file_scan_results r where r.id = a.current_scan_result_id
      and r.observation->>'outcome' in ('error','unknown')
  ) then raise exception 'STATE_CONFLICT'; end if;
  update app_private.file_access_states set scan_generation = scan_generation + 1, scan_state = 'pending',
    integration_state = 'verification_required', safe_error_code = null, version = version + 1, updated_at = now()
    where file_id = p_file_id returning * into a;
  job := app_private.enqueue_event(gen_random_uuid(),'file_scan_requested',p_file_id,
    jsonb_build_object('file_id',p_file_id),'files.scan');
  update app_private.file_upload_states set scan_job_id = job, version = version + 1, updated_at = now()
    where file_id = p_file_id;
  return app_private.booking_finish(ctx,p_file_id,a.version,jsonb_build_object('scan_job_id',job),
    'file_scan_retried',jsonb_build_object('file_id',p_file_id));
end $$;

alter function api.list_file_scan_retries(uuid,integer) owner to git_tutor_commands;
alter function api.retry_file_scan(uuid,integer,text) owner to git_tutor_commands;
revoke all on function api.list_file_scan_retries(uuid,integer), api.retry_file_scan(uuid,integer,text)
  from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.list_file_scan_retries(uuid,integer), api.retry_file_scan(uuid,integer,text) to authenticated;
revoke create on schema api, app_private from git_tutor_commands;
notify pgrst,'reload schema';
