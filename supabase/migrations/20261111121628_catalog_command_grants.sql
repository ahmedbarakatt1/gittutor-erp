-- The first catalog migration's final ownership block preceded its command wrappers.
-- Preserve the applied migration and apply the restricted grants after every definition exists.
grant create on schema api,app_private to git_tutor_commands;
do $$ declare f record; begin
  for f in select p.oid::regprocedure::text as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='api' and p.proname in ('create_policy_draft','update_policy_draft','approve_policy_version','create_pricing_draft','update_pricing_draft','approve_pricing_version','create_offer','publish_offer','approve_tutor_profile'))
       or (n.nspname='app_private' and p.proname='assert_exact_tutor_fee') loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
    if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
