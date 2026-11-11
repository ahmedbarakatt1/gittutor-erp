grant create on schema app_private to git_tutor_commands;
create function app_private.package_credit_intent_scope(p_intent_id uuid,p_purchase_id uuid,p_source_credit_id uuid,p_credit_quanta bigint,p_value_minor bigint,p_policy_id uuid) returns app_private.credit_conversion_intents language plpgsql security definer set search_path='' as $$
declare i app_private.credit_conversion_intents%rowtype;p app_private.package_purchases%rowtype;l finance_private.customer_credit_lots%rowtype;begin
 select * into i from app_private.credit_conversion_intents where id=p_intent_id;select * into p from app_private.package_purchases where id=p_purchase_id;select * into l from finance_private.customer_credit_lots where id=p_source_credit_id;
 if i.id is null or p.id is null or l.id is null or i.source_credit_id is distinct from l.id or i.package_purchase_id is distinct from p.id or i.learner_id is distinct from p.learner_id or i.contract_terms_hash is distinct from p.contract_hash or i.credit_quanta is distinct from p_credit_quanta or i.carrying_value_minor is distinct from p_value_minor or i.grant_policy_version_id is distinct from p_policy_id or i.payer_binding_id is distinct from l.payer_binding_id or i.payer_account_id is distinct from l.payer_account_id then raise exception 'CONSENT_REQUIRED';end if;
 if not coalesce(app_private.payment_verified_account(i.payer_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.package_assert_scope(i.payer_account_id,i.learner_id,'payments');
 if not exists(select 1 from finance_private.incoming_transfers where id=l.transfer_id and current_payer_binding_id=i.payer_binding_id) then raise exception 'CONSENT_REQUIRED';end if;
 return i;
end $$;
create function app_private.package_lock_approved_credit_intent(p_source_credit_id uuid,p_learner_id uuid,p_value_minor bigint,p_credit_conversion_intent_id uuid,p_package_purchase_id uuid,p_credit_quanta bigint,p_grant_policy_version_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i app_private.credit_conversion_intents%rowtype;result jsonb;begin
 i:=app_private.package_credit_intent_scope(p_credit_conversion_intent_id,p_package_purchase_id,p_source_credit_id,p_credit_quanta,p_value_minor,p_grant_policy_version_id);
 select * into i from app_private.credit_conversion_intents where id=i.id for update;
 if i.learner_id is distinct from p_learner_id or i.state<>'authorized' or i.expires_at is null or i.expires_at<=now() then raise exception 'CONSENT_REQUIRED';end if;
 result:=finance_private.finance_lock_credit(p_source_credit_id,i.payer_account_id,p_value_minor,'package_grant',i.id,p_context,'credit-grant:'||i.id);
 return result||jsonb_build_object('credit_conversion_intent_id',i.id);
end $$;
create function app_private.package_approved_credit_command(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();i app_private.credit_conversion_intents%rowtype;p app_private.package_purchases%rowtype;l finance_private.customer_credit_lots%rowtype;policy app_private.package_grant_policy_versions%rowtype;context jsonb;credit jsonb;contract jsonb;scope jsonb;quantity bigint;amount bigint;lot_id uuid:=gen_random_uuid();movement_id uuid;application_id uuid;expiry timestamptz;version integer;begin
 perform app_private.require_role(actor,'admin');
 quantity:=app_private.package_safe_integer(p_input->'credit_quanta',1);amount:=app_private.package_safe_integer(p_input->'carrying_value_minor',1);
 if p_input->>'grant_kind' is distinct from 'approved_credit' or p_input->>'currency' is distinct from 'EGP' or length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 i:=app_private.package_credit_intent_scope((p_input->>'credit_conversion_intent_id')::uuid,(p_input->>'package_id')::uuid,(p_input->>'source_credit_id')::uuid,quantity,amount,(p_input->>'grant_policy_version_id')::uuid);
 context:=app_private.package_begin(actor,'approve_package_grant',p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 select * into p from app_private.package_purchases where id=i.package_purchase_id;select * into l from finance_private.customer_credit_lots where id=i.source_credit_id;
 scope:=finance_private.finance_discover_scope(array[p.charge_id],array[l.transfer_id],'{}','{}');perform app_private.booking_lock_financial_scope(scope);
 p:=app_private.package_lock_purchase(p.id);if p.version is distinct from(p_input->>'expected_version')::integer then raise exception 'VERSION_CONFLICT';end if;
 if p.purchase_state='cancelled' then raise exception 'STATE_CONFLICT';end if;
 select * into policy from app_private.package_grant_policy_versions where id=i.grant_policy_version_id;
 if policy.id is null or policy.status<>'approved' or policy.effective_at>now() or policy.content->>'valuation_rule'<>'reviewed_exact_source_credit' or policy.content->>'currency'<>'EGP' or not(policy.content->'eligible_package_contract_version_ids'?p.contract_version_id::text) or quantity>(policy.content->>'maximum_credit_quanta_per_grant')::numeric or amount>(policy.content->>'maximum_carrying_value_minor_per_grant')::numeric then raise exception 'POLICY_INCOMPLETE';end if;
 perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
 if p_input->>'evidence_file_id' is not null then raise exception 'EVIDENCE_REQUIRED';end if;
 credit:=app_private.package_lock_approved_credit_intent(l.id,p.learner_id,amount,i.id,p.id,quantity,policy.id,context);
 contract:=p.contract_snapshot;
 expiry:=case when contract->>'expiry_mode'='days_from_grant' then now()+interval '1 second'*((contract->>'expiry_days')::numeric*86400)::double precision else null end;
 if expiry is not null then perform app_private.booking_validate_times(now(),expiry);end if;
 insert into app_private.package_lots(id,purchase_id,learner_id,origin_kind,original_lot_id,grant_policy_version_id,contract_version_id,eligibility_snapshot,base_duration_minutes,coverage_rule,expires_at,grant_source_id,balances) values(lot_id,p.id,p.learner_id,'approved_credit',lot_id,policy.id,p.contract_version_id,contract,(contract->>'base_duration_minutes')::integer,contract->>'coverage_rule',expiry,i.id,app_private.package_empty_balance());
 movement_id:=app_private.package_append_movement(lot_id,'grant',jsonb_build_object('granted_credit_quanta',quantity,'available_credit_quanta',quantity,'granted_value_minor',amount,'available_value_minor',amount),jsonb_build_object('credit_quanta',quantity,'value_minor',amount,'to_bucket','available','customer_reason_code','approved_source_credit_conversion'),context,'credit-grant:'||lot_id);
 perform finance_private.finance_commit_credit((credit->>'credit_reservation_id')::uuid,'package_grant',lot_id,context);
 select id into application_id from finance_private.credit_applications where credit_reservation_id=(credit->>'credit_reservation_id')::uuid;
 perform finance_private.finance_post_balanced('credit-grant:'||lot_id,'approved_credit_package_grant',lot_id,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','unapplied_customer_funds','learner_id',p.learner_id,'package_purchase_id',p.id,'lot_id',lot_id,'transfer_id',l.transfer_id,'credit_lot_id',l.id,'signed_minor',amount),jsonb_build_object('account_code','deferred_package_obligation','learner_id',p.learner_id,'package_purchase_id',p.id,'lot_id',lot_id,'transfer_id',l.transfer_id,'credit_lot_id',l.id,'signed_minor',-amount)),context);
 insert into finance_private.package_funding_sources(purchase_id,original_lot_id,origin_kind,transfer_id,credit_application_id,amount_minor,command_id) values(p.id,lot_id,'approved_credit',l.transfer_id,application_id,amount,(context->>'command_id')::uuid);
 update app_private.credit_conversion_intents set state='consumed',consumed_grant_id=lot_id,version=credit_conversion_intents.version+1,updated_at=now() where id=i.id;
 update app_private.package_purchases set version=package_purchases.version+1,updated_at=now() where id=p.id returning package_purchases.version into version;
 perform set_config('response.status','201',true);
 return app_private.package_finish(context,p.id,version,jsonb_build_object('lot_id',lot_id,'grant_movement_id',movement_id),'approved_source_credit_granted',jsonb_build_object('package_purchase_id',p.id,'lot_id',lot_id,'credit_conversion_intent_id',i.id));
end $$;
create or replace function api.approve_package_grant(p_package_id uuid,p_credit_quanta bigint,p_carrying_value_minor bigint,p_currency text,p_grant_kind text,p_grant_policy_version_id uuid,p_source_credit_id uuid,p_reason text,p_evidence_file_id uuid,p_expected_version integer,p_idempotency_key text,p_credit_conversion_intent_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare args jsonb;begin
 if(p_grant_kind='approved_credit' and(p_credit_conversion_intent_id is null or p_source_credit_id is null or p_grant_policy_version_id is null or p_carrying_value_minor<=0)) or(p_grant_kind='complimentary' and p_credit_conversion_intent_id is not null) then raise exception 'VALIDATION_ERROR';end if;
 args:=jsonb_build_object('package_id',p_package_id,'credit_quanta',p_credit_quanta,'carrying_value_minor',p_carrying_value_minor,'currency',p_currency,'grant_kind',p_grant_kind,'grant_policy_version_id',p_grant_policy_version_id,'source_credit_id',p_source_credit_id,'reason',p_reason,'evidence_file_id',p_evidence_file_id,'expected_version',p_expected_version);
 if p_credit_conversion_intent_id is not null then args:=args||jsonb_build_object('credit_conversion_intent_id',p_credit_conversion_intent_id);end if;
 if p_grant_kind='approved_credit' then return app_private.package_approved_credit_command(args,p_idempotency_key);end if;
 return app_private.package_command('approve_package_grant',args,p_idempotency_key);
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in('package_credit_intent_scope','package_lock_approved_credit_intent','package_approved_credit_command') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';
