-- Trigger row variants are selected through explicit JSON fields; strict grant validation resolves array item names.
create or replace function finance_private.finance_assert_balanced() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;begin target:=case when tg_table_name='ledger_transactions' then(to_jsonb(new)->>'id')::uuid else(to_jsonb(new)->>'transaction_id')::uuid end;
 if exists(select 1 from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where t.id=target and l.currency<>t.currency) or coalesce((select sum(signed_minor::numeric) from finance_private.ledger_lines where transaction_id=target),0)<>0 then raise exception 'UNBALANCED_JOURNAL';end if;return null;end $$;
create or replace function app_private.package_grant_policy_errors(p_content jsonb) returns text[] language plpgsql immutable set search_path='' as $$
#variable_conflict use_column
declare value jsonb;begin
 if jsonb_typeof(p_content) is distinct from 'object' or(p_content-array['name','eligible_package_contract_version_ids','currency','valuation_rule','maximum_credit_quanta_per_grant','maximum_carrying_value_minor_per_grant'])<>'{}' then return array['content'];end if;
 if length(btrim(coalesce(p_content->>'name',''))) not between 1 and 200 or p_content->>'currency' is distinct from 'EGP' or p_content->>'valuation_rule' is null or p_content->>'valuation_rule' not in('zero_value','reviewed_exact_capped_subsidy') or jsonb_typeof(p_content->'eligible_package_contract_version_ids') is distinct from 'array' or jsonb_array_length(p_content->'eligible_package_contract_version_ids') not between 1 and 100 then return array['content'];end if;
 for value in select value from jsonb_array_elements(p_content->'eligible_package_contract_version_ids') loop if jsonb_typeof(value)<>'string' then return array['eligible_package_contract_version_ids'];end if;perform(value#>>'{}')::uuid;end loop;
 perform app_private.package_safe_integer(p_content->'maximum_credit_quanta_per_grant',1);perform app_private.package_safe_integer(p_content->'maximum_carrying_value_minor_per_grant');
 if p_content->>'valuation_rule'='zero_value' and(p_content->>'maximum_carrying_value_minor_per_grant')::numeric<>0 then return array['maximum_carrying_value_minor_per_grant'];end if;return '{}';
exception when others then return array['content'];end $$;
notify pgrst,'reload schema';
