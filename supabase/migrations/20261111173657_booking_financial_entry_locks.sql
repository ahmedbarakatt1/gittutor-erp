grant create on schema app_private to git_tutor_commands;
create function app_private.booking_lock_occurrence_finances(p_occurrence_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare scope jsonb;ids uuid[];begin
 select coalesce(array_agg(id order by id),'{}') into ids from app_private.enrollments where occurrence_id=any(p_occurrence_ids);
 scope:=app_private.booking_financial_scope(ids,'{}');
 scope:=scope||jsonb_build_object('occurrence_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select id from app_private.occurrences where id=any(p_occurrence_ids) union select value::uuid from jsonb_array_elements_text(scope->'occurrence_ids'))x),'tutor_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select tutor_id id from app_private.occurrences where id=any(p_occurrence_ids) union select value::uuid from jsonb_array_elements_text(scope->'tutor_ids'))x));
 perform app_private.booking_lock_financial_scope(scope);
end $$;
alter function app_private.booking_command(text,jsonb,text) rename to booking_command_before_financial_entry;
create function app_private.booking_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();occurrence uuid;learner uuid;begin
 if p_name in('set_availability','create_occurrence') then return app_private.booking_command_before_financial_entry(p_name,p_input,p_key);end if;
 if p_name in('change_occurrence_capacity','confirm_occurrence','approve_tutor_fee') then perform app_private.require_role(actor,'admin');occurrence:=(p_input->>'occurrence_id')::uuid;
 elsif p_name in('reserve_enrollment','join_waitlist') then perform app_private.assert_learner_scope(actor,(p_input->>'learner_id')::uuid,'booking');occurrence:=(p_input->>'occurrence_id')::uuid;
 elsif p_name='accept_quote' then select e.occurrence_id,e.learner_id into occurrence,learner from app_private.enrollments e join app_private.quotes q on q.enrollment_id=e.id where q.id=(p_input->>'quote_id')::uuid;perform app_private.assert_learner_scope(actor,learner,'booking');
 elsif p_name='leave_waitlist' then select occurrence_id,learner_id into occurrence,learner from app_private.waitlist_entries where id=(p_input->>'waitlist_entry_id')::uuid;perform app_private.assert_learner_scope(actor,learner,'booking');
 else raise exception 'VALIDATION_ERROR';end if;
 perform app_private.booking_lock_occurrence_finances(array[occurrence]);
 return app_private.booking_command_before_financial_entry(p_name,p_input,p_key);
end $$;
alter function app_private.booking_proposal_command(text,jsonb,text) rename to booking_proposal_command_before_financial_entry;
create function app_private.booking_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();p app_private.operation_proposals%rowtype;o app_private.occurrences%rowtype;learner uuid;hash text;ids uuid[];result jsonb;begin
 if p_name='create_operation_proposal' then
  if p_input->'requested_terms'->>'target_type'='enrollment' then select occurrence_id,learner_id into o.id,learner from app_private.enrollments where id=(p_input->>'target_id')::uuid;perform app_private.assert_learner_scope(actor,learner,'booking',true);
  else select * into o from app_private.occurrences where id=(p_input->>'target_id')::uuid;
   if app_private.has_role(actor,'admin') then perform app_private.require_role(actor,'admin');
   elsif exists(select 1 from app_private.tutors where id=o.tutor_id and account_id=actor) and p_input->>'kind'='reschedule' then perform app_private.require_role(actor,'tutor');
   elsif o.format='private' and p_input->>'kind'='reschedule' then select learner_id into learner from app_private.enrollments where occurrence_id=o.id and state in('held','confirmed') and app_private.booking_can_access(actor,learner_id);perform app_private.assert_learner_scope(actor,learner,'booking');
   else raise exception 'NOT_FOUND';end if;
  end if;
 elsif p_name in('propose_group_amendment','reschedule_occurrence','cancel_occurrence') then perform app_private.require_role(actor,'admin');o.id:=(p_input->>'occurrence_id')::uuid;
 elsif p_name in('cancel_enrollment','transfer_enrollment') then select occurrence_id,learner_id into o.id,learner from app_private.enrollments where id=(p_input->>'enrollment_id')::uuid;perform app_private.assert_learner_scope(actor,learner,'booking',true);
 else
  select * into p from app_private.operation_proposals where id=coalesce((p_input->>'amendment_id')::uuid,(p_input->>'proposal_id')::uuid);if p.id is null then raise exception 'NOT_FOUND';end if;o.id:=p.occurrence_id;
  if p_name in('approve_operation_proposal','commit_group_amendment') then perform app_private.require_role(actor,'admin');
  elsif p_name in('accept_operation_proposal','accept_group_amendment') then perform app_private.booking_proposal_participant(actor,p.id,p_input->>'terms_hash');
  elsif p_name in('decline_operation_proposal','decline_group_amendment') then
   if app_private.has_role(actor,'admin') and p_name='decline_group_amendment' then perform app_private.require_role(actor,'admin');else
    select terms_hash into hash from app_private.operation_customer_terms where proposal_id=p.id and app_private.booking_can_access(actor,learner_id) order by learner_id limit 1;
    if hash is null then select t.terms_hash into hash from finance_private.operation_tutor_terms t join app_private.tutors person on person.id=t.tutor_id where t.proposal_id=p.id and person.account_id=actor;end if;
    perform app_private.booking_proposal_participant(actor,p.id,hash);
   end if;
  else raise exception 'VALIDATION_ERROR';end if;
 end if;
 ids:=array[o.id,coalesce((p_input->>'destination_occurrence_id')::uuid,(p_input->'requested_terms'->>'destination_occurrence_id')::uuid)];
 perform app_private.booking_lock_occurrence_finances(ids);
 result:=app_private.booking_proposal_command_before_financial_entry(p_name,p_input,p_key);
 if p.id is not null and exists(select 1 from app_private.operation_proposals where id=p.id and state in('declined','expired')) then perform finance_private.finance_release_amendment_funding(p.id,jsonb_build_object('actor_account_id',actor,'command_id',result->'command_id'));end if;
 return result;
end $$;
alter function app_private.booking_expire_proposals(uuid) rename to booking_expire_proposals_before_financial_entry;
create function app_private.booking_expire_proposals(p_occurrence_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare ids uuid[];proposal uuid;context jsonb:=jsonb_build_object('actor_account_id',null,'command_id',gen_random_uuid());begin
 ids:=app_private.booking_expire_proposals_before_financial_entry(p_occurrence_id);
 for proposal in select distinct r.proposal_id from finance_private.amendment_funding_reservations r join app_private.operation_proposals p on p.id=r.proposal_id where p.occurrence_id=p_occurrence_id and r.state='reserved' and(p.state in('declined','expired') or r.expires_at<=now()) order by r.proposal_id loop perform finance_private.finance_release_amendment_funding(proposal,context);end loop;
 return ids;
end $$;
create or replace function app_private.booking_next_proposal_due(p_occurrence_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select min(expires_at) from(select expires_at from app_private.operation_proposals where occurrence_id=p_occurrence_id and state in('proposed','accepted','approved') union all select r.expires_at from finance_private.amendment_funding_reservations r join app_private.operation_proposals p on p.id=r.proposal_id where p.occurrence_id=p_occurrence_id and r.state='reserved')x
$$;
alter function app_private.process_occurrence_booking_due(uuid,text) rename to process_occurrence_booking_due_before_financial_entry;
create function app_private.process_occurrence_booking_due(p_occurrence_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform app_private.booking_lock_occurrence_finances(array[p_occurrence_id]);return app_private.process_occurrence_booking_due_before_financial_entry(p_occurrence_id,p_idempotency_key);
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in('booking_lock_occurrence_finances','booking_command','booking_command_before_financial_entry','booking_proposal_command','booking_proposal_command_before_financial_entry','booking_expire_proposals','booking_expire_proposals_before_financial_entry','process_occurrence_booking_due','process_occurrence_booking_due_before_financial_entry') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.proname='process_occurrence_booking_due' then execute format('grant execute on function %s to git_tutor_worker',f.signature);end if;end loop;end $$;
revoke create on schema app_private from git_tutor_commands;
