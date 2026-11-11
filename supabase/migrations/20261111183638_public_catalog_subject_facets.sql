-- All eligible subject choices travel with one bounded offer page. Facets do not
-- expand offer DTOs, availability or private commercial fields.
create or replace function api.list_public_offers(
 p_subject_id uuid default null,p_format text default null,p_from timestamptz default null,
 p_to timestamptz default null,p_offer_id uuid default null,p_cursor text default null,p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;subjects jsonb;begin
 result:=app_private.catalog_read_page('public_offers',jsonb_build_object('subject_id',p_subject_id,'format',p_format,'from',p_from,'to',p_to,'offer_id',p_offer_id),p_cursor,p_limit);
 select coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'title',s.title,'slug',s.slug) order by s.title,s.id),'[]')
 into subjects from app_private.subjects s
 where exists(select 1 from app_private.offers o where o.subject_id=s.id and app_private.booking_offer_sellable(o.id));
 return result||jsonb_build_object('subjects',subjects);
end $$;
-- CREATE OR REPLACE retains the existing command owner and exact anon grant.
notify pgrst,'reload schema';
