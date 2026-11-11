grant create on schema api,app_private,finance_private to git_tutor_commands;
alter table finance_private.ledger_lines drop constraint ledger_lines_account_code_check;
alter table finance_private.ledger_lines add constraint ledger_lines_account_code_check check(account_code in('receivable','deferred_package_obligation','promotional_subsidy_expense','tuition_revenue','channel_cash','unapplied_customer_funds','deferred_tuition','deferred_cancellation_obligation'));
alter table finance_private.package_value_reversals drop constraint package_value_reversals_allocation_id_key;
create unique index package_value_reversal_command_once on finance_private.package_value_reversals(allocation_id,command_id);
create table finance_private.package_cancellation_dispositions(
 id uuid primary key default gen_random_uuid(),reservation_id uuid not null unique references app_private.package_reservations(id),
 proposal_id uuid not null references app_private.operation_proposals(id),terms_hash text not null,
 released_credit_quanta bigint not null check(released_credit_quanta between 0 and 9007199254740991),released_value_minor bigint not null check(released_value_minor between 0 and 9007199254740991),
 extinguished_credit_quanta bigint not null check(extinguished_credit_quanta between 0 and 9007199254740991),extinguished_value_minor bigint not null check(extinguished_value_minor between 0 and 9007199254740991),
 allocations jsonb not null, movement_ids uuid[] not null,ledger_transaction_ids uuid[] not null,
 state text not null default 'pending_earning_review' check(state='pending_earning_review'),command_id uuid not null,created_at timestamptz not null default now());
alter table finance_private.package_cancellation_dispositions enable row level security;
grant select,insert on finance_private.package_cancellation_dispositions to git_tutor_commands;
create policy commands_access on finance_private.package_cancellation_dispositions to git_tutor_commands using(true) with check(true);
revoke all on finance_private.package_cancellation_dispositions from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_package_cancellation before update or delete on finance_private.package_cancellation_dispositions for each row execute function app_private.reject_immutable_change();

create function app_private.package_cancellation_disposition(p_reservation_id uuid,p_input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.package_reservations%rowtype;a record;q bigint;v bigint;totalq numeric:=0;totalv numeric:=0;releaseq bigint;extinguishq bigint;remainingq bigint;takeq bigint;takev bigint;releasev numeric:=0;rows jsonb:='[]';
begin
 select * into r from app_private.package_reservations where id=p_reservation_id;
 if r.id is null or r.state<>'reserved' then raise exception 'STATE_CONFLICT';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or (p_input-array['enrollment_id','released_credit_quanta','extinguished_credit_quanta'])<>'{}' or (p_input->>'enrollment_id')::uuid is distinct from r.enrollment_id then raise exception 'VALIDATION_ERROR';end if;
 releaseq:=app_private.package_safe_integer(p_input->'released_credit_quanta');extinguishq:=app_private.package_safe_integer(p_input->'extinguished_credit_quanta');remainingq:=releaseq;
 if (releaseq::numeric+extinguishq)>9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 for a in select x.*,l.version lot_version,l.original_lot_id,l.expires_at from app_private.package_reservation_allocations x join app_private.package_lots l on l.id=x.lot_id where x.reservation_id=r.id order by x.lot_id,x.id loop
  select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0),coalesce(sum((delta->>'reserved_value_minor')::numeric),0) into q,v from app_private.entitlement_movements where allocation_id=a.id;
  if q<0 or v<0 or(q=0 and v<>0) then raise exception 'CONSERVATION_VIOLATION';end if;if q=0 then continue;end if;
  takeq:=least(remainingq,q);takev:=case when takeq=q then v else floor(v::numeric*takeq/q)::bigint end;remainingq:=remainingq-takeq;
  rows:=rows||jsonb_build_array(jsonb_build_object('allocation_id',a.id,'lot_id',a.lot_id,'lot_version',a.lot_version,'original_lot_id',a.original_lot_id,'expires_at',a.expires_at,'original_movement_id',(select id from app_private.entitlement_movements where allocation_id=a.id and kind='reserve' order by recorded_at,id limit 1),'reserved_credit_quanta',q,'reserved_value_minor',v,'released_credit_quanta',takeq,'released_value_minor',takev,'extinguished_credit_quanta',q-takeq,'extinguished_value_minor',v-takev));
  totalq:=totalq+q;totalv:=totalv+v;releasev:=releasev+takev;
 end loop;
 if totalq=0 or totalq<>releaseq::numeric+extinguishq or remainingq<>0 or totalv>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 return jsonb_build_object('reservation_id',r.id,'reservation_version',r.version,'released_credit_quanta',releaseq,'released_value_minor',releasev,'extinguished_credit_quanta',extinguishq,'extinguished_value_minor',totalv-releasev,'allocations',rows);
end $$;

create function finance_private.finance_reverse_package_value(p_reservation_id uuid,p_amount_minor bigint,p_context jsonb,p_source_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r app_private.package_reservations%rowtype;v finance_private.package_value_allocations%rowtype;previous finance_private.package_value_reversals%rowtype;remaining bigint;ledger uuid;
begin
 select * into r from app_private.package_reservations where id=p_reservation_id;select * into v from finance_private.package_value_allocations where reservation_id=r.id for update;
 if v.id is null or p_amount_minor is null or p_amount_minor<0 then raise exception 'VALIDATION_ERROR';end if;
 select * into previous from finance_private.package_value_reversals where allocation_id=v.id and command_id=(p_context->>'command_id')::uuid;
 if previous.id is not null then if previous.amount_minor<>p_amount_minor then raise exception 'IDEMPOTENCY_CONFLICT';end if;return previous.ledger_transaction_id;end if;
 select v.amount_minor-coalesce(sum(amount_minor),0) into remaining from finance_private.package_value_reversals where allocation_id=v.id;
 if p_amount_minor>remaining then raise exception 'AMOUNT_OUT_OF_RANGE';end if;if p_amount_minor=0 then return null;end if;
 ledger:=finance_private.finance_post_balanced('package-value-reversal:'||r.id||':'||(p_context->>'command_id'),'package_value_released',p_source_id,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',v.charge_id,'signed_minor',p_amount_minor),jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',v.charge_id,'signed_minor',-p_amount_minor)),p_context);
 insert into finance_private.package_value_reversals(allocation_id,amount_minor,ledger_transaction_id,command_id) values(v.id,p_amount_minor,ledger,(p_context->>'command_id')::uuid);
 update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=v.charge_id;
 return ledger;
end $$;

create function app_private.package_commit_cancellation_disposition(p_proposal_id uuid,p_enrollment_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;c app_private.operation_customer_terms%rowtype;f finance_private.cancellation_customer_finances%rowtype;r app_private.package_reservations%rowtype;saved finance_private.package_cancellation_dispositions%rowtype;plan jsonb;fresh jsonb;item jsonb;refs jsonb;destination text;movement uuid;ledger uuid;ids uuid[]:='{}';ledgers uuid[]:='{}';q bigint;v bigint;coverage_ids uuid[];
begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;select * into c from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=p_enrollment_id;select * into f from finance_private.cancellation_customer_finances where proposal_id=p.id and enrollment_id=p_enrollment_id;
 if p.state<>'approved' or c.id is null or f.proposal_id is null or not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;perform app_private.require_role(p.approved_by,'admin');
 plan:=f.snapshot->'package_disposition';if plan is null or plan='null'::jsonb then raise exception 'CONSENT_REQUIRED';end if;
 select * into r from app_private.package_reservations where id=(plan->>'reservation_id')::uuid for update;
 select * into saved from finance_private.package_cancellation_dispositions where reservation_id=r.id;
 if saved.id is not null then if saved.proposal_id<>p.id or saved.terms_hash<>c.terms_hash then raise exception 'STATE_CONFLICT';end if;return to_jsonb(saved);end if;
 fresh:=app_private.package_cancellation_disposition(r.id,jsonb_build_object('enrollment_id',r.enrollment_id,'released_credit_quanta',plan->'released_credit_quanta','extinguished_credit_quanta',plan->'extinguished_credit_quanta'));
 if fresh<>plan then raise exception 'VERSION_CONFLICT';end if;
 if r.coverage_rule='named_entitlement_covers_eligible_occurrence' then
  coverage_ids:=finance_private.finance_reduce_named_coverage(r.id,finance_private.finance_named_coverage_remaining(r.id),p_context,'cancellation-coverage:'||r.id);
 else
  ledger:=finance_private.finance_reverse_package_value(r.id,(plan->>'released_value_minor')::bigint,p_context,p.id);if ledger is not null then ledgers:=array_append(ledgers,ledger);end if;
 end if;
 insert into finance_private.package_coverage_releases(reservation_id,adjustment_id,command_id) values(r.id,coverage_ids[array_length(coverage_ids,1)],(p_context->>'command_id')::uuid);
 for item in select value from jsonb_array_elements(plan->'allocations') loop
  refs:=jsonb_build_object('enrollment_id',r.enrollment_id,'reservation_id',r.id,'allocation_id',item->'allocation_id','original_movement_id',item->'original_movement_id','from_bucket','reserved');
  q:=(item->>'released_credit_quanta')::bigint;v:=(item->>'released_value_minor')::bigint;
  if q>0 then
   destination:=case when(item->>'expires_at')::timestamptz<=now() then 'expired' else 'available' end;
   movement:=app_private.package_append_movement((item->>'lot_id')::uuid,'release',jsonb_build_object('reserved_credit_quanta',-q,'reserved_value_minor',-v,destination||'_credit_quanta',q,destination||'_value_minor',v),refs||jsonb_build_object('credit_quanta',q,'value_minor',v,'to_bucket',destination,'customer_reason_code','approved_cancellation_release'),p_context,'cancellation-release:'||(item->>'allocation_id'));ids:=array_append(ids,movement);
  end if;
  q:=(item->>'extinguished_credit_quanta')::bigint;v:=(item->>'extinguished_value_minor')::bigint;
  if q>0 then
   movement:=app_private.package_append_movement((item->>'lot_id')::uuid,'adjust',jsonb_build_object('reserved_credit_quanta',-q,'reserved_value_minor',-v,'adjustment_credit_quanta',-q,'adjustment_value_minor',-v),refs||jsonb_build_object('credit_quanta',-q,'value_minor',-v,'customer_reason_code','approved_cancellation_extinguishment'),p_context,'cancellation-extinguish:'||(item->>'allocation_id'));ids:=array_append(ids,movement);
   if v>0 then
    ledger:=finance_private.finance_post_balanced('cancellation-obligation:'||p.id||':'||(item->>'allocation_id'),'package_cancellation_disposition',p.id,'EGP',now(),jsonb_build_array(jsonb_build_object('account_code','deferred_package_obligation','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'lot_id',item->'lot_id','enrollment_id',r.enrollment_id,'charge_id',f.charge_id,'signed_minor',v),jsonb_build_object('account_code','deferred_cancellation_obligation','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'lot_id',item->'lot_id','enrollment_id',r.enrollment_id,'charge_id',f.charge_id,'signed_minor',-v)),p_context);ledgers:=array_append(ledgers,ledger);
   end if;
  end if;
 end loop;
 update app_private.package_reservations set state='released',version=version+1,updated_at=now() where id=r.id;
 update app_private.package_purchases set version=version+1,updated_at=now() where id=r.purchase_id;
 insert into finance_private.package_cancellation_dispositions(reservation_id,proposal_id,terms_hash,released_credit_quanta,released_value_minor,extinguished_credit_quanta,extinguished_value_minor,allocations,movement_ids,ledger_transaction_ids,command_id) values(r.id,p.id,c.terms_hash,(plan->>'released_credit_quanta')::bigint,(plan->>'released_value_minor')::bigint,(plan->>'extinguished_credit_quanta')::bigint,(plan->>'extinguished_value_minor')::bigint,plan->'allocations',ids,ledgers,(p_context->>'command_id')::uuid) returning * into saved;
 return to_jsonb(saved);
end $$;

alter function finance_private.finance_cancellation_snapshot(uuid,text,boolean) rename to finance_cancellation_snapshot_before_disposition;
create function finance_private.finance_cancellation_snapshot(p_enrollment_id uuid,p_remedy text,p_platform boolean,p_disposition jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;q app_private.quotes%rowtype;c finance_private.charges%rowtype;r app_private.package_reservations%rowtype;policy jsonb;balance jsonb;cancel_window jsonb;basis integer;net bigint;retained bigint;release_cash bigint;release_quanta bigint:=0;resolved text:=p_remedy;expires timestamptz;disposition jsonb;retained_package bigint:=0;result jsonb;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;select * into o from app_private.occurrences where id=e.occurrence_id;select * into q from app_private.quotes where id=e.current_quote_id;select * into c from finance_private.charges where enrollment_id=e.id;
 if c.id is null or e.state not in('held','confirmed') or o.state not in('forming','confirmed') then raise exception 'CONSENT_REQUIRED';end if;if o.start_at<=now() then raise exception 'WINDOW_CLOSED';end if;
 policy:=app_private.policy_content(q.policy_version_id);balance:=finance_private.finance_charge_balance(c.id);if balance->>'reconciliation_state'<>'clear' then raise exception 'STATE_CONFLICT';end if;
 select * into r from app_private.package_reservations where enrollment_id=e.id and state in('reserved','partially_consumed','consumed') order by created_at desc limit 1;
 if p_platform then basis:=10000;expires:=o.start_at;else
  select value into cancel_window from jsonb_array_elements(policy->'customer_cancellation_windows') where extract(epoch from(o.start_at-now()))/60 >=(value->>'minimum_minutes_before_start')::numeric and(value->>'maximum_minutes_before_start_exclusive' is null or extract(epoch from(o.start_at-now()))/60<(value->>'maximum_minutes_before_start_exclusive')::numeric);
  basis:=(cancel_window->>'refund_basis_points')::int;expires:=o.start_at-make_interval(mins=>(cancel_window->>'minimum_minutes_before_start')::int);
 end if;if basis is null then raise exception 'POLICY_INCOMPLETE';end if;
 if r.id is not null then
  if r.state<>'reserved' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  if p_disposition is null then
   if basis<>10000 then raise exception 'CONSENT_REQUIRED';end if;
   p_disposition:=jsonb_build_object('enrollment_id',e.id,'released_credit_quanta',r.reserved_credit_quanta,'extinguished_credit_quanta',0);
  end if;
  if policy->'package_contract'->>'partial_consumption_rule'<>'reviewed_exact_credit_quanta_and_value' then raise exception 'POLICY_INCOMPLETE';end if;
  disposition:=app_private.package_cancellation_disposition(r.id,p_disposition);
  if basis=10000 and(disposition->>'extinguished_credit_quanta')::bigint<>0 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  if r.coverage_rule='allocated_value_with_explicit_top_up' then retained_package:=(disposition->>'extinguished_value_minor')::bigint;end if;
  release_quanta:=(disposition->>'released_credit_quanta')::bigint;
 elsif p_disposition is not null then raise exception 'VALIDATION_ERROR';end if;
 if resolved='policy_default' then resolved:=case when r.id is not null then 'package_entitlement_restoration' else 'monetary_account_credit' end;end if;
 if not(policy->'allowed_refund_remedies'?resolved) or(resolved='package_entitlement_restoration' and r.id is null) then raise exception 'POLICY_INCOMPLETE';end if;
 net:=(balance->>'commercial_net_minor')::bigint;retained:=net-floor(net::numeric*basis/10000)::bigint;if retained_package>retained then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 release_cash:=greatest(0,(balance->>'allocated_cash_minor')::bigint-(retained-retained_package));
 result:=jsonb_build_object('enrollment_id',e.id,'charge_id',c.id,'quote_id',q.id,'policy_version_id',q.policy_version_id,'charge_balance',balance,'refund_basis_points',basis,'retained_net_minor',retained,'release_cash_minor',release_cash,'reservation_id',r.id,'reservation_version',r.version,'released_credit_quanta',release_quanta,'remedy',resolved,'window_expires_at',expires,'allocation_ids',coalesce((select jsonb_agg(a.id order by a.id) from finance_private.payment_allocations a where a.charge_id=c.id and a.amount_minor>coalesce((select sum(v.amount_minor) from finance_private.allocation_reversals v where v.allocation_id=a.id),0)),'[]'));
 if r.id is not null then result:=result||jsonb_build_object('package_disposition',disposition,'retained_package_value_minor',retained_package);end if;
 return result;
end $$;
drop function api.revise_cancellation_proposal(uuid,bigint,text,integer,text);
create function api.revise_cancellation_proposal(p_proposal_id uuid,p_tutor_compensation_minor bigint,p_reason text,p_expected_version integer,p_idempotency_key text,p_package_dispositions jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;old app_private.operation_proposals%rowtype;p app_private.operation_proposals%rowtype;o app_private.occurrences%rowtype;fee finance_private.tutor_fee_agreements%rowtype;ct app_private.operation_customer_terms%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;snapshot jsonb;terms jsonb;teacher jsonb;expiry timestamptz;compensation uuid:=gen_random_uuid();snapshots jsonb:='{}';disposition jsonb;begin
 perform app_private.require_role(actor,'admin');select * into old from app_private.operation_proposals where id=p_proposal_id;
 if old.id is null or old.kind<>'cancellation_remedy' then raise exception 'NOT_FOUND';end if;
 if p_package_dispositions is not null and(jsonb_typeof(p_package_dispositions) is distinct from 'array' or jsonb_array_length(p_package_dispositions)>4) then raise exception 'VALIDATION_ERROR';end if;
 context:=app_private.booking_begin(actor,'revise_cancellation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'tutor_compensation_minor',p_tutor_compensation_minor,'reason',p_reason,'expected_version',p_expected_version)||case when p_package_dispositions is null then '{}'::jsonb else jsonb_build_object('package_dispositions',p_package_dispositions) end,p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.booking_lock_occurrence_finances(array[old.occurrence_id]);select * into old from app_private.operation_proposals where id=old.id for update;select * into o from app_private.occurrences where id=old.occurrence_id;
 if old.version is distinct from p_expected_version or not coalesce(app_private.booking_proposal_fresh(old.id),false) then raise exception 'VERSION_CONFLICT';end if;
 if length(btrim(p_reason)) not between 1 and 2000 or p_reason is null then raise exception 'VALIDATION_ERROR';end if;
 select * into fee from finance_private.tutor_fee_agreements where id=o.current_fee_agreement_id;
 if p_tutor_compensation_minor is null or p_tutor_compensation_minor<0 or p_tutor_compensation_minor>coalesce(fee.fee_minor,0) then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 if fee.id is not null then perform app_private.require_role(fee.approved_by,'admin');end if;
 if app_private.policy_content(old.policy_version_id)->>'tutor_cancellation_compensation_rule'<>'reviewed_exact_adjustment' then raise exception 'POLICY_INCOMPLETE';end if;
 if p_package_dispositions is not null then
  if(select count(*) from jsonb_array_elements(p_package_dispositions))<>(select count(distinct value->>'enrollment_id') from jsonb_array_elements(p_package_dispositions)) or exists(select 1 from jsonb_array_elements(p_package_dispositions) x where not exists(select 1 from app_private.operation_customer_terms c where c.proposal_id=old.id and c.enrollment_id=(x.value->>'enrollment_id')::uuid)) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 expiry:=old.expires_at;
 for ct in select * from app_private.operation_customer_terms where proposal_id=old.id order by enrollment_id loop
  select value into disposition from jsonb_array_elements(p_package_dispositions) where(value->>'enrollment_id')::uuid=ct.enrollment_id;
  snapshot:=finance_private.finance_cancellation_snapshot(ct.enrollment_id,old.requested_terms->>'remedy',old.target_type='occurrence',disposition);snapshots:=snapshots||jsonb_build_object(ct.enrollment_id::text,snapshot);expiry:=least(expiry,(snapshot->>'window_expires_at')::timestamptz);
 end loop;
 if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
 insert into app_private.operation_proposals(kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason) values(old.kind,old.target_type,old.target_id,o.id,old.base_target_version,o.version,app_private.booking_roster_fingerprint(o.id),old.policy_version_id,old.requested_terms,expiry,actor,p_reason) returning * into p;
 for ct in select * from app_private.operation_customer_terms where proposal_id=old.id order by enrollment_id loop
  snapshot:=snapshots->ct.enrollment_id::text;select * into e from app_private.enrollments where id=ct.enrollment_id;select * into q from app_private.quotes where id=e.current_quote_id;
  terms:=app_private.booking_proposal_customer_json(e.id,q.policy_version_id,o.start_at,o.end_at,(snapshot->>'retained_net_minor')::bigint,snapshot->>'remedy');
  terms:=terms||jsonb_build_object('remedy_amount_minor',(snapshot->>'release_cash_minor')::bigint,'restored_credit_quanta',0,'released_credit_quanta',(snapshot->>'released_credit_quanta')::bigint);
  if snapshot?'package_disposition' then terms:=terms||jsonb_build_object('released_value_minor',snapshot->'package_disposition'->'released_value_minor','extinguished_credit_quanta',snapshot->'package_disposition'->'extinguished_credit_quanta','extinguished_value_minor',snapshot->'package_disposition'->'extinguished_value_minor');end if;
  insert into app_private.operation_customer_terms(proposal_id,learner_id,enrollment_id,source_quote_id,terms,terms_hash,financial_terms_ready) values(p.id,e.learner_id,e.id,q.id,terms,app_private.booking_proposal_hash(p.id,'learner',e.learner_id,terms,p.expires_at,p.base_target_version),true);
  insert into finance_private.cancellation_customer_finances(proposal_id,enrollment_id,charge_id,snapshot,snapshot_hash) values(p.id,e.id,(snapshot->>'charge_id')::uuid,snapshot,app_private.catalog_hash(snapshot));
 end loop;
 insert into finance_private.cancellation_compensation_terms(id,proposal_id,occurrence_id,tutor_id,base_fee_agreement_id,amount_minor,reviewed_by,command_id) values(compensation,p.id,o.id,o.tutor_id,fee.id,p_tutor_compensation_minor,actor,(context->>'command_id')::uuid);
 teacher:=app_private.booking_proposal_tutor_json(o.id,fee.id,o.start_at,o.end_at,o.target_tier)||jsonb_build_object('fee_agreement_id',null,'fee_minor',p_tutor_compensation_minor,'fee_agreement_state','reviewed_cancellation','cancellation_compensation_id',compensation);
 insert into finance_private.operation_tutor_terms(proposal_id,tutor_id,terms,terms_hash) values(p.id,o.tutor_id,teacher,app_private.booking_proposal_hash(p.id,'tutor',o.tutor_id,teacher,p.expires_at,p.base_target_version));
 update app_private.operation_proposals set state='declined',version=version+1,invalidated_reason='superseded_by_review',updated_at=now() where id=old.id;
 insert into app_private.operation_proposal_supersessions(previous_proposal_id,replacement_proposal_id,actor_account_id,command_id) values(old.id,p.id,actor,(context->>'command_id')::uuid);
 perform app_private.booking_enqueue_due(o.id,p.expires_at);perform set_config('response.status','201',true);
 return app_private.booking_finish(context,p.id,p.version,jsonb_build_object('proposal_id',p.id,'terms_hash',app_private.booking_proposal_admin_hash(p.id),'expires_at',p.expires_at,'required_actions','["review_terms"]'::jsonb,'replaces_proposal_id',old.id),'cancellation_proposal_reviewed',jsonb_build_object('proposal_id',p.id,'replaces_proposal_id',old.id,'occurrence_id',o.id));
end $$;
create or replace function app_private.booking_consume_cancellation(p_proposal_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;o app_private.occurrences%rowtype;comp finance_private.cancellation_compensation_terms%rowtype;financial finance_private.cancellation_customer_finances%rowtype;ct app_private.operation_customer_terms%rowtype;current_snapshot jsonb;adjustment jsonb;balance jsonb;remedy uuid;ids uuid[]:='{}';remedies uuid[]:='{}';retained bigint;delta bigint;remaining integer;decision uuid;begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;select * into o from app_private.occurrences where id=p.occurrence_id;
 if p.kind is distinct from 'cancellation_remedy' or p.state<>'approved' or not coalesce(app_private.booking_proposal_fresh(p.id),false) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.require_role(p.approved_by,'admin');if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 select * into comp from finance_private.cancellation_compensation_terms where proposal_id=p.id;if comp.id is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;perform app_private.require_role(comp.reviewed_by,'admin');
 -- Snapshot and party checks precede all postings. Cash/evidence arriving after review requires a new review.
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  if financial.snapshot?'package_disposition' then
   current_snapshot:=finance_private.finance_cancellation_snapshot(financial.enrollment_id,p.requested_terms->>'remedy',p.target_type='occurrence',jsonb_build_object('enrollment_id',financial.enrollment_id,'released_credit_quanta',financial.snapshot->'package_disposition'->'released_credit_quanta','extinguished_credit_quanta',financial.snapshot->'package_disposition'->'extinguished_credit_quanta'));
  else current_snapshot:=finance_private.finance_cancellation_snapshot_before_disposition(financial.enrollment_id,p.requested_terms->>'remedy',p.target_type='occurrence');end if;
  if app_private.catalog_hash(current_snapshot)<>financial.snapshot_hash then raise exception 'VERSION_CONFLICT';end if;
 end loop;
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  select * into ct from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=financial.enrollment_id;current_snapshot:=financial.snapshot;
  if current_snapshot->>'reservation_id' is not null then
   if current_snapshot?'package_disposition' then perform app_private.package_commit_cancellation_disposition(p.id,financial.enrollment_id,p_context);
   else perform finance_private.finance_release_package_coverage((current_snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);
    perform app_private.package_release_reservation_kernel((current_snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);end if;
  end if;
  balance:=finance_private.finance_charge_balance(financial.charge_id);retained:=(current_snapshot->>'retained_net_minor')::bigint;delta:=retained-(balance->>'commercial_net_minor')::bigint;adjustment:=null;
  if delta<>0 then adjustment:=finance_private.finance_adjust_charge(financial.charge_id,delta,'commercial','cancellation_proposal',p.id,now(),'Accepted saved-policy cancellation outcome',p_context,'cancellation:'||financial.enrollment_id);end if;
  remedy:=null;
  if(current_snapshot->>'release_cash_minor')::bigint>0 then
   insert into finance_private.financial_remedy_plans(source_type,source_id,policy_version_id,proposal_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values('charge',financial.charge_id,(current_snapshot->>'policy_version_id')::uuid,p.id,p.approved_by,0,(current_snapshot->>'release_cash_minor')::bigint,case when current_snapshot->>'remedy'='monetary_account_credit' then 'account_credit' else 'cash' end,ct.terms_hash,jsonb_build_object('allocation_ids',current_snapshot->'allocation_ids'),(p_context->>'command_id')::uuid) returning id into remedy;remedies:=array_append(remedies,remedy);
  end if;
  insert into app_private.booking_cancellation_effects(proposal_id,enrollment_id,remedy_id,charge_adjustment_id,command_id) values(p.id,financial.enrollment_id,remedy,(adjustment->>'adjustment_id')::uuid,(p_context->>'command_id')::uuid);
  ids:=array_append(ids,financial.enrollment_id);
 end loop;
 if cardinality(ids)=0 then raise exception 'CONSENT_REQUIRED';end if;
 update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where id=any(ids);
 update finance_private.charge_accounts set commitment_state='committed',conditional_amendment_id=null,version=version+1,updated_at=now() where charge_id in(select charge_id from finance_private.cancellation_customer_finances where proposal_id=p.id);
 update app_private.booking_financial_resolutions set state='resolved' where enrollment_id=any(ids) and state='open';
 insert into finance_private.cancellation_compensation_obligations(proposal_id,compensation_terms_id,occurrence_id,tutor_id,amount_minor,command_id) values(p.id,comp.id,o.id,o.tutor_id,comp.amount_minor,(p_context->>'command_id')::uuid);
 select count(*) into remaining from app_private.enrollments where occurrence_id=o.id and state in('held','confirmed');
 if remaining=0 or p.target_type='occurrence' then
  update app_private.occurrences set state='cancelled',meeting_status='revoked',version=version+1,updated_at=now() where id=o.id returning * into o;update app_private.tutor_reservations set active=false where occurrence_id=o.id;
  update app_private.waitlist_entries set state='cancelled',version=version+1,updated_at=now() where occurrence_id=o.id and state in('waiting','offered');
 else
  update app_private.occurrences set version=version+1,updated_at=now() where id=o.id returning * into o;
  if o.format='group' and remaining<(app_private.policy_content(o.policy_version_id)->>'group_minimum_size')::int then insert into app_private.booking_operational_decisions(occurrence_id,occurrence_version,policy_version_id,action,reason,command_id) values(o.id,o.version,o.policy_version_id,'admin_proposal_with_customer_acceptance','group_below_saved_minimum_after_cancellation',(p_context->>'command_id')::uuid) returning id into decision;end if;
 end if;
 update app_private.operation_proposals set state='committed',version=version+1,committed_at=now(),updated_at=now() where id=p.id;
 perform app_private.booking_expire_proposals(o.id);perform app_private.booking_enqueue_due(o.id,now());
 perform app_private.enqueue_event(gen_random_uuid(),'booking_cancellation_committed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'proposal_id',p.id),'calendar.sync');
 if decision is not null then perform app_private.enqueue_event(gen_random_uuid(),'booking_operational_resolution_required',o.id,jsonb_build_object('occurrence_id',o.id,'decision_id',decision),'notifications.route');end if;
 return jsonb_build_object('enrollment_ids',ids,'remedy_ids',remedies,'occurrence_version',o.version);
end $$;
create or replace function finance_private.finance_release_package_coverage(p_reservation_id uuid,p_reason text,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r app_private.package_reservations%rowtype;e app_private.enrollments%rowtype;c finance_private.charges%rowtype;v finance_private.package_value_allocations%rowtype;n finance_private.package_coverage_postings%rowtype;ids uuid[]:='{}';result jsonb;ledger_id uuid;remaining bigint;begin
 select * into r from app_private.package_reservations where id=p_reservation_id;select * into e from app_private.enrollments where id=r.enrollment_id;select * into c from finance_private.charges where enrollment_id=r.enrollment_id;
 if c.id is null or exists(select 1 from finance_private.package_coverage_releases where reservation_id=r.id) then return ids;end if;
 if r.state='partially_consumed' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 perform 1 from finance_private.charge_accounts where charge_id=c.id for update;
 select * into n from finance_private.package_coverage_postings where reservation_id=r.id;
 select * into v from finance_private.package_value_allocations where reservation_id=r.id;
 if n.reservation_id is not null then ids:=finance_private.finance_reduce_named_coverage(r.id,finance_private.finance_named_coverage_remaining(r.id),p_context,'coverage-release:'||r.id);result:=jsonb_build_object('adjustment_id',ids[array_length(ids,1)]);end if;
 if v.id is not null then
  select v.amount_minor-coalesce(sum(amount_minor),0) into remaining from finance_private.package_value_reversals where allocation_id=v.id;
  ledger_id:=finance_private.finance_reverse_package_value(r.id,remaining,p_context,r.id);if ledger_id is not null then ids:=array_append(ids,ledger_id);end if;
 end if;
 insert into finance_private.package_coverage_releases(reservation_id,adjustment_id,command_id) values(r.id,(result->>'adjustment_id')::uuid,(p_context->>'command_id')::uuid);
 if e.state in('expired','cancelled') then
  update finance_private.charge_accounts set commitment_state='resolution_required',version=version+1,updated_at=now() where charge_id=c.id;

 end if;
 return ids;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='app_private' and p.proname in('package_cancellation_disposition','package_commit_cancellation_disposition','booking_consume_cancellation'))
 or(n.nspname='finance_private' and p.proname in('finance_cancellation_snapshot','finance_cancellation_snapshot_before_disposition','finance_reverse_package_value','finance_release_package_coverage'))
 or(n.nspname='api' and p.proname='revise_cancellation_proposal')
 loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
