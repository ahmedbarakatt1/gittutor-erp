-- Add useful source metrics and canonical follow-up routes without summing ledger facts.
grant create on schema app_private,api to git_tutor_operational_reader;
alter function api.get_workflow_operations() rename to get_workflow_operations_base;
alter function api.get_workflow_operations_base() set schema app_private;
revoke all on function app_private.get_workflow_operations_base() from public,anon,authenticated,service_role,git_tutor_worker;

create function app_private.operational_metric(p_key text,p_label text,p_value numeric,p_unit text default 'count') returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('key',p_key,'label',p_label,'value',p_value,'unit',p_unit,'basis','legacy_reported')
$$;
create function api.get_workflow_operations() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb:=app_private.get_workflow_operations_base(); section jsonb; item jsonb; field jsonb; metrics jsonb; records jsonb; sections jsonb:='[]'; scope text; key text; source_sessions int; source_packages int; source_students int; source_tutors int; scheduled int; completed int; canceled int; review_needed int; amount numeric; action jsonb;
begin
 if not coalesce((result->>'enabled')::boolean,false) then return result;end if;scope:=result->>'role';
 select coalesce(jsonb_array_length(s->'records'),0) into source_sessions from jsonb_array_elements(result->'sections') s where s->>'key'='sessions';
 select coalesce(jsonb_array_length(s->'records'),0) into source_packages from jsonb_array_elements(result->'sections') s where s->>'key'='packages';
 select coalesce(jsonb_array_length(s->'records'),0) into source_students from jsonb_array_elements(result->'sections') s where s->>'key'='customers';
 select coalesce(jsonb_array_length(s->'records'),0) into source_tutors from jsonb_array_elements(result->'sections') s where s->>'key'='team';
 select count(*) filter(where lower(r->>'reported_status')='scheduled'),count(*) filter(where lower(r->>'reported_status')='completed'),count(*) filter(where lower(r->>'reported_status')in('canceled','cancelled')) into scheduled,completed,canceled from jsonb_array_elements(result->'sections') s cross join lateral jsonb_array_elements(s->'records') r where s->>'key'='sessions';
 for section in select value from jsonb_array_elements(result->'sections') loop
  key:=section->>'key';metrics:=section->'metrics';records:='[]';
  if key='overview' then
   metrics:=jsonb_build_array(app_private.operational_metric('source_sessions','Reported sessions',coalesce(source_sessions,0)),app_private.operational_metric('scheduled_sessions','Reported scheduled',scheduled),app_private.operational_metric('completed_sessions','Reported completed',completed));
   if scope<>'tutor' then metrics:=metrics||jsonb_build_array(app_private.operational_metric('source_packages','Reported packages',coalesce(source_packages,0)),app_private.operational_metric('source_students','Imported learners',coalesce(source_students,0)));end if;
   if scope='owner' then metrics:=metrics||jsonb_build_array(app_private.operational_metric('source_tutors','Imported tutors',coalesce(source_tutors,0)));end if;
  elsif key='sessions' then
   select count(*) into review_needed from jsonb_array_elements(section->'records')r where r->'review'->>'state'='needs_review';
   metrics:=metrics||jsonb_build_array(app_private.operational_metric('scheduled_sessions','Reported scheduled',scheduled),app_private.operational_metric('completed_sessions','Reported completed',completed),app_private.operational_metric('canceled_sessions','Reported canceled',canceled),app_private.operational_metric('review_needed','Mappings need review',review_needed));
  elsif key='finance' and scope='owner' then
   for item in select value from jsonb_array_elements(section->'records') where value->>'source_table'='balances' loop
    for field in select value from jsonb_array_elements(item->'fields') where value->>'key' in('amount_minor','count') loop
     if jsonb_typeof(field->'value')='number' then
      amount:=(field->>'value')::numeric;
      if amount between -9007199254740991 and 9007199254740991 then metrics:=metrics||jsonb_build_array(app_private.operational_metric('reported_balance_'||(item->>'source_row')||'_'||(field->>'key'),item->>'title',amount,case when field->>'key'='amount_minor' then 'money' else 'count' end));end if;
     end if;
    end loop;
   end loop;
  end if;
  for item in select value from jsonb_array_elements(section->'records') loop
   action:=null;
   if scope in('owner','service') and item->'links'->>'learner_id' is not null then
    action:=jsonb_build_object('label','Open learner and follow-ups','href',case when scope='owner' then '/admin/customers?learner=' else '/service/customers?learner=' end||(item->'links'->>'learner_id')||'#new-activity');
   elsif scope='customer' and item->>'source_table' in('sessions','packages') and jsonb_array_length(item->'actions')=0 then
    action:=jsonb_build_object('label','Open current workflow','href',case when item->>'source_table'='packages' then '/learn/packages#new-activity' else '/learn/bookings#new-activity' end);
   elsif scope='tutor' and item->>'source_table'='sessions' and jsonb_array_length(item->'actions')=0 then
    action:=jsonb_build_object('label','Open assigned schedule','href','/tutor/schedule#new-activity');
   end if;
   if action is not null then item:=jsonb_set(item,'{actions}',(item->'actions')||jsonb_build_array(action));end if;
   records:=records||jsonb_build_array(item);
  end loop;
  sections:=sections||jsonb_build_array(jsonb_set(jsonb_set(section,'{metrics}',metrics),'{records}',records));
 end loop;
 return jsonb_set(result,'{sections}',sections);
end $$;
alter function app_private.operational_metric(text,text,numeric,text) owner to git_tutor_operational_reader;
alter function api.get_workflow_operations() owner to git_tutor_operational_reader;
revoke all on function app_private.operational_metric(text,text,numeric,text),api.get_workflow_operations() from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.get_workflow_operations() to authenticated;
revoke create on schema app_private,api from git_tutor_operational_reader;
notify pgrst,'reload schema';
