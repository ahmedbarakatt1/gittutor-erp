-- Automatic funding confirmation must enqueue the learner update in the same transaction.
create or replace function app_private.booking_try_confirm_locked(p_occurrence_id uuid,p_context jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare o app_private.occurrences%rowtype;e app_private.enrollments%rowtype;q app_private.quotes%rowtype;fee finance_private.tutor_fee_agreements%rowtype;reason text;funding jsonb;roster jsonb:='[]';learner uuid;ids uuid[]:='{}';confirmation_event uuid;begin
 select * into o from app_private.occurrences where id=p_occurrence_id;
 if o.id is null then return jsonb_build_object('state','not_applicable','occurrence_id',null,'reason',null);end if;
 if o.state='confirmed' then return jsonb_build_object('state','already_confirmed','occurrence_id',o.id,'reason','ELIGIBLE');end if;
 if o.state='cancelled' then reason:='OCCURRENCE_CANCELLED';elsif o.state<>'forming' then return jsonb_build_object('state','not_applicable','occurrence_id',o.id,'reason',null);elsif o.confirmation_deadline_at<=now() then reason:='HOLD_EXPIRED';end if;
 if reason is null and not app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor') then reason:='SCHEDULE_CONFLICT';end if;
 if reason is null then begin perform app_private.booking_assert_schedule(o.tutor_id,o.start_at,o.end_at,o.id);exception when others then if sqlerrm='SCHEDULE_CONFLICT' then reason:='SCHEDULE_CONFLICT';else raise;end if;end;end if;
 select * into fee from finance_private.tutor_fee_agreements where id=o.current_fee_agreement_id;
 if reason is null and(fee.id is null or fee.occurrence_id is distinct from o.id or fee.tutor_id is distinct from o.tutor_id or fee.target_tier is distinct from o.target_tier or fee.pricing_version_id is distinct from o.pricing_version_id or fee.duration_minutes is distinct from o.duration_minutes or not app_private.has_role(fee.approved_by,'admin')) then reason:='FEE_NOT_APPROVED';end if;
 if reason is null and(select count(*) from app_private.enrollments where occurrence_id=o.id and state='held' and hold_kind='ordinary')<>coalesce(o.target_tier,1) then reason:='TARGET_NOT_MET';end if;
 if reason is null then
  for e in select * from app_private.enrollments where occurrence_id=o.id and state='held' and hold_kind='ordinary' order by id for update loop
   select * into q from app_private.quotes where id=e.current_quote_id;funding:=app_private.booking_funding_status(e.id,q.id,q.policy_version_id);
   if not(funding->>'eligible')::boolean then reason:=funding->>'reason';exit;end if;
   ids:=array_append(ids,e.id);roster:=roster||jsonb_build_array(jsonb_build_object('enrollment_id',e.id,'learner_id',e.learner_id,'quote_id',q.id,'quote_hash',q.terms_hash,'customer_price_minor',q.customer_price_minor,'currency',q.currency,'charge_id',funding->'charge_id','net_charge_minor',funding->'net_charge_minor','coverage_reservation_id',(select id from app_private.package_reservations where enrollment_id=e.id and state='reserved')));
  end loop;
 end if;
 if reason is not null then return jsonb_build_object('state','awaiting_requirements','occurrence_id',o.id,'reason',reason);end if;
 -- All affected learner locks precede statement triggers and any later package effects.
 for learner in select distinct learner_id from app_private.enrollments where id=any(ids) order by learner_id loop perform app_private.package_lock_learner(learner);end loop;
 update app_private.enrollments set state='confirmed',version=version+1,updated_at=now() where id=any(ids);
 update app_private.occurrences set state='confirmed',meeting_status='pending',version=version+1,updated_at=now() where id=o.id returning * into o;
 insert into app_private.booking_commitments(occurrence_id,occurrence_version,kind,pricing_version_id,policy_version_id,fee_agreement_id,target_tier,roster,command_id) values(o.id,o.version,'initial',o.pricing_version_id,o.policy_version_id,o.current_fee_agreement_id,o.target_tier,roster,(p_context->>'command_id')::uuid);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values((p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,'booking_confirmed',o.id,jsonb_build_object('occurrence_version',o.version,'enrollment_ids',ids));
 confirmation_event:=gen_random_uuid();
 perform app_private.enqueue_event(confirmation_event,'occurrence_confirmed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'calendar.sync');
 -- An explicit confirm command routes its own booking_confirm_occurrence event.
 if p_context->>'command_name' is distinct from 'confirm_occurrence' then
   perform app_private.enqueue_event(confirmation_event,'occurrence_confirmed',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version),'notifications.route');
 end if;
 return jsonb_build_object('state','confirmed','occurrence_id',o.id,'reason','ELIGIBLE');
end $$;

-- Walk one recipient's deliveries newest first so current-authority checks stop at the requested page size.
create index notification_inbox_recipient_created on app_private.notification_deliveries (recipient_account_id, created_at desc, id desc) where channel='in_app';
