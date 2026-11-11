-- One approved benefit reservation belongs to one refund, including failed-attempt retries.
create or replace function finance_private.finance_reserve_refund(p_refund_id uuid,p_remedy_id uuid,p_destination_version_id uuid,p_amount_minor bigint,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;v finance_private.refund_destination_versions%rowtype;plan finance_private.financial_remedy_plans%rowtype;remedy jsonb;remedy_id uuid;lot record;credit jsonb;remaining bigint:=p_amount_minor;take bigint;ids uuid[]:='{}';transfers uuid[]:='{}';allowed_lots uuid[];begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into v from finance_private.refund_destination_versions where id=p_destination_version_id;
 if r.id is null or v.id is null or v.payer_account_id<>r.payer_account_id or not exists(select 1 from finance_private.refund_destinations where id=v.destination_id and refund_id=r.id and verification_status='verified') then raise exception 'DESTINATION_UNVERIFIED';end if;
 if p_amount_minor is null or p_amount_minor not between 1 and r.requested_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 if r.requires_remedy or r.source_type='charge' then
  select * into plan from finance_private.financial_remedy_plans where id=p_remedy_id;if plan.id is null or plan.mode<>'cash' then raise exception 'REMEDY_REQUIRED';end if;
  if r.source_type='charge' and(plan.source_type<>'charge' or plan.source_id<>r.source_id) then raise exception 'REMEDY_REQUIRED';end if;
  if r.source_type='unapplied_credit' and not exists(select 1 from finance_private.payment_allocations a where a.transfer_id=r.source_id and a.id::text in(select jsonb_array_elements_text(coalesce(plan.source_ancestry->'allocation_ids','[]')))) then raise exception 'REMEDY_REQUIRED';end if;
  remedy:=finance_private.finance_reserve_remedy(plan.id,plan.source_type,plan.source_id,case when plan.consumption_id is null then 0 else floor(plan.credit_quanta::numeric*p_amount_minor/nullif(plan.value_minor,0))::bigint end,p_amount_minor,'cash',p_context||jsonb_build_object('payer_account_id',r.payer_account_id));remedy_id:=(remedy->>'remedy_reservation_id')::uuid;
  if exists(select 1 from finance_private.refund_source_reservations owned where owned.remedy_reservation_id=remedy_id and owned.refund_id<>r.id) then raise exception 'REMEDY_RESERVED';end if;
  select array_agg((x->>'credit_lot_id')::uuid) into allowed_lots from jsonb_array_elements(remedy->'cash_source_reservations')x;
 else
  if p_remedy_id is not null then raise exception 'REMEDY_REQUIRED';end if;if p_amount_minor>finance_private.finance_refundable_surplus(r.source_id) then raise exception 'INSUFFICIENT_FUNDS';end if;
  select array_agg(l.id) into allowed_lots from finance_private.customer_credit_lots l where l.transfer_id=r.source_id and l.payer_account_id=r.payer_account_id and l.origin_kind in('settlement','refund_reversal');
 end if;
 for lot in select l.*,finance_private.finance_credit_available(l.id) available from finance_private.customer_credit_lots l where l.id=any(allowed_lots) and l.payer_account_id=r.payer_account_id and(r.source_type='charge' or l.transfer_id=r.source_id) order by l.created_at,l.id loop
  exit when remaining=0;if lot.available=0 then continue;end if;take:=least(remaining,lot.available);credit:=finance_private.finance_lock_credit(lot.id,r.payer_account_id,take,'refund',r.id,p_context,'refund:'||r.id||':'||lot.id);
  insert into finance_private.refund_source_reservations(refund_id,credit_reservation_id,transfer_id,credit_lot_id,source_allocation_id,remedy_reservation_id,amount_minor) values(r.id,(credit->>'credit_reservation_id')::uuid,lot.transfer_id,lot.id,lot.source_allocation_id,remedy_id,take);
  ids:=array_append(ids,(credit->>'credit_reservation_id')::uuid);transfers:=array_append(transfers,lot.transfer_id);remaining:=remaining-take;
 end loop;if remaining<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 return jsonb_build_object('reserved_minor',p_amount_minor,'reservation_ids',ids,'source_transfer_ids',array(select distinct x from unnest(transfers)x),'payer_binding_id',r.payer_binding_id);
end $$;

create or replace function app_private.refund_cash_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;previous finance_private.refund_attempts%rowtype;context jsonb;scope jsonb;result jsonb;posting uuid;outcome uuid;source_ids uuid[];s record;settled_at timestamptz;channel text;returned numeric;expected integer:=(p_input->>'expected_version')::int;begin
 perform app_private.require_role(actor,'admin');select * into r from finance_private.refunds where id=(p_input->>'refund_id')::uuid;if r.id is null then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 scope:=finance_private.finance_discover_scope('{}','{}',array[r.id],'{}');perform app_private.booking_lock_financial_scope(scope);perform app_private.require_role(actor,'admin');
 select * into r from finance_private.refunds where id=r.id;if r.version is distinct from expected then raise exception 'VERSION_CONFLICT';end if;
 if p_name='approve_refund' then
  if r.state<>'requested' then raise exception 'STATE_CONFLICT';end if;if length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
  result:=finance_private.finance_reserve_refund(r.id,(p_input->>'remedy_id')::uuid,(p_input->>'destination_version_id')::uuid,(p_input->>'amount_minor')::bigint,context);
  update finance_private.refunds set state='approved',approved_minor=(p_input->>'amount_minor')::bigint,remedy_id=(p_input->>'remedy_id')::uuid,destination_version_id=(p_input->>'destination_version_id')::uuid,approved_by=actor,approved_at=now(),version=refunds.version+1,updated_at=now() where id=r.id returning * into r;
  result:=jsonb_build_object('reserved_minor',r.approved_minor,'state',r.state);
 elsif p_name='record_refund_attempt' then
  if r.state not in('approved','failed') then raise exception 'STATE_CONFLICT';end if;
  if exists(select 1 from finance_private.refund_source_reservations own_source join finance_private.refund_source_reservations other_source on other_source.remedy_reservation_id=own_source.remedy_reservation_id and other_source.refund_id<>own_source.refund_id where own_source.refund_id=r.id) then raise exception 'REMEDY_RESERVED';end if;
  if p_input->>'external_reference' is null or length(btrim(p_input->>'external_reference')) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
  select * into previous from finance_private.refund_attempts where refund_id=r.id order by started_at desc,id desc limit 1;
  if r.state='failed' then perform finance_private.finance_retry_refund_sources(r.id,previous.id,context);elsif previous.id is not null then raise exception 'STATE_CONFLICT';end if;
  select coalesce(array_agg(rs.id order by rs.id),'{}'),coalesce(sum(rs.amount_minor),0) into source_ids,returned from finance_private.refund_source_reservations rs join finance_private.credit_reservations cr on cr.id=rs.credit_reservation_id where rs.refund_id=r.id and cr.state='reserved';
  if returned<>r.approved_minor then raise exception 'INSUFFICIENT_FUNDS';end if;
  if exists(select 1 from finance_private.refund_attempts where destination_version_id=r.destination_version_id and external_reference=btrim(p_input->>'external_reference')) then raise exception 'DUPLICATE_TRANSFER';end if;
  insert into finance_private.refund_attempts(refund_id,previous_attempt_id,destination_version_id,external_reference,command_id,source_reservation_ids) values(r.id,previous.id,r.destination_version_id,btrim(p_input->>'external_reference'),(context->>'command_id')::uuid,source_ids) returning * into a;
  update finance_private.refunds set state='pending',version=refunds.version+1,updated_at=now() where id=r.id returning * into r;result:=jsonb_build_object('attempt_id',a.id,'state','pending');perform set_config('response.status','201',true);
 elsif p_name='reconcile_refund' then
  select * into a from finance_private.refund_attempts where id=(p_input->>'attempt_id')::uuid and refund_id=r.id;
  if a.id is null or a.state not in('pending','unknown') or r.state not in('pending','unknown') then raise exception 'STATE_CONFLICT';end if;
  if p_input->>'outcome' is null or p_input->>'outcome' not in('settled','failed','unknown') or p_input->>'external_reference' is null or length(btrim(p_input->>'external_reference')) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
  settled_at:=(p_input->>'settled_at')::timestamptz;if(p_input->>'outcome'='settled') is distinct from(settled_at is not null) then raise exception 'VALIDATION_ERROR';end if;
  if settled_at is not null and(not isfinite(settled_at) or settled_at<timestamptz '0001-01-01 00:00:00+00' or settled_at>now()) then raise exception 'INVALID_TIME';end if;
  perform app_private.payment_assert_file((p_input->>'evidence_file_id')::uuid,'refund_outcome','refund_attempt',a.id);select v.channel into channel from finance_private.refund_destination_versions v where v.id=a.destination_version_id;
  if p_input->>'outcome'='settled' and exists(select 1 from finance_private.refund_outcomes prior_outcome where prior_outcome.channel=channel and prior_outcome.outcome='settled' and prior_outcome.external_reference=btrim(p_input->>'external_reference')) then raise exception 'DUPLICATE_TRANSFER';end if;
  insert into finance_private.refund_outcomes(attempt_id,outcome,evidence_file_id,external_reference,settled_at,actor_account_id,command_id,channel) values(a.id,p_input->>'outcome',(p_input->>'evidence_file_id')::uuid,btrim(p_input->>'external_reference'),settled_at,actor,(context->>'command_id')::uuid,channel) returning id into outcome;
  if p_input->>'outcome'='settled' then posting:=finance_private.finance_settle_refund(r.id,a.id,outcome,context);
  elsif p_input->>'outcome'='failed' then
   for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by credit_lot_id,id loop perform finance_private.finance_release_credit(s.credit_reservation_id,outcome,context);if s.remedy_reservation_id is not null then perform finance_private.finance_release_remedy(s.remedy_reservation_id,outcome,context);end if;end loop;
  end if;
  update finance_private.refund_attempts set state=p_input->>'outcome',version=refund_attempts.version+1,updated_at=now() where id=a.id;
  update finance_private.refunds set state=p_input->>'outcome',version=refunds.version+1,updated_at=now() where id=r.id returning * into r;result:=jsonb_build_object('state',r.state,'ledger_transaction_id',posting);
 elsif p_name='record_refund_reversal' then
  result:=finance_private.finance_record_refund_reversal(r.id,(p_input->>'attempt_id')::uuid,p_input->>'external_reversal_id',(p_input->>'amount_minor')::bigint,(p_input->>'evidence_file_id')::uuid,(p_input->>'effective_at')::timestamptz,context);
  select coalesce(sum(amount_minor),0) into returned from finance_private.refund_reversals where refund_id=r.id;
  update finance_private.refunds set state=case when returned>=approved_minor then 'reversed' else 'partially_reversed' end,version=refunds.version+1,updated_at=now() where id=r.id returning * into r;result:=result-'returned_credit_lot_ids';
 else raise exception 'VALIDATION_ERROR';end if;
 for s in select distinct transfer_id from finance_private.refund_source_reservations where refund_id=r.id loop
  update finance_private.incoming_transfers set version=incoming_transfers.version+1,updated_at=now() where id=s.transfer_id;
  if(finance_private.finance_transfer_balance(s.transfer_id)->>'recovery_exposure_minor')::bigint>0 and not exists(select 1 from app_private.reconciliation_exceptions where source_type='transfer' and source_id=s.transfer_id and state='open') then insert into app_private.reconciliation_exceptions(source_type,source_id,kind,signed_exposure_minor,currency,reason) values('transfer',s.transfer_id,'refund_source_overlap',-(finance_private.finance_transfer_balance(s.transfer_id)->>'recovery_exposure_minor')::bigint,'EGP','Independently evidenced outgoing cash exceeds the remaining original source');end if;
 end loop;
 return app_private.booking_finish(context,r.id,r.version,result,p_name,jsonb_build_object('refund_id',r.id));
end $$;


notify pgrst,'reload schema';
