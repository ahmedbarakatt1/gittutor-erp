-- Current offered-seat projection; preserve posted history and existing cursor order.
create or replace function app_private.booking_read(p_kind text,p_filters jsonb,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;teacher uuid;rows jsonb;items jsonb;after_at timestamptz;after_id uuid;from_at timestamptz;to_at timestamptz;next_cursor text;target uuid;learner uuid;begin
 actor:=app_private.require_actor();if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_kind in ('admin_occurrences','admin_fees','admin_availability','learners_admin') then perform app_private.require_role(actor,'admin');
 elsif p_kind in ('tutor_occurrences','tutor_fees','availability') then perform app_private.require_role(actor,'tutor');select id into teacher from app_private.tutors where account_id=actor;if teacher is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;end if;
 if p_kind in ('availability','admin_availability') then target:=coalesce(teacher,(p_filters->>'tutor_id')::uuid);if not exists(select 1 from app_private.tutors where id=target) then raise exception 'NOT_FOUND' using errcode='P0002';end if;return app_private.booking_availability_dto(target);end if;
 if p_kind in ('enrollment','quote') then
  if p_kind='quote' then select e.learner_id into learner from app_private.quotes q join app_private.enrollments e on e.id=q.enrollment_id where q.id=(p_filters->>'quote_id')::uuid;
  else select learner_id into learner from app_private.enrollments where id=(p_filters->>'enrollment_id')::uuid;end if;
  if learner is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,learner,'booking',true);
  return case when p_kind='quote' then app_private.booking_quote_dto((p_filters->>'quote_id')::uuid) else app_private.booking_enrollment_dto((p_filters->>'enrollment_id')::uuid) end;
 end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;end if;
 from_at:=coalesce((p_filters->>'from')::timestamptz,now());to_at:=coalesce((p_filters->>'to')::timestamptz,now()+interval '90 days');if not isfinite(from_at) or not isfinite(to_at) or(from_at>=to_at and(p_filters->>'occurrence_id' is null or(p_filters->>'from' is not null and p_filters->>'to' is not null))) then raise exception 'INVALID_TIME';end if;
 if p_filters->>'format' is not null and p_filters->>'format' not in ('private','group') then raise exception 'VALIDATION_ERROR';end if;
 if p_kind in ('enrollments','waitlist') and p_filters->>'learner_id' is not null then perform app_private.assert_learner_scope(actor,(p_filters->>'learner_id')::uuid,'booking');end if;
 if p_kind in ('occurrences','admin_occurrences','tutor_occurrences') then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('draft','forming','confirmed','in_progress','completion_pending','completed','cancelled') then raise exception 'VALIDATION_ERROR';end if;
  if p_kind='occurrences' and not app_private.booking_offer_sellable((p_filters->>'offer_id')::uuid) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',case when p_kind='occurrences' then app_private.booking_occurrence_dto(x.id) else app_private.booking_staff_occurrence_dto(x.id,p_kind='admin_occurrences') end) order by x.start_at,x.id),'[]') into rows from(
   select o.* from app_private.occurrences o where((p_filters->>'occurrence_id' is not null and p_filters->>'from' is null) or o.start_at>=from_at) and((p_filters->>'occurrence_id' is not null and p_filters->>'to' is null) or o.start_at<to_at) and(p_filters->>'occurrence_id' is null or o.id=(p_filters->>'occurrence_id')::uuid) and(p_cursor is null or(o.start_at,o.id)>(after_at,after_id)) and(p_filters->>'state' is null or o.state=p_filters->>'state') and(p_filters->>'format' is null or o.format=p_filters->>'format') and(p_filters->>'tutor_id' is null or o.tutor_id=(p_filters->>'tutor_id')::uuid)
   and(p_kind<>'occurrences' or(o.offer_id=(p_filters->>'offer_id')::uuid and (o.state='confirmed' or(o.state='forming' and o.confirmation_deadline_at>now())) and o.start_at>now() and app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor'))) and(p_kind<>'tutor_occurrences' or o.tutor_id=teacher) order by o.start_at,o.id limit p_limit+1)x;
 elsif p_kind='enrollments' then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('held','confirmed','cancelled','expired') then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.start_at,'data',app_private.booking_enrollment_dto(x.id)) order by x.start_at,x.id),'[]') into rows from(
   select e.id,o.start_at from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id where app_private.booking_can_access(actor,e.learner_id) and(p_filters->>'learner_id' is null or e.learner_id=(p_filters->>'learner_id')::uuid) and(p_filters->>'state' is null or e.state=p_filters->>'state') and o.start_at>=from_at and o.start_at<to_at and(p_cursor is null or(o.start_at,e.id)>(after_at,after_id)) order by o.start_at,e.id limit p_limit+1)x;
 elsif p_kind in ('tutor_fees','admin_fees') then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.booking_fee_dto(x.id)) order by x.created_at,x.id),'[]') into rows from(
   select f.id,f.approved_at as created_at from finance_private.tutor_fee_agreements f join app_private.occurrences o on o.id=f.occurrence_id where(p_kind<>'tutor_fees' or(f.tutor_id=teacher and o.start_at>=from_at and o.start_at<to_at)) and(p_kind<>'admin_fees' or f.occurrence_id=(p_filters->>'occurrence_id')::uuid) and(p_cursor is null or(f.approved_at,f.id)>(after_at,after_id)) order by f.approved_at,f.id limit p_limit+1)x;
 elsif p_kind in ('learners','learners_admin') then
  if p_filters->>'q' is not null and length(p_filters->>'q')>200 then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',jsonb_build_object('learner_id',x.id,'display_name',x.display_name)) order by x.created_at,x.id),'[]') into rows from(
   select l.id,l.created_at,p.display_name from app_private.learners l join app_private.people p on p.id=l.person_id join app_private.accounts a on a.id=l.account_id
   where a.active and(p_kind='learners_admin' or app_private.booking_can_access(actor,l.id)) and exists(select 1 from app_private.auth_account(a.id) u where u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) and(p_filters->>'q' is null or p.display_name ilike '%'||(p_filters->>'q')||'%') and(p_cursor is null or(l.created_at,l.id)>(after_at,after_id)) order by l.created_at,l.id limit p_limit+1)x;
 elsif p_kind='waitlist' then
  if p_filters->>'state' is not null and p_filters->>'state' not in ('waiting','offered','accepted','expired','cancelled','ineligible') then raise exception 'VALIDATION_ERROR';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',jsonb_build_object('waitlist_entry_id',x.id,'version',x.version,'learner_id',x.learner_id,'occurrence',app_private.booking_occurrence_dto(x.occurrence_id),'state',x.state,'position',case when x.state='waiting' then(select count(*) from app_private.waitlist_entries w where w.occurrence_id=x.occurrence_id and w.state='waiting' and(w.created_at,w.id)<=(x.created_at,x.id)) else null end,'offered_enrollment_id',x.offered_enrollment_id,'offer_expires_at',(select hold_expires_at from app_private.enrollments where id=x.offered_enrollment_id))) order by x.created_at,x.id),'[]') into rows from(
   select w.* from app_private.waitlist_entries w where app_private.booking_can_access(actor,w.learner_id) and(p_filters->>'learner_id' is null or w.learner_id=(p_filters->>'learner_id')::uuid) and(p_filters->>'state' is null or w.state=p_filters->>'state')
   -- The offered filter is an actionable queue. Unfiltered reads retain every posted historical state.
   and(p_filters->>'state' is distinct from 'offered' or exists(
    select 1 from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id join app_private.quotes q on q.id=e.current_quote_id
    where e.id=w.offered_enrollment_id and e.learner_id=w.learner_id and e.occurrence_id=w.occurrence_id
      and e.state='held' and e.hold_kind='ordinary' and e.hold_expires_at>now() and q.expires_at>now() and q.base_terms_version=o.quote_terms_version
      and o.state='forming' and o.confirmation_deadline_at>now() and o.start_at>now() and app_private.booking_offer_sellable(o.offer_id)
      and app_private.has_role((select account_id from app_private.tutors where id=o.tutor_id),'tutor')))
   and(p_cursor is null or(w.created_at,w.id)>(after_at,after_id)) order by w.created_at,w.id limit p_limit+1)x;
 else raise exception 'VALIDATION_ERROR';end if;
 select coalesce(jsonb_agg(value->'data' order by ordinality),'[]') into items from jsonb_array_elements(rows) with ordinality where ordinality<=p_limit;
 if jsonb_array_length(rows)>p_limit then next_cursor:=(rows->(p_limit-1)->>'at')||'|'||(rows->(p_limit-1)->>'id');end if;return jsonb_build_object('items',items,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;
