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
create or replace function finance_private.finance_retry_refund_sources(p_refund_id uuid,p_previous_attempt_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;s finance_private.refund_source_reservations%rowtype;prior app_private.remedy_reservations%rowtype;plan finance_private.financial_remedy_plans%rowtype;credit jsonb;begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into a from finance_private.refund_attempts where id=p_previous_attempt_id and refund_id=r.id;
 if a.id is null or a.state<>'failed' or not exists(select 1 from finance_private.refund_outcomes where attempt_id=a.id and outcome='failed') then raise exception 'STATE_CONFLICT';end if;
 for prior in select distinct mr.* from app_private.remedy_reservations mr join finance_private.refund_source_reservations rs on rs.remedy_reservation_id=mr.id where rs.id=any(a.source_reservation_ids) loop
  select * into plan from finance_private.financial_remedy_plans where id=prior.remedy_id;perform finance_private.finance_reserve_remedy(plan.id,plan.source_type,plan.source_id,prior.credit_quanta,prior.value_minor,'cash',p_context||jsonb_build_object('payer_account_id',r.payer_account_id));
 end loop;
 for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by credit_lot_id,id loop
  credit:=finance_private.finance_lock_credit(s.credit_lot_id,r.payer_account_id,s.amount_minor,'refund',r.id,p_context,'retry-refund:'||s.id);
  insert into finance_private.refund_source_reservations(refund_id,credit_reservation_id,transfer_id,credit_lot_id,source_allocation_id,remedy_reservation_id,amount_minor) values(r.id,(credit->>'credit_reservation_id')::uuid,s.transfer_id,s.credit_lot_id,s.source_allocation_id,s.remedy_reservation_id,s.amount_minor);
 end loop;
end $$;
create or replace function finance_private.finance_reserve_remedy(p_remedy_id uuid,p_source_type text,p_source_id uuid,p_credit_quanta bigint,p_value_minor bigint,p_mode text,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan finance_private.financial_remedy_plans%rowtype;source finance_private.remedy_sources%rowtype;prior app_private.remedy_reservations%rowtype;movement app_private.entitlement_movements%rowtype;charge finance_private.charges%rowtype;reserved uuid;used numeric;cash jsonb:='[]';payer_binding uuid;available numeric;begin
 select * into plan from finance_private.financial_remedy_plans where id=p_remedy_id;
 if plan.id is null then raise exception 'REMEDY_REQUIRED';end if;perform app_private.require_role(plan.approved_by,'admin');
 if plan.source_type is distinct from p_source_type or plan.source_id is distinct from p_source_id or plan.mode is distinct from p_mode or p_credit_quanta is null or p_value_minor is null or p_credit_quanta<0 or p_value_minor<0 or p_credit_quanta>plan.credit_quanta or p_value_minor>plan.value_minor then raise exception 'REMEDY_REQUIRED';end if;
 if p_source_type='package_consumption' then
  select * into movement from app_private.entitlement_movements where id=p_source_id and kind='consume';if movement.id is null or movement.policy_version_id<>plan.policy_version_id then raise exception 'REMEDY_REQUIRED';end if;
  perform app_private.package_lock_purchase(movement.purchase_id);
  if p_mode in('cash','account_credit') and not exists(select 1 from finance_private.package_funding_sources f join app_private.package_lots l on l.original_lot_id=f.original_lot_id where l.id=movement.lot_id) then raise exception 'INSUFFICIENT_FUNDS';end if;
  reserved:=app_private.package_reserve_remedy_kernel(movement.id,plan.id,p_credit_quanta,p_value_minor,p_mode,p_context);
 else
  select * into charge from finance_private.charges where id=p_source_id;if charge.id is null or p_credit_quanta<>0 or p_mode='restoration' then raise exception 'REMEDY_REQUIRED';end if;
  insert into finance_private.remedy_sources(charge_id,learner_id,eligible_credit_quanta,eligible_value_minor) select charge.id,charge.learner_id,0,charge.amount_minor+coalesce((select sum(signed_minor) from finance_private.charge_adjustments where charge_id=charge.id and signed_minor>0),0) on conflict(charge_id) do nothing;
  select * into source from finance_private.remedy_sources where charge_id=charge.id for update;
  select * into prior from app_private.remedy_reservations where source_id=source.id and remedy_id=plan.id;
  if prior.id is not null then if prior.credit_quanta<>p_credit_quanta or prior.value_minor<>p_value_minor or prior.mode<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT';end if;reserved:=prior.id;
  else
   select coalesce(sum(value_minor),0) into used from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed');if used+p_value_minor>source.eligible_value_minor then raise exception 'REMEDY_RESERVED';end if;
   insert into app_private.remedy_reservations(source_id,remedy_id,credit_quanta,value_minor,mode,state,command_id) values(source.id,plan.id,0,p_value_minor,p_mode,'reserved',(p_context->>'command_id')::uuid) returning id into reserved;
  end if;
 end if;
 select * into prior from app_private.remedy_reservations where id=reserved for update;
 if prior.state='consumed' then raise exception 'REMEDY_RESERVED';end if;
 if p_mode in('cash','account_credit') then
  select coalesce(jsonb_agg(jsonb_build_object('credit_lot_id',l.id,'transfer_id',l.transfer_id,'amount_minor',finance_private.finance_credit_available(l.id)) order by l.created_at,l.id),'[]'),coalesce(sum(finance_private.finance_credit_available(l.id)),0),min(l.payer_binding_id::text)::uuid into cash,available,payer_binding from finance_private.customer_credit_lots l join finance_private.payment_allocations a on a.id=l.source_allocation_id
  where l.origin_kind='allocation_release' and a.id::text in(select jsonb_array_elements_text(coalesce(plan.source_ancestry->'allocation_ids','[]'))) and(p_context->>'payer_account_id' is null or l.payer_account_id=(p_context->>'payer_account_id')::uuid) and finance_private.finance_transfer_balance(l.transfer_id)->>'reconciliation_state'='clear' and finance_private.finance_credit_available(l.id)>0;
  if available<p_value_minor then raise exception 'INSUFFICIENT_FUNDS';end if;
 end if;
 if prior.state='released' then
  select * into source from finance_private.remedy_sources where id=prior.source_id for update;select coalesce(sum(value_minor),0) into used from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed');if used+p_value_minor>source.eligible_value_minor then raise exception 'REMEDY_RESERVED';end if;
  if p_source_type='package_consumption' and p_credit_quanta+coalesce((select sum(credit_quanta) from app_private.remedy_reservations where source_id=source.id and state in('reserved','consumed')),0)>source.eligible_credit_quanta then raise exception 'REMEDY_RESERVED';end if;
  update app_private.remedy_reservations set state='reserved' where id=prior.id;
 end if;
 return jsonb_build_object('remedy_reservation_id',reserved,'source_id',prior.source_id,'consumption_id',plan.consumption_id,'credit_quanta',p_credit_quanta,'value_minor',p_value_minor,'cash_source_reservations',cash,'payer_binding_id',payer_binding);
end $$;

create or replace function finance_private.finance_settle_refund(p_refund_id uuid,p_attempt_id uuid,p_verified_outcome_id uuid,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;o finance_private.refund_outcomes%rowtype;s record;lines jsonb:='[]';posting uuid;total numeric:=0;begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into a from finance_private.refund_attempts where id=p_attempt_id and refund_id=r.id;select * into o from finance_private.refund_outcomes where id=p_verified_outcome_id and attempt_id=a.id and outcome='settled';
 if r.id is null or a.id is null or o.id is null then raise exception 'EVIDENCE_REQUIRED';end if;if o.ledger_transaction_id is not null then return o.ledger_transaction_id;end if;
 perform app_private.payment_assert_file(o.evidence_file_id,'refund_outcome','refund_attempt',a.id);
 for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by transfer_id,credit_lot_id,id loop
  if not exists(select 1 from finance_private.credit_reservations where id=s.credit_reservation_id and state='reserved' and amount_minor=s.amount_minor) then raise exception 'STATE_CONFLICT';end if;
  perform finance_private.finance_commit_credit(s.credit_reservation_id,'refund',a.id,p_context);total:=total+s.amount_minor;
  lines:=lines||jsonb_build_array(jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',s.transfer_id,'credit_lot_id',s.credit_lot_id,'refund_id',r.id,'attempt_id',a.id,'signed_minor',s.amount_minor),jsonb_build_object('account_code','channel_cash','transfer_id',s.transfer_id,'credit_lot_id',s.credit_lot_id,'refund_id',r.id,'attempt_id',a.id,'signed_minor',-s.amount_minor));
 end loop;if total<>r.approved_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 posting:=finance_private.finance_post_balanced('refund-settled:'||a.id,'refund_settled',a.id,r.currency,o.settled_at,lines,p_context);
 update finance_private.refund_outcomes set ledger_transaction_id=posting where id=o.id;for s in select distinct remedy_reservation_id from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) and remedy_reservation_id is not null loop perform finance_private.finance_commit_remedy(s.remedy_reservation_id,'refund',a.id,p_context);end loop;return posting;
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
create or replace function finance_private.finance_discover_scope(p_charge_ids uuid[],p_transfer_ids uuid[],p_refund_ids uuid[],p_consumption_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare charges uuid[]:=coalesce(p_charge_ids,'{}');transfers uuid[]:=coalesce(p_transfer_ids,'{}');refunds uuid[]:=coalesce(p_refund_ids,'{}');enrollments uuid[]:='{}';occurrences uuid[]:='{}';learners uuid[]:='{}';purchases uuid[]:='{}';lots uuid[]:='{}';sources uuid[]:='{}';before_graph jsonb;graph jsonb;iteration integer:=0;begin

 loop
  before_graph:=jsonb_build_array(charges,transfers,refunds,enrollments,occurrences,learners,purchases,lots);
  select coalesce(array_agg(id order by id),'{}') into refunds from(select unnest(refunds) id union select id from finance_private.refunds where(source_type='charge' and source_id=any(charges)) or(source_type='unapplied_credit' and source_id=any(transfers)) union select refund_id from finance_private.refund_source_reservations where transfer_id=any(transfers))x;
  select coalesce(array_agg(id order by id),'{}') into charges from(select unnest(charges) id union select source_id from finance_private.refunds where id=any(refunds) and source_type='charge' union select charge_id from finance_private.amendment_funding_reservations where transfer_id=any(transfers) and state='reserved' union select charge_id from finance_private.payment_allocations where transfer_id=any(transfers) union select id from finance_private.charges where enrollment_id=any(enrollments) or package_purchase_id=any(purchases))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into enrollments from(select unnest(enrollments) id union select enrollment_id from finance_private.charges where id=any(charges) union select id from app_private.enrollments where occurrence_id=any(occurrences))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into occurrences from(select unnest(occurrences) id union select occurrence_id from app_private.enrollments where id=any(enrollments))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select package_purchase_id from finance_private.charges where id=any(charges) union select purchase_id from finance_private.package_funding_sources where transfer_id=any(transfers) union select purchase_id from app_private.package_reservations where enrollment_id=any(enrollments) union select purchase_id from app_private.entitlement_movements where id=any(coalesce(p_consumption_ids,'{}')))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into learners from(select unnest(learners) id union select learner_id from finance_private.charges where id=any(charges) union select learner_id from app_private.enrollments where id=any(enrollments) union select learner_id from app_private.package_purchases where id=any(purchases))x where id is not null;
  -- All packages of an affected learner share one financial mutex and can be selected by a new coverage command.
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select id from app_private.package_purchases where learner_id=any(learners))x;
  select coalesce(array_agg(id order by id),'{}') into lots from app_private.package_lots where purchase_id=any(purchases);
  select coalesce(array_agg(id order by id),'{}') into transfers from(select unnest(transfers) id union select source_id from finance_private.refunds where id=any(refunds) and source_type='unapplied_credit' union select transfer_id from finance_private.refund_source_reservations where refund_id=any(refunds) union select transfer_id from finance_private.amendment_funding_reservations where state='reserved' and(charge_id=any(charges) or enrollment_id=any(enrollments)) union select transfer_id from finance_private.payment_allocations where charge_id=any(charges) union select transfer_id from finance_private.package_funding_sources where purchase_id=any(purchases))x where id is not null;
  iteration:=iteration+1;exit when before_graph=jsonb_build_array(charges,transfers,refunds,enrollments,occurrences,learners,purchases,lots);
  if iteration>=64 then raise exception 'RETRYABLE_CONFLICT';end if;
 end loop;
 select coalesce(array_agg(id order by id),'{}') into sources from finance_private.remedy_sources where charge_id=any(charges) or consumption_id in(select id from app_private.entitlement_movements where purchase_id=any(purchases));
 graph:=jsonb_build_object('charge_ids',charges,'transfer_ids',transfers,'refund_ids',refunds,'enrollment_ids',enrollments,'occurrence_ids',occurrences,'learner_ids',learners,'purchase_ids',purchases,'lot_ids',lots,'remedy_source_ids',sources,
  'tutor_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select distinct tutor_id id from app_private.occurrences where id=any(occurrences))x),
  'case_ids',(select coalesce(jsonb_agg(c.id order by c.id),'[]') from app_private.review_cases c join app_private.receipts r on r.id=c.receipt_id where r.charge_id=any(charges)),
  'receipt_ids',(select coalesce(jsonb_agg(id order by id),'[]') from app_private.receipts where charge_id=any(charges)),
  'credit_lot_ids',(select coalesce(jsonb_agg(id order by id),'[]') from finance_private.customer_credit_lots where transfer_id=any(transfers)));
 return graph||jsonb_build_object('source_fingerprint',app_private.catalog_hash(graph));
end $$;

