grant create on schema app_private to git_tutor_commands;
create or replace function app_private.booking_staff_occurrence_dto(p_id uuid,p_admin boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare occ app_private.occurrences%rowtype;roster jsonb;result jsonb;begin
 select * into occ from app_private.occurrences where id=p_id;
 select coalesce(jsonb_agg(case when p_admin then jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner_id',e.learner_id,'display_name',p.display_name,'state',e.state,'hold_expires_at',e.hold_expires_at,'quote_id',e.current_quote_id,'quote_accepted_at',(select min(accepted_at) from app_private.quote_acceptances where quote_id=e.current_quote_id),'funding',app_private.booking_funding_status(e.id,e.current_quote_id,q.policy_version_id),'provisional_amendment_id',e.amendment_id) else jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'display_name',p.display_name,'state',e.state) end order by e.created_at,e.id),'[]') into roster from app_private.enrollments e join app_private.learners l on l.id=e.learner_id join app_private.people p on p.id=l.person_id join app_private.quotes q on q.id=e.current_quote_id where e.occurrence_id=p_id and (p_admin or e.state='confirmed');
 result:=jsonb_build_object('occurrence',app_private.booking_occurrence_dto(p_id),'roster',roster,'fee_agreement',app_private.booking_fee_dto(occ.current_fee_agreement_id),'pending_proposals',app_private.booking_pending_proposals(p_id,null,case when p_admin then null else occ.tutor_id end));
 if p_admin then result:=result||jsonb_build_object('confirmation_deadline',occ.confirmation_deadline_at,'formation_resolution',(select jsonb_build_object('decision_id',d.id,'action',d.action,'recorded_at',d.recorded_at) from app_private.booking_formation_decisions d where d.occurrence_id=occ.id and d.deadline_at=occ.confirmation_deadline_at and occ.state='forming'));end if;return result;
end $$;

create or replace function app_private.booking_assert_schedule(p_tutor_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_excluded_occurrence_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare rules app_private.availability_rules%rowtype; exceptions jsonb; conflicts uuid[];
begin
  perform app_private.booking_validate_times(p_start_at,p_end_at);
  select array_agg(occurrence_id order by start_at,occurrence_id) into conflicts from (
    select r.occurrence_id,r.start_at from app_private.tutor_reservations r
    where r.tutor_id=p_tutor_id and r.active and r.occurrence_id is distinct from p_excluded_occurrence_id
      and tstzrange(r.start_at,r.end_at,'[)') && tstzrange(p_start_at,p_end_at,'[)')
    order by r.start_at,r.occurrence_id limit 100
  ) overlaps_list;
  if conflicts is not null then
    -- Schedule details belong to the admin schedule, including when this helper is called by other commands.
    if nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id' is not null then
      if app_private.has_role(app_private.require_actor(),'admin') then
        raise exception 'SCHEDULE_CONFLICT' using detail=jsonb_build_object('conflicting_occurrence_ids',conflicts)::text;
      end if;
    end if;
    raise exception 'SCHEDULE_CONFLICT';
  end if;
  select * into rules from app_private.availability_rules where tutor_id=p_tutor_id;
  select coalesce(jsonb_agg(jsonb_build_object('local_date',local_date,'intervals',intervals)),'[]')
    into exceptions from app_private.availability_exceptions where tutor_id=p_tutor_id;
  if rules.id is null or app_private.teaching_tutor_unavailable(p_tutor_id,p_start_at,p_end_at)
    or not app_private.booking_schedule_covered(rules.weekly_intervals,exceptions,p_start_at,p_end_at)
  then raise exception 'SCHEDULE_CONFLICT'; end if;
  return rules.version;
end $$;

create or replace function app_private.calendar_summary(c app_private.provider_connections)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('connection_id',c.id,'version',coalesce(c.version,0),
    'mode',coalesce(c.mode,'fake'),'state',coalesce(c.state,'not_connected'),
    'integration_state',case when c.mode='fake' then 'simulated' when c.verified_at is not null then 'verified' else 'verification_required' end,
    'organizer_masked_email',case when c.organizer_email is not null then
      case when length(split_part(c.organizer_email,'@',1))>=5 then left(c.organizer_email,2)||'***'||right(split_part(c.organizer_email,'@',1),1)
        when length(split_part(c.organizer_email,'@',1))>=2 then left(c.organizer_email,1)||'***' else '***' end
      ||'@'||split_part(c.organizer_email,'@',2) end,
    'last_verified_at',case when c.mode='fake' then (
      select max(a.recorded_at) from app_private.audit_events a where a.aggregate_id=c.id
        and a.action='simulated_room_verified' and a.details->>'connection_version'=c.version::text
    ) else c.verified_at end,'safe_error_code',null)
$$;

create or replace function app_private.record_simulated_room_check(actor uuid,session_id uuid,target uuid,expected integer,command_key text)
returns void language plpgsql security definer set search_path='' as $$
declare ctx jsonb; c app_private.provider_connections%rowtype;
begin
  if app_private.catalog_environment() not in ('test','development') then raise exception 'FORBIDDEN'; end if;
  if not app_private.auth_session_active(actor,session_id) or not app_private.payment_verified_account(actor)
    then raise exception 'AUTH_REQUIRED'; end if;
  perform app_private.require_role(actor,'admin');
  ctx:=app_private.booking_begin(actor,'recheck_simulated_room',jsonb_build_object('connection_id',target,'expected_version',expected),command_key);
  if ctx->'replay_result'<>'null'::jsonb then return; end if;
  select * into c from app_private.provider_connections where id=target and mode='fake' for update;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if c.version is distinct from expected then raise exception 'VERSION_CONFLICT'; end if;
  if c.state<>'connected' then raise exception 'STATE_CONFLICT'; end if;
  insert into app_private.command_results(id,actor_account_id,command_name,idempotency_key,request_hash,result)
    values((ctx->>'command_id')::uuid,actor,ctx->>'command_name',command_key,ctx->>'request_hash',jsonb_build_object('version',c.version));
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details)
    values(actor,(ctx->>'command_id')::uuid,'simulated_room_verified',c.id,jsonb_build_object('connection_version',c.version));
end $$;
alter function app_private.record_simulated_room_check(uuid,uuid,uuid,integer,text) owner to git_tutor_commands;
revoke all on function app_private.record_simulated_room_check(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function app_private.record_simulated_room_check(uuid,uuid,uuid,integer,text) to git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
