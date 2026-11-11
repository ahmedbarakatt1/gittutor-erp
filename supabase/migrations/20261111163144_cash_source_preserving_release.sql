grant create on schema finance_private to git_tutor_commands;
create function finance_private.finance_reverse_allocation(p_allocation_id uuid,p_amount_minor bigint,p_reason text,p_source_type text,p_source_id uuid,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a finance_private.payment_allocations%rowtype;c finance_private.charges%rowtype;r finance_private.allocation_reversals%rowtype;remaining numeric;reversal uuid:=gen_random_uuid();posting uuid;lot uuid;version integer;begin
 if p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 or p_source_id is null or p_source_type not in('correction','charge_credit','coverage','bank_reversal','refund_resolution') then raise exception 'VALIDATION_ERROR';end if;
 select * into a from finance_private.payment_allocations where id=p_allocation_id;if a.id is null then raise exception 'NOT_FOUND';end if;select * into c from finance_private.charges where id=a.charge_id;
 select * into r from finance_private.allocation_reversals where command_id=(p_context->>'command_id')::uuid and source_line_key=p_line_key;
 if r.id is not null then
  if r.allocation_id<>a.id or r.amount_minor<>p_amount_minor or r.reason<>p_reason or r.reversal_kind<>p_source_type or r.domain_source_id<>p_source_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('reversal_id',r.id,'released_credit_lot_ids',(select coalesce(jsonb_agg(id order by id),'[]') from finance_private.customer_credit_lots where command_id=r.command_id and source_line_key=p_line_key),'charge_version',(select version from finance_private.charge_accounts where charge_id=c.id));
 end if;
 select a.amount_minor-coalesce(sum(amount_minor),0) into remaining from finance_private.allocation_reversals where allocation_id=a.id;
 if p_amount_minor>remaining then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 posting:=finance_private.finance_post_balanced('allocation-reversal:'||reversal,'allocation_reversal',reversal,c.currency,now(),jsonb_build_array(
  jsonb_build_object('account_code','receivable','transfer_id',a.transfer_id,'allocation_id',a.id,'charge_id',c.id,'learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'enrollment_id',c.enrollment_id,'signed_minor',p_amount_minor),
  jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',a.transfer_id,'allocation_id',a.id,'charge_id',c.id,'learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'enrollment_id',c.enrollment_id,'signed_minor',-p_amount_minor)),p_context);
 insert into finance_private.allocation_reversals(id,allocation_id,amount_minor,reason,reversal_kind,domain_source_id,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at) values(reversal,a.id,p_amount_minor,p_reason,p_source_type,p_source_id,posting,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,p_line_key,now());
 if p_source_type<>'bank_reversal' then
  insert into finance_private.customer_credit_lots(transfer_id,payer_binding_id,payer_account_id,origin_kind,source_allocation_id,source_adjustment_id,original_minor,currency,command_id,source_line_key)
  select a.transfer_id,a.payer_binding_id,b.payer_account_id,'allocation_release',a.id,case when p_source_type='charge_credit' then p_source_id else null end,p_amount_minor,a.currency,(p_context->>'command_id')::uuid,p_line_key from finance_private.transfer_payer_bindings b where b.id=a.payer_binding_id returning id into lot;
  insert into finance_private.credit_lot_accounts(credit_lot_id) values(lot);
 end if;
 update finance_private.charge_accounts set version=charge_accounts.version+1,updated_at=now() where charge_id=c.id returning charge_accounts.version into version;
 update finance_private.incoming_transfers set version=incoming_transfers.version+1,updated_at=now() where id=a.transfer_id;
 return jsonb_build_object('reversal_id',reversal,'released_credit_lot_ids',case when lot is null then '[]'::jsonb else jsonb_build_array(lot) end,'charge_version',version);
end $$;
create function finance_private.finance_release_cash_excess(p_charge_id uuid,p_amount_minor bigint,p_adjustment_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare total numeric;item record;result jsonb;reversals jsonb:='[]';credits jsonb:='[]';begin
 select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into total from finance_private.payment_allocations a where a.charge_id=p_charge_id;
 if p_amount_minor is null or p_amount_minor<1 or p_amount_minor>total then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for item in with weights as(select a.id,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) weight from finance_private.payment_allocations a where a.charge_id=p_charge_id),shares as(select id,floor(p_amount_minor::numeric*weight/total) base,mod(p_amount_minor::numeric*weight,total) remainder from weights where weight>0),ranked as(select *,row_number()over(order by remainder desc,id) rank,p_amount_minor-sum(base)over() residual from shares) select id,(base+case when rank<=residual then 1 else 0 end)::bigint amount from ranked order by id loop
  if item.amount=0 then continue;end if;
  result:=finance_private.finance_reverse_allocation(item.id,item.amount,'Proportional cash release from approved tuition credit','charge_credit',p_adjustment_id,p_context,'charge-credit:'||p_adjustment_id||':'||item.id);
  reversals:=reversals||jsonb_build_array(result->'reversal_id');credits:=credits||(result->'released_credit_lot_ids');
 end loop;
 return jsonb_build_object('allocation_reversal_ids',reversals,'released_credit_lot_ids',credits);
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('finance_reverse_allocation','finance_release_cash_excess') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema finance_private from git_tutor_commands;
