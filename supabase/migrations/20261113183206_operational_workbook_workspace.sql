-- Main-workspace source lineage. A mapping review never verifies money or delivery.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='git_tutor_operational_reader') then create role git_tutor_operational_reader nologin nobypassrls; end if;
end $$;
grant git_tutor_operational_reader to postgres;
grant usage on schema app_private,api to git_tutor_operational_reader;
grant create on schema app_private,api to git_tutor_operational_reader,git_tutor_commands;

create table app_private.operational_workbook_links (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references app_private.workflow_import_batches(id),
 source_table text not null check(source_table in('sessions','packages','students','tutors','marketing','distributions','balances')),
 source_row integer not null check(source_row>0), learner_id uuid references app_private.learners(id), tutor_id uuid references app_private.tutors(id),
 occurrence_id uuid references app_private.occurrences(id), package_id uuid references app_private.package_purchases(id),
 review_state text not null default 'needs_review' check(review_state in('needs_review','linked','reviewed')),
 version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(batch_id,source_table,source_row)
);
create index operational_links_learner on app_private.operational_workbook_links(learner_id,batch_id);
create index operational_links_tutor on app_private.operational_workbook_links(tutor_id,batch_id);
create table app_private.operational_workbook_access (
 batch_id uuid not null references app_private.workflow_import_batches(id), account_id uuid not null references app_private.accounts(id),
 access_scope text not null default 'customer_service' check(access_scope='customer_service'), created_by uuid not null references app_private.accounts(id),
 created_at timestamptz not null default now(), primary key(batch_id,account_id)
);
create table app_private.operational_workbook_reviews (
 id uuid primary key default gen_random_uuid(), link_id uuid not null references app_private.operational_workbook_links(id), actor_id uuid not null references app_private.accounts(id),
 previous_version integer not null, previous_links jsonb not null, reviewed_links jsonb not null, review_state text not null, reason text not null,
 idempotency_key text not null, request_hash text not null, result jsonb not null, created_at timestamptz not null default now(),
 unique(actor_id,idempotency_key), unique(link_id,previous_version)
);
do $$ declare t text; begin
 foreach t in array array['operational_workbook_links','operational_workbook_access','operational_workbook_reviews'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('alter table app_private.%I force row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,git_tutor_worker',t);
  execute format('grant select on app_private.%I to git_tutor_operational_reader,git_tutor_commands',t);
  execute format('create policy operational_reader on app_private.%I for select to git_tutor_operational_reader using(true)',t);
  execute format('create policy operational_commands on app_private.%I to git_tutor_commands using(true) with check(true)',t);
 end loop;
 foreach t in array array['workflow_import_batches','people','accounts','account_roles','learners','tutors','guardian_links'] loop
  execute format('grant select on app_private.%I to git_tutor_operational_reader',t);
  execute format('create policy operational_workspace_reader on app_private.%I for select to git_tutor_operational_reader using(true)',t);
 end loop;
end $$;
grant select on app_private.workflow_import_batches to git_tutor_commands;
create policy operational_review_batch on app_private.workflow_import_batches for select to git_tutor_commands using(true);
grant update on app_private.operational_workbook_links to git_tutor_commands;
grant insert on app_private.operational_workbook_reviews to git_tutor_commands;
create trigger immutable_row before update or delete on app_private.operational_workbook_reviews for each row execute function app_private.reject_immutable_change();
grant execute on function app_private.require_actor(boolean),app_private.has_role(uuid,text) to git_tutor_operational_reader;

create function app_private.operational_learner_scope(p_actor uuid,p_learner uuid,p_scope text) returns boolean language sql stable security definer set search_path='' as $$
 select p_learner is not null and (exists(select 1 from app_private.learners where id=p_learner and account_id=p_actor) or exists(
  select 1 from app_private.guardian_links where learner_id=p_learner and guardian_account_id=p_actor and revoked_at is null and valid_from<=now() and valid_until>now() and p_scope=any(scopes)))
$$;
create function app_private.operational_field(p_key text,p_label text,p_value jsonb,p_type text default 'text') returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('key',p_key,'label',p_label,'value',coalesce(p_value,'null'::jsonb),'type',p_type)
$$;
create function app_private.operational_record(p_link uuid,p_role text,p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l app_private.operational_workbook_links%rowtype; r jsonb; v jsonb; fields jsonb:='[]'; actions jsonb:='[]'; title text; subtitle text; status text; d text; money_allowed boolean;
begin
 select * into l from app_private.operational_workbook_links where id=p_link;
 select x into r from app_private.workflow_import_batches b cross join lateral jsonb_array_elements(b.snapshot->'tables'->l.source_table->'rows') x where b.id=l.batch_id and (x->>'source_row')::int=l.source_row;
 if r is null then raise exception 'NOT_FOUND'; end if; v:=r->'values';
 money_allowed:=p_role in('owner','service') or app_private.operational_learner_scope(p_actor,l.learner_id,'payments');
 if l.source_table='sessions' then
  title:=coalesce(nullif(v->>'col_f',''),'Course needs review'); subtitle:=coalesce(v->>'col_e','Learner needs review')||' · '||coalesce(v->>'col_h','Tutor needs review'); status:=v->>'col_i'; d:=v->>'col_a';
  fields:=jsonb_build_array(app_private.operational_field('student','Learner',v->'col_e'),app_private.operational_field('course','Course',v->'col_f'),app_private.operational_field('topic','Topic',v->'col_g'),app_private.operational_field('tutor','Tutor',v->'col_h'),app_private.operational_field('start_time','Reported start',v->'col_c'),app_private.operational_field('end_time','Reported end',v->'col_d'));
  if p_role<>'tutor' then fields:=fields||jsonb_build_array(app_private.operational_field('billing','Billing',v->'col_n'),app_private.operational_field('package_reference','Package reference',v->'col_o')); end if;
  if money_allowed and p_role<>'tutor' then fields:=fields||jsonb_build_array(app_private.operational_field('tuition_minor','Reported tuition',v->'col_q','money'),app_private.operational_field('deposit_paid_minor','Reported deposit paid',v->'col_r','money'),app_private.operational_field('balance_paid_minor','Reported balance paid',v->'col_t','money'),app_private.operational_field('refunded_minor','Reported refunded',v->'col_v','money'),app_private.operational_field('collected_minor','Reported collected',v->'col_aa','money'),app_private.operational_field('student_balance_minor','Reported student balance',v->'col_ab','money')); end if;
  if p_role in('owner','tutor') then fields:=fields||jsonb_build_array(app_private.operational_field('tutor_fee_due_minor','Reported tutor fee due',v->'col_ad','money'),app_private.operational_field('tutor_fee_paid_minor','Reported tutor fee paid',v->'col_w','money'),app_private.operational_field('tutor_fee_balance_minor','Reported tutor balance',v->'col_ae','money')); end if;
  if p_role='owner' then fields:=fields||jsonb_build_array(app_private.operational_field('notes','Source notes',v->'col_j'),app_private.operational_field('action_needed','Source action',v->'col_ag')); end if;
  if l.occurrence_id is not null and p_role in('owner','tutor') then actions:=jsonb_build_array(jsonb_build_object('label','Open operational session','href',case when p_role='owner' then '/admin/schedule?occurrence=' else '/tutor/schedule?occurrence=' end||l.occurrence_id::text)); end if;
 elsif l.source_table='packages' then
  title:=coalesce(v->>'col_a','Package');subtitle:=coalesce(v->>'col_b','Learner needs review');status:=v->>'col_d';d:=v->>'col_c';
  fields:=jsonb_build_array(app_private.operational_field('student','Learner',v->'col_b'),app_private.operational_field('package_reference','Package reference',v->'col_a'),app_private.operational_field('sessions_purchased','Reported purchased sessions',v->'col_f','number'),app_private.operational_field('carried_in_sessions','Reported carried sessions',v->'col_h','number'),app_private.operational_field('total_sessions','Reported total sessions',v->'col_i','number'),app_private.operational_field('sessions_completed','Reported completed sessions',v->'col_t','number'),app_private.operational_field('sessions_scheduled','Reported scheduled sessions',v->'col_u','number'),app_private.operational_field('sessions_remaining','Reported remaining sessions',v->'col_w','number'),app_private.operational_field('not_scheduled','Reported unscheduled sessions',v->'col_x','number'),app_private.operational_field('renewal_reference','Previous package',v->'col_g'),app_private.operational_field('package_price_minor','Reported package price',v->'col_e','money'),app_private.operational_field('collected_minor','Reported collected',v->'col_r','money'),app_private.operational_field('student_balance_minor','Reported student balance',v->'col_s','money'));
  if p_role='owner' then fields:=fields||jsonb_build_array(app_private.operational_field('tutor_fee_due_minor','Reported tutor fees due',v->'col_y','money'),app_private.operational_field('tutor_fee_paid_minor','Reported tutor fees paid',v->'col_z','money'),app_private.operational_field('tutor_fee_balance_minor','Reported tutor balance',v->'col_aa','money'),app_private.operational_field('action_needed','Source action',v->'col_ac'));end if;
  if l.package_id is not null then actions:=jsonb_build_array(jsonb_build_object('label','Open operational package','href',case when p_role='owner' then '/admin/packages' else '/learn/packages/'||l.package_id::text end));end if;
 elsif l.source_table='students' then
  title:=coalesce(v->>'col_a','Learner');subtitle:='Source learner profile';
  fields:=jsonb_build_array(app_private.operational_field('current_courses','Current courses',v->'col_b'),app_private.operational_field('faculty','Faculty',v->'col_c'),app_private.operational_field('university','University',v->'col_d'),app_private.operational_field('previous_courses','Previous courses',v->'col_g'));
  if p_role in('owner','service') then fields:=fields||jsonb_build_array(app_private.operational_field('contact','Unverified source contact',v->'col_e'),app_private.operational_field('parent_contact','Unverified parent contact',v->'col_f'));end if;
 elsif l.source_table='tutors' then
  title:=coalesce(v->>'col_a','Tutor');subtitle:='Source tutor profile';
  fields:=jsonb_build_array(app_private.operational_field('contact','Unverified source contact',v->'col_b'),app_private.operational_field('tutor_rate_minor','Reported tutor rate',v->'col_c','money'),app_private.operational_field('google_account','Source Google account',v->'col_d'),app_private.operational_field('notes','Source notes',v->'col_e'));
 elsif l.source_table='marketing' then
  title:=coalesce(v->>'col_b','Marketing expense');subtitle:=coalesce(v->>'col_c','Source expense');status:=v->>'col_e';d:=v->>'col_a';
  fields:=jsonb_build_array(app_private.operational_field('amount_minor','Reported expense',v->'col_d','money'),app_private.operational_field('notes','Source notes',v->'col_f'));
 elsif l.source_table='distributions' then
  title:='Reported distribution';subtitle:=coalesce(v->>'col_d','Recipient not stated');d:=v->>'col_a';
  fields:=jsonb_build_array(app_private.operational_field('amount_minor','Reported distribution',v->'col_c','money'),app_private.operational_field('percentage','Reported percentage',v->'col_b','number'));
 else
  title:=coalesce(v->>'label','Reported balance');subtitle:=coalesce(v->>'source_sheet','Workbook')||' · '||coalesce(v->>'source_cell','');
  fields:=jsonb_build_array(app_private.operational_field('amount_minor','Reported amount',v->'reported_amount_minor','money'),app_private.operational_field('count','Reported count',v->'reported_count','number'));
 end if;
 return jsonb_build_object('id',l.id,'title',title,'subtitle',subtitle,'source_table',l.source_table,'source_row',l.source_row,'reported_status',status,'date',d,'fields',fields,'issues',case when p_role='owner' then coalesce(r->'issues','[]'::jsonb) else '[]'::jsonb end,'actions',actions,'review',jsonb_build_object('version',l.version,'state',l.review_state,'can_review',p_role='owner'),'links',jsonb_build_object('learner_id',l.learner_id,'tutor_id',l.tutor_id,'occurrence_id',l.occurrence_id,'package_id',l.package_id));
end $$;

create function app_private.operational_section(p_key text,p_title text,p_records jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('key',p_key,'title',p_title,'description','Workbook-reported history. Mapping review does not verify attendance, payments or usable credit.','metrics',jsonb_build_array(jsonb_build_object('key','source_records','label','Source records','value',jsonb_array_length(p_records),'unit','count','basis','legacy_reported')),'records',p_records)
$$;
create function api.get_workflow_operations() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); batch uuid; scope text; l app_private.operational_workbook_links%rowtype; item jsonb; sessions jsonb:='[]'; packages jsonb:='[]'; students jsonb:='[]'; tutors jsonb:='[]'; finance jsonb:='[]'; campaigns jsonb:='[]'; sections jsonb:='[]'; learners_options jsonb:='[]'; tutors_options jsonb:='[]';
begin
 select b.id into batch from app_private.workflow_import_batches b where exists(select 1 from app_private.operational_workbook_links where batch_id=b.id) and (
  (b.owner_account_id=actor and app_private.has_role(actor,'admin')) or
  (app_private.has_role(actor,'customer_service') and exists(select 1 from app_private.operational_workbook_access a where a.batch_id=b.id and a.account_id=actor)) or
  exists(select 1 from app_private.operational_workbook_links x where x.batch_id=b.id and (
   (app_private.has_role(actor,'tutor') and exists(select 1 from app_private.tutors t where t.id=x.tutor_id and t.account_id=actor)) or
   (x.source_table in('students','sessions','packages') and app_private.operational_learner_scope(actor,x.learner_id,case x.source_table when 'students' then 'profile' when 'packages' then 'payments' else 'booking' end)))))
 order by b.imported_at desc,b.id desc limit 1;
 if batch is null then return jsonb_build_object('enabled',false); end if;
 scope:=case when exists(select 1 from app_private.workflow_import_batches where id=batch and owner_account_id=actor) and app_private.has_role(actor,'admin') then 'owner' when app_private.has_role(actor,'customer_service') and exists(select 1 from app_private.operational_workbook_access where batch_id=batch and account_id=actor) then 'service' when app_private.has_role(actor,'tutor') and exists(select 1 from app_private.operational_workbook_links x join app_private.tutors t on t.id=x.tutor_id where x.batch_id=batch and t.account_id=actor) then 'tutor' else 'customer' end;
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

create function api.review_workflow_operation(p_link_id uuid,p_expected_version integer,p_review_state text,p_links jsonb,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor(); l app_private.operational_workbook_links%rowtype; prior app_private.operational_workbook_reviews%rowtype; fingerprint text; next_links jsonb; result jsonb; owner_id uuid;
begin
 perform app_private.require_role(actor,'admin');
 select * into l from app_private.operational_workbook_links where id=p_link_id for update;
 if l.id is null then raise exception 'NOT_FOUND';end if;
 select owner_account_id into owner_id from app_private.workflow_import_batches where id=l.batch_id;
 if owner_id is distinct from actor then raise exception 'FORBIDDEN';end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 or p_review_state is null or p_review_state not in('linked','reviewed') or p_links is null or jsonb_typeof(p_links)<>'object' or exists(select 1 from jsonb_object_keys(p_links) k where k not in('learner_id','tutor_id','occurrence_id','package_id')) then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('workbook-review:'||actor::text||':'||p_idempotency_key,0));
 fingerprint:=app_private.catalog_hash(jsonb_build_object('link_id',p_link_id,'expected_version',p_expected_version,'review_state',p_review_state,'links',p_links,'reason',p_reason));
 select * into prior from app_private.operational_workbook_reviews where actor_id=actor and idempotency_key=p_idempotency_key;
 if prior.id is not null then if prior.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 if p_expected_version is distinct from l.version then raise exception 'VERSION_CONFLICT';end if;
 next_links:=jsonb_build_object('learner_id',l.learner_id,'tutor_id',l.tutor_id,'occurrence_id',l.occurrence_id,'package_id',l.package_id)||p_links;
 if next_links->>'learner_id' is not null and not exists(select 1 from app_private.operational_workbook_links where batch_id=l.batch_id and source_table='students' and learner_id=(next_links->>'learner_id')::uuid) then raise exception 'NOT_FOUND';end if;
 if next_links->>'tutor_id' is not null and not exists(select 1 from app_private.operational_workbook_links where batch_id=l.batch_id and source_table='tutors' and tutor_id=(next_links->>'tutor_id')::uuid) then raise exception 'NOT_FOUND';end if;
 if next_links->>'occurrence_id' is not null and not exists(select 1 from app_private.occurrences where id=(next_links->>'occurrence_id')::uuid and tutor_id=(next_links->>'tutor_id')::uuid) then raise exception 'NOT_FOUND';end if;
 if next_links->>'package_id' is not null and not exists(select 1 from app_private.package_purchases where id=(next_links->>'package_id')::uuid and learner_id=(next_links->>'learner_id')::uuid) then raise exception 'NOT_FOUND';end if;
 if l.source_table='sessions' and (next_links->>'learner_id' is null or next_links->>'tutor_id' is null) or l.source_table in('students','packages') and next_links->>'learner_id' is null or l.source_table='tutors' and next_links->>'tutor_id' is null then raise exception 'VALIDATION_ERROR';end if;
 result:=jsonb_build_object('link_id',l.id,'version',l.version+1,'review_state',p_review_state);
 insert into app_private.operational_workbook_reviews(link_id,actor_id,previous_version,previous_links,reviewed_links,review_state,reason,idempotency_key,request_hash,result) values(l.id,actor,l.version,jsonb_build_object('learner_id',l.learner_id,'tutor_id',l.tutor_id,'occurrence_id',l.occurrence_id,'package_id',l.package_id),next_links,p_review_state,btrim(p_reason),p_idempotency_key,fingerprint,result);
 update app_private.operational_workbook_links set learner_id=(next_links->>'learner_id')::uuid,tutor_id=(next_links->>'tutor_id')::uuid,occurrence_id=(next_links->>'occurrence_id')::uuid,package_id=(next_links->>'package_id')::uuid,review_state=p_review_state,version=l.version+1,updated_at=now() where id=l.id;
 return result;
exception when invalid_text_representation then raise exception 'VALIDATION_ERROR';end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure::text signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','app_private') and p.proname=any(array['operational_learner_scope','operational_field','operational_record','operational_section','get_workflow_operations','review_workflow_operation']) loop
  execute format('alter function %s owner to %I',f.signature,case when f.proname='review_workflow_operation' then 'git_tutor_commands' else 'git_tutor_operational_reader' end);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
  if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke create on schema app_private,api from git_tutor_operational_reader,git_tutor_commands;
notify pgrst,'reload schema';
