grant create on schema api,app_private to git_tutor_commands;
alter function api.get_payment_instructions(uuid) set schema app_private;
alter function app_private.get_payment_instructions(uuid) rename to get_payment_instructions_before_transfer;
create function api.get_payment_instructions(p_charge_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;proposal uuid;funding jsonb;begin
 -- Preserve the existing verified actor and current payment-scope checks first.
 result:=app_private.get_payment_instructions_before_transfer(p_charge_id);
 proposal:=(result->'charge'->>'conditional_transfer_proposal_id')::uuid;
 if proposal is not null and result->'charge'->>'commitment_state'='awaiting_transfer' and app_private.booking_proposal_fresh(proposal) then
  funding:=app_private.enrollment_transfer_funding(proposal);
  -- Planned carryover is a separate consent prerequisite, never a posted payment.
  -- Only the additional-payment instruction changes; actual debt and status stay intact.
  result:=result||jsonb_build_object('additional_required_minor',funding->'additional_required_minor');
 end if;
 return result;
end $$;
alter function api.get_payment_instructions(uuid) owner to git_tutor_commands;
revoke all on function api.get_payment_instructions(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
revoke all on function app_private.get_payment_instructions_before_transfer(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.get_payment_instructions(uuid) to authenticated;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
