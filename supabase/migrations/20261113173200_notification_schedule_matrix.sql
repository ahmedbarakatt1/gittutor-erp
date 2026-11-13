-- T09 aliases, dispatch-time scope, and durable versioned reminder scheduling.
grant create on schema app_private to git_tutor_commands;
create function app_private.notification_canonical_event(p_event text)returns text language sql immutable set search_path=''as $$select case p_event
 when 'submit_completion'then'completion_submitted'when'completion_amended'then'attendance_corrected'
 when'transfer_allocated'then'payment_allocated'when'tutor_profile_reviewed'then'tutor_profile_approved'
 when'booking_confirm_occurrence'then'occurrence_confirmed'when'tutor_reassignment_committed'then'tutor_assignment_changed'
 when'package_due_processed'then'package_expiring'when'booking_cancellation_committed'then'occurrence_cancelled'
 else p_event end$$;
create or replace function app_private.notification_kind(p_event text)returns text language sql immutable set search_path=''as $$select case
 when p_event='tutor_unavailable'then'exception'
 when p_event in('support_assigned','support_returned','support_transferred','support_escalated','support_account_linked')then'support'
 when p_event='export_ready'then'export'
 when p_event in('payout_authorized','payout_reversed')then'payout'
 else app_private.notification_kind_v1(app_private.notification_canonical_event(p_event))end$$;
create function app_private.notification_recipients_core(p_event_id uuid)returns table(account_id uuid,audience text,content jsonb)language plpgsql stable security definer set search_path='' as $$
declare e app_private.domain_events%rowtype;k text;o app_private.occurrences%rowtype;oid uuid;lid uuid;cid uuid;pid uuid;tid uuid;rid uuid;learner_ids uuid[]:='{}';direct_ids uuid[]:='{}';tutor_ids uuid[]:='{}';staff_ids uuid[]:='{}';gscope text:='booking';customer_path text:='/learn/bookings';tutor_path text:='/tutor/schedule';staff_path text:='/admin';owner uuid;
begin select * into e from app_private.domain_events where id=p_event_id;e.event_type:=app_private.notification_canonical_event(e.event_type);k:=app_private.notification_kind(e.event_type);if k is null then return;end if;
 oid:=app_private.notification_uuid(e.payload->>'occurrence_id');tid:=app_private.notification_uuid(e.payload->>'tutor_id');
 if k='relationship'then
  select array[l.account_id,g.guardian_account_id]into direct_ids from app_private.guardian_links g join app_private.learners l on l.id=g.learner_id where g.id=e.aggregate_id;customer_path:='/learn';
 elsif k='tutor_review'then
  select t.id into tid from app_private.tutors t where t.id=e.aggregate_id or t.account_id=(select a.account_id from app_private.tutor_applications a where a.id=e.aggregate_id)or t.id=(select p.tutor_id from app_private.tutor_profile_versions p where p.id=e.aggregate_id)limit 1;
  if tid is null then select array[a.account_id]into direct_ids from app_private.tutor_applications a where a.id=e.aggregate_id;customer_path:='/learn';end if;
 elsif k='tutor_agreement'then select f.tutor_id,f.occurrence_id into tid,oid from finance_private.tutor_fee_agreements f where f.id=e.aggregate_id;tutor_path:='/tutor/schedule';
 elsif k='package'then
  pid:=coalesce(app_private.notification_uuid(e.payload->>'package_purchase_id'),app_private.notification_uuid(e.payload->>'target_package_id'),e.aggregate_id);
  select p.learner_id,p.charge_id into lid,cid from app_private.package_purchases p where p.id=pid;customer_path:='/learn/packages';gscope:='payments';
 elsif k='reservation'then
  rid:=coalesce(app_private.notification_uuid(e.payload->>'destination_enrollment_id'),app_private.notification_uuid(e.payload->>'enrollment_id'),e.aggregate_id);
  select n.learner_id,n.occurrence_id into lid,oid from app_private.enrollments n where n.id=rid;
 elsif k='amendment'then select coalesce(oid,p.occurrence_id) into oid from app_private.operation_proposals p where p.id=coalesce(app_private.notification_uuid(e.payload->>'proposal_id'),e.aggregate_id);
 elsif k in('session','completion')then oid:=coalesce(oid,e.aggregate_id);
 elsif k in('receipt','payment')then
  rid:=coalesce(app_private.notification_uuid(e.payload->>'receipt_id'),e.aggregate_id);
  select r.charge_id into cid from app_private.receipts r where r.id=rid;
  if cid is null then select r.charge_id into cid from app_private.review_cases c join app_private.receipts r on r.id=c.receipt_id where c.id=rid;end if;
  cid:=coalesce(cid,app_private.notification_uuid(e.payload->>'charge_id'),app_private.notification_uuid(e.payload->>'new_charge_id'));
  if cid is null then select a.charge_id into cid from finance_private.payment_allocations a where a.id=e.aggregate_id;end if;
  select c.learner_id,array[c.responsible_account_id]into lid,direct_ids from finance_private.charges c where c.id=cid;
  select c.owner_id into owner from app_private.review_cases c where c.receipt_id=rid and c.claim_expires_at>now();staff_ids:=array[owner];customer_path:='/learn/payments';staff_path:='/service/payments';gscope:='payments';
 elsif k='refund'then
  select r.learner_id,array[r.payer_account_id]into lid,direct_ids from finance_private.refunds r where r.id=coalesce(app_private.notification_uuid(e.payload->>'refund_id'),e.aggregate_id);customer_path:='/learn/refunds';staff_path:='/admin/refunds';gscope:='payments';
 elsif k in('preparation','handout')then
  select f.parent_id into rid from app_private.files f where f.id=e.aggregate_id;
  if k='preparation'then select n.occurrence_id into oid from app_private.enrollments n where n.id=rid;
  else oid:=rid;if not exists(select 1 from app_private.file_access_states a where a.file_id=e.aggregate_id and a.scan_state='clean'and a.publication_state='published')then return;end if;end if;
  customer_path:='/learn/files';gscope:='materials';
 elsif k='earning'then tid:=coalesce(tid,(select t.tutor_id from finance_private.tutor_earnings t where t.id=e.aggregate_id));tutor_path:='/tutor/pay';
 elsif k='payout'then tutor_path:='/tutor/pay';staff_path:='/admin/finance';
 elsif k='exception'then
  select array[b.payer_account_id]into direct_ids from finance_private.incoming_transfers t join finance_private.transfer_payer_bindings b on b.id=t.current_payer_binding_id where t.id=coalesce(app_private.notification_uuid(e.payload->>'transfer_id'),e.aggregate_id);customer_path:='/learn/payments';staff_path:='/admin/payments';
 end if;
 if oid is not null then
  select * into o from app_private.occurrences where id=oid;
  if e.event_type in('session_reminder','meeting_ready')and(o.state not in('confirmed','in_progress')or o.end_at<now()or coalesce((e.payload->>'occurrence_version')::integer,0)<>o.version)then return;end if;
  if k in('session','amendment','completion','handout')and e.event_type<>'completion_submitted'then select coalesce(array_agg(n.learner_id),'{}')into learner_ids from app_private.enrollments n where n.occurrence_id=oid and(n.state in('held','confirmed')or e.event_type in('occurrence_cancelled','completion_approved','attendance_corrected'));end if;
  if k in('session','amendment','completion','preparation')and e.event_type<>'completion_submitted'then tid:=o.tutor_id;end if;
 end if;
 if lid is not null then learner_ids:=array_append(coalesce(learner_ids,'{}'),lid);end if;
 if cid is not null then select coalesce(direct_ids,'{}')||coalesce(array_agg(distinct b.payer_account_id),'{}')into direct_ids from finance_private.payment_allocations a join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id where a.charge_id=cid;end if;
 if tid is not null then select array[t.account_id]into tutor_ids from app_private.tutors t where t.id=tid and app_private.has_role(t.account_id,'tutor');end if;
 if k in('receipt','refund','exception','payout')or e.event_type in('completion_submitted','tutor_earning_adjusted','occurrence_rescheduled','occurrence_cancelled','tutor_assignment_changed','group_amendment_committed','hold_expired','hold_expiring')then select q.account_id into owner from app_private.notification_queue_owners q where q.queue=case when e.event_type='completion_submitted'then'completion'when k in('receipt','refund','payout','exception')then'payments'else'general'end;staff_ids:=array_append(coalesce(staff_ids,'{}'),owner);end if;
 return query with candidates as(
  select l.account_id,'customer'::text a,customer_path path from app_private.learners l where l.id=any(coalesce(learner_ids,'{}'))
  union select g.guardian_account_id,'customer',customer_path from app_private.guardian_links g where g.learner_id=any(coalesce(learner_ids,'{}'))and g.revoked_at is null and g.valid_from<=now()and g.valid_until>now()and 'notifications'=any(g.scopes)and gscope=any(g.scopes)
  union select unnest(coalesce(direct_ids,'{}')),'customer',customer_path
  union select unnest(coalesce(tutor_ids,'{}')),'tutor',tutor_path
  union select x,'staff',staff_path from unnest(coalesce(staff_ids,'{}'))x where app_private.has_role(x,'admin')or app_private.has_role(x,'customer_service')
 ),chosen as(select distinct on(c.account_id)c.* from candidates c where c.account_id is not null order by c.account_id,case c.a when'tutor'then 1 when'customer'then 2 else 3 end)
 select c.account_id,c.a,jsonb_build_object('kind',k,'locale',a.locale,'audience',c.a,'action_path',c.path,'starts_at',case when k in('session','reservation','amendment')then o.start_at end)
 from chosen c join app_private.accounts a on a.id=c.account_id where a.active;
end $$;


alter function app_private.notification_recipients(uuid)rename to notification_recipients_v2;
create function app_private.notification_recipients(p_event_id uuid)returns table(account_id uuid,audience text,content jsonb)language plpgsql volatile security definer set search_path=''as $$
declare e app_private.domain_events%rowtype;k text;x app_private.export_jobs%rowtype;begin
 select *into e from app_private.domain_events where id=p_event_id;k:=app_private.notification_kind(e.event_type);
 if e.event_type='tutor_unavailable'then return query select *from app_private.notification_recipients_v2(p_event_id);return;end if;
 if k='support'then
  return query select a.id,case when a.id=c.owner_account_id then'staff'else'customer'end,jsonb_build_object('kind','support','locale',a.locale,'audience',case when a.id=c.owner_account_id then'staff'else'customer'end,'action_path',case when a.id=c.owner_account_id then case when app_private.has_role(a.id,'admin')then'/admin/support'else'/service/support'end else'/learn/support'end,'starts_at',null)
  from app_private.conversations c join app_private.accounts a on a.id=c.account_id or(a.id=c.owner_account_id and(app_private.has_role(a.id,'admin')or app_private.has_role(a.id,'customer_service')))where c.id=e.aggregate_id and a.active;return;
 elsif k='export'then
  select *into x from app_private.export_jobs where id=e.aggregate_id;if x.id is null then return;end if;
  begin perform app_private.export_assert_scope(x.requester_id,x.session_id,x.kind,x.filters,x.columns);exception when others then return;end;
  return query select a.id,case when x.kind='own_tutor_statement'then'tutor'when x.kind='own_account'then'customer'else'staff'end,jsonb_build_object('kind','export','locale',a.locale,'audience',case when x.kind='own_tutor_statement'then'tutor'when x.kind='own_account'then'customer'else'staff'end,'action_path',case when x.kind='own_tutor_statement'then'/tutor/exports'when x.kind='own_account'then'/learn/exports'else'/admin/exports'end,'starts_at',null)from app_private.accounts a where a.id=x.requester_id and a.active;return;
 end if;
 return query select *from app_private.notification_recipients_core(p_event_id);
end$$;
create table app_private.notification_reminder_schedules(occurrence_id uuid not null references app_private.occurrences(id),occurrence_version integer not null,lead_minutes integer not null check(lead_minutes in(60,1440)),due_at timestamptz not null,event_id uuid not null unique references app_private.domain_events(id),primary key(occurrence_id,occurrence_version,lead_minutes));
alter table app_private.notification_reminder_schedules enable row level security;
create policy commands_access on app_private.notification_reminder_schedules to git_tutor_commands using(true)with check(true);
revoke all on app_private.notification_reminder_schedules from public,anon,authenticated,service_role,git_tutor_worker;
grant select,insert on app_private.notification_reminder_schedules to git_tutor_commands;
create trigger immutable_row before update or delete on app_private.notification_reminder_schedules for each row execute function app_private.reject_immutable_change();
create function app_private.schedule_occurrence_reminders(p_occurrence uuid)returns void language plpgsql security definer set search_path=''as $$
declare o app_private.occurrences%rowtype;lead integer;due timestamptz;event uuid;job uuid;begin
 select *into o from app_private.occurrences where id=p_occurrence for update;if o.state<>'confirmed'or o.start_at<=now()then return;end if;
 foreach lead in array array[1440,60]loop
  due:=o.start_at-make_interval(mins=>lead);if lead=1440 and due<=now()then continue;end if;due:=greatest(due,now());
  if exists(select 1 from app_private.notification_reminder_schedules s where s.occurrence_id=o.id and s.occurrence_version=o.version and s.lead_minutes=lead)then continue;end if;
  event:=gen_random_uuid();job:=app_private.enqueue_event(event,'session_reminder',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'lead_minutes',lead),'notifications.route');
  update app_private.outbox_jobs set available_at=due where id=job;
  insert into app_private.notification_reminder_schedules values(o.id,o.version,lead,due,event);
 end loop;
end$$;
create function app_private.notification_schedule_changed()returns trigger language plpgsql security definer set search_path=''as $$begin perform app_private.schedule_occurrence_reminders(new.id);return new;end$$;
create trigger notification_schedule_changed after insert or update of state,start_at,end_at,version on app_private.occurrences for each row execute function app_private.notification_schedule_changed();
do $$declare o record;begin for o in select id from app_private.occurrences where state='confirmed'and start_at>now()loop perform app_private.schedule_occurrence_reminders(o.id);end loop;end$$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname=any(array['notification_canonical_event','notification_kind','notification_recipients_core','notification_recipients','schedule_occurrence_reminders','notification_schedule_changed'])loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end$$;
revoke create on schema app_private from git_tutor_commands;
