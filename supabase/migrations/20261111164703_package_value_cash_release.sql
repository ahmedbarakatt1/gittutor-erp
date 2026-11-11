grant create on schema finance_private to git_tutor_commands;
create function finance_private.finance_release_coverage_cash_excess(p_charge_id uuid,p_amount_minor bigint,p_coverage_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare total numeric;item record;result jsonb;reversals jsonb:='[]';credits jsonb:='[]';begin
 select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into total from finance_private.payment_allocations a where a.charge_id=p_charge_id;
 if p_amount_minor is null or p_amount_minor<1 or p_amount_minor>total then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for item in with weights as(select a.id,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) weight from finance_private.payment_allocations a where a.charge_id=p_charge_id),shares as(select id,floor(p_amount_minor::numeric*weight/total) base,mod(p_amount_minor::numeric*weight,total) remainder from weights where weight>0),ranked as(select *,row_number()over(order by remainder desc,id) rank,p_amount_minor-sum(base)over() residual from shares) select id,(base+case when rank<=residual then 1 else 0 end)::bigint amount from ranked order by id loop
  if item.amount=0 then continue;end if;
  result:=finance_private.finance_reverse_allocation(item.id,item.amount,'Proportional cash release from accepted package value','coverage',p_coverage_id,p_context,'coverage-cash:'||p_coverage_id||':'||item.id);
  reversals:=reversals||jsonb_build_array(result->'reversal_id');credits:=credits||(result->'released_credit_lot_ids');
 end loop;
 return jsonb_build_object('allocation_reversal_ids',reversals,'released_credit_lot_ids',credits);
end $$;
create or replace function finance_private.finance_apply_package_coverage(p_reservation_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r app_private.package_reservations%rowtype;c finance_private.charges%rowtype;b jsonb;amount bigint;adjustment jsonb;allocation_id uuid;ledger_id uuid;lines jsonb;released jsonb:='{}';begin
 select * into r from app_private.package_reservations where id=p_reservation_id;
 select * into c from finance_private.charges where enrollment_id=r.enrollment_id;
 if c.id is null or r.state<>'reserved' then raise exception 'CONSENT_REQUIRED';end if;
 perform 1 from finance_private.charge_accounts where charge_id=c.id for update;
 if exists(select 1 from finance_private.package_coverage_postings where reservation_id=r.id) or exists(select 1 from finance_private.package_value_allocations where reservation_id=r.id) then raise exception 'STATE_CONFLICT';end if;
 b:=finance_private.finance_charge_balance(c.id);
 if r.coverage_rule='named_entitlement_covers_eligible_occurrence' then
  if r.agreed_top_up_minor is null or r.agreed_top_up_minor>(b->>'commercial_net_minor')::bigint then raise exception 'CONSENT_REQUIRED';end if;
  amount:=(b->>'commercial_net_minor')::bigint-r.agreed_top_up_minor;
  if amount>0 then adjustment:=finance_private.finance_adjust_charge(c.id,-amount,case when r.reserved_credit_quanta>=r.required_credit_quanta then 'named_coverage' else 'partial_named_coverage' end,'package_reservation',r.id,now(),'Accepted named service coverage',p_context,'named-coverage:'||r.id);end if;
  insert into finance_private.package_coverage_postings(reservation_id,charge_id,adjustment_id,credit_minor,command_id) values(r.id,c.id,(adjustment->>'adjustment_id')::uuid,amount,(p_context->>'command_id')::uuid);
 else
  amount:=r.allocated_value_minor;
  if amount>(b->>'commercial_net_minor')::bigint or r.agreed_top_up_minor is distinct from (b->>'commercial_net_minor')::bigint-amount then raise exception 'CONSENT_REQUIRED';end if;
  lines:=case when amount=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',amount),jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',-amount)) end;
  ledger_id:=finance_private.finance_post_balanced('package-value:'||r.id,'package_value_applied',r.id,c.currency,now(),lines,p_context);
  insert into finance_private.package_value_allocations(charge_id,reservation_id,quote_id,conditional_amendment_id,amount_minor,consent_refs,ledger_transaction_id,command_id) values(c.id,r.id,r.quote_id,(select conditional_amendment_id from finance_private.charge_accounts where charge_id=c.id),amount,r.acceptance_refs,ledger_id,(p_context->>'command_id')::uuid) returning id into allocation_id;
  if (b->>'allocated_cash_minor')::bigint+amount>(b->>'commercial_net_minor')::bigint then released:=finance_private.finance_release_coverage_cash_excess(c.id,(b->>'allocated_cash_minor')::bigint+amount-(b->>'commercial_net_minor')::bigint,allocation_id,p_context);end if;
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;
 end if;
 return jsonb_build_object('coverage_adjustment_id',adjustment->'adjustment_id','package_value_allocation_id',allocation_id,'released_cash_allocation_ids',coalesce(adjustment->'allocation_reversal_ids',released->'allocation_reversal_ids','[]'::jsonb));
end $$;
alter function finance_private.finance_release_coverage_cash_excess(uuid,bigint,uuid,jsonb) owner to git_tutor_commands;
revoke all on function finance_private.finance_release_coverage_cash_excess(uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema finance_private from git_tutor_commands;
