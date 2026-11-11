-- Actionable relationship/role read models carry the exact current version to the UI.
grant create on schema api to git_tutor_commands;
create function api.get_my_guardian_links(p_cursor text default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; after_time timestamptz; after_id uuid; result jsonb; next_cursor text;
begin
  actor:=app_private.require_actor();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is not null then
    begin after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception 'VALIDATION_ERROR'; end;
  end if;
  with matches as (
    select g.id,g.created_at,g.learner_id,p.display_name as learner_name,g.scopes,g.version,
      left(c.destination,1)||'***@'||split_part(c.destination,'@',2) as guardian_masked_contact,
      l.account_id=actor as can_revoke
    from app_private.guardian_links g join app_private.learners l on l.id=g.learner_id
    join app_private.people p on p.id=l.person_id
    join app_private.guardian_invitations i on i.id=g.invitation_id
    join app_private.verified_contacts c on c.id=i.contact_id
    where (l.account_id=actor or g.guardian_account_id=actor) and g.revoked_at is null
      and g.valid_from<=now() and g.valid_until>now()
      and (p_cursor is null or (g.created_at,g.id)>(after_time,after_id))
    order by g.created_at,g.id limit p_limit+1
  ), page as (select * from matches order by created_at,id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('guardian_link_id',id,'learner_id',learner_id,'learner_name',learner_name,
    'guardian_masked_contact',guardian_masked_contact,'scopes',scopes,'version',version,'can_revoke',can_revoke) order by created_at,id),'[]'),
    case when (select count(*) from matches)>p_limit then (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id::text from page order by created_at desc,id desc limit 1) end
    into result,next_cursor from page;
  return jsonb_build_object('items',result,'next_cursor',next_cursor);
end $$;
alter function api.get_my_guardian_links(text,integer) owner to git_tutor_commands;
revoke all on function api.get_my_guardian_links(text,integer) from public,anon;
grant execute on function api.get_my_guardian_links(text,integer) to authenticated;

create function api.list_staff_role_grants(p_cursor text default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; after_time timestamptz; after_id uuid; result jsonb; next_cursor text;
begin
  actor:=app_private.require_actor(); perform app_private.require_role(actor,'admin');
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is not null then
    begin after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception 'VALIDATION_ERROR'; end;
  end if;
  with matches as (
    select r.id,r.created_at,r.account_id,p.display_name,r.role,r.version,
      case when c.id is null then null else left(c.destination,1)||'***@'||split_part(c.destination,'@',2) end as masked_email
    from app_private.account_roles r join app_private.accounts a on a.id=r.account_id
    join app_private.people p on p.id=a.person_id
    left join app_private.verified_contacts c on c.account_id=a.id and c.channel='email' and c.revoked_at is null and c.verified_at is not null
    where r.revoked_at is null and a.active and r.role in ('admin','customer_service','tutor')
      and (p_cursor is null or (r.created_at,r.id)>(after_time,after_id))
    order by r.created_at,r.id limit p_limit+1
  ), page as (select * from matches order by created_at,id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('role_grant_id',id,'account_id',account_id,'display_name',display_name,
    'masked_email',masked_email,'role',role,'version',version) order by created_at,id),'[]'),
    case when (select count(*) from matches)>p_limit then (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id::text from page order by created_at desc,id desc limit 1) end
    into result,next_cursor from page;
  return jsonb_build_object('items',result,'next_cursor',next_cursor);
end $$;
alter function api.list_staff_role_grants(text,integer) owner to git_tutor_commands;
revoke all on function api.list_staff_role_grants(text,integer) from public,anon;
grant execute on function api.list_staff_role_grants(text,integer) to authenticated;
revoke create on schema api from git_tutor_commands;
notify pgrst,'reload schema';
