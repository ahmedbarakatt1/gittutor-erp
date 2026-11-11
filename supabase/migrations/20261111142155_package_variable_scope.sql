-- Explicit PL/pgSQL block labels for cache and charge local-variable qualification.
create or replace function app_private.package_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<package_command>>
declare actor uuid;context jsonb;purchase app_private.package_purchases%rowtype;policy app_private.package_grant_policy_versions%rowtype;contract jsonb;view jsonb;resource uuid:=gen_random_uuid();version integer:=1;result jsonb:='{}';lot_id uuid;movement_id uuid;charge_id uuid;quanta bigint;amount bigint;expiry timestamptz;lines jsonb;target uuid;begin
 actor:=app_private.require_actor();
 if p_name in('create_package_grant_policy','approve_package_grant_policy','approve_package_grant') then perform app_private.require_role(actor,'admin');
 elsif p_name='purchase_package' then perform app_private.package_assert_scope(actor,(p_input->>'learner_id')::uuid,'payments');
 else raise exception 'VALIDATION_ERROR';end if;
 context:=app_private.package_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_name='purchase_package' then
  view:=app_private.package_contract_dto((p_input->>'package_contract_version_id')::uuid);contract:=view->'contract';
  if p_input->>'accepted_terms_hash' is distinct from view->>'terms_hash' then raise exception 'VERSION_CONFLICT';end if;
  perform app_private.package_lock_learner((p_input->>'learner_id')::uuid);
  insert into app_private.package_purchases(id,learner_id,purchaser_account_id,contract_version_id,contract_snapshot,contract_hash,accepted_by,planned_credit_quanta,purchase_value_minor,currency,purchase_activation_rule) values(resource,(p_input->>'learner_id')::uuid,actor,(p_input->>'package_contract_version_id')::uuid,contract,view->>'terms_hash',actor,(contract->>'grant_credit_quanta')::bigint,(contract->>'purchase_value_minor')::bigint,'EGP','full_settled_charge') returning * into purchase;
  charge_id:=finance_private.finance_issue_charge('package_purchase',purchase.learner_id,actor,purchase.id,null,purchase.contract_version_id,purchase.contract_hash,purchase.purchase_value_minor,context);
  update app_private.package_purchases set charge_id=package_command.charge_id where id=purchase.id;
  insert into app_private.package_purchase_acceptances(purchase_id,learner_id,actor_account_id,contract_hash) values(purchase.id,purchase.learner_id,actor,purchase.contract_hash);
  result:=jsonb_build_object('package_purchase_id',purchase.id,'charge_id',charge_id);perform set_config('response.status','201',true);
 elsif p_name='create_package_grant_policy' then
  if cardinality(app_private.package_grant_policy_errors(p_input->'content'))>0 then raise exception 'VALIDATION_ERROR';end if;
  insert into app_private.package_grant_policy_versions(id,content,environment_scope,is_synthetic,created_by) values(resource,p_input->'content',case when app_private.catalog_environment() in('test','development') then 'development_test' else 'production' end,app_private.catalog_environment() in('test','development'),actor);
  result:=jsonb_build_object('grant_policy_version_id',resource,'validation_errors','[]'::jsonb);perform set_config('response.status','201',true);
 elsif p_name='approve_package_grant_policy' then
  select * into policy from app_private.package_grant_policy_versions where id=(p_input->>'grant_policy_version_id')::uuid for update;
  if policy.id is null then raise exception 'NOT_FOUND';end if;if policy.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;if policy.status<>'draft' then raise exception 'STATE_CONFLICT';end if;
  if length(btrim(coalesce(p_input->>'approval_note',''))) not between 1 and 2000 or p_input->>'effective_at' is null or not isfinite((p_input->>'effective_at')::timestamptz) then raise exception 'VALIDATION_ERROR';end if;
  perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
  for target in select value::uuid from jsonb_array_elements_text(policy.content->'eligible_package_contract_version_ids') loop perform app_private.package_contract_snapshot(target);end loop;
  update app_private.package_grant_policy_versions set status='approved',approved_by=actor,approved_at=now(),effective_at=(p_input->>'effective_at')::timestamptz,approval_note=p_input->>'approval_note',version=policy.version+1,updated_at=now() where id=policy.id returning package_grant_policy_versions.version into version;
  resource:=policy.id;result:=jsonb_build_object('state','approved');
 elsif p_name='approve_package_grant' then
  purchase:=app_private.package_lock_purchase((p_input->>'package_id')::uuid);resource:=purchase.id;
  if purchase.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;
  if purchase.purchase_state='cancelled' then raise exception 'STATE_CONFLICT';end if;
  quanta:=app_private.package_safe_integer(p_input->'credit_quanta',1);amount:=app_private.package_safe_integer(p_input->'carrying_value_minor');
  if p_input->>'currency' is distinct from 'EGP' or p_input->>'grant_kind' is null or p_input->>'grant_kind' not in('complimentary','approved_credit') or length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
  if p_input->>'grant_kind'='approved_credit' then if p_input->>'source_credit_id' is null then raise exception 'VALIDATION_ERROR';end if;raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  if p_input->>'source_credit_id' is not null then raise exception 'VALIDATION_ERROR';end if;
  if p_input->>'grant_policy_version_id' is null then
   select * into policy from app_private.package_grant_policy_versions where status='approved' and effective_at<=now() and content->>'valuation_rule'='zero_value' and content->'eligible_package_contract_version_ids'?purchase.contract_version_id::text;
   if not found or(select count(*) from app_private.package_grant_policy_versions where status='approved' and effective_at<=now() and content->>'valuation_rule'='zero_value' and content->'eligible_package_contract_version_ids'?purchase.contract_version_id::text)<>1 then raise exception 'POLICY_INCOMPLETE';end if;
  else select * into policy from app_private.package_grant_policy_versions where id=(p_input->>'grant_policy_version_id')::uuid for share;end if;
  if policy.id is null or policy.status<>'approved' or policy.effective_at>now() or not(policy.content->'eligible_package_contract_version_ids'?purchase.contract_version_id::text) or quanta>(policy.content->>'maximum_credit_quanta_per_grant')::numeric or amount>(policy.content->>'maximum_carrying_value_minor_per_grant')::numeric or(amount>0 and(policy.content->>'valuation_rule'<>'reviewed_exact_capped_subsidy' or p_input->>'grant_policy_version_id' is null)) then raise exception 'POLICY_INCOMPLETE';end if;
  perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
  if p_input->>'evidence_file_id' is not null then raise exception 'EVIDENCE_REQUIRED';end if;
  if amount>0 and not(policy.is_synthetic and app_private.catalog_environment() in('test','development')) then raise exception 'EVIDENCE_REQUIRED';end if;
  contract:=purchase.contract_snapshot;expiry:=case when contract->>'expiry_mode'='days_from_grant' then now()+interval '1 second'*((contract->>'expiry_days')::numeric*86400)::double precision else null end;
  if expiry is not null then perform app_private.booking_validate_times(now(),expiry);end if;
  lot_id:=gen_random_uuid();insert into app_private.package_lots(id,purchase_id,learner_id,origin_kind,original_lot_id,grant_policy_version_id,contract_version_id,eligibility_snapshot,base_duration_minutes,coverage_rule,expires_at,grant_source_id,balances) values(lot_id,purchase.id,purchase.learner_id,'complimentary',lot_id,policy.id,purchase.contract_version_id,contract,(contract->>'base_duration_minutes')::int,contract->>'coverage_rule',expiry,(context->>'command_id')::uuid,app_private.package_empty_balance());
  movement_id:=app_private.package_append_movement(lot_id,'grant',jsonb_build_object('granted_credit_quanta',quanta,'available_credit_quanta',quanta,'granted_value_minor',amount,'available_value_minor',amount),jsonb_build_object('credit_quanta',quanta,'value_minor',amount,'to_bucket','available','customer_reason_code','complimentary_bonus'),context,'grant:'||lot_id);
  if amount>0 then lines:=jsonb_build_array(jsonb_build_object('account_code','promotional_subsidy_expense','learner_id',purchase.learner_id,'package_purchase_id',purchase.id,'lot_id',lot_id,'signed_minor',amount),jsonb_build_object('account_code','deferred_package_obligation','learner_id',purchase.learner_id,'package_purchase_id',purchase.id,'lot_id',lot_id,'signed_minor',-amount));perform finance_private.finance_post_balanced('bonus:'||lot_id,'complimentary_subsidy',lot_id,'EGP',now(),lines,context);end if;
  update app_private.package_purchases set version=purchase.version+1,updated_at=now() where id=purchase.id returning package_purchases.version into version;
  perform app_private.package_balance(purchase.id);
  result:=jsonb_build_object('lot_id',lot_id,'grant_movement_id',movement_id);perform set_config('response.status','201',true);
 end if;
 return app_private.package_finish(context,resource,version,result,p_name,jsonb_build_object('package_purchase_id',case when purchase.id is not null then purchase.id else null end,'resource_id',resource));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;
create or replace function app_private.package_append_movement(p_lot_id uuid,p_kind text,p_delta jsonb,p_refs jsonb,p_context jsonb,p_line_key text) returns uuid language plpgsql security definer set search_path='' as $$
<<package_append_movement>>
declare lot app_private.package_lots%rowtype;previous app_private.entitlement_movements%rowtype;balances jsonb;key text;amount numeric;suffix text;left_total numeric;right_total numeric;id uuid:=gen_random_uuid();begin
 select * into lot from app_private.package_lots where package_lots.id=p_lot_id for update;if lot.id is null then raise exception 'NOT_FOUND';end if;
 if jsonb_typeof(p_delta) is distinct from 'object' or p_delta='{}' or(p_delta-(select array_agg(k) from jsonb_object_keys(app_private.package_empty_balance()) k))<>'{}' or jsonb_typeof(p_refs) is distinct from 'object' or(p_refs-array['enrollment_id','reservation_id','allocation_id','original_movement_id','transfer_id','credit_quanta','value_minor','from_bucket','to_bucket','customer_reason_code','effective_at'])<>'{}' then raise exception 'VALIDATION_ERROR';end if;
 select * into previous from app_private.entitlement_movements where command_id=(p_context->>'command_id')::uuid and line_key=p_line_key;
 if previous.id is not null then if previous.lot_id<>p_lot_id or previous.kind<>p_kind or previous.delta<>p_delta then raise exception 'IDEMPOTENCY_CONFLICT';end if;return previous.id;end if;
 balances:=lot.balances;
 for key in select jsonb_object_keys(p_delta) loop
  amount:=app_private.package_safe_integer(p_delta->key,-9007199254740991)+(balances->>key)::numeric;
  if abs(amount)>9007199254740991 or(key not like 'adjustment_%' and amount<0) then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;
  balances:=jsonb_set(balances,array[key],to_jsonb(amount));
 end loop;
 foreach suffix in array array['_credit_quanta','_value_minor'] loop
  left_total:=(balances->>('granted'||suffix))::numeric+(balances->>('transferred_in'||suffix))::numeric+(balances->>('adjustment'||suffix))::numeric;
  right_total:=(balances->>('available'||suffix))::numeric+(balances->>('reserved'||suffix))::numeric+(balances->>('consumed'||suffix))::numeric+(balances->>('expired'||suffix))::numeric+(balances->>('transferred_out'||suffix))::numeric;
  if left_total<>right_total then raise exception 'CONSERVATION_VIOLATION';end if;
 end loop;
 foreach key in array array['available','reserved','consumed','expired','transferred_out'] loop if(balances->>(key||'_credit_quanta'))::numeric=0 and(balances->>(key||'_value_minor'))::numeric<>0 then raise exception 'CONSERVATION_VIOLATION';end if;end loop;
 insert into app_private.entitlement_movements(id,lot_id,purchase_id,learner_id,kind,enrollment_id,reservation_id,allocation_id,original_movement_id,transfer_id,command_id,line_key,policy_version_id,delta,credit_quanta,value_minor,from_bucket,to_bucket,customer_reason_code,effective_at)
 values(id,lot.id,lot.purchase_id,lot.learner_id,p_kind,(p_refs->>'enrollment_id')::uuid,(p_refs->>'reservation_id')::uuid,(p_refs->>'allocation_id')::uuid,(p_refs->>'original_movement_id')::uuid,(p_refs->>'transfer_id')::uuid,(p_context->>'command_id')::uuid,p_line_key,lot.contract_version_id,p_delta,app_private.package_safe_integer(p_refs->'credit_quanta',case when p_kind='adjust' then -9007199254740991 else 0 end),app_private.package_safe_integer(p_refs->'value_minor',case when p_kind='adjust' then -9007199254740991 else 0 end),p_refs->>'from_bucket',p_refs->>'to_bucket',coalesce(p_refs->>'customer_reason_code',p_kind),coalesce((p_refs->>'effective_at')::timestamptz,now()));
 update app_private.package_lots set balances=package_append_movement.balances,version=version+1 where package_lots.id=lot.id;return id;
end $$;
notify pgrst,'reload schema';
