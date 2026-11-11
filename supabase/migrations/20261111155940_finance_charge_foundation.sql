-- T06 shared charge foundation. No settlement, funding qualification or refund success is introduced by this stage.
grant create on schema api,app_private,finance_private to git_tutor_commands;

create table finance_private.charge_accounts(
 charge_id uuid primary key references finance_private.charges(id),
 version integer not null default 1 check(version>0),
 commitment_state text not null default 'ordinary' check(commitment_state in('ordinary','awaiting_amendment','committed','resolution_required')),
 conditional_amendment_id uuid references app_private.group_amendments(id),
 updated_at timestamptz not null default now()
);
insert into finance_private.charge_accounts(charge_id) select id from finance_private.charges;
create table finance_private.charge_acceptance_sources(
 charge_id uuid primary key references finance_private.charges(id),
 source_kind text not null check(source_kind in('quote','amendment','package_purchase')),
 quote_id uuid references app_private.quotes(id),
 quote_acceptance_id uuid references app_private.quote_acceptances(id),
 proposal_id uuid references app_private.operation_proposals(id),
 proposal_acceptance_id uuid references app_private.operation_proposal_acceptances(id),
 package_purchase_acceptance_id uuid references app_private.package_purchase_acceptances(id),
 accepted_actor_account_id uuid not null references app_private.accounts(id),
 accepted_at timestamptz not null,
 accepted_terms_hash text not null check(accepted_terms_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 check((source_kind='quote' and quote_id is not null and quote_acceptance_id is not null and proposal_id is null and proposal_acceptance_id is null and package_purchase_acceptance_id is null)
 or(source_kind='amendment' and quote_id is not null and quote_acceptance_id is null and proposal_id is not null and proposal_acceptance_id is not null and package_purchase_acceptance_id is null)
 or(source_kind='package_purchase' and quote_id is null and quote_acceptance_id is null and proposal_id is null and proposal_acceptance_id is null and package_purchase_acceptance_id is not null))
);
insert into finance_private.charge_acceptance_sources(charge_id,source_kind,package_purchase_acceptance_id,accepted_actor_account_id,accepted_at,accepted_terms_hash)
 select c.id,'package_purchase',a.id,a.actor_account_id,a.accepted_at,a.contract_hash from finance_private.charges c join app_private.package_purchase_acceptances a on a.purchase_id=c.package_purchase_id;
create table finance_private.charge_adjustments(
 id uuid primary key default gen_random_uuid(),charge_id uuid not null references finance_private.charges(id),
 signed_minor bigint not null check(signed_minor between -9007199254740991 and 9007199254740991 and signed_minor<>0),
 kind text not null check(kind in('commercial','named_coverage','partial_named_coverage','linked_inverse')),
 domain_source_type text not null,domain_source_id uuid not null,original_adjustment_id uuid references finance_private.charge_adjustments(id),reason text not null check(length(btrim(reason)) between 1 and 2000),
 actor_account_id uuid references app_private.accounts(id),command_id uuid not null,source_line_key text not null,
 effective_at timestamptz not null,recorded_at timestamptz not null default now(),unique(command_id,source_line_key)
);
create index charge_adjustments_source on finance_private.charge_adjustments(charge_id,recorded_at,id);
create trigger immutable_charge_acceptance_sources before update or delete on finance_private.charge_acceptance_sources for each row execute function app_private.reject_immutable_change();
create trigger immutable_charge_adjustments before update or delete on finance_private.charge_adjustments for each row execute function app_private.reject_immutable_change();

alter table finance_private.ledger_lines drop constraint ledger_lines_account_code_check;
alter table finance_private.ledger_lines add constraint ledger_lines_account_code_check check(account_code in('receivable','deferred_package_obligation','promotional_subsidy_expense','tuition_revenue','channel_cash','unapplied_customer_funds','deferred_tuition'));
alter table finance_private.ledger_lines
 add charge_id uuid references finance_private.charges(id),add enrollment_id uuid references app_private.enrollments(id),
 add transfer_id uuid,add allocation_id uuid,add credit_lot_id uuid,add refund_id uuid,add attempt_id uuid,add receiving_account_id uuid,add remedy_reservation_id uuid references app_private.remedy_reservations(id),add reversal_id uuid;
create index ledger_lines_charge on finance_private.ledger_lines(charge_id,transaction_id) where charge_id is not null;
create index ledger_lines_transfer on finance_private.ledger_lines(transfer_id,transaction_id) where transfer_id is not null;

create or replace function finance_private.finance_post_balanced(p_source_posting_key text,p_source_type text,p_source_id uuid,p_currency text,p_effective_at timestamptz,p_lines jsonb,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid:=gen_random_uuid();saved finance_private.ledger_transactions%rowtype;digest text;line jsonb;total numeric:=0;n bigint;begin
 if p_currency is distinct from 'EGP' or p_source_posting_key is null or length(p_source_posting_key) not between 1 and 200 or p_effective_at is null or not isfinite(p_effective_at) or p_effective_at<timestamptz '0001-01-01 00:00:00+00' or p_effective_at>=timestamptz '10000-01-01 00:00:00+00' or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>100 then raise exception 'VALIDATION_ERROR';end if;
 digest:=app_private.catalog_hash(jsonb_build_object('source_type',p_source_type,'source_id',p_source_id,'currency',p_currency,'effective_at',p_effective_at,'lines',p_lines));perform pg_advisory_xact_lock(hashtextextended('finance-post:'||p_source_posting_key,0));
 select * into saved from finance_private.ledger_transactions where source_posting_key=p_source_posting_key;if saved.id is not null then if saved.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT';end if;return saved.id;end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(line) is distinct from 'object' or(line-array['account_code','learner_id','package_purchase_id','lot_id','signed_minor','charge_id','enrollment_id','transfer_id','allocation_id','credit_lot_id','refund_id','attempt_id','receiving_account_id','remedy_reservation_id','reversal_id'])<>'{}' then raise exception 'VALIDATION_ERROR';end if;
  n:=app_private.package_safe_integer(line->'signed_minor',-9007199254740991);total:=total+n;
 end loop;if total<>0 then raise exception 'UNBALANCED_JOURNAL';end if;
 insert into finance_private.ledger_transactions(id,source_posting_key,source_type,source_id,request_hash,actor_account_id,command_id,currency,effective_at) values(id,p_source_posting_key,p_source_type,p_source_id,digest,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,p_currency,p_effective_at);
 for line in select value from jsonb_array_elements(p_lines) loop
  insert into finance_private.ledger_lines(transaction_id,account_code,learner_id,package_purchase_id,lot_id,signed_minor,currency,charge_id,enrollment_id,transfer_id,allocation_id,credit_lot_id,refund_id,attempt_id,receiving_account_id,remedy_reservation_id,reversal_id)
  values(id,line->>'account_code',(line->>'learner_id')::uuid,(line->>'package_purchase_id')::uuid,(line->>'lot_id')::uuid,(line->>'signed_minor')::bigint,p_currency,(line->>'charge_id')::uuid,(line->>'enrollment_id')::uuid,(line->>'transfer_id')::uuid,(line->>'allocation_id')::uuid,(line->>'credit_lot_id')::uuid,(line->>'refund_id')::uuid,(line->>'attempt_id')::uuid,(line->>'receiving_account_id')::uuid,(line->>'remedy_reservation_id')::uuid,(line->>'reversal_id')::uuid);
 end loop;return id;
end $$;

create or replace function finance_private.finance_issue_charge(p_charge_type text,p_learner_id uuid,p_responsible_account_id uuid,p_package_purchase_id uuid,p_enrollment_id uuid,p_contract_version_id uuid,p_accepted_terms_hash text,p_amount_minor bigint,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid:=gen_random_uuid();lines jsonb:='[]';saved finance_private.charges%rowtype;begin
 if p_charge_type is null or p_charge_type not in('enrollment','package_purchase') or p_amount_minor is null or p_amount_minor not between 0 and 9007199254740991 or p_accepted_terms_hash is null or p_accepted_terms_hash!~'^[a-f0-9]{64}$' then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('charge-source:'||p_charge_type||':'||coalesce(p_package_purchase_id,p_enrollment_id)::text,0));
 select * into saved from finance_private.charges where(charge_type='enrollment' and enrollment_id=p_enrollment_id) or(charge_type='package_purchase' and package_purchase_id=p_package_purchase_id);
 if saved.id is not null then
  if saved.charge_type<>p_charge_type or saved.learner_id<>p_learner_id or saved.responsible_account_id<>p_responsible_account_id or saved.accepted_contract_version_id<>p_contract_version_id or saved.accepted_terms_hash<>p_accepted_terms_hash or saved.amount_minor<>p_amount_minor then raise exception 'STATE_CONFLICT';end if;
  return saved.id;
 end if;
 insert into finance_private.charges(id,charge_type,learner_id,responsible_account_id,package_purchase_id,enrollment_id,accepted_contract_version_id,accepted_terms_hash,amount_minor,currency) values(id,p_charge_type,p_learner_id,p_responsible_account_id,p_package_purchase_id,p_enrollment_id,p_contract_version_id,p_accepted_terms_hash,p_amount_minor,'EGP');
 insert into finance_private.charge_accounts(charge_id) values(id);
 if p_amount_minor<>0 then lines:=jsonb_build_array(
  jsonb_build_object('account_code','receivable','learner_id',p_learner_id,'package_purchase_id',p_package_purchase_id,'charge_id',id,'enrollment_id',p_enrollment_id,'signed_minor',p_amount_minor),
  jsonb_build_object('account_code',case when p_charge_type='package_purchase' then 'deferred_package_obligation' else 'deferred_tuition' end,'learner_id',p_learner_id,'package_purchase_id',p_package_purchase_id,'charge_id',id,'enrollment_id',p_enrollment_id,'signed_minor',-p_amount_minor));end if;
 perform finance_private.finance_post_balanced('charge:'||id,'charge_issued',id,'EGP',now(),lines,p_context);return id;
end $$;

create function finance_private.finance_capture_package_acceptance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into finance_private.charge_acceptance_sources(charge_id,source_kind,package_purchase_acceptance_id,accepted_actor_account_id,accepted_at,accepted_terms_hash)
 select c.id,'package_purchase',new.id,new.actor_account_id,new.accepted_at,new.contract_hash from finance_private.charges c where c.package_purchase_id=new.purchase_id;
 return new;
end $$;
create trigger capture_financial_package_acceptance after insert on app_private.package_purchase_acceptances for each row execute function finance_private.finance_capture_package_acceptance();

-- Replaced by the package integration migration; no package-value posting exists until that path is installed.
create function finance_private.finance_package_applied_value(p_charge_id uuid) returns bigint language sql stable security definer set search_path='' as $$ select 0::bigint $$;
create function finance_private.finance_charge_balance(p_charge_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;adjustments numeric;cash numeric;package_value numeric;net numeric;balance numeric;begin
 select * into c from finance_private.charges where id=p_charge_id;if c.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from finance_private.charge_accounts where charge_id=c.id;
 select coalesce(sum(signed_minor),0) into adjustments from finance_private.charge_adjustments where charge_id=c.id;
 select -coalesce(sum(l.signed_minor),0) into cash from finance_private.ledger_lines l join finance_private.ledger_transactions t on t.id=l.transaction_id where l.charge_id=c.id and l.account_code='receivable' and t.source_type in('payment_allocation','allocation_reversal');
 package_value:=finance_private.finance_package_applied_value(c.id);net:=c.amount_minor+adjustments;balance:=net-cash-package_value;
 if greatest(abs(adjustments),abs(cash),abs(package_value),abs(net),abs(balance))>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 -- Refund/source reconciliation projections are extended with their actual source rows before refund commands are enabled.
 return jsonb_build_object('charge_id',c.id,'version',a.version,'currency',c.currency,'original_minor',c.amount_minor,'adjustments_minor',adjustments,'commercial_net_minor',net,'allocated_cash_minor',cash,'allocated_package_value_minor',package_value,'receivable_minor',balance,'refund_reserved_minor',0,'refunded_minor',0,'credit_released_minor',0,'reconciliation_state','clear','recovery_exposure_minor',0);
end $$;
create function app_private.payment_charge_dto(p_charge_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;b jsonb;label text;name text;q uuid;begin
 select * into c from finance_private.charges where id=p_charge_id;if c.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from finance_private.charge_accounts where charge_id=c.id;b:=finance_private.finance_charge_balance(c.id);
 select p.display_name into name from app_private.learners l join app_private.people p on p.id=l.person_id where l.id=c.learner_id;
 if c.enrollment_id is not null then select s.title,e.current_quote_id into label,q from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id join app_private.offers f on f.id=o.offer_id join app_private.subjects s on s.id=f.subject_id where e.id=c.enrollment_id;
 else select s.title||' package' into label from app_private.offers o join app_private.subjects s on s.id=o.subject_id where o.policy_version_id=c.accepted_contract_version_id order by o.created_at,o.id limit 1;end if;
 return (b-array['commercial_net_minor','receivable_minor'])||jsonb_build_object('net_minor',b->'commercial_net_minor','balance_minor',b->'receivable_minor','charge_type',c.charge_type,'title',coalesce(label,'Learning charge'),'learner',jsonb_build_object('learner_id',c.learner_id,'display_name',coalesce(name,'Learner')),'enrollment_id',c.enrollment_id,'package_purchase_id',c.package_purchase_id,'commitment_state',a.commitment_state,'conditional_amendment_id',a.conditional_amendment_id,'funding_quote_id',q);
end $$;
create function api.get_my_charge(p_charge_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();learner uuid;begin
 select learner_id into learner from finance_private.charges where id=p_charge_id;if learner is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform app_private.package_assert_scope(actor,learner,'payments',true);return app_private.payment_charge_dto(p_charge_id);
end $$;

do $$ declare t text;f record;begin
 foreach t in array array['charge_accounts','charge_acceptance_sources','charge_adjustments'] loop
  execute format('alter table finance_private.%I enable row level security',t);
  execute format('create policy commands_access on finance_private.%I to git_tutor_commands using(true) with check(true)',t);
  execute format('grant select,insert on finance_private.%I to git_tutor_commands',t);
  execute format('revoke all on finance_private.%I from public,anon,authenticated,service_role,git_tutor_worker',t);
 end loop;
 grant update on finance_private.charge_accounts to git_tutor_commands;
 for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_post_balanced','finance_issue_charge','finance_capture_package_acceptance','finance_package_applied_value','finance_charge_balance')) or(n.nspname='app_private' and p.proname='payment_charge_dto') or(n.nspname='api' and p.proname='get_my_charge') loop
  execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
