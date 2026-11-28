-- Apply claim expiry before pagination, so an expired item also leaves its old owner's queue.
create or replace function api.list_review_cases(
 p_state text default null, p_owner_id uuid default null, p_updated_after timestamptz default null,
 p_cursor text default null, p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid := app_private.require_actor();
 after_at timestamptz;
 after_id uuid;
 rows jsonb;
begin
 perform app_private.payment_current_staff(actor);
 if p_limit is null or p_limit not between 1 and 100
    or p_state not in ('waiting_for_evidence','unassigned','claimed','needs_information','escalated','resolved')
    or not isfinite(p_updated_after) then raise exception 'VALIDATION_ERROR'; end if;
 if p_cursor is not null then
  if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1) is distinct from 2 then
   raise exception 'VALIDATION_ERROR';
  end if;
  after_at := split_part(p_cursor,'|',1)::timestamptz;
  after_id := split_part(p_cursor,'|',2)::uuid;
  if not isfinite(after_at) then raise exception 'VALIDATION_ERROR'; end if;
 end if;
 with effective as (
  select c.*, c.state='claimed' and (c.claim_expires_at is null or c.claim_expires_at<=now()) as lapsed
  from app_private.review_cases c
 ), page as (
  select id,updated_at,lapsed from effective
  where (p_state is null or p_state=case when lapsed then 'unassigned' else state end)
    and (p_owner_id is null or (not lapsed and p_owner_id=owner_id))
    and (p_updated_after is null or updated_at>p_updated_after)
    and (after_at is null or (updated_at,id)<(after_at,after_id))
  order by updated_at desc,id desc limit p_limit+1
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',updated_at,'data',
  app_private.payment_case_dto(id) || case when lapsed then
   jsonb_build_object('state','unassigned','owner_id',null,'owner_display_name',null,'claim_expires_at',null)
  else '{}'::jsonb end) order by updated_at desc,id desc),'[]'::jsonb) into rows from page;
 return app_private.package_page(rows,p_limit);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'VALIDATION_ERROR';
end $$;

create or replace function finance_private.finance_allocate_cash(p_transfer_id uuid,p_charge_id uuid,p_amount_minor bigint,p_qualified_proof jsonb,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r app_private.enrollment_transfer_reviews%rowtype;b jsonb;begin
 -- The allocation caller holds the complete financial scope, including the seat.
 if exists (
  select 1 from finance_private.charges c join app_private.enrollments e on e.id=c.enrollment_id
  where c.id=p_charge_id and (e.state='expired' or (e.state='held' and e.hold_expires_at<=clock_timestamp()))
 ) then raise exception 'WINDOW_CLOSED'; end if;
 select r0.* into r from app_private.enrollment_transfer_reviews r0 join finance_private.charges c on c.enrollment_id=r0.destination_enrollment_id join app_private.operation_proposals p on p.id=r0.proposal_id where c.id=p_charge_id and p.state<>'committed';
 if r.proposal_id is not null then
  if not app_private.booking_proposal_fresh(r.proposal_id) then raise exception 'WINDOW_CLOSED';end if;b:=finance_private.finance_charge_balance(p_charge_id);
  if p_amount_minor>(b->>'receivable_minor')::bigint-r.planned_carryover_minor then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 end if;return finance_private.finance_allocate_cash_before_transfer(p_transfer_id,p_charge_id,p_amount_minor,p_qualified_proof,p_context,p_line_key);
end $$;

create or replace function api.cancel_enrollment(p_enrollment_id uuid,p_reason text,p_remedy_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();e app_private.enrollments%rowtype;p app_private.operation_proposals%rowtype;context jsonb;result jsonb;remedy uuid; charge_id_to_release uuid; net_minor bigint;begin
 select * into e from app_private.enrollments where id=p_enrollment_id;if e.id is null then raise exception 'NOT_FOUND';end if;perform app_private.assert_learner_scope(actor,e.learner_id,'booking',true);
 context:=app_private.booking_begin(actor,'cancel_enrollment',jsonb_build_object('enrollment_id',p_enrollment_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
 perform app_private.booking_lock_occurrence_finances(array[e.occurrence_id]);select * into e from app_private.enrollments where id=p_enrollment_id;
 if e.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 if p_remedy_proposal_id is null and e.state='held' and e.hold_kind='ordinary' then
  -- Direct release reverses an ordinary unfunded hold. Historical cash or a staged
  -- amendment/transfer still requires the reviewed cancellation workflow.
  if exists(select 1 from app_private.enrollment_transfer_reviews where destination_enrollment_id=e.id)
    or exists(select 1 from finance_private.charges c join finance_private.charge_accounts ca on ca.charge_id=c.id
       where c.enrollment_id=e.id and (ca.commitment_state<>'ordinary'
         or exists(select 1 from finance_private.payment_allocations a where a.charge_id=c.id)))
  then raise exception 'CONSENT_REQUIRED'; end if;
  update app_private.enrollments set state='cancelled',version=version+1,updated_at=now()
   where id=e.id returning * into e;
  -- The hold-end trigger releases reserved entitlements and reverses their coverage.
  for charge_id_to_release in select id from finance_private.charges where enrollment_id=e.id order by id loop
   net_minor := (finance_private.finance_charge_balance(charge_id_to_release)->>'commercial_net_minor')::bigint;
   if net_minor<>0 then
    perform finance_private.finance_adjust_charge(charge_id_to_release,-net_minor,'commercial',
      'unfunded_hold_release',e.id,now(),p_reason,context,'release:'||charge_id_to_release);
   end if;
   update finance_private.charge_accounts set commitment_state='committed',version=version+1,updated_at=now()
    where charge_id=charge_id_to_release;
   update app_private.booking_financial_resolutions set state='resolved'
    where charge_id=charge_id_to_release and reason='booking_cancelled' and state='open';
  end loop;
  perform app_private.booking_enqueue_due(e.occurrence_id,now());
 else
  select * into p from app_private.operation_proposals where id=p_remedy_proposal_id;
  if p.id is null or p.kind<>'cancellation_remedy' or p.target_type<>'enrollment' or p.target_id<>e.id then raise exception 'CONSENT_REQUIRED';end if;
  if not exists(select 1 from finance_private.cancellation_compensation_terms where proposal_id=p.id) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  result:=app_private.booking_consume_cancellation(p.id,context);select * into e from app_private.enrollments where id=e.id;select remedy_id into remedy from app_private.booking_cancellation_effects where enrollment_id=e.id;
 end if;
 return app_private.booking_finish(context,e.id,e.version,jsonb_build_object('state',e.state,'remedy_id',remedy),'enrollment_cancelled',jsonb_build_object('enrollment_id',e.id,'occurrence_id',e.occurrence_id));
end $$;

notify pgrst,'reload schema';
