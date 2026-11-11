-- Shared full resource-order orchestration. Core discovers and rechecks the complete source graph.
grant create on schema app_private to git_tutor_commands;
create function app_private.booking_lock_financial_scope(p_scope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare learner uuid;begin
 if jsonb_typeof(p_scope) is distinct from 'object' or p_scope->>'source_fingerprint' is null then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from app_private.tutors where id in(select value::uuid from jsonb_array_elements_text(p_scope->'tutor_ids')) order by id for update;
 perform 1 from app_private.occurrences where id in(select value::uuid from jsonb_array_elements_text(p_scope->'occurrence_ids')) order by id for update;
 perform 1 from app_private.enrollments where id in(select value::uuid from jsonb_array_elements_text(p_scope->'enrollment_ids')) order by id for update;
 perform 1 from app_private.review_cases where id in(select value::uuid from jsonb_array_elements_text(p_scope->'case_ids')) order by id for update;
 perform 1 from app_private.receipts where id in(select value::uuid from jsonb_array_elements_text(p_scope->'receipt_ids')) order by id for update;
 for learner in select value::uuid from jsonb_array_elements_text(p_scope->'learner_ids') order by value::uuid loop perform app_private.package_lock_learner(learner);end loop;
 perform 1 from app_private.package_purchases where id in(select value::uuid from jsonb_array_elements_text(p_scope->'purchase_ids')) order by id for update;
 perform 1 from app_private.package_lots where id in(select value::uuid from jsonb_array_elements_text(p_scope->'lot_ids')) order by id for update;
 perform 1 from app_private.package_reservations where purchase_id in(select value::uuid from jsonb_array_elements_text(p_scope->'purchase_ids')) order by id for update;
 perform 1 from finance_private.remedy_sources where id in(select value::uuid from jsonb_array_elements_text(p_scope->'remedy_source_ids')) order by id for update;
 perform 1 from app_private.remedy_reservations where source_id in(select value::uuid from jsonb_array_elements_text(p_scope->'remedy_source_ids')) order by id for update;
 return finance_private.finance_lock_targets(array(select value::uuid from jsonb_array_elements_text(p_scope->'charge_ids')),array(select value::uuid from jsonb_array_elements_text(p_scope->'transfer_ids')),array(select value::uuid from jsonb_array_elements_text(p_scope->'refund_ids')),array(select value::uuid from jsonb_array_elements_text(p_scope->'credit_lot_ids')),p_scope->>'source_fingerprint');
end $$;
alter function app_private.booking_lock_financial_scope(jsonb) owner to git_tutor_commands;
revoke all on function app_private.booking_lock_financial_scope(jsonb) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
grant create on schema app_private to git_tutor_commands;
create function app_private.booking_financial_scope(p_enrollment_ids uuid[],p_purchase_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare charges uuid[];scope jsonb;learners uuid[];purchases uuid[];begin
 select coalesce(array_agg(id order by id),'{}') into charges from finance_private.charges where enrollment_id=any(p_enrollment_ids) or package_purchase_id=any(p_purchase_ids);
 scope:=finance_private.finance_discover_scope(charges,'{}','{}','{}');
 select coalesce(array_agg(distinct id order by id),'{}') into learners from(select learner_id id from app_private.enrollments where id=any(p_enrollment_ids) union select learner_id from app_private.package_purchases where id=any(p_purchase_ids) union select value::uuid from jsonb_array_elements_text(scope->'learner_ids')) x;
 select coalesce(array_agg(distinct id order by id),'{}') into purchases from(select id from app_private.package_purchases where learner_id=any(learners) union select value::uuid from jsonb_array_elements_text(scope->'purchase_ids')) x;
 return scope||jsonb_build_object('learner_ids',learners,'purchase_ids',purchases,
  'enrollment_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select id from app_private.enrollments where id=any(p_enrollment_ids) union select value::uuid from jsonb_array_elements_text(scope->'enrollment_ids')) x),
  'occurrence_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select occurrence_id id from app_private.enrollments where id=any(p_enrollment_ids) union select value::uuid from jsonb_array_elements_text(scope->'occurrence_ids')) x),
  'tutor_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select o.tutor_id id from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id where e.id=any(p_enrollment_ids) union select value::uuid from jsonb_array_elements_text(scope->'tutor_ids')) x),
  'lot_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select id from app_private.package_lots where purchase_id=any(purchases) union select value::uuid from jsonb_array_elements_text(scope->'lot_ids')) x));
end $$;
alter function app_private.booking_financial_scope(uuid[],uuid[]) owner to git_tutor_commands;
revoke all on function app_private.booking_financial_scope(uuid[],uuid[]) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
-- T06 exact referenced package coverage and funding projections.
grant create on schema app_private,finance_private to git_tutor_commands;
create table finance_private.package_funding_sources(id uuid primary key default gen_random_uuid(),purchase_id uuid not null references app_private.package_purchases(id),original_lot_id uuid not null references app_private.package_lots(id),origin_kind text not null check(origin_kind in('purchased','approved_credit')),transfer_id uuid not null references finance_private.incoming_transfers(id),allocation_id uuid references finance_private.payment_allocations(id),credit_application_id uuid references finance_private.credit_applications(id),amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),command_id uuid not null,created_at timestamptz not null default now(),check((origin_kind='purchased' and allocation_id is not null and credit_application_id is null) or(origin_kind='approved_credit' and credit_application_id is not null and allocation_id is null)));
create unique index package_funding_allocation_once on finance_private.package_funding_sources(original_lot_id,allocation_id) where allocation_id is not null;
create unique index package_funding_credit_once on finance_private.package_funding_sources(original_lot_id,credit_application_id) where credit_application_id is not null;
create table finance_private.package_value_allocations(id uuid primary key default gen_random_uuid(),charge_id uuid not null references finance_private.charges(id),reservation_id uuid not null unique references app_private.package_reservations(id),quote_id uuid not null references app_private.quotes(id),conditional_amendment_id uuid references app_private.group_amendments(id),amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),consent_refs jsonb not null,ledger_transaction_id uuid not null references finance_private.ledger_transactions(id),command_id uuid not null,created_at timestamptz not null default now());
create table finance_private.package_value_reversals(id uuid primary key default gen_random_uuid(),allocation_id uuid not null unique references finance_private.package_value_allocations(id),amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),ledger_transaction_id uuid not null references finance_private.ledger_transactions(id),command_id uuid not null,created_at timestamptz not null default now());
create table finance_private.package_coverage_postings(reservation_id uuid primary key references app_private.package_reservations(id),charge_id uuid not null references finance_private.charges(id),adjustment_id uuid references finance_private.charge_adjustments(id),credit_minor bigint not null check(credit_minor between 0 and 9007199254740991),command_id uuid not null,created_at timestamptz not null default now());
create table finance_private.package_coverage_releases(reservation_id uuid primary key references app_private.package_reservations(id),adjustment_id uuid references finance_private.charge_adjustments(id),command_id uuid not null,created_at timestamptz not null default now());
create table app_private.booking_financial_resolutions(id uuid primary key default gen_random_uuid(),enrollment_id uuid not null references app_private.enrollments(id),charge_id uuid not null references finance_private.charges(id),policy_version_id uuid not null references app_private.policy_versions(id),reason text not null,state text not null default 'open' check(state in('open','resolved')),command_id uuid not null,created_at timestamptz not null default now(),unique(enrollment_id,command_id));
create table app_private.booking_commitments(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),occurrence_version integer not null,kind text not null check(kind in('initial','amendment')),pricing_version_id uuid not null references app_private.pricing_versions(id),policy_version_id uuid not null references app_private.policy_versions(id),fee_agreement_id uuid not null references finance_private.tutor_fee_agreements(id),target_tier integer,roster jsonb not null,command_id uuid not null,created_at timestamptz not null default now(),unique(occurrence_id,occurrence_version));
create table app_private.package_financing_holds(id uuid primary key default gen_random_uuid(),original_lot_id uuid not null references app_private.package_lots(id),source_type text not null,source_id uuid not null,active boolean not null default true,command_id uuid not null,created_at timestamptz not null default now(),resolved_at timestamptz,resolution_command_id uuid,unique(original_lot_id,source_type,source_id));

create or replace function finance_private.finance_package_applied_value(p_charge_id uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(a.amount_minor-r.amount),0)::bigint from finance_private.package_value_allocations a cross join lateral(select coalesce(sum(v.amount_minor),0) amount from finance_private.package_value_reversals v where v.allocation_id=a.id) r where a.charge_id=p_charge_id
$$;
create function finance_private.finance_apply_package_coverage(p_reservation_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r app_private.package_reservations%rowtype;c finance_private.charges%rowtype;b jsonb;amount bigint;adjustment jsonb;allocation_id uuid;ledger_id uuid;lines jsonb;begin
 select * into r from app_private.package_reservations where id=p_reservation_id;
 select * into c from finance_private.charges where enrollment_id=r.enrollment_id;
 if c.id is null or r.state<>'reserved' then raise exception 'CONSENT_REQUIRED';end if;
 perform 1 from finance_private.charge_accounts where charge_id=c.id for update;
 if exists(select 1 from finance_private.package_coverage_postings where reservation_id=r.id) or exists(select 1 from finance_private.package_value_allocations where reservation_id=r.id) then raise exception 'STATE_CONFLICT';end if;
 b:=finance_private.finance_charge_balance(c.id);
 if r.coverage_rule='named_entitlement_covers_eligible_occurrence' then
  if r.agreed_top_up_minor is null or r.agreed_top_up_minor>(b->>'commercial_net_minor')::bigint then raise exception 'CONSENT_REQUIRED';end if;
  amount:=(b->>'commercial_net_minor')::bigint-r.agreed_top_up_minor;
  if amount>0 then adjustment:=finance_private.finance_adjust_charge(c.id,-amount,case when r.reserved_credit_quanta>=r.required_credit_quanta then 'named_coverage' else 'partial_named_coverage' end,'package_reservation',r.id,now(),'Accepted named service coverage',p_context,'named-coverage:'||r.id);end if;
  insert into finance_private.package_coverage_postings(reservation_id,charge_id,adjustment_id,credit_minor,command_id) values(r.id,c.id,(adjustment->>'adjustment_id')::uuid,amount,(p_context->>'command_id')::uuid);
 else
  amount:=r.allocated_value_minor;
  if amount>(b->>'commercial_net_minor')::bigint or r.agreed_top_up_minor is distinct from (b->>'commercial_net_minor')::bigint-amount then raise exception 'CONSENT_REQUIRED';end if;
  if (b->>'allocated_cash_minor')::bigint+amount>(b->>'commercial_net_minor')::bigint then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  lines:=case when amount=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',amount),jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',-amount)) end;
  ledger_id:=finance_private.finance_post_balanced('package-value:'||r.id,'package_value_applied',r.id,c.currency,now(),lines,p_context);
  insert into finance_private.package_value_allocations(charge_id,reservation_id,quote_id,conditional_amendment_id,amount_minor,consent_refs,ledger_transaction_id,command_id) values(c.id,r.id,r.quote_id,(select conditional_amendment_id from finance_private.charge_accounts where charge_id=c.id),amount,r.acceptance_refs,ledger_id,(p_context->>'command_id')::uuid) returning id into allocation_id;
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;
 end if;
 return jsonb_build_object('coverage_adjustment_id',adjustment->'adjustment_id','package_value_allocation_id',allocation_id,'released_cash_allocation_ids',coalesce(adjustment->'allocation_reversal_ids','[]'::jsonb));
end $$;
create function finance_private.finance_release_package_coverage(p_reservation_id uuid,p_reason text,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r app_private.package_reservations%rowtype;e app_private.enrollments%rowtype;c finance_private.charges%rowtype;v finance_private.package_value_allocations%rowtype;n finance_private.package_coverage_postings%rowtype;ids uuid[]:='{}';result jsonb;ledger_id uuid;begin
 select * into r from app_private.package_reservations where id=p_reservation_id;select * into e from app_private.enrollments where id=r.enrollment_id;select * into c from finance_private.charges where enrollment_id=r.enrollment_id;
 if c.id is null or exists(select 1 from finance_private.package_coverage_releases where reservation_id=r.id) then return ids;end if;
 if r.state='partially_consumed' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 perform 1 from finance_private.charge_accounts where charge_id=c.id for update;
 select * into n from finance_private.package_coverage_postings where reservation_id=r.id;
 select * into v from finance_private.package_value_allocations where reservation_id=r.id;
 if n.reservation_id is not null and n.credit_minor>0 then result:=finance_private.finance_adjust_charge(c.id,n.credit_minor,'linked_inverse','package_coverage_release',n.adjustment_id,now(),'Release the referenced named service coverage',p_context,'coverage-release:'||r.id);ids:=array_append(ids,(result->>'adjustment_id')::uuid);end if;
 if v.id is not null and not exists(select 1 from finance_private.package_value_reversals where allocation_id=v.id) then
  ledger_id:=finance_private.finance_post_balanced('package-value-release:'||r.id,'package_value_released',r.id,c.currency,now(),case when v.amount_minor=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('account_code','receivable','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',v.amount_minor),jsonb_build_object('account_code','deferred_tuition','learner_id',r.learner_id,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'charge_id',c.id,'signed_minor',-v.amount_minor)) end,p_context);
  insert into finance_private.package_value_reversals(allocation_id,amount_minor,ledger_transaction_id,command_id) values(v.id,v.amount_minor,ledger_id,(p_context->>'command_id')::uuid);ids:=array_append(ids,ledger_id);
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;
 end if;
 insert into finance_private.package_coverage_releases(reservation_id,adjustment_id,command_id) values(r.id,(result->>'adjustment_id')::uuid,(p_context->>'command_id')::uuid);
 if e.state in('expired','cancelled') then
  update finance_private.charge_accounts set commitment_state='resolution_required',version=version+1,updated_at=now() where charge_id=c.id;

 end if;
 return ids;
end $$;

create function finance_private.finance_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;q app_private.quotes%rowtype;r app_private.package_reservations%rowtype;c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;b jsonb;policy jsonb;required bigint:=0;additional bigint:=0;net bigint;cash bigint;package_value bigint;reserved bigint:=0;topup bigint;reason text:='ELIGIBLE';financial boolean:=false;conditional uuid;reconciliation text:='clear';begin
 select * into e from app_private.enrollments where id=p_enrollment_id;select * into o from app_private.occurrences where id=e.occurrence_id;select * into q from app_private.quotes where id=p_quote_id;
 select * into c from finance_private.charges where enrollment_id=e.id;select * into a from finance_private.charge_accounts where charge_id=c.id;conditional:=a.conditional_amendment_id;
 if conditional is not null then select * into q from app_private.quotes where id=(select quote_id from finance_private.charge_acceptance_sources where charge_id=c.id);end if;policy:=app_private.policy_content(q.policy_version_id);
 if c.id is not null then b:=finance_private.finance_charge_balance(c.id);net:=(b->>'commercial_net_minor')::bigint;cash:=(b->>'allocated_cash_minor')::bigint;package_value:=(b->>'allocated_package_value_minor')::bigint;reconciliation:=b->>'reconciliation_state';required:=app_private.booking_deposit(net,policy);additional:=greatest(0,required-cash-package_value);end if;
 select * into r from app_private.package_reservations where enrollment_id=e.id and state in('reserved','partially_consumed','consumed') order by created_at desc limit 1;
 if r.id is not null then select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0)::bigint into reserved from app_private.entitlement_movements where reservation_id=r.id;topup:=r.agreed_top_up_minor;else topup:=net;end if;
 if e.id is null or q.enrollment_id is distinct from e.id or(conditional is null and q.policy_version_id is distinct from p_policy_version_id) then reason:='QUOTE_NOT_ACCEPTED';
 elsif e.state in('expired','cancelled') or o.state='cancelled' then reason:=case when e.state='expired' then 'HOLD_EXPIRED' else 'OCCURRENCE_CANCELLED' end;
 elsif e.state='held' and e.hold_expires_at<=now() then reason:='HOLD_EXPIRED';
 elsif c.id is null then reason:='QUOTE_NOT_ACCEPTED';
 elsif reconciliation='requires_review' or a.commitment_state='resolution_required' then reason:='RECONCILIATION_REQUIRED';reconciliation:='requires_review';
 elsif exists(select 1 from app_private.package_reservation_allocations x join app_private.package_lots l on l.id=x.lot_id join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where x.reservation_id=r.id) then reason:='FINANCING_HOLD';
 elsif conditional is not null and not app_private.booking_proposal_fresh(conditional) then reason:='QUOTE_NOT_ACCEPTED';
 elsif conditional is not null then reason:='AMENDMENT_PENDING';
 elsif q.id is distinct from e.current_quote_id or q.base_terms_version<>o.quote_terms_version then reason:='QUOTE_NOT_ACCEPTED';
 elsif e.state='held' and q.expires_at<=now() then reason:='QUOTE_EXPIRED';
 elsif not exists(select 1 from app_private.quote_acceptances x where x.quote_id=q.id and app_private.booking_can_access(x.actor_account_id,e.learner_id)) then reason:='QUOTE_NOT_ACCEPTED';
 elsif r.id is not null and r.coverage_rule='named_entitlement_covers_eligible_occurrence' and not(policy->'confirmation_funding_sources'?'reserved_named_package_entitlement') then reason:='POLICY_INCOMPLETE';
 elsif package_value>0 and not(policy->'confirmation_funding_sources'?'reserved_eligible_package_value') then reason:='POLICY_INCOMPLETE';
 elsif cash>0 and not(policy->'confirmation_funding_sources'?'verified_payment_allocation') then reason:='POLICY_INCOMPLETE';
 elsif additional>0 then reason:='INSUFFICIENT_FUNDS';end if;
 financial:=c.id is not null and additional=0 and reason in('ELIGIBLE','AMENDMENT_PENDING') and reconciliation='clear';
 return jsonb_build_object('integration_state','ready','eligible',financial and reason='ELIGIBLE','financially_eligible',financial,'reason',reason,'charge_id',c.id,'net_charge_minor',net,'allocated_minor',cash,'balance_minor',case when b is null then null else greatest(0,(b->>'receivable_minor')::bigint) end,'required_for_confirmation_minor',required,'reserved_credit_quanta',reserved,'allocated_package_value_minor',package_value,'top_up_minor',topup,'additional_required_minor',additional,'conditional_amendment_id',conditional,'funding_quote_id',case when conditional is null then q.id else(select quote_id from finance_private.charge_acceptance_sources where charge_id=c.id) end,'reconciliation_state',reconciliation);
end $$;
create or replace function app_private.booking_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select finance_private.finance_funding_status(p_enrollment_id,p_quote_id,p_policy_version_id) $$;
create function app_private.booking_deposit(p_amount bigint,p_policy jsonb) returns bigint language plpgsql immutable security definer set search_path='' as $$
declare n numeric;begin
 if p_amount is null or p_amount<0 or p_amount>9007199254740991 or p_policy->>'deposit_basis_points' is null or(p_policy->>'deposit_basis_points')::numeric not between 0 and 10000 or p_policy->>'deposit_rounding' not in('ceiling_minor_unit','floor_minor_unit','half_up_minor_unit') then raise exception 'POLICY_INCOMPLETE';end if;
 n:=p_amount::numeric*(p_policy->>'deposit_basis_points')::numeric/10000;
 return(case p_policy->>'deposit_rounding' when 'ceiling_minor_unit' then ceil(n) when 'floor_minor_unit' then floor(n) else floor(n+0.5) end)::bigint;
end $$;
create function app_private.booking_try_confirm_locked(p_occurrence_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare o app_private.occurrences%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;fee finance_private.tutor_fee_agreements%rowtype;reason text;funding jsonb;roster jsonb:='[]';learner uuid;ids uuid[]:='{}';begin
 select * into o from app_private.occurrences where id=p_occurrence_id;
 if o.id is null then return jsonb_build_object('state','not_applicable','occurrence_id',null,'reason',null);end if;
 if o.state='confirmed' then return jsonb_build_object('state','already_confirmed','occurrence_id',o.id,'reason','ELIGIBLE');end if;
 if o.state='cancelled' then reason:='OCCURRENCE_CANCELLED';elsif o.state<>'forming' then return jsonb_build_object('state','not_applicable','occurrence_id',o.id,'reason',null);elsif o.confirmation_deadline_at<=now() then reason:='HOLD_EXPIRED';end if;
 if reason is null and not app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor') then reason:='SCHEDULE_CONFLICT';end if;
 if reason is null then begin perform app_private.booking_assert_schedule(o.tutor_id,o.start_at,o.end_at,o.id);exception when others then if sqlerrm='SCHEDULE_CONFLICT' then reason:='SCHEDULE_CONFLICT';else raise;end if;end;end if;
 select * into fee from finance_private.tutor_fee_agreements where id=o.current_fee_agreement_id;
 if reason is null and(fee.id is null or fee.occurrence_id is distinct from o.id or fee.tutor_id is distinct from o.tutor_id or fee.target_tier is distinct from o.target_tier or fee.pricing_version_id is distinct from o.pricing_version_id or fee.duration_minutes is distinct from o.duration_minutes or not app_private.has_role(fee.approved_by,'admin')) then reason:='FEE_NOT_APPROVED';end if;
 if reason is null and(select count(*) from app_private.enrollments where occurrence_id=o.id and state='held' and hold_kind='ordinary')<>coalesce(o.target_tier,1) then reason:='TARGET_NOT_MET';end if;
 if reason is null then
  for e in select * from app_private.enrollments where occurrence_id=o.id and state='held' and hold_kind='ordinary' order by id for update loop
   select * into q from app_private.quotes where id=e.current_quote_id;funding:=app_private.booking_funding_status(e.id,q.id,q.policy_version_id);
   if not(funding->>'eligible')::boolean then reason:=funding->>'reason';exit;end if;
   ids:=array_append(ids,e.id);roster:=roster||jsonb_build_array(jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'quote_id',q.id,'quote_hash',q.terms_hash,'customer_price_minor',q.customer_price_minor,'currency',q.currency,'charge_id',funding->'charge_id','net_charge_minor',funding->'net_charge_minor','coverage_reservation_id',(select id from app_private.package_reservations where enrollment_id=e.id and state='reserved')));
  end loop;
 end if;
 if reason is not null then return jsonb_build_object('state','awaiting_requirements','occurrence_id',o.id,'reason',reason);end if;
 -- All affected learner locks precede statement triggers and any later package effects.
 for learner in select distinct learner_id from app_private.enrollments where id=any(ids) order by learner_id loop perform app_private.package_lock_learner(learner);end loop;
 update app_private.enrollments set state='confirmed',version=version+1,updated_at=now() where id=any(ids);
 update app_private.occurrences set state='confirmed',meeting_status='pending',version=version+1,updated_at=now() where id=o.id returning * into o;
 insert into app_private.booking_commitments(occurrence_id,occurrence_version,kind,pricing_version_id,policy_version_id,fee_agreement_id,target_tier,roster,command_id) values(o.id,o.version,'initial',o.pricing_version_id,o.policy_version_id,o.current_fee_agreement_id,o.target_tier,roster,(p_context->>'command_id')::uuid);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values((p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'booking_confirmed',o.id,jsonb_build_object('occurrence_version',o.version,'enrollment_ids',ids));
 perform app_private.enqueue_event(gen_random_uuid(),'occurrence_confirmed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'calendar.sync');
 return jsonb_build_object('state','confirmed','occurrence_id',o.id,'reason','ELIGIBLE');
end $$;

create or replace function api.reserve_package_credit(p_package_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;seat app_private.enrollments%rowtype;purchase app_private.package_purchases%rowtype;preview jsonb;accepted jsonb;reservation app_private.package_reservations%rowtype;version integer;acceptance app_private.quote_acceptances%rowtype;begin
 select * into seat from app_private.enrollments where id=p_enrollment_id;if seat.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,seat.learner_id,'booking');perform app_private.package_assert_scope(actor,seat.learner_id,'payments');
 context:=app_private.package_begin(actor,'reserve_package_credit',jsonb_build_object('package_id',p_package_id,'enrollment_id',p_enrollment_id,'credit_quanta',p_credit_quanta,'coverage_proposal_id',p_coverage_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.booking_lock_financial_scope(app_private.booking_financial_scope(array[p_enrollment_id],array[p_package_id]));
 perform app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=p_enrollment_id for update;
 purchase:=app_private.package_lock_purchase(p_package_id);if purchase.learner_id<>seat.learner_id then raise exception 'NOT_FOUND';end if;if purchase.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 -- Do not opportunistically expire other learners' booking holds after taking this learner's finances.
 if seat.state<>'held' or seat.hold_expires_at<=now() or seat.hold_kind<>'ordinary' then raise exception 'STATE_CONFLICT';end if;
 preview:=app_private.package_coverage_quote(p_package_id,p_enrollment_id,p_credit_quanta);
 if p_coverage_proposal_id is not null then accepted:=app_private.package_validate_coverage_proposal(p_coverage_proposal_id,actor,p_package_id,p_enrollment_id,p_credit_quanta);
 else
  if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
  if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;
  select * into acceptance from app_private.quote_acceptances a where a.quote_id=seat.current_quote_id and app_private.booking_can_access(a.actor_account_id,seat.learner_id) order by accepted_at,id limit 1;perform app_private.package_assert_scope(acceptance.actor_account_id,seat.learner_id,'booking');
  accepted:=preview||jsonb_build_object('accepted_actor_account_id',acceptance.actor_account_id,'accepted_at',acceptance.accepted_at,'package_acceptance_id',(select id from app_private.package_purchase_acceptances where purchase_id=purchase.id),'quote_acceptance_id',acceptance.id);
 end if;
 reservation:=app_private.package_reserve_allocations(p_package_id,p_enrollment_id,p_credit_quanta,p_coverage_proposal_id,accepted,context);
 perform finance_private.finance_apply_package_coverage(reservation.id,context);
 if p_coverage_proposal_id is not null then perform app_private.package_commit_proposal(p_coverage_proposal_id,context);end if;
 update app_private.package_purchases set version=package_purchases.version+1,updated_at=now() where id=purchase.id returning package_purchases.version into version;
 perform set_config('response.status','201',true);return app_private.package_finish(context,reservation.id,reservation.version,jsonb_build_object('reservation_id',reservation.id,'reserved_credit_quanta',reservation.reserved_credit_quanta,'carrying_value_minor',reservation.allocated_value_minor,'top_up_minor',reservation.agreed_top_up_minor),'package_credit_reserved',jsonb_build_object('package_purchase_id',purchase.id,'enrollment_id',seat.id,'reservation_id',reservation.id));
end $$;
create or replace function api.release_package_reservation(p_reservation_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();row app_private.package_reservations%rowtype;seat app_private.enrollments%rowtype;context jsonb;result jsonb;begin
 select * into row from app_private.package_reservations where id=p_reservation_id;if row.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,row.learner_id,'booking',true);perform app_private.package_assert_scope(actor,row.learner_id,'payments',true);
 context:=app_private.package_begin(actor,'release_package_reservation',jsonb_build_object('reservation_id',p_reservation_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 perform app_private.booking_lock_financial_scope(app_private.booking_financial_scope(array[row.enrollment_id],array[row.purchase_id]));
 select * into seat from app_private.enrollments where id=row.enrollment_id;perform app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=row.enrollment_id for update;perform app_private.package_lock_purchase(row.purchase_id);
 select * into row from app_private.package_reservations where id=p_reservation_id for update;if row.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if seat.state<>'held' or row.state<>'reserved' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 perform finance_private.finance_release_package_coverage(row.id,'customer_release',context);
 result:=app_private.package_release_reservation_kernel(row.id,'customer_release',context);return app_private.package_finish(context,row.id,row.version+1,result,'package_reservation_released',jsonb_build_object('package_purchase_id',row.purchase_id,'reservation_id',row.id));
end $$;
create or replace function app_private.package_release_for_hold_end(p_enrollment_id uuid,p_reason text,p_command_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare row app_private.package_reservations%rowtype;result jsonb;ids uuid[]:='{}';begin
 for row in select * from app_private.package_reservations where enrollment_id=p_enrollment_id and state in('reserved','partially_consumed') order by purchase_id,id loop
  perform app_private.package_lock_purchase(row.purchase_id);perform finance_private.finance_release_package_coverage(row.id,p_reason,p_command_context);result:=app_private.package_release_reservation_kernel(row.id,p_reason,p_command_context);
  ids:=ids||array(select value::uuid from jsonb_array_elements_text(result->'movement_ids'));
 end loop;return ids;end $$;
create or replace function app_private.booking_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;context jsonb;target uuid;resource uuid;occ app_private.occurrences%rowtype;offer app_private.offers%rowtype;seat app_private.enrollments%rowtype;quote app_private.quotes%rowtype;wait app_private.waitlist_entries%rowtype;teacher app_private.tutors%rowtype;policy jsonb;rules app_private.availability_rules%rowtype;version integer;expected integer;result jsonb:='{}';event_name text;start_at timestamptz;end_at timestamptz;available_version integer;amount bigint;fee_id uuid;count_seats integer;count_ordinary integer;accepted timestamptz;item jsonb;normalized jsonb;begin
 actor:=app_private.require_actor();expected:=(p_input->>'expected_version')::int;
 if p_name in ('set_availability','create_occurrence','change_occurrence_capacity','confirm_occurrence','approve_tutor_fee') then
  if p_name='set_availability' then
   select * into teacher from app_private.tutors where id=(p_input->>'tutor_id')::uuid;
   if teacher.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   if teacher.account_id=actor then perform app_private.require_role(actor,'tutor');else perform app_private.require_role(actor,'admin');end if;
  else perform app_private.require_role(actor,'admin');end if;
 elsif p_name in ('reserve_enrollment','join_waitlist') then perform app_private.assert_learner_scope(actor,(p_input->>'learner_id')::uuid,'booking');
 elsif p_name='accept_quote' then
  select * into quote from app_private.quotes where id=(p_input->>'quote_id')::uuid;select * into seat from app_private.enrollments where id=quote.enrollment_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking');
 elsif p_name='leave_waitlist' then select * into wait from app_private.waitlist_entries where id=(p_input->>'waitlist_entry_id')::uuid;if wait.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,wait.learner_id,'booking');
 else raise exception 'VALIDATION_ERROR';end if;
 if p_name='set_availability' then
  perform app_private.booking_validate_intervals(p_input->'weekly_intervals',p_input->'dated_exceptions');
  select coalesce(jsonb_agg(value order by(value->>'weekday')::int,value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(p_input->'weekly_intervals');
  p_input:=jsonb_set(p_input,'{weekly_intervals}',normalized);
  select coalesce(jsonb_agg(jsonb_build_object('local_date',value->>'local_date','intervals',(select coalesce(jsonb_agg(i order by i->>'start_local',i->>'end_local'),'[]') from jsonb_array_elements(value->'intervals') i)) order by value->>'local_date'),'[]') into normalized from jsonb_array_elements(p_input->'dated_exceptions');
  p_input:=jsonb_set(p_input,'{dated_exceptions}',normalized);
 end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_input?'reason' and (p_input->>'reason' is null or length(btrim(p_input->>'reason')) not between 1 and 2000) then raise exception 'VALIDATION_ERROR';end if;
 if p_name='set_availability' then
  perform app_private.booking_validate_intervals(p_input->'weekly_intervals',p_input->'dated_exceptions');perform 1 from app_private.tutors where id=teacher.id for update;
  select * into rules from app_private.availability_rules where tutor_id=teacher.id for update;if expected is distinct from coalesce(rules.version,0) then raise exception 'VERSION_CONFLICT';end if;
  if exists(select 1 from app_private.tutor_reservations r where r.tutor_id=teacher.id and r.active and r.end_at>now() and not app_private.booking_schedule_covered(p_input->'weekly_intervals',p_input->'dated_exceptions',r.start_at,r.end_at)) then
   raise exception 'SCHEDULE_CONFLICT' using detail=(select jsonb_build_object('conflicting_occurrence_ids',jsonb_agg(occurrence_id order by start_at,occurrence_id))::text from(select occurrence_id,start_at from app_private.tutor_reservations r where r.tutor_id=teacher.id and r.active and r.end_at>now() and not app_private.booking_schedule_covered(p_input->'weekly_intervals',p_input->'dated_exceptions',r.start_at,r.end_at) order by start_at,occurrence_id limit 100) conflicts);
  end if;
  select coalesce(jsonb_agg(value order by(value->>'weekday')::int,value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(p_input->'weekly_intervals');
  insert into app_private.availability_rules(tutor_id,weekly_intervals) values(teacher.id,normalized) on conflict(tutor_id) do update set weekly_intervals=excluded.weekly_intervals,version=app_private.availability_rules.version+1,updated_at=now() returning * into rules;
  delete from app_private.availability_exceptions where tutor_id=teacher.id;
  for item in select value from jsonb_array_elements(p_input->'dated_exceptions') loop
   select coalesce(jsonb_agg(value order by value->>'start_local',value->>'end_local'),'[]') into normalized from jsonb_array_elements(item->'intervals');insert into app_private.availability_exceptions(tutor_id,local_date,intervals) values(teacher.id,(item->>'local_date')::date,normalized);
  end loop;
  resource:=teacher.id;version:=rules.version;result:=jsonb_build_object('conflicting_occurrence_ids','[]'::jsonb);
 elsif p_name='create_occurrence' then
  select * into offer from app_private.offers where id=(p_input->>'offer_id')::uuid;
  if not app_private.booking_offer_sellable(offer.id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  policy:=app_private.policy_content(offer.policy_version_id);
  perform app_private.assert_catalog_publication(app_private.catalog_environment(),(select environment_scope from app_private.policy_versions where id=offer.policy_version_id),(select is_synthetic from app_private.policy_versions where id=offer.policy_version_id));
  select * into teacher from app_private.tutors where id=(p_input->>'tutor_id')::uuid for update;
  if teacher.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.require_role(teacher.account_id,'tutor');
  if not exists(select 1 from app_private.tutor_profile_versions p where p.id=teacher.approved_profile_version_id and p.state='approved' and offer.subject_id=any(p.subject_ids)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  start_at:=(p_input->>'start_at')::timestamptz;end_at:=(p_input->>'end_at')::timestamptz;perform app_private.booking_validate_times(start_at,end_at);
  if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or start_at<=now() or end_at-start_at<>make_interval(mins=>offer.duration_minutes) or p_input->>'time_zone' is distinct from 'Africa/Cairo' or (p_input->>'target_tier')::int is distinct from offer.target_tier then raise exception 'INVALID_TIME';end if;
  available_version:=app_private.booking_assert_schedule(teacher.id,start_at,end_at);
  if start_at-make_interval(mins=>least((policy->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
  insert into app_private.occurrences(offer_id,tutor_id,format,target_tier,capacity,duration_minutes,start_at,end_at,time_zone,policy_version_id,pricing_version_id,availability_version,confirmation_deadline_at) values(offer.id,teacher.id,offer.format,offer.target_tier,offer.capacity,offer.duration_minutes,start_at,end_at,'Africa/Cairo',offer.policy_version_id,offer.pricing_version_id,available_version,start_at-make_interval(mins=>least((policy->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)) returning * into occ;
  insert into app_private.tutor_assignments(occurrence_id,tutor_id) values(occ.id,teacher.id);insert into app_private.tutor_reservations(occurrence_id,tutor_id,start_at,end_at) values(occ.id,teacher.id,start_at,end_at);
  perform app_private.booking_enqueue_due(occ.id,occ.confirmation_deadline_at);resource:=occ.id;version:=1;result:=jsonb_build_object('occurrence_id',occ.id,'state',occ.state);perform set_config('response.status','201',true);
 else
  target:=case when p_name='accept_quote' then seat.occurrence_id when p_name='leave_waitlist' then wait.occurrence_id else(p_input->>'occurrence_id')::uuid end;
  if p_name='confirm_occurrence' then perform app_private.booking_lock_financial_scope(app_private.booking_financial_scope(array(select id from app_private.enrollments where occurrence_id=target)));end if;
  occ:=app_private.booking_lock_occurrence(target);perform app_private.booking_expire_holds(occ.id);perform app_private.booking_expire_proposals(occ.id);
  if p_name not in ('reserve_enrollment','join_waitlist','accept_quote','leave_waitlist') and expected is distinct from occ.version then raise exception 'VERSION_CONFLICT';end if;
  resource:=occ.id;version:=occ.version;
  if p_name in ('reserve_enrollment','join_waitlist') and not app_private.booking_offer_sellable(occ.offer_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if p_name in ('reserve_enrollment','join_waitlist','confirm_occurrence','approve_tutor_fee') then perform app_private.require_role((select account_id from app_private.tutors where id=occ.tutor_id),'tutor');end if;
  if p_name='reserve_enrollment' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   select count(*),count(*) filter(where hold_kind='ordinary') into count_seats,count_ordinary from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');
   if count_seats>=occ.capacity or count_ordinary>=coalesce(occ.target_tier,1) or exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=occ.id and app_private.booking_waitlist_eligible(w.id)) then raise exception 'CAPACITY_CONFLICT';end if;
   seat:=app_private.booking_new_hold(occ.id,(p_input->>'learner_id')::uuid,actor);select * into quote from app_private.quotes where id=seat.current_quote_id;
   resource:=seat.id;version:=seat.version;result:=jsonb_build_object('enrollment_id',seat.id,'hold_expires_at',seat.hold_expires_at,'quote_id',quote.id,'customer_price_minor',quote.customer_price_minor,'currency',quote.currency);perform set_config('response.status','201',true);
  elsif p_name='accept_quote' then
   select * into seat from app_private.enrollments where id=seat.id for update;
   if seat.hold_kind='amendment' then raise exception 'STATE_CONFLICT';end if;
   if expected is distinct from quote.version then raise exception 'VERSION_CONFLICT';end if;
   if seat.state<>'held' or seat.hold_expires_at<=now() or quote.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if seat.current_quote_id<>quote.id or quote.base_terms_version<>occ.quote_terms_version or p_input->>'quote_hash' is distinct from quote.terms_hash then raise exception 'VERSION_CONFLICT';end if;
   insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash) values(quote.id,actor,seat.learner_id,quote.terms_hash) on conflict(quote_id,actor_account_id) do nothing;
   select accepted_at into accepted from app_private.quote_acceptances where quote_id=quote.id and actor_account_id=actor;
   perform finance_private.finance_ensure_enrollment_charge(seat.id,quote.id,(select id from app_private.quote_acceptances where quote_id=quote.id and actor_account_id=actor),context);
   update app_private.waitlist_entries set state='accepted',version=app_private.waitlist_entries.version+1,updated_at=now() where offered_enrollment_id=seat.id and state='offered';resource:=quote.id;version:=quote.version;result:=jsonb_build_object('accepted_at',accepted);
  elsif p_name='change_occurrence_capacity' then
   policy:=app_private.policy_content(occ.policy_version_id);
   if occ.state not in ('forming','confirmed') or (p_input->>'capacity')::int is null or(occ.format='private' and(p_input->>'capacity')::int<>1) or(occ.format='group' and((p_input->>'capacity')::int<occ.target_tier or(p_input->>'capacity')::numeric>(policy->>'group_capacity')::numeric)) then raise exception 'CAPACITY_CONFLICT';end if;
   select count(*) into count_seats from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed');if(p_input->>'capacity')::int<count_seats then raise exception 'CAPACITY_CONFLICT';end if;
   update app_private.occurrences set capacity=(p_input->>'capacity')::int,version=occ.version+1,updated_at=now() where id=occ.id returning * into occ;version:=occ.version;result:=jsonb_build_object('capacity',occ.capacity);
  elsif p_name='join_waitlist' then
   if occ.state<>'forming' or occ.confirmation_deadline_at<=now() then raise exception 'WINDOW_CLOSED';end if;
   if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=(p_input->>'learner_id')::uuid and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   insert into app_private.waitlist_entries(occurrence_id,learner_id,requested_by) values(occ.id,(p_input->>'learner_id')::uuid,actor) returning * into wait;
   resource:=wait.id;version:=wait.version;result:=jsonb_build_object('waitlist_entry_id',wait.id,'state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());perform set_config('response.status','201',true);
  elsif p_name='leave_waitlist' then
   select * into wait from app_private.waitlist_entries where id=wait.id for update;if expected is distinct from wait.version then raise exception 'VERSION_CONFLICT';end if;
   if wait.state not in ('waiting','offered') then raise exception 'VERSION_CONFLICT';end if;
   if wait.offered_enrollment_id is not null then update app_private.enrollments set state='expired',version=app_private.enrollments.version+1,updated_at=now() where id=wait.offered_enrollment_id and state='held';end if;
   update app_private.waitlist_entries set state='cancelled',version=wait.version+1,updated_at=now() where id=wait.id returning * into wait;resource:=wait.id;version:=wait.version;result:=jsonb_build_object('state',wait.state);perform app_private.booking_enqueue_due(occ.id,now());
  elsif p_name='approve_tutor_fee' then
   if (occ.format='private' and p_input->>'target_tier' is not null) or(occ.format='group' and(p_input->>'target_tier' is null or(p_input->>'target_tier')::int not in(2,3,4))) or not exists(select 1 from app_private.pricing_versions p where p.id=(p_input->>'compensation_policy_version_id')::uuid and p.scope=occ.format) then raise exception 'VALIDATION_ERROR';end if;
   if occ.state not in ('forming','confirmed') or(p_input->>'tutor_id')::uuid is distinct from occ.tutor_id or(p_input->>'duration_minutes')::int is distinct from occ.duration_minutes or p_input->>'purpose' is null or p_input->>'purpose' not in ('initial','amendment') then raise exception 'VALIDATION_ERROR';end if;
   if p_input->>'purpose'='initial' and(occ.state<>'forming' or occ.current_fee_agreement_id is not null or(p_input->>'target_tier')::int is distinct from occ.target_tier or(p_input->>'compensation_policy_version_id')::uuid<>occ.pricing_version_id) then raise exception 'STATE_CONFLICT';end if;
   if occ.format='group' and(p_input->>'target_tier')::int>occ.capacity then raise exception 'CAPACITY_CONFLICT';end if;
   perform app_private.assert_exact_tutor_fee((p_input->>'compensation_policy_version_id')::uuid,(p_input->>'target_tier')::int,(p_input->>'fee_minor')::bigint,p_input->>'currency',(p_input->>'duration_minutes')::int);
   insert into finance_private.tutor_fee_agreements(occurrence_id,tutor_id,pricing_version_id,target_tier,purpose,fee_minor,currency,duration_minutes,base_occurrence_version,approved_by) values(occ.id,occ.tutor_id,(p_input->>'compensation_policy_version_id')::uuid,(p_input->>'target_tier')::int,p_input->>'purpose',(p_input->>'fee_minor')::bigint,p_input->>'currency',occ.duration_minutes,occ.version,actor) returning id into fee_id;
   if p_input->>'purpose'='initial' then update app_private.occurrences set current_fee_agreement_id=fee_id,version=occ.version+1,updated_at=now() where id=occ.id returning * into occ;end if;version:=occ.version;result:=jsonb_build_object('fee_agreement_id',fee_id);perform set_config('response.status','201',true);
  elsif p_name='confirm_occurrence' then
   result:=app_private.booking_try_confirm_locked(occ.id,context);
   if result->>'state' not in('confirmed','already_confirmed') then
    if result->>'reason'='TARGET_NOT_MET' then raise exception 'CAPACITY_CONFLICT';elsif result->>'reason'='FEE_NOT_APPROVED' then raise exception 'POLICY_INCOMPLETE';elsif result->>'reason'='QUOTE_NOT_ACCEPTED' then raise exception 'CONSENT_REQUIRED';else raise exception '%',result->>'reason';end if;
   end if;
   select * into occ from app_private.occurrences where id=occ.id;version:=occ.version;
   result:=jsonb_build_object('state',occ.state,'confirmed_enrollment_ids',(select coalesce(jsonb_agg(id order by id),'[]') from app_private.enrollments where occurrence_id=occ.id and state='confirmed'),'meeting_status',occ.meeting_status);
  end if;
 end if;
 event_name:='booking_'||p_name;return app_private.booking_finish(context,resource,version,result,event_name,jsonb_build_object('resource_id',resource));
exception when exclusion_violation then raise exception 'SCHEDULE_CONFLICT';when unique_violation then raise exception 'STATE_CONFLICT';when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'VALIDATION_ERROR';end $$;
do $$ declare t record;f record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where(n.nspname='finance_private' and c.relname in('package_funding_sources','package_value_allocations','package_value_reversals','package_coverage_postings','package_coverage_releases')) or(n.nspname='app_private' and c.relname in('booking_financial_resolutions','booking_commitments','package_financing_holds')) loop
  execute format('alter table %I.%I enable row level security',t.nspname,t.relname);execute format('create policy commands_access on %I.%I to git_tutor_commands using(true) with check(true)',t.nspname,t.relname);execute format('grant select,insert on %I.%I to git_tutor_commands',t.nspname,t.relname);execute format('revoke all on %I.%I from public,anon,authenticated,service_role,git_tutor_worker',t.nspname,t.relname);
  if t.relname in('booking_financial_resolutions','package_financing_holds') then execute format('grant update on %I.%I to git_tutor_commands',t.nspname,t.relname);else execute format('create trigger immutable_%I before update or delete on %I.%I for each row execute function app_private.reject_immutable_change()',t.relname,t.nspname,t.relname);end if;
 end loop;
 for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_package_applied_value','finance_apply_package_coverage','finance_release_package_coverage','finance_funding_status')) or(n.nspname='app_private' and p.proname in('booking_funding_status','booking_deposit','booking_try_confirm_locked','package_release_for_hold_end')) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;
end $$;
revoke create on schema app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';

grant create on schema app_private to git_tutor_commands;
create function app_private.booking_charge_end_resolution() returns trigger language plpgsql security definer set search_path='' as $$
declare learner uuid;item record;context_id uuid:=gen_random_uuid();decision uuid;begin
 for learner in select distinct n.learner_id from financial_new n join financial_old o on o.id=n.id where o.state in('held','confirmed') and n.state in('expired','cancelled') order by n.learner_id loop perform app_private.package_lock_learner(learner);end loop;
 for item in select n.id,n.state,c.id charge_id,coalesce(q.policy_version_id,c.accepted_contract_version_id) policy_version_id from financial_new n join financial_old o on o.id=n.id join finance_private.charges c on c.enrollment_id=n.id left join finance_private.charge_acceptance_sources s on s.charge_id=c.id left join finance_private.charge_accounts a on a.charge_id=c.id left join app_private.quotes q on q.id=case when a.conditional_amendment_id is null then n.current_quote_id else s.quote_id end where o.state in('held','confirmed') and n.state in('expired','cancelled') order by n.learner_id,n.id loop
  update finance_private.charge_accounts set commitment_state='resolution_required',version=version+1,updated_at=now() where charge_id=item.charge_id and commitment_state<>'resolution_required';
  insert into app_private.booking_financial_resolutions(enrollment_id,charge_id,policy_version_id,reason,command_id) values(item.id,item.charge_id,item.policy_version_id,case when item.state='expired' then 'hold_expired' else 'booking_cancelled' end,context_id) returning id into decision;
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,context_id,'booking_financial_resolution_required',item.id,jsonb_build_object('decision_id',decision,'charge_id',item.charge_id,'actor_kind','system'));
  perform app_private.enqueue_event(gen_random_uuid(),'booking_financial_resolution_required',item.id,jsonb_build_object('decision_id',decision,'enrollment_id',item.id,'charge_id',item.charge_id),'notifications.route');
 end loop;return null;
end $$;
create trigger booking_charge_end_resolution after update on app_private.enrollments referencing old table as financial_old new table as financial_new for each statement execute function app_private.booking_charge_end_resolution();
alter function app_private.booking_charge_end_resolution() owner to git_tutor_commands;
revoke all on function app_private.booking_charge_end_resolution() from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
