-- Reviewed cancellation terms disclose actual funding and entitlement balances.
-- Their customer authority is narrower than ordinary tuition-only proposals.
grant create on schema app_private to git_tutor_commands;

alter function app_private.booking_proposal_dto(uuid,uuid,text,uuid,boolean)
 rename to booking_proposal_dto_before_financial_scope;
create function app_private.booking_proposal_dto(p_actor uuid,p_id uuid,p_view text,p_learner_id uuid,p_group boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;learner uuid;
begin
 result:=app_private.booking_proposal_dto_before_financial_scope(p_actor,p_id,p_view,p_learner_id,p_group);
 if p_view='customer' and exists(select 1 from finance_private.cancellation_customer_finances where proposal_id=p_id) then
  learner:=(result->'terms'->>'learner_id')::uuid;
  perform app_private.assert_learner_scope(p_actor,learner,'booking');
  perform app_private.assert_learner_scope(p_actor,learner,'payments');
 end if;
 return result;
end $$;

alter function app_private.booking_proposal_participant(uuid,uuid,text)
 rename to booking_proposal_participant_before_financial_scope;
create function app_private.booking_proposal_participant(p_actor uuid,p_id uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=app_private.booking_proposal_participant_before_financial_scope(p_actor,p_id,p_hash);
 if result->>'type'='learner' and exists(select 1 from finance_private.cancellation_customer_finances where proposal_id=p_id) then
  perform app_private.assert_learner_scope(p_actor,(result->>'id')::uuid,'payments');
 end if;
 return result;
end $$;

alter function app_private.booking_proposal_all_accepted(uuid,boolean)
 rename to booking_proposal_all_accepted_before_financial_scope;
create function app_private.booking_proposal_all_accepted(p_id uuid,p_recheck boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare accepted record;
begin
 if not app_private.booking_proposal_all_accepted_before_financial_scope(p_id,p_recheck) then return false;end if;
 if p_recheck and exists(select 1 from finance_private.cancellation_customer_finances where proposal_id=p_id) then
  for accepted in
   select a.actor_account_id,c.learner_id
   from app_private.operation_customer_terms c
   join app_private.operation_proposal_acceptances a
     on a.proposal_id=c.proposal_id and a.participant_type='learner'
    and a.participant_id=c.learner_id and a.terms_hash=c.terms_hash
   where c.proposal_id=p_id order by c.learner_id
  loop
   -- The delegated recheck already validates active verified actors and booking scope.
   -- Lock current payment relationships too before approval or any financial posting.
   perform app_private.assert_learner_scope(accepted.actor_account_id,accepted.learner_id,'payments');
  end loop;
 end if;
 return true;
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname in(
  'booking_proposal_dto','booking_proposal_dto_before_financial_scope',
  'booking_proposal_participant','booking_proposal_participant_before_financial_scope',
  'booking_proposal_all_accepted','booking_proposal_all_accepted_before_financial_scope')
 loop
  execute format('alter function %s owner to git_tutor_commands',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
 end loop;
end $$;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';
