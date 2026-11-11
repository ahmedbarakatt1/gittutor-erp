-- Each reserved package remedy extinguishes proportional remaining original benefit. Zero-valued benefits still consume quantity.
create or replace function app_private.package_reserve_remedy_kernel(p_consumption_id uuid,p_remedy_id uuid,p_credit_quanta bigint,p_value_minor bigint,p_mode text,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare movement app_private.entitlement_movements%rowtype;source finance_private.remedy_sources%rowtype;prior app_private.remedy_reservations%rowtype;usedq numeric;usedv numeric;result uuid;begin
 select * into movement from app_private.entitlement_movements where id=p_consumption_id and kind='consume';if movement.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_lock_purchase(movement.purchase_id);
 if p_remedy_id is null or p_credit_quanta is null or p_credit_quanta not between 1 and 9007199254740991 or p_value_minor is null or p_value_minor not between 0 and 9007199254740991 or(p_credit_quanta=0 and p_value_minor=0) or p_mode is null or p_mode not in('restoration','cash','account_credit') then raise exception 'VALIDATION_ERROR';end if;
 insert into finance_private.remedy_sources(consumption_id,learner_id,eligible_credit_quanta,eligible_value_minor) values(movement.id,movement.learner_id,movement.credit_quanta,movement.value_minor) on conflict(consumption_id) do nothing;
 select * into source from finance_private.remedy_sources where consumption_id=p_consumption_id for update;
 select * into prior from app_private.remedy_reservations where source_id=source.id and remedy_id=p_remedy_id;
 if prior.id is not null then if prior.credit_quanta<>p_credit_quanta or prior.value_minor<>p_value_minor or prior.mode<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.id;end if;
 select coalesce(sum(credit_quanta),0),coalesce(sum(value_minor),0) into usedq,usedv from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed');
 if usedq+p_credit_quanta>source.eligible_credit_quanta or usedv+p_value_minor>source.eligible_value_minor then raise exception 'REMEDY_RESERVED';end if;
 if p_value_minor<>floor((source.eligible_value_minor-usedv)*p_credit_quanta/(source.eligible_credit_quanta-usedq)) then raise exception 'VALIDATION_ERROR';end if;
 insert into app_private.remedy_reservations(source_id,remedy_id,credit_quanta,value_minor,mode,state,command_id) values(source.id,p_remedy_id,p_credit_quanta,p_value_minor,p_mode,'reserved',(p_context->>'command_id')::uuid) returning id into result;return result;
end $$;
notify pgrst,'reload schema';
