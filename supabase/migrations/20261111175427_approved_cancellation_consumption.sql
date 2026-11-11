grant create on schema api,app_private,finance_private to git_tutor_commands;
create table app_private.booking_cancellation_effects(id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.operation_proposals(id),enrollment_id uuid not null unique references app_private.enrollments(id),remedy_id uuid references finance_private.financial_remedy_plans(id),charge_adjustment_id uuid references finance_private.charge_adjustments(id),command_id uuid not null,created_at timestamptz not null default now());
create table app_private.booking_operational_decisions(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references app_private.occurrences(id),occurrence_version integer not null,policy_version_id uuid not null references app_private.policy_versions(id),action text not null check(action='admin_proposal_with_customer_acceptance'),reason text not null,command_id uuid not null,created_at timestamptz not null default now(),unique(occurrence_id,occurrence_version));
do $$declare t text;begin foreach t in array array['booking_cancellation_effects','booking_operational_decisions'] loop execute format('alter table app_private.%I enable row level security',t);execute format('grant select,insert on app_private.%I to git_tutor_commands',t);execute format('create policy commands_access on app_private.%I to git_tutor_commands using(true) with check(true)',t);execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,git_tutor_worker',t);execute format('create trigger immutable_cancellation_effect before update or delete on app_private.%I for each row execute function app_private.reject_immutable_change()',t);end loop;end $$;
create function app_private.booking_consume_cancellation(p_proposal_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;o app_private.occurrences%rowtype;comp finance_private.cancellation_compensation_terms%rowtype;financial finance_private.cancellation_customer_finances%rowtype;ct app_private.operation_customer_terms%rowtype;current_snapshot jsonb;adjustment jsonb;balance jsonb;remedy uuid;ids uuid[]:='{}';remedies uuid[]:='{}';retained bigint;delta bigint;remaining integer;decision uuid;begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;select * into o from app_private.occurrences where id=p.occurrence_id;
 if p.kind is distinct from 'cancellation_remedy' or p.state<>'approved' or not coalesce(app_private.booking_proposal_fresh(p.id),false) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.require_role(p.approved_by,'admin');if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 select * into comp from finance_private.cancellation_compensation_terms where proposal_id=p.id;if comp.id is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;perform app_private.require_role(comp.reviewed_by,'admin');
 -- Snapshot and party checks precede all postings. Cash/evidence arriving after review requires a new review.
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  current_snapshot:=finance_private.finance_cancellation_snapshot(financial.enrollment_id,p.requested_terms->>'remedy',p.target_type='occurrence');
  if app_private.catalog_hash(current_snapshot)<>financial.snapshot_hash then raise exception 'VERSION_CONFLICT';end if;
 end loop;
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  select * into ct from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=financial.enrollment_id;current_snapshot:=financial.snapshot;
  if current_snapshot->>'reservation_id' is not null then
   perform finance_private.finance_release_package_coverage((current_snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);
   perform app_private.package_release_reservation_kernel((current_snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);
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
create or replace function api.cancel_enrollment(p_enrollment_id uuid,p_reason text,p_remedy_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();e app_private.enrollments%rowtype;p app_private.operation_proposals%rowtype;context jsonb;result jsonb;remedy uuid;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;if e.id is null then raise exception 'NOT_FOUND';end if;perform app_private.assert_learner_scope(actor,e.learner_id,'booking',true);
 context:=app_private.booking_begin(actor,'cancel_enrollment',jsonb_build_object('enrollment_id',p_enrollment_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 perform app_private.booking_lock_occurrence_finances(array[e.occurrence_id]);select * into e from app_private.enrollments where id=p_enrollment_id;
 if e.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if p_remedy_proposal_id is null and e.state='held' and not exists(select 1 from finance_private.charges where enrollment_id=e.id) then update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where id=e.id returning * into e;perform app_private.booking_enqueue_due(e.occurrence_id,now());
 else
  select * into p from app_private.operation_proposals where id=p_remedy_proposal_id;
  if p.id is null or p.kind<>'cancellation_remedy' or p.target_type<>'enrollment' or p.target_id<>e.id then raise exception 'CONSENT_REQUIRED';end if;
  if not exists(select 1 from finance_private.cancellation_compensation_terms where proposal_id=p.id) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  result:=app_private.booking_consume_cancellation(p.id,context);select * into e from app_private.enrollments where id=e.id;select remedy_id into remedy from app_private.booking_cancellation_effects where enrollment_id=e.id;
 end if;
 return app_private.booking_finish(context,e.id,e.version,jsonb_build_object('state',e.state,'remedy_id',remedy),'enrollment_cancelled',jsonb_build_object('enrollment_id',e.id,'occurrence_id',e.occurrence_id));
end $$;
create or replace function api.cancel_occurrence(p_occurrence_id uuid,p_reason text,p_remedy_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();o app_private.occurrences%rowtype;p app_private.operation_proposals%rowtype;context jsonb;result jsonb;begin
 perform app_private.require_role(actor,'admin');
 if p_remedy_proposal_id is null and not exists(select 1 from app_private.enrollments where occurrence_id=p_occurrence_id) then return app_private.booking_proposal_command('cancel_occurrence',jsonb_build_object('occurrence_id',p_occurrence_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key);end if;
 context:=app_private.booking_begin(actor,'cancel_occurrence',jsonb_build_object('occurrence_id',p_occurrence_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;perform app_private.booking_lock_occurrence_finances(array[p_occurrence_id]);select * into o from app_private.occurrences where id=p_occurrence_id;if o.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 select * into p from app_private.operation_proposals where id=p_remedy_proposal_id;
 if p.id is null or p.kind<>'cancellation_remedy' or p.target_type<>'occurrence' or p.target_id<>o.id then raise exception 'CONSENT_REQUIRED';end if;
 result:=app_private.booking_consume_cancellation(p.id,context);
 return app_private.booking_finish(context,o.id,(result->>'occurrence_version')::int,jsonb_build_object('state','cancelled','affected_enrollment_ids',result->'enrollment_ids'),'occurrence_cancelled',jsonb_build_object('occurrence_id',o.id));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and p.proname='booking_consume_cancellation') or(n.nspname='api' and p.proname in('cancel_enrollment','cancel_occurrence')) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
