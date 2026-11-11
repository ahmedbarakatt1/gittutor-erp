grant create on schema api,app_private,finance_private to git_tutor_commands;
create table app_private.enrollment_transfer_reviews(
 proposal_id uuid primary key references app_private.operation_proposals(id),
 source_enrollment_id uuid not null references app_private.enrollments(id),destination_enrollment_id uuid not null unique references app_private.enrollments(id),
 source_quote_id uuid not null references app_private.quotes(id),destination_quote_id uuid not null references app_private.quotes(id),
 destination_occurrence_id uuid not null references app_private.occurrences(id),destination_occurrence_version integer not null,destination_terms_version integer not null,
 planned_carryover_minor bigint not null check(planned_carryover_minor between 0 and 9007199254740991),
 source_package_disposition jsonb,command_id uuid not null,created_at timestamptz not null default now()
);
create table finance_private.enrollment_transfer_fee_bindings(
 proposal_id uuid primary key references app_private.enrollment_transfer_reviews(proposal_id),
 source_fee_agreement_id uuid not null references finance_private.tutor_fee_agreements(id),
 destination_fee_agreement_id uuid not null references finance_private.tutor_fee_agreements(id)
);
create table finance_private.enrollment_transfer_carryovers(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.enrollment_transfer_reviews(proposal_id),
 allocation_id uuid not null references finance_private.payment_allocations(id),transfer_id uuid not null references finance_private.incoming_transfers(id),
 payer_binding_id uuid not null references finance_private.transfer_payer_bindings(id),amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 releasable_minor bigint not null check(releasable_minor>=amount_minor),
 state text not null default 'earmarked' check(state in('earmarked','consumed','released')),
 command_id uuid not null,created_at timestamptz not null default now(),unique(proposal_id,allocation_id)
);
create table app_private.enrollment_transfer_consents(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.enrollment_transfer_reviews(proposal_id),
 payer_account_id uuid not null references app_private.accounts(id),destination_charge_id uuid not null references finance_private.charges(id),
 terms_hash text not null,terms jsonb not null,expires_at timestamptz not null,
 state text not null default 'awaiting_acceptance' check(state in('awaiting_acceptance','accepted','declined','invalidated','consumed','expired')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(proposal_id,payer_account_id)
);
create table app_private.enrollment_transfer_consent_acceptances(
 id uuid primary key default gen_random_uuid(),consent_id uuid not null unique references app_private.enrollment_transfer_consents(id),
 actor_account_id uuid not null references app_private.accounts(id),terms_hash text not null,command_id uuid not null,accepted_at timestamptz not null default now()
);
create table app_private.enrollment_transfer_commits(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null unique references app_private.enrollment_transfer_reviews(proposal_id),
 source_enrollment_id uuid not null unique references app_private.enrollments(id),destination_enrollment_id uuid not null unique references app_private.enrollments(id),
 command_id uuid not null,created_at timestamptz not null default now()
);
alter table finance_private.charge_accounts add column conditional_transfer_proposal_id uuid references app_private.enrollment_transfer_reviews(proposal_id);
alter table finance_private.charge_accounts drop constraint charge_accounts_commitment_state_check;
alter table finance_private.charge_accounts add constraint charge_accounts_commitment_state_check check(commitment_state in('ordinary','awaiting_amendment','awaiting_transfer','committed','resolution_required'));
alter table finance_private.charge_accounts add constraint one_conditional_commitment check(conditional_amendment_id is null or conditional_transfer_proposal_id is null);
alter table finance_private.payment_allocations add column enrollment_transfer_consent_id uuid references app_private.enrollment_transfer_consents(id);
alter table app_private.payment_plan_targets add column conditional_transfer_proposal_id uuid references app_private.enrollment_transfer_reviews(proposal_id);
alter table app_private.payment_plan_targets add constraint one_conditional_plan_target check(conditional_amendment_id is null or conditional_transfer_proposal_id is null);

do $$declare t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where(n.nspname='app_private' and c.relname in('enrollment_transfer_reviews','enrollment_transfer_consents','enrollment_transfer_consent_acceptances','enrollment_transfer_commits'))
 or(n.nspname='finance_private' and c.relname in('enrollment_transfer_fee_bindings','enrollment_transfer_carryovers')) loop
  execute format('alter table %I.%I enable row level security',t.nspname,t.relname);
  execute format('create policy commands_access on %I.%I to git_tutor_commands using(true) with check(true)',t.nspname,t.relname);
  execute format('grant select,insert on %I.%I to git_tutor_commands',t.nspname,t.relname);
  execute format('revoke all on %I.%I from public,anon,authenticated,service_role,git_tutor_worker',t.nspname,t.relname);
  if t.relname in('enrollment_transfer_consents','enrollment_transfer_carryovers') then execute format('grant update on %I.%I to git_tutor_commands',t.nspname,t.relname);
  else execute format('create trigger immutable_transfer_source before update or delete on %I.%I for each row execute function app_private.reject_immutable_change()',t.nspname,t.relname);end if;
 end loop;
end $$;

create function app_private.enrollment_transfer_lifecycle_guard() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='DELETE' or (to_jsonb(new)-array['state','version','updated_at'])<>(to_jsonb(old)-array['state','version','updated_at']) then raise exception 'IMMUTABLE_RECORD';end if;return new;
end $$;
create trigger immutable_transfer_consent_terms before update or delete on app_private.enrollment_transfer_consents for each row execute function app_private.enrollment_transfer_lifecycle_guard();
create trigger immutable_transfer_carryover_terms before update or delete on finance_private.enrollment_transfer_carryovers for each row execute function app_private.enrollment_transfer_lifecycle_guard();

alter function app_private.booking_proposal_fresh(uuid) rename to booking_proposal_fresh_before_transfer;
create function app_private.booking_proposal_fresh(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.booking_proposal_fresh_before_transfer(p_id),false) and not exists(
 select 1 from app_private.enrollment_transfer_reviews r
 join app_private.enrollments e on e.id=r.destination_enrollment_id join app_private.quotes q on q.id=r.destination_quote_id
 join app_private.occurrences o on o.id=r.destination_occurrence_id join app_private.occurrences source on source.id=(select occurrence_id from app_private.enrollments where id=r.source_enrollment_id)
 join finance_private.enrollment_transfer_fee_bindings fees on fees.proposal_id=r.proposal_id
 where r.proposal_id=p_id and(e.state<>'held' or e.hold_expires_at<=now() or e.current_quote_id<>q.id or q.expires_at<=now() or o.state<>'forming' or o.version<>r.destination_occurrence_version or o.quote_terms_version<>r.destination_terms_version
 or o.current_fee_agreement_id is distinct from fees.destination_fee_agreement_id or source.current_fee_agreement_id is distinct from fees.source_fee_agreement_id or not app_private.booking_offer_sellable(o.offer_id)))
$$;
alter function app_private.booking_proposal_admin_hash(uuid) rename to booking_proposal_admin_hash_before_transfer;
create function app_private.booking_proposal_admin_hash(p_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from app_private.enrollment_transfer_reviews where proposal_id=p_id) then app_private.catalog_hash(jsonb_build_object('proposal',app_private.booking_proposal_admin_hash_before_transfer(p_id),'fee_bindings',(select to_jsonb(f) from finance_private.enrollment_transfer_fee_bindings f where proposal_id=p_id),'source_finances',(select snapshot_hash from finance_private.cancellation_customer_finances where proposal_id=p_id))) else app_private.booking_proposal_admin_hash_before_transfer(p_id) end
$$;

create function app_private.enrollment_transfer_source_current(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (exists(select 1 from app_private.enrollment_transfer_commits where proposal_id=p_id) or(coalesce(app_private.booking_proposal_fresh(p_id),false) and not exists(
 select 1 from finance_private.enrollment_transfer_carryovers c join finance_private.payment_allocations a on a.id=c.allocation_id
 join finance_private.incoming_transfers t on t.id=c.transfer_id join finance_private.transfer_payer_bindings b on b.id=c.payer_binding_id
 where c.proposal_id=p_id and(c.state<>'earmarked' or t.current_payer_binding_id<>c.payer_binding_id or not app_private.payment_verified_account(b.payer_account_id)
 or finance_private.finance_transfer_balance(t.id)->>'reconciliation_state'<>'clear'
 or a.amount_minor-coalesce((select sum(amount_minor) from finance_private.allocation_reversals where allocation_id=a.id),0)<c.releasable_minor))))
$$;
create function app_private.enrollment_transfer_snapshot(p_enrollment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enrollment_id',e.id,'occurrence_id',o.id,'title',s.title,'tutor',app_private.booking_occurrence_dto(o.id)->'tutor','start_at',o.start_at,'end_at',o.end_at,'time_zone','Africa/Cairo','format',o.format,'target_tier',o.target_tier)
 from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id join app_private.offers f on f.id=o.offer_id join app_private.subjects s on s.id=f.subject_id where e.id=p_enrollment
$$;
create function app_private.enrollment_transfer_funding(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;c finance_private.charges%rowtype;q app_private.quotes%rowtype;b jsonb;required bigint;posted bigint:=0;accepted bigint:=0;total integer;count_accepted integer;clear boolean;
begin
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;if r.proposal_id is null then return null;end if;
 select * into q from app_private.quotes where id=r.destination_quote_id;select * into c from finance_private.charges where enrollment_id=r.destination_enrollment_id;
 required:=app_private.booking_deposit(q.customer_price_minor,app_private.policy_content(q.policy_version_id));clear:=app_private.enrollment_transfer_source_current(p_id);
 if c.id is not null then b:=finance_private.finance_charge_balance(c.id);posted:=(b->>'allocated_cash_minor')::bigint;clear:=clear and b->>'reconciliation_state'='clear';end if;
 select count(distinct b.payer_account_id) into total from finance_private.enrollment_transfer_carryovers x join finance_private.transfer_payer_bindings b on b.id=x.payer_binding_id where x.proposal_id=p_id;
 select count(*),coalesce(sum((terms->>'carryover_minor')::bigint),0) into count_accepted,accepted from app_private.enrollment_transfer_consents where proposal_id=p_id and(state='consumed' or(state='accepted' and expires_at>now()));
 if not clear then accepted:=0;count_accepted:=0;end if;
 return jsonb_build_object('destination_charge_id',c.id,'required_for_confirmation_minor',required,'planned_carryover_minor',r.planned_carryover_minor,'accepted_carryover_minor',accepted,'posted_additional_minor',posted,'additional_required_minor',greatest(0,required-posted-r.planned_carryover_minor),'carryover_required_count',total,'carryover_accepted_count',count_accepted,'can_receive_additional_payment',c.id is not null and clear and posted<q.customer_price_minor-r.planned_carryover_minor,'reconciliation_state',case when clear then 'clear' else 'requires_review' end);
end $$;
create function app_private.enrollment_transfer_blockers(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;f jsonb;result jsonb:='[]';begin
 select * into p from app_private.operation_proposals where id=p_id;
 if not exists(select 1 from app_private.enrollment_transfer_reviews where proposal_id=p_id) then return '["REVIEW_REQUIRED"]';end if;
 if not app_private.booking_proposal_fresh(p_id) then result:=result||'"STALE_TERMS"'::jsonb;end if;
 if not app_private.booking_proposal_all_accepted(p_id,false) then result:=result||'"CONSENT_REQUIRED"'::jsonb;end if;
 if p.state<>'approved' then result:=result||'"ADMIN_APPROVAL_REQUIRED"'::jsonb;end if;
 f:=app_private.enrollment_transfer_funding(p_id);
 if f->>'reconciliation_state'<>'clear' then result:=result||'"RECONCILIATION_REQUIRED"'::jsonb;end if;
 if f->'carryover_required_count'<>f->'carryover_accepted_count' then result:=result||'"PAYER_CONSENT_REQUIRED"'::jsonb;end if;
 if f->>'destination_charge_id' is null or(f->>'posted_additional_minor')::bigint+(f->>'accepted_carryover_minor')::bigint<(f->>'required_for_confirmation_minor')::bigint then result:=result||'"INSUFFICIENT_FUNDS"'::jsonb;end if;
 return result;
end $$;

create function app_private.enrollment_transfer_sources_page(p_id uuid,p_cursor text,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;rows jsonb;source uuid;after_id uuid;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then begin after_id:=p_cursor::uuid;exception when invalid_text_representation then raise exception 'VALIDATION_ERROR';end;end if;
 select target_id into source from app_private.operation_proposals where id=p_id;
 select f.snapshot into snapshot from finance_private.cancellation_customer_finances f where proposal_id=p_id;
 if snapshot is null then snapshot:=finance_private.finance_cancellation_snapshot(source,'monetary_account_credit',false);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'data',jsonb_build_object('allocation_id',a.id,'transfer_id',a.transfer_id,'source_reference',t.external_id,'payer_masked_label',app_private.payment_payer_dto(b.payer_account_id)->>'masked_contact','releasable_minor',(part->>'releasable_minor')::bigint,'selected_carryover_minor',coalesce((select amount_minor from finance_private.enrollment_transfer_carryovers where proposal_id=p_id and allocation_id=a.id),0),'currency','EGP')) order by a.id),'[]') into rows
 from (select value part from jsonb_array_elements(finance_private.enrollment_transfer_source_portions((snapshot->>'charge_id')::uuid,(snapshot->>'release_cash_minor')::bigint)) where after_id is null or(value->>'allocation_id')::uuid>after_id order by(value->>'allocation_id')::uuid limit p_limit+1)x
 join finance_private.payment_allocations a on a.id=(x.part->>'allocation_id')::uuid join finance_private.incoming_transfers t on t.id=a.transfer_id join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id;
 return jsonb_build_object('items',coalesce((select jsonb_agg(value->'data' order by ordinality) from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit),'[]'),'next_cursor',case when jsonb_array_length(rows)>p_limit then rows->(p_limit-1)->>'id' else null end);
end $$;
create function api.list_enrollment_transfer_sources(p_proposal_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();begin perform app_private.require_role(actor,'admin');if not exists(select 1 from app_private.operation_proposals where id=p_proposal_id and kind='reschedule' and target_type='enrollment') then raise exception 'NOT_FOUND';end if;return app_private.enrollment_transfer_sources_page(p_proposal_id,p_cursor,p_limit);end $$;

create function api.get_enrollment_transfer_proposal(p_proposal_id uuid,p_view text,p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();p app_private.operation_proposals%rowtype;r app_private.enrollment_transfer_reviews%rowtype;e app_private.enrollments%rowtype;c app_private.operation_customer_terms%rowtype;t finance_private.operation_tutor_terms%rowtype;h text;accepted timestamptz;ready boolean;customer jsonb;result jsonb;actions jsonb:='[]';funding jsonb;blockers jsonb;destination uuid;name text;terms jsonb;begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;if p.id is null or p.kind<>'reschedule' or p.target_type<>'enrollment' then raise exception 'NOT_FOUND';end if;
 select * into e from app_private.enrollments where id=p.target_id;select * into r from app_private.enrollment_transfer_reviews where proposal_id=p.id;select * into c from app_private.operation_customer_terms where proposal_id=p.id and learner_id=e.learner_id;select * into t from finance_private.operation_tutor_terms where proposal_id=p.id;
 if p_view='admin' then perform app_private.require_role(actor,'admin');h:=app_private.booking_proposal_admin_hash(p.id);
 elsif p_view='customer' then if p_learner_id is not null and p_learner_id<>e.learner_id then raise exception 'NOT_FOUND';end if;perform app_private.assert_learner_scope(actor,e.learner_id,'booking');perform app_private.assert_learner_scope(actor,e.learner_id,'payments');h:=c.terms_hash;select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=e.learner_id;
 elsif p_view='tutor' then perform app_private.require_role(actor,'tutor');if not exists(select 1 from app_private.tutors where id=t.tutor_id and account_id=actor) then raise exception 'NOT_FOUND';end if;h:=t.terms_hash;select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='tutor' and participant_id=t.tutor_id;
 else raise exception 'VALIDATION_ERROR';end if;
 ready:=r.proposal_id is not null and app_private.booking_proposal_fresh(p.id);funding:=app_private.enrollment_transfer_funding(p.id);blockers:=app_private.enrollment_transfer_blockers(p.id);
 if p.state in('committed','declined','expired') then actions:='["closed"]';elsif r.proposal_id is null then actions:='["review_source_consequence"]';elsif not ready then actions:='["refresh_stale_terms"]';else
  if p_view<>'admin' and accepted is null then actions:=actions||'"accept_transfer_terms"'::jsonb;end if;
  if blockers?'PAYER_CONSENT_REQUIRED' then actions:=actions||'"await_payer_consent"'::jsonb;end if;
  if not exists(select 1 from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='tutor') then actions:=actions||'"await_tutor_consent"'::jsonb;end if;
  if(funding->>'additional_required_minor')::bigint>0 then actions:=actions||'"provide_additional_funding"'::jsonb;end if;
  if p.state<>'approved' then actions:=actions||'"await_admin_approval"'::jsonb;end if;if blockers='[]' then actions:=actions||'"apply_transfer"'::jsonb;end if;
 end if;
 result:=jsonb_build_object('proposal_id',p.id,'version',p.version,'kind','enrollment_transfer','state',p.state,'expires_at',p.expires_at,'replaces_proposal_id',(select previous_proposal_id from app_private.operation_proposal_supersessions where replacement_proposal_id=p.id),'superseded_by_proposal_id',(select replacement_proposal_id from app_private.operation_proposal_supersessions where previous_proposal_id=p.id),'terms_hash',h,'accepted_at',accepted,'can_accept',p_view<>'admin' and ready and p.state in('proposed','accepted') and accepted is null,'required_actions',actions,'view',p_view);
 if p_view='tutor' then return result||jsonb_build_object('source_teaching_terms',case when r.proposal_id is not null then t.terms else null end);end if;
 destination:=(p.requested_terms->>'destination_occurrence_id')::uuid;select person.display_name into name from app_private.learners l join app_private.people person on person.id=l.person_id where l.id=e.learner_id;
 if r.proposal_id is not null then terms:=c.terms-array['learner_id','enrollment_id'];end if;
 customer:=jsonb_build_object('learner',jsonb_build_object('learner_id',e.learner_id,'display_name',name),'source',app_private.enrollment_transfer_snapshot(e.id),'requested_destination',app_private.booking_occurrence_dto(destination)||jsonb_build_object('title',(select s.title from app_private.occurrences o join app_private.offers f on f.id=o.offer_id join app_private.subjects s on s.id=f.subject_id where o.id=destination)),'destination',app_private.enrollment_transfer_snapshot(r.destination_enrollment_id),'terms',terms,'funding',funding);
 if p_view='customer' then return result||customer;end if;
 return result||jsonb_build_object('customer',customer,'source_teaching_terms',case when r.proposal_id is not null then t.terms else null end,'destination_fee_snapshot',app_private.booking_fee_dto(coalesce((select destination_fee_agreement_id from finance_private.enrollment_transfer_fee_bindings where proposal_id=p.id),(select current_fee_agreement_id from app_private.occurrences where id=destination))),
 'required_acceptances',jsonb_build_array(jsonb_build_object('participant_type','learner','participant_id',e.learner_id,'accepted_at',(select accepted_at from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner')),jsonb_build_object('participant_type','tutor','participant_id',t.tutor_id,'accepted_at',(select accepted_at from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='tutor'))),'carryover_page',app_private.enrollment_transfer_sources_page(p.id,null,25),'can_apply',blockers='[]'::jsonb,'blockers',blockers,'source_version',e.version);
end $$;

-- Staged destination commands cannot bypass their reviewed transfer.
alter function app_private.booking_command(text,jsonb,text) rename to booking_command_before_transfer;
create function app_private.booking_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();learner uuid;begin
 if p_name='accept_quote' and exists(select 1 from app_private.enrollment_transfer_reviews r join app_private.operation_proposals p on p.id=r.proposal_id where r.destination_quote_id=(p_input->>'quote_id')::uuid and p.state<>'committed') then
  select learner_id into learner from app_private.enrollments e join app_private.quotes q on q.enrollment_id=e.id where q.id=(p_input->>'quote_id')::uuid;
  perform app_private.assert_learner_scope(actor,learner,'booking');raise exception 'STATE_CONFLICT';
 end if;return app_private.booking_command_before_transfer(p_name,p_input,p_key);
end $$;
alter function api.reserve_package_credit(uuid,uuid,bigint,uuid,integer,text) set schema app_private;
alter function app_private.reserve_package_credit(uuid,uuid,bigint,uuid,integer,text) rename to reserve_package_credit_before_transfer;
create function api.reserve_package_credit(p_package_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();begin
 perform app_private.assert_learner_scope(actor,(select learner_id from app_private.enrollments where id=p_enrollment_id),'booking');
 if exists(select 1 from app_private.enrollment_transfer_reviews r join app_private.operation_proposals p on p.id=r.proposal_id where r.destination_enrollment_id=p_enrollment_id and p.state<>'committed') then raise exception 'STATE_CONFLICT';end if;
 return app_private.reserve_package_credit_before_transfer(p_package_id,p_enrollment_id,p_credit_quanta,p_coverage_proposal_id,p_expected_version,p_idempotency_key);
end $$;
alter function finance_private.finance_funding_status(uuid,uuid,uuid) rename to finance_funding_status_before_transfer;
create function finance_private.finance_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;proposal uuid;begin
 result:=finance_private.finance_funding_status_before_transfer(p_enrollment_id,p_quote_id,p_policy_version_id);
 select r.proposal_id into proposal from app_private.enrollment_transfer_reviews r join app_private.operation_proposals p on p.id=r.proposal_id where r.destination_enrollment_id=p_enrollment_id and p.state<>'committed';
 result:=result||jsonb_build_object('conditional_transfer_proposal_id',proposal);
 if proposal is not null then result:=result||jsonb_build_object('eligible',false,'reason',case when app_private.booking_proposal_fresh(proposal) then 'TRANSFER_PENDING' else 'QUOTE_NOT_ACCEPTED' end);end if;return result;
end $$;
alter function app_private.payment_charge_dto(uuid) rename to payment_charge_dto_before_transfer;
create function app_private.payment_charge_dto(p_charge_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select app_private.payment_charge_dto_before_transfer(p_charge_id)||jsonb_build_object('conditional_transfer_proposal_id',(select conditional_transfer_proposal_id from finance_private.charge_accounts where charge_id=p_charge_id))
$$;
alter function finance_private.finance_allocate_cash(uuid,uuid,bigint,jsonb,jsonb,text) rename to finance_allocate_cash_before_transfer;
create function finance_private.finance_allocate_cash(p_transfer_id uuid,p_charge_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;b jsonb;begin
 select r0.* into r from app_private.enrollment_transfer_reviews r0 join finance_private.charges c on c.enrollment_id=r0.destination_enrollment_id join app_private.operation_proposals p on p.id=r0.proposal_id where c.id=p_charge_id and p.state<>'committed';
 if r.proposal_id is not null then
  if not app_private.booking_proposal_fresh(r.proposal_id) then raise exception 'WINDOW_CLOSED';end if;b:=finance_private.finance_charge_balance(p_charge_id);
  if p_amount_minor>(b->>'receivable_minor')::bigint-r.planned_carryover_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 end if;return finance_private.finance_allocate_cash_before_transfer(p_transfer_id,p_charge_id,p_amount_minor,p_qualified_proof,p_context,p_line_key);
end $$;

create function app_private.enrollment_transfer_issue_charge(p_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;q app_private.quotes%rowtype;accepted app_private.operation_proposal_acceptances%rowtype;qa uuid;charge uuid;payer record;body jsonb;begin
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;if r.proposal_id is null then return;end if;
 select * into accepted from app_private.operation_proposal_acceptances where proposal_id=p_id and participant_type='learner';if accepted.id is null then return;end if;
 select * into q from app_private.quotes where id=r.destination_quote_id;
 perform app_private.assert_learner_scope(accepted.actor_account_id,(select learner_id from app_private.enrollments where id=r.destination_enrollment_id),'booking');
 perform app_private.assert_learner_scope(accepted.actor_account_id,(select learner_id from app_private.enrollments where id=r.destination_enrollment_id),'payments');
 select id into qa from app_private.quote_acceptances where quote_id=q.id;
 if qa is null then
  insert into app_private.quote_acceptances(quote_id,learner_id,actor_account_id,terms_hash,accepted_at,acceptance_basis,source_proposal_acceptance_id,source_terms_hash)
  select q.id,learner_id,accepted.actor_account_id,q.terms_hash,accepted.accepted_at,'operation_proposal',accepted.id,accepted.terms_hash from app_private.enrollments where id=r.destination_enrollment_id returning id into qa;
 end if;
 if exists(select 1 from finance_private.charge_accounts a join finance_private.charges c on c.id=a.charge_id where c.enrollment_id=r.destination_enrollment_id and a.conditional_transfer_proposal_id=p_id) then return;end if;
 charge:=finance_private.finance_ensure_enrollment_charge(r.destination_enrollment_id,q.id,qa,p_context);
 update finance_private.charge_accounts set conditional_transfer_proposal_id=p_id,commitment_state='awaiting_transfer' where charge_id=charge;
 for payer in select b.payer_account_id,sum(x.amount_minor)::bigint amount_minor from finance_private.enrollment_transfer_carryovers x join finance_private.transfer_payer_bindings b on b.id=x.payer_binding_id where x.proposal_id=p_id group by b.payer_account_id order by b.payer_account_id loop
  body:=jsonb_build_object('proposal_id',p_id,'source_enrollment_id',r.source_enrollment_id,'destination_enrollment_id',r.destination_enrollment_id,'destination_charge_id',charge,'destination_quote_id',q.id,'destination_quote_hash',q.terms_hash,'learner_acceptance_id',accepted.id,'learner_terms_hash',accepted.terms_hash,'carryover_minor',payer.amount_minor,'payer_account_id',payer.payer_account_id,
   'allocations',(select jsonb_agg(jsonb_build_object('allocation_id',x.allocation_id,'transfer_id',x.transfer_id,'payer_binding_id',x.payer_binding_id,'amount_minor',x.amount_minor,'releasable_minor',x.releasable_minor) order by x.allocation_id) from finance_private.enrollment_transfer_carryovers x join finance_private.transfer_payer_bindings b on b.id=x.payer_binding_id where x.proposal_id=p_id and b.payer_account_id=payer.payer_account_id),'expires_at',(select expires_at from app_private.operation_proposals where id=p_id));
  insert into app_private.enrollment_transfer_consents(proposal_id,payer_account_id,destination_charge_id,terms_hash,terms,expires_at) values(p_id,payer.payer_account_id,charge,app_private.catalog_hash(body),body,(select expires_at from app_private.operation_proposals where id=p_id)) on conflict(proposal_id,payer_account_id) do nothing;
 end loop;
end $$;

create function app_private.enrollment_transfer_close(p_id uuid,p_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;p app_private.operation_proposals%rowtype;begin
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;select * into p from app_private.operation_proposals where id=p_id;
 if r.proposal_id is null or p.state not in('expired','declined') then return;end if;
 update finance_private.enrollment_transfer_carryovers set state='released' where proposal_id=p_id and state='earmarked';
 update app_private.enrollment_transfer_consents set state=case when p.state='expired' then 'expired' else 'invalidated' end,version=version+1,updated_at=now() where proposal_id=p_id and state in('awaiting_acceptance','accepted');
 update app_private.enrollments set state=case when p.state='expired' then 'expired' else 'cancelled' end,version=version+1,updated_at=now() where id=r.destination_enrollment_id and state='held';
 update finance_private.charge_accounts set commitment_state='resolution_required',version=version+1,updated_at=now() where charge_id in(select id from finance_private.charges where enrollment_id=r.destination_enrollment_id) and commitment_state<>'resolution_required';
 perform app_private.booking_enqueue_due(r.destination_occurrence_id,now());
end $$;
alter function app_private.booking_proposal_command(text,jsonb,text) rename to booking_proposal_command_before_transfer;
create function app_private.booking_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();r app_private.enrollment_transfer_reviews%rowtype;result jsonb;p_id uuid;begin
 p_id:=coalesce((p_input->>'proposal_id')::uuid,(p_input->>'accepted_proposal_id')::uuid);select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;
 if r.proposal_id is not null then
  if p_name in('approve_operation_proposal','transfer_enrollment') then perform app_private.require_role(actor,'admin');
  elsif p_name='accept_operation_proposal' then perform app_private.booking_proposal_participant(actor,p_id,p_input->>'terms_hash');
  elsif p_name='decline_operation_proposal' then
   if not exists(select 1 from app_private.operation_customer_terms where proposal_id=p_id and app_private.booking_can_access(actor,learner_id)) and not exists(select 1 from finance_private.operation_tutor_terms t join app_private.tutors u on u.id=t.tutor_id where t.proposal_id=p_id and u.account_id=actor and app_private.has_role(actor,'tutor')) then raise exception 'NOT_FOUND';end if;
  end if;
  perform app_private.booking_lock_occurrence_finances(array[(select occurrence_id from app_private.enrollments where id=r.source_enrollment_id),r.destination_occurrence_id]);
 end if;
 if p_name='transfer_enrollment' and r.proposal_id is not null then return app_private.enrollment_transfer_commit(p_input,p_key);end if;
 result:=app_private.booking_proposal_command_before_transfer(p_name,p_input,p_key);
 if r.proposal_id is not null and p_name='accept_operation_proposal' then perform app_private.enrollment_transfer_issue_charge(p_id,jsonb_build_object('actor_account_id',actor,'command_id',result->'command_id'));end if;
 if r.proposal_id is not null then perform app_private.enrollment_transfer_close(p_id,jsonb_build_object('actor_account_id',actor,'command_id',result->'command_id'));end if;
 return result;
end $$;

create function finance_private.enrollment_transfer_source_portions(p_charge_id uuid,p_release_minor bigint) returns jsonb language sql stable security definer set search_path='' as $$
 with active as(select a.*,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) active_minor from finance_private.payment_allocations a where a.charge_id=p_charge_id),
 shares as(select *,floor(p_release_minor::numeric*active_minor/nullif(sum(active_minor) over(),0)) base,
 mod(p_release_minor::numeric*active_minor,nullif(sum(active_minor) over(),0)) remainder from active where active_minor>0),
 ranked as(select *,row_number() over(order by remainder desc,id) priority,p_release_minor-sum(base) over() residual from shares)
 select coalesce(jsonb_agg(jsonb_build_object('allocation_id',id,'transfer_id',transfer_id,'payer_binding_id',payer_binding_id,'releasable_minor',base+case when priority<=residual then 1 else 0 end) order by id),'[]') from ranked
$$;

create function api.review_enrollment_transfer_proposal(p_proposal_id uuid,p_source_tutor_fee_minor bigint,p_carryover_allocations jsonb,p_reason text,p_expected_version integer,p_idempotency_key text,p_source_package_disposition jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;old app_private.operation_proposals%rowtype;p app_private.operation_proposals%rowtype;
 source app_private.enrollments%rowtype;seat app_private.enrollments%rowtype;origin app_private.occurrences%rowtype;destination app_private.occurrences%rowtype;
 source_quote app_private.quotes%rowtype;quote app_private.quotes%rowtype;source_fee finance_private.tutor_fee_agreements%rowtype;destination_fee finance_private.tutor_fee_agreements%rowtype;
 policy jsonb;snapshot jsonb;parts jsonb;part jsonb;item jsonb;ids uuid[]:='{}';total numeric:=0;expiry timestamptz;terms jsonb;teacher jsonb;compensation uuid:=gen_random_uuid();n integer;
begin
 perform app_private.require_role(actor,'admin');select * into old from app_private.operation_proposals where id=p_proposal_id;
 if old.id is null or old.kind<>'reschedule' or old.target_type<>'enrollment' then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,'review_enrollment_transfer_proposal',jsonb_build_object('proposal_id',p_proposal_id,'source_tutor_fee_minor',p_source_tutor_fee_minor,'carryover_allocations',p_carryover_allocations,'source_package_disposition',p_source_package_disposition,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_source_tutor_fee_minor is null or p_source_tutor_fee_minor not between 0 and 9007199254740991 or jsonb_typeof(p_carryover_allocations) is distinct from 'array' or jsonb_array_length(p_carryover_allocations)>100 then raise exception 'VALIDATION_ERROR';end if;
 select * into source from app_private.enrollments where id=old.target_id;
 perform app_private.booking_lock_occurrence_finances(array[source.occurrence_id,(old.requested_terms->>'destination_occurrence_id')::uuid]);
 perform app_private.require_role(actor,'admin');select * into old from app_private.operation_proposals where id=p_proposal_id for update;
 if old.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if old.state not in('proposed','accepted','approved') or not app_private.booking_proposal_fresh(old.id) then raise exception 'WINDOW_CLOSED';end if;
 if exists(select 1 from app_private.enrollment_transfer_reviews where proposal_id=old.id) then raise exception 'STATE_CONFLICT';end if;
 select * into source from app_private.enrollments where id=old.target_id;select * into source_quote from app_private.quotes where id=source.current_quote_id;
 select * into origin from app_private.occurrences where id=source.occurrence_id;select * into destination from app_private.occurrences where id=(old.requested_terms->>'destination_occurrence_id')::uuid;
 if destination.id is null or destination.id=origin.id or destination.offer_id<>origin.offer_id or destination.state<>'forming' or destination.start_at<=now() or destination.confirmation_deadline_at<=now() or origin.start_at<=now() or not app_private.booking_offer_sellable(destination.offer_id) then raise exception 'STATE_CONFLICT';end if;
 if exists(select 1 from app_private.enrollments where occurrence_id=destination.id and learner_id=source.learner_id and state in('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
 perform app_private.require_role((select account_id from app_private.tutors where id=origin.tutor_id),'tutor');perform app_private.require_role((select account_id from app_private.tutors where id=destination.tutor_id),'tutor');
 perform app_private.booking_assert_schedule(destination.tutor_id,destination.start_at,destination.end_at,destination.id);
 select * into source_fee from finance_private.tutor_fee_agreements where id=origin.current_fee_agreement_id;select * into destination_fee from finance_private.tutor_fee_agreements where id=destination.current_fee_agreement_id;
 if source_fee.id is null or destination_fee.id is null then raise exception 'FEE_NOT_APPROVED';end if;
 perform app_private.require_role(source_fee.approved_by,'admin');perform app_private.require_role(destination_fee.approved_by,'admin');
 if app_private.policy_content(source_quote.policy_version_id)->>'tutor_cancellation_compensation_rule'<>'reviewed_exact_adjustment' then raise exception 'POLICY_INCOMPLETE';end if;
 if p_source_tutor_fee_minor>source_fee.fee_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 if origin.format='group' and exists(select 1 from app_private.enrollments where occurrence_id=origin.id and id<>source.id and state in('held','confirmed')) and p_source_tutor_fee_minor<>source_fee.fee_minor then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.booking_expire_holds(destination.id);
 select count(*) into n from app_private.enrollments where occurrence_id=destination.id and state in('held','confirmed');
 if n>=least(destination.capacity,coalesce(destination.target_tier,1)) or exists(select 1 from app_private.waitlist_entries w where w.occurrence_id=destination.id and app_private.booking_waitlist_eligible(w.id)) then raise exception 'CAPACITY_CONFLICT';end if;
 if p_source_package_disposition is not null then
  if jsonb_typeof(p_source_package_disposition)<>'object' or p_source_package_disposition-array['released_credit_quanta','extinguished_credit_quanta']<>'{}' then raise exception 'VALIDATION_ERROR';end if;
  p_source_package_disposition:=p_source_package_disposition||jsonb_build_object('enrollment_id',source.id);
 end if;
 snapshot:=finance_private.finance_cancellation_snapshot(source.id,'monetary_account_credit',false,p_source_package_disposition);
 if snapshot->'charge_balance'->>'reconciliation_state'<>'clear' then raise exception 'RECONCILIATION_REQUIRED';end if;
 parts:=finance_private.enrollment_transfer_source_portions((snapshot->>'charge_id')::uuid,(snapshot->>'release_cash_minor')::bigint);
 for item in select value from jsonb_array_elements(p_carryover_allocations) loop
  if jsonb_typeof(item)<>'object' or item-array['allocation_id','amount_minor']<>'{}' or(item->>'allocation_id')::uuid=any(ids) then raise exception 'VALIDATION_ERROR';end if;
  perform app_private.package_safe_integer(item->'amount_minor',1);select value into part from jsonb_array_elements(parts) where value->>'allocation_id'=item->>'allocation_id';
  if part is null or(item->>'amount_minor')::numeric>(part->>'releasable_minor')::numeric then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  if exists(select 1 from finance_private.enrollment_transfer_carryovers c join app_private.operation_proposals existing on existing.id=c.proposal_id where c.allocation_id=(item->>'allocation_id')::uuid and c.state='earmarked' and existing.state in('proposed','accepted','approved') and existing.expires_at>now()) then raise exception 'STATE_CONFLICT';end if;
  ids:=array_append(ids,(item->>'allocation_id')::uuid);total:=total+(item->>'amount_minor')::numeric;
 end loop;
 policy:=app_private.policy_content(destination.policy_version_id);expiry:=least(old.expires_at,(snapshot->>'window_expires_at')::timestamptz,destination.confirmation_deadline_at,now()+make_interval(mins=>(policy->>'hold_minutes')::int));
 if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
 seat:=app_private.booking_new_hold(destination.id,source.learner_id,actor,null,null,null,expiry);select * into quote from app_private.quotes where id=seat.current_quote_id;
 if total>quote.customer_price_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 insert into app_private.operation_proposals(kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason)
 values('reschedule','enrollment',source.id,origin.id,source.version,origin.version,app_private.booking_roster_fingerprint(origin.id),source_quote.policy_version_id,
 jsonb_build_object('target_type','enrollment','destination_occurrence_id',destination.id,'expires_at',expiry,'remedy','monetary_account_credit'),expiry,actor,p_reason) returning * into p;
 insert into app_private.enrollment_transfer_reviews(proposal_id,source_enrollment_id,destination_enrollment_id,source_quote_id,destination_quote_id,destination_occurrence_id,destination_occurrence_version,destination_terms_version,planned_carryover_minor,source_package_disposition,command_id)
 values(p.id,source.id,seat.id,source_quote.id,quote.id,destination.id,destination.version,destination.quote_terms_version,total,p_source_package_disposition,(context->>'command_id')::uuid);
 insert into finance_private.enrollment_transfer_fee_bindings values(p.id,source_fee.id,destination_fee.id);
 for item in select value from jsonb_array_elements(p_carryover_allocations) loop
  select value into part from jsonb_array_elements(parts) where value->>'allocation_id'=item->>'allocation_id';
  insert into finance_private.enrollment_transfer_carryovers(proposal_id,allocation_id,transfer_id,payer_binding_id,amount_minor,releasable_minor,command_id)
  values(p.id,(item->>'allocation_id')::uuid,(part->>'transfer_id')::uuid,(part->>'payer_binding_id')::uuid,(item->>'amount_minor')::bigint,(part->>'releasable_minor')::bigint,(context->>'command_id')::uuid);
 end loop;
 terms:=jsonb_build_object('learner_id',source.learner_id,'enrollment_id',source.id,'source_quote_id',source_quote.id,'source_policy_version_id',source_quote.policy_version_id,'source_customer_policy',app_private.customer_policy_summary(source_quote.policy_version_id),
 'source_customer_price_minor',snapshot->'charge_balance'->'commercial_net_minor','source_retained_charge_minor',snapshot->'retained_net_minor','source_charge_adjustment_minor',(snapshot->>'retained_net_minor')::bigint-(snapshot->'charge_balance'->>'commercial_net_minor')::bigint,'source_cash_release_minor',snapshot->'release_cash_minor',
 'source_package_disposition',case when snapshot?'package_disposition' then jsonb_build_object('released_credit_quanta',snapshot->'package_disposition'->'released_credit_quanta','released_value_minor',snapshot->'package_disposition'->'released_value_minor','extinguished_credit_quanta',snapshot->'package_disposition'->'extinguished_credit_quanta','extinguished_value_minor',snapshot->'package_disposition'->'extinguished_value_minor') else null end,
 'destination_quote',app_private.booking_quote_dto(quote.id),'planned_carryover_minor',total,'currency','EGP');
 insert into app_private.operation_customer_terms(proposal_id,learner_id,enrollment_id,source_quote_id,proposed_quote_id,terms,terms_hash,financial_terms_ready)
 values(p.id,source.learner_id,source.id,source_quote.id,quote.id,terms,app_private.booking_proposal_hash(p.id,'learner',source.learner_id,terms,p.expires_at,p.base_target_version),true);
 insert into finance_private.cancellation_customer_finances(proposal_id,enrollment_id,charge_id,snapshot,snapshot_hash) values(p.id,source.id,(snapshot->>'charge_id')::uuid,snapshot,app_private.catalog_hash(snapshot));
 insert into finance_private.cancellation_compensation_terms(id,proposal_id,occurrence_id,tutor_id,base_fee_agreement_id,amount_minor,reviewed_by,command_id) values(compensation,p.id,origin.id,origin.tutor_id,source_fee.id,p_source_tutor_fee_minor,actor,(context->>'command_id')::uuid);
 teacher:=jsonb_build_object('tutor_id',origin.tutor_id,'occurrence_id',origin.id,'start_at',origin.start_at,'end_at',origin.end_at,'time_zone','Africa/Cairo','source_fee_agreement_id',source_fee.id,'old_fee_minor',source_fee.fee_minor,'reviewed_fee_minor',p_source_tutor_fee_minor,'review_id',compensation,'currency','EGP');
 insert into finance_private.operation_tutor_terms(proposal_id,tutor_id,terms,terms_hash) values(p.id,origin.tutor_id,teacher,app_private.booking_proposal_hash(p.id,'tutor',origin.tutor_id,teacher,p.expires_at,p.base_target_version));
 update app_private.operation_proposals set state='declined',version=version+1,invalidated_reason='superseded_by_review',updated_at=now() where id=old.id;
 insert into app_private.operation_proposal_supersessions(previous_proposal_id,replacement_proposal_id,actor_account_id,command_id) values(old.id,p.id,actor,(context->>'command_id')::uuid);
 perform app_private.booking_enqueue_due(origin.id,expiry);perform app_private.booking_enqueue_due(destination.id,expiry);perform set_config('response.status','201',true);
 return app_private.booking_finish(context,p.id,p.version,jsonb_build_object('proposal_id',p.id,'new_enrollment_id',seat.id,'destination_quote_id',quote.id,'replaces_proposal_id',old.id),'enrollment_transfer_reviewed',jsonb_build_object('proposal_id',p.id,'source_enrollment_id',source.id,'destination_enrollment_id',seat.id));
end $$;


create function app_private.enrollment_transfer_consent_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c app_private.enrollment_transfer_consents%rowtype;r app_private.enrollment_transfer_reviews%rowtype;current boolean;status text;begin
 select * into c from app_private.enrollment_transfer_consents where id=p_id;select * into r from app_private.enrollment_transfer_reviews where proposal_id=c.proposal_id;
 current:=app_private.enrollment_transfer_source_current(c.proposal_id);status:=case when c.state in('awaiting_acceptance','accepted') and c.expires_at<=now() then 'expired' when c.state in('awaiting_acceptance','accepted') and not current then 'invalidated' else c.state end;
 return jsonb_build_object('consent_id',c.id,'version',c.version,'proposal_id',c.proposal_id,'state',status,'source_booking_reference','Booking '||r.source_enrollment_id,'destination_booking_reference','Booking '||r.destination_enrollment_id,'destination_charge_id',c.destination_charge_id,'destination_quote_id',r.destination_quote_id,
 'sources',(select jsonb_agg(jsonb_build_object('transfer_id',id,'channel',channel,'amount_minor',amount) order by id) from(select t.id,t.channel,sum(x.amount_minor) amount from finance_private.enrollment_transfer_carryovers x join finance_private.incoming_transfers t on t.id=x.transfer_id join finance_private.transfer_payer_bindings b on b.id=x.payer_binding_id where x.proposal_id=c.proposal_id and b.payer_account_id=c.payer_account_id group by t.id,t.channel)s),
 'carryover_minor',c.terms->'carryover_minor','currency','EGP','terms_hash',c.terms_hash,'expires_at',c.expires_at,'accepted_at',(select accepted_at from app_private.enrollment_transfer_consent_acceptances where consent_id=c.id),'can_accept',status='awaiting_acceptance' and current);
end $$;
create function api.get_enrollment_transfer_consent(p_consent_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();begin if not exists(select 1 from app_private.enrollment_transfer_consents where id=p_consent_id and payer_account_id=actor) then raise exception 'NOT_FOUND';end if;return app_private.enrollment_transfer_consent_dto(p_consent_id);end $$;
create function api.list_my_enrollment_transfer_consents(p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();rows jsonb;after_at timestamptz;after_id uuid;begin
 if p_limit is null or p_limit not between 1 and 100 or(p_state is not null and p_state not in('awaiting_acceptance','accepted','declined','invalidated','consumed','expired')) then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then begin after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;exception when others then raise exception 'VALIDATION_ERROR';end;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',created_at,'data',data) order by created_at,id),'[]') into rows from(select c.id,c.created_at,app_private.enrollment_transfer_consent_dto(c.id) data from app_private.enrollment_transfer_consents c where payer_account_id=actor and(after_at is null or(created_at,id)>(after_at,after_id)) and(p_state is null or app_private.enrollment_transfer_consent_dto(c.id)->>'state'=p_state) order by created_at,id limit p_limit+1)x;
 return jsonb_build_object('items',coalesce((select jsonb_agg(value->'data' order by ordinality) from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit),'[]'),'next_cursor',case when jsonb_array_length(rows)>p_limit then(rows->(p_limit-1)->>'at')||'|'||(rows->(p_limit-1)->>'id') else null end);
end $$;
create function app_private.enrollment_transfer_consent_command(p_name text,p_id uuid,p_hash text,p_reason text,p_expected integer,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();c app_private.enrollment_transfer_consents%rowtype;r app_private.enrollment_transfer_reviews%rowtype;context jsonb;accepted timestamptz;result jsonb;begin
 select * into c from app_private.enrollment_transfer_consents where id=p_id and payer_account_id=actor;if c.id is null then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,p_name,jsonb_build_object('consent_id',p_id,'terms_hash',p_hash,'reason',p_reason,'expected_version',p_expected),p_key);if context->'replay_result'<>'null' then return context->'replay_result';end if;
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=c.proposal_id;
 perform app_private.booking_lock_occurrence_finances(array[(select occurrence_id from app_private.enrollments where id=r.source_enrollment_id),r.destination_occurrence_id]);
 select * into c from app_private.enrollment_transfer_consents where id=p_id for update;
 if c.version is distinct from p_expected then raise exception 'VERSION_CONFLICT';end if;
 if c.state<>'awaiting_acceptance' or c.expires_at<=now() or not app_private.enrollment_transfer_source_current(c.proposal_id) then raise exception 'CONSENT_REQUIRED';end if;
 if p_name='accept_enrollment_transfer_consent' then
  if p_hash is distinct from c.terms_hash then raise exception 'VERSION_CONFLICT';end if;
  insert into app_private.enrollment_transfer_consent_acceptances(consent_id,actor_account_id,terms_hash,command_id) values(c.id,actor,c.terms_hash,(context->>'command_id')::uuid) returning accepted_at into accepted;
  update app_private.enrollment_transfer_consents set state='accepted',version=version+1,updated_at=now() where id=c.id returning * into c;
  result:=jsonb_build_object('consent_id',c.id,'state','accepted','accepted_at',accepted);
 else
  if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
  update app_private.enrollment_transfer_consents set state='declined',version=version+1,updated_at=now() where id=c.id returning * into c;
  update app_private.operation_proposals set state='declined',version=version+1,invalidated_reason='payer_declined',updated_at=now() where id=c.proposal_id and state in('proposed','accepted','approved');
  perform app_private.enrollment_transfer_close(c.proposal_id,context);result:=jsonb_build_object('consent_id',c.id,'state','declined');
 end if;
 return app_private.booking_finish(context,c.id,c.version,result,p_name,jsonb_build_object('consent_id',c.id,'proposal_id',c.proposal_id));
end $$;
create function api.accept_enrollment_transfer_consent(p_consent_id uuid,p_terms_hash text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.enrollment_transfer_consent_command('accept_enrollment_transfer_consent',p_consent_id,p_terms_hash,null,p_expected_version,p_idempotency_key)$$;
create function api.decline_enrollment_transfer_consent(p_consent_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select app_private.enrollment_transfer_consent_command('decline_enrollment_transfer_consent',p_consent_id,null,p_reason,p_expected_version,p_idempotency_key)$$;

alter function app_private.booking_lock_occurrence_finances(uuid[]) rename to booking_lock_occurrence_finances_before_transfer;
create function app_private.booking_lock_occurrence_finances(p_occurrence_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]:=p_occurrence_ids;previous uuid[];count integer:=0;begin
 loop
  previous:=ids;select coalesce(array_agg(id order by id),'{}') into ids from(select unnest(ids) id union select e.occurrence_id from app_private.enrollment_transfer_reviews r join app_private.enrollments e on e.id=r.source_enrollment_id where r.destination_occurrence_id=any(ids) union select r.destination_occurrence_id from app_private.enrollment_transfer_reviews r join app_private.enrollments e on e.id=r.source_enrollment_id where e.occurrence_id=any(ids))x where id is not null;
  exit when ids=previous;count:=count+1;if count>64 then raise exception 'RETRYABLE_CONFLICT';end if;
 end loop;
 perform app_private.booking_lock_occurrence_finances_before_transfer(ids);
end $$;
alter function app_private.booking_expire_proposals(uuid) rename to booking_expire_proposals_before_transfer;
create function app_private.booking_expire_proposals(p_occurrence_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare result uuid[];p_id uuid;context jsonb:=jsonb_build_object('actor_account_id',null,'command_id',gen_random_uuid());begin
 result:=app_private.booking_expire_proposals_before_transfer(p_occurrence_id);
 for p_id in select p.id from app_private.operation_proposals p join app_private.enrollment_transfer_reviews r on r.proposal_id=p.id join app_private.enrollments e on e.id=r.destination_enrollment_id where(p.occurrence_id=p_occurrence_id or r.destination_occurrence_id=p_occurrence_id) and p.state<>'committed' and(p.state in('declined','expired') or p.expires_at<=now() or e.state<>'held' or e.hold_expires_at<=now()) order by p.id loop
  update app_private.operation_proposals set state='expired',version=version+1,updated_at=now() where id=p_id and state in('proposed','accepted','approved');
  perform app_private.enrollment_transfer_close(p_id,context);if not p_id=any(result) then result:=array_append(result,p_id);end if;
 end loop;return result;
end $$;

alter function app_private.booking_pending_proposals(uuid,uuid,uuid) rename to booking_pending_proposals_before_transfer;
create function app_private.booking_pending_proposals(p_occurrence_id uuid,p_learner_id uuid default null,p_tutor_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposal_id',id,'kind',kind) order by id),'[]') from(
 select (value->>'proposal_id')::uuid id,value->>'kind' kind from jsonb_array_elements(app_private.booking_pending_proposals_before_transfer(p_occurrence_id,p_learner_id,p_tutor_id)) where not exists(select 1 from app_private.operation_proposals p where p.id=(value->>'proposal_id')::uuid and p.kind='reschedule' and p.target_type='enrollment')
 union select p.id,'enrollment_transfer' from app_private.operation_proposals p left join app_private.enrollment_transfer_reviews r on r.proposal_id=p.id
 where p.kind='reschedule' and p.target_type='enrollment' and p.state in('proposed','accepted','approved') and p.expires_at>now() and(p.occurrence_id=p_occurrence_id or r.destination_occurrence_id=p_occurrence_id)
 and(p_learner_id is null or exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and learner_id=p_learner_id))
 and(p_tutor_id is null or exists(select 1 from finance_private.operation_tutor_terms where proposal_id=p.id and tutor_id=p_tutor_id)))x
$$;
alter function app_private.booking_enrollment_dto(uuid) rename to booking_enrollment_dto_before_transfer;
create function app_private.booking_enrollment_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;r app_private.enrollment_transfer_reviews%rowtype;stage text;link jsonb;begin
 select h.* into p from app_private.operation_proposals h left join app_private.enrollment_transfer_reviews v on v.proposal_id=h.id where h.kind='reschedule' and h.target_type='enrollment' and(h.target_id=p_id or v.destination_enrollment_id=p_id) order by case when h.state='committed' then 0 when h.state in('proposed','accepted','approved') then 1 else 2 end,h.created_at desc,h.id desc limit 1;
 if p.id is not null then
  select * into r from app_private.enrollment_transfer_reviews where proposal_id=p.id;
  stage:=case when p.state='committed' then 'committed' when p.state in('declined','expired') or p.expires_at<=now() then 'closed' when r.proposal_id is null then 'awaiting_review' when app_private.enrollment_transfer_blockers(p.id)='[]' then 'ready' when not app_private.booking_proposal_all_accepted(p.id,false) or app_private.enrollment_transfer_blockers(p.id)?'PAYER_CONSENT_REQUIRED' then 'awaiting_consents' else 'awaiting_funding' end;
  link:=jsonb_build_object('proposal_id',p.id,'role',case when p.target_id=p_id then 'source' else 'destination' end,'other_enrollment_id',case when p.target_id=p_id then r.destination_enrollment_id else p.target_id end,'stage',stage);
 end if;return app_private.booking_enrollment_dto_before_transfer(p_id)||jsonb_build_object('transfer_link',link);
end $$;
alter function app_private.booking_proposal_dto(uuid,uuid,text,uuid,boolean) rename to booking_proposal_dto_before_transfer;
create function app_private.booking_proposal_dto(p_actor uuid,p_id uuid,p_view text,p_learner_id uuid,p_group boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from app_private.enrollment_transfer_reviews where proposal_id=p_id) then raise exception 'NOT_FOUND';end if;
 return app_private.booking_proposal_dto_before_transfer(p_actor,p_id,p_view,p_learner_id,p_group);
end $$;


alter function finance_private.finance_reverse_allocation(uuid,bigint,text,text,uuid,jsonb,text) rename to finance_reverse_allocation_before_transfer;
create function finance_private.finance_reverse_allocation(p_allocation_id uuid,p_amount_minor bigint,p_reason text,p_source_type text,p_source_id uuid,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_source_type<>'bank_reversal' and exists(select 1 from finance_private.enrollment_transfer_carryovers c join app_private.operation_proposals p on p.id=c.proposal_id where c.allocation_id=p_allocation_id and c.state='earmarked' and p.state in('proposed','accepted','approved') and p.expires_at>now() and c.proposal_id is distinct from(p_context->>'enrollment_transfer_proposal_id')::uuid) then raise exception 'CONSENT_REQUIRED';end if;
 return finance_private.finance_reverse_allocation_before_transfer(p_allocation_id,p_amount_minor,p_reason,p_source_type,p_source_id,p_context,p_line_key);
end $$;

create function finance_private.enrollment_transfer_apply_carryover(p_id uuid,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;c finance_private.charges%rowtype;x record;consent app_private.enrollment_transfer_consents%rowtype;original finance_private.payment_allocations%rowtype;lot record;allocation uuid;ledger uuid;reserved jsonb;take bigint;remaining bigint;ids uuid[]:='{}';begin
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;select * into c from finance_private.charges where enrollment_id=r.destination_enrollment_id;
 for x in select a.*,b.payer_account_id from finance_private.enrollment_transfer_carryovers a join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id where proposal_id=p_id order by a.transfer_id,a.allocation_id loop
  select * into consent from app_private.enrollment_transfer_consents where proposal_id=p_id and payer_account_id=x.payer_account_id;
  if consent.state<>'accepted' or consent.expires_at<=now() or not exists(select 1 from app_private.enrollment_transfer_consent_acceptances where consent_id=consent.id and actor_account_id=x.payer_account_id and terms_hash=consent.terms_hash) then raise exception 'CONSENT_REQUIRED';end if;
  if not app_private.payment_verified_account(x.payer_account_id) then raise exception 'CONSENT_REQUIRED';end if;
  select * into original from finance_private.payment_allocations where id=x.allocation_id;allocation:=gen_random_uuid();remaining:=x.amount_minor;
  for lot in select l.id,finance_private.finance_credit_available(l.id) available from finance_private.customer_credit_lots l where l.source_allocation_id=x.allocation_id and l.command_id=(p_context->>'command_id')::uuid and l.origin_kind='allocation_release' and l.payer_binding_id=x.payer_binding_id order by l.id loop
   if remaining=0 then exit;end if;take:=least(remaining,lot.available);if take<=0 then continue;end if;
   reserved:=finance_private.finance_lock_credit(lot.id,x.payer_account_id,take,'allocation',allocation,p_context,'transfer-carry:'||x.id||':'||lot.id);
   perform finance_private.finance_commit_credit((reserved->>'credit_reservation_id')::uuid,'allocation',allocation,p_context);remaining:=remaining-take;
  end loop;
  if remaining<>0 then raise exception 'INSUFFICIENT_FUNDS';end if;
  ledger:=finance_private.finance_post_balanced('payment-allocation:'||allocation,'payment_allocation',allocation,'EGP',now(),jsonb_build_array(
   jsonb_build_object('account_code','unapplied_customer_funds','transfer_id',x.transfer_id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'enrollment_id',c.enrollment_id,'signed_minor',x.amount_minor),
   jsonb_build_object('account_code','receivable','transfer_id',x.transfer_id,'charge_id',c.id,'allocation_id',allocation,'learner_id',c.learner_id,'enrollment_id',c.enrollment_id,'signed_minor',-x.amount_minor)),p_context);
  insert into finance_private.payment_allocations(id,transfer_id,charge_id,amount_minor,currency,payer_binding_id,review_case_id,receipt_id,evidence_version,ledger_transaction_id,actor_account_id,command_id,source_line_key,effective_at,enrollment_transfer_consent_id)
  values(allocation,x.transfer_id,c.id,x.amount_minor,'EGP',x.payer_binding_id,original.review_case_id,original.receipt_id,original.evidence_version,ledger,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'transfer-carry:'||x.id,now(),consent.id);
  update finance_private.charge_accounts set version=version+1,updated_at=now() where charge_id=c.id;
  update finance_private.incoming_transfers set version=version+1,updated_at=now() where id=x.transfer_id;
  update finance_private.enrollment_transfer_carryovers set state='consumed' where id=x.id;ids:=array_append(ids,allocation);
 end loop;
 update app_private.enrollment_transfer_consents set state='consumed',version=version+1,updated_at=now() where proposal_id=p_id and state='accepted';return ids;
end $$;

create function app_private.enrollment_transfer_commit(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;p app_private.operation_proposals%rowtype;r app_private.enrollment_transfer_reviews%rowtype;source app_private.enrollments%rowtype;destination app_private.enrollments%rowtype;o app_private.occurrences%rowtype;dest app_private.occurrences%rowtype;fees finance_private.enrollment_transfer_fee_bindings%rowtype;comp finance_private.cancellation_compensation_terms%rowtype;effect jsonb;funding jsonb;remaining integer;decision uuid;begin
 perform app_private.require_role(actor,'admin');select * into r from app_private.enrollment_transfer_reviews where proposal_id=(p_input->>'accepted_proposal_id')::uuid;
 if r.proposal_id is null or r.source_enrollment_id is distinct from(p_input->>'enrollment_id')::uuid or r.destination_occurrence_id is distinct from(p_input->>'destination_occurrence_id')::uuid then raise exception 'NOT_FOUND';end if;
 context:=app_private.booking_begin(actor,'transfer_enrollment',p_input,p_key);if context->'replay_result'<>'null' then return context->'replay_result';end if;
 context:=context||jsonb_build_object('enrollment_transfer_proposal_id',r.proposal_id);
 perform app_private.booking_lock_occurrence_finances(array[(select occurrence_id from app_private.enrollments where id=r.source_enrollment_id),r.destination_occurrence_id]);
 perform app_private.require_role(actor,'admin');select * into p from app_private.operation_proposals where id=r.proposal_id for update;select * into source from app_private.enrollments where id=r.source_enrollment_id;select * into destination from app_private.enrollments where id=r.destination_enrollment_id;
 if source.version is distinct from(p_input->>'expected_version')::int then raise exception 'VERSION_CONFLICT';end if;
 if p.state<>'approved' or not app_private.booking_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
 perform app_private.require_role(p.approved_by,'admin');if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 if app_private.enrollment_transfer_blockers(p.id)<>'[]'::jsonb then raise exception 'CONSENT_REQUIRED';end if;
 select * into o from app_private.occurrences where id=source.occurrence_id;select * into dest from app_private.occurrences where id=destination.occurrence_id;
 select * into fees from finance_private.enrollment_transfer_fee_bindings where proposal_id=p.id;select * into comp from finance_private.cancellation_compensation_terms where proposal_id=p.id;
 perform app_private.require_role((select approved_by from finance_private.tutor_fee_agreements where id=fees.source_fee_agreement_id),'admin');perform app_private.require_role((select approved_by from finance_private.tutor_fee_agreements where id=fees.destination_fee_agreement_id),'admin');
 perform app_private.require_role(comp.reviewed_by,'admin');perform app_private.require_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor');perform app_private.require_role((select account_id from app_private.tutors where id=dest.tutor_id),'tutor');
 perform app_private.booking_assert_schedule(o.tutor_id,o.start_at,o.end_at,o.id);perform app_private.booking_assert_schedule(dest.tutor_id,dest.start_at,dest.end_at,dest.id);
 if(select count(*) from app_private.enrollments where occurrence_id=dest.id and state in('held','confirmed'))>least(dest.capacity,coalesce(dest.target_tier,1)) then raise exception 'CAPACITY_CONFLICT';end if;
 if o.format='group' and exists(select 1 from app_private.enrollments where occurrence_id=o.id and id<>source.id and state in('held','confirmed')) and comp.amount_minor<>(select fee_minor from finance_private.tutor_fee_agreements where id=fees.source_fee_agreement_id) then raise exception 'CONSENT_REQUIRED';end if;
 -- This helper revalidates the entire financial/disposition snapshot, including zero-carryover moves.
 effect:=app_private.booking_apply_cancellation_financial_effect(p.id,source.id,context);
 perform finance_private.enrollment_transfer_apply_carryover(p.id,context);
 funding:=finance_private.finance_charge_balance((select id from finance_private.charges where enrollment_id=destination.id));
 if funding->>'reconciliation_state'<>'clear' or(funding->>'allocated_cash_minor')::bigint<app_private.booking_deposit((funding->>'commercial_net_minor')::bigint,app_private.policy_content((select policy_version_id from app_private.quotes where id=r.destination_quote_id))) then raise exception 'INSUFFICIENT_FUNDS';end if;
 insert into app_private.enrollment_transfer_commits(proposal_id,source_enrollment_id,destination_enrollment_id,command_id) values(p.id,source.id,destination.id,(context->>'command_id')::uuid);
 update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where id=source.id returning * into source;
 update finance_private.charge_accounts set commitment_state='committed',version=version+1,updated_at=now() where charge_id in(select id from finance_private.charges where enrollment_id in(source.id,destination.id));
 update app_private.booking_financial_resolutions set state='resolved' where enrollment_id=source.id and state='open';
 insert into finance_private.cancellation_compensation_obligations(proposal_id,compensation_terms_id,occurrence_id,tutor_id,amount_minor,command_id) values(p.id,comp.id,o.id,o.tutor_id,comp.amount_minor,(context->>'command_id')::uuid);
 select count(*) into remaining from app_private.enrollments where occurrence_id=o.id and state in('held','confirmed');
 if remaining=0 then
  update app_private.occurrences set state='cancelled',meeting_status='revoked',version=version+1,updated_at=now() where id=o.id returning * into o;update app_private.tutor_reservations set active=false where occurrence_id=o.id;
  update app_private.waitlist_entries set state='cancelled',version=version+1,updated_at=now() where occurrence_id=o.id and state in('waiting','offered');
 else
  update app_private.occurrences set version=version+1,updated_at=now() where id=o.id returning * into o;
  if o.format='group' and remaining<(app_private.policy_content(o.policy_version_id)->>'group_minimum_size')::int then
   if app_private.policy_content(o.policy_version_id)->>'below_minimum_group_action'<>'admin_proposal_with_customer_acceptance' then raise exception 'POLICY_INCOMPLETE';end if;
   insert into app_private.booking_operational_decisions(occurrence_id,occurrence_version,policy_version_id,action,reason,command_id) values(o.id,o.version,o.policy_version_id,'admin_proposal_with_customer_acceptance','group_below_saved_minimum_after_transfer',(context->>'command_id')::uuid) returning id into decision;
  end if;
 end if;
 update app_private.operation_proposals set state='committed',version=version+1,committed_at=now(),updated_at=now() where id=p.id;
 perform app_private.booking_try_confirm_locked(dest.id,context);perform app_private.booking_expire_proposals(o.id);perform app_private.booking_enqueue_due(o.id,now());
 perform app_private.enqueue_event(gen_random_uuid(),'booking_transfer_committed',o.id,jsonb_build_object('source_occurrence_id',o.id,'destination_occurrence_id',dest.id,'proposal_id',p.id),'calendar.sync');
 if decision is not null then perform app_private.enqueue_event(gen_random_uuid(),'booking_operational_resolution_required',o.id,jsonb_build_object('occurrence_id',o.id,'decision_id',decision),'notifications.route');end if;
 return app_private.booking_finish(context,source.id,source.version,jsonb_build_object('state',source.state,'new_enrollment_id',destination.id,'charge_adjustment_ids',effect->'charge_adjustment_ids'),'enrollment_transferred',jsonb_build_object('source_enrollment_id',source.id,'destination_enrollment_id',destination.id,'proposal_id',p.id));
end $$;


create or replace function finance_private.finance_discover_scope(p_charge_ids uuid[],p_transfer_ids uuid[],p_refund_ids uuid[],p_consumption_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare charges uuid[]:=coalesce(p_charge_ids,'{}');transfers uuid[]:=coalesce(p_transfer_ids,'{}');refunds uuid[]:=coalesce(p_refund_ids,'{}');enrollments uuid[]:='{}';occurrences uuid[]:='{}';learners uuid[]:='{}';purchases uuid[]:='{}';lots uuid[]:='{}';sources uuid[]:='{}';before_graph jsonb;graph jsonb;iteration integer:=0;begin

 loop
  before_graph:=jsonb_build_array(charges,transfers,refunds,enrollments,occurrences,learners,purchases,lots);
  select coalesce(array_agg(id order by id),'{}') into refunds from(select unnest(refunds) id union select id from finance_private.refunds where(source_type='charge' and source_id=any(charges)) or(source_type='unapplied_credit' and source_id=any(transfers)) union select refund_id from finance_private.refund_source_reservations where transfer_id=any(transfers))x;
  select coalesce(array_agg(id order by id),'{}') into charges from(select unnest(charges) id union select source_id from finance_private.refunds where id=any(refunds) and source_type='charge' union select charge_id from finance_private.amendment_funding_reservations where transfer_id=any(transfers) and state='reserved' union select charge_id from finance_private.payment_allocations where transfer_id=any(transfers) union select id from finance_private.charges where enrollment_id=any(enrollments) or package_purchase_id=any(purchases))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into enrollments from(select unnest(enrollments) id union select enrollment_id from finance_private.charges where id=any(charges) union select id from app_private.enrollments where occurrence_id=any(occurrences) union select r.source_enrollment_id from app_private.enrollment_transfer_reviews r where r.destination_enrollment_id=any(enrollments) or exists(select 1 from finance_private.enrollment_transfer_carryovers x where x.proposal_id=r.proposal_id and x.transfer_id=any(transfers)) union select r.destination_enrollment_id from app_private.enrollment_transfer_reviews r where r.source_enrollment_id=any(enrollments))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into occurrences from(select unnest(occurrences) id union select occurrence_id from app_private.enrollments where id=any(enrollments))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select package_purchase_id from finance_private.charges where id=any(charges) union select purchase_id from finance_private.package_funding_sources where transfer_id=any(transfers) union select purchase_id from app_private.package_reservations where enrollment_id=any(enrollments) union select purchase_id from app_private.entitlement_movements where id=any(coalesce(p_consumption_ids,'{}')))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into learners from(select unnest(learners) id union select learner_id from finance_private.charges where id=any(charges) union select learner_id from app_private.enrollments where id=any(enrollments) union select learner_id from app_private.package_purchases where id=any(purchases))x where id is not null;
  -- All packages of an affected learner share one financial mutex and can be selected by a new coverage command.
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select id from app_private.package_purchases where learner_id=any(learners))x;
  select coalesce(array_agg(id order by id),'{}') into lots from app_private.package_lots where purchase_id=any(purchases);
  select coalesce(array_agg(id order by id),'{}') into transfers from(select unnest(transfers) id union select source_id from finance_private.refunds where id=any(refunds) and source_type='unapplied_credit' union select transfer_id from finance_private.refund_source_reservations where refund_id=any(refunds) union select transfer_id from finance_private.amendment_funding_reservations where state='reserved' and(charge_id=any(charges) or enrollment_id=any(enrollments)) union select transfer_id from finance_private.payment_allocations where charge_id=any(charges) union select x.transfer_id from finance_private.enrollment_transfer_carryovers x join app_private.enrollment_transfer_reviews r on r.proposal_id=x.proposal_id where r.source_enrollment_id=any(enrollments) or r.destination_enrollment_id=any(enrollments) union select transfer_id from finance_private.package_funding_sources where purchase_id=any(purchases))x where id is not null;
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
   if jsonb_typeof(item) is distinct from 'object' or item-array['charge_id','amount_minor','conditional_amendment_id','conditional_transfer_proposal_id']<>'{}'::jsonb or jsonb_typeof(item->'charge_id') is distinct from 'string' or item->>'charge_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'VALIDATION_ERROR';end if;
   if(item->>'charge_id')::uuid=any(ids) then raise exception 'VALIDATION_ERROR';end if;ids:=array_append(ids,(item->>'charge_id')::uuid);
   select * into c from finance_private.charges where id=(item->>'charge_id')::uuid;if c.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,c.learner_id,'payments');
   amount:=app_private.package_safe_integer(item->'amount_minor',1);total:=total+amount;
   if item->>'conditional_amendment_id' is not null and(c.enrollment_id is null or not exists(select 1 from app_private.group_amendments g join app_private.operation_proposals p on p.id=g.id join app_private.enrollments en on en.occurrence_id=p.occurrence_id where g.id=(item->>'conditional_amendment_id')::uuid and en.id=c.enrollment_id and p.state in('proposed','partially_accepted','accepted','approved') and p.expires_at>now())) then raise exception 'STATE_CONFLICT';end if;
   if item->>'conditional_transfer_proposal_id' is not null and (item->>'conditional_transfer_proposal_id')::uuid is distinct from(select conditional_transfer_proposal_id from finance_private.charge_accounts where charge_id=c.id) then raise exception 'STATE_CONFLICT';end if;
   if exists(select 1 from finance_private.charge_accounts where charge_id=c.id and commitment_state='awaiting_transfer') and not app_private.booking_proposal_fresh((select conditional_transfer_proposal_id from finance_private.charge_accounts where charge_id=c.id)) then raise exception 'WINDOW_CLOSED';end if;
   targets:=targets||jsonb_build_array(jsonb_build_object('charge_id',c.id,'amount_minor',amount,'conditional_amendment_id',(item->>'conditional_amendment_id')::uuid,'conditional_transfer_proposal_id',(select conditional_transfer_proposal_id from finance_private.charge_accounts where charge_id=c.id),'funding_quote_id',(select quote_id from finance_private.charge_acceptance_sources where charge_id=c.id)));
  end loop;
  if total>9007199254740991 or total>e.reported_amount_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
  hash:=app_private.catalog_hash(jsonb_build_object('receipt_id',r.id,'evidence_id',e.id,'checksum_sha256',e.checksum_sha256,'author_account_id',actor,'targets',targets));
  select coalesce(max(p.plan_version),0)+1 into plan_version from app_private.payment_allocation_plans p where p.receipt_id=r.id;
  update app_private.payment_allocation_plans set state='superseded' where receipt_id=r.id and state='active';
  update app_private.transfer_payment_plan_links set state='invalidated',version=transfer_payment_plan_links.version+1,updated_at=now() where payment_plan_id in(select id from app_private.payment_allocation_plans where receipt_id=r.id);
  insert into app_private.payment_allocation_plans(receipt_id,evidence_version,author_account_id,plan_version,plan_hash,command_id) values(r.id,e.evidence_version,actor,plan_version,hash,(context->>'command_id')::uuid) returning * into plan;
  for item in select value from jsonb_array_elements(targets) loop
   select * into c from finance_private.charges where id=(item->>'charge_id')::uuid;
   insert into app_private.payment_plan_targets(plan_id,charge_id,learner_id,amount_minor,conditional_amendment_id,conditional_transfer_proposal_id,receipt_evidence_id,receipt_id,evidence_version,file_id,checksum_sha256,author_account_id,authority_ref) values(plan.id,c.id,c.learner_id,(item->>'amount_minor')::bigint,(item->>'conditional_amendment_id')::uuid,(item->>'conditional_transfer_proposal_id')::uuid,e.id,r.id,e.evidence_version,e.file_id,e.checksum_sha256,actor,jsonb_build_object('actor_account_id',actor,'learner_id',c.learner_id,'scope','payments','checked_at',now()));
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

create or replace function app_private.payment_plan_read_dto(p_plan uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('payment_plan_id',p.id,'plan_version',p.plan_version,'plan_hash',p.plan_hash,'receipt_id',p.receipt_id,'evidence_version',p.evidence_version,'targets',coalesce((select jsonb_agg(jsonb_build_object('charge_id',t.charge_id,'amount_minor',t.amount_minor,'conditional_amendment_id',t.conditional_amendment_id,'conditional_transfer_proposal_id',t.conditional_transfer_proposal_id) order by t.charge_id) from app_private.payment_plan_targets t where t.plan_id=p.id),'[]'::jsonb)) from app_private.payment_allocation_plans p where p.id=p_plan
$$;

do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','app_private','finance_private') and p.proname=any(array['reject_immutable_change','enrollment_transfer_lifecycle_guard','booking_proposal_fresh','booking_proposal_fresh_before_transfer','booking_proposal_admin_hash','booking_proposal_admin_hash_before_transfer','enrollment_transfer_source_current','enrollment_transfer_snapshot','enrollment_transfer_funding','enrollment_transfer_blockers','enrollment_transfer_sources_page','list_enrollment_transfer_sources','get_enrollment_transfer_proposal','booking_command','booking_command_before_transfer','reserve_package_credit','reserve_package_credit_before_transfer','finance_funding_status','finance_funding_status_before_transfer','payment_charge_dto','payment_charge_dto_before_transfer','finance_allocate_cash','finance_allocate_cash_before_transfer','enrollment_transfer_issue_charge','enrollment_transfer_close','booking_proposal_command','booking_proposal_command_before_transfer','enrollment_transfer_source_portions','review_enrollment_transfer_proposal','enrollment_transfer_consent_dto','get_enrollment_transfer_consent','list_my_enrollment_transfer_consents','enrollment_transfer_consent_command','accept_enrollment_transfer_consent','decline_enrollment_transfer_consent','booking_lock_occurrence_finances','booking_lock_occurrence_finances_before_transfer','booking_expire_proposals','booking_expire_proposals_before_transfer','booking_pending_proposals','booking_pending_proposals_before_transfer','booking_enrollment_dto','booking_enrollment_dto_before_transfer','booking_proposal_dto','booking_proposal_dto_before_transfer','finance_reverse_allocation','finance_reverse_allocation_before_transfer','enrollment_transfer_apply_carryover','enrollment_transfer_commit','finance_discover_scope','payment_plan_command','payment_plan_read_dto']) loop
 execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
 if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;end $$;
 revoke create on schema api,app_private,finance_private from git_tutor_commands;notify pgrst,'reload schema';