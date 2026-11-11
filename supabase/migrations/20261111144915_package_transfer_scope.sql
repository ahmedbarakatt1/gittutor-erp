-- Explicit result version leaves SQL aggregate column names unambiguous.
create or replace function app_private.package_lineage_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;context jsonb;envelope jsonb;view jsonb;contract jsonb;transfers jsonb:=jsonb_build_object('transfer_ids','[]'::jsonb,'transferred_credit_quanta',0,'carrying_value_minor',0);quantity bigint;acceptor uuid;accepted_at timestamptz:=now();charge uuid;resource uuid;result_version integer;result jsonb;proposal uuid:=(p_input->>'conversion_proposal_id')::uuid;begin
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
 if p_name='renew_package' then resource:=target.id;result_version:=target.version;result:=jsonb_build_object('successor_package_id',target.id,'transfer_ids',transfers->'transfer_ids','charge_id',charge);
 else resource:=source.id;result_version:=source.version;result:=jsonb_build_object('transfer_id',transfers#>>'{transfer_ids,0}','transferred_credit_quanta',quantity,'carrying_value_minor',transfers->'carrying_value_minor','target_package_version',target.version);end if;
 perform set_config('response.status','201',true);return app_private.package_finish(context,resource,result_version,result,p_name,jsonb_build_object('source_package_id',source.id,'target_package_id',target.id));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;
notify pgrst,'reload schema';
