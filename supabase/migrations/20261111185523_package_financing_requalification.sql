-- Requalification releases an operational hold only. It never creates cash,
-- entitlement, a new expiry, a replacement purchase or a second purchased grant.
grant create on schema api,app_private,finance_private to git_tutor_commands;
create table finance_private.package_financing_requalifications(
 id uuid primary key default gen_random_uuid(),original_lot_id uuid not null references app_private.package_lots(id),
 requested_purchase_id uuid not null references app_private.package_purchases(id),qualification jsonb not null,
 evidence_file_id uuid not null references app_private.files(id),actor_account_id uuid not null references app_private.accounts(id),
 reason text not null,command_id uuid not null,recorded_at timestamptz not null default now(),unique(original_lot_id,command_id)
);
alter table finance_private.package_financing_requalifications enable row level security;
create policy commands_access on finance_private.package_financing_requalifications to git_tutor_commands using(true) with check(true);
grant select,insert on finance_private.package_financing_requalifications to git_tutor_commands;
revoke all on finance_private.package_financing_requalifications from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_requalification before update or delete on finance_private.package_financing_requalifications for each row execute function app_private.reject_immutable_change();

create function app_private.package_original_funding_qualification(p_original_lot_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin app_private.package_lots%rowtype;purchase app_private.package_purchases%rowtype;funding jsonb;balance jsonb;
 source record;item record;sources jsonb:='[]';total numeric:=0;begin
 select * into origin from app_private.package_lots where id=p_original_lot_id and original_lot_id=id;
 if origin.id is null or origin.origin_kind not in('purchase','approved_credit') then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
 select * into purchase from app_private.package_purchases where id=origin.purchase_id;
 if purchase.purchase_state='cancelled' or not exists(select 1 from finance_private.package_funding_sources where original_lot_id=origin.id) then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
 -- Every historical loss affecting this origin must have exact source attribution.
 -- Reversed former purchase sources may qualify only via separately posted replacement funding.
 for source in select distinct transfer_id from finance_private.package_funding_sources where original_lot_id=origin.id loop
  balance:=finance_private.finance_transfer_balance(source.transfer_id);
  if balance->>'reconciliation_state'<>'clear' or(balance->>'recovery_exposure_minor')::numeric<>0 or exists(
   select 1 from finance_private.transfer_reversals r where r.transfer_id=source.transfer_id and r.amount_minor<>(
    select coalesce(sum(x.unapplied_minor+(select coalesce(sum((v->>'amount_minor')::numeric),0) from jsonb_array_elements(x.allocations)v)),0)
    from finance_private.transfer_reversal_resolutions x where x.reversal_id=r.id
   )
  ) then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
 end loop;
 if origin.origin_kind='purchase' then
  funding:=app_private.package_purchase_funding_status(purchase.id);
  if not coalesce((funding->>'eligible')::boolean,false) or purchase.purchase_value_minor<>(origin.balances->>'granted_value_minor')::numeric then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
  for source in select a.id,a.transfer_id,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) amount
   from finance_private.payment_allocations a where a.id in(select value::uuid from jsonb_array_elements_text(funding->'source_allocation_ids')) order by a.id loop
   sources:=sources||jsonb_build_array(jsonb_build_object('transfer_id',source.transfer_id,'allocation_id',source.id,'credit_application_id',null,'amount_minor',source.amount));total:=total+source.amount;
  end loop;
 else
  -- Approved credit is qualified by its exact original application, never by a
  -- different purchase payment or arbitrary replacement credit. Lost converted
  -- value has no recovery shortcut in this slice.
  for source in select * from finance_private.package_funding_sources where original_lot_id=origin.id order by id loop
   select a.id application_id,a.application_type,a.application_id applied_lot,a.amount_minor applied_amount,
    r.state,r.purpose,r.amount_minor reserved_amount,l.id credit_lot_id,l.transfer_id,l.payer_binding_id,l.currency,
    t.state transfer_state,t.current_payer_binding_id
   into item from finance_private.credit_applications a join finance_private.credit_reservations r on r.id=a.credit_reservation_id
    join finance_private.customer_credit_lots l on l.id=r.credit_lot_id join finance_private.incoming_transfers t on t.id=l.transfer_id
   where a.id=source.credit_application_id;
   if source.origin_kind<>'approved_credit' or item.application_id is null or item.application_type<>'package_grant' or item.applied_lot<>origin.id
    or item.state<>'consumed' or item.purpose<>'package_grant' or item.applied_amount<>source.amount_minor or item.reserved_amount<>source.amount_minor
    or item.transfer_id<>source.transfer_id or item.currency<>purchase.currency or item.transfer_state<>'settled'
    or item.current_payer_binding_id is distinct from item.payer_binding_id
    or not exists(select 1 from finance_private.transfer_settlements where transfer_id=item.transfer_id)
    or finance_private.finance_credit_available(item.credit_lot_id)<0 then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('transfer_id',source.transfer_id,'allocation_id',null,'credit_application_id',source.credit_application_id,'amount_minor',source.amount_minor));total:=total+source.amount_minor;
  end loop;
  if total<>(origin.balances->>'granted_value_minor')::numeric then return jsonb_build_object('eligible',false,'reason','RECONCILIATION_REQUIRED');end if;
 end if;
 return jsonb_build_object('eligible',true,'reason','ELIGIBLE','origin_kind',origin.origin_kind,'purchase_id',purchase.id,'qualified_value_minor',total,'sources',sources);
end $$;

create function api.resolve_package_financing_hold(p_package_purchase_id uuid,p_reason text,p_evidence_file_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();purchase app_private.package_purchases%rowtype;context jsonb;scope jsonb;origins uuid[];origin uuid;
 qualification jsonb;qualifications jsonb:='{}';source jsonb;hold record;affected uuid;version integer;state text;begin
 perform app_private.require_role(actor,'admin');
 select * into purchase from app_private.package_purchases where id=p_package_purchase_id;if purchase.id is null then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,'resolve_package_financing_hold',jsonb_build_object('package_purchase_id',p_package_purchase_id,'reason',p_reason,'evidence_file_id',p_evidence_file_id,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_expected_version is null or p_expected_version<1 then raise exception 'VALIDATION_ERROR';end if;
 scope:=app_private.booking_financial_scope('{}',array[purchase.id]);perform app_private.booking_lock_financial_scope(scope);
 perform app_private.require_role(actor,'admin');select * into purchase from app_private.package_purchases where id=p_package_purchase_id;
 if purchase.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 perform app_private.payment_assert_file(p_evidence_file_id,'financing_hold','package_purchase',purchase.id);
 select array_agg(distinct l.original_lot_id order by l.original_lot_id) into origins from app_private.package_lots l join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where l.purchase_id=purchase.id;
 if origins is null then raise exception 'STATE_CONFLICT';end if;
 perform 1 from app_private.package_financing_holds where original_lot_id=any(origins) order by id for update;
 -- Validate all affected origins before changing any hold. Evidence is an audit
 -- source, not an instruction to override a failed funding predicate.
 foreach origin in array origins loop
  qualification:=app_private.package_original_funding_qualification(origin);
  if not coalesce((qualification->>'eligible')::boolean,false) then raise exception 'RECONCILIATION_REQUIRED';end if;
  qualifications:=qualifications||jsonb_build_object(origin::text,qualification);
 end loop;
 foreach origin in array origins loop
  qualification:=qualifications->origin::text;
  if qualification->>'origin_kind'='purchase' then
   for source in select value from jsonb_array_elements(qualification->'sources') loop
    insert into finance_private.package_funding_sources(purchase_id,original_lot_id,origin_kind,transfer_id,allocation_id,amount_minor,command_id)
    values((qualification->>'purchase_id')::uuid,origin,'purchased',(source->>'transfer_id')::uuid,(source->>'allocation_id')::uuid,(source->>'amount_minor')::bigint,(context->>'command_id')::uuid)
    on conflict(original_lot_id,allocation_id) where allocation_id is not null do nothing;
   end loop;
  end if;
  insert into finance_private.package_financing_requalifications(original_lot_id,requested_purchase_id,qualification,evidence_file_id,actor_account_id,reason,command_id)
   values(origin,purchase.id,qualification,p_evidence_file_id,actor,p_reason,(context->>'command_id')::uuid);
  for hold in update app_private.package_financing_holds set active=false,resolved_at=now(),resolution_command_id=(context->>'command_id')::uuid where original_lot_id=origin and active returning id loop
   insert into app_private.package_financing_hold_events(hold_id,action,command_id,actor_account_id,evidence_file_id,reason) values(hold.id,'released',(context->>'command_id')::uuid,actor,p_evidence_file_id,p_reason);
  end loop;
 end loop;
 for affected in select distinct purchase_id from app_private.package_lots where original_lot_id=any(origins) order by purchase_id loop
  update app_private.package_purchases set version=package_purchases.version+1,updated_at=now() where id=affected;
  if not exists(select 1 from app_private.package_lots l join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where l.purchase_id=affected) then
   update app_private.reconciliation_exceptions set state='resolved',resolution_id=(context->>'command_id')::uuid,version=reconciliation_exceptions.version+1,updated_at=now()
   where source_type='package_financing_hold' and source_id=affected and state='open';
  end if;
 end loop;
 select p.version into version from app_private.package_purchases p where p.id=purchase.id;
 state:=case when exists(select 1 from app_private.package_lots l join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where l.purchase_id=purchase.id) then 'held' else 'clear' end;
 return app_private.booking_finish(context,purchase.id,version,jsonb_build_object('state',state,'released_original_lot_ids',origins),'package_financing_hold_resolved',jsonb_build_object('package_purchase_id',purchase.id,'released_original_lot_ids',origins));
end $$;
alter function app_private.package_original_funding_qualification(uuid) owner to git_tutor_commands;
revoke all on function app_private.package_original_funding_qualification(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
alter function api.resolve_package_financing_hold(uuid,text,uuid,integer,text) owner to git_tutor_commands;
revoke all on function api.resolve_package_financing_hold(uuid,text,uuid,integer,text) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.resolve_package_financing_hold(uuid,text,uuid,integer,text) to authenticated;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
