grant create on schema finance_private,app_private to git_tutor_commands;
create table finance_private.amendment_funding_reservations(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.operation_proposals(id),enrollment_id uuid not null references app_private.enrollments(id),charge_id uuid not null references finance_private.charges(id),transfer_id uuid not null references finance_private.incoming_transfers(id),payer_binding_id uuid not null references finance_private.transfer_payer_bindings(id),amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),qualified_proof jsonb not null,source_credit_reservation_ids uuid[] not null,
 state text not null default 'reserved' check(state in('reserved','consumed','released')),expires_at timestamptz not null check(isfinite(expires_at)),version integer not null default 1 check(version>0),command_id uuid not null,source_line_key text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(command_id,source_line_key));
create index amendment_funding_by_proposal on finance_private.amendment_funding_reservations(proposal_id,enrollment_id,state);
create index amendment_funding_by_transfer on finance_private.amendment_funding_reservations(transfer_id,state);
alter table finance_private.amendment_funding_reservations enable row level security;
grant select,insert,update on finance_private.amendment_funding_reservations to git_tutor_commands;
create policy commands_access on finance_private.amendment_funding_reservations to git_tutor_commands using(true) with check(true);
revoke all on finance_private.amendment_funding_reservations from public,anon,authenticated,service_role,git_tutor_worker;
create function finance_private.amendment_funding_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if to_jsonb(new)-array['state','version','updated_at'] is distinct from to_jsonb(old)-array['state','version','updated_at'] or old.state<>'reserved' or new.state not in('consumed','released') or new.version<>old.version+1 then raise exception 'IMMUTABLE_RECORD';end if;return new;
end $$;
create trigger amendment_funding_immutable before update on finance_private.amendment_funding_reservations for each row execute function finance_private.amendment_funding_immutable();
create function finance_private.finance_amendment_funding_balance(p_proposal_id uuid,p_enrollment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r finance_private.amendment_funding_reservations%rowtype;t finance_private.incoming_transfers%rowtype;total numeric:=0;ids uuid[]:='{}';reconciliation text:='clear';begin
 for r in select * from finance_private.amendment_funding_reservations where proposal_id=p_proposal_id and enrollment_id=p_enrollment_id and state='reserved' and expires_at>now() order by id loop
  select * into t from finance_private.incoming_transfers where id=r.transfer_id;
  if t.state<>'settled' or t.current_payer_binding_id is distinct from r.payer_binding_id or finance_private.finance_transfer_balance(t.id)->>'reconciliation_state'<>'clear' or (select coalesce(sum(amount_minor),0) from finance_private.credit_reservations where id=any(r.source_credit_reservation_ids) and state='reserved' and(expires_at is null or expires_at>now()))<>r.amount_minor then reconciliation:='requires_review';continue;end if;
  total:=total+r.amount_minor;ids:=array_append(ids,r.id);
 end loop;
 if total>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 return jsonb_build_object('reserved_minor',total::bigint,'reservation_ids',ids,'reconciliation_state',reconciliation);
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('finance_amendment_funding_balance','amendment_funding_immutable') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema finance_private,app_private from git_tutor_commands;
grant create on schema app_private to git_tutor_commands;
create function app_private.booking_amendment_financial_basis(p_amendment_id uuid,p_enrollment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;t app_private.operation_customer_terms%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;oldq app_private.quotes%rowtype;c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;r app_private.package_reservations%rowtype;acceptance app_private.operation_proposal_acceptances%rowtype;b jsonb;future jsonb;policy jsonb;net bigint;current_net bigint;cash bigint:=0;package_value bigint:=0;reserved bigint:=0;required bigint;additional bigint;reason text:='ELIGIBLE';reconciliation text:='clear';begin
 select * into p from app_private.operation_proposals where id=p_amendment_id;select * into g from app_private.group_amendments where id=p.id;select * into e from app_private.enrollments where id=p_enrollment_id;select * into t from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=e.id;
 if g.id is null or t.id is null then raise exception 'NOT_FOUND';end if;
 select * into q from app_private.quotes where id=t.proposed_quote_id;select * into oldq from app_private.quotes where id=t.source_quote_id;select * into c from finance_private.charges where enrollment_id=e.id;select * into a from finance_private.charge_accounts where charge_id=c.id;
 select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=e.learner_id and terms_hash=t.terms_hash;
 select * into r from app_private.package_reservations where enrollment_id=e.id and state in('reserved','partially_consumed','consumed') order by created_at desc limit 1;
 policy:=app_private.policy_content(q.policy_version_id);
 if c.id is null then current_net:=0;net:=q.customer_price_minor;reason:='QUOTE_NOT_ACCEPTED';else
  b:=finance_private.finance_charge_balance(c.id);current_net:=(b->>'commercial_net_minor')::bigint;cash:=(b->>'allocated_cash_minor')::bigint;package_value:=(b->>'allocated_package_value_minor')::bigint;reconciliation:=b->>'reconciliation_state';
  if r.id is not null and r.coverage_rule='named_entitlement_covers_eligible_occurrence' then net:=r.agreed_top_up_minor;
  elsif a.conditional_amendment_id=p.id then net:=current_net;
  else net:=current_net+q.customer_price_minor-oldq.customer_price_minor;end if;
 end if;
 if net is null or net<0 or net>9007199254740991 or package_value>net then raise exception 'POLICY_INCOMPLETE';end if;
 future:=finance_private.finance_amendment_funding_balance(p.id,e.id);reserved:=(future->>'reserved_minor')::bigint;
 if future->>'reconciliation_state'<>'clear' then reconciliation:='requires_review';end if;
 required:=app_private.booking_deposit(net,policy);additional:=greatest(0,required-least(cash,greatest(0,net-package_value))-package_value-reserved);
 if not coalesce(app_private.booking_proposal_fresh(p.id),false) or e.id=any(g.remove_enrollment_ids) then reason:='QUOTE_NOT_ACCEPTED';
 elsif e.state in('expired','cancelled') or(e.state='held' and e.hold_expires_at<=now()) then reason:='HOLD_EXPIRED';
 elsif acceptance.id is null or not t.financial_terms_ready or not app_private.booking_can_access(acceptance.actor_account_id,e.learner_id) or not coalesce(app_private.payment_verified_account(acceptance.actor_account_id),false) then reason:='QUOTE_NOT_ACCEPTED';
 elsif reconciliation<>'clear' or a.commitment_state='resolution_required' then reason:='RECONCILIATION_REQUIRED';
 elsif exists(select 1 from app_private.package_reservation_allocations x join app_private.package_lots l on l.id=x.lot_id where x.reservation_id=r.id and app_private.package_original_is_held(l.original_lot_id)) then reason:='FINANCING_HOLD';
 elsif r.id is not null and r.coverage_rule='named_entitlement_covers_eligible_occurrence' and not(policy->'confirmation_funding_sources'?'reserved_named_package_entitlement') then reason:='POLICY_INCOMPLETE';
 elsif package_value>0 and not(policy->'confirmation_funding_sources'?'reserved_eligible_package_value') then reason:='POLICY_INCOMPLETE';
 elsif(cash>0 or reserved>0) and not(policy->'confirmation_funding_sources'?'verified_payment_allocation') then reason:='POLICY_INCOMPLETE';
 elsif additional>0 then reason:='INSUFFICIENT_FUNDS';end if;
 return jsonb_build_object('charge_id',c.id,'quote_id',q.id,'conditional_amendment_id',a.conditional_amendment_id,'current_net_minor',current_net,'proposed_net_minor',net,'positive_future_debit_minor',greatest(0,net-current_net),'posted_cash_minor',cash,'package_value_minor',package_value,'reserved_future_minor',reserved,'required_minor',required,'additional_required_minor',additional,'reserved_credit_quanta',case when r.id is null then 0 else r.reserved_credit_quanta end,'top_up_minor',case when r.id is null then net else r.agreed_top_up_minor end,'eligible',reason='ELIGIBLE','reason',reason,'reconciliation_state',reconciliation);
end $$;
create function app_private.booking_amendment_funding_status(p_amendment_id uuid,p_enrollment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb;begin
 b:=app_private.booking_amendment_financial_basis(p_amendment_id,p_enrollment_id);
 return jsonb_build_object('integration_state','ready','eligible',false,'financially_eligible',(b->>'eligible')::boolean,'reason',case when b->>'reason'='ELIGIBLE' then 'AMENDMENT_PENDING' else b->>'reason' end,'charge_id',b->'charge_id','net_charge_minor',b->'proposed_net_minor','allocated_minor',b->'posted_cash_minor','balance_minor',greatest(0,(b->>'proposed_net_minor')::bigint-(b->>'posted_cash_minor')::bigint-(b->>'package_value_minor')::bigint),'required_for_confirmation_minor',b->'required_minor','reserved_credit_quanta',b->'reserved_credit_quanta','allocated_package_value_minor',b->'package_value_minor','top_up_minor',b->'top_up_minor','additional_required_minor',b->'additional_required_minor','conditional_amendment_id',p_amendment_id,'funding_quote_id',b->'quote_id','reconciliation_state',b->'reconciliation_state');
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in('booking_amendment_financial_basis','booking_amendment_funding_status') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema app_private from git_tutor_commands;
