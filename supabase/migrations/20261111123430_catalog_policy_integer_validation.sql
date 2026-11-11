-- Structural JSON accepts safe integers; semantic group limits return errors without int32 overflow.
create or replace function app_private.catalog_policy_errors(p_content jsonb,p_scope text,p_complete boolean default true,p_policy_id uuid default null,p_pricing jsonb default null)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare errors text[]:='{}'; k text; w jsonb; pack jsonb; expected numeric:=0; upper_bound numeric; is_unbounded boolean:=false; customer jsonb; compensation jsonb;
  common text[]:=array['offer_format','currency','pricing_unit','duration_minutes','customer_pricing_version','compensation_policy_version','hold_minutes','confirmation_deadline_minutes_before_start','deposit_basis_points','deposit_rounding','confirmation_funding_sources','customer_cancellation_windows','tutor_cancellation_compensation_rule','platform_or_tutor_cancellation_remedy','learner_no_show_rule','tutor_fee_for_delivered_session','individual_early_departure_rule','partial_class_remedy_rule','partial_class_rounding','allowed_refund_remedies','package_enabled'];
  group_fields text[]:=array['group_target_size','group_capacity','group_minimum_size','formation_failure_action','amendment_acceptance_rule','amendment_acceptance_minutes','latest_amendment_minutes_before_start','post_confirmation_dropout_price_guarantee','below_minimum_group_action'];
begin
  if not app_private.catalog_shape('policy_content',p_content) then return array['content']; end if;
  if not p_complete then return errors; end if;
  foreach k in array common loop if p_content->>k is null then errors:=array_append(errors,k); end if; end loop;
  if p_content->>'offer_format' is distinct from p_scope then errors:=array_append(errors,'offer_format'); end if;
  if p_content->>'customer_pricing_version' is distinct from p_content->>'compensation_policy_version' then errors:=array_append(errors,'compensation_policy_version'); end if;
  if p_scope='group' then
    foreach k in array group_fields loop if p_content->>k is null then errors:=array_append(errors,k); end if; end loop;
    if not coalesce((p_content->>'group_minimum_size')::numeric<=(p_content->>'group_target_size')::numeric and (p_content->>'group_target_size')::numeric<=(p_content->>'group_capacity')::numeric and (p_content->>'group_capacity')::numeric<=4,false) then errors:=array_append(errors,'group_capacity'); end if;
    if p_content->>'private_seat_price_minor' is not null or p_content->>'private_fee_rule' is not null then errors:=array_append(errors,'scope'); end if;
  else
    if p_content->>'private_seat_price_minor' is null then errors:=array_append(errors,'private_seat_price_minor'); end if;
    foreach k in array array['currency','fee_min_minor','fee_max_minor','exact_occurrence_approval_required'] loop if p_content#>>array['private_fee_rule',k] is null then errors:=array_append(errors,'private_fee_rule.'||k); end if; end loop;
    if (p_content#>>'{private_fee_rule,fee_min_minor}')::bigint>(p_content#>>'{private_fee_rule,fee_max_minor}')::bigint then errors:=array_append(errors,'private_fee_rule'); end if;
    foreach k in array group_fields loop if p_content->>k is not null then errors:=array_append(errors,'scope'); end if; end loop;
  end if;
  for w in select value from jsonb_array_elements(coalesce(nullif(p_content->'customer_cancellation_windows','null'),'[]')) order by (value->>'minimum_minutes_before_start')::numeric loop
    if is_unbounded or w->>'minimum_minutes_before_start' is null or (w->>'minimum_minutes_before_start')::numeric<>expected or w->>'refund_basis_points' is null or not(w?'maximum_minutes_before_start_exclusive') then errors:=array_append(errors,'customer_cancellation_windows'); end if;
    if w->'maximum_minutes_before_start_exclusive'='null'::jsonb then is_unbounded:=true;
    else upper_bound:=(w->>'maximum_minutes_before_start_exclusive')::numeric; if upper_bound is null or upper_bound<=expected then errors:=array_append(errors,'customer_cancellation_windows'); end if; expected:=upper_bound; end if;
  end loop;
  if not is_unbounded then errors:=array_append(errors,'customer_cancellation_windows'); end if;
  pack:=p_content->'package_contract';
  if p_content->>'package_enabled'='false' then
    if p_content->>'package_contract' is not null then errors:=array_append(errors,'package_contract'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(nullif(p_content->'confirmation_funding_sources','null'),'[]')) as f where f<>'verified_payment_allocation') then errors:=array_append(errors,'confirmation_funding_sources'); end if;
    if p_content->'allowed_refund_remedies'?'package_entitlement_restoration' then errors:=array_append(errors,'allowed_refund_remedies'); end if;
    if p_content->>'learner_no_show_rule'='retain_charge_consume_reserved_entitlement' then errors:=array_append(errors,'learner_no_show_rule'); end if;
  elsif p_content->>'package_enabled'='true' then
    foreach k in array array['package_policy_version_id','eligible_offer_ids','credit_quanta_per_session','grant_credit_quanta','base_duration_minutes','eligible_formats','purchase_value_minor','currency','coverage_rule','expiry_mode','expired_value_accounting_rule','restoration_expiry_rule','carryover_rule','rounding_rule','partial_consumption_rule','refund_remedy_rule'] loop if pack->>k is null then errors:=array_append(errors,'package_contract.'||k); end if; end loop;
    if p_policy_id is not null and pack->>'package_policy_version_id' is distinct from p_policy_id::text then errors:=array_append(errors,'package_contract.package_policy_version_id'); end if;
    if not coalesce(pack->'eligible_formats'?p_scope,false) then errors:=array_append(errors,'package_contract.eligible_formats'); end if;
    if pack->>'currency' is distinct from p_content->>'currency' then errors:=array_append(errors,'package_contract.currency'); end if;
    if (pack->>'expiry_mode'='days_from_grant' and pack->>'expiry_days' is null) or (pack->>'expiry_mode'='none' and pack->>'expiry_days' is not null) then errors:=array_append(errors,'package_contract.expiry_days'); end if;
    if pack->>'coverage_rule'='named_entitlement_covers_eligible_occurrence' then
      if not coalesce(p_content->'confirmation_funding_sources'?'reserved_named_package_entitlement',false) or p_content->'confirmation_funding_sources'?'reserved_eligible_package_value' then errors:=array_append(errors,'confirmation_funding_sources'); end if;
    else if not coalesce(p_content->'confirmation_funding_sources'?'reserved_eligible_package_value',false) or p_content->'confirmation_funding_sources'?'reserved_named_package_entitlement' then errors:=array_append(errors,'confirmation_funding_sources'); end if; end if;
  end if;
  if p_content->>'partial_class_remedy_rule'='approved_duration_proration' and p_content->>'partial_class_rounding' is distinct from 'largest_remainder_minor_unit' then errors:=array_append(errors,'partial_class_rounding'); end if;
  if p_pricing is not null then
    customer:=p_pricing->'customer_pricing'; compensation:=p_pricing->'compensation';
    if p_pricing->>'scope' is distinct from p_scope or p_pricing->>'pricing_version_id' is distinct from p_content->>'customer_pricing_version' then errors:=array_append(errors,'customer_pricing_version'); end if;
    foreach k in array array['currency','pricing_unit','duration_minutes'] loop if customer->k is distinct from p_content->k then errors:=array_append(errors,k); end if; end loop;
    if p_scope='private' then
      if p_content->'private_seat_price_minor' is distinct from customer->'private_seat_price_minor' then errors:=array_append(errors,'private_seat_price_minor'); end if;
      if p_content->'private_fee_rule' is distinct from compensation->'private_fee_rule' then errors:=array_append(errors,'private_fee_rule'); end if;
    end if;
    errors:=errors||app_private.catalog_pricing_errors(customer,compensation,p_scope,true);
  end if;
  return errors;
end $$;

revoke all on function app_private.catalog_policy_errors(jsonb,text,boolean,uuid,jsonb) from public,anon,authenticated,service_role,git_tutor_worker;
notify pgrst,'reload schema';
