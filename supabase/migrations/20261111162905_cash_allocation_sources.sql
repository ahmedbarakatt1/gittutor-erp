-- Exact source credits and proof-qualified allocations. Callers hold the complete domain/source graph.
grant create on schema api,app_private,finance_private to git_tutor_commands;
create function finance_private.finance_lock_credit(p_credit_lot_id uuid,p_payer_account_id uuid,p_amount_minor bigint,p_purpose text,p_source_id uuid,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare l finance_private.customer_credit_lots%rowtype;r finance_private.credit_reservations%rowtype;t finance_private.incoming_transfers%rowtype;b jsonb;begin
 if p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 or p_purpose not in('allocation','refund','package_grant','amendment') or p_source_id is null then raise exception 'VALIDATION_ERROR';end if;
 select * into l from finance_private.customer_credit_lots where id=p_credit_lot_id;if l.id is null or l.payer_account_id is distinct from p_payer_account_id then raise exception 'FORBIDDEN';end if;
 select * into t from finance_private.incoming_transfers where id=l.transfer_id for update;perform 1 from finance_private.credit_lot_accounts where credit_lot_id=l.id for update;
 select * into r from finance_private.credit_reservations where command_id=(p_context->>'command_id')::uuid and source_line_key=p_line_key;
 if r.id is not null then if r.credit_lot_id<>l.id or r.amount_minor<>p_amount_minor or r.purpose<>p_purpose or r.source_id<>p_source_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 else
  if t.state<>'settled' or t.current_payer_binding_id is distinct from l.payer_binding_id then raise exception 'TRANSFER_UNSETTLED';end if;
  b:=finance_private.finance_transfer_balance(t.id);if b->>'reconciliation_state'<>'clear' then raise exception 'STATE_CONFLICT';end if;
  if finance_private.finance_credit_available(l.id)<p_amount_minor or(b->>'available_minor')::bigint<p_amount_minor then raise exception 'INSUFFICIENT_FUNDS';end if;
  insert into finance_private.credit_reservations(credit_lot_id,amount_minor,purpose,source_id,command_id,source_line_key) values(l.id,p_amount_minor,p_purpose,p_source_id,(p_context->>'command_id')::uuid,p_line_key) returning * into r;
  update finance_private.credit_lot_accounts set version=version+1,updated_at=now() where credit_lot_id=l.id;
 end if;
 return jsonb_build_object('credit_reservation_id',r.id,'credit_lot_id',l.id,'transfer_id',l.transfer_id,'payer_binding_id',l.payer_binding_id,'payer_account_id',l.payer_account_id,'amount_minor',r.amount_minor,'currency',l.currency,'source_allocation_id',l.source_allocation_id);
end $$;
create function finance_private.finance_commit_credit(p_reservation_id uuid,p_application_type text,p_application_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.credit_reservations%rowtype;a finance_private.credit_applications%rowtype;begin
 select * into r from finance_private.credit_reservations where id=p_reservation_id for update;if r.id is null then raise exception 'NOT_FOUND';end if;
 select * into a from finance_private.credit_applications where credit_reservation_id=r.id;
 if a.id is not null then if a.application_type is distinct from p_application_type or a.application_id is distinct from p_application_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return;end if;
 if r.state<>'reserved' or(r.expires_at is not null and r.expires_at<=now()) or p_application_id is null or p_application_type not in('allocation','refund','package_grant','amendment') then raise exception 'STATE_CONFLICT';end if;
 insert into finance_private.credit_applications(credit_reservation_id,application_type,application_id,amount_minor,command_id) values(r.id,p_application_type,p_application_id,r.amount_minor,(p_context->>'command_id')::uuid);
 update finance_private.credit_reservations set state='consumed',version=version+1,updated_at=now() where id=r.id;
 update finance_private.credit_lot_accounts set version=version+1,updated_at=now() where credit_lot_id=r.credit_lot_id;
end $$;
create function finance_private.finance_release_credit(p_reservation_id uuid,p_resolution_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.credit_reservations%rowtype;begin
 select * into r from finance_private.credit_reservations where id=p_reservation_id for update;if r.id is null or p_resolution_id is null then raise exception 'NOT_FOUND';end if;
 if r.state='released' then return;end if;if r.state<>'reserved' then raise exception 'STATE_CONFLICT';end if;
 update finance_private.credit_reservations set state='released',version=version+1,updated_at=now() where id=r.id;
 update finance_private.credit_lot_accounts set version=version+1,updated_at=now() where credit_lot_id=r.credit_lot_id;
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values((p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'credit_reservation_released',r.id,jsonb_build_object('resolution_id',p_resolution_id));
end $$;
create function app_private.finance_qualified_proof(p_case_id uuid,p_evidence_version integer,p_transfer_id uuid,p_charge_ids uuid[],p_payment_plan_id uuid,p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare review app_private.review_cases%rowtype;r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;t finance_private.incoming_transfers%rowtype;b finance_private.transfer_payer_bindings%rowtype;plan app_private.payment_allocation_plans%rowtype;link app_private.transfer_payment_plan_links%rowtype;acceptance uuid;target record;targets jsonb:='[]';begin
 perform app_private.payment_current_staff(p_actor);select * into review from app_private.review_cases where id=p_case_id;
 if review.id is null then raise exception 'NOT_FOUND';end if;
 if not app_private.has_role(p_actor,'admin') and(review.owner_id is distinct from p_actor or review.claim_expires_at<=now() or review.claim_expires_at is null) then raise exception 'OWNER_REQUIRED';end if;
 if review.state not in('claimed','needs_information','escalated') then raise exception 'STATE_CONFLICT';end if;
 select * into r from app_private.receipts where id=review.receipt_id;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
 if e.evidence_version is distinct from p_evidence_version or review.current_evidence_version<>p_evidence_version or e.state<>'ready_for_review' then raise exception 'EVIDENCE_REQUIRED';end if;
 perform app_private.payment_verified_account(e.uploader_account_id);perform app_private.package_assert_scope(e.uploader_account_id,e.learner_id,'payments');perform app_private.payment_assert_file(e.file_id,'payment_receipt','charge',e.charge_id,e.uploader_account_id);
 select * into t from finance_private.incoming_transfers where id=p_transfer_id;select * into b from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
 if t.id is null then raise exception 'NOT_FOUND';end if;if t.state<>'settled' or not exists(select 1 from finance_private.transfer_settlements where transfer_id=t.id) then raise exception 'TRANSFER_UNSETTLED';end if;
 if b.id is null then raise exception 'CONSENT_REQUIRED';end if;perform app_private.payment_verified_account(b.payer_account_id);
 if e.receiving_account_version_id<>t.receiving_account_version_id or e.channel<>t.channel or e.currency<>t.currency then raise exception 'EVIDENCE_REQUIRED';end if;
 if p_payment_plan_id is null then
  if cardinality(p_charge_ids)<>1 or p_charge_ids[1]<>e.charge_id or e.uploader_account_id<>b.payer_account_id then raise exception 'CONSENT_REQUIRED';end if;
  targets:=jsonb_build_array(jsonb_build_object('charge_id',e.charge_id,'learner_id',e.learner_id,'evidence_id',e.id,'plan_target_id',null,'authority_ref',e.submission_authority));
 else
  select * into plan from app_private.payment_allocation_plans where id=p_payment_plan_id;
  if plan.id is null or plan.receipt_id<>r.id or plan.evidence_version<>e.evidence_version or plan.state<>'active' then raise exception 'CONSENT_REQUIRED';end if;
  select l.* into link from app_private.transfer_payment_plan_links l join app_private.transfer_payment_plan_acceptances a on a.plan_link_id=l.id and a.source_intent_hash=l.source_intent_hash where l.payment_plan_id=plan.id and l.transfer_id=t.id and l.payer_binding_id=b.id and l.state='accepted' and l.expires_at>now() order by l.created_at desc,l.id limit 1;
  if link.id is null then raise exception 'CONSENT_REQUIRED';end if;select id into acceptance from app_private.transfer_payment_plan_acceptances where plan_link_id=link.id and payer_account_id=b.payer_account_id;
  if acceptance is null then raise exception 'CONSENT_REQUIRED';end if;
  for target in select pt.* from app_private.payment_plan_targets pt where pt.plan_id=plan.id and pt.charge_id=any(p_charge_ids) order by pt.charge_id loop
   if target.receipt_evidence_id<>e.id or target.file_id<>e.file_id or target.checksum_sha256<>e.checksum_sha256 then raise exception 'EVIDENCE_REQUIRED';end if;
   perform app_private.payment_verified_account(target.author_account_id);perform app_private.package_assert_scope(target.author_account_id,target.learner_id,'payments');
   targets:=targets||jsonb_build_array(jsonb_build_object('charge_id',target.charge_id,'learner_id',target.learner_id,'evidence_id',e.id,'plan_target_id',target.id,'authority_ref',target.authority_ref));
  end loop;
  if jsonb_array_length(targets)<>cardinality(p_charge_ids) then raise exception 'CONSENT_REQUIRED';end if;
 end if;
 return jsonb_build_object('case_id',review.id,'receipt_id',r.id,'evidence_version',e.evidence_version,'payer_binding_id',b.id,'payer_account_id',b.payer_account_id,'payment_plan_id',p_payment_plan_id,'payer_intent_acceptance_id',acceptance,'targets',targets);
end $$;
create function finance_private.finance_allocate_cash(p_transfer_id uuid,p_charge_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c finance_private.charges%rowtype;t finance_private.incoming_transfers%rowtype;saved finance_private.payment_allocations%rowtype;target jsonb;allocation uuid:=gen_random_uuid();posting uuid;lot record;reserved jsonb;credit_ids uuid[]:='{}';remaining bigint:=p_amount_minor;take bigint;version integer;begin
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
create function api.allocate_transfer(p_case_id uuid,p_transfer_id uuid,p_evidence_version integer,p_payment_plan_id uuid,p_allocations jsonb,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 for occurrence in select distinct e.occurrence_id from app_private.enrollments e join finance_private.charges c on c.enrollment_id=e.id where c.id=any(ids) order by e.occurrence_id loop
  if exists(select 1 from finance_private.charge_accounts a join finance_private.charges c on c.id=a.charge_id join app_private.enrollments e on e.id=c.enrollment_id where c.id=any(ids) and e.occurrence_id=occurrence and a.commitment_state='awaiting_amendment') then result:=jsonb_build_object('state','awaiting_requirements','occurrence_id',occurrence,'reason','AMENDMENT_PENDING');else result:=app_private.booking_try_confirm_locked(occurrence,context);end if;
  confirmations:=confirmations||jsonb_build_array(result);
 end loop;
 if confirmations='[]' then confirmations:=jsonb_build_array(jsonb_build_object('state','not_applicable','occurrence_id',null,'reason',null));end if;
 update app_private.review_cases set version=review_cases.version+1,updated_at=now() where id=review.id returning review_cases.version into version;
 insert into app_private.review_case_events(case_id,event_type,evidence_version,owner_id,actor_account_id,command_id,details) values(review.id,'transfer_allocated',p_evidence_version,review.owner_id,actor,(context->>'command_id')::uuid,jsonb_build_object('allocation_ids',allocations));
 return app_private.booking_finish(context,review.id,version,jsonb_build_object('allocation_ids',allocations,'unapplied_minor',finance_private.finance_transfer_balance(p_transfer_id)->'unapplied_signed_minor','confirmation_status',confirmations),'transfer_allocated',jsonb_build_object('case_id',review.id,'transfer_id',p_transfer_id));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_lock_credit','finance_commit_credit','finance_release_credit','finance_allocate_cash')) or(n.nspname='app_private' and p.proname='finance_qualified_proof') or(n.nspname='api' and p.proname='allocate_transfer') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
