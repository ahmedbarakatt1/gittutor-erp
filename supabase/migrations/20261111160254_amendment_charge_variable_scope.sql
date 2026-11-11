create or replace function finance_private.finance_ensure_amendment_charge(p_amendment_id uuid,p_enrollment_id uuid,p_proposal_acceptance_id uuid,p_context jsonb) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;t app_private.operation_customer_terms%rowtype;a app_private.operation_proposal_acceptances%rowtype;q app_private.quotes%rowtype;charge_id uuid;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;
 select * into o from app_private.occurrences where id=e.occurrence_id;
 select * into p from app_private.operation_proposals where id=p_amendment_id;
 select * into g from app_private.group_amendments where id=p_amendment_id;
 select * into t from app_private.operation_customer_terms where proposal_id=p.id and enrollment_id=e.id;
 select * into a from app_private.operation_proposal_acceptances where id=p_proposal_acceptance_id;
 select * into q from app_private.quotes where id=t.proposed_quote_id;
 if e.id is null or p.id is null or g.id is null or e.hold_kind<>'amendment' or e.amendment_id is distinct from p.id or not(e.learner_id=any(g.add_learner_ids)) or e.state<>'held' or e.hold_expires_at<=now() then raise exception 'STATE_CONFLICT';end if;
 if a.proposal_id is distinct from p.id or a.participant_type is distinct from 'learner' or a.participant_id is distinct from e.learner_id or a.terms_hash is distinct from t.terms_hash or not t.financial_terms_ready or not app_private.booking_can_access(a.actor_account_id,e.learner_id) then raise exception 'CONSENT_REQUIRED';end if;
 if p.state not in('proposed','accepted') or p.expires_at<=now() or not app_private.booking_proposal_fresh(p.id) or e.current_quote_id is distinct from t.source_quote_id or q.enrollment_id is distinct from e.id or q.base_terms_version is distinct from o.quote_terms_version+1 or q.policy_version_id is distinct from g.replacement_policy_version_id or q.customer_price_minor is distinct from(t.terms->>'customer_price_minor')::bigint then raise exception 'VERSION_CONFLICT';end if;
 perform app_private.package_lock_learner(e.learner_id);
 select c.id into charge_id from finance_private.charges c where c.enrollment_id=e.id;
 if charge_id is not null then
  if not exists(select 1 from finance_private.charge_acceptance_sources s where s.charge_id=charge_id and s.proposal_acceptance_id=a.id and s.quote_id=q.id) then raise exception 'STATE_CONFLICT';end if;return charge_id;
 end if;
 charge_id:=finance_private.finance_issue_charge('enrollment',e.learner_id,a.actor_account_id,null,e.id,q.policy_version_id,a.terms_hash,q.customer_price_minor,p_context);
 update finance_private.charge_accounts set commitment_state='awaiting_amendment',conditional_amendment_id=p.id where finance_private.charge_accounts.charge_id=charge_id;
 insert into finance_private.charge_acceptance_sources(charge_id,source_kind,quote_id,proposal_id,proposal_acceptance_id,accepted_actor_account_id,accepted_at,accepted_terms_hash) values(charge_id,'amendment',q.id,p.id,a.id,a.actor_account_id,a.accepted_at,a.terms_hash);
 return charge_id;
end $$;
