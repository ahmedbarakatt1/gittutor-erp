grant create on schema api,app_private,finance_private to git_tutor_commands;
create function finance_private.finance_current_amendment_proof(p_reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.amendment_funding_reservations%rowtype;t finance_private.incoming_transfers%rowtype;b finance_private.transfer_payer_bindings%rowtype;plan app_private.payment_allocation_plans%rowtype;target app_private.payment_plan_targets%rowtype;intent app_private.transfer_payment_plan_acceptances%rowtype;link app_private.transfer_payment_plan_links%rowtype;receipt app_private.receipts%rowtype;begin
 select * into r from finance_private.amendment_funding_reservations where id=p_reservation_id;
 if r.id is null or r.state<>'reserved' or r.expires_at<=now() then raise exception 'CONSENT_REQUIRED';end if;
 select * into t from finance_private.incoming_transfers where id=r.transfer_id;select * into b from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
 if t.state<>'settled' or b.id is distinct from r.payer_binding_id or finance_private.finance_transfer_balance(t.id)->>'reconciliation_state'<>'clear' then raise exception 'TRANSFER_UNSETTLED';end if;
 if not coalesce(app_private.payment_verified_account(b.payer_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;
 plan:=app_private.payment_current_plan((r.qualified_proof->>'payment_plan_id')::uuid);
 select * into receipt from app_private.receipts where id=plan.receipt_id;
 if receipt.current_evidence_version is distinct from(r.qualified_proof->>'evidence_version')::int then raise exception 'EVIDENCE_REQUIRED';end if;
 select * into target from app_private.payment_plan_targets where plan_id=plan.id and charge_id=r.charge_id;
 if target.conditional_amendment_id is distinct from r.proposal_id or target.amount_minor<r.amount_minor or not coalesce(app_private.payment_verified_account(target.author_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.package_assert_scope(target.author_account_id,target.learner_id,'payments');
 select * into intent from app_private.transfer_payment_plan_acceptances where id=(r.qualified_proof->>'payer_intent_acceptance_id')::uuid;
 select * into link from app_private.transfer_payment_plan_links where id=intent.plan_link_id;
 if intent.id is null or intent.payer_account_id<>b.payer_account_id or link.state<>'accepted' or link.expires_at<=now() or link.transfer_id<>t.id or link.payer_binding_id<>b.id or link.payment_plan_id<>plan.id or link.customer_plan_hash<>plan.plan_hash or link.source_intent_hash<>intent.source_intent_hash then raise exception 'CONSENT_REQUIRED';end if;
 if not coalesce(app_private.booking_proposal_fresh(r.proposal_id),false) then raise exception 'VERSION_CONFLICT';end if;
 return jsonb_build_object('charge_id',target.charge_id,'learner_id',target.learner_id,'plan_target_id',target.id);
end $$;
create function finance_private.finance_reserve_amendment_funding(p_proposal_id uuid,p_enrollment_id uuid,p_transfer_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved finance_private.amendment_funding_reservations%rowtype;c finance_private.charges%rowtype;t finance_private.incoming_transfers%rowtype;target app_private.payment_plan_targets%rowtype;basis jsonb;lot record;reserved jsonb;ids uuid[]:='{}';left_minor bigint:=p_amount_minor;take bigint;expiry timestamptz;id uuid:=gen_random_uuid();begin
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
  reserved:=finance_private.finance_lock_credit(lot.id,(p_qualified_proof->>'payer_account_id')::uuid,take,'amendment',id,p_context,p_line_key||':'||lot.id);ids:=array_append(ids,(reserved->>'credit_reservation_id')::uuid);left_minor:=left_minor-take;
 end loop;if left_minor<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 update finance_private.credit_reservations set expires_at=expiry where id=any(ids);
 insert into finance_private.amendment_funding_reservations(id,proposal_id,enrollment_id,charge_id,transfer_id,payer_binding_id,amount_minor,qualified_proof,source_credit_reservation_ids,expires_at,command_id,source_line_key) values(id,p_proposal_id,p_enrollment_id,c.id,t.id,t.current_payer_binding_id,p_amount_minor,p_qualified_proof,ids,expiry,(p_context->>'command_id')::uuid,p_line_key);
 perform app_private.booking_enqueue_due((select occurrence_id from app_private.enrollments where enrollments.id=p_enrollment_id),expiry);
 return jsonb_build_object('funding_reservation_id',id,'source_credit_reservation_ids',ids,'reserved_minor',p_amount_minor);
end $$;
create function api.reserve_amendment_payment(p_case_id uuid,p_transfer_id uuid,p_evidence_version integer,p_payment_plan_id uuid,p_amendment_id uuid,p_enrollment_id uuid,p_amount_minor bigint,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();review app_private.review_cases%rowtype;context jsonb;proof jsonb;c finance_private.charges%rowtype;target app_private.payment_plan_targets%rowtype;already numeric;receipt_cap bigint;result jsonb;begin
 perform app_private.payment_current_staff(actor);select * into review from app_private.review_cases where id=p_case_id;
 if review.id is null then raise exception 'NOT_FOUND';end if;
 if not app_private.has_role(actor,'admin') and(review.owner_id is distinct from actor or review.claim_expires_at is null or review.claim_expires_at<=now()) then raise exception 'OWNER_REQUIRED';end if;
 select * into c from finance_private.charges where enrollment_id=p_enrollment_id;if c.id is null then raise exception 'NOT_FOUND';end if;
 proof:=app_private.finance_qualified_proof(p_case_id,p_evidence_version,p_transfer_id,array[c.id],p_payment_plan_id,actor);
 context:=app_private.booking_begin(actor,'reserve_amendment_payment',jsonb_build_object('case_id',p_case_id,'transfer_id',p_transfer_id,'evidence_version',p_evidence_version,'payment_plan_id',p_payment_plan_id,'amendment_id',p_amendment_id,'enrollment_id',p_enrollment_id,'amount_minor',p_amount_minor,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.booking_lock_financial_scope(finance_private.finance_discover_scope(array[c.id],array[p_transfer_id],'{}','{}'));
 select * into review from app_private.review_cases where id=p_case_id;if review.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 proof:=app_private.finance_qualified_proof(p_case_id,p_evidence_version,p_transfer_id,array[c.id],p_payment_plan_id,actor);
 select * into target from app_private.payment_plan_targets where plan_id=p_payment_plan_id and charge_id=c.id;
 select coalesce(sum(amount_minor),0) into already from finance_private.amendment_funding_reservations where qualified_proof->>'payment_plan_id'=p_payment_plan_id::text and charge_id=c.id and state in('reserved','consumed');
 if target.id is null or target.conditional_amendment_id is distinct from p_amendment_id or p_amount_minor is null or already+p_amount_minor>target.amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 select reported_amount_minor into receipt_cap from app_private.receipt_evidence where receipt_id=review.receipt_id and evidence_version=p_evidence_version;
 select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into already from finance_private.payment_allocations a where a.receipt_id=review.receipt_id and a.evidence_version=p_evidence_version;
 already:=already+(select coalesce(sum(amount_minor),0) from finance_private.amendment_funding_reservations where qualified_proof->>'receipt_id'=review.receipt_id::text and(qualified_proof->>'evidence_version')::int=p_evidence_version and state='reserved');
 if already+p_amount_minor>receipt_cap then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 result:=finance_private.finance_reserve_amendment_funding(p_amendment_id,p_enrollment_id,p_transfer_id,p_amount_minor,proof,context,'amendment:'||p_enrollment_id);
 update app_private.review_cases set version=version+1,updated_at=now() where id=review.id returning * into review;
 return app_private.booking_finish(context,review.id,review.version,jsonb_build_object('funding_reservation_id',result->'funding_reservation_id','reserved_minor',result->'reserved_minor','confirmation_status','AMENDMENT_PENDING'),'amendment_payment_reserved',jsonb_build_object('amendment_id',p_amendment_id,'enrollment_id',p_enrollment_id));
end $$;
create function finance_private.finance_commit_amendment_funding(p_proposal_id uuid,p_enrollment_id uuid,p_charge_id uuid,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare r finance_private.amendment_funding_reservations%rowtype;c finance_private.charges%rowtype;target jsonb;allocation uuid;posting uuid;credit uuid;ids uuid[]:='{}';begin
 select * into c from finance_private.charges where id=p_charge_id;
 if c.enrollment_id is distinct from p_enrollment_id then raise exception 'STATE_CONFLICT';end if;
 for r in select * from finance_private.amendment_funding_reservations where proposal_id=p_proposal_id and enrollment_id=p_enrollment_id and state='reserved' order by id for update loop
  target:=finance_private.finance_current_amendment_proof(r.id);
  if r.charge_id<>c.id or(finance_private.finance_charge_balance(c.id)->>'receivable_minor')::bigint<r.amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  allocation:=gen_random_uuid();
  foreach credit in array r.source_credit_reservation_ids loop perform finance_private.finance_commit_credit(credit,'allocation',allocation,p_context);end loop;
  posting:=finance_private.finance_post_balanced('payment-allocation:'||allocation,'payment_allocation',allocation,c.currency,now(),jsonb_build_array(jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',r.transfer_id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'enrollment_id',c.enrollment_id,'signed_minor',r.amount_minor),jsonb_build_object('account_code','receivable','transfer_id',r.transfer_id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'enrollment_id',c.enrollment_id,'signed_minor',-r.amount_minor)),p_context);
  insert into finance_private.payment_allocations(id,transfer_id,charge_id,amount_minor,currency,payer_binding_id,review_case_id,receipt_id,evidence_version,payment_plan_id,plan_target_id,payer_intent_acceptance_id,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at) values(allocation,r.transfer_id,c.id,r.amount_minor,c.currency,r.payer_binding_id,(r.qualified_proof->>'case_id')::uuid,(r.qualified_proof->>'receipt_id')::uuid,(r.qualified_proof->>'evidence_version')::int,(r.qualified_proof->>'payment_plan_id')::uuid,(target->>'plan_target_id')::uuid,(r.qualified_proof->>'payer_intent_acceptance_id')::uuid,posting,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'amendment-reservation:'||r.id,now());
  update finance_private.amendment_funding_reservations set state='consumed',version=version+1,updated_at=now() where id=r.id;
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;update finance_private.incoming_transfers set version=version+1,updated_at=now() where id=r.transfer_id;ids:=array_append(ids,allocation);
 end loop;return ids;
end $$;
create function finance_private.finance_release_amendment_funding(p_proposal_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;r finance_private.amendment_funding_reservations%rowtype;credit uuid;ids uuid[]:='{}';begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;
 for r in select * from finance_private.amendment_funding_reservations where proposal_id=p.id and state='reserved' order by id for update loop
  if p.state not in('declined','expired') and r.expires_at>now() then raise exception 'STATE_CONFLICT';end if;
  foreach credit in array r.source_credit_reservation_ids loop perform finance_private.finance_release_credit(credit,p.id,p_context);end loop;
  update finance_private.amendment_funding_reservations set state='released',version=version+1,updated_at=now() where id=r.id;ids:=array_append(ids,r.id);
 end loop;return jsonb_build_object('released_reservation_ids',ids);
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_current_amendment_proof','finance_reserve_amendment_funding','finance_commit_amendment_funding','finance_release_amendment_funding')) or(n.nspname='api' and p.proname='reserve_amendment_payment') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
