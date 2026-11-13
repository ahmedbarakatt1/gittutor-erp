-- Dedicated authorized actual-data preview retains a marker excluded by destructive test helpers.
create or replace function app_private.catalog_environment() returns text language plpgsql stable security definer set search_path='' as $$
declare e text; m text; begin
 select environment,fixture_marker into e,m from app_private.environment_metadata;
 if e not in ('production','staging','test','development') or e is null then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
 if e in ('test','development') and not (m='git-tutor-supabase-local-v1' or (e='development' and m='git-tutor-operational-preview-v1')) then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
 if e in ('test','development') and m is null then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
 return e;
end $$;
notify pgrst,'reload schema';
