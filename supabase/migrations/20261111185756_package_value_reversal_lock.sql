create or replace function finance_private.finance_reverse_package_value(p_reservation_id uuid,p_amount_minor bigint,p_context jsonb,p_source_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r app_private.package_reservations%rowtype;v finance_private.package_value_allocations%rowtype;previous finance_private.package_value_reversals%rowtype;remaining bigint;ledger uuid;
begin
 select * into r from app_private.package_reservations where id=p_reservation_id;select * into v from finance_private.package_value_allocations where reservation_id=r.id;
 if v.id is null or p_amount_minor is null or p_amount_minor<0 then raise exception 'VALIDATION_ERROR';end if;
 select * into previous from finance_private.package_value_reversals where allocation_id=v.id and command_id=(p_context->>'command_id')::uuid;
 if previous.id is not null then if previous.amount_minor<>p_amount_minor then raise exception 'IDEMPOTENCY_CONFLICT';end if;return previous.ledger_transaction_id;end if;
 select v.amount_minor-coalesce(sum(amount_minor),0) into remaining from finance_private.package_value_reversals where allocation_id=v.id;
 if p_amount_minor>remaining then raise exception 'AMOUNT_OUT_OF_RANGE';end if;if p_amount_minor=0 then return null;end if;
 ledger:=finance_private.finance_post_balanced('package-value-reversal:'||r.id||':'||(p_context->>'command_id'),'package_value_released',p_source_id,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',v.charge_id,'signed_minor',p_amount_minor),jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',v.charge_id,'signed_minor',-p_amount_minor)),p_context);
 insert into finance_private.package_value_reversals(allocation_id,amount_minor,ledger_transaction_id,command_id) values(v.id,p_amount_minor,ledger,(p_context->>'command_id')::uuid);
 update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=v.charge_id;
 return ledger;
end $$;