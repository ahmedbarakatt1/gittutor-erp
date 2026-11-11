grant create on schema api,app_private,finance_private to git_tutor_commands;
create table finance_private.financial_remedy_applications(reservation_id uuid primary key references app_private.remedy_reservations(id),application_type text not null,application_id uuid not null,command_id uuid not null,created_at timestamptz not null default now());
alter table finance_private.financial_remedy_applications enable row level security;
create policy commands_access on finance_private.financial_remedy_applications to git_tutor_commands using(true) with check(true);
grant select,insert on finance_private.financial_remedy_applications to git_tutor_commands;
revoke all on finance_private.financial_remedy_applications from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_remedy_application before update or delete on finance_private.financial_remedy_applications for each row execute function app_private.reject_immutable_change();
create function finance_private.finance_reserve_remedy(p_remedy_id uuid,p_source_type text,p_source_id uuid,p_credit_quanta bigint,p_value_minor bigint,p_mode text,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan finance_private.financial_remedy_plans%rowtype;source finance_private.remedy_sources%rowtype;prior app_private.remedy_reservations%rowtype;movement app_private.entitlement_movements%rowtype;charge finance_private.charges%rowtype;reserved uuid;used numeric;cash jsonb:='[]';payer_binding uuid;available numeric;begin
 select * into plan from finance_private.financial_remedy_plans where id=p_remedy_id;
 if plan.id is null then raise exception 'REMEDY_REQUIRED';end if;perform app_private.require_role(plan.approved_by,'admin');
 if plan.source_type is distinct from p_source_type or plan.source_id is distinct from p_source_id or plan.mode is distinct from p_mode or p_credit_quanta is null or p_value_minor is null or p_credit_quanta<0 or p_value_minor<0 or p_credit_quanta>plan.credit_quanta or p_value_minor>plan.value_minor then raise exception 'REMEDY_REQUIRED';end if;
 if p_source_type='package_consumption' then
  select * into movement from app_private.entitlement_movements where id=p_source_id and kind='consume';if movement.id is null or movement.policy_version_id<>plan.policy_version_id then raise exception 'REMEDY_REQUIRED';end if;
  perform app_private.package_lock_purchase(movement.purchase_id);
  if p_mode in('cash','account_credit') and not exists(select 1 from finance_private.package_funding_sources f join app_private.package_lots l on l.original_lot_id=f.original_lot_id where l.id=movement.lot_id) then raise exception 'INSUFFICIENT_FUNDS';end if;
  reserved:=app_private.package_reserve_remedy_kernel(movement.id,plan.id,p_credit_quanta,p_value_minor,p_mode,p_context);
 else
  select * into charge from finance_private.charges where id=p_source_id;if charge.id is null or p_credit_quanta<>0 or p_mode='restoration' then raise exception 'REMEDY_REQUIRED';end if;
  insert into finance_private.remedy_sources(charge_id,learner_id,eligible_credit_quanta,eligible_value_minor) select charge.id,charge.learner_id,0,charge.amount_minor+coalesce((select sum(amount_minor) from finance_private.charge_adjustments where charge_id=charge.id and amount_minor>0),0) on conflict(charge_id) do nothing;
  select * into source from finance_private.remedy_sources where charge_id=charge.id for update;
  select * into prior from app_private.remedy_reservations where source_id=source.id and remedy_id=plan.id;
  if prior.id is not null then if prior.credit_quanta<>p_credit_quanta or prior.value_minor<>p_value_minor or prior.mode<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT';end if;reserved:=prior.id;
  else
   select coalesce(sum(value_minor),0) into used from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed');if used+p_value_minor>source.eligible_value_minor then raise exception 'REMEDY_RESERVED';end if;
   insert into app_private.remedy_reservations(source_id,remedy_id,credit_quanta,value_minor,mode,state,command_id) values(source.id,plan.id,0,p_value_minor,p_mode,'reserved',(p_context->>'command_id')::uuid) returning id into reserved;
  end if;
 end if;
 select * into prior from app_private.remedy_reservations where id=reserved for update;
 if prior.state='consumed' then raise exception 'REMEDY_RESERVED';end if;
 if p_mode in('cash','account_credit') then
  select coalesce(jsonb_agg(jsonb_build_object('credit_lot_id',l.id,'transfer_id',l.transfer_id,'amount_minor',finance_private.finance_credit_available(l.id)) order by l.created_at,l.id),'[]'),coalesce(sum(finance_private.finance_credit_available(l.id)),0),min(l.payer_binding_id::text)::uuid into cash,available,payer_binding from finance_private.customer_credit_lots l join finance_private.payment_allocations a on a.id=l.source_allocation_id
  where l.origin_kind='allocation_release' and a.id::text in(select jsonb_array_elements_text(coalesce(plan.source_ancestry->'allocation_ids','[]'))) and(p_context->>'payer_account_id' is null or l.payer_account_id=(p_context->>'payer_account_id')::uuid) and finance_private.finance_transfer_balance(l.transfer_id)->>'reconciliation_state'='clear' and finance_private.finance_credit_available(l.id)>0;
  if available<p_value_minor then raise exception 'INSUFFICIENT_FUNDS';end if;
 end if;
 if prior.state='released' then
  select * into source from finance_private.remedy_sources where id=prior.source_id for update;select coalesce(sum(value_minor),0) into used from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed');if used+p_value_minor>source.eligible_value_minor then raise exception 'REMEDY_RESERVED';end if;
  if p_source_type='package_consumption' and p_credit_quanta+coalesce((select sum(credit_quanta) from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed')),0)>source.eligible_credit_quanta then raise exception 'REMEDY_RESERVED';end if;
  update app_private.remedy_reservations set state='reserved' where id=prior.id;
 end if;
 return jsonb_build_object('remedy_reservation_id',reserved,'source_id',prior.source_id,'consumption_id',plan.consumption_id,'credit_quanta',p_credit_quanta,'value_minor',p_value_minor,'cash_source_reservations',cash,'payer_binding_id',payer_binding);
end $$;
create function finance_private.finance_commit_remedy(p_reservation_id uuid,p_application_type text,p_application_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r app_private.remedy_reservations%rowtype;plan finance_private.financial_remedy_plans%rowtype;prior finance_private.financial_remedy_applications%rowtype;m app_private.entitlement_movements%rowtype;begin
 select * into r from app_private.remedy_reservations where id=p_reservation_id for update;select * into plan from finance_private.financial_remedy_plans where id=r.remedy_id;select * into prior from finance_private.financial_remedy_applications where reservation_id=r.id;
 if prior.reservation_id is not null then if prior.application_type<>p_application_type or prior.application_id<>p_application_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return;end if;
 if r.id is null or plan.id is null or r.state<>'reserved' then raise exception 'REMEDY_RESERVED';end if;
 if r.mode='restoration' then perform app_private.package_restore_kernel(r.id,plan.consumption_id,p_context);
 else
  if r.mode='cash' and not exists(select 1 from finance_private.refund_outcomes where attempt_id=p_application_id and outcome='settled') then raise exception 'EVIDENCE_REQUIRED';end if;
  if plan.consumption_id is not null then
   select * into m from app_private.entitlement_movements where id=plan.consumption_id;
   perform app_private.package_append_movement(m.lot_id,'adjust',jsonb_build_object('consumed_credit_quanta',-r.credit_quanta,'consumed_value_minor',-r.value_minor,'refunded_credit_quanta',r.credit_quanta,'refunded_value_minor',r.value_minor),jsonb_build_object('original_movement_id',m.id,'enrollment_id',m.enrollment_id,'reservation_id',m.reservation_id,'allocation_id',m.allocation_id,'credit_quanta',r.credit_quanta,'value_minor',r.value_minor,'from_bucket','consumed','to_bucket','refunded','customer_reason_code','approved_cash_remedy'),p_context,'cash-remedy:'||r.id);
  end if;
  update app_private.remedy_reservations set state='consumed' where id=r.id;
 end if;
 insert into finance_private.financial_remedy_applications values(r.id,p_application_type,p_application_id,(p_context->>'command_id')::uuid,now());
end $$;
create function finance_private.finance_release_remedy(p_reservation_id uuid,p_verified_resolution_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r app_private.remedy_reservations%rowtype;begin select * into r from app_private.remedy_reservations where id=p_reservation_id for update;if r.id is null then raise exception 'NOT_FOUND';end if;if r.state='released' then return;end if;if r.state<>'reserved' or not exists(select 1 from finance_private.refund_outcomes o join finance_private.refund_attempts a on a.id=o.attempt_id join finance_private.refund_source_reservations s on s.id=any(a.source_reservation_ids) where o.id=p_verified_resolution_id and o.outcome='failed' and s.remedy_reservation_id=r.id) then raise exception 'EVIDENCE_REQUIRED';end if;update app_private.remedy_reservations set state='released' where id=r.id;insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values((p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'financial_remedy_released',r.id,jsonb_build_object('verified_resolution_id',p_verified_resolution_id));end $$;
create or replace function api.restore_package_credit(p_consumption_id uuid,p_credit_quanta bigint,p_remedy_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();m app_private.entitlement_movements%rowtype;purchase app_private.package_purchases%rowtype;plan finance_private.financial_remedy_plans%rowtype;context jsonb;scope jsonb;reserved jsonb;value bigint;begin
 perform app_private.require_role(actor,'admin');select * into m from app_private.entitlement_movements where id=p_consumption_id and kind='consume';if m.id is null then raise exception 'NOT_FOUND';end if;
 if p_credit_quanta is null or p_credit_quanta not between 1 and 9007199254740991 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 context:=app_private.package_begin(actor,'restore_package_credit',jsonb_build_object('consumption_id',p_consumption_id,'credit_quanta',p_credit_quanta,'remedy_id',p_remedy_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 scope:=finance_private.finance_discover_scope('{}','{}','{}',array[m.id]);perform app_private.booking_lock_financial_scope(scope);select * into purchase from app_private.package_purchases where id=m.purchase_id;if purchase.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 select * into plan from finance_private.financial_remedy_plans where id=p_remedy_id;if plan.id is null then raise exception 'REMEDY_REQUIRED';end if;
 value:=floor(plan.value_minor::numeric*p_credit_quanta/nullif(plan.credit_quanta,0));reserved:=finance_private.finance_reserve_remedy(plan.id,'package_consumption',m.id,p_credit_quanta,value,'restoration',context);
 perform finance_private.finance_commit_remedy((reserved->>'remedy_reservation_id')::uuid,'restoration',m.id,context);select * into purchase from app_private.package_purchases where id=m.purchase_id;
 return app_private.package_finish(context,purchase.id,purchase.version,jsonb_build_object('restored_credit_quanta',p_credit_quanta,'restored_value_minor',value),'package_credit_restored',jsonb_build_object('package_purchase_id',purchase.id));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('finance_reserve_remedy','finance_commit_remedy','finance_release_remedy') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
