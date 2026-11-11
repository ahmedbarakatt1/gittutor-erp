grant create on schema api,app_private,finance_private to git_tutor_commands;
create function app_private.booking_apply_cancellation_financial_effect(p_proposal_id uuid,p_enrollment_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;ct app_private.operation_customer_terms%rowtype;f finance_private.cancellation_customer_finances%rowtype;effect app_private.booking_cancellation_effects%rowtype;snapshot jsonb;balance jsonb;adjustment jsonb;disposition jsonb;remedy uuid;delta bigint;adjustments uuid[];
begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;select * into ct from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=p_enrollment_id;select * into f from finance_private.cancellation_customer_finances where proposal_id=p.id and enrollment_id=p_enrollment_id;
 if p.id is null or p.kind not in('cancellation_remedy','group_amendment','reschedule') or p.state<>'approved' or ct.id is null or f.proposal_id is null or not app_private.booking_proposal_fresh(p.id) or not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.require_role(p.approved_by,'admin');
 select * into effect from app_private.booking_cancellation_effects where proposal_id=p.id and enrollment_id=p_enrollment_id;
 if effect.id is not null then return jsonb_build_object('remedy_id',effect.remedy_id,'charge_adjustment_ids',case when effect.charge_adjustment_id is null then '{}'::uuid[] else array[effect.charge_adjustment_id] end,'disposition_id',(select id from finance_private.package_cancellation_dispositions where proposal_id=p.id and reservation_id=(f.snapshot->>'reservation_id')::uuid));end if;
 if f.snapshot?'package_disposition' then
  snapshot:=finance_private.finance_cancellation_snapshot(p_enrollment_id,f.snapshot->>'remedy',p.kind='cancellation_remedy' and p.target_type='occurrence',jsonb_build_object('enrollment_id',p_enrollment_id,'released_credit_quanta',f.snapshot->'package_disposition'->'released_credit_quanta','extinguished_credit_quanta',f.snapshot->'package_disposition'->'extinguished_credit_quanta'));
 else snapshot:=finance_private.finance_cancellation_snapshot_before_disposition(p_enrollment_id,f.snapshot->>'remedy',p.kind='cancellation_remedy' and p.target_type='occurrence');end if;
 if app_private.catalog_hash(snapshot)<>f.snapshot_hash then raise exception 'VERSION_CONFLICT';end if;
 if snapshot->>'reservation_id' is not null then
  if snapshot?'package_disposition' then disposition:=app_private.package_commit_cancellation_disposition(p.id,p_enrollment_id,p_context);
  else perform finance_private.finance_release_package_coverage((snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);perform app_private.package_release_reservation_kernel((snapshot->>'reservation_id')::uuid,'approved_cancellation',p_context);end if;
 end if;
 balance:=finance_private.finance_charge_balance(f.charge_id);delta:=(snapshot->>'retained_net_minor')::bigint-(balance->>'commercial_net_minor')::bigint;
 if delta<>0 then adjustment:=finance_private.finance_adjust_charge(f.charge_id,delta,'commercial','cancellation_proposal',p.id,now(),'Accepted saved-policy cancellation outcome',p_context,'cancellation:'||p_enrollment_id);end if;
 if(snapshot->>'release_cash_minor')::bigint>0 then
  insert into finance_private.financial_remedy_plans(source_type,source_id,policy_version_id,proposal_id,approved_by,credit_quanta,value_minor,mode,terms_hash,source_ancestry,command_id) values('charge',f.charge_id,(snapshot->>'policy_version_id')::uuid,p.id,p.approved_by,0,(snapshot->>'release_cash_minor')::bigint,case when snapshot->>'remedy'='monetary_account_credit' then 'account_credit' else 'cash' end,ct.terms_hash,jsonb_build_object('allocation_ids',snapshot->'allocation_ids'),(p_context->>'command_id')::uuid) returning id into remedy;
 end if;
 insert into app_private.booking_cancellation_effects(proposal_id,enrollment_id,remedy_id,charge_adjustment_id,command_id) values(p.id,p_enrollment_id,remedy,(adjustment->>'adjustment_id')::uuid,(p_context->>'command_id')::uuid);
 select coalesce(array_agg(id order by id),'{}') into adjustments from finance_private.charge_adjustments where charge_id=f.charge_id and command_id=(p_context->>'command_id')::uuid;
 return jsonb_build_object('remedy_id',remedy,'charge_adjustment_ids',adjustments,'disposition_id',disposition->'id');
end $$;

create function app_private.booking_amendment_fee_basis(p_occurrence_id uuid,p_fee_id uuid,p_policy_id uuid,p_target integer,p_has_additions boolean,p_has_removals boolean) returns text language plpgsql security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;f finance_private.tutor_fee_agreements%rowtype;p app_private.policy_versions%rowtype;retained boolean;
begin
 select * into o from app_private.occurrences where id=p_occurrence_id;select * into f from finance_private.tutor_fee_agreements where id=p_fee_id;select * into p from app_private.policy_versions where id=p_policy_id;
 if f.id is null or f.occurrence_id<>o.id or f.tutor_id<>o.tutor_id or f.duration_minutes<>o.duration_minutes or f.pricing_version_id<>p.pricing_version_id then raise exception 'POLICY_INCOMPLETE';end if;
 retained:=p_has_removals and not p_has_additions and o.state='confirmed' and coalesce((app_private.policy_content(o.policy_version_id)->>'post_confirmation_dropout_price_guarantee')::boolean,false) and f.id=o.current_fee_agreement_id;
 if not retained and(f.purpose<>'amendment' or f.base_occurrence_version<>o.version or f.target_tier<>p_target) then raise exception 'POLICY_INCOMPLETE';end if;
 perform app_private.require_role(f.approved_by,'admin');perform app_private.assert_exact_tutor_fee(f.pricing_version_id,case when retained then f.target_tier else p_target end,f.fee_minor,f.currency,f.duration_minutes);
 return case when retained then 'retained_previous_agreement' else 'replacement_tier_agreement' end;
end $$;

alter function api.propose_group_amendment(uuid,uuid[],uuid[],integer,uuid,uuid,timestamptz,text,integer,text) set schema app_private;
alter function app_private.propose_group_amendment(uuid,uuid[],uuid[],integer,uuid,uuid,timestamptz,text,integer,text) rename to propose_group_amendment_before_removal;
create function api.propose_group_amendment(p_occurrence_id uuid,p_add_learner_ids uuid[],p_remove_enrollment_ids uuid[],p_target_tier integer,p_fee_agreement_id uuid,p_replacement_policy_version_id uuid,p_expires_at timestamptz,p_reason text,p_expected_version integer,p_idempotency_key text,p_package_dispositions jsonb default null,p_removed_remedy text default 'policy_default') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();context jsonb;scope jsonb;o app_private.occurrences%rowtype;p app_private.operation_proposals%rowtype;policy app_private.policy_versions%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;newq app_private.quotes%rowtype;content jsonb;customer jsonb;teacher jsonb;snapshot jsonb;disposition jsonb;snapshots jsonb:='{}';fee_basis text;expiry timestamptz;ids uuid[]:='{}';purchases uuid[];learner uuid;price bigint;initial_price bigint;n integer;removed_n integer;resource uuid:=gen_random_uuid();guarantee boolean;
begin
 perform app_private.require_role(actor,'admin');p_removed_remedy:=coalesce(p_removed_remedy,'policy_default');if p_removed_remedy not in('policy_default','cash_refund','monetary_account_credit','package_entitlement_restoration') then raise exception 'VALIDATION_ERROR';end if;
 if p_remove_enrollment_ids is not null and cardinality(p_remove_enrollment_ids)=0 then
  if p_removed_remedy<>'policy_default' or(p_package_dispositions is not null and p_package_dispositions<>'[]'::jsonb) then raise exception 'VALIDATION_ERROR';end if;
  return app_private.propose_group_amendment_before_removal(p_occurrence_id,p_add_learner_ids,p_remove_enrollment_ids,p_target_tier,p_fee_agreement_id,p_replacement_policy_version_id,p_expires_at,p_reason,p_expected_version,p_idempotency_key);
 end if;
 if p_add_learner_ids is null or p_remove_enrollment_ids is null or cardinality(p_add_learner_ids)>4 or cardinality(p_remove_enrollment_ids) not between 1 and 4 or array_position(p_add_learner_ids,null) is not null or array_position(p_remove_enrollment_ids,null) is not null or(select count(distinct x) from unnest(p_add_learner_ids)x)<>cardinality(p_add_learner_ids) or(select count(distinct x) from unnest(p_remove_enrollment_ids)x)<>cardinality(p_remove_enrollment_ids) then raise exception 'VALIDATION_ERROR';end if;
 if p_package_dispositions is not null then
  if jsonb_typeof(p_package_dispositions) is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
  if jsonb_array_length(p_package_dispositions)>4 or(select count(*) from jsonb_array_elements(p_package_dispositions))<>(select count(distinct value->>'enrollment_id') from jsonb_array_elements(p_package_dispositions)) or exists(select 1 from jsonb_array_elements(p_package_dispositions) where not((value->>'enrollment_id')::uuid=any(p_remove_enrollment_ids))) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 context:=app_private.booking_begin(actor,'propose_group_amendment',jsonb_build_object('occurrence_id',p_occurrence_id,'add_learner_ids',p_add_learner_ids,'remove_enrollment_ids',p_remove_enrollment_ids,'target_tier',p_target_tier,'fee_agreement_id',p_fee_agreement_id,'replacement_policy_version_id',p_replacement_policy_version_id,'expires_at',p_expires_at,'reason',p_reason,'expected_version',p_expected_version)||case when p_package_dispositions is null then '{}'::jsonb else jsonb_build_object('package_dispositions',p_package_dispositions) end||case when p_removed_remedy='policy_default' then '{}'::jsonb else jsonb_build_object('removed_remedy',p_removed_remedy) end,p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 select coalesce(array_agg(id order by id),'{}') into purchases from app_private.package_purchases where learner_id=any(p_add_learner_ids);
 scope:=app_private.booking_financial_scope(array(select id from app_private.enrollments where occurrence_id=p_occurrence_id),purchases);
 scope:=scope||jsonb_build_object('learner_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select value::uuid id from jsonb_array_elements_text(scope->'learner_ids') union select unnest(p_add_learner_ids)) x));
 perform app_private.booking_lock_financial_scope(scope);select * into o from app_private.occurrences where id=p_occurrence_id;
 if o.id is null or o.format<>'group' then raise exception 'NOT_FOUND';end if;if o.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if o.state not in('forming','confirmed') or exists(select 1 from app_private.operation_proposals where occurrence_id=o.id and kind='group_amendment' and state in('proposed','accepted','approved')) then raise exception 'STATE_CONFLICT';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=now() or p_expires_at>o.start_at then raise exception 'VALIDATION_ERROR';end if;
 select * into policy from app_private.policy_versions where id=p_replacement_policy_version_id for share;
 if policy.id is null or policy.status not in('approved','published') or policy.scope<>'group' or policy.effective_at>now() then raise exception 'POLICY_INCOMPLETE';end if;perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);content:=app_private.policy_content(policy.id);
 if p_target_tier is null or p_target_tier not between 2 and 4 or p_target_tier>o.capacity or(content->>'group_target_size')::int<>p_target_tier or(content->>'group_capacity')::numeric<o.capacity or(content->>'duration_minutes')::numeric<>o.duration_minutes then raise exception 'POLICY_INCOMPLETE';end if;
 if now()>=o.start_at-make_interval(mins=>least((content->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int) then raise exception 'WINDOW_CLOSED';end if;
 expiry:=least(p_expires_at,now()+make_interval(mins=>least((content->>'amendment_acceptance_minutes')::numeric,2147483647)::int),o.start_at-make_interval(mins=>least((content->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int));
 fee_basis:=app_private.booking_amendment_fee_basis(o.id,p_fee_agreement_id,policy.id,p_target_tier,cardinality(p_add_learner_ids)>0,true);
 guarantee:=o.state='confirmed' and coalesce((app_private.policy_content(o.policy_version_id)->>'post_confirmation_dropout_price_guarantee')::boolean,false);
 select count(*) into n from app_private.enrollments where occurrence_id=o.id and(state='confirmed' or(state='held' and hold_expires_at>now()));
 select count(*) into removed_n from app_private.enrollments where occurrence_id=o.id and id=any(p_remove_enrollment_ids) and(state='confirmed' or(state='held' and hold_expires_at>now()));
 if removed_n<>cardinality(p_remove_enrollment_ids) or n-removed_n+cardinality(p_add_learner_ids)<>p_target_tier or n+cardinality(p_add_learner_ids)>o.capacity then raise exception 'CAPACITY_CONFLICT';end if;
 foreach learner in array p_add_learner_ids loop
  if not exists(select 1 from app_private.learners l join app_private.accounts a on a.id=l.account_id where l.id=learner and a.active) then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from app_private.enrollments where occurrence_id=o.id and learner_id=learner and state in('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
 end loop;
 for e in select * from app_private.enrollments where id=any(p_remove_enrollment_ids) order by id loop
  select value into disposition from jsonb_array_elements(p_package_dispositions) where(value->>'enrollment_id')::uuid=e.id;
  snapshot:=finance_private.finance_cancellation_snapshot(e.id,p_removed_remedy,false,disposition);snapshots:=snapshots||jsonb_build_object(e.id::text,snapshot);expiry:=least(expiry,(snapshot->>'window_expires_at')::timestamptz);
 end loop;
 select least(expiry,min(hold_expires_at)) into expiry from app_private.enrollments where occurrence_id=o.id and state='held' and hold_expires_at>now();if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
 foreach learner in array p_add_learner_ids loop perform app_private.booking_new_hold(o.id,learner,actor,resource,policy.id,p_target_tier,expiry);end loop;
 insert into app_private.operation_proposals(id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason) values(resource,'group_amendment','occurrence',o.id,o.id,o.version,o.version,app_private.booking_roster_fingerprint(o.id),policy.id,jsonb_build_object('target_type','occurrence','target_tier',p_target_tier,'replacement_policy_version_id',policy.id,'add_learner_ids',p_add_learner_ids,'remove_enrollment_ids',p_remove_enrollment_ids,'expires_at',expiry),expiry,actor,p_reason) returning * into p;
 insert into app_private.group_amendments(id,replacement_policy_version_id,pricing_version_id,target_tier,add_learner_ids,remove_enrollment_ids) values(p.id,policy.id,policy.pricing_version_id,p_target_tier,p_add_learner_ids,p_remove_enrollment_ids);
 select(value->>'seat_price_minor')::bigint into initial_price from app_private.pricing_versions v,jsonb_array_elements(v.customer_pricing->'group_tiers') where v.id=policy.pricing_version_id and(value->>'group_size')::int=p_target_tier;
 for e in select * from app_private.enrollments where occurrence_id=o.id and(state='confirmed' or(state='held' and hold_expires_at>now())) order by id loop
  select * into q from app_private.quotes where id=e.current_quote_id;snapshot:=snapshots->e.id::text;
  if snapshot is not null then
   price:=(snapshot->>'retained_net_minor')::bigint;
   newq:=app_private.booking_proposal_new_quote(e.id,q.policy_version_id,q.target_tier,price,o.start_at,o.end_at,expiry,true);
   customer:=app_private.booking_proposal_customer_json(e.id,q.policy_version_id,o.start_at,o.end_at,price,snapshot->>'remedy');
   customer:=customer||jsonb_build_object('old_customer_price_minor',(snapshot->'charge_balance'->>'commercial_net_minor')::bigint,'customer_adjustment_minor',price-(snapshot->'charge_balance'->>'commercial_net_minor')::bigint,'remedy_amount_minor',(snapshot->>'release_cash_minor')::bigint,'restored_credit_quanta',0,'released_credit_quanta',(snapshot->>'released_credit_quanta')::bigint);
   if snapshot?'package_disposition' then customer:=customer||jsonb_build_object('released_value_minor',snapshot->'package_disposition'->'released_value_minor','extinguished_credit_quanta',snapshot->'package_disposition'->'extinguished_credit_quanta','extinguished_value_minor',snapshot->'package_disposition'->'extinguished_value_minor');end if;
   insert into finance_private.cancellation_customer_finances(proposal_id,enrollment_id,charge_id,snapshot,snapshot_hash) values(p.id,e.id,(snapshot->>'charge_id')::uuid,snapshot,app_private.catalog_hash(snapshot));
  else
   price:=case when guarantee and not(e.learner_id=any(p_add_learner_ids)) then least(initial_price,q.customer_price_minor) else initial_price end;
   newq:=app_private.booking_proposal_new_quote(e.id,policy.id,p_target_tier,price,o.start_at,o.end_at,least(q.expires_at,expiry),true);
   customer:=app_private.booking_proposal_customer_json(e.id,policy.id,o.start_at,o.end_at,price,'none',null,e.learner_id=any(p_add_learner_ids));
  end if;
  ids:=array_append(ids,newq.id);
  insert into app_private.operation_customer_terms(proposal_id,learner_id,enrollment_id,source_quote_id,proposed_quote_id,terms,terms_hash,financial_terms_ready) values(p.id,e.learner_id,e.id,q.id,newq.id,customer,app_private.booking_proposal_hash(p.id,'learner',e.learner_id,customer,p.expires_at,p.base_target_version),true);
 end loop;
 teacher:=app_private.booking_proposal_tutor_json(o.id,p_fee_agreement_id,o.start_at,o.end_at,p_target_tier)||jsonb_build_object('fee_basis',fee_basis);
 insert into finance_private.operation_tutor_terms(proposal_id,tutor_id,fee_agreement_id,terms,terms_hash) values(p.id,o.tutor_id,p_fee_agreement_id,teacher,app_private.booking_proposal_hash(p.id,'tutor',o.tutor_id,teacher,p.expires_at,p.base_target_version));
 perform app_private.booking_enqueue_due(o.id,p.expires_at);perform set_config('response.status','201',true);
 return app_private.booking_finish(context,p.id,p.version,jsonb_build_object('amendment_id',p.id,'affected_quote_ids',ids),'group_amendment_proposed',jsonb_build_object('proposal_id',p.id,'occurrence_id',o.id));
end $$;

create or replace function app_private.booking_consume_cancellation(p_proposal_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;o app_private.occurrences%rowtype;comp finance_private.cancellation_compensation_terms%rowtype;financial finance_private.cancellation_customer_finances%rowtype;ct app_private.operation_customer_terms%rowtype;current_snapshot jsonb;adjustment jsonb;balance jsonb;remedy uuid;ids uuid[]:='{}';remedies uuid[]:='{}';retained bigint;delta bigint;remaining integer;decision uuid;financial_effect jsonb;begin
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
  financial_effect:=app_private.booking_apply_cancellation_financial_effect(p.id,financial.enrollment_id,p_context);
  if financial_effect->>'remedy_id' is not null then remedies:=array_append(remedies,(financial_effect->>'remedy_id')::uuid);end if;
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
create or replace function api.commit_group_amendment(p_amendment_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();context jsonb;p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;o app_private.occurrences%rowtype;ct app_private.operation_customer_terms%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;oldq app_private.quotes%rowtype;c finance_private.charges%rowtype;fee finance_private.tutor_fee_agreements%rowtype;policy app_private.policy_versions%rowtype;acceptance app_private.operation_proposal_acceptances%rowtype;r app_private.package_reservations%rowtype;basis jsonb;result jsonb;roster jsonb:='[]';adjustments uuid[]:='{}';seat_ids uuid[];delta bigint;current_credit bigint;desired_credit bigint;named_difference bigint;final_version integer;fee_basis text;financial_effect jsonb;financial finance_private.cancellation_customer_finances%rowtype;current_snapshot jsonb;
begin
 perform app_private.require_role(actor,'admin');select * into p from app_private.operation_proposals where id=p_amendment_id;
 if p.id is null or p.kind<>'group_amendment' then raise exception 'NOT_FOUND';end if;
 if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 context:=app_private.booking_begin(actor,'commit_group_amendment',jsonb_build_object('amendment_id',p_amendment_id,'expected_version',p_expected_version),p_idempotency_key);
 if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 select array_agg(id order by id) into seat_ids from app_private.enrollments where occurrence_id=p.occurrence_id;
 perform app_private.booking_lock_financial_scope(app_private.booking_financial_scope(seat_ids,'{}'));
 select * into p from app_private.operation_proposals where id=p.id for update;select * into g from app_private.group_amendments where id=p.id;select * into o from app_private.occurrences where id=p.occurrence_id;
 if p.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if not coalesce(app_private.booking_proposal_fresh(p.id),false) then raise exception 'VERSION_CONFLICT';end if;
 if o.state not in('forming','confirmed') then raise exception 'STATE_CONFLICT';end if;
 if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;

 select * into policy from app_private.policy_versions where id=g.replacement_policy_version_id;
 if policy.status not in('approved','published') or policy.effective_at>now() or policy.pricing_version_id<>g.pricing_version_id then raise exception 'POLICY_INCOMPLETE';end if;
 perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
 select * into fee from finance_private.tutor_fee_agreements where id=(select fee_agreement_id from finance_private.operation_tutor_terms where proposal_id=p.id);
 fee_basis:=app_private.booking_amendment_fee_basis(o.id,fee.id,policy.id,g.target_tier,cardinality(g.add_learner_ids)>0,cardinality(g.remove_enrollment_ids)>0);
 if fee_basis<>coalesce((select terms->>'fee_basis' from finance_private.operation_tutor_terms where proposal_id=p.id),'replacement_tier_agreement') then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.require_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor');
 perform app_private.booking_assert_schedule(o.tutor_id,o.start_at,o.end_at,o.id);
 if(select count(*) from app_private.operation_customer_terms where proposal_id=p.id and not(enrollment_id=any(g.remove_enrollment_ids)))<>g.target_tier then raise exception 'CAPACITY_CONFLICT';end if;
 -- Removed financial snapshots must still match before any posting.
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  if not(financial.enrollment_id=any(g.remove_enrollment_ids)) then raise exception 'CONSENT_REQUIRED';end if;
  current_snapshot:=finance_private.finance_cancellation_snapshot(financial.enrollment_id,financial.snapshot->>'remedy',false,case when financial.snapshot?'package_disposition' then jsonb_build_object('enrollment_id',financial.enrollment_id,'released_credit_quanta',financial.snapshot->'package_disposition'->'released_credit_quanta','extinguished_credit_quanta',financial.snapshot->'package_disposition'->'extinguished_credit_quanta') else null end);
  if app_private.catalog_hash(current_snapshot)<>financial.snapshot_hash then raise exception 'VERSION_CONFLICT';end if;
 end loop;
 if(select count(*) from finance_private.cancellation_customer_finances where proposal_id=p.id)<>cardinality(g.remove_enrollment_ids) then raise exception 'CONSENT_REQUIRED';end if;
 -- Validate every participant before any source or obligation is consumed.
 for ct in select * from app_private.operation_customer_terms where proposal_id=p.id and not(enrollment_id=any(g.remove_enrollment_ids)) order by enrollment_id loop
  basis:=app_private.booking_amendment_financial_basis(p.id,ct.enrollment_id);if not coalesce((basis->>'eligible')::boolean,false) then raise exception 'INSUFFICIENT_FUNDS';end if;
 end loop;
 -- Approval and all effects become visible only at this transaction's commit.
 update app_private.operation_proposals set state='approved',approved_by=actor,approved_at=now() where id=p.id;
 for financial in select * from finance_private.cancellation_customer_finances where proposal_id=p.id order by enrollment_id loop
  financial_effect:=app_private.booking_apply_cancellation_financial_effect(p.id,financial.enrollment_id,context);
  adjustments:=adjustments||array(select value::uuid from jsonb_array_elements_text(financial_effect->'charge_adjustment_ids'));
 end loop;
 for ct in select * from app_private.operation_customer_terms where proposal_id=p.id and not(enrollment_id=any(g.remove_enrollment_ids)) order by enrollment_id loop
  select * into e from app_private.enrollments where id=ct.enrollment_id;select * into q from app_private.quotes where id=ct.proposed_quote_id;select * into oldq from app_private.quotes where id=ct.source_quote_id;select * into c from finance_private.charges where enrollment_id=e.id;
  select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=ct.learner_id and terms_hash=ct.terms_hash;
  select * into r from app_private.package_reservations where enrollment_id=e.id and state in('reserved','partially_consumed','consumed') order by created_at desc limit 1;
  basis:=app_private.booking_amendment_financial_basis(p.id,e.id);delta:=case when basis->>'conditional_amendment_id'=p.id::text then 0 else q.customer_price_minor-oldq.customer_price_minor end;
  if r.id is not null and r.coverage_rule='named_entitlement_covers_eligible_occurrence' then
   current_credit:=finance_private.finance_named_coverage_remaining(r.id);desired_credit:=q.customer_price_minor-r.agreed_top_up_minor;if desired_credit<0 then raise exception 'POLICY_INCOMPLETE';end if;named_difference:=desired_credit-current_credit;
   if named_difference<0 then adjustments:=adjustments||finance_private.finance_reduce_named_coverage(r.id,-named_difference,context,'amendment-named:'||p.id||':'||e.id);end if;
  else named_difference:=0;end if;
  if delta<>0 then result:=finance_private.finance_adjust_charge(c.id,delta,'commercial','group_amendment',p.id,now(),'Accepted replacement group tuition',context,'amendment-price:'||e.id);adjustments:=array_append(adjustments,(result->>'adjustment_id')::uuid);end if;
  if named_difference>0 then result:=finance_private.finance_adjust_charge(c.id,-named_difference,case when r.reserved_credit_quanta>=r.required_credit_quanta then 'named_coverage' else 'partial_named_coverage' end,'package_reservation',r.id,now(),'Accepted replacement named service coverage',context,'amendment-named:'||e.id);adjustments:=array_append(adjustments,(result->>'adjustment_id')::uuid);end if;
  if(basis->>'reserved_future_minor')::bigint>0 then perform finance_private.finance_commit_amendment_funding(p.id,e.id,c.id,context);end if;
  insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash,accepted_at,acceptance_basis,source_proposal_acceptance_id,source_terms_hash) values(q.id,acceptance.actor_account_id,e.learner_id,q.terms_hash,acceptance.accepted_at,'operation_proposal',acceptance.id,ct.terms_hash);
  if r.id is not null then insert into app_private.package_coverage_quote_links(reservation_id,quote_id,proposal_acceptance_id,command_id) values(r.id,q.id,acceptance.id,(context->>'command_id')::uuid);end if;
  update finance_private.charge_accounts set commitment_state='committed',conditional_amendment_id=null,version=version+1,updated_at=now() where charge_id=c.id;
  roster:=roster||jsonb_build_array(jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'quote_id',q.id,'quote_hash',q.terms_hash,'customer_price_minor',q.customer_price_minor,'currency',q.currency,'charge_id',c.id,'net_charge_minor',basis->'proposed_net_minor','coverage_reservation_id',r.id));
 end loop;
 update app_private.enrollments en set current_quote_id=terms.proposed_quote_id,state='confirmed',hold_kind='ordinary',amendment_id=null,version=en.version+1,updated_at=now() from app_private.operation_customer_terms terms where terms.proposal_id=p.id and terms.enrollment_id=en.id and not(en.id=any(g.remove_enrollment_ids));
 update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where id=any(g.remove_enrollment_ids);
 update finance_private.charge_accounts set commitment_state='committed',conditional_amendment_id=null,version=version+1,updated_at=now() where charge_id in(select id from finance_private.charges where enrollment_id=any(g.remove_enrollment_ids));
 update app_private.booking_financial_resolutions set state='resolved' where enrollment_id=any(g.remove_enrollment_ids) and state='open';
 update app_private.occurrences set state='confirmed',target_tier=g.target_tier,pricing_version_id=g.pricing_version_id,policy_version_id=g.replacement_policy_version_id,current_fee_agreement_id=fee.id,quote_terms_version=quote_terms_version+1,version=version+1,meeting_status='pending',updated_at=now() where id=o.id returning * into o;
 insert into app_private.booking_commitments(occurrence_id,occurrence_version,kind,pricing_version_id,policy_version_id,fee_agreement_id,target_tier,roster,command_id) values(o.id,o.version,'amendment',o.pricing_version_id,o.policy_version_id,fee.id,o.target_tier,roster,(context->>'command_id')::uuid);
 update app_private.operation_proposals set state='committed',version=version+1,approved_by=actor,approved_at=now(),committed_at=now(),updated_at=now() where id=p.id returning operation_proposals.version into final_version;
 insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,app_private.booking_proposal_admin_hash(p.id),'approved',actor,'Atomic commit of exact accepted and funded group amendment');
 perform app_private.enqueue_event(gen_random_uuid(),'group_amendment_committed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'calendar.sync');
 return app_private.booking_finish(context,p.id,final_version,jsonb_build_object('occurrence_version',o.version,'charge_adjustment_ids',adjustments),'group_amendment_committed',jsonb_build_object('amendment_id',p.id,'occurrence_id',o.id));
end $$;
create or replace function app_private.booking_proposal_dto(p_actor uuid,p_id uuid,p_view text,p_learner_id uuid,p_group boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;learner uuid;
begin
 result:=app_private.booking_proposal_dto_before_financial_scope(p_actor,p_id,p_view,p_learner_id,p_group);
 if p_view='customer' and exists(select 1 from finance_private.cancellation_customer_finances where proposal_id=p_id and enrollment_id=(result->'terms'->>'enrollment_id')::uuid) then
  learner:=(result->'terms'->>'learner_id')::uuid;
  perform app_private.assert_learner_scope(p_actor,learner,'booking');
  perform app_private.assert_learner_scope(p_actor,learner,'payments');
 end if;
 return result;
end $$;
create or replace function app_private.booking_proposal_participant(p_actor uuid,p_id uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=app_private.booking_proposal_participant_before_financial_scope(p_actor,p_id,p_hash);
 if result->>'type'='learner' and exists(select 1 from finance_private.cancellation_customer_finances f join app_private.operation_customer_terms c on c.proposal_id=f.proposal_id and c.enrollment_id=f.enrollment_id where f.proposal_id=p_id and c.learner_id=(result->>'id')::uuid) then
  perform app_private.assert_learner_scope(p_actor,(result->>'id')::uuid,'payments');
 end if;
 return result;
end $$;
create or replace function app_private.booking_proposal_all_accepted(p_id uuid,p_recheck boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare accepted record;
begin
 if not app_private.booking_proposal_all_accepted_before_financial_scope(p_id,p_recheck) then return false;end if;
 if p_recheck and exists(select 1 from finance_private.cancellation_customer_finances where proposal_id=p_id) then
  for accepted in
   select a.actor_account_id,c.learner_id
   from app_private.operation_customer_terms c join finance_private.cancellation_customer_finances f on f.proposal_id=c.proposal_id and f.enrollment_id=c.enrollment_id
   join app_private.operation_proposal_acceptances a
     on a.proposal_id=c.proposal_id and a.participant_type='learner'
    and a.participant_id=c.learner_id and a.terms_hash=c.terms_hash
   where c.proposal_id=p_id order by c.learner_id
  loop
   -- The delegated recheck already validates active verified actors and booking scope.
   -- Lock current payment relationships too before approval or any financial posting.
   perform app_private.assert_learner_scope(accepted.actor_account_id,accepted.learner_id,'payments');
  end loop;
 end if;
 return true;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='app_private' and p.proname in('booking_apply_cancellation_financial_effect','booking_amendment_fee_basis','propose_group_amendment_before_removal','booking_consume_cancellation')) or(n.nspname='api' and p.proname in('propose_group_amendment','commit_group_amendment'))
 loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
