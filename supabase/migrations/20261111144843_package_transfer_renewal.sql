-- Same-learner transfer and successor lineage. New purchase obligations remain pending funding.
grant create on schema api,app_private to git_tutor_commands;
create function app_private.package_assert_acyclic_transfer(p_source_purchase_id uuid,p_target_purchase_id uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_source_purchase_id=p_target_purchase_id or exists(with recursive edges as(select source_purchase_id s,target_purchase_id t from app_private.package_transfers union select source_purchase_id,target_purchase_id from app_private.package_renewals),reachable(id) as(select p_target_purchase_id union select e.t from reachable r join edges e on e.s=r.id) select 1 from reachable where id=p_source_purchase_id) then raise exception 'STATE_CONFLICT';end if;
end $$;
create function app_private.package_transfer_compatible(p_source jsonb,p_target jsonb) returns boolean language sql immutable set search_path='' as $$
 select(p_source-array['package_policy_version_id','grant_credit_quanta','purchase_value_minor'])=(p_target-array['package_policy_version_id','grant_credit_quanta','purchase_value_minor'])
$$;
create function app_private.package_transfer_available(p_source_purchase_id uuid,p_target_purchase_id uuid,p_credit_quanta bigint,p_conversion_proposal_id uuid,p_conversion_terms jsonb,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;lot app_private.package_lots%rowtype;allocations jsonb;allocation jsonb;mapping jsonb;targetq bigint;sourceq bigint;amount bigint;total numeric:=0;child uuid;transfer uuid;ids uuid[]:='{}';out_movement uuid;in_movement uuid;terms jsonb:=p_conversion_terms->'terms';begin
 select * into source from app_private.package_purchases where id=p_source_purchase_id;select * into target from app_private.package_purchases where id=p_target_purchase_id;
 if source.id is null or target.id is null or source.learner_id<>target.learner_id or source.purchase_state='cancelled' or target.purchase_state='cancelled' then raise exception 'STATE_CONFLICT';end if;
 perform app_private.package_assert_acyclic_transfer(source.id,target.id);
 if p_conversion_proposal_id is null and not app_private.package_transfer_compatible(source.contract_snapshot,target.contract_snapshot) then raise exception 'CONSENT_REQUIRED';end if;
 perform 1 from app_private.package_lots where purchase_id in(source.id,target.id) order by id for update;
 allocations:=app_private.package_allocate_available(source.id,p_credit_quanta,null);
 if p_conversion_proposal_id is not null and(p_conversion_terms->'allocations' is distinct from allocations or terms->>'source_package_id' is distinct from source.id::text or terms->>'new_contract_version_id' is distinct from target.contract_version_id::text or(terms->>'source_credit_quanta')::bigint<>p_credit_quanta) then raise exception 'VERSION_CONFLICT';end if;
 for allocation in select value from jsonb_array_elements(allocations) loop
  select * into lot from app_private.package_lots where id=(allocation->>'lot_id')::uuid;sourceq:=(allocation->>'credit_quanta')::bigint;amount:=(allocation->>'value_minor')::bigint;targetq:=sourceq;
  if p_conversion_proposal_id is not null then
   select value into mapping from jsonb_array_elements(terms->'lot_allocations') where value->>'lot_id'=lot.id::text;
   if mapping is null or(mapping->>'source_credit_quanta')::bigint<>sourceq or(mapping->>'value_minor')::bigint<>amount or(mapping->>'expires_at')::timestamptz is distinct from lot.expires_at then raise exception 'VERSION_CONFLICT';end if;
   targetq:=app_private.package_safe_integer(mapping->'target_credit_quanta',1);
   if targetq::numeric*(target.contract_snapshot->>'base_duration_minutes')::numeric>sourceq::numeric*lot.base_duration_minutes then raise exception 'VALIDATION_ERROR';end if;
  end if;
  child:=gen_random_uuid();transfer:=gen_random_uuid();
  insert into app_private.package_lots(id,purchase_id,learner_id,origin_kind,original_lot_id,source_lot_id,grant_policy_version_id,contract_version_id,eligibility_snapshot,base_duration_minutes,coverage_rule,expires_at,grant_source_id,balances) values(child,target.id,target.learner_id,'transfer',lot.original_lot_id,lot.id,lot.grant_policy_version_id,target.contract_version_id,target.contract_snapshot,(target.contract_snapshot->>'base_duration_minutes')::int,target.contract_snapshot->>'coverage_rule',lot.expires_at,transfer,app_private.package_empty_balance());
  insert into app_private.package_transfers(id,source_purchase_id,target_purchase_id,source_lot_id,target_lot_id,source_credit_quanta,target_credit_quanta,value_minor,currency,conversion_proposal_id,command_id) values(transfer,source.id,target.id,lot.id,child,sourceq,targetq,amount,'EGP',p_conversion_proposal_id,(p_context->>'command_id')::uuid);
  out_movement:=app_private.package_append_movement(lot.id,'transfer_out',jsonb_build_object('available_credit_quanta',-sourceq,'transferred_out_credit_quanta',sourceq,'available_value_minor',-amount,'transferred_out_value_minor',amount),jsonb_build_object('transfer_id',transfer,'credit_quanta',sourceq,'value_minor',amount,'from_bucket','available','to_bucket','transferred_out','customer_reason_code','same_learner_carryover'),p_context,'transfer-out:'||transfer);
  in_movement:=app_private.package_append_movement(child,'transfer_in',jsonb_build_object('transferred_in_credit_quanta',sourceq,'available_credit_quanta',sourceq,'transferred_in_value_minor',amount,'available_value_minor',amount),jsonb_build_object('transfer_id',transfer,'original_movement_id',out_movement,'credit_quanta',sourceq,'value_minor',amount,'from_bucket','transferred_in','to_bucket','available','customer_reason_code','same_learner_carryover'),p_context,'transfer-in:'||transfer);
  if targetq<>sourceq then perform app_private.package_append_movement(child,'adjust',jsonb_build_object('adjustment_credit_quanta',targetq-sourceq,'available_credit_quanta',targetq-sourceq),jsonb_build_object('transfer_id',transfer,'original_movement_id',in_movement,'credit_quanta',targetq-sourceq,'value_minor',0,'from_bucket','adjustment','to_bucket','available','customer_reason_code','accepted_duration_conversion'),p_context,'conversion:'||transfer);end if;
  if amount>0 then perform finance_private.finance_post_balanced('package-transfer:'||transfer,'package_transfer',transfer,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','deferred_package_obligation','learner_id',source.learner_id,'package_purchase_id',source.id,'lot_id',lot.id,'signed_minor',amount),jsonb_build_object('account_code','deferred_package_obligation','learner_id',target.learner_id,'package_purchase_id',target.id,'lot_id',child,'signed_minor',-amount)),p_context);end if;
  ids:=array_append(ids,transfer);total:=total+amount;
 end loop;
 perform app_private.package_balance(source.id);perform app_private.package_balance(target.id);if total>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 return jsonb_build_object('transfer_ids',ids,'transferred_credit_quanta',p_credit_quanta,'carrying_value_minor',total);
end $$;
create function app_private.package_lineage_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;context jsonb;envelope jsonb;view jsonb;contract jsonb;transfers jsonb:=jsonb_build_object('transfer_ids','[]'::jsonb,'transferred_credit_quanta',0,'carrying_value_minor',0);quantity bigint;acceptor uuid;accepted_at timestamptz:=now();charge uuid;resource uuid;version integer;result jsonb;proposal uuid:=(p_input->>'conversion_proposal_id')::uuid;begin
 perform set_config('response.status','200',true);
 select * into source from app_private.package_purchases where id=(p_input->>'package_id')::uuid;if source.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,source.learner_id,'payments',true);
 if p_name='transfer_package_credit' then
  select * into target from app_private.package_purchases where id=(p_input->>'target_package_id')::uuid;if target.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,target.learner_id,'payments',true);
  if target.learner_id<>source.learner_id then raise exception 'STATE_CONFLICT';end if;
  if length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 elsif p_name<>'renew_package' then raise exception 'VALIDATION_ERROR';end if;
 context:=app_private.package_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.package_lock_learner(source.learner_id);perform 1 from app_private.package_purchases where id in(source.id,target.id) order by id for update;
 select * into source from app_private.package_purchases where id=source.id; if source.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;if source.purchase_state='cancelled' then raise exception 'STATE_CONFLICT';end if;
 if p_name='renew_package' then
  quantity:=app_private.package_safe_integer(p_input->'transfer_credit_quanta');view:=app_private.package_contract_dto((p_input->>'new_contract_version_id')::uuid);contract:=view->'contract';
  if p_input->>'accepted_terms_hash' is distinct from view->>'terms_hash' then raise exception 'VERSION_CONFLICT';end if;
  if proposal is not null then envelope:=app_private.package_validate_conversion_proposal(proposal,actor,source.id,null,(p_input->>'new_contract_version_id')::uuid,quantity);acceptor:=(envelope->>'accepted_actor_account_id')::uuid;accepted_at:=(envelope->>'accepted_at')::timestamptz;
  else
   if not app_private.package_can_access(actor,source.learner_id) then raise exception 'CONSENT_REQUIRED';end if;acceptor:=actor;
   if quantity>0 and not app_private.package_transfer_compatible(source.contract_snapshot,contract) then raise exception 'CONSENT_REQUIRED';end if;
  end if;
  insert into app_private.package_purchases(learner_id,purchaser_account_id,contract_version_id,contract_snapshot,contract_hash,accepted_by,accepted_at,planned_credit_quanta,purchase_value_minor,currency,purchase_activation_rule) values(source.learner_id,acceptor,(p_input->>'new_contract_version_id')::uuid,contract,view->>'terms_hash',acceptor,accepted_at,(contract->>'grant_credit_quanta')::bigint,(contract->>'purchase_value_minor')::bigint,'EGP','full_settled_charge') returning * into target;
  charge:=finance_private.finance_issue_charge('package_purchase',target.learner_id,acceptor,target.id,null,target.contract_version_id,target.contract_hash,target.purchase_value_minor,context);
  update app_private.package_purchases set charge_id=charge where id=target.id;
  insert into app_private.package_purchase_acceptances(purchase_id,learner_id,actor_account_id,contract_hash,accepted_at) values(target.id,target.learner_id,acceptor,target.contract_hash,accepted_at);
  insert into app_private.package_renewals(source_purchase_id,target_purchase_id,command_id) values(source.id,target.id,(context->>'command_id')::uuid);
 else
  quantity:=app_private.package_safe_integer(p_input->'credit_quanta',1);select * into target from app_private.package_purchases where id=target.id;
  if target.version is distinct from(p_input->>'expected_target_version')::int then raise exception 'VERSION_CONFLICT';end if;
  if proposal is not null then envelope:=app_private.package_validate_conversion_proposal(proposal,actor,source.id,target.id,target.contract_version_id,quantity);end if;
 end if;
 if quantity>0 then transfers:=app_private.package_transfer_available(source.id,target.id,quantity,proposal,envelope,context);update app_private.package_purchases set version=version+1,updated_at=now() where id=target.id returning * into target;end if;
 update app_private.package_purchases set version=version+1,updated_at=now() where id=source.id returning * into source;
 if proposal is not null then perform app_private.package_commit_proposal(proposal,context);end if;
 if p_name='renew_package' then resource:=target.id;version:=target.version;result:=jsonb_build_object('successor_package_id',target.id,'transfer_ids',transfers->'transfer_ids','charge_id',charge);
 else resource:=source.id;version:=source.version;result:=jsonb_build_object('transfer_id',transfers#>>'{transfer_ids,0}','transferred_credit_quanta',quantity,'carrying_value_minor',transfers->'carrying_value_minor','target_package_version',target.version);end if;
 perform set_config('response.status','201',true);return app_private.package_finish(context,resource,version,result,p_name,jsonb_build_object('source_package_id',source.id,'target_package_id',target.id));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;
create function api.renew_package(p_package_id uuid,p_new_contract_version_id uuid,p_transfer_credit_quanta bigint,p_accepted_terms_hash text,p_conversion_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_lineage_command('renew_package',jsonb_build_object('package_id',p_package_id,'new_contract_version_id',p_new_contract_version_id,'transfer_credit_quanta',p_transfer_credit_quanta,'accepted_terms_hash',p_accepted_terms_hash,'conversion_proposal_id',p_conversion_proposal_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.transfer_package_credit(p_package_id uuid,p_target_package_id uuid,p_credit_quanta bigint,p_conversion_proposal_id uuid,p_reason text,p_expected_target_version integer,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_lineage_command('transfer_package_credit',jsonb_build_object('package_id',p_package_id,'target_package_id',p_target_package_id,'credit_quanta',p_credit_quanta,'conversion_proposal_id',p_conversion_proposal_id,'reason',p_reason,'expected_target_version',p_expected_target_version,'expected_version',p_expected_version),p_idempotency_key) $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and p.proname in('package_assert_acyclic_transfer','package_transfer_compatible','package_transfer_available','package_lineage_command')) or(n.nspname='api' and p.proname in('renew_package','transfer_package_credit')) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
