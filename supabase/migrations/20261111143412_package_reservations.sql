-- T05 actual usable-lot coverage, explicit consent boundary and atomic hold-end release.
grant create on schema api,app_private to git_tutor_commands;
create function app_private.package_coverage_quote(p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase app_private.package_purchases%rowtype;seat app_private.enrollments%rowtype;occ app_private.occurrences%rowtype;quote app_private.quotes%rowtype;contract jsonb;allocations jsonb:='[]';terms jsonb;source_hash text;amount numeric;required bigint:=1000;top_up bigint;remaining bigint;reason text:='ELIGIBLE';requires_proposal boolean:=false;requires_review boolean:=false;begin
 select * into purchase from app_private.package_purchases where id=p_purchase_id;select * into seat from app_private.enrollments where id=p_enrollment_id;select * into occ from app_private.occurrences where id=seat.occurrence_id;select * into quote from app_private.quotes where id=seat.current_quote_id;contract:=purchase.contract_snapshot;
 if p_credit_quanta is null or p_credit_quanta not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 if purchase.id is null or seat.id is null or purchase.learner_id<>seat.learner_id or purchase.purchase_state='cancelled' or seat.state not in('held','confirmed') or(seat.state='held' and seat.hold_expires_at<=now()) or quote.expires_at<=now() or quote.base_terms_version<>occ.quote_terms_version then reason:='STATE_CONFLICT';
 elsif seat.hold_kind='amendment' then reason:='PROVISIONAL_ENROLLMENT';
 elsif not(contract->'eligible_offer_ids'?occ.offer_id::text) then reason:='OFFER_INELIGIBLE';
 elsif not(contract->'eligible_formats'?occ.format) then reason:='FORMAT_INELIGIBLE';
 elsif(contract->>'base_duration_minutes')::numeric<>occ.duration_minutes then reason:='DURATION_CONVERSION_REQUIRED';
 elsif not exists(select 1 from app_private.quote_acceptances a where a.quote_id=quote.id and app_private.booking_can_access(a.actor_account_id,seat.learner_id) and exists(select 1 from app_private.auth_account(a.actor_account_id) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now()))) then reason:='QUOTE_NOT_ACCEPTED';end if;
 if reason<>'ELIGIBLE' then return jsonb_build_object('terms',null,'allocations','[]'::jsonb,'source_hash',null,'requires_admin_review',false,'requires_proposal',false,'eligible',false,'reason',reason);end if;
 begin allocations:=app_private.package_allocate_available(p_purchase_id,p_credit_quanta,occ.start_at);exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ENTITLEMENT' then raise;end if;reason:='INSUFFICIENT_ENTITLEMENT';end;
 if reason<>'ELIGIBLE' then return jsonb_build_object('terms',null,'allocations','[]'::jsonb,'source_hash',null,'requires_admin_review',false,'requires_proposal',false,'eligible',false,'reason',reason);end if;
 select coalesce(sum((value->>'value_minor')::numeric),0) into amount from jsonb_array_elements(allocations);if amount>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 remaining:=required-p_credit_quanta;
 if contract->>'coverage_rule'='named_entitlement_covers_eligible_occurrence' then
  if remaining>0 then top_up:=null;requires_proposal:=true;requires_review:=true;reason:='PARTIAL_NAMED_REQUIRES_REVIEW';else top_up:=0;end if;
 else
  if amount>quote.customer_price_minor then return jsonb_build_object('terms',null,'allocations',allocations,'source_hash',null,'requires_admin_review',true,'requires_proposal',true,'eligible',false,'reason','STATE_CONFLICT');end if;
  top_up:=quote.customer_price_minor-amount;requires_proposal:=true;reason:='VALUE_TOP_UP_CONSENT_REQUIRED';
 end if;
 terms:=jsonb_build_object('learner_id',seat.learner_id,'enrollment_id',seat.id,'package_purchase_id',purchase.id,'quote_id',quote.id,'quote_hash',quote.terms_hash,'package_contract_version_id',purchase.contract_version_id,'coverage_rule',contract->>'coverage_rule','required_credit_quanta',required,'reserved_credit_quanta',p_credit_quanta,'carrying_value_minor',amount,'standalone_reference_price_minor',quote.customer_price_minor,'agreed_top_up_minor',top_up,'remaining_service_credit_quanta',remaining,'remaining_service_price_minor',case when remaining=0 then 0 else null end,'currency','EGP');
 source_hash:=app_private.catalog_hash(jsonb_build_object('purchase_id',purchase.id,'purchase_version',purchase.version,'enrollment_id',seat.id,'enrollment_version',seat.version,'quote_id',quote.id,'quote_hash',quote.terms_hash,'allocations',allocations));
 return jsonb_build_object('terms',terms,'allocations',allocations,'source_hash',source_hash,'requires_admin_review',requires_review,'requires_proposal',requires_proposal,'eligible',true,'reason',reason);
end $$;
create function app_private.package_reserve_allocations(p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_accepted_terms jsonb,p_context jsonb) returns app_private.package_reservations language plpgsql security definer set search_path='' as $$
declare preview jsonb;terms jsonb;allocation jsonb;seat app_private.enrollments%rowtype;reservation app_private.package_reservations%rowtype;allocation_id uuid;begin
 preview:=app_private.package_coverage_quote(p_purchase_id,p_enrollment_id,p_credit_quanta);
 if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
 if p_coverage_proposal_id is not null then
  if p_accepted_terms->>'source_hash' is distinct from preview->>'source_hash' or p_accepted_terms->'allocations' is distinct from preview->'allocations' or (p_accepted_terms->'terms'-array['agreed_top_up_minor','remaining_service_price_minor']) is distinct from(preview->'terms'-array['agreed_top_up_minor','remaining_service_price_minor']) then raise exception 'VERSION_CONFLICT';end if;
  terms:=p_accepted_terms->'terms';
 else if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;terms:=preview->'terms';end if;
 select * into seat from app_private.enrollments where id=p_enrollment_id;
 if exists(select 1 from app_private.package_reservations where enrollment_id=seat.id and state in('reserved','partially_consumed')) then raise exception 'STATE_CONFLICT';end if;
 insert into app_private.package_reservations(purchase_id,learner_id,enrollment_id,quote_id,quote_hash,coverage_rule,required_credit_quanta,reserved_credit_quanta,allocated_value_minor,agreed_top_up_minor,coverage_proposal_id,acceptance_refs,expires_at) values(p_purchase_id,seat.learner_id,seat.id,seat.current_quote_id,terms->>'quote_hash',terms->>'coverage_rule',(terms->>'required_credit_quanta')::bigint,p_credit_quanta,(terms->>'carrying_value_minor')::bigint,(terms->>'agreed_top_up_minor')::bigint,p_coverage_proposal_id,p_accepted_terms-array['terms','allocations'],least(seat.hold_expires_at,(select expires_at from app_private.quotes where id=seat.current_quote_id))) returning * into reservation;
 for allocation in select value from jsonb_array_elements(preview->'allocations') loop
  insert into app_private.package_reservation_allocations(reservation_id,lot_id,credit_quanta,value_minor) values(reservation.id,(allocation->>'lot_id')::uuid,(allocation->>'credit_quanta')::bigint,(allocation->>'value_minor')::bigint) returning id into allocation_id;
  perform app_private.package_append_movement((allocation->>'lot_id')::uuid,'reserve',jsonb_build_object('available_credit_quanta',-(allocation->>'credit_quanta')::bigint,'reserved_credit_quanta',(allocation->>'credit_quanta')::bigint,'available_value_minor',-(allocation->>'value_minor')::bigint,'reserved_value_minor',(allocation->>'value_minor')::bigint),jsonb_build_object('enrollment_id',seat.id,'reservation_id',reservation.id,'allocation_id',allocation_id,'credit_quanta',(allocation->>'credit_quanta')::bigint,'value_minor',(allocation->>'value_minor')::bigint,'from_bucket','available','to_bucket','reserved','customer_reason_code','booking_reservation'),p_context,'reserve:'||allocation_id);
 end loop;return reservation;
end $$;
create function app_private.package_release_reservation_kernel(p_reservation_id uuid,p_reason text,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation app_private.package_reservations%rowtype;allocation app_private.package_reservation_allocations%rowtype;lot app_private.package_lots%rowtype;q bigint;v bigint;totalq numeric:=0;totalv numeric:=0;destination text;movement uuid;ids uuid[]:='{}';begin
 select * into reservation from app_private.package_reservations where id=p_reservation_id for update;if reservation.id is null then raise exception 'NOT_FOUND';end if;
 if reservation.state not in('reserved','partially_consumed') then return jsonb_build_object('released_credit_quanta',0,'released_value_minor',0,'movement_ids',ids);end if;
 for allocation in select * from app_private.package_reservation_allocations where reservation_id=reservation.id order by lot_id,id loop
  select * into lot from app_private.package_lots where id=allocation.lot_id for update;
  select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0),coalesce(sum((delta->>'reserved_value_minor')::numeric),0) into q,v from app_private.entitlement_movements where allocation_id=allocation.id;
  if q=0 then continue;end if;destination:=case when lot.expires_at<=now() then 'expired' else 'available' end;
  movement:=app_private.package_append_movement(lot.id,'release',jsonb_build_object('reserved_credit_quanta',-q,'reserved_value_minor',-v,destination||'_credit_quanta',q,destination||'_value_minor',v),jsonb_build_object('enrollment_id',reservation.enrollment_id,'reservation_id',reservation.id,'allocation_id',allocation.id,'original_movement_id',(select id from app_private.entitlement_movements where allocation_id=allocation.id and kind='reserve' order by recorded_at,id limit 1),'credit_quanta',q,'value_minor',v,'from_bucket','reserved','to_bucket',destination,'customer_reason_code',p_reason),p_context,'release:'||allocation.id);
  ids:=array_append(ids,movement);totalq:=totalq+q;totalv:=totalv+v;
 end loop;
 update app_private.package_reservations set state='released',version=version+1,updated_at=now() where id=reservation.id;
 update app_private.package_purchases set version=version+1,updated_at=now() where id=reservation.purchase_id;
 return jsonb_build_object('released_credit_quanta',totalq,'released_value_minor',totalv,'movement_ids',ids);
end $$;
create function app_private.package_release_for_hold_end(p_enrollment_id uuid,p_reason text,p_command_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare row app_private.package_reservations%rowtype;result jsonb;ids uuid[]:='{}';begin
 for row in select * from app_private.package_reservations where enrollment_id=p_enrollment_id and state in('reserved','partially_consumed') order by purchase_id,id loop
  perform app_private.package_lock_purchase(row.purchase_id);result:=app_private.package_release_reservation_kernel(row.id,p_reason,p_command_context);
  ids:=ids||array(select value::uuid from jsonb_array_elements_text(result->'movement_ids'));
 end loop;return ids;end $$;
create function app_private.package_enrollment_end_release() returns trigger language plpgsql security definer set search_path='' as $$
declare learner uuid;row record;context jsonb:=jsonb_build_object('command_id',gen_random_uuid());ids uuid[];begin
 for learner in select distinct n.learner_id from ended_new n join ended_old o on o.id=n.id where o.state in('held','confirmed') and n.state in('expired','cancelled') order by n.learner_id loop perform app_private.package_lock_learner(learner);end loop;
 for row in select n.id,n.state from ended_new n join ended_old o on o.id=n.id join app_private.package_reservations r on r.enrollment_id=n.id and r.state in('reserved','partially_consumed') where o.state in('held','confirmed') and n.state in('expired','cancelled') order by n.learner_id,r.purchase_id,r.id loop
  ids:=app_private.package_release_for_hold_end(row.id,'booking_hold_ended',context);
  if cardinality(ids)>0 then insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,(context->>'command_id')::uuid,'package_hold_release',row.id,jsonb_build_object('actor_kind','system','movement_count',cardinality(ids)));end if;
 end loop;return null;end $$;
create trigger package_hold_end_release after update on app_private.enrollments referencing old table as ended_old new table as ended_new for each statement execute function app_private.package_enrollment_end_release();
create function api.reserve_package_credit(p_package_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;seat app_private.enrollments%rowtype;purchase app_private.package_purchases%rowtype;preview jsonb;accepted jsonb;reservation app_private.package_reservations%rowtype;version integer;acceptance app_private.quote_acceptances%rowtype;begin
 select * into seat from app_private.enrollments where id=p_enrollment_id;if seat.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,seat.learner_id,'booking');perform app_private.package_assert_scope(actor,seat.learner_id,'payments');
 context:=app_private.package_begin(actor,'reserve_package_credit',jsonb_build_object('package_id',p_package_id,'enrollment_id',p_enrollment_id,'credit_quanta',p_credit_quanta,'coverage_proposal_id',p_coverage_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=p_enrollment_id for update;
 purchase:=app_private.package_lock_purchase(p_package_id);if purchase.learner_id<>seat.learner_id then raise exception 'NOT_FOUND';end if;if purchase.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 -- Do not opportunistically expire other learners' booking holds after taking this learner's finances.
 if seat.state<>'held' or seat.hold_expires_at<=now() or seat.hold_kind<>'ordinary' then raise exception 'STATE_CONFLICT';end if;
 preview:=app_private.package_coverage_quote(p_package_id,p_enrollment_id,p_credit_quanta);
 if p_coverage_proposal_id is not null then accepted:=app_private.package_validate_coverage_proposal(p_coverage_proposal_id,actor,p_package_id,p_enrollment_id,p_credit_quanta);
 else
  if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
  if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;
  select * into acceptance from app_private.quote_acceptances a where a.quote_id=seat.current_quote_id and app_private.booking_can_access(a.actor_account_id,seat.learner_id) order by accepted_at,id limit 1;perform app_private.package_assert_scope(acceptance.actor_account_id,seat.learner_id,'booking');
  accepted:=preview||jsonb_build_object('accepted_actor_account_id',acceptance.actor_account_id,'accepted_at',acceptance.accepted_at,'package_acceptance_id',(select id from app_private.package_purchase_acceptances where purchase_id=purchase.id),'quote_acceptance_id',acceptance.id);
 end if;
 reservation:=app_private.package_reserve_allocations(p_package_id,p_enrollment_id,p_credit_quanta,p_coverage_proposal_id,accepted,context);
 if p_coverage_proposal_id is not null then perform app_private.package_commit_proposal(p_coverage_proposal_id,context);end if;
 update app_private.package_purchases set version=package_purchases.version+1,updated_at=now() where id=purchase.id returning package_purchases.version into version;
 perform set_config('response.status','201',true);return app_private.package_finish(context,reservation.id,reservation.version,jsonb_build_object('reservation_id',reservation.id,'reserved_credit_quanta',reservation.reserved_credit_quanta,'carrying_value_minor',reservation.allocated_value_minor,'top_up_minor',reservation.agreed_top_up_minor),'package_credit_reserved',jsonb_build_object('package_purchase_id',purchase.id,'enrollment_id',seat.id,'reservation_id',reservation.id));
end $$;
create function api.release_package_reservation(p_reservation_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();row app_private.package_reservations%rowtype;seat app_private.enrollments%rowtype;context jsonb;result jsonb;begin
 select * into row from app_private.package_reservations where id=p_reservation_id;if row.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,row.learner_id,'booking',true);perform app_private.package_assert_scope(actor,row.learner_id,'payments',true);
 context:=app_private.package_begin(actor,'release_package_reservation',jsonb_build_object('reservation_id',p_reservation_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 select * into seat from app_private.enrollments where id=row.enrollment_id;perform app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=row.enrollment_id for update;perform app_private.package_lock_purchase(row.purchase_id);
 select * into row from app_private.package_reservations where id=p_reservation_id for update;if row.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if seat.state<>'held' or row.state<>'reserved' then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 result:=app_private.package_release_reservation_kernel(row.id,'customer_release',context);return app_private.package_finish(context,row.id,row.version+1,result,'package_reservation_released',jsonb_build_object('package_purchase_id',row.purchase_id,'reservation_id',row.id));
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and p.proname in('package_coverage_quote','package_reserve_allocations','package_release_reservation_kernel','package_release_for_hold_end','package_enrollment_end_release')) or(n.nspname='api' and p.proname in('reserve_package_credit','release_package_reservation')) loop
 execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
