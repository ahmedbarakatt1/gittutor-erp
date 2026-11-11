-- T03: immutable commercial versions, separately privileged compensation, explicit public projections.
create extension if not exists pg_jsonschema with schema extensions;
grant usage on schema finance_private to git_tutor_commands;
grant create on schema api,app_private,finance_private to git_tutor_commands;
grant select(environment,fixture_marker) on app_private.environment_metadata to git_tutor_commands;
create policy catalog_environment_read on app_private.environment_metadata for select to git_tutor_commands using(true);

create table app_private.catalog_validation_schemas (
  id uuid primary key default gen_random_uuid(), schema_version integer not null unique, document jsonb not null
);
insert into app_private.catalog_validation_schemas(schema_version,document) values(1,'{"schema_version":1,"policy_content":{"type":"object","properties":{"offer_format":{"anyOf":[{"enum":["private","group"]},{"type":"null"}]},"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"pricing_unit":{"anyOf":[{"enum":["per_occurrence"]},{"type":"null"}]},"duration_minutes":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"customer_pricing_version":{"anyOf":[{"type":"string","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"},{"type":"null"}]},"compensation_policy_version":{"anyOf":[{"type":"string","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"},{"type":"null"}]},"private_seat_price_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"private_fee_rule":{"anyOf":[{"type":"object","properties":{"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"fee_min_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"fee_max_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"exact_occurrence_approval_required":{"anyOf":[{"const":true},{"type":"null"}]}},"additionalProperties":false},{"type":"null"}]},"group_target_size":{"anyOf":[{"enum":[2,3,4]},{"type":"null"}]},"group_capacity":{"anyOf":[{"type":"integer","minimum":2,"maximum":9007199254740991},{"type":"null"}]},"group_minimum_size":{"anyOf":[{"type":"integer","minimum":2,"maximum":9007199254740991},{"type":"null"}]},"hold_minutes":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"confirmation_deadline_minutes_before_start":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"formation_failure_action":{"anyOf":[{"enum":["offer_revised_quote_or_cancel","cancel_and_resolve_funding"]},{"type":"null"}]},"deposit_basis_points":{"anyOf":[{"type":"integer","minimum":0,"maximum":10000},{"type":"null"}]},"deposit_rounding":{"anyOf":[{"enum":["ceiling_minor_unit","floor_minor_unit","half_up_minor_unit"]},{"type":"null"}]},"confirmation_funding_sources":{"anyOf":[{"type":"array","items":{"enum":["verified_payment_allocation","reserved_named_package_entitlement","reserved_eligible_package_value"]},"minItems":1,"uniqueItems":true},{"type":"null"}]},"amendment_acceptance_rule":{"anyOf":[{"enum":["all_affected_authorized_bookers_and_assigned_tutor"]},{"type":"null"}]},"amendment_acceptance_minutes":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"latest_amendment_minutes_before_start":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"post_confirmation_dropout_price_guarantee":{"anyOf":[{"type":"boolean"},{"type":"null"}]},"below_minimum_group_action":{"anyOf":[{"enum":["admin_proposal_with_customer_acceptance"]},{"type":"null"}]},"customer_cancellation_windows":{"anyOf":[{"type":"array","items":{"type":"object","properties":{"minimum_minutes_before_start":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"maximum_minutes_before_start_exclusive":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"refund_basis_points":{"anyOf":[{"type":"integer","minimum":0,"maximum":10000},{"type":"null"}]}},"additionalProperties":false},"minItems":1,"uniqueItems":true},{"type":"null"}]},"tutor_cancellation_compensation_rule":{"anyOf":[{"enum":["reviewed_exact_adjustment"]},{"type":"null"}]},"platform_or_tutor_cancellation_remedy":{"anyOf":[{"enum":["full_customer_value_resolution"]},{"type":"null"}]},"learner_no_show_rule":{"anyOf":[{"enum":["retain_charge","retain_charge_consume_reserved_entitlement","reviewed_resolution"]},{"type":"null"}]},"tutor_fee_for_delivered_session":{"anyOf":[{"enum":["agreed_fee_subject_to_approved_adjustments"]},{"type":"null"}]},"individual_early_departure_rule":{"anyOf":[{"enum":["attendance_fact_with_reviewed_remedy","retain_charge_if_class_fully_delivered"]},{"type":"null"}]},"partial_class_remedy_rule":{"anyOf":[{"enum":["reviewed_exact_adjustment","approved_duration_proration"]},{"type":"null"}]},"partial_class_rounding":{"anyOf":[{"enum":["largest_remainder_minor_unit","reviewed_integer_amount"]},{"type":"null"}]},"allowed_refund_remedies":{"anyOf":[{"type":"array","items":{"enum":["cash_refund","monetary_account_credit","package_entitlement_restoration"]},"minItems":1,"uniqueItems":true},{"type":"null"}]},"package_enabled":{"anyOf":[{"type":"boolean"},{"type":"null"}]},"package_contract":{"anyOf":[{"type":"object","properties":{"package_policy_version_id":{"anyOf":[{"type":"string","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"},{"type":"null"}]},"eligible_offer_ids":{"anyOf":[{"type":"array","items":{"type":"string","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"},"minItems":1,"uniqueItems":true},{"type":"null"}]},"credit_quanta_per_session":{"anyOf":[{"const":1000},{"type":"null"}]},"grant_credit_quanta":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"base_duration_minutes":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"eligible_formats":{"anyOf":[{"type":"array","items":{"enum":["private","group"]},"minItems":1,"uniqueItems":true},{"type":"null"}]},"purchase_value_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"coverage_rule":{"anyOf":[{"enum":["named_entitlement_covers_eligible_occurrence","allocated_value_with_explicit_top_up"]},{"type":"null"}]},"expiry_mode":{"anyOf":[{"enum":["none","days_from_grant"]},{"type":"null"}]},"expiry_days":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"expired_value_accounting_rule":{"anyOf":[{"enum":["reviewed_contractual_resolution"]},{"type":"null"}]},"restoration_expiry_rule":{"anyOf":[{"enum":["preserve_original_lot_terms"]},{"type":"null"}]},"carryover_rule":{"anyOf":[{"enum":["transfer_available_units_and_actual_value"]},{"type":"null"}]},"rounding_rule":{"anyOf":[{"enum":["largest_remainder_batches_and_final_residual_sequentially"]},{"type":"null"}]},"partial_consumption_rule":{"anyOf":[{"enum":["reviewed_exact_credit_quanta_and_value"]},{"type":"null"}]},"refund_remedy_rule":{"anyOf":[{"enum":["exclusive_or_value_bounded_split_of_cash_credit_restoration"]},{"type":"null"}]}},"additionalProperties":false},{"type":"null"}]}},"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"},"customer_pricing":{"type":"object","properties":{"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"pricing_unit":{"anyOf":[{"enum":["per_occurrence"]},{"type":"null"}]},"duration_minutes":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"group_tiers":{"anyOf":[{"type":"array","items":{"type":"object","properties":{"tier_id":{"anyOf":[{"enum":["group_2","group_3","group_4"]},{"type":"null"}]},"group_size":{"anyOf":[{"enum":[2,3,4]},{"type":"null"}]},"seat_price_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"additionalProperties":false},"minItems":1,"uniqueItems":true},{"type":"null"}]},"private_seat_price_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"},"compensation":{"type":"object","properties":{"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"group_fee_bands":{"anyOf":[{"type":"array","items":{"type":"object","properties":{"tier_id":{"anyOf":[{"enum":["group_2","group_3","group_4"]},{"type":"null"}]},"fee_min_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"fee_max_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"additionalProperties":false},"minItems":1,"uniqueItems":true},{"type":"null"}]},"private_fee_rule":{"anyOf":[{"type":"object","properties":{"currency":{"anyOf":[{"enum":["EGP"]},{"type":"null"}]},"fee_min_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"fee_max_minor":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"exact_occurrence_approval_required":{"anyOf":[{"const":true},{"type":"null"}]}},"additionalProperties":false},{"type":"null"}]}},"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}}'::jsonb);
create table app_private.pricing_versions (
  id uuid primary key default gen_random_uuid(), scope text not null check(scope in ('private','group')),
  status text not null default 'draft' check(status in ('draft','approved','published','retired')),
  customer_pricing jsonb not null, schema_version integer not null default 1 references app_private.catalog_validation_schemas(schema_version),
  environment_scope text not null check(environment_scope in ('development_test','production')), is_synthetic boolean not null,
  content_hash text not null, source_manifest_version text,
  created_by uuid not null references app_private.accounts(id), approved_by uuid references app_private.accounts(id), approved_at timestamptz, effective_at timestamptz,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table finance_private.pricing_compensation (
  pricing_version_id uuid primary key references app_private.pricing_versions(id), content jsonb not null
);
create table app_private.policy_versions (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind='booking'), scope text not null check(scope in ('private','group')),
  status text not null default 'draft' check(status in ('draft','approved','published','retired')), content jsonb not null,
  pricing_version_id uuid references app_private.pricing_versions(id), schema_version integer not null default 1 references app_private.catalog_validation_schemas(schema_version),
  environment_scope text not null check(environment_scope in ('development_test','production')), is_synthetic boolean not null,
  content_hash text not null, source_manifest_version text,
  created_by uuid not null references app_private.accounts(id), approved_by uuid references app_private.accounts(id), approved_at timestamptz, effective_at timestamptz,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table finance_private.policy_compensation_terms (
  policy_version_id uuid primary key references app_private.policy_versions(id), content jsonb not null
);
create table app_private.offers (
  id uuid primary key default gen_random_uuid(), subject_id uuid not null references app_private.subjects(id),
  format text not null check(format in ('private','group')), duration_minutes integer not null check(duration_minutes>0),
  capacity integer not null check(capacity between 1 and 4), target_tier integer,
  pricing_version_id uuid not null references app_private.pricing_versions(id), policy_version_id uuid not null references app_private.policy_versions(id),
  status text not null default 'draft' check(status in ('draft','published','retired')), published_at timestamptz, effective_at timestamptz,
  created_by uuid not null references app_private.accounts(id), version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((format='private' and capacity=1 and target_tier is null) or (format='group' and target_tier between 2 and 4 and target_tier<=capacity))
);
create index offers_catalog on app_private.offers(status,created_at desc,id desc);
create index offers_policy on app_private.offers(policy_version_id);
create index offers_pricing on app_private.offers(pricing_version_id);
create index policy_pricing on app_private.policy_versions(pricing_version_id);

do $$ declare t text; s text; begin
  foreach s in array array['app_private','finance_private'] loop
    foreach t in array case when s='app_private' then array['catalog_validation_schemas','pricing_versions','policy_versions','offers'] else array['pricing_compensation','policy_compensation_terms'] end loop
      execute format('alter table %I.%I enable row level security',s,t);
      execute format('revoke all on %I.%I from public,anon,authenticated,git_tutor_worker',s,t);
      execute format('grant select,insert,update on %I.%I to git_tutor_commands',s,t);
      execute format('create policy catalog_commands on %I.%I to git_tutor_commands using(true) with check(true)',s,t);
    end loop;
  end loop;
end $$;
revoke insert,update on app_private.catalog_validation_schemas from git_tutor_commands;

create function app_private.catalog_immutable() returns trigger language plpgsql set search_path='' as $$
declare state text; begin
  if tg_table_schema='finance_private' then
    if tg_table_name='pricing_compensation' then select status into state from app_private.pricing_versions where id=old.pricing_version_id;
    else select status into state from app_private.policy_versions where id=old.policy_version_id; end if;
    if state<>'draft' then raise exception 'IMMUTABLE_VERSION'; end if;
  elsif old.status<>'draft' then
    if tg_op='DELETE' or (to_jsonb(new)-array['status','version','updated_at']) is distinct from (to_jsonb(old)-array['status','version','updated_at'])
      or not ((old.status='approved' and new.status='published') or (old.status='published' and new.status='retired')) then raise exception 'IMMUTABLE_VERSION'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger pricing_immutable before update or delete on app_private.pricing_versions for each row execute function app_private.catalog_immutable();
create trigger policy_immutable before update or delete on app_private.policy_versions for each row execute function app_private.catalog_immutable();
create trigger offer_immutable before update or delete on app_private.offers for each row execute function app_private.catalog_immutable();
create trigger compensation_immutable before update or delete on finance_private.pricing_compensation for each row execute function app_private.catalog_immutable();
create trigger policy_compensation_immutable before update or delete on finance_private.policy_compensation_terms for each row execute function app_private.catalog_immutable();

create function app_private.catalog_environment() returns text language plpgsql stable security definer set search_path='' as $$
declare e text; m text; begin
  select environment,fixture_marker into e,m from app_private.environment_metadata;
  if e not in ('production','staging','test','development') or e is null then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
  if e in ('test','development') and m is distinct from 'git-tutor-supabase-local-v1' then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
  return e;
end $$;
create function app_private.assert_catalog_publication(p_environment text,p_scope text,p_synthetic boolean) returns void language plpgsql immutable set search_path='' as $$
begin
  if p_environment is null or p_scope is null or p_synthetic is null or not (
    (p_environment in ('test','development') and p_scope='development_test' and p_synthetic)
    or (p_environment in ('production','staging') and p_scope='production' and not p_synthetic)) then raise exception 'POLICY_INCOMPLETE'; end if;
end $$;
create function app_private.catalog_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;
create function app_private.catalog_shape(p_kind text,p_value jsonb) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(extensions.jsonb_matches_schema((document->p_kind)::json,p_value),false) from app_private.catalog_validation_schemas where schema_version=1
$$;
create function app_private.catalog_pricing_errors(p_customer jsonb,p_compensation jsonb,p_scope text,p_complete boolean default true) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare errors text[]:='{}'; k text; item jsonb; begin
  if not app_private.catalog_shape('customer_pricing',p_customer) then errors:=array_append(errors,'customer_pricing'); end if;
  if not app_private.catalog_shape('compensation',p_compensation) then errors:=array_append(errors,'compensation'); end if;
  if cardinality(errors)>0 or not p_complete then return errors; end if;
  foreach k in array array['currency','pricing_unit','duration_minutes'] loop if p_customer->>k is null then errors:=array_append(errors,'customer_pricing.'||k); end if; end loop;
  if p_compensation->>'currency' is null then errors:=array_append(errors,'compensation.currency'); end if;
  if p_scope='private' then
    if p_customer->>'private_seat_price_minor' is null then errors:=array_append(errors,'customer_pricing.private_seat_price_minor'); end if;
    foreach k in array array['currency','fee_min_minor','fee_max_minor','exact_occurrence_approval_required'] loop
      if p_compensation#>>array['private_fee_rule',k] is null then errors:=array_append(errors,'compensation.private_fee_rule.'||k); end if;
    end loop;
    if (p_compensation#>>'{private_fee_rule,fee_min_minor}')::bigint>(p_compensation#>>'{private_fee_rule,fee_max_minor}')::bigint then errors:=array_append(errors,'compensation.private_fee_rule'); end if;
    if p_customer->>'group_tiers' is not null or p_compensation->>'group_fee_bands' is not null then errors:=array_append(errors,'scope'); end if;
  elsif p_scope='group' then
    if jsonb_array_length(coalesce(nullif(p_customer->'group_tiers','null'),'[]'))<>3 or (select count(distinct value->>'tier_id') from jsonb_array_elements(coalesce(nullif(p_customer->'group_tiers','null'),'[]')))<>3
      or (select count(distinct value->>'group_size') from jsonb_array_elements(coalesce(nullif(p_customer->'group_tiers','null'),'[]')))<>3 then errors:=array_append(errors,'customer_pricing.group_tiers'); end if;
    for item in select value from jsonb_array_elements(coalesce(nullif(p_customer->'group_tiers','null'),'[]')) loop
      if item->>'tier_id' is null or item->>'group_size' is null or item->>'seat_price_minor' is null or item->>'tier_id'<>('group_'||(item->>'group_size'))
        or (item->>'group_size')::numeric*(item->>'seat_price_minor')::numeric>9007199254740991 then errors:=array_append(errors,'customer_pricing.group_tiers'); end if;
    end loop;
    if jsonb_array_length(coalesce(nullif(p_compensation->'group_fee_bands','null'),'[]'))<>3 or (select count(distinct value->>'tier_id') from jsonb_array_elements(coalesce(nullif(p_compensation->'group_fee_bands','null'),'[]')))<>3 then errors:=array_append(errors,'compensation.group_fee_bands'); end if;
    for item in select value from jsonb_array_elements(coalesce(nullif(p_compensation->'group_fee_bands','null'),'[]')) loop
      if item->>'tier_id' is null or item->>'fee_min_minor' is null or item->>'fee_max_minor' is null or (item->>'fee_min_minor')::bigint>(item->>'fee_max_minor')::bigint then errors:=array_append(errors,'compensation.group_fee_bands'); end if;
    end loop;
    if p_customer->>'private_seat_price_minor' is not null or p_compensation->>'private_fee_rule' is not null then errors:=array_append(errors,'scope'); end if;
  else errors:=array_append(errors,'scope'); end if;
  return errors;
end $$;

create function app_private.catalog_policy_errors(p_content jsonb,p_scope text,p_complete boolean default true,p_policy_id uuid default null,p_pricing jsonb default null)
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
    if not coalesce((p_content->>'group_minimum_size')::int<=(p_content->>'group_target_size')::int and (p_content->>'group_target_size')::int<=(p_content->>'group_capacity')::int and (p_content->>'group_capacity')::int<=4,false) then errors:=array_append(errors,'group_capacity'); end if;
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

create function app_private.policy_content(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select p.content||f.content from app_private.policy_versions p join finance_private.policy_compensation_terms f on f.policy_version_id=p.id where p.id=p_id
$$;
create function app_private.customer_policy_summary(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each((select content from app_private.policy_versions where id=p_id))
  where key=any(array['offer_format','currency','pricing_unit','duration_minutes','customer_pricing_version','private_seat_price_minor','group_target_size','group_capacity','group_minimum_size','hold_minutes','confirmation_deadline_minutes_before_start','formation_failure_action','deposit_basis_points','deposit_rounding','confirmation_funding_sources','amendment_acceptance_rule','amendment_acceptance_minutes','latest_amendment_minutes_before_start','post_confirmation_dropout_price_guarantee','below_minimum_group_action','customer_cancellation_windows','platform_or_tutor_cancellation_remedy','learner_no_show_rule','individual_early_departure_rule','partial_class_remedy_rule','partial_class_rounding','allowed_refund_remedies','package_enabled','package_contract'])
$$;

create function app_private.catalog_command(p_name text,p_args jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid; command uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid(); resource_version integer:=1; digest text; saved app_private.command_results%rowtype;
  env text; scope_name text; content jsonb; customer jsonb; compensation jsonb; errors text[]; result jsonb:='{}'; action text;
  price app_private.pricing_versions%rowtype; policy app_private.policy_versions%rowtype; offer app_private.offers%rowtype;
  tutor app_private.tutors%rowtype; profile app_private.tutor_profile_versions%rowtype; private_keys text[]:=array['private_fee_rule','tutor_cancellation_compensation_rule','tutor_fee_for_delivered_session'];
  private_content jsonb; pricing_json jsonb; effective timestamptz; k text;
begin
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
  if found then if saved.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if; return saved.result; end if;
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
    result:=jsonb_build_object('pricing_version_id',resource,'validation_errors',to_jsonb(errors));
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
    result:=jsonb_build_object('policy_version_id',resource,'validation_errors',to_jsonb(errors));
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
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;

create function app_private.catalog_offer_dto(p_id uuid,p_admin boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.offers%rowtype; s app_private.subjects%rowtype; customer jsonb; base jsonb; summary jsonb; seat bigint; begin
  select * into o from app_private.offers where id=p_id; select * into s from app_private.subjects where id=o.subject_id;
  base:=jsonb_build_object('offer_id',o.id,'title',s.title||case when o.format='private' then ' · Private tuition' else ' · Group of '||o.target_tier::text end,
    'subject',jsonb_build_object('subject_id',s.id,'title',s.title,'slug',s.slug),'format',o.format,'duration_minutes',o.duration_minutes,'capacity',o.capacity,'target_tier',o.target_tier,'pricing_version_id',o.pricing_version_id,'policy_version_id',o.policy_version_id);
  if p_admin then return base||jsonb_build_object('status',o.status,'version',o.version,'published_at',o.published_at,'effective_at',o.effective_at); end if;
  select customer_pricing into customer from app_private.pricing_versions where id=o.pricing_version_id;
  if o.format='private' then seat:=(customer->>'private_seat_price_minor')::bigint;
  else select (value->>'seat_price_minor')::bigint into seat from jsonb_array_elements(customer->'group_tiers') where (value->>'group_size')::int=o.target_tier; end if;
  summary:=app_private.customer_policy_summary(o.policy_version_id);
  return base||jsonb_build_object('seat_price_minor',seat,'currency',customer->>'currency','policy_summary',summary,
    'customer_terms_hash',app_private.catalog_hash(jsonb_build_object('seat_price_minor',seat,'currency',customer->>'currency','duration_minutes',o.duration_minutes,'target_tier',o.target_tier,'policy_summary',summary)),
    'availability',jsonb_build_object('scheduled_occurrences',0,'next_start_at',null));
end $$;

create function app_private.catalog_admin_policy_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('policy_version_id',p.id,'kind',p.kind,'scope',p.scope,'status',p.status,'content',app_private.policy_content(p.id),'version',p.version,
    'environment_scope',p.environment_scope,'is_synthetic',p.is_synthetic,'approved_by',p.approved_by,'approved_at',p.approved_at,'effective_at',p.effective_at,'content_hash',p.content_hash,
    'validation_errors',to_jsonb(app_private.catalog_policy_errors(app_private.policy_content(p.id),p.scope,true,p.id))) from app_private.policy_versions p where p.id=p_id
$$;
create function app_private.catalog_admin_pricing_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pricing_version_id',p.id,'scope',p.scope,'status',p.status,'customer_pricing',p.customer_pricing,'compensation',f.content,'version',p.version,
    'environment_scope',p.environment_scope,'is_synthetic',p.is_synthetic,'approved_by',p.approved_by,'approved_at',p.approved_at,'effective_at',p.effective_at,'content_hash',p.content_hash,
    'validation_errors',to_jsonb(app_private.catalog_pricing_errors(p.customer_pricing,f.content,p.scope,true))) from app_private.pricing_versions p join finance_private.pricing_compensation f on f.pricing_version_id=p.id where p.id=p_id
$$;
create function app_private.catalog_admin_tutor_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tutor_id',t.id,'account_id',t.account_id,'display_name',coalesce(d.display_name,p.display_name,person.display_name),
    'contact_verified',exists(select 1 from app_private.verified_contacts where id=t.contact_id and revoked_at is null and verified_at is not null),
    'approved_profile_version_id',t.approved_profile_version_id,'draft_profile_version_id',t.draft_profile_version_id,'version',t.version,'approved_subject_ids',coalesce(to_jsonb(p.subject_ids),'[]'),
    'profile_versions',coalesce((select jsonb_agg(jsonb_build_object('profile_version_id',v.id,'version',v.version,'display_name',v.display_name,'bio',v.bio,'subject_ids',v.subject_ids,'state',v.state) order by v.version desc) from app_private.tutor_profile_versions v where v.tutor_id=t.id),'[]'))
  from app_private.tutors t join app_private.accounts a on a.id=t.account_id join app_private.people person on person.id=a.person_id
  left join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id left join app_private.tutor_profile_versions d on d.id=t.draft_profile_version_id where t.id=p_id
$$;

create function app_private.catalog_read_page(p_kind text,p_filters jsonb,p_cursor text,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; items jsonb; next_cursor text:=null; after_time timestamptz; after_id uuid; scope_name text; actor uuid; env text; begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_kind<>'public_offers' then actor:=app_private.require_actor(); perform app_private.require_role(actor,'admin'); end if;
  if p_cursor is not null then
    if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR'; end if;
    after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
  end if;
  scope_name:=coalesce(p_filters->>'format',p_filters->>'scope');
  if scope_name is not null and scope_name not in ('group','private') then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'status' is not null and p_filters->>'status' not in ('draft','approved','published','retired') then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'kind' is not null and p_filters->>'kind'<>'booking' then raise exception 'VALIDATION_ERROR'; end if;
  if p_filters->>'from' is not null and p_filters->>'to' is not null and (p_filters->>'from')::timestamptz>(p_filters->>'to')::timestamptz then raise exception 'INVALID_TIME'; end if;
  if p_kind in ('public_offers','offers') then
    if p_kind='public_offers' then env:=app_private.catalog_environment(); end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_offer_dto(x.id,p_kind='offers')) order by x.created_at desc,x.id desc),'[]') into rows from (
      select o.* from app_private.offers o join app_private.subjects s on s.id=o.subject_id join app_private.policy_versions p on p.id=o.policy_version_id
      where (scope_name is null or o.format=scope_name) and (p_filters->>'status' is null or o.status=p_filters->>'status')
        and (p_filters->>'offer_id' is null or o.id=(p_filters->>'offer_id')::uuid) and (p_filters->>'subject_id' is null or o.subject_id=(p_filters->>'subject_id')::uuid)
        and (p_cursor is null or (o.created_at,o.id)<(after_time,after_id))
        and (p_kind='offers' or (o.status='published' and o.effective_at<=now() and s.active and p.status='published'
          and p.environment_scope=case when env in ('test','development') then 'development_test' else 'production' end
          and p.is_synthetic=(env in ('test','development'))
          -- T03 has no scheduled occurrences. Date-filtered availability is empty until T04 supplies it.
          and p_filters->>'from' is null and p_filters->>'to' is null))
      order by o.created_at desc,o.id desc limit p_limit+1
    ) x;
  elsif p_kind='policies' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_policy_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select p.* from app_private.policy_versions p where (scope_name is null or p.scope=scope_name) and (p_filters->>'status' is null or p.status=p_filters->>'status') and (p_cursor is null or (p.created_at,p.id)<(after_time,after_id)) order by p.created_at desc,p.id desc limit p_limit+1
    ) x;
  elsif p_kind='pricing' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_pricing_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select p.* from app_private.pricing_versions p where (scope_name is null or p.scope=scope_name) and (p_filters->>'status' is null or p.status=p_filters->>'status') and (p_cursor is null or (p.created_at,p.id)<(after_time,after_id)) order by p.created_at desc,p.id desc limit p_limit+1
    ) x;
  elsif p_kind='tutors' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.catalog_admin_tutor_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from (
      select t.* from app_private.tutors t left join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id
      where (p_filters->>'subject_id' is null or (p_filters->>'subject_id')::uuid=any(p.subject_ids))
        and (p_filters->>'active' is null or app_private.has_role(t.account_id,'tutor')=(p_filters->>'active')::boolean)
        and (p_cursor is null or (t.created_at,t.id)<(after_time,after_id)) order by t.created_at desc,t.id desc limit p_limit+1
    ) x;
  else raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(jsonb_agg(value->'data' order by ordinality),'[]') into items from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit;
  if jsonb_array_length(rows)>p_limit then next_cursor:=(rows->(p_limit-1)->>'at')||'|'||(rows->(p_limit-1)->>'id'); end if;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;

create function api.list_public_offers(p_subject_id uuid default null,p_format text default null,p_from timestamptz default null,p_to timestamptz default null,p_offer_id uuid default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$ select app_private.catalog_read_page('public_offers',jsonb_build_object('subject_id',p_subject_id,'format',p_format,'from',p_from,'to',p_to,'offer_id',p_offer_id),p_cursor,p_limit) $$;
create function api.list_policies(p_kind text default null,p_scope text default null,p_status text default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$ select app_private.catalog_read_page('policies',jsonb_build_object('kind',p_kind,'scope',p_scope,'status',p_status),p_cursor,p_limit) $$;
create function api.list_pricing_versions(p_format text default null,p_status text default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$ select app_private.catalog_read_page('pricing',jsonb_build_object('format',p_format,'status',p_status),p_cursor,p_limit) $$;
create function api.list_admin_offers(p_format text default null,p_status text default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$ select app_private.catalog_read_page('offers',jsonb_build_object('format',p_format,'status',p_status),p_cursor,p_limit) $$;
create function api.list_admin_tutors(p_subject_id uuid default null,p_active boolean default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language sql security definer set search_path='' as $$ select app_private.catalog_read_page('tutors',jsonb_build_object('subject_id',p_subject_id,'active',p_active),p_cursor,p_limit) $$;
create function api.get_public_tutor(p_tutor_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
  select jsonb_build_object('tutor_id',t.id,'display_name',p.display_name,'bio',p.bio,'photo_reference',null,
    'subjects',coalesce((select jsonb_agg(jsonb_build_object('subject_id',s.id,'title',s.title,'slug',s.slug) order by s.title,s.id) from app_private.subjects s where s.id=any(p.subject_ids) and s.active),'[]'))
  into result from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id and p.tutor_id=t.id and p.state='approved'
  where t.id=p_tutor_id and app_private.has_role(t.account_id,'tutor');
  if result is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if; return result;
end $$;

create function app_private.approved_profile_immutable() returns trigger language plpgsql set search_path='' as $$
begin if old.state='approved' then raise exception 'IMMUTABLE_VERSION'; end if; if tg_op='DELETE' then return old; end if; return new; end $$;
create trigger profile_content_immutable before update or delete on app_private.tutor_profile_versions for each row execute function app_private.approved_profile_immutable();

do $$ declare f record; begin
  for f in select p.oid::regprocedure::text as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' and (p.proname like 'catalog_%' or p.proname in ('policy_content','customer_policy_summary','assert_catalog_publication','assert_exact_tutor_fee','approved_profile_immutable')))
       or (n.nspname='api' and p.proname in ('create_policy_draft','update_policy_draft','approve_policy_version','create_pricing_draft','update_pricing_draft','approve_pricing_version','create_offer','publish_offer','approve_tutor_profile','list_public_offers','list_policies','list_pricing_versions','list_admin_offers','list_admin_tutors','get_public_tutor')) loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
    if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature); end if;
    if f.nspname='api' and f.proname in ('list_public_offers','get_public_tutor') then execute format('grant execute on function %s to anon',f.signature); end if;
  end loop;
end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';

create function api.create_policy_draft(p_kind text,p_scope text,p_content jsonb,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('create_policy_draft',jsonb_build_object('kind',p_kind,'scope',p_scope,'content',p_content),p_idempotency_key) $$;
create function api.update_policy_draft(p_policy_version_id uuid,p_content jsonb,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('update_policy_draft',jsonb_build_object('policy_version_id',p_policy_version_id,'content',p_content,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.approve_policy_version(p_policy_version_id uuid,p_effective_at timestamptz,p_approval_note text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('approve_policy_version',jsonb_build_object('policy_version_id',p_policy_version_id,'effective_at',p_effective_at,'approval_note',p_approval_note,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.create_pricing_draft(p_scope text,p_customer_pricing jsonb,p_compensation jsonb,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('create_pricing_draft',jsonb_build_object('scope',p_scope,'customer_pricing',p_customer_pricing,'compensation',p_compensation),p_idempotency_key) $$;
create function api.update_pricing_draft(p_pricing_version_id uuid,p_customer_pricing jsonb,p_compensation jsonb,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('update_pricing_draft',jsonb_build_object('pricing_version_id',p_pricing_version_id,'customer_pricing',p_customer_pricing,'compensation',p_compensation,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.approve_pricing_version(p_pricing_version_id uuid,p_effective_at timestamptz,p_approval_note text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('approve_pricing_version',jsonb_build_object('pricing_version_id',p_pricing_version_id,'effective_at',p_effective_at,'approval_note',p_approval_note,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.create_offer(p_subject_id uuid,p_format text,p_duration_minutes integer,p_capacity integer,p_target_tier integer,p_pricing_version_id uuid,p_policy_version_id uuid,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('create_offer',jsonb_build_object('subject_id',p_subject_id,'format',p_format,'duration_minutes',p_duration_minutes,'capacity',p_capacity,'target_tier',p_target_tier,'pricing_version_id',p_pricing_version_id,'policy_version_id',p_policy_version_id),p_idempotency_key) $$;
create function api.publish_offer(p_offer_id uuid,p_effective_at timestamptz,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('publish_offer',jsonb_build_object('offer_id',p_offer_id,'effective_at',p_effective_at,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.approve_tutor_profile(p_tutor_id uuid,p_profile_version_id uuid,p_decision text,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$
select app_private.catalog_command('approve_tutor_profile',jsonb_build_object('tutor_id',p_tutor_id,'profile_version_id',p_profile_version_id,'decision',p_decision,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;

create function app_private.assert_exact_tutor_fee(p_pricing_version_id uuid,p_target_tier integer,p_fee_minor bigint,p_currency text,p_duration_minutes integer) returns void language plpgsql stable security definer set search_path='' as $$
declare price app_private.pricing_versions%rowtype; compensation jsonb; band jsonb; begin
  select * into price from app_private.pricing_versions where id=p_pricing_version_id;
  select content into compensation from finance_private.pricing_compensation where pricing_version_id=p_pricing_version_id;
  if price.id is null or price.status not in ('approved','published') or p_currency is distinct from price.customer_pricing->>'currency' or p_duration_minutes is distinct from (price.customer_pricing->>'duration_minutes')::int then raise exception 'POLICY_INCOMPLETE'; end if;
  if price.scope='private' then if p_target_tier is not null then raise exception 'VALIDATION_ERROR'; end if; band:=compensation->'private_fee_rule';
  else select value into band from jsonb_array_elements(compensation->'group_fee_bands') where value->>'tier_id'='group_'||p_target_tier::text; end if;
  if band is null or p_fee_minor is null or p_fee_minor not between 0 and 9007199254740991 or p_fee_minor not between (band->>'fee_min_minor')::bigint and (band->>'fee_max_minor')::bigint then raise exception 'AMOUNT_OUT_OF_RANGE'; end if;
end $$;
