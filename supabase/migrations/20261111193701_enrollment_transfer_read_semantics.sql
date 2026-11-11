grant create on schema api,app_private,finance_private to git_tutor_commands;
create function app_private.enrollment_transfer_authority_current(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from app_private.enrollment_transfer_reviews r join app_private.operation_proposals p on p.id=r.proposal_id
 join app_private.enrollments e on e.id=r.source_enrollment_id join app_private.occurrences source on source.id=e.occurrence_id join app_private.occurrences destination on destination.id=r.destination_occurrence_id
 join finance_private.enrollment_transfer_fee_bindings f on f.proposal_id=r.proposal_id
 join finance_private.tutor_fee_agreements sf on sf.id=f.source_fee_agreement_id join finance_private.tutor_fee_agreements df on df.id=f.destination_fee_agreement_id
 join finance_private.cancellation_compensation_terms ct on ct.proposal_id=r.proposal_id
 where r.proposal_id=p_id and(not app_private.has_role(sf.approved_by,'admin') or not app_private.payment_verified_account(sf.approved_by)
 or not app_private.has_role(df.approved_by,'admin') or not app_private.payment_verified_account(df.approved_by)
 or not app_private.has_role(ct.reviewed_by,'admin') or not app_private.payment_verified_account(ct.reviewed_by)
 or(p.approved_by is not null and(not app_private.has_role(p.approved_by,'admin') or not app_private.payment_verified_account(p.approved_by)))
 or not app_private.has_role((select account_id from app_private.tutors where id=source.tutor_id),'tutor') or not app_private.payment_verified_account((select account_id from app_private.tutors where id=source.tutor_id))
 or not app_private.has_role((select account_id from app_private.tutors where id=destination.tutor_id),'tutor') or not app_private.payment_verified_account((select account_id from app_private.tutors where id=destination.tutor_id))))
 and not exists(select 1 from app_private.operation_proposal_acceptances a where a.proposal_id=p_id and(not app_private.payment_verified_account(a.actor_account_id)
 or(a.participant_type='learner' and(not app_private.booking_can_access(a.actor_account_id,a.participant_id) or not(exists(select 1 from app_private.learners where id=a.participant_id and account_id=a.actor_account_id) or exists(select 1 from app_private.guardian_links where learner_id=a.participant_id and guardian_account_id=a.actor_account_id and revoked_at is null and valid_from<=now() and valid_until>now() and 'payments'=any(scopes)))))
 or(a.participant_type='tutor' and not exists(select 1 from app_private.tutors t where t.id=a.participant_id and t.account_id=a.actor_account_id and app_private.has_role(a.actor_account_id,'tutor')))))
$$;

create or replace function app_private.enrollment_transfer_funding(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;c finance_private.charges%rowtype;q app_private.quotes%rowtype;b jsonb;required bigint;posted bigint:=0;accepted bigint:=0;total integer;count_accepted integer;clear boolean;active boolean;additional bigint;begin
 select * into r from app_private.enrollment_transfer_reviews where proposal_id=p_id;if r.proposal_id is null then return null;end if;
 select * into q from app_private.quotes where id=r.destination_quote_id;select * into c from finance_private.charges where enrollment_id=r.destination_enrollment_id;
 required:=app_private.booking_deposit(q.customer_price_minor,app_private.policy_content(q.policy_version_id));clear:=app_private.enrollment_transfer_source_current(p_id);active:=app_private.booking_proposal_fresh(p_id);
 if c.id is not null then
  b:=finance_private.finance_charge_balance(c.id);clear:=clear and b->>'reconciliation_state'='clear';required:=app_private.booking_deposit((b->>'commercial_net_minor')::bigint,app_private.policy_content(q.policy_version_id));
  select coalesce(sum(a.amount_minor-coalesce((select sum(amount_minor) from finance_private.allocation_reversals where allocation_id=a.id),0)),0) into posted from finance_private.payment_allocations a where charge_id=c.id and enrollment_transfer_consent_id is null;
 end if;
 select count(distinct b.payer_account_id) into total from finance_private.enrollment_transfer_carryovers x join finance_private.transfer_payer_bindings b on b.id=x.payer_binding_id where x.proposal_id=p_id;
 select count(*),coalesce(sum((terms->>'carryover_minor')::bigint),0) into count_accepted,accepted from app_private.enrollment_transfer_consents where proposal_id=p_id and(state='consumed' or(state='accepted' and expires_at>now()));
 if not clear then accepted:=0;count_accepted:=0;end if;
 additional:=case when exists(select 1 from app_private.enrollment_transfer_commits where proposal_id=p_id) then greatest(0,required-coalesce((b->>'allocated_cash_minor')::bigint,0)-coalesce((b->>'allocated_package_value_minor')::bigint,0)) else greatest(0,required-posted-r.planned_carryover_minor) end;
 return jsonb_build_object('destination_charge_id',c.id,'required_for_confirmation_minor',required,'planned_carryover_minor',r.planned_carryover_minor,'accepted_carryover_minor',accepted,'posted_additional_minor',posted,'additional_required_minor',additional,'carryover_required_count',total,'carryover_accepted_count',count_accepted,'can_receive_additional_payment',c.id is not null and active and clear and posted<q.customer_price_minor-r.planned_carryover_minor,'reconciliation_state',case when clear then 'clear' else 'requires_review' end);
end $$;

create function finance_private.enrollment_transfer_cash_preview(p_enrollment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c finance_private.charges%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;q app_private.quotes%rowtype;policy jsonb;b jsonb;basis integer;retained bigint;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;select * into o from app_private.occurrences where id=e.occurrence_id;select * into q from app_private.quotes where id=e.current_quote_id;select * into c from finance_private.charges where enrollment_id=e.id;
 if c.id is null then return jsonb_build_object('charge_id',null,'release_cash_minor',0);end if;
 policy:=app_private.policy_content(q.policy_version_id);b:=finance_private.finance_charge_balance(c.id);
 select(value->>'refund_basis_points')::int into basis from jsonb_array_elements(policy->'customer_cancellation_windows') where extract(epoch from(o.start_at-now()))/60>=(value->>'minimum_minutes_before_start')::numeric and(value->>'maximum_minutes_before_start_exclusive' is null or extract(epoch from(o.start_at-now()))/60<(value->>'maximum_minutes_before_start_exclusive')::numeric);
 if basis is null or b->>'reconciliation_state'<>'clear' then return jsonb_build_object('charge_id',c.id,'release_cash_minor',0);end if;
 retained:=(b->>'commercial_net_minor')::bigint-floor((b->>'commercial_net_minor')::numeric*basis/10000)::bigint;
 -- Guaranteed lower bound: no package units or value are assumed released/extinguished.
 return jsonb_build_object('charge_id',c.id,'release_cash_minor',greatest(0,(b->>'allocated_cash_minor')::bigint-retained));
end $$;


create or replace function app_private.enrollment_transfer_blockers(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;f jsonb;result jsonb:='[]';begin
 select * into p from app_private.operation_proposals where id=p_id;
 if not exists(select 1 from app_private.enrollment_transfer_reviews where proposal_id=p_id) then return '["REVIEW_REQUIRED"]';end if;
 if not app_private.booking_proposal_fresh(p_id) then result:=result||'"STALE_TERMS"'::jsonb;end if;
 if not app_private.booking_proposal_all_accepted(p_id,false) then result:=result||'"CONSENT_REQUIRED"'::jsonb;end if;
 if not app_private.enrollment_transfer_authority_current(p_id) then result:=result||'"CONSENT_REQUIRED"'::jsonb;end if;
 if p.state<>'approved' then result:=result||'"ADMIN_APPROVAL_REQUIRED"'::jsonb;end if;
 f:=app_private.enrollment_transfer_funding(p_id);
 if f->>'reconciliation_state'<>'clear' then result:=result||'"RECONCILIATION_REQUIRED"'::jsonb;end if;
 if f->'carryover_required_count'<>f->'carryover_accepted_count' then result:=result||'"PAYER_CONSENT_REQUIRED"'::jsonb;end if;
 if f->>'destination_charge_id' is null or(f->>'posted_additional_minor')::bigint+(f->>'accepted_carryover_minor')::bigint<(f->>'required_for_confirmation_minor')::bigint then result:=result||'"INSUFFICIENT_FUNDS"'::jsonb;end if;
 return result;
end $$;

create or replace function app_private.enrollment_transfer_sources_page(p_id uuid,p_cursor text,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;rows jsonb;source uuid;after_id uuid;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then begin after_id:=p_cursor::uuid;exception when invalid_text_representation then raise exception 'VALIDATION_ERROR';end;end if;
 select target_id into source from app_private.operation_proposals where id=p_id;
 select f.snapshot into snapshot from finance_private.cancellation_customer_finances f where proposal_id=p_id;
 if snapshot is null then snapshot:=finance_private.enrollment_transfer_cash_preview(source);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'data',jsonb_build_object('allocation_id',a.id,'transfer_id',a.transfer_id,'source_reference',t.external_id,'payer_masked_label',app_private.payment_payer_dto(b.payer_account_id)->>'masked_contact','releasable_minor',(part->>'releasable_minor')::bigint,'selected_carryover_minor',coalesce((select amount_minor from finance_private.enrollment_transfer_carryovers where proposal_id=p_id and allocation_id=a.id),0),'currency','EGP')) order by a.id),'[]') into rows
 from (select value part from jsonb_array_elements(finance_private.enrollment_transfer_source_portions((snapshot->>'charge_id')::uuid,(snapshot->>'release_cash_minor')::bigint)) where after_id is null or(value->>'allocation_id')::uuid>after_id order by(value->>'allocation_id')::uuid limit p_limit+1)x
 join finance_private.payment_allocations a on a.id=(x.part->>'allocation_id')::uuid join finance_private.incoming_transfers t on t.id=a.transfer_id join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id;
 return jsonb_build_object('items',coalesce((select jsonb_agg(value->'data' order by ordinality) from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit),'[]'),'next_cursor',case when jsonb_array_length(rows)>p_limit then rows->(p_limit-1)->>'id' else null end);
end $$;

create or replace function api.review_enrollment_transfer_proposal(p_proposal_id uuid,p_source_tutor_fee_minor bigint,p_carryover_allocations jsonb,p_reason text,p_expected_version integer,p_idempotency_key text,p_source_package_disposition jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
 snapshot:=finance_private.finance_cancellation_snapshot(source.id,'policy_default',false,p_source_package_disposition);
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
 jsonb_build_object('target_type','enrollment','destination_occurrence_id',destination.id,'expires_at',expiry,'remedy',snapshot->>'remedy'),expiry,actor,p_reason) returning * into p;
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

create or replace function api.get_enrollment_transfer_proposal(p_proposal_id uuid,p_view text,p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();p app_private.operation_proposals%rowtype;r app_private.enrollment_transfer_reviews%rowtype;e app_private.enrollments%rowtype;c app_private.operation_customer_terms%rowtype;t finance_private.operation_tutor_terms%rowtype;h text;accepted timestamptz;ready boolean;customer jsonb;result jsonb;actions jsonb:='[]';funding jsonb;blockers jsonb;destination uuid;name text;terms jsonb;begin
 select * into p from app_private.operation_proposals where id=p_proposal_id;if p.id is null or p.kind<>'reschedule' or p.target_type<>'enrollment' then raise exception 'NOT_FOUND';end if;
 select * into e from app_private.enrollments where id=p.target_id;select * into r from app_private.enrollment_transfer_reviews where proposal_id=p.id;select * into c from app_private.operation_customer_terms where proposal_id=p.id and learner_id=e.learner_id;select * into t from finance_private.operation_tutor_terms where proposal_id=p.id;
 if p_view='admin' then perform app_private.require_role(actor,'admin');h:=app_private.booking_proposal_admin_hash(p.id);
 elsif p_view='customer' then if p_learner_id is not null and p_learner_id<>e.learner_id then raise exception 'NOT_FOUND';end if;perform app_private.assert_learner_scope(actor,e.learner_id,'booking');perform app_private.assert_learner_scope(actor,e.learner_id,'payments');h:=c.terms_hash;select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=e.learner_id;
 elsif p_view='tutor' then perform app_private.require_role(actor,'tutor');if not exists(select 1 from app_private.tutors where id=t.tutor_id and account_id=actor) then raise exception 'NOT_FOUND';end if;h:=t.terms_hash;select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='tutor' and participant_id=t.tutor_id;
 else raise exception 'VALIDATION_ERROR';end if;
 ready:=r.proposal_id is not null and app_private.booking_proposal_fresh(p.id) and app_private.enrollment_transfer_authority_current(p.id);funding:=app_private.enrollment_transfer_funding(p.id);blockers:=app_private.enrollment_transfer_blockers(p.id);
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
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','app_private','finance_private') and p.proname=any(array['enrollment_transfer_authority_current','enrollment_transfer_funding','enrollment_transfer_cash_preview','enrollment_transfer_blockers','enrollment_transfer_sources_page','review_enrollment_transfer_proposal','get_enrollment_transfer_proposal']) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;revoke create on schema api,app_private,finance_private from git_tutor_commands;notify pgrst,'reload schema';
