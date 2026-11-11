-- Preserve applied migration checksums and align catalog creation/update/replay transport.
create or replace function app_private.catalog_command(p_name text,p_args jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid; command uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid(); resource_version integer:=1; digest text; saved app_private.command_results%rowtype;
  env text; scope_name text; content jsonb; customer jsonb; compensation jsonb; errors text[]; result jsonb:='{}'; action text;
  price app_private.pricing_versions%rowtype; policy app_private.policy_versions%rowtype; offer app_private.offers%rowtype;
  tutor app_private.tutors%rowtype; profile app_private.tutor_profile_versions%rowtype; private_keys text[]:=array['private_fee_rule','tutor_cancellation_compensation_rule','tutor_fee_for_delivered_session'];
  private_content jsonb; pricing_json jsonb; effective timestamptz; k text;
begin
  perform set_config('response.status','200',true);
  actor:=app_private.require_actor(); perform app_private.require_role(actor,'admin');
  env:=app_private.catalog_environment();
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR'; end if;
  if p_name in ('update_policy_draft','approve_policy_version') then
    select * into policy from app_private.policy_versions where id=(p_args->>'policy_version_id')::uuid for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; resource:=policy.id;
  elsif p_name in ('update_pricing_draft','approve_pricing_version') then
    select * into price from app_private.pricing_versions where id=(p_args->>'pricing_version_id')::uuid for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; resource:=price.id;
  elsif p_name='publish_offer' then
    select * into offer from app_private.offers where id=(p_args->>'offer_id')::uuid for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; resource:=offer.id;
  elsif p_name='approve_tutor_profile' then
    select * into tutor from app_private.tutors where id=(p_args->>'tutor_id')::uuid for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if; resource:=tutor.id;
  elsif p_name not in ('create_policy_draft','create_pricing_draft','create_offer') then raise exception 'VALIDATION_ERROR'; end if;
  digest:=app_private.catalog_hash(p_args);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_name||':'||p_key,0));
  select * into saved from app_private.command_results where actor_account_id=actor and command_name=p_name and idempotency_key=p_key;
  if found then
    if saved.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    -- Keep append-only history intact while projecting legacy update results to the contract.
    if p_name='update_policy_draft' then return saved.result-'policy_version_id'; end if;
    if p_name='update_pricing_draft' then return saved.result-'pricing_version_id'; end if;
    return saved.result;
  end if;
  if p_name in ('update_policy_draft','approve_policy_version','update_pricing_draft','approve_pricing_version','publish_offer','approve_tutor_profile') then
    if p_args->>'expected_version' is null or (p_args->>'expected_version')::integer is distinct from coalesce(policy.version,price.version,offer.version,tutor.version) then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  end if;
  if p_name in ('approve_policy_version','approve_pricing_version','publish_offer') then
    effective:=(p_args->>'effective_at')::timestamptz;
    if effective is null or not isfinite(effective) then raise exception 'INVALID_TIME'; end if;
    if p_name<>'publish_offer' and (p_args->>'approval_note' is null or length(trim(p_args->>'approval_note')) not between 1 and 2000) then raise exception 'VALIDATION_ERROR'; end if;
  end if;
  case p_name
  when 'create_pricing_draft','update_pricing_draft' then
    scope_name:=case when p_name='create_pricing_draft' then p_args->>'scope' else price.scope end;
    if scope_name is null or scope_name not in ('group','private') then raise exception 'VALIDATION_ERROR'; end if;
    if p_name='update_pricing_draft' and price.status<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    customer:=p_args->'customer_pricing'; compensation:=p_args->'compensation';
    if cardinality(app_private.catalog_pricing_errors(customer,compensation,scope_name,false))>0 then raise exception 'VALIDATION_ERROR'; end if;
    errors:=app_private.catalog_pricing_errors(customer,compensation,scope_name,true);
    if p_name='create_pricing_draft' then
      insert into app_private.pricing_versions(id,scope,customer_pricing,environment_scope,is_synthetic,content_hash,created_by)
        values(resource,scope_name,customer,case when env in ('test','development') then 'development_test' else 'production' end,env in ('test','development'),app_private.catalog_hash(jsonb_build_object('customer_pricing',customer,'compensation',compensation)),actor);
      insert into finance_private.pricing_compensation(pricing_version_id,content) values(resource,compensation); action:='pricing_draft_created';
    else
      update app_private.pricing_versions set customer_pricing=customer,content_hash=app_private.catalog_hash(jsonb_build_object('customer_pricing',customer,'compensation',compensation)),version=version+1,updated_at=now() where id=resource returning version into resource_version;
      update finance_private.pricing_compensation set content=compensation where pricing_version_id=resource; action:='pricing_draft_updated';
    end if;
    result:=jsonb_build_object('validation_errors',to_jsonb(errors));
    if p_name='create_pricing_draft' then result:=result||jsonb_build_object('pricing_version_id',resource); end if;
  when 'approve_pricing_version' then
    if price.status<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    select pc.content into compensation from finance_private.pricing_compensation pc where pc.pricing_version_id=price.id;
    if cardinality(app_private.catalog_pricing_errors(price.customer_pricing,compensation,price.scope,true))>0 then raise exception 'POLICY_INCOMPLETE'; end if;
    perform app_private.assert_catalog_publication(env,price.environment_scope,price.is_synthetic);
    update app_private.pricing_versions set status='approved',approved_by=actor,approved_at=now(),effective_at=effective,version=version+1,updated_at=now() where id=resource returning version into resource_version;
    action:='pricing_version_approved'; result:=jsonb_build_object('pricing_version_id',resource,'approved_at',now());
  when 'create_policy_draft','update_policy_draft' then
    scope_name:=case when p_name='create_policy_draft' then p_args->>'scope' else policy.scope end;
    if scope_name is null or scope_name not in ('group','private') or (p_name='create_policy_draft' and p_args->>'kind' is distinct from 'booking') then raise exception 'VALIDATION_ERROR'; end if;
    if p_name='update_policy_draft' and policy.status<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    content:=p_args->'content';
    if cardinality(app_private.catalog_policy_errors(content,scope_name,false))>0 then raise exception 'VALIDATION_ERROR'; end if;
    if jsonb_typeof(content->'package_contract')='object' then
      if content#>>'{package_contract,package_policy_version_id}' is not null and content#>>'{package_contract,package_policy_version_id}'<>resource::text then raise exception 'VALIDATION_ERROR'; end if;
      content:=jsonb_set(content,'{package_contract,package_policy_version_id}',to_jsonb(resource::text));
    end if;
    select coalesce(jsonb_object_agg(key,value),'{}') into private_content from jsonb_each(content) where key=any(private_keys);
    errors:=app_private.catalog_policy_errors(content,scope_name,true,resource);
    if p_name='create_policy_draft' then
      insert into app_private.policy_versions(id,kind,scope,content,pricing_version_id,environment_scope,is_synthetic,content_hash,created_by)
        values(resource,'booking',scope_name,content-private_keys,(content->>'customer_pricing_version')::uuid,case when env in ('test','development') then 'development_test' else 'production' end,env in ('test','development'),app_private.catalog_hash(content),actor);
      insert into finance_private.policy_compensation_terms(policy_version_id,content) values(resource,private_content); action:='policy_draft_created';
    else
      update app_private.policy_versions set content=content-private_keys,pricing_version_id=(content->>'customer_pricing_version')::uuid,content_hash=app_private.catalog_hash(content),version=version+1,updated_at=now() where id=resource returning version into resource_version;
      update finance_private.policy_compensation_terms set content=private_content where policy_version_id=resource; action:='policy_draft_updated';
    end if;
    result:=jsonb_build_object('validation_errors',to_jsonb(errors));
    if p_name='create_policy_draft' then result:=result||jsonb_build_object('policy_version_id',resource); end if;
  when 'approve_policy_version' then
    if policy.status<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    content:=app_private.policy_content(policy.id);
    select * into price from app_private.pricing_versions where id=policy.pricing_version_id for share;
    if price.id is null or price.status not in ('approved','published') then raise exception 'POLICY_INCOMPLETE'; end if;
    select pc.content into compensation from finance_private.pricing_compensation pc where pc.pricing_version_id=price.id;
    pricing_json:=jsonb_build_object('pricing_version_id',price.id,'scope',price.scope,'customer_pricing',price.customer_pricing,'compensation',compensation);
    if cardinality(app_private.catalog_policy_errors(content,policy.scope,true,policy.id,pricing_json))>0 then raise exception 'POLICY_INCOMPLETE'; end if;
    if content->>'package_enabled'='true' and exists(select 1 from jsonb_array_elements_text(content#>'{package_contract,eligible_offer_ids}') x
      where not exists(select 1 from app_private.offers o where o.id=x::uuid and content#>'{package_contract,eligible_formats}'?o.format and o.duration_minutes=(content#>>'{package_contract,base_duration_minutes}')::int)) then raise exception 'POLICY_INCOMPLETE'; end if;
    perform app_private.assert_catalog_publication(env,policy.environment_scope,policy.is_synthetic);
    perform app_private.assert_catalog_publication(env,price.environment_scope,price.is_synthetic);
    if effective<price.effective_at then raise exception 'POLICY_INCOMPLETE'; end if;
    update app_private.policy_versions set status='approved',approved_by=actor,approved_at=now(),effective_at=effective,version=version+1,updated_at=now() where id=resource returning version into resource_version;
    action:='policy_version_approved'; result:=jsonb_build_object('policy_version_id',resource,'approved_at',now());
  when 'create_offer' then
    select * into policy from app_private.policy_versions where id=(p_args->>'policy_version_id')::uuid for share;
    select * into price from app_private.pricing_versions where id=(p_args->>'pricing_version_id')::uuid for share;
    if policy.id is null or price.id is null or policy.status='retired' or price.status='retired' then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if policy.scope is distinct from p_args->>'format' or price.scope is distinct from p_args->>'format' then raise exception 'VALIDATION_ERROR'; end if;
    perform 1 from app_private.subjects where id=(p_args->>'subject_id')::uuid and active for share;
    if not found then raise exception 'VALIDATION_ERROR'; end if;
    if p_args->>'duration_minutes' is null or (p_args->>'duration_minutes')::int<=0 or p_args->>'capacity' is null
      or (p_args->>'format'='private' and ((p_args->>'capacity')::int<>1 or p_args->>'target_tier' is not null))
      or (p_args->>'format'='group' and (p_args->>'target_tier' is null or (p_args->>'target_tier')::int not between 2 and 4 or (p_args->>'capacity')::int not between (p_args->>'target_tier')::int and 4)) then raise exception 'VALIDATION_ERROR'; end if;
    insert into app_private.offers(id,subject_id,format,duration_minutes,capacity,target_tier,pricing_version_id,policy_version_id,created_by)
      values(resource,(p_args->>'subject_id')::uuid,p_args->>'format',(p_args->>'duration_minutes')::int,(p_args->>'capacity')::int,(p_args->>'target_tier')::int,price.id,policy.id,actor);
    action:='offer_created'; result:=jsonb_build_object('offer_id',resource);
  when 'publish_offer' then
    if offer.status<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    select * into policy from app_private.policy_versions where id=offer.policy_version_id for update;
    select * into price from app_private.pricing_versions where id=offer.pricing_version_id for update;
    if policy.status not in ('approved','published') or price.status not in ('approved','published') or policy.approved_by is null or price.approved_by is null then raise exception 'POLICY_INCOMPLETE'; end if;
    perform app_private.assert_catalog_publication(env,policy.environment_scope,policy.is_synthetic); perform app_private.assert_catalog_publication(env,price.environment_scope,price.is_synthetic);
    content:=app_private.policy_content(policy.id);
    select pc.content into compensation from finance_private.pricing_compensation pc where pc.pricing_version_id=price.id;
    if cardinality(app_private.catalog_policy_errors(content,policy.scope,true,policy.id,jsonb_build_object('pricing_version_id',price.id,'scope',price.scope,'customer_pricing',price.customer_pricing,'compensation',compensation)))>0 then raise exception 'POLICY_INCOMPLETE'; end if;
    if policy.scope<>offer.format or price.scope<>offer.format or policy.pricing_version_id<>price.id or (content->>'duration_minutes')::int<>offer.duration_minutes
      or (offer.format='group' and ((content->>'group_target_size')::int<>offer.target_tier or (content->>'group_capacity')::int<>offer.capacity))
      or effective<policy.effective_at or effective<price.effective_at then raise exception 'POLICY_INCOMPLETE'; end if;
    if price.status='approved' then update app_private.pricing_versions set status='published',version=version+1,updated_at=now() where id=price.id; end if;
    if policy.status='approved' then update app_private.policy_versions set status='published',version=version+1,updated_at=now() where id=policy.id; end if;
    update app_private.offers set status='published',published_at=now(),effective_at=effective,version=version+1,updated_at=now() where id=resource returning version into resource_version;
    action:='offer_published'; result:=jsonb_build_object('published_at',now());
  when 'approve_tutor_profile' then
    if p_args->>'decision' not in ('approved','rejected') or p_args->>'decision' is null or length(trim(coalesce(p_args->>'reason',''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR'; end if;
    perform app_private.require_role(tutor.account_id,'tutor');
    select * into profile from app_private.tutor_profile_versions where id=(p_args->>'profile_version_id')::uuid and tutor_id=tutor.id for update;
    if profile.id is null or profile.id is distinct from tutor.draft_profile_version_id then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if profile.state<>'draft' then raise exception 'STATE_CONFLICT'; end if;
    if (select count(*) from app_private.subjects where id=any(profile.subject_ids) and active)<>cardinality(profile.subject_ids) then raise exception 'VALIDATION_ERROR'; end if;
    update app_private.tutor_profile_versions set state=p_args->>'decision',approved_by=actor,approved_at=now() where id=profile.id;
    update app_private.tutors set approved_profile_version_id=case when p_args->>'decision'='approved' then profile.id else approved_profile_version_id end,version=version+1,updated_at=now() where id=resource returning version,approved_profile_version_id into resource_version,tutor.approved_profile_version_id;
    action:='tutor_profile_reviewed'; result:=jsonb_build_object('approved_profile_version_id',tutor.approved_profile_version_id);
  end case;
  result:=jsonb_build_object('command_id',command,'resource_id',resource,'version',resource_version)||result;
  insert into app_private.command_results(id,actor_account_id,command_name,idempotency_key,request_hash,result) values(command,actor,p_name,p_key,digest,result);
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(actor,command,action,resource,jsonb_build_object('command_name',p_name,'approval_note',p_args->>'approval_note','reason',p_args->>'reason'));
  perform app_private.enqueue_event(command,action,resource,jsonb_build_object('resource_id',resource,'version',resource_version),'notifications.route');
  if p_name in ('create_policy_draft','create_pricing_draft','create_offer') then perform set_config('response.status','201',true); end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;

revoke all on function app_private.catalog_command(text,jsonb,text) from public,anon,authenticated,service_role,git_tutor_worker;
notify pgrst,'reload schema';
