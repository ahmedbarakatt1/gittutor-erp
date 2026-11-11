create or replace function api.resolve_package_financing_hold(p_package_purchase_id uuid,p_reason text,p_evidence_file_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();purchase app_private.package_purchases%rowtype;context jsonb;scope jsonb;origins uuid[];origin uuid;
 qualification jsonb;qualifications jsonb:='{}';source jsonb;hold record;affected uuid;version integer;result_state text;begin
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
 result_state:=case when exists(select 1 from app_private.package_lots l join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where l.purchase_id=purchase.id) then 'held' else 'clear' end;
 return app_private.booking_finish(context,purchase.id,version,jsonb_build_object('state',result_state,'released_original_lot_ids',origins),'package_financing_hold_resolved',jsonb_build_object('package_purchase_id',purchase.id,'released_original_lot_ids',origins));
end $$;

notify pgrst,'reload schema';
