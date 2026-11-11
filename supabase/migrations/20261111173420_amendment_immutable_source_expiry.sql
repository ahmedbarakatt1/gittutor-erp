create or replace function finance_private.finance_reserve_amendment_funding(p_proposal_id uuid,p_enrollment_id uuid,p_transfer_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved finance_private.amendment_funding_reservations%rowtype;c finance_private.charges%rowtype;t finance_private.incoming_transfers%rowtype;target app_private.payment_plan_targets%rowtype;basis jsonb;lot record;reserved jsonb;ids uuid[]:='{}';left_minor bigint:=p_amount_minor;take bigint;expiry timestamptz;new_id uuid:=gen_random_uuid();begin
 if p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 select * into saved from finance_private.amendment_funding_reservations where command_id=(p_context->>'command_id')::uuid and source_line_key=p_line_key;
 if saved.id is not null then if saved.proposal_id<>p_proposal_id or saved.enrollment_id<>p_enrollment_id or saved.transfer_id<>p_transfer_id or saved.amount_minor<>p_amount_minor then raise exception 'IDEMPOTENCY_CONFLICT';end if;return jsonb_build_object('funding_reservation_id',saved.id,'source_credit_reservation_ids',saved.source_credit_reservation_ids,'reserved_minor',saved.amount_minor);end if;
 select * into c from finance_private.charges where enrollment_id=p_enrollment_id;select * into t from finance_private.incoming_transfers where id=p_transfer_id;
 basis:=app_private.booking_amendment_financial_basis(p_proposal_id,p_enrollment_id);
 if c.id is null or basis->>'conditional_amendment_id' is not null or(basis->>'positive_future_debit_minor')::bigint<=0 or(basis->>'additional_required_minor')::bigint<p_amount_minor or basis->>'reason' not in('ELIGIBLE','INSUFFICIENT_FUNDS') then raise exception 'STATE_CONFLICT';end if;
 if t.current_payer_binding_id is distinct from(p_qualified_proof->>'payer_binding_id')::uuid or t.currency<>c.currency then raise exception 'EVIDENCE_REQUIRED';end if;
 select * into target from app_private.payment_plan_targets where plan_id=(p_qualified_proof->>'payment_plan_id')::uuid and charge_id=c.id;
 if target.id is null or target.conditional_amendment_id is distinct from p_proposal_id or not exists(select 1 from jsonb_array_elements(p_qualified_proof->'targets') x where x->>'plan_target_id'=target.id::text) then raise exception 'CONSENT_REQUIRED';end if;
 select least(p.expires_at,l.expires_at) into expiry from app_private.operation_proposals p join app_private.transfer_payment_plan_acceptances a on a.id=(p_qualified_proof->>'payer_intent_acceptance_id')::uuid join app_private.transfer_payment_plan_links l on l.id=a.plan_link_id where p.id=p_proposal_id;
 if expiry is null or expiry<=now() then raise exception 'CONSENT_REQUIRED';end if;
 for lot in select l.id,finance_private.finance_credit_available(l.id) available from finance_private.customer_credit_lots l where l.transfer_id=t.id and l.payer_binding_id=t.current_payer_binding_id order by l.created_at,l.id loop
  exit when left_minor=0;if lot.available<=0 then continue;end if;take:=least(left_minor,lot.available);
  reserved:=finance_private.finance_lock_credit(lot.id,(p_qualified_proof->>'payer_account_id')::uuid,take,'amendment',new_id,p_context,p_line_key||':'||lot.id);ids:=array_append(ids,(reserved->>'credit_reservation_id')::uuid);left_minor:=left_minor-take;
 end loop;if left_minor<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 -- The immutable amendment record owns the deadline; credit reservations stay locked until consumption or durable release.
 insert into finance_private.amendment_funding_reservations(id,proposal_id,enrollment_id,charge_id,transfer_id,payer_binding_id,amount_minor,qualified_proof,source_credit_reservation_ids,expires_at,command_id,source_line_key) values(new_id,p_proposal_id,p_enrollment_id,c.id,t.id,t.current_payer_binding_id,p_amount_minor,p_qualified_proof,ids,expiry,(p_context->>'command_id')::uuid,p_line_key);
 perform app_private.booking_enqueue_due((select occurrence_id from app_private.enrollments where enrollments.id=p_enrollment_id),expiry);
 return jsonb_build_object('funding_reservation_id',new_id,'source_credit_reservation_ids',ids,'reserved_minor',p_amount_minor);
end $$;


