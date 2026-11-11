create or replace function api.allocate_transfer(p_case_id uuid,p_transfer_id uuid,p_evidence_version integer,p_payment_plan_id uuid,p_allocations jsonb,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();review app_private.review_cases%rowtype;context jsonb;scope jsonb;proof jsonb;item jsonb;ids uuid[]:='{}';allocations uuid[]:='{}';result jsonb;confirmations jsonb:='[]';amount bigint;total numeric:=0;receipt_total bigint;already numeric;target app_private.payment_plan_targets%rowtype;c finance_private.charges%rowtype;occurrence uuid;funding jsonb;version integer;begin
 perform app_private.payment_current_staff(actor);select * into review from app_private.review_cases where id=p_case_id;if review.id is null then raise exception 'NOT_FOUND';end if;
 if review.owner_id is distinct from actor and not app_private.has_role(actor,'admin') then raise exception 'OWNER_REQUIRED';end if;
 context:=app_private.booking_begin(actor,'allocate_transfer',jsonb_build_object('case_id',p_case_id,'transfer_id',p_transfer_id,'evidence_version',p_evidence_version,'payment_plan_id',p_payment_plan_id,'allocations',p_allocations,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(p_allocations) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['charge_id','amount_minor']<>'{}'::jsonb or jsonb_typeof(item->'charge_id') is distinct from 'string' or item->>'charge_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'VALIDATION_ERROR';end if;
  if(item->>'charge_id')::uuid=any(ids) then raise exception 'VALIDATION_ERROR';end if;ids:=array_append(ids,(item->>'charge_id')::uuid);amount:=app_private.package_safe_integer(item->'amount_minor',1);total:=total+amount;
 end loop;if total>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 scope:=finance_private.finance_discover_scope(ids,array[p_transfer_id],'{}','{}');perform app_private.booking_lock_financial_scope(scope);
 select * into review from app_private.review_cases where id=p_case_id;if review.version<>p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 proof:=app_private.finance_qualified_proof(p_case_id,p_evidence_version,p_transfer_id,ids,p_payment_plan_id,actor);
 select reported_amount_minor into receipt_total from app_private.receipt_evidence where receipt_id=review.receipt_id and evidence_version=p_evidence_version;
 select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into already from finance_private.payment_allocations a where a.receipt_id=review.receipt_id and a.evidence_version=p_evidence_version;
 if already+total>receipt_total or(finance_private.finance_transfer_balance(p_transfer_id)->>'available_minor')::numeric<total then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for item in select value from jsonb_array_elements(p_allocations) order by value->>'charge_id' loop
  if p_payment_plan_id is not null then
   select * into target from app_private.payment_plan_targets where plan_id=p_payment_plan_id and charge_id=(item->>'charge_id')::uuid;
   if target.conditional_amendment_id is not null then raise exception 'STATE_CONFLICT';end if;
   select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into already from finance_private.payment_allocations a where a.plan_target_id=target.id;
   if already+(item->>'amount_minor')::bigint>target.amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  end if;
  result:=finance_private.finance_allocate_cash(p_transfer_id,(item->>'charge_id')::uuid,(item->>'amount_minor')::bigint,proof,context,'allocation:'||(item->>'charge_id'));allocations:=array_append(allocations,(result->>'allocation_id')::uuid);
 end loop;
 for c in select * from finance_private.charges where id=any(ids) and package_purchase_id is not null order by id loop
  funding:=app_private.package_purchase_funding_status(c.package_purchase_id);if(funding->>'eligible')::boolean then perform app_private.package_activate_funded_purchase(c.package_purchase_id,array(select value::uuid from jsonb_array_elements_text(funding->'source_allocation_ids')),context);end if;
 end loop;
 for occurrence in select distinct e.occurrence_id from app_private.enrollments e join finance_private.charges charge_target on charge_target.enrollment_id=e.id where charge_target.id=any(ids) order by e.occurrence_id loop
  if exists(select 1 from finance_private.charge_accounts a join finance_private.charges charge_target on charge_target.id=a.charge_id join app_private.enrollments e on e.id=charge_target.enrollment_id where charge_target.id=any(ids) and e.occurrence_id=occurrence and a.commitment_state='awaiting_amendment') then result:=jsonb_build_object('state','awaiting_requirements','occurrence_id',occurrence,'reason','AMENDMENT_PENDING');else result:=app_private.booking_try_confirm_locked(occurrence,context);end if;
  confirmations:=confirmations||jsonb_build_array(result);
 end loop;
 if confirmations='[]' then confirmations:=jsonb_build_array(jsonb_build_object('state','not_applicable','occurrence_id',null,'reason',null));end if;
 update app_private.review_cases set version=review_cases.version+1,updated_at=now() where id=review.id returning review_cases.version into version;
 insert into app_private.review_case_events(case_id,event_type,evidence_version,owner_id,actor_account_id,command_id,details) values(review.id,'transfer_allocated',p_evidence_version,review.owner_id,actor,(context->>'command_id')::uuid,jsonb_build_object('allocation_ids',allocations));
 return app_private.booking_finish(context,review.id,version,jsonb_build_object('allocation_ids',allocations,'unapplied_minor',finance_private.finance_transfer_balance(p_transfer_id)->'unapplied_signed_minor','confirmation_status',confirmations),'transfer_allocated',jsonb_build_object('case_id',review.id,'transfer_id',p_transfer_id));
end $$;

