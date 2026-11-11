grant create on schema api,app_private,finance_private to git_tutor_commands;
create function finance_private.finance_named_coverage_remaining(p_reservation_id uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(-a.signed_minor-coalesce((select sum(i.signed_minor) from finance_private.charge_adjustments i where i.original_adjustment_id=a.id),0)),0)::bigint from finance_private.charge_adjustments a where a.domain_source_type='package_reservation' and a.domain_source_id=p_reservation_id and a.kind in('named_coverage','partial_named_coverage') and a.signed_minor<0
$$;
create function finance_private.finance_reduce_named_coverage(p_reservation_id uuid,p_amount_minor bigint,p_context jsonb,p_line_key text) returns uuid[] language plpgsql security definer set search_path='' as $$
declare a record;left_minor bigint:=p_amount_minor;take bigint;result jsonb;ids uuid[]:='{}';begin
 if p_amount_minor<0 or p_amount_minor>finance_private.finance_named_coverage_remaining(p_reservation_id) then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 for a in select x.id,x.charge_id,-x.signed_minor-coalesce((select sum(i.signed_minor) from finance_private.charge_adjustments i where i.original_adjustment_id=x.id),0) remaining from finance_private.charge_adjustments x where x.domain_source_type='package_reservation' and x.domain_source_id=p_reservation_id and x.kind in('named_coverage','partial_named_coverage') and x.signed_minor<0 order by x.created_at,x.id loop
  exit when left_minor=0;if a.remaining<=0 then continue;end if;take:=least(left_minor,a.remaining);
  result:=finance_private.finance_adjust_charge(a.charge_id,take,'linked_inverse','named_coverage_revision',a.id,now(),'Referenced revision of the accepted named coverage',p_context,p_line_key||':'||a.id);ids:=array_append(ids,(result->>'adjustment_id')::uuid);left_minor:=left_minor-take;
 end loop;
 if left_minor<>0 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;return ids;
end $$;
create table app_private.package_coverage_quote_links(id uuid primary key default gen_random_uuid(),reservation_id uuid not null references app_private.package_reservations(id),quote_id uuid not null references app_private.quotes(id),proposal_acceptance_id uuid not null references app_private.operation_proposal_acceptances(id),command_id uuid not null,created_at timestamptz not null default now(),unique(reservation_id,quote_id));
alter table app_private.package_coverage_quote_links enable row level security;
grant select,insert on app_private.package_coverage_quote_links to git_tutor_commands;
create policy commands_access on app_private.package_coverage_quote_links to git_tutor_commands using(true) with check(true);
revoke all on app_private.package_coverage_quote_links from public,anon,authenticated,service_role,git_tutor_worker;
create or replace function api.commit_group_amendment(p_amendment_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=app_private.require_actor();context jsonb;p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;o app_private.occurrences%rowtype;ct app_private.operation_customer_terms%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;oldq app_private.quotes%rowtype;c finance_private.charges%rowtype;fee finance_private.tutor_fee_agreements%rowtype;policy app_private.policy_versions%rowtype;acceptance app_private.operation_proposal_acceptances%rowtype;r app_private.package_reservations%rowtype;basis jsonb;result jsonb;roster jsonb:='[]';adjustments uuid[]:='{}';seat_ids uuid[];delta bigint;current_credit bigint;desired_credit bigint;named_difference bigint;final_version integer;begin
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
 if cardinality(g.remove_enrollment_ids)>0 then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 select * into policy from app_private.policy_versions where id=g.replacement_policy_version_id;
 if policy.status not in('approved','published') or policy.effective_at>now() or policy.pricing_version_id<>g.pricing_version_id then raise exception 'POLICY_INCOMPLETE';end if;
 perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
 select * into fee from finance_private.tutor_fee_agreements where id=(select fee_agreement_id from finance_private.operation_tutor_terms where proposal_id=p.id);
 if fee.id is null or fee.occurrence_id<>o.id or fee.tutor_id<>o.tutor_id or fee.target_tier<>g.target_tier or fee.duration_minutes<>o.duration_minutes or fee.pricing_version_id<>g.pricing_version_id or fee.base_occurrence_version<>o.version then raise exception 'POLICY_INCOMPLETE';end if;
 perform app_private.require_role(fee.approved_by,'admin');perform app_private.require_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor');
 perform app_private.assert_exact_tutor_fee(fee.pricing_version_id,fee.target_tier,fee.fee_minor,fee.currency,fee.duration_minutes);perform app_private.booking_assert_schedule(o.tutor_id,o.start_at,o.end_at,o.id);
 if(select count(*) from app_private.operation_customer_terms where proposal_id=p.id)<>g.target_tier then raise exception 'CAPACITY_CONFLICT';end if;
 -- Validate every participant before any source or obligation is consumed.
 for ct in select * from app_private.operation_customer_terms where proposal_id=p.id order by enrollment_id loop
  basis:=app_private.booking_amendment_financial_basis(p.id,ct.enrollment_id);if not coalesce((basis->>'eligible')::boolean,false) then raise exception 'INSUFFICIENT_FUNDS';end if;
 end loop;
 for ct in select * from app_private.operation_customer_terms where proposal_id=p.id order by enrollment_id loop
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
 update app_private.enrollments en set current_quote_id=terms.proposed_quote_id,state='confirmed',hold_kind='ordinary',amendment_id=null,version=en.version+1,updated_at=now() from app_private.operation_customer_terms terms where terms.proposal_id=p.id and terms.enrollment_id=en.id;
 update app_private.occurrences set state='confirmed',target_tier=g.target_tier,pricing_version_id=g.pricing_version_id,policy_version_id=g.replacement_policy_version_id,current_fee_agreement_id=fee.id,quote_terms_version=quote_terms_version+1,version=version+1,meeting_status='pending',updated_at=now() where id=o.id returning * into o;
 insert into app_private.booking_commitments(occurrence_id,occurrence_version,kind,pricing_version_id,policy_version_id,fee_agreement_id,target_tier,roster,command_id) values(o.id,o.version,'amendment',o.pricing_version_id,o.policy_version_id,fee.id,o.target_tier,roster,(context->>'command_id')::uuid);
 update app_private.operation_proposals set state='committed',version=version+1,approved_by=actor,approved_at=now(),committed_at=now(),updated_at=now() where id=p.id returning operation_proposals.version into final_version;
 insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,app_private.booking_proposal_admin_hash(p.id),'approved',actor,'Atomic commit of exact accepted and funded group amendment');
 perform app_private.enqueue_event(gen_random_uuid(),'group_amendment_committed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'calendar.sync');
 return app_private.booking_finish(context,p.id,final_version,jsonb_build_object('occurrence_version',o.version,'charge_adjustment_ids',adjustments),'group_amendment_committed',jsonb_build_object('amendment_id',p.id,'occurrence_id',o.id));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname in('finance_named_coverage_remaining','finance_reduce_named_coverage')) or(n.nspname='api' and p.proname='commit_group_amendment') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';

