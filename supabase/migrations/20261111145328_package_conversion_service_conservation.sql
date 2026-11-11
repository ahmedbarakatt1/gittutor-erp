grant create on schema app_private to git_tutor_commands;
create function app_private.package_conversion_service_valid(p_terms jsonb) returns boolean language sql immutable set search_path='' as $$
 select not exists(select 1 from jsonb_array_elements(p_terms->'lot_allocations') allocation where(allocation->>'target_credit_quanta')::numeric*(p_terms->>'new_base_duration_minutes')::numeric>(allocation->>'source_credit_quanta')::numeric*(p_terms->>'old_base_duration_minutes')::numeric)
$$;
create function app_private.package_conversion_service_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.new_contract_version_id is not null and not app_private.package_conversion_service_valid(new.customer_terms) then raise exception 'VALIDATION_ERROR';end if;return new;end $$;
create trigger package_conversion_service_guard before insert on app_private.package_operation_terms for each row execute function app_private.package_conversion_service_guard();
alter function app_private.package_conversion_service_valid(jsonb) owner to git_tutor_commands;
alter function app_private.package_conversion_service_guard() owner to git_tutor_commands;
revoke all on function app_private.package_conversion_service_valid(jsonb),app_private.package_conversion_service_guard() from public,anon,authenticated,service_role,git_tutor_worker;
create or replace function app_private.package_proposal_fresh(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;preview jsonb;contract jsonb;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;
 if p.id is null or t.proposal_id is null or p.state not in('proposed','accepted','approved') or p.expires_at<=now() then return false;end if;
 select * into source from app_private.package_purchases where id=t.source_purchase_id;if source.version<>t.source_purchase_version or source.purchase_state='cancelled' then return false;end if;
 if p.kind='package_coverage' then
  select * into e from app_private.enrollments where id=p.target_id;select * into o from app_private.occurrences where id=p.occurrence_id;
  if e.version<>p.base_target_version or e.current_quote_id<>t.source_quote_id or o.version<>p.base_occurrence_version then return false;end if;
  preview:=app_private.package_coverage_quote(source.id,e.id,(t.customer_terms->>'reserved_credit_quanta')::bigint);
  return preview->'terms'<>'null'::jsonb and preview->>'source_hash'=t.source_hash;
 else
  if not app_private.package_conversion_service_valid(t.customer_terms) then return false;end if;contract:=app_private.package_contract_dto(t.new_contract_version_id);if contract->>'terms_hash' is distinct from t.customer_terms->>'new_contract_terms_hash' then return false;end if;
  if t.target_purchase_id is not null then select * into target from app_private.package_purchases where id=t.target_purchase_id;if target.version<>t.target_purchase_version or target.purchase_state='cancelled' then return false;end if;end if;
  preview:=case when(t.customer_terms->>'source_credit_quanta')::bigint=0 then '[]'::jsonb else app_private.package_allocate_available(source.id,(t.customer_terms->>'source_credit_quanta')::bigint,null) end;
  return app_private.catalog_hash(preview)=t.source_hash;
 end if;
exception when raise_exception then if sqlerrm in('POLICY_INCOMPLETE','INSUFFICIENT_ENTITLEMENT','STATE_CONFLICT','WINDOW_CLOSED','VERSION_CONFLICT') then return false;else raise;end if;
end $$;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';
