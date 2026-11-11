-- Genuine conditional Q2 is selected only from the accepted amendment charge source.
grant create on schema app_private to git_tutor_commands;
alter table app_private.package_reservations add column conditional_amendment_id uuid references app_private.group_amendments(id);
create function app_private.package_booking_basis(p_enrollment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;s finance_private.charge_acceptance_sources%rowtype;a app_private.operation_proposal_acceptances%rowtype;t app_private.operation_customer_terms%rowtype;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;
 if e.hold_kind<>'amendment' then return jsonb_build_object('quote_id',e.current_quote_id,'conditional_amendment_id',null);end if;
 select x.* into s from finance_private.charge_acceptance_sources x join finance_private.charges c on c.id=x.charge_id join finance_private.charge_accounts ca on ca.charge_id=c.id where c.enrollment_id=e.id and x.source_kind='amendment' and ca.conditional_amendment_id=e.amendment_id and ca.commitment_state='awaiting_amendment';
 select * into a from app_private.operation_proposal_acceptances where id=s.proposal_acceptance_id;
 select * into t from app_private.operation_customer_terms where proposal_id=e.amendment_id and learner_id=e.learner_id;
 if s.charge_id is null or a.proposal_id is distinct from e.amendment_id or a.participant_type is distinct from 'learner' or a.participant_id is distinct from e.learner_id or a.terms_hash is distinct from t.terms_hash or t.proposed_quote_id is distinct from s.quote_id or not coalesce(app_private.booking_proposal_fresh(e.amendment_id),false) or not app_private.booking_can_access(a.actor_account_id,e.learner_id) or not exists(select 1 from app_private.auth_account(a.actor_account_id) where email_confirmed_at is not null and not coalesce(is_anonymous,false) and deleted_at is null and(banned_until is null or banned_until<=now())) then return '{}'::jsonb;end if;
 return jsonb_build_object('quote_id',s.quote_id,'conditional_amendment_id',e.amendment_id,'proposal_acceptance_id',a.id,'accepted_actor_account_id',a.actor_account_id,'accepted_at',a.accepted_at);
end $$;

create or replace function app_private.package_coverage_quote(p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase app_private.package_purchases%rowtype;seat app_private.enrollments%rowtype;occ app_private.occurrences%rowtype;quote app_private.quotes%rowtype;basis jsonb;conditional uuid;contract jsonb;allocations jsonb:='[]';terms jsonb;source_hash text;amount numeric;required bigint:=1000;top_up bigint;remaining bigint;reason text:='ELIGIBLE';requires_proposal boolean:=false;requires_review boolean:=false;begin
 select * into purchase from app_private.package_purchases where id=p_purchase_id;select * into seat from app_private.enrollments where id=p_enrollment_id;select * into occ from app_private.occurrences where id=seat.occurrence_id;basis:=app_private.package_booking_basis(seat.id);conditional:=(basis->>'conditional_amendment_id')::uuid;select * into quote from app_private.quotes where id=(basis->>'quote_id')::uuid;contract:=purchase.contract_snapshot;
 if p_credit_quanta is null or p_credit_quanta not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 if purchase.id is null or seat.id is null or purchase.learner_id<>seat.learner_id or purchase.purchase_state='cancelled' or seat.state not in('held','confirmed') or(seat.state='held' and seat.hold_expires_at<=now()) or quote.expires_at<=now() or(conditional is null and quote.base_terms_version<>occ.quote_terms_version) then reason:='STATE_CONFLICT';
 elsif quote.id is null then reason:='QUOTE_NOT_ACCEPTED';
 elsif not(contract->'eligible_offer_ids'?occ.offer_id::text) then reason:='OFFER_INELIGIBLE';
 elsif not(contract->'eligible_formats'?occ.format) then reason:='FORMAT_INELIGIBLE';
 elsif(contract->>'base_duration_minutes')::numeric<>occ.duration_minutes then reason:='DURATION_CONVERSION_REQUIRED';
 elsif conditional is null and not exists(select 1 from app_private.quote_acceptances a where a.quote_id=quote.id and app_private.booking_can_access(a.actor_account_id,seat.learner_id) and exists(select 1 from app_private.auth_account(a.actor_account_id) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now()))) then reason:='QUOTE_NOT_ACCEPTED';end if;
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
 if conditional is not null then terms:=terms||jsonb_build_object('conditional_amendment_id',conditional);end if;
 source_hash:=app_private.catalog_hash(jsonb_build_object('purchase_id',purchase.id,'purchase_version',purchase.version,'enrollment_id',seat.id,'enrollment_version',seat.version,'quote_id',quote.id,'quote_hash',quote.terms_hash,'allocations',allocations));
 return jsonb_build_object('terms',terms,'allocations',allocations,'source_hash',source_hash,'requires_admin_review',requires_review,'requires_proposal',requires_proposal,'eligible',true,'reason',reason);
end $$;
create or replace function app_private.package_reserve_allocations(p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_accepted_terms jsonb,p_context jsonb) returns app_private.package_reservations language plpgsql security definer set search_path='' as $$
declare preview jsonb;terms jsonb;allocation jsonb;seat app_private.enrollments%rowtype;reservation app_private.package_reservations%rowtype;allocation_id uuid;begin
 preview:=app_private.package_coverage_quote(p_purchase_id,p_enrollment_id,p_credit_quanta);
 if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
 if p_coverage_proposal_id is not null then
  if p_accepted_terms->>'source_hash' is distinct from preview->>'source_hash' or p_accepted_terms->'allocations' is distinct from preview->'allocations' or ((p_accepted_terms->'terms')-array['agreed_top_up_minor','remaining_service_price_minor']) is distinct from((preview->'terms')-array['agreed_top_up_minor','remaining_service_price_minor']) then raise exception 'VERSION_CONFLICT';end if;
  terms:=p_accepted_terms->'terms';
 else if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;terms:=preview->'terms';end if;
 select * into seat from app_private.enrollments where id=p_enrollment_id;
 if exists(select 1 from app_private.package_reservations where enrollment_id=seat.id and state in('reserved','partially_consumed')) then raise exception 'STATE_CONFLICT';end if;
 insert into app_private.package_reservations(purchase_id,learner_id,enrollment_id,quote_id,quote_hash,conditional_amendment_id,coverage_rule,required_credit_quanta,reserved_credit_quanta,allocated_value_minor,agreed_top_up_minor,coverage_proposal_id,acceptance_refs,expires_at) values(p_purchase_id,seat.learner_id,seat.id,(terms->>'quote_id')::uuid,terms->>'quote_hash',(terms->>'conditional_amendment_id')::uuid,terms->>'coverage_rule',(terms->>'required_credit_quanta')::bigint,p_credit_quanta,(terms->>'carrying_value_minor')::bigint,(terms->>'agreed_top_up_minor')::bigint,p_coverage_proposal_id,p_accepted_terms-array['terms','allocations'],least(seat.hold_expires_at,(select expires_at from app_private.quotes where id=(terms->>'quote_id')::uuid))) returning * into reservation;
 for allocation in select value from jsonb_array_elements(preview->'allocations') loop
  insert into app_private.package_reservation_allocations(reservation_id,lot_id,credit_quanta,value_minor) values(reservation.id,(allocation->>'lot_id')::uuid,(allocation->>'credit_quanta')::bigint,(allocation->>'value_minor')::bigint) returning id into allocation_id;
  perform app_private.package_append_movement((allocation->>'lot_id')::uuid,'reserve',jsonb_build_object('available_credit_quanta',-(allocation->>'credit_quanta')::bigint,'reserved_credit_quanta',(allocation->>'credit_quanta')::bigint,'available_value_minor',-(allocation->>'value_minor')::bigint,'reserved_value_minor',(allocation->>'value_minor')::bigint),jsonb_build_object('enrollment_id',seat.id,'reservation_id',reservation.id,'allocation_id',allocation_id,'credit_quanta',(allocation->>'credit_quanta')::bigint,'value_minor',(allocation->>'value_minor')::bigint,'from_bucket','available','to_bucket','reserved','customer_reason_code','booking_reservation'),p_context,'reserve:'||allocation_id);
 end loop;return reservation;
end $$;
create or replace function api.reserve_package_credit(p_package_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();context jsonb;seat app_private.enrollments%rowtype;purchase app_private.package_purchases%rowtype;preview jsonb;accepted jsonb;reservation app_private.package_reservations%rowtype;version integer;acceptance app_private.quote_acceptances%rowtype;begin
 select * into seat from app_private.enrollments where id=p_enrollment_id;if seat.id is null then raise exception 'NOT_FOUND';end if;perform app_private.package_assert_scope(actor,seat.learner_id,'booking');perform app_private.package_assert_scope(actor,seat.learner_id,'payments');
 context:=app_private.package_begin(actor,'reserve_package_credit',jsonb_build_object('package_id',p_package_id,'enrollment_id',p_enrollment_id,'credit_quanta',p_credit_quanta,'coverage_proposal_id',p_coverage_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 perform app_private.booking_lock_financial_scope(app_private.booking_financial_scope(array[p_enrollment_id],array[p_package_id]));
 perform app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=p_enrollment_id for update;
 purchase:=app_private.package_lock_purchase(p_package_id);if purchase.learner_id<>seat.learner_id then raise exception 'NOT_FOUND';end if;if purchase.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 -- Do not opportunistically expire other learners' booking holds after taking this learner's finances.
 if seat.state<>'held' or seat.hold_expires_at<=now() then raise exception 'STATE_CONFLICT';end if;
 preview:=app_private.package_coverage_quote(p_package_id,p_enrollment_id,p_credit_quanta);
 if p_coverage_proposal_id is not null then accepted:=app_private.package_validate_coverage_proposal(p_coverage_proposal_id,actor,p_package_id,p_enrollment_id,p_credit_quanta);
 else
  if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
  if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;
  if seat.hold_kind='amendment' then accepted:=preview||app_private.package_booking_basis(seat.id)||jsonb_build_object('package_acceptance_id',(select id from app_private.package_purchase_acceptances where purchase_id=purchase.id));perform app_private.package_assert_scope((accepted->>'accepted_actor_account_id')::uuid,seat.learner_id,'booking');
  else
  select * into acceptance from app_private.quote_acceptances a where a.quote_id=seat.current_quote_id and app_private.booking_can_access(a.actor_account_id,seat.learner_id) order by accepted_at,id limit 1;perform app_private.package_assert_scope(acceptance.actor_account_id,seat.learner_id,'booking');
  accepted:=preview||jsonb_build_object('accepted_actor_account_id',acceptance.actor_account_id,'accepted_at',acceptance.accepted_at,'package_acceptance_id',(select id from app_private.package_purchase_acceptances where purchase_id=purchase.id),'quote_acceptance_id',acceptance.id);
  end if;
 end if;
 reservation:=app_private.package_reserve_allocations(p_package_id,p_enrollment_id,p_credit_quanta,p_coverage_proposal_id,accepted,context);
 perform finance_private.finance_apply_package_coverage(reservation.id,context);
 if p_coverage_proposal_id is not null then perform app_private.package_commit_proposal(p_coverage_proposal_id,context);end if;
 update app_private.package_purchases set version=package_purchases.version+1,updated_at=now() where id=purchase.id returning package_purchases.version into version;
 perform set_config('response.status','201',true);return app_private.package_finish(context,reservation.id,reservation.version,jsonb_build_object('reservation_id',reservation.id,'reserved_credit_quanta',reservation.reserved_credit_quanta,'carrying_value_minor',reservation.allocated_value_minor,'top_up_minor',reservation.agreed_top_up_minor),'package_credit_reserved',jsonb_build_object('package_purchase_id',purchase.id,'enrollment_id',seat.id,'reservation_id',reservation.id));
end $$;
create or replace function app_private.package_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;admin boolean;context jsonb;p app_private.operation_proposals%rowtype;old_p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;old_t app_private.package_operation_terms%rowtype;
 source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;a app_private.operation_proposal_acceptances%rowtype;
 requested jsonb;allowed text[];field text;kind text;resource uuid:=gen_random_uuid();resource_version integer:=1;result jsonb;event_name text;terms jsonb;preview jsonb;allocations jsonb:='[]';converted jsonb:='[]';contract jsonb;view jsonb;
 source_hash text;terms_hash text;expiry timestamptz;original_expiry timestamptz;ready boolean:=true;needs_admin boolean:=false;source_q bigint;target_q bigint;value_minor bigint;old_minutes bigint;new_minutes bigint;service_delta numeric;reason text;approval uuid;
begin
 actor:=app_private.require_actor();admin:=app_private.has_role(actor,'admin');
 if p_name='create_operation_proposal' then
  kind:=p_input->>'kind';requested:=p_input->'requested_terms';
  if kind is null or kind not in('package_coverage','package_conversion') or jsonb_typeof(requested) is distinct from 'object' then raise exception 'VALIDATION_ERROR';end if;
  if kind='package_coverage' then
   allowed:=array['target_type','package_purchase_id','expected_package_version','credit_quanta','remaining_service_price_minor','expires_at','replaces_proposal_id','expected_replaced_version'];
   if requested->>'target_type' is distinct from 'enrollment' then raise exception 'VALIDATION_ERROR';end if;
   select * into e from app_private.enrollments where id=(p_input->>'target_id')::uuid;if e.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   select * into source from app_private.package_purchases where id=(requested->>'package_purchase_id')::uuid;
   if source.id is null or source.learner_id<>e.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   perform app_private.package_proposal_scope(actor,source.learner_id,kind,true);
   o:=app_private.booking_lock_occurrence(e.occurrence_id);select * into e from app_private.enrollments where id=e.id for update;
   if e.occurrence_id<>o.id then raise exception 'VERSION_CONFLICT';end if;
  else
   allowed:=array['target_type','target_package_id','new_contract_version_id','expected_target_version','source_credit_quanta','target_credit_quanta','expires_at'];
   if requested->>'target_type' is distinct from 'package_purchase' then raise exception 'VALIDATION_ERROR';end if;
   perform app_private.require_role(actor,'admin');
   select * into source from app_private.package_purchases where id=(p_input->>'target_id')::uuid;if source.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   if requested->>'target_package_id' is not null then
    select * into target from app_private.package_purchases where id=(requested->>'target_package_id')::uuid;
    if target.id is null or target.learner_id<>source.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if target.id=source.id then raise exception 'STATE_CONFLICT';end if;
   end if;
  end if;
  if requested-allowed<>'{}'::jsonb then raise exception 'VALIDATION_ERROR';end if;
  foreach field in array allowed loop if field not in('replaces_proposal_id','expected_replaced_version') and not(requested?field) then raise exception 'VALIDATION_ERROR';end if;end loop;
  perform app_private.package_lock_learner(source.learner_id);perform 1 from app_private.package_purchases where id=source.id or id=target.id order by id for update;
  select * into source from app_private.package_purchases where id=source.id;if target.id is not null then select * into target from app_private.package_purchases where id=target.id;end if;
  perform 1 from app_private.package_lots where purchase_id=source.id order by id for update;
 else
  select * into p from app_private.operation_proposals where id=(p_input->>'proposal_id')::uuid;select * into t from app_private.package_operation_terms where proposal_id=p.id;
  if t.proposal_id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;kind:=p.kind;
  if p_name='approve_operation_proposal' then perform app_private.require_role(actor,'admin');else perform app_private.package_proposal_scope(actor,t.learner_id,kind,p_name='decline_operation_proposal');end if;
  p:=app_private.package_proposal_lock(p.id);resource:=p.id;
 end if;
 context:=app_private.package_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_name='create_operation_proposal' then
  if source.purchase_state='cancelled' or(target.id is not null and target.purchase_state='cancelled') then raise exception 'STATE_CONFLICT';end if;
  if(p_input->>'expected_version')::int is distinct from(case when kind='package_coverage' then e.version else source.version end) then raise exception 'VERSION_CONFLICT';end if;
  if requested->>'expires_at' is null or (requested->>'expires_at')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_TIME';end if;
  expiry:=(requested->>'expires_at')::timestamptz;if expiry is null or not isfinite(expiry) or expiry<=now() or expiry>='10000-01-01'::timestamptz then raise exception 'INVALID_TIME';end if;
  reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
  if kind='package_coverage' then
   if app_private.package_safe_integer(requested->'expected_package_version',1)<>source.version then raise exception 'VERSION_CONFLICT';end if;
   source_q:=app_private.package_safe_integer(requested->'credit_quanta',1);
   preview:=app_private.package_coverage_quote(source.id,e.id,source_q);
   if preview->'terms' is null or preview->'terms'='null'::jsonb then raise exception 'STATE_CONFLICT';end if;
   terms:=preview->'terms';allocations:=preview->'allocations';source_hash:=preview->>'source_hash';needs_admin:=coalesce((preview->>'requires_admin_review')::boolean,false);
   if terms->>'coverage_rule'='named_entitlement_covers_eligible_occurrence' and(terms->>'remaining_service_credit_quanta')::bigint>0 then
    needs_admin:=true;
    if requested->>'remaining_service_price_minor' is not null then perform app_private.require_role(actor,'admin');value_minor:=app_private.package_safe_integer(requested->'remaining_service_price_minor');terms:=terms||jsonb_build_object('remaining_service_price_minor',value_minor,'agreed_top_up_minor',value_minor);
    else ready:=false;end if;
   elsif requested->>'remaining_service_price_minor' is not null then raise exception 'VALIDATION_ERROR';end if;
   expiry:=least(expiry,e.hold_expires_at,(select expires_at from app_private.quotes where id=(terms->>'quote_id')::uuid));if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
   if(requested->>'replaces_proposal_id' is null)<>(requested->>'expected_replaced_version' is null) then raise exception 'VALIDATION_ERROR';end if;
   if requested->>'replaces_proposal_id' is not null then
    perform app_private.require_role(actor,'admin');
    select * into old_p from app_private.operation_proposals where id=(requested->>'replaces_proposal_id')::uuid for update;select * into old_t from app_private.package_operation_terms where proposal_id=old_p.id;
    if old_t.proposal_id is null or old_p.kind<>kind or old_p.target_id<>e.id or old_t.source_purchase_id<>source.id or old_t.learner_id<>source.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if old_p.version<>app_private.package_safe_integer(requested->'expected_replaced_version',1) then raise exception 'VERSION_CONFLICT';end if;
    if not ready or old_t.financial_terms_ready or old_p.state<>'proposed' or exists(select 1 from app_private.operation_proposal_acceptances where proposal_id=old_p.id) then raise exception 'STATE_CONFLICT';end if;
    update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason='replaced_by_reviewed_terms',updated_at=now() where id=old_p.id;
   end if;
  else
   if(requested->>'target_package_id' is null)<>(requested->>'expected_target_version' is null) then raise exception 'VALIDATION_ERROR';end if;
   if target.id is not null and(target.version<>app_private.package_safe_integer(requested->'expected_target_version',1) or target.contract_version_id<>(requested->>'new_contract_version_id')::uuid) then raise exception 'VERSION_CONFLICT';end if;
   view:=app_private.package_contract_dto((requested->>'new_contract_version_id')::uuid);contract:=view->'contract';
   source_q:=app_private.package_safe_integer(requested->'source_credit_quanta');target_q:=app_private.package_safe_integer(requested->'target_credit_quanta');
   if(source_q=0 or target_q=0) and not(source_q=0 and target_q=0 and target.id is null) then raise exception 'VALIDATION_ERROR';end if;
   old_minutes:=(source.contract_snapshot->>'base_duration_minutes')::bigint;new_minutes:=(contract->>'base_duration_minutes')::bigint;
   service_delta:=(target_q::numeric*new_minutes-source_q::numeric*old_minutes)*60;if service_delta>0 or service_delta< -9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
   allocations:=case when source_q=0 then '[]'::jsonb else app_private.package_allocate_available(source.id,source_q,null) end;source_hash:=app_private.catalog_hash(allocations);converted:=app_private.package_proposal_convert_allocations(allocations,target_q);
   select coalesce(sum((x->>'value_minor')::numeric),0),min((x->>'expires_at')::timestamptz) into value_minor,original_expiry from jsonb_array_elements(allocations)x;
   if value_minor>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
   terms:=jsonb_build_object('learner_id',source.learner_id,'source_package_id',source.id,'target_package_id',target.id,'new_contract_version_id',requested->>'new_contract_version_id','new_contract_terms_hash',view->>'terms_hash','creates_new_purchase',target.id is null,'new_purchase_credit_quanta',case when target.id is null then(contract->>'grant_credit_quanta')::bigint else 0 end,'new_purchase_value_minor',case when target.id is null then(contract->>'purchase_value_minor')::bigint else 0 end,'source_credit_quanta',source_q,'target_credit_quanta',target_q,'carrying_value_minor',value_minor,'currency','EGP','old_base_duration_minutes',old_minutes,'new_base_duration_minutes',new_minutes,'original_expiry_at',original_expiry,'converted_expiry_at',original_expiry,'lot_allocations',converted,'eligibility_changes',jsonb_build_object('removed_offer_ids',coalesce((select jsonb_agg(x) from jsonb_array_elements(source.contract_snapshot->'eligible_offer_ids')x where not(contract->'eligible_offer_ids'@>jsonb_build_array(x))),'[]'),'added_offer_ids',coalesce((select jsonb_agg(x) from jsonb_array_elements(contract->'eligible_offer_ids')x where not(source.contract_snapshot->'eligible_offer_ids'@>jsonb_build_array(x))),'[]'),'old_formats',source.contract_snapshot->'eligible_formats','new_formats',contract->'eligible_formats'),'service_duration_delta_second_quanta',service_delta,'rounding_rule','reviewed_exact_credit_quanta');needs_admin:=true;
  end if;
  insert into app_private.operation_proposals(id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason)
   values(resource,kind,requested->>'target_type',(p_input->>'target_id')::uuid,o.id,case when kind='package_coverage' then e.version else source.version end,coalesce(o.version,1),source_hash,case when kind='package_coverage' then source.contract_version_id else(requested->>'new_contract_version_id')::uuid end,requested,expiry,actor,reason) returning * into p;
  terms_hash:=app_private.catalog_hash(jsonb_build_object('proposal_id',p.id,'learner_id',source.learner_id,'terms',terms,'expires_at',expiry,'base_version',p.base_target_version,'source_hash',source_hash));
  insert into app_private.package_operation_terms(proposal_id,learner_id,source_purchase_id,target_purchase_id,new_contract_version_id,source_purchase_version,target_purchase_version,source_quote_id,allocation_snapshot,source_hash,customer_terms,terms_hash,financial_terms_ready,requires_admin_approval,replaces_proposal_id)
   values(p.id,source.learner_id,source.id,target.id,case when kind='package_conversion' then(requested->>'new_contract_version_id')::uuid else null end,source.version,target.version,case when kind='package_coverage' then(terms->>'quote_id')::uuid else null end,allocations,source_hash,terms,terms_hash,ready,needs_admin,old_p.id);
  perform app_private.package_enqueue_due(source.id,expiry);
  result:=jsonb_build_object('proposal_id',p.id,'terms_hash',terms_hash,'expires_at',expiry,'required_actions',case when ready then '["review_terms"]'::jsonb else '["await_admin_remaining_service_terms"]'::jsonb end);event_name:='package_proposal_created';perform set_config('response.status','201',true);
 else
  if(p_input->>'expected_version')::int is distinct from p.version then raise exception 'VERSION_CONFLICT';end if;
  if p.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
  if not app_private.package_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
  if p_name='accept_operation_proposal' then
   if p_input->>'terms_hash' is distinct from t.terms_hash then raise exception 'VERSION_CONFLICT';end if;
   if not t.financial_terms_ready then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   insert into app_private.operation_proposal_acceptances(proposal_id,participant_type,participant_id,actor_account_id,terms_hash) values(p.id,'learner',t.learner_id,actor,t.terms_hash) on conflict(proposal_id,participant_type,participant_id) do nothing;
   select * into a from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=t.learner_id;
   if a.actor_account_id<>actor then raise exception 'STATE_CONFLICT';end if;
   update app_private.operation_proposals set state='accepted',updated_at=now() where id=p.id;
   result:=jsonb_build_object('accepted_at',a.accepted_at);resource_version:=p.version;event_name:='package_proposal_accepted';
  elsif p_name='decline_operation_proposal' then
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
   update app_private.operation_proposals set state='declined',version=version+1,updated_at=now() where id=p.id returning version into resource_version;result:=jsonb_build_object('state','declined');event_name:='package_proposal_declined';
  elsif p_name='approve_operation_proposal' then
   if p_input->>'terms_hash' is distinct from t.terms_hash or p_input->>'decision' is null or p_input->>'decision' not in('approved','rejected') then raise exception 'VALIDATION_ERROR';end if;
   reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   if p_input->>'decision'='approved' then if not t.financial_terms_ready then raise exception 'DEPENDENCY_UNAVAILABLE';end if;if not app_private.package_proposal_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;end if;
   insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,t.terms_hash,p_input->>'decision',actor,reason) returning id into approval;
   update app_private.operation_proposals set state=case when p_input->>'decision'='approved' then 'approved' else 'declined' end,version=version+1,approved_by=actor,approved_at=now(),updated_at=now() where id=p.id returning * into p;
   resource_version:=p.version;result:=jsonb_build_object('approval_id',approval,'state',p.state);event_name:='package_proposal_reviewed';
  else raise exception 'VALIDATION_ERROR';end if;
 end if;
 return app_private.package_finish(context,resource,resource_version,result,event_name,jsonb_build_object('proposal_id',resource,'learner_id',coalesce(source.learner_id,t.learner_id)));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;
create or replace function app_private.package_proposal_fresh(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;preview jsonb;contract jsonb;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;
 if p.id is null or t.proposal_id is null or p.state not in('proposed','accepted','approved') or p.expires_at<=now() then return false;end if;
 select * into source from app_private.package_purchases where id=t.source_purchase_id;if source.version<>t.source_purchase_version or source.purchase_state='cancelled' then return false;end if;
 if p.kind='package_coverage' then
  select * into e from app_private.enrollments where id=p.target_id;select * into o from app_private.occurrences where id=p.occurrence_id;
  if e.version<>p.base_target_version or (app_private.package_booking_basis(e.id)->>'quote_id')::uuid is distinct from t.source_quote_id or o.version<>p.base_occurrence_version then return false;end if;
  preview:=app_private.package_coverage_quote(source.id,e.id,(t.customer_terms->>'reserved_credit_quanta')::bigint);
  return preview->'terms'<>'null'::jsonb and preview->>'source_hash'=t.source_hash;
 else
  if not app_private.package_conversion_service_valid(t.customer_terms) then return false;end if;contract:=app_private.package_contract_dto(t.new_contract_version_id);if contract->>'terms_hash' is distinct from t.customer_terms->>'new_contract_terms_hash' then return false;end if;
  if t.target_purchase_id is not null then select * into target from app_private.package_purchases where id=t.target_purchase_id;if target.version<>t.target_purchase_version or target.purchase_state='cancelled' then return false;end if;end if;
  preview:=case when(t.customer_terms->>'source_credit_quanta')::bigint=0 then '[]'::jsonb else app_private.package_allocate_available(source.id,(t.customer_terms->>'source_credit_quanta')::bigint,null) end;
  return app_private.catalog_hash(preview)=t.source_hash;
 end if;
exception when raise_exception then if sqlerrm in('POLICY_INCOMPLETE','INSUFFICIENT_ENTITLEMENT','STATE_CONFLICT','WINDOW_CLOSED','VERSION_CONFLICT') then return false;else raise;end if;
end $$;
create or replace function finance_private.finance_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;q app_private.quotes%rowtype;r app_private.package_reservations%rowtype;c finance_private.charges%rowtype;a finance_private.charge_accounts%rowtype;b jsonb;policy jsonb;required bigint:=0;additional bigint:=0;net bigint;cash bigint;package_value bigint;reserved bigint:=0;topup bigint;reason text:='ELIGIBLE';financial boolean:=false;conditional uuid;reconciliation text:='clear';begin
 select * into e from app_private.enrollments where id=p_enrollment_id;select * into o from app_private.occurrences where id=e.occurrence_id;select * into q from app_private.quotes where id=p_quote_id;
 select * into c from finance_private.charges where enrollment_id=e.id;select * into a from finance_private.charge_accounts where charge_id=c.id;conditional:=a.conditional_amendment_id;
 if conditional is not null then select * into q from app_private.quotes where id=(select quote_id from finance_private.charge_acceptance_sources where charge_id=c.id);end if;policy:=app_private.policy_content(q.policy_version_id);
 if c.id is not null then b:=finance_private.finance_charge_balance(c.id);net:=(b->>'commercial_net_minor')::bigint;cash:=(b->>'allocated_cash_minor')::bigint;package_value:=(b->>'allocated_package_value_minor')::bigint;reconciliation:=b->>'reconciliation_state';required:=app_private.booking_deposit(net,policy);additional:=greatest(0,required-cash-package_value);end if;
 select * into r from app_private.package_reservations where enrollment_id=e.id and state in('reserved','partially_consumed','consumed') order by created_at desc limit 1;
 if r.id is not null then select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0)::bigint into reserved from app_private.entitlement_movements where reservation_id=r.id;topup:=r.agreed_top_up_minor;else topup:=net;end if;
 if e.id is null or q.enrollment_id is distinct from e.id or(conditional is null and q.policy_version_id is distinct from p_policy_version_id) then reason:='QUOTE_NOT_ACCEPTED';
 elsif e.state in('expired','cancelled') or o.state='cancelled' then reason:=case when e.state='expired' then 'HOLD_EXPIRED' else 'OCCURRENCE_CANCELLED' end;
 elsif e.state='held' and e.hold_expires_at<=now() then reason:='HOLD_EXPIRED';
 elsif c.id is null then reason:='QUOTE_NOT_ACCEPTED';
 elsif reconciliation='requires_review' or a.commitment_state='resolution_required' then reason:='RECONCILIATION_REQUIRED';reconciliation:='requires_review';
 elsif exists(select 1 from app_private.package_reservation_allocations x join app_private.package_lots l on l.id=x.lot_id join app_private.package_financing_holds h on h.original_lot_id=l.original_lot_id and h.active where x.reservation_id=r.id) then reason:='FINANCING_HOLD';
 elsif conditional is not null and(app_private.package_booking_basis(e.id)->>'quote_id')::uuid is distinct from q.id then reason:='QUOTE_NOT_ACCEPTED';
 elsif conditional is null and(q.id is distinct from e.current_quote_id or q.base_terms_version<>o.quote_terms_version) then reason:='QUOTE_NOT_ACCEPTED';
 elsif e.state='held' and q.expires_at<=now() then reason:='QUOTE_EXPIRED';
 elsif conditional is null and not exists(select 1 from app_private.quote_acceptances x where x.quote_id=q.id and app_private.booking_can_access(x.actor_account_id,e.learner_id)) then reason:='QUOTE_NOT_ACCEPTED';
 elsif r.id is not null and r.coverage_rule='named_entitlement_covers_eligible_occurrence' and not(policy->'confirmation_funding_sources'?'reserved_named_package_entitlement') then reason:='POLICY_INCOMPLETE';
 elsif package_value>0 and not(policy->'confirmation_funding_sources'?'reserved_eligible_package_value') then reason:='POLICY_INCOMPLETE';
 elsif cash>0 and not(policy->'confirmation_funding_sources'?'verified_payment_allocation') then reason:='POLICY_INCOMPLETE';
 elsif conditional is not null then reason:='AMENDMENT_PENDING';
 elsif additional>0 then reason:='INSUFFICIENT_FUNDS';end if;
 financial:=c.id is not null and additional=0 and reason in('ELIGIBLE','AMENDMENT_PENDING') and reconciliation='clear';
 return jsonb_build_object('integration_state','ready','eligible',financial and reason='ELIGIBLE','financially_eligible',financial,'reason',reason,'charge_id',c.id,'net_charge_minor',net,'allocated_minor',cash,'balance_minor',case when b is null then null else greatest(0,(b->>'receivable_minor')::bigint) end,'required_for_confirmation_minor',required,'reserved_credit_quanta',reserved,'allocated_package_value_minor',package_value,'top_up_minor',topup,'additional_required_minor',additional,'conditional_amendment_id',conditional,'funding_quote_id',case when conditional is null then q.id else(select quote_id from finance_private.charge_acceptance_sources where charge_id=c.id) end,'reconciliation_state',reconciliation);
end $$;
alter function app_private.package_booking_basis(uuid) owner to git_tutor_commands;
revoke all on function app_private.package_booking_basis(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';
