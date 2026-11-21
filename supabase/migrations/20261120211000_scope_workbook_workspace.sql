grant create on schema app_private,api to git_tutor_operational_reader;

create function app_private.scoped_workflow_base(p_workspace text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); batch uuid; scope text; l app_private.operational_workbook_links%rowtype; item jsonb; sessions jsonb:='[]'; packages jsonb:='[]'; students jsonb:='[]'; tutors jsonb:='[]'; finance jsonb:='[]'; campaigns jsonb:='[]'; sections jsonb:='[]'; learners_options jsonb:='[]'; tutors_options jsonb:='[]';
begin
 if p_workspace is not null and p_workspace not in ('learn','tutor','service','admin') then
  raise exception 'VALIDATION_ERROR';
 end if;
 if (p_workspace='admin' and not app_private.has_role(actor,'admin')) or
    (p_workspace='service' and not app_private.has_role(actor,'customer_service')) or
    (p_workspace='tutor' and not app_private.has_role(actor,'tutor')) then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 -- Select a batch and a projection together. Even a dual-role account only gets
 -- the requested workspace and must satisfy that workspace's relationship check.
 select b.id, access.scope into batch, scope
 from app_private.workflow_import_batches b
 cross join lateral (values
  ('admin','owner',1,b.owner_account_id=actor and app_private.has_role(actor,'admin')),
  ('service','service',2,app_private.has_role(actor,'customer_service') and exists(
    select 1 from app_private.operational_workbook_access a where a.batch_id=b.id and a.account_id=actor)),
  ('tutor','tutor',3,app_private.has_role(actor,'tutor') and exists(
    select 1 from app_private.operational_workbook_links x join app_private.tutors t on t.id=x.tutor_id
    where x.batch_id=b.id and t.account_id=actor)),
  ('learn','customer',4,exists(
    select 1 from app_private.operational_workbook_links x where x.batch_id=b.id
    and x.source_table in ('students','sessions','packages')
    and app_private.operational_learner_scope(actor,x.learner_id,
      case x.source_table when 'students' then 'profile' when 'packages' then 'payments' else 'booking' end)))
 ) as access(workspace,scope,priority,permitted)
 where access.permitted and (p_workspace is null or access.workspace=p_workspace)
 and exists(select 1 from app_private.operational_workbook_links where batch_id=b.id)
 order by b.imported_at desc,b.id desc,access.priority limit 1;
 if batch is null then return jsonb_build_object('enabled',false); end if;
 for l in select * from app_private.operational_workbook_links x where x.batch_id=batch and (
  scope='owner' or (scope='service' and x.source_table in('students','sessions','packages')) or
  (scope='tutor' and x.source_table='sessions' and exists(select 1 from app_private.tutors t where t.id=x.tutor_id and t.account_id=actor)) or
  (scope='customer' and x.source_table in('students','sessions','packages') and app_private.operational_learner_scope(actor,x.learner_id,case x.source_table when 'students' then 'profile' when 'packages' then 'payments' else 'booking' end)))
 order by x.source_table,x.source_row loop
  item:=app_private.operational_record(l.id,scope,actor);
  case l.source_table when 'sessions' then sessions:=sessions||jsonb_build_array(item); when 'packages' then packages:=packages||jsonb_build_array(item); when 'students' then students:=students||jsonb_build_array(item); when 'tutors' then tutors:=tutors||jsonb_build_array(item); when 'marketing' then campaigns:=campaigns||jsonb_build_array(item); else finance:=finance||jsonb_build_array(item);end case;
 end loop;
 sections:=jsonb_build_array(app_private.operational_section('overview','Imported operating history',sessions||packages),app_private.operational_section('sessions','Reported sessions',sessions));
 if scope='tutor' then sections:=sections||jsonb_build_array(app_private.operational_section('tutor_pay','Reported tutor fees',sessions));
 else sections:=sections||jsonb_build_array(app_private.operational_section('customers','Imported learners',students),app_private.operational_section('students','Learner history',students),app_private.operational_section('packages','Reported packages',packages),app_private.operational_section('payments','Reported customer payments',sessions||packages));end if;
 if scope='owner' then
  sections:=sections||jsonb_build_array(app_private.operational_section('finance','Reported source balances',finance),app_private.operational_section('team','Imported tutors',tutors),app_private.operational_section('campaigns','Reported marketing expenses',campaigns),app_private.operational_section('tutor_pay','Reported tutor fees',sessions));
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'display_name',q.display_name) order by q.display_name,q.id),'[]') into learners_options from (select distinct n.id,p.display_name from app_private.operational_workbook_links x join app_private.learners n on n.id=x.learner_id join app_private.people p on p.id=n.person_id where x.batch_id=batch and x.source_table='students')q;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'display_name',q.display_name) order by q.display_name,q.id),'[]') into tutors_options from (select distinct t.id,p.display_name from app_private.operational_workbook_links x join app_private.tutors t on t.id=x.tutor_id join app_private.accounts a on a.id=t.account_id join app_private.people p on p.id=a.person_id where x.batch_id=batch and x.source_table='tutors')q;
 end if;
 return jsonb_build_object('enabled',true,'role',scope,'mapping_options',jsonb_build_object('learners',learners_options,'tutors',tutors_options),'sections',sections);
end $$;

create function app_private.workflow_projection_metrics(result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare section jsonb; item jsonb; field jsonb; metrics jsonb; records jsonb; sections jsonb:='[]'; scope text; key text; source_sessions int; source_packages int; source_students int; source_tutors int; scheduled int; completed int; canceled int; review_needed int; amount numeric; action jsonb;
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

-- Preserve the original RPC for legacy authorized clients, including its role
-- precedence within a batch. Portal reads always use the scoped RPC below.
create or replace function app_private.get_workflow_operations_base() returns jsonb
 language sql security definer set search_path='' as $$
 select app_private.scoped_workflow_base(null)
$$;
create or replace function api.get_workflow_operations() returns jsonb
 language sql security definer set search_path='' as $$
 select app_private.workflow_projection_metrics(app_private.get_workflow_operations_base())
$$;
create function api.get_workspace_operations(p_workspace text) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if p_workspace is null then raise exception 'VALIDATION_ERROR'; end if;
 return app_private.workflow_projection_metrics(app_private.scoped_workflow_base(p_workspace));
end $$;
alter function app_private.scoped_workflow_base(text) owner to git_tutor_operational_reader;
alter function app_private.workflow_projection_metrics(jsonb) owner to git_tutor_operational_reader;
alter function api.get_workspace_operations(text) owner to git_tutor_operational_reader;
revoke all on function app_private.scoped_workflow_base(text),app_private.workflow_projection_metrics(jsonb),
 api.get_workspace_operations(text) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.get_workspace_operations(text) to authenticated;
revoke create on schema app_private,api from git_tutor_operational_reader;
notify pgrst,'reload schema';
