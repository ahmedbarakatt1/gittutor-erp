-- Preserve the applied history; make ambiguous column references explicitly prefer table columns.
do $$declare f record;definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='api'and p.proname in('review_delivery_exception','adjust_tutor_earning','amend_completion'))or(n.nspname='finance_private'and p.proname='finance_adjust_earning')loop
 definition:=pg_get_functiondef(f.oid);definition:=replace(definition,'AS $function$','AS $function$'||chr(10)||'#variable_conflict use_column'||chr(10));execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';

