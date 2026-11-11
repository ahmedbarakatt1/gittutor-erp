-- Complete only the customer wire shape. Immutable source/saved contracts and acceptance hashes stay byte-for-byte unchanged.
grant create on schema app_private to git_tutor_commands;
create function app_private.package_customer_contract(p_contract jsonb) returns jsonb language sql immutable security definer set search_path='' as $$
 select case when p_contract->>'expiry_mode'='none' and not(p_contract?'expiry_days') then p_contract||jsonb_build_object('expiry_days',null) else p_contract end
$$;
alter function app_private.package_customer_contract(jsonb) owner to git_tutor_commands;
revoke all on function app_private.package_customer_contract(jsonb) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;

-- Internal package_contract_dto deliberately retains raw source terms for issuance, renewal and proposal hashes.
create or replace function api.get_package_contract(p_package_contract_version_id uuid,p_learner_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();view jsonb;begin
 perform app_private.package_assert_scope(actor,p_learner_id,'payments',true);
 view:=app_private.package_contract_dto(p_package_contract_version_id);
 return jsonb_set(view,'{contract}',app_private.package_customer_contract(view->'contract'));
end $$;

create or replace function api.list_package_contracts(p_learner_id uuid,p_offer_id uuid default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;items jsonb;begin
 result:=app_private.package_read('contracts',jsonb_build_object('learner_id',p_learner_id,'offer_id',p_offer_id),p_cursor,p_limit);
 select coalesce(jsonb_agg(jsonb_set(value,'{contract}',app_private.package_customer_contract(value->'contract')) order by ordinality),'[]'::jsonb) into items from jsonb_array_elements(result->'items') with ordinality;
 return jsonb_set(result,'{items}',items);
end $$;

create or replace function api.get_my_package(p_package_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();p app_private.package_purchases%rowtype;filters jsonb:=jsonb_build_object('package_id',p_package_id);begin
 select * into p from app_private.package_purchases where id=p_package_id;if p.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,p.learner_id,'payments',true);
 return jsonb_build_object('package',app_private.package_summary(p.id,actor),'contract',app_private.package_customer_contract(p.contract_snapshot),'purchase_terms_hash',p.contract_hash,'eligible_offers',app_private.package_offer_labels(p.contract_snapshot),'lot_page',app_private.package_read('lots',filters),'movement_page',app_private.package_read('movements',filters),'coverage_page',app_private.package_read('coverage',filters),'lineage_page',app_private.package_read('lineage',filters),'renewal_page',app_private.package_read('renewals',filters));
end $$;
