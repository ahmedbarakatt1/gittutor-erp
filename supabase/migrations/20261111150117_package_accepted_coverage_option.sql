-- Selection exposes only a current qualifying exact proposal, reusing the authoritative consumption gate.
create or replace function api.get_package_coverage_options(p_enrollment_id uuid,p_package_id uuid default null,p_credit_quanta bigint default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();seat app_private.enrollments%rowtype;occ app_private.occurrences%rowtype;q app_private.quotes%rowtype;p app_private.package_purchases%rowtype;preview jsonb;summary jsonb;rows jsonb:='[]';coverage uuid;after_at timestamptz;after_id uuid;available numeric;requested bigint:=coalesce(p_credit_quanta,1000);candidate uuid;accepted jsonb;begin
 select * into seat from app_private.enrollments where id=p_enrollment_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform app_private.package_assert_scope(actor,seat.learner_id,'booking',true);perform app_private.package_assert_scope(actor,seat.learner_id,'payments',true);
 if p_limit is null or p_limit not between 1 and 100 or requested not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;end if;
 occ:=app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=p_enrollment_id for update;select * into q from app_private.quotes where id=seat.current_quote_id;
 perform app_private.package_lock_learner(seat.learner_id);
 if p_package_id is not null and not exists(select 1 from app_private.package_purchases where id=p_package_id and learner_id=seat.learner_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select id into coverage from app_private.package_reservations where enrollment_id=seat.id and state in('reserved','partially_consumed');
 for p in select * from app_private.package_purchases where learner_id=seat.learner_id and purchase_state<>'cancelled' and(p_package_id is null or id=p_package_id) and(p_cursor is null or(created_at,id)<(after_at,after_id)) order by created_at desc,id desc limit p_limit+1 loop
  preview:=app_private.package_coverage_quote(p.id,seat.id,requested);summary:=app_private.package_summary(p.id,actor);
  select coalesce(sum((balances->>'available_credit_quanta')::numeric),0) into available from app_private.package_lots where purchase_id=p.id and(expires_at is null or expires_at>greatest(now(),occ.start_at));
  accepted:=null;
  if (preview->>'eligible')::boolean and (preview->>'requires_proposal')::boolean then
   for candidate in select h.id from app_private.operation_proposals h join app_private.package_operation_terms t on t.proposal_id=h.id where h.kind='package_coverage' and h.target_id=seat.id and h.state in('accepted','approved') and h.expires_at>now() and t.source_purchase_id=p.id and t.source_purchase_version=p.version and(t.customer_terms->>'reserved_credit_quanta')::bigint=requested order by h.created_at desc,h.id desc loop
    begin accepted:=app_private.package_validate_coverage_proposal(candidate,actor,p.id,seat.id,requested);exit;
    exception when raise_exception then if sqlerrm not in('CONSENT_REQUIRED','VERSION_CONFLICT','FORBIDDEN','NOT_FOUND','WINDOW_CLOSED','STATE_CONFLICT') then raise;end if;accepted:=null;end;
   end loop;
   if accepted is not null then preview:=preview||jsonb_build_object('terms',accepted->'terms','reason','ELIGIBLE');end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',p.id,'at',p.created_at,'data',jsonb_build_object('package_purchase_id',p.id,'version',p.version,'title',summary->>'title','contract_version_id',p.contract_version_id,'coverage_rule',p.contract_snapshot->>'coverage_rule','available_credit_quanta',available,'required_credit_quanta',1000,'requested_credit_quanta',requested,'max_reservable_credit_quanta',least(available,1000),'carrying_value_minor',preview#>'{terms,carrying_value_minor}','standalone_reference_price_minor',q.customer_price_minor,'agreed_top_up_minor',preview#>'{terms,agreed_top_up_minor}','eligible',(preview->>'eligible')::boolean,'reason',preview->>'reason','requires_proposal',(preview->>'requires_proposal')::boolean,'requires_admin_review',(preview->>'requires_admin_review')::boolean,'coverage_proposal_id',accepted->>'proposal_id')));
 end loop;return app_private.package_page(rows,p_limit)||jsonb_build_object('enrollment',jsonb_build_object('enrollment_id',seat.id,'version',seat.version,'learner_id',seat.learner_id,'quote_id',q.id,'quote_version',q.version,'quote_hash',q.terms_hash),'current_coverage',case when coverage is not null then app_private.package_coverage_dto(coverage) else null end);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;

notify pgrst,'reload schema';
