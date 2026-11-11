-- Evaluate financial basis only after the exact accepted proposal/enrollment joins.
create or replace function api.list_charge_amendment_funding_options(p_charge_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();charge finance_private.charges%rowtype;after_at timestamptz;after_id uuid;rows jsonb:='[]';candidate record;basis jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then
  if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;
  after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;
  if not isfinite(after_at) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 select * into charge from finance_private.charges where id=p_charge_id;
 if charge.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform app_private.package_assert_scope(actor,charge.learner_id,'payments',true);
 for candidate in
  select p.id,p.created_at,p.expires_at,e.id enrollment_id,g.target_tier
  from app_private.operation_proposals p
  join app_private.group_amendments g on g.id=p.id
  join app_private.operation_customer_terms t on t.proposal_id=p.id and t.enrollment_id=charge.enrollment_id and t.learner_id=charge.learner_id
  join app_private.enrollments e on e.id=t.enrollment_id and e.current_quote_id=t.source_quote_id
  join finance_private.charge_accounts a on a.charge_id=charge.id and a.conditional_amendment_id is null
  join app_private.operation_proposal_acceptances accepted on accepted.proposal_id=p.id and accepted.participant_type='learner' and accepted.participant_id=t.learner_id and accepted.terms_hash=t.terms_hash
  where p.kind='group_amendment' and p.state in('proposed','accepted','approved') and p.expires_at>now() and app_private.booking_proposal_fresh(p.id)
   and t.financial_terms_ready and not(e.id=any(g.remove_enrollment_ids))
   and app_private.payment_verified_account(accepted.actor_account_id) and app_private.booking_can_access(accepted.actor_account_id,t.learner_id)
   and(after_at is null or(p.created_at,p.id)<(after_at,after_id))
  order by p.created_at desc,p.id desc
 loop
  basis:=app_private.booking_amendment_financial_basis(candidate.id,candidate.enrollment_id);
  if basis->>'reason'='INSUFFICIENT_FUNDS' and basis->>'reconciliation_state'='clear'
   and(basis->>'positive_future_debit_minor')::bigint>0 and(basis->>'additional_required_minor')::bigint>0 then
   rows:=rows||jsonb_build_array(jsonb_build_object('at',candidate.created_at,'id',candidate.id,'data',jsonb_build_object('amendment_id',candidate.id,'enrollment_id',candidate.enrollment_id,'title','Revised group for '||candidate.target_tier::text||' students','additional_required_minor',basis->'additional_required_minor','expires_at',candidate.expires_at)));
   exit when jsonb_array_length(rows)>p_limit;
  end if;
 end loop;
 return app_private.package_page(rows,p_limit);
end $$;
notify pgrst,'reload schema';
