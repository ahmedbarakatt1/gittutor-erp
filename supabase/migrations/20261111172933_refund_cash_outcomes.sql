-- Source graph discovery is read-only. The shared booking orchestrator locks domain resources first.
grant create on schema finance_private to git_tutor_commands;
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
 select coalesce(array_agg(id order by id),'{}') into sources from finance_private.remedy_sources where consumption_id in(select id from app_private.entitlement_movements where purchase_id=any(purchases));
 graph:=jsonb_build_object('charge_ids',charges,'transfer_ids',transfers,'refund_ids',refunds,'enrollment_ids',enrollments,'occurrence_ids',occurrences,'learner_ids',learners,'purchase_ids',purchases,'lot_ids',lots,'remedy_source_ids',sources,
  'tutor_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select distinct tutor_id id from app_private.occurrences where id=any(occurrences))x),
  'case_ids',(select coalesce(jsonb_agg(c.id order by c.id),'[]') from app_private.review_cases c join app_private.receipts r on r.id=c.receipt_id where r.charge_id=any(charges)),
  'receipt_ids',(select coalesce(jsonb_agg(id order by id),'[]') from app_private.receipts where charge_id=any(charges)),
  'credit_lot_ids',(select coalesce(jsonb_agg(id order by id),'[]') from finance_private.customer_credit_lots where transfer_id=any(transfers)));
 return graph||jsonb_build_object('source_fingerprint',app_private.catalog_hash(graph));
end $$;
create or replace function finance_private.finance_lock_targets(p_charge_ids uuid[],p_transfer_ids uuid[],p_refund_ids uuid[],p_credit_lot_ids uuid[],p_source_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare fresh jsonb;begin
 perform 1 from finance_private.charge_accounts where charge_id=any(p_charge_ids) order by charge_id for update;
 perform 1 from finance_private.incoming_transfers where id=any(p_transfer_ids) order by id for update;
 perform 1 from finance_private.credit_lot_accounts where credit_lot_id=any(p_credit_lot_ids) order by credit_lot_id for update;
 perform 1 from finance_private.credit_reservations where credit_lot_id=any(p_credit_lot_ids) order by id for update;
 perform 1 from finance_private.refunds where id=any(p_refund_ids) order by id for update;
 perform 1 from finance_private.refund_attempts where refund_id=any(p_refund_ids) order by id for update;
 fresh:=finance_private.finance_discover_scope(p_charge_ids,p_transfer_ids,p_refund_ids,'{}');
 if fresh->>'source_fingerprint' is distinct from p_source_fingerprint then raise exception 'RETRYABLE_CONFLICT';end if;
 return jsonb_build_object('source_fingerprint',p_source_fingerprint,'charge_versions',(select coalesce(jsonb_object_agg(charge_id,version),'{}') from finance_private.charge_accounts where charge_id=any(p_charge_ids)),'transfer_versions',(select coalesce(jsonb_object_agg(id,version),'{}') from finance_private.incoming_transfers where id=any(p_transfer_ids)),'credit_versions',(select coalesce(jsonb_object_agg(credit_lot_id,version),'{}') from finance_private.credit_lot_accounts where credit_lot_id=any(p_credit_lot_ids)));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('finance_discover_scope','finance_lock_targets') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema finance_private from git_tutor_commands;



grant create on schema api,app_private,finance_private to git_tutor_commands;
alter table finance_private.refund_attempts add source_reservation_ids uuid[] not null;

create or replace function finance_private.finance_transfer_balance(p_transfer_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t finance_private.incoming_transfers%rowtype;s finance_private.transfer_settlements%rowtype;b finance_private.transfer_payer_bindings%rowtype;refund_paid numeric;refund_returned numeric;gross numeric;reversed numeric;allocated numeric;reserved numeric;converted numeric;unapplied numeric;available numeric;exposure numeric;review boolean;begin
 select * into t from finance_private.incoming_transfers where id=p_transfer_id;if t.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into s from finance_private.transfer_settlements where transfer_id=t.id;select * into b from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
 gross:=coalesce(s.amount_minor,0);select coalesce(sum(amount_minor),0) into reversed from finance_private.transfer_reversals where transfer_id=t.id;
 select coalesce(sum(a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0)),0) into allocated from finance_private.payment_allocations a where a.transfer_id=t.id;
 select coalesce(sum(r.amount_minor) filter(where r.state='reserved'),0),coalesce(sum(r.amount_minor) filter(where r.state='consumed' and r.purpose='package_grant'),0) into reserved,converted from finance_private.credit_reservations r join finance_private.customer_credit_lots l on l.id=r.credit_lot_id where l.transfer_id=t.id;
 select coalesce(sum(refund_source.amount_minor),0) into refund_paid from finance_private.refund_source_reservations refund_source join finance_private.refund_attempts refund_attempt on refund_source.id=any(refund_attempt.source_reservation_ids) join finance_private.refund_outcomes refund_outcome on refund_outcome.attempt_id=refund_attempt.id and refund_outcome.outcome='settled' where refund_source.transfer_id=t.id;
 select coalesce(sum(amount_minor),0) into refund_returned from finance_private.refund_reversal_sources where transfer_id=t.id;
 unapplied:=gross-reversed-allocated-converted-refund_paid+refund_returned;exposure:=greatest(0,-unapplied);
 review:=exposure>0 or exists(select 1 from app_private.reconciliation_exceptions e where e.source_type='transfer' and e.source_id=t.id and e.state='open');
 available:=case when review then 0 else greatest(0,unapplied-reserved) end;
 if greatest(abs(gross),abs(reversed),abs(allocated),abs(reserved),abs(converted),abs(unapplied),abs(available),abs(exposure))>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 -- Refund outgoing/return primary rows extend this projection before those commands are enabled.
 return jsonb_build_object('transfer_id',t.id,'version',t.version,'state',t.state,'currency',t.currency,'gross_settled_minor',gross,'reversed_minor',reversed,'net_allocated_minor',allocated,'refund_settled_minor',refund_paid,'refund_returned_minor',refund_returned,'credit_converted_minor',converted,'refund_reserved_minor',coalesce((select sum(r.amount_minor) from finance_private.credit_reservations r join finance_private.customer_credit_lots l on l.id=r.credit_lot_id where l.transfer_id=t.id and r.purpose='refund' and r.state='reserved'),0),'unapplied_signed_minor',unapplied,'available_minor',available,'recovery_exposure_minor',exposure,'payer_binding_id',b.id,'payer_account_id',b.payer_account_id,'reconciliation_state',case when review then 'requires_review' else 'clear' end);
end $$;

create function finance_private.finance_reserve_refund(p_refund_id uuid,p_remedy_id uuid,p_destination_version_id uuid,p_amount_minor bigint,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;v finance_private.refund_destination_versions%rowtype;lot record;credit jsonb;remaining bigint:=p_amount_minor;take bigint;ids uuid[]:='{}';transfers uuid[]:='{}';begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into v from finance_private.refund_destination_versions where id=p_destination_version_id;
 if r.id is null or v.id is null or v.payer_account_id<>r.payer_account_id or not exists(select 1 from finance_private.refund_destinations where id=v.destination_id and refund_id=r.id and verification_status='verified') then raise exception 'DESTINATION_UNVERIFIED';end if;
 if p_amount_minor is null or p_amount_minor not between 1 and r.requested_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 if r.source_type<>'unapplied_credit' or r.requires_remedy or p_remedy_id is not null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 if p_amount_minor>finance_private.finance_refundable_surplus(r.source_id) then raise exception 'INSUFFICIENT_FUNDS';end if;
 for lot in select l.*,finance_private.finance_credit_available(l.id) available from finance_private.customer_credit_lots l where l.transfer_id=r.source_id and l.payer_account_id=r.payer_account_id and l.origin_kind in('settlement','refund_reversal') order by l.created_at,l.id loop
  if remaining=0 then exit;end if;if lot.available=0 then continue;end if;take:=least(remaining,lot.available);
  credit:=finance_private.finance_lock_credit(lot.id,r.payer_account_id,take,'refund',r.id,p_context,'refund:'||r.id||':'||lot.id);
  insert into finance_private.refund_source_reservations(refund_id,credit_reservation_id,transfer_id,credit_lot_id,source_allocation_id,amount_minor) values(r.id,(credit->>'credit_reservation_id')::uuid,lot.transfer_id,lot.id,lot.source_allocation_id,take);
  ids:=array_append(ids,(credit->>'credit_reservation_id')::uuid);transfers:=array_append(transfers,lot.transfer_id);remaining:=remaining-take;
 end loop;if remaining<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
 return jsonb_build_object('reserved_minor',p_amount_minor,'reservation_ids',ids,'source_transfer_ids',array(select distinct x from unnest(transfers)x),'payer_binding_id',r.payer_binding_id);
end $$;
create function finance_private.finance_retry_refund_sources(p_refund_id uuid,p_previous_attempt_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;s finance_private.refund_source_reservations%rowtype;credit jsonb;begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into a from finance_private.refund_attempts where id=p_previous_attempt_id and refund_id=r.id;
 if a.id is null or a.state<>'failed' or not exists(select 1 from finance_private.refund_outcomes where attempt_id=a.id and outcome='failed') then raise exception 'STATE_CONFLICT';end if;
 for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by credit_lot_id,id loop
  if s.remedy_reservation_id is not null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  credit:=finance_private.finance_lock_credit(s.credit_lot_id,r.payer_account_id,s.amount_minor,'refund',r.id,p_context,'retry-refund:'||s.id);
  insert into finance_private.refund_source_reservations(refund_id,credit_reservation_id,transfer_id,credit_lot_id,source_allocation_id,remedy_reservation_id,amount_minor) values(r.id,(credit->>'credit_reservation_id')::uuid,s.transfer_id,s.credit_lot_id,s.source_allocation_id,null,s.amount_minor);
 end loop;
end $$;
create or replace function app_private.refund_source_immutable() returns trigger language plpgsql set search_path='' as $$declare allowed text[];begin if tg_op='DELETE' then raise exception 'IMMUTABLE_VERSION';end if;allowed:=case tg_table_name when 'refunds' then array['approved_minor','remedy_id','destination_version_id','state','approved_by','approved_at','version','updated_at'] when 'refund_destinations' then array['verification_status','version','updated_at'] when 'destination_validation_artifacts' then array['consumed_at','consumed_command_id'] when 'refund_attempts' then array['state','version','updated_at'] when 'refund_outcomes' then array['ledger_transaction_id'] else '{}'::text[] end;if(to_jsonb(old)-allowed) is distinct from(to_jsonb(new)-allowed) or(tg_table_name='destination_validation_artifacts' and to_jsonb(old)->>'consumed_at' is not null) or(tg_table_name='refund_outcomes' and(to_jsonb(old)->>'ledger_transaction_id' is not null or to_jsonb(old)->>'outcome'<>'settled')) then raise exception 'IMMUTABLE_VERSION';end if;return new;end $$;
grant update(ledger_transaction_id) on finance_private.refund_outcomes to git_tutor_commands;
create function finance_private.finance_settle_refund(p_refund_id uuid,p_attempt_id uuid,p_verified_outcome_id uuid,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;o finance_private.refund_outcomes%rowtype;s finance_private.refund_source_reservations%rowtype;lines jsonb:='[]';posting uuid;total numeric:=0;begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into a from finance_private.refund_attempts where id=p_attempt_id and refund_id=r.id;select * into o from finance_private.refund_outcomes where id=p_verified_outcome_id and attempt_id=a.id and outcome='settled';
 if r.id is null or a.id is null or o.id is null then raise exception 'EVIDENCE_REQUIRED';end if;if o.ledger_transaction_id is not null then return o.ledger_transaction_id;end if;
 perform app_private.payment_assert_file(o.evidence_file_id,'refund_outcome','refund_attempt',a.id);
 for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by transfer_id,credit_lot_id,id loop
  if not exists(select 1 from finance_private.credit_reservations where id=s.credit_reservation_id and state='reserved' and amount_minor=s.amount_minor) then raise exception 'STATE_CONFLICT';end if;
  perform finance_private.finance_commit_credit(s.credit_reservation_id,'refund',a.id,p_context);total:=total+s.amount_minor;
  lines:=lines||jsonb_build_array(jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',s.transfer_id,'credit_lot_id',s.credit_lot_id,'refund_id',r.id,'attempt_id',a.id,'signed_minor',s.amount_minor),jsonb_build_object('account_code','channel_cash','transfer_id',s.transfer_id,'credit_lot_id',s.credit_lot_id,'refund_id',r.id,'attempt_id',a.id,'signed_minor',-s.amount_minor));
 end loop;if total<>r.approved_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 posting:=finance_private.finance_post_balanced('refund-settled:'||a.id,'refund_settled',a.id,r.currency,o.settled_at,lines,p_context);
 update finance_private.refund_outcomes set ledger_transaction_id=posting where id=o.id;return posting;
end $$;
create function finance_private.finance_record_refund_reversal(p_refund_id uuid,p_attempt_id uuid,p_external_reversal_id text,p_amount_minor bigint,p_evidence_file_id uuid,p_effective_at timestamptz,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.refunds%rowtype;a finance_private.refund_attempts%rowtype;prior finance_private.refund_reversals%rowtype;selected_channel text;remaining numeric;item record;reversal uuid:=gen_random_uuid();posting uuid;lot uuid;lines jsonb:='[]';lots uuid[]:='{}';source_rows jsonb:='[]';row_json jsonb;begin
 select * into r from finance_private.refunds where id=p_refund_id;select * into a from finance_private.refund_attempts where id=p_attempt_id and refund_id=r.id;select v.channel into selected_channel from finance_private.refund_destination_versions v where v.id=a.destination_version_id;
 if r.id is null or a.id is null or not exists(select 1 from finance_private.refund_outcomes where attempt_id=a.id and outcome='settled') then raise exception 'STATE_CONFLICT';end if;
 if p_external_reversal_id is null or length(btrim(p_external_reversal_id)) not between 1 and 200 or p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 if p_effective_at is null or not isfinite(p_effective_at) or p_effective_at<timestamptz '0001-01-01 00:00:00+00' or p_effective_at>now() then raise exception 'INVALID_TIME';end if;
 perform app_private.payment_assert_file(p_evidence_file_id,'refund_reversal','refund_attempt',a.id);
 select * into prior from finance_private.refund_reversals existing where existing.channel=selected_channel and existing.external_reversal_id=btrim(p_external_reversal_id);
 if prior.id is not null then raise exception 'DUPLICATE_TRANSFER';end if;
 select r.approved_minor-coalesce(sum(amount_minor),0) into remaining from finance_private.refund_reversals where attempt_id=a.id;if p_amount_minor>remaining then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for item in with weights as(select s.*,s.amount_minor-coalesce((select sum(x.amount_minor) from finance_private.refund_reversal_sources x where x.refund_source_reservation_id=s.id),0) weight from finance_private.refund_source_reservations s where s.id=any(a.source_reservation_ids)),shares as(select *,floor(p_amount_minor::numeric*weight/remaining) base,mod(p_amount_minor::numeric*weight,remaining) remainder from weights where weight>0),ranked as(select *,row_number()over(order by remainder desc,id) rank,p_amount_minor-sum(base)over() residual from shares) select *, (base+case when rank<=residual then 1 else 0 end)::bigint returned from ranked order by id loop
  if item.returned=0 then continue;end if;lot:=gen_random_uuid();lots:=array_append(lots,lot);
  lines:=lines||jsonb_build_array(jsonb_build_object('account_code','channel_cash','transfer_id',item.transfer_id,'credit_lot_id',lot,'refund_id',r.id,'attempt_id',a.id,'signed_minor',item.returned),jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',item.transfer_id,'credit_lot_id',lot,'refund_id',r.id,'attempt_id',a.id,'signed_minor',-item.returned));
  source_rows:=source_rows||jsonb_build_array(jsonb_build_object('source_id',item.id,'transfer_id',item.transfer_id,'binding_id',(select payer_binding_id from finance_private.customer_credit_lots where id=item.credit_lot_id),'amount',item.returned,'lot_id',lot));
 end loop;
 posting:=finance_private.finance_post_balanced('refund-returned:'||reversal,'refund_reversed',reversal,r.currency,p_effective_at,lines,p_context);
 insert into finance_private.refund_reversals(id,refund_id,attempt_id,channel,external_reversal_id,amount_minor,evidence_file_id,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at) values(reversal,r.id,a.id,selected_channel,btrim(p_external_reversal_id),p_amount_minor,p_evidence_file_id,posting,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'refund-return',p_effective_at);
 for row_json in select value from jsonb_array_elements(source_rows) loop
  insert into finance_private.customer_credit_lots(id,transfer_id,payer_binding_id,payer_account_id,origin_kind,source_refund_reversal_id,original_minor,currency,command_id,source_line_key) values((row_json->>'lot_id')::uuid,(row_json->>'transfer_id')::uuid,(row_json->>'binding_id')::uuid,r.payer_account_id,'refund_reversal',reversal,(row_json->>'amount')::bigint,r.currency,(p_context->>'command_id')::uuid,'refund-return:'||(row_json->>'source_id'));
  insert into finance_private.credit_lot_accounts(credit_lot_id) values((row_json->>'lot_id')::uuid);
  insert into finance_private.refund_reversal_sources(refund_reversal_id,refund_source_reservation_id,transfer_id,payer_binding_id,amount_minor,returned_credit_lot_id,command_id) values(reversal,(row_json->>'source_id')::uuid,(row_json->>'transfer_id')::uuid,(row_json->>'binding_id')::uuid,(row_json->>'amount')::bigint,(row_json->>'lot_id')::uuid,(p_context->>'command_id')::uuid);
 end loop;
 return jsonb_build_object('refund_reversal_id',reversal,'ledger_transaction_id',posting,'returned_credit_lot_ids',lots,'returned_minor',p_amount_minor,'reconciliation_state',case when exists(select 1 from finance_private.refund_source_reservations s where s.id=any(a.source_reservation_ids) and finance_private.finance_transfer_balance(s.transfer_id)->>'reconciliation_state'<>'clear') then 'requires_review' else 'clear' end);
end $$;
alter table finance_private.refund_outcomes add channel text not null;
create unique index refund_outgoing_identity on finance_private.refund_outcomes(channel,external_reference) where outcome='settled';
create function app_private.refund_cash_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
   for s in select * from finance_private.refund_source_reservations where id=any(a.source_reservation_ids) order by credit_lot_id,id loop perform finance_private.finance_release_credit(s.credit_reservation_id,outcome,context);if s.remedy_reservation_id is not null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;end loop;
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
create function api.approve_refund(p_refund_id uuid,p_remedy_id uuid,p_destination_version_id uuid,p_amount_minor bigint,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.refund_cash_command('approve_refund',jsonb_build_object('refund_id',p_refund_id,'remedy_id',p_remedy_id,'destination_version_id',p_destination_version_id,'amount_minor',p_amount_minor,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key)$$;
create function api.record_refund_attempt(p_refund_id uuid,p_external_reference text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.refund_cash_command('record_refund_attempt',jsonb_build_object('refund_id',p_refund_id,'external_reference',p_external_reference,'expected_version',p_expected_version),p_idempotency_key)$$;
create function api.reconcile_refund(p_refund_id uuid,p_attempt_id uuid,p_outcome text,p_evidence_file_id uuid,p_external_reference text,p_settled_at timestamptz,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.refund_cash_command('reconcile_refund',jsonb_build_object('refund_id',p_refund_id,'attempt_id',p_attempt_id,'outcome',p_outcome,'evidence_file_id',p_evidence_file_id,'external_reference',p_external_reference,'settled_at',p_settled_at,'expected_version',p_expected_version),p_idempotency_key)$$;
create function api.record_refund_reversal(p_refund_id uuid,p_attempt_id uuid,p_external_reversal_id text,p_amount_minor bigint,p_evidence_file_id uuid,p_effective_at timestamptz,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.refund_cash_command('record_refund_reversal',jsonb_build_object('refund_id',p_refund_id,'attempt_id',p_attempt_id,'external_reversal_id',p_external_reversal_id,'amount_minor',p_amount_minor,'evidence_file_id',p_evidence_file_id,'effective_at',p_effective_at,'expected_version',p_expected_version),p_idempotency_key)$$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_reserve_refund','finance_retry_refund_sources','finance_settle_refund','finance_record_refund_reversal')) or(n.nspname='app_private' and p.proname='refund_cash_command') or(n.nspname='api' and p.proname in('approve_refund','record_refund_attempt','reconcile_refund','record_refund_reversal')) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';

