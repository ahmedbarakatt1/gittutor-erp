grant create on schema api to git_tutor_commands;
create function api.correct_allocation(p_allocation_id uuid,p_replacement_charge_id uuid,p_amount_minor bigint,p_reason text,p_payment_plan_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();a finance_private.payment_allocations%rowtype;t finance_private.incoming_transfers%rowtype;target finance_private.charges%rowtype;context jsonb;scope jsonb;proof jsonb;inverse jsonb;replacement jsonb;new_id uuid:=gen_random_uuid();case_id uuid;evidence_version integer;plan app_private.payment_allocation_plans%rowtype;limit_minor numeric;used numeric;funding jsonb;begin
 perform app_private.require_role(actor,'admin');select * into a from finance_private.payment_allocations where id=p_allocation_id;if a.id is null then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,'correct_allocation',jsonb_build_object('allocation_id',p_allocation_id,'replacement_charge_id',p_replacement_charge_id,'amount_minor',p_amount_minor,'reason',p_reason,'payment_plan_id',p_payment_plan_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_replacement_charge_id=a.charge_id then raise exception 'VALIDATION_ERROR';end if;
 if p_payment_plan_id is null then raise exception 'CONSENT_REQUIRED';end if;
 scope:=finance_private.finance_discover_scope(array[a.charge_id,p_replacement_charge_id],array[a.transfer_id],'{}','{}');perform app_private.booking_lock_financial_scope(scope);perform app_private.require_role(actor,'admin');select * into t from finance_private.incoming_transfers where id=a.transfer_id;if t.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 plan:=app_private.payment_current_plan(p_payment_plan_id);select c.id,c.current_evidence_version into case_id,evidence_version from app_private.review_cases c where c.receipt_id=plan.receipt_id;
 proof:=app_private.finance_qualified_proof(case_id,evidence_version,t.id,array[p_replacement_charge_id],plan.id,actor);
 select amount_minor into limit_minor from app_private.payment_plan_targets where plan_id=plan.id and charge_id=p_replacement_charge_id;
 select coalesce(sum(pa.amount_minor-coalesce((select sum(pr.amount_minor) from finance_private.allocation_reversals pr where pr.allocation_id=pa.id),0)),0) into used from finance_private.payment_allocations pa where pa.payment_plan_id=plan.id and pa.charge_id=p_replacement_charge_id;if used+p_amount_minor>limit_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 context:=context||jsonb_build_object('new_allocation_id',new_id);inverse:=finance_private.finance_reverse_allocation(a.id,p_amount_minor,p_reason,'correction',new_id,context,'correct-inverse');replacement:=finance_private.finance_allocate_cash(t.id,p_replacement_charge_id,p_amount_minor,proof,context,'correct-replacement');
 perform app_private.package_mark_financing_hold('allocation',a.id,context);
 select * into target from finance_private.charges where id=p_replacement_charge_id;
 if target.package_purchase_id is not null then funding:=app_private.package_purchase_funding_status(target.package_purchase_id);if(funding->>'eligible')::boolean then perform app_private.package_activate_funded_purchase(target.package_purchase_id,array(select value::uuid from jsonb_array_elements_text(funding->'source_allocation_ids')),context);end if;
 elsif target.enrollment_id is not null then perform app_private.booking_try_confirm_locked((select occurrence_id from app_private.enrollments where id=target.enrollment_id),context);end if;
 select * into t from finance_private.incoming_transfers where id=t.id;
 return app_private.booking_finish(context,t.id,t.version,jsonb_build_object('reversal_id',inverse->'reversal_id','new_allocation_id',replacement->'allocation_id'),'allocation_corrected',jsonb_build_object('transfer_id',t.id,'old_charge_id',a.charge_id,'new_charge_id',target.id));
end $$;
alter function api.correct_allocation(uuid,uuid,bigint,text,uuid,integer,text) owner to git_tutor_commands;
revoke all on function api.correct_allocation(uuid,uuid,bigint,text,uuid,integer,text) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.correct_allocation(uuid,uuid,bigint,text,uuid,integer,text) to authenticated;
revoke create on schema api from git_tutor_commands;
create or replace function finance_private.finance_allocate_cash(p_transfer_id uuid,p_charge_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c finance_private.charges%rowtype;t finance_private.incoming_transfers%rowtype;saved finance_private.payment_allocations%rowtype;target jsonb;allocation uuid:=coalesce((p_context->>'new_allocation_id')::uuid,gen_random_uuid());posting uuid;lot record;reserved jsonb;credit_ids uuid[]:='{}';remaining bigint:=p_amount_minor;take bigint;version integer;begin
 if p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 select * into c from finance_private.charges where id=p_charge_id;select * into t from finance_private.incoming_transfers where id=p_transfer_id;
 select * into saved from finance_private.payment_allocations where command_id=(p_context->>'command_id')::uuid and source_line_key=p_line_key;
 if saved.id is not null then if saved.transfer_id<>p_transfer_id or saved.charge_id<>p_charge_id or saved.amount_minor<>p_amount_minor then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('allocation_id',saved.id,'credit_source_ids',(select coalesce(jsonb_agg(r.credit_lot_id),'[]') from finance_private.credit_applications a join finance_private.credit_reservations r on r.id=a.credit_reservation_id where a.application_type='allocation' and a.application_id=saved.id),'amount_minor',saved.amount_minor,'charge_version',(select version from finance_private.charge_accounts where charge_id=c.id));end if;
 if c.id is null or t.id is null then raise exception 'NOT_FOUND';end if;
 if t.state<>'settled' then raise exception 'TRANSFER_UNSETTLED';end if;
 if c.currency<>t.currency or t.current_payer_binding_id is distinct from(p_qualified_proof->>'payer_binding_id')::uuid then raise exception 'EVIDENCE_REQUIRED';end if;
 select value into target from jsonb_array_elements(p_qualified_proof->'targets') where value->>'charge_id'=c.id::text;
 if target is null or(target->>'learner_id')::uuid<>c.learner_id then raise exception 'EVIDENCE_REQUIRED';end if;
 if(finance_private.finance_charge_balance(c.id)->>'receivable_minor')::bigint<p_amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for lot in select l.id,finance_private.finance_credit_available(l.id) available from finance_private.customer_credit_lots l where l.transfer_id=t.id and l.payer_binding_id=t.current_payer_binding_id order by l.created_at,l.id loop
  if remaining=0 then exit;end if;if lot.available<=0 then continue;end if;take:=least(remaining,lot.available);
  reserved:=finance_private.finance_lock_credit(lot.id,(p_qualified_proof->>'payer_account_id')::uuid,take,'allocation',allocation,p_context,p_line_key||':'||lot.id);
  perform finance_private.finance_commit_credit((reserved->>'credit_reservation_id')::uuid,'allocation',allocation,p_context);credit_ids:=array_append(credit_ids,lot.id);remaining:=remaining-take;
 end loop;
 if remaining<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 posting:=finance_private.finance_post_balanced('payment-allocation:'||allocation,'payment_allocation',allocation,c.currency,now(),jsonb_build_array(
  jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',t.id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'enrollment_id',c.enrollment_id,'signed_minor',p_amount_minor),
  jsonb_build_object('account_code','receivable','transfer_id',t.id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'enrollment_id',c.enrollment_id,'signed_minor',-p_amount_minor)),p_context);
 insert into finance_private.payment_allocations(id,transfer_id,charge_id,amount_minor,currency,payer_binding_id,review_case_id,receipt_id,evidence_version,payment_plan_id,plan_target_id,payer_intent_acceptance_id,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at)
 values(allocation,t.id,c.id,p_amount_minor,c.currency,t.current_payer_binding_id,(p_qualified_proof->>'case_id')::uuid,(p_qualified_proof->>'receipt_id')::uuid,(p_qualified_proof->>'evidence_version')::int,(p_qualified_proof->>'payment_plan_id')::uuid,(target->>'plan_target_id')::uuid,(p_qualified_proof->>'payer_intent_acceptance_id')::uuid,posting,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,p_line_key,now());
 update finance_private.charge_accounts set version=charge_accounts.version+1,updated_at=now() where charge_id=c.id returning charge_accounts.version into version;
 update finance_private.incoming_transfers set version=incoming_transfers.version+1,updated_at=now() where id=t.id;
 return jsonb_build_object('allocation_id',allocation,'credit_source_ids',credit_ids,'amount_minor',p_amount_minor,'charge_version',version);
end $$;

create or replace function finance_private.finance_reverse_allocation(p_allocation_id uuid,p_amount_minor bigint,p_reason text,p_source_type text,p_source_id uuid,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into finance_private.allocation_reversals(id,allocation_id,amount_minor,reason,reversal_kind,domain_source_id,replacement_allocation_id,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at) values(reversal,a.id,p_amount_minor,p_reason,p_source_type,p_source_id,case when p_source_type='correction' then (p_context->>'new_allocation_id')::uuid else null end,posting,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,p_line_key,now());
 if p_source_type<>'bank_reversal' then
  insert into finance_private.customer_credit_lots(transfer_id,payer_binding_id,payer_account_id,origin_kind,source_allocation_id,source_adjustment_id,original_minor,currency,command_id,source_line_key)
  select a.transfer_id,a.payer_binding_id,b.payer_account_id,'allocation_release',a.id,case when p_source_type='charge_credit' then p_source_id else null end,p_amount_minor,a.currency,(p_context->>'command_id')::uuid,p_line_key from finance_private.transfer_payer_bindings b where b.id=a.payer_binding_id returning id into lot;
  insert into finance_private.credit_lot_accounts(credit_lot_id) values(lot);
 end if;
 update finance_private.charge_accounts set version=charge_accounts.version+1,updated_at=now() where charge_id=c.id returning charge_accounts.version into version;
 update finance_private.incoming_transfers set version=incoming_transfers.version+1,updated_at=now() where id=a.transfer_id;
 return jsonb_build_object('reversal_id',reversal,'released_credit_lot_ids',case when lot is null then '[]'::jsonb else jsonb_build_array(lot) end,'charge_version',version);
end $$;

create or replace function finance_private.finance_charge_balance(p_charge_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;adjustments numeric;cash numeric;package_value numeric;net numeric;balance numeric;begin
 select * into c from finance_private.charges where id=p_charge_id;if c.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from finance_private.charge_accounts where charge_id=c.id;
 select coalesce(sum(signed_minor),0) into adjustments from finance_private.charge_adjustments where charge_id=c.id;
 select -coalesce(sum(l.signed_minor),0) into cash from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where l.charge_id=c.id and l.account_code='receivable' and t.source_type in('payment_allocation','allocation_reversal');
 package_value:=finance_private.finance_package_applied_value(c.id);net:=c.amount_minor+adjustments;balance:=net-cash-package_value;
 if greatest(abs(adjustments),abs(cash),abs(package_value),abs(net),abs(balance))>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 -- Refund/source reconciliation projections are extended with their actual source rows before refund commands are enabled.
 return jsonb_build_object('charge_id',c.id,'version',a.version,'currency',c.currency,'original_minor',c.amount_minor,'adjustments_minor',adjustments,'commercial_net_minor',net,'allocated_cash_minor',cash,'allocated_package_value_minor',package_value,'receivable_minor',balance,'refund_reserved_minor',coalesce((select sum(rs.amount_minor) from finance_private.refund_source_reservations rs join finance_private.credit_reservations cr on cr.id=rs.credit_reservation_id join finance_private.payment_allocations pa on pa.id=rs.source_allocation_id where pa.charge_id=c.id and cr.state='reserved'),0),'refunded_minor',coalesce((select sum(rs.amount_minor) from finance_private.refund_source_reservations rs join finance_private.payment_allocations pa on pa.id=rs.source_allocation_id join finance_private.refund_attempts ra on rs.id=any(ra.source_reservation_ids) join finance_private.refund_outcomes ro on ro.attempt_id=ra.id and ro.outcome='settled' where pa.charge_id=c.id),0),'credit_released_minor',coalesce((select sum(l.original_minor) from finance_private.customer_credit_lots l join finance_private.payment_allocations pa on pa.id=l.source_allocation_id where pa.charge_id=c.id),0),'reconciliation_state',case when exists(select 1 from finance_private.payment_allocations pa where pa.charge_id=c.id and finance_private.finance_transfer_balance(pa.transfer_id)->>'reconciliation_state'<>'clear') then 'requires_review' else 'clear' end,'recovery_exposure_minor',0);
end $$;

notify pgrst,'reload schema';
