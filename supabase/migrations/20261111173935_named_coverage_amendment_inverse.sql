create or replace function finance_private.finance_reduce_named_coverage(p_reservation_id uuid,p_amount_minor bigint,p_context jsonb,p_line_key text) returns uuid[] language plpgsql security definer set search_path='' as $$
declare a record;left_minor bigint:=p_amount_minor;take bigint;result jsonb;ids uuid[]:='{}';begin
 if p_amount_minor<0 or p_amount_minor>finance_private.finance_named_coverage_remaining(p_reservation_id) then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for a in select x.id,x.charge_id,-x.signed_minor-coalesce((select sum(i.signed_minor) from finance_private.charge_adjustments i where i.original_adjustment_id=x.id),0) remaining from finance_private.charge_adjustments x where x.domain_source_type='package_reservation' and x.domain_source_id=p_reservation_id and x.kind in('named_coverage','partial_named_coverage') and x.signed_minor<0 order by x.recorded_at,x.id loop
  exit when left_minor=0;if a.remaining<=0 then continue;end if;take:=least(left_minor,a.remaining);
  result:=finance_private.finance_adjust_charge(a.charge_id,take,'linked_inverse','named_coverage_revision',a.id,now(),'Referenced revision of the accepted named coverage',p_context,p_line_key||':'||a.id);ids:=array_append(ids,(result->>'adjustment_id')::uuid);left_minor:=left_minor-take;
 end loop;
 if left_minor<>0 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;return ids;
end $$;

create or replace function finance_private.finance_release_package_coverage(p_reservation_id uuid,p_reason text,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r app_private.package_reservations%rowtype;e app_private.enrollments%rowtype;c finance_private.charges%rowtype;v finance_private.package_value_allocations%rowtype;n finance_private.package_coverage_postings%rowtype;ids uuid[]:='{}';result jsonb;ledger_id uuid;begin
 select * into r from app_private.package_reservations where id=p_reservation_id;select * into e from app_private.enrollments where id=r.enrollment_id;select * into c from finance_private.charges where enrollment_id=r.enrollment_id;
 if c.id is null or exists(select 1 from finance_private.package_coverage_releases where reservation_id=r.id) then return ids;end if;
 if r.state='partially_consumed' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 perform 1 from finance_private.charge_accounts where charge_id=c.id for update;
 select * into n from finance_private.package_coverage_postings where reservation_id=r.id;
 select * into v from finance_private.package_value_allocations where reservation_id=r.id;
 if n.reservation_id is not null then ids:=finance_private.finance_reduce_named_coverage(r.id,finance_private.finance_named_coverage_remaining(r.id),p_context,'coverage-release:'||r.id);result:=jsonb_build_object('adjustment_id',ids[array_length(ids,1)]);end if;
 if v.id is not null and not exists(select 1 from finance_private.package_value_reversals where allocation_id=v.id) then
  ledger_id:=finance_private.finance_post_balanced('package-value-release:'||r.id,'package_value_released',r.id,c.currency,now(),case when v.amount_minor=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',v.amount_minor),jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',-v.amount_minor)) end,p_context);
  insert into finance_private.package_value_reversals(allocation_id,amount_minor,ledger_transaction_id,command_id) values(v.id,v.amount_minor,ledger_id,(p_context->>'command_id')::uuid);ids:=array_append(ids,ledger_id);
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;
 end if;
 insert into finance_private.package_coverage_releases(reservation_id,adjustment_id,command_id) values(r.id,(result->>'adjustment_id')::uuid,(p_context->>'command_id')::uuid);
 if e.state in('expired','cancelled') then
  update finance_private.charge_accounts set commitment_state='resolution_required',version=version+1,updated_at=now() where charge_id=c.id;

 end if;
 return ids;
end $$;


