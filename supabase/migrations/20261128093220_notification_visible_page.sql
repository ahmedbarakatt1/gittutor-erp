-- Page the indexed delivery stream before calling the current-authority recipient projection.
-- A revoked item is skipped, so a page can still contain its full quota of visible notifications.
create or replace function api.list_my_notifications(p_limit integer default 25, p_cursor uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid := app_private.require_actor();
  after_at timestamptz;
  delivery record;
  visible_content jsonb;
  items jsonb := '[]'::jsonb;
  next_id uuid;
  visible_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is not null then
    select d.created_at into after_at from app_private.notification_deliveries d
      where d.id=p_cursor and d.recipient_account_id=actor and d.channel='in_app';
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  for delivery in
    select d.id,d.event_id,d.created_at,d.audience,d.state from app_private.notification_deliveries d
      where d.recipient_account_id=actor and d.channel='in_app'
        and (p_cursor is null or (d.created_at,d.id)<(after_at,p_cursor))
      order by d.created_at desc,d.id desc
  loop
    select r.content into visible_content from app_private.notification_recipients(delivery.event_id) r
      where r.account_id=actor and r.audience=delivery.audience;
    if not found then continue; end if;
    items := items || jsonb_build_array(jsonb_build_object('delivery_id',delivery.id,'event_id',delivery.event_id,
      'created_at',delivery.created_at,'state',delivery.state,'content',visible_content));
    visible_count := visible_count+1;
    if visible_count=p_limit then next_id:=delivery.id; exit; end if;
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_id);
end $$;
