create or replace function finance_private.finance_commit_remedy(p_reservation_id uuid,p_application_type text,p_application_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r app_private.remedy_reservations%rowtype;plan finance_private.financial_remedy_plans%rowtype;prior finance_private.financial_remedy_applications%rowtype;m app_private.entitlement_movements%rowtype;begin
 select * into r from app_private.remedy_reservations where id=p_reservation_id for update;select * into plan from finance_private.financial_remedy_plans where id=r.remedy_id;select * into prior from finance_private.financial_remedy_applications where reservation_id=r.id;
 if prior.reservation_id is not null then if prior.application_type<>p_application_type or prior.application_id<>p_application_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return;end if;
 if r.id is null or plan.id is null or r.state<>'reserved' then raise exception 'REMEDY_RESERVED';end if;
 if r.mode='restoration' then perform app_private.package_restore_kernel(r.id,plan.consumption_id,p_context);
 else
  if r.mode='cash' and not exists(select 1 from finance_private.refund_outcomes where attempt_id=p_application_id and outcome='settled') then raise exception 'EVIDENCE_REQUIRED';end if;
  if plan.consumption_id is not null then
   select * into m from app_private.entitlement_movements where id=plan.consumption_id;
   perform app_private.package_append_movement(m.lot_id,'adjust',jsonb_build_object('consumed_credit_quanta',-r.credit_quanta,'consumed_value_minor',-r.value_minor,'adjustment_credit_quanta',-r.credit_quanta,'adjustment_value_minor',-r.value_minor),jsonb_build_object('original_movement_id',m.id,'enrollment_id',m.enrollment_id,'reservation_id',m.reservation_id,'allocation_id',m.allocation_id,'credit_quanta',-r.credit_quanta,'value_minor',-r.value_minor,'from_bucket','consumed','to_bucket',null,'customer_reason_code','approved_cash_remedy'),p_context,'cash-remedy:'||r.id);
   if r.value_minor>0 then perform finance_private.finance_post_balanced('package-cash-remedy:'||r.id,'package_cash_remedy',r.id,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','tuition_revenue','learner_id',m.learner_id,'package_purchase_id',m.purchase_id,'lot_id',m.lot_id,'remedy_reservation_id',r.id,'signed_minor',r.value_minor),jsonb_build_object('account_code','deferred_package_obligation','learner_id',m.learner_id,'package_purchase_id',m.purchase_id,'lot_id',m.lot_id,'remedy_reservation_id',r.id,'signed_minor',-r.value_minor)),p_context);end if;
   update app_private.package_purchases set version=version+1,updated_at=now() where id=m.purchase_id;
  end if;
  update app_private.remedy_reservations set state='consumed' where id=r.id;
 end if;
 insert into finance_private.financial_remedy_applications values(r.id,p_application_type,p_application_id,(p_context->>'command_id')::uuid,now());
end $$;


