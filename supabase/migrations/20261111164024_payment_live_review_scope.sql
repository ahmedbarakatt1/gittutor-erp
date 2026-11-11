create or replace function api.allocate_transfer(p_case_id uuid,p_transfer_id uuid,p_evidence_version integer,p_payment_plan_id uuid,p_allocations jsonb,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();review app_private.review_cases%rowtype;context jsonb;scope jsonb;proof jsonb;item jsonb;ids uuid[]:='{}';allocations uuid[]:='{}';result jsonb;confirmations jsonb:='[]';amount bigint;total numeric:=0;receipt_total bigint;already numeric;target app_private.payment_plan_targets%rowtype;c finance_private.charges%rowtype;occurrence uuid;funding jsonb;version integer;begin
 perform app_private.payment_current_staff(actor);select * into review from app_private.review_cases where id=p_case_id;if review.id is null then raise exception 'NOT_FOUND';end if;
 if not app_private.has_role(actor,'admin') and(review.owner_id is distinct from actor or review.claim_expires_at is null or review.claim_expires_at<=now()) then raise exception 'OWNER_REQUIRED';end if;
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

create or replace function app_private.payment_plan_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();context jsonb;r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;review app_private.review_cases%rowtype;plan app_private.payment_allocation_plans%rowtype;t finance_private.incoming_transfers%rowtype;binding finance_private.transfer_payer_bindings%rowtype;link app_private.transfer_payment_plan_links%rowtype;c finance_private.charges%rowtype;item jsonb;targets jsonb:='[]';ids uuid[]:='{}';total numeric:=0;amount bigint;plan_version integer;resource uuid;version integer;hash text;acceptance uuid;expiry timestamptz;result jsonb;begin
 if p_name='authorize_payment_plan' then
  select * into r from app_private.receipts where id=(p_input->>'receipt_id')::uuid;if r.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,r.learner_id,'payments');
 elsif p_name='link_transfer_payment_plan' then
  perform app_private.payment_current_staff(actor);select * into review from app_private.review_cases where id=(p_input->>'case_id')::uuid;if review.id is null then raise exception 'NOT_FOUND';end if;
  if not app_private.has_role(actor,'admin') and(review.owner_id is distinct from actor or review.claim_expires_at is null or review.claim_expires_at<=now()) then raise exception 'OWNER_REQUIRED';end if;
 elsif p_name='accept_transfer_payment_plan' then
  select * into t from finance_private.incoming_transfers where id=(p_input->>'transfer_id')::uuid;select * into binding from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
  if binding.payer_account_id is distinct from actor then raise exception 'FORBIDDEN';end if;
 else raise exception 'VALIDATION_ERROR';end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_name='authorize_payment_plan' then
  perform 1 from app_private.review_cases where receipt_id=r.id for update;select * into r from app_private.receipts where id=r.id for update;
  if r.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;
  select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
  if e.state<>'ready_for_review' or e.uploader_account_id<>actor then raise exception 'EVIDENCE_REQUIRED';end if;
  perform app_private.payment_assert_file(e.file_id,'payment_receipt','charge',e.charge_id,actor);
  if jsonb_typeof(p_input->'targets') is distinct from 'array' or jsonb_array_length(p_input->'targets') not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
  for item in select value from jsonb_array_elements(p_input->'targets') order by value->>'charge_id' loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['charge_id','amount_minor','conditional_amendment_id']<>'{}'::jsonb or jsonb_typeof(item->'charge_id') is distinct from 'string' or item->>'charge_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'VALIDATION_ERROR';end if;
   if(item->>'charge_id')::uuid=any(ids) then raise exception 'VALIDATION_ERROR';end if;ids:=array_append(ids,(item->>'charge_id')::uuid);
   select * into c from finance_private.charges where id=(item->>'charge_id')::uuid;if c.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,c.learner_id,'payments');
   amount:=app_private.package_safe_integer(item->'amount_minor',1);total:=total+amount;
   if item->>'conditional_amendment_id' is not null and(c.enrollment_id is null or not exists(select 1 from app_private.group_amendments g join app_private.operation_proposals p on p.id=g.id join app_private.enrollments en on en.occurrence_id=p.occurrence_id where g.id=(item->>'conditional_amendment_id')::uuid and en.id=c.enrollment_id and p.state in('proposed','partially_accepted','accepted','approved') and p.expires_at>now())) then raise exception 'STATE_CONFLICT';end if;
   targets:=targets||jsonb_build_array(jsonb_build_object('charge_id',c.id,'amount_minor',amount,'conditional_amendment_id',(item->>'conditional_amendment_id')::uuid));
  end loop;
  if total>9007199254740991 or total>e.reported_amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  hash:=app_private.catalog_hash(jsonb_build_object('receipt_id',r.id,'evidence_id',e.id,'checksum_sha256',e.checksum_sha256,'author_account_id',actor,'targets',targets));
  select coalesce(max(p.plan_version),0)+1 into plan_version from app_private.payment_allocation_plans p where p.receipt_id=r.id;
  update app_private.payment_allocation_plans set state='superseded' where receipt_id=r.id and state='active';
  update app_private.transfer_payment_plan_links set state='invalidated',version=transfer_payment_plan_links.version+1,updated_at=now() where payment_plan_id in(select id from app_private.payment_allocation_plans where receipt_id=r.id);
  insert into app_private.payment_allocation_plans(receipt_id,evidence_version,author_account_id,plan_version,plan_hash,command_id) values(r.id,e.evidence_version,actor,plan_version,hash,(context->>'command_id')::uuid) returning * into plan;
  for item in select value from jsonb_array_elements(targets) loop
   select * into c from finance_private.charges where id=(item->>'charge_id')::uuid;
   insert into app_private.payment_plan_targets(plan_id,charge_id,learner_id,amount_minor,conditional_amendment_id,receipt_evidence_id,receipt_id,evidence_version,file_id,checksum_sha256,author_account_id,authority_ref) values(plan.id,c.id,c.learner_id,(item->>'amount_minor')::bigint,(item->>'conditional_amendment_id')::uuid,e.id,r.id,e.evidence_version,e.file_id,e.checksum_sha256,actor,jsonb_build_object('actor_account_id',actor,'learner_id',c.learner_id,'scope','payments','checked_at',now()));
  end loop;
  update app_private.receipts set version=receipts.version+1,updated_at=now() where id=r.id;
  resource:=plan.id;version:=plan.plan_version;result:=jsonb_build_object('payment_plan_id',plan.id,'plan_version',plan.plan_version,'plan_hash',hash);perform set_config('response.status','201',true);
 elsif p_name='link_transfer_payment_plan' then
  select * into review from app_private.review_cases where id=review.id for update;
  if review.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;
  if not app_private.has_role(actor,'admin') and(review.owner_id is distinct from actor or review.claim_expires_at is null or review.claim_expires_at<=now()) then raise exception 'OWNER_REQUIRED';end if;
  select * into r from app_private.receipts where id=review.receipt_id for update;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
  plan:=app_private.payment_current_plan((p_input->>'payment_plan_id')::uuid);if plan.receipt_id<>r.id then raise exception 'EVIDENCE_REQUIRED';end if;
  select * into t from finance_private.incoming_transfers where id=(p_input->>'transfer_id')::uuid for update;select * into binding from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
  if t.id is null then raise exception 'NOT_FOUND';end if;if t.state<>'settled' then raise exception 'TRANSFER_UNSETTLED';end if;if binding.id is null then raise exception 'CONSENT_REQUIRED';end if;
  if e.receiving_account_version_id<>t.receiving_account_version_id or e.channel<>t.channel or e.currency<>t.currency then raise exception 'EVIDENCE_REQUIRED';end if;
  select sum(amount_minor) into total from app_private.payment_plan_targets where plan_id=plan.id;if total>t.amount_minor or total>e.reported_amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  expiry:=now()+interval '24 hours';hash:=app_private.catalog_hash(jsonb_build_object('transfer_id',t.id,'receiving_account_id',t.receiving_account_id,'external_id',t.external_id,'amount_minor',t.amount_minor,'currency',t.currency,'payer_binding_id',binding.id,'payment_plan_id',plan.id,'customer_plan_hash',plan.plan_hash,'evidence_id',e.id,'expires_at',expiry));
  insert into app_private.transfer_payment_plan_links(case_id,transfer_id,payer_binding_id,payment_plan_id,customer_plan_hash,source_intent_hash,expires_at,created_by) values(review.id,t.id,binding.id,plan.id,plan.plan_hash,hash,expiry,actor) returning * into link;
  update app_private.review_cases set version=review_cases.version+1,updated_at=now() where id=review.id;
  resource:=link.id;version:=link.version;result:=jsonb_build_object('plan_link_id',link.id,'state',link.state,'plan_hash',hash,'expires_at',expiry);perform set_config('response.status','201',true);
 else
  select * into link from app_private.transfer_payment_plan_links where transfer_id=t.id and payment_plan_id=(p_input->>'payment_plan_id')::uuid and source_intent_hash=p_input->>'plan_hash' order by created_at desc,id limit 1;
  if link.id is null then raise exception 'CONSENT_REQUIRED';end if;
  -- Same case/receipt -> transfer -> link order as staff linking; no booking/financial posting here.
  perform 1 from app_private.review_cases where id=link.case_id for update;perform 1 from app_private.receipts where id=(select receipt_id from app_private.payment_allocation_plans where id=link.payment_plan_id) for update;
  select * into t from finance_private.incoming_transfers where id=t.id for update;select * into link from app_private.transfer_payment_plan_links where id=link.id for update;
  if link.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;
  if link.state<>'awaiting_payer_acceptance' or link.expires_at<=now() or link.payer_binding_id is distinct from t.current_payer_binding_id then raise exception 'CONSENT_REQUIRED';end if;
  select * into binding from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;if binding.payer_account_id is distinct from actor then raise exception 'FORBIDDEN';end if;
  plan:=app_private.payment_current_plan(link.payment_plan_id);if plan.plan_hash<>link.customer_plan_hash then raise exception 'CONSENT_REQUIRED';end if;
  insert into app_private.transfer_payment_plan_acceptances(plan_link_id,payer_account_id,auth_session_id,source_intent_hash,command_id) values(link.id,actor,(current_setting('request.jwt.claims',true)::jsonb->>'session_id')::uuid,link.source_intent_hash,(context->>'command_id')::uuid) returning id into acceptance;
  update app_private.transfer_payment_plan_links set state='accepted',version=transfer_payment_plan_links.version+1,updated_at=now() where id=link.id returning transfer_payment_plan_links.version into version;
  resource:=link.id;result:=jsonb_build_object('payer_intent_acceptance_id',acceptance,'plan_link_id',link.id,'state','accepted');
 end if;
 return app_private.booking_finish(context,resource,version,result,p_name,jsonb_build_object('resource_id',resource));
end $$;

