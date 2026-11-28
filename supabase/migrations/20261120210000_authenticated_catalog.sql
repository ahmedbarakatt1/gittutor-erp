-- Published record projections require a verified, current application account.
create or replace function api.list_public_offers(
 p_subject_id uuid default null,p_format text default null,p_from timestamptz default null,
 p_to timestamptz default null,p_offer_id uuid default null,p_cursor text default null,p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;subjects jsonb;begin
 perform app_private.require_actor();
 result:=app_private.catalog_read_page('public_offers',jsonb_build_object('subject_id',p_subject_id,'format',p_format,'from',p_from,'to',p_to,'offer_id',p_offer_id),p_cursor,p_limit);
 select coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'title',s.title,'slug',s.slug) order by s.title,s.id),'[]')
 into subjects from app_private.subjects s
 where exists(select 1 from app_private.offers o where o.subject_id=s.id and app_private.booking_offer_sellable(o.id));
 return result||jsonb_build_object('subjects',subjects);
end $$;

create or replace function api.get_public_tutor(p_tutor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  perform app_private.require_actor();
  select jsonb_build_object('tutor_id',t.id,'display_name',p.display_name,'bio',p.bio,'photo_reference',null,
    'subjects',coalesce((select jsonb_agg(jsonb_build_object('subject_id',s.id,'title',s.title,'slug',s.slug) order by s.title,s.id) from app_private.subjects s where s.id=any(p.subject_ids) and s.active),'[]'))
  into result from app_private.tutors t join app_private.tutor_profile_versions p on p.id=t.approved_profile_version_id and p.tutor_id=t.id and p.state='approved'
  where t.id=p_tutor_id and app_private.has_role(t.account_id,'tutor');
  if result is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if; return result;
end $$;

revoke execute on function api.list_public_offers(uuid,text,timestamptz,timestamptz,uuid,text,integer), api.get_public_tutor(uuid) from public, anon;
notify pgrst, 'reload schema';
