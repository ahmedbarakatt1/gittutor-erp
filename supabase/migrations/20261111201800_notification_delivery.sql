-- T09 transactional routing; no raw event payload is sent to a recipient.
grant create on schema api,app_private to git_tutor_commands;
create table app_private.notification_queue_owners(queue text primary key check(queue in('general','payments','completion')),account_id uuid not null references app_private.accounts(id),version integer not null default 1,updated_at timestamptz not null default now());
create table app_private.notification_preferences(account_id uuid primary key references app_private.accounts(id),email_enabled boolean not null default true,version integer not null default 1,updated_at timestamptz not null default now());
create table app_private.notification_deliveries(id uuid primary key default gen_random_uuid(),event_id uuid not null references app_private.domain_events(id),recipient_account_id uuid not null references app_private.accounts(id),channel text not null check(channel in('email','in_app')),template_version integer not null default 1,audience text not null check(audience in('customer','tutor','staff')),state text not null default 'queued' check(state in('queued','sent','delivered','bounced','suppressed','failed','unknown')),safe_error_code text,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(event_id,recipient_account_id,channel,template_version));
create table app_private.notification_attempts(id uuid primary key default gen_random_uuid(),delivery_id uuid not null references app_private.notification_deliveries(id),attempt_number integer not null,contact_id uuid references app_private.verified_contacts(id),destination text,content jsonb,state text not null default 'pending' check(state in('pending','sent','delivered','bounced','failed','unknown','suppressed')),provider_message_id text unique,started_at timestamptz,created_at timestamptz not null default now(),unique(delivery_id,attempt_number));
create table app_private.notification_observations(id uuid primary key default gen_random_uuid(),attempt_id uuid not null references app_private.notification_attempts(id),source_identity text not null unique,outcome text not null,provider_message_id text,safe_error_code text,observed_at timestamptz not null,recorded_at timestamptz not null default now());
create table app_private.notification_route_results(event_id uuid primary key references app_private.domain_events(id),supported boolean not null,recipient_count integer not null,created_at timestamptz not null default now());
create table app_private.notification_contact_tasks(id uuid primary key default gen_random_uuid(),account_id uuid not null references app_private.accounts(id),contact_id uuid not null references app_private.verified_contacts(id),delivery_id uuid not null unique references app_private.notification_deliveries(id),state text not null default 'open',created_at timestamptz not null default now());
create table app_private.notification_fake_scenarios(delivery_id uuid primary key references app_private.notification_deliveries(id),scenario text not null check(scenario in('success','timeout_after_success','transient_failure','permanent_failure')));

create function app_private.notification_uuid(p_value text) returns uuid language sql immutable set search_path='' as $$select case when p_value~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'then p_value::uuid end$$;
create function app_private.notification_kind(p_event text)returns text language sql immutable set search_path='' as $$select case
 when p_event in('guardian_link_accepted','guardian_link_revoked')then'relationship'
 when p_event in('tutor_application_reviewed','tutor_profile_approved')then'tutor_review'
 when p_event in('tutor_fee_agreement_approved','booking_approve_tutor_fee')then'tutor_agreement'
 when p_event in('package_activated','purchased_package_activated','package_renewed','renew_package','package_transferred','transfer_package_credit','package_restored','package_credit_restored','package_expiring','package_financing_hold','package_financing_hold_resolved','approved_source_credit_granted')then'package'
 when p_event in('enrollment_held','booking_reserve_enrollment','hold_expiring','hold_expired','enrollment_cancelled','enrollment_transferred','enrollment_transfer_reviewed')then'reservation'
 when p_event in('group_amendment_proposed','group_amendment_committed','cancellation_proposal_reviewed')then'amendment'
 when p_event in('occurrence_confirmed','occurrence_rescheduled','occurrence_cancelled','session_reminder','meeting_ready','tutor_assignment_changed')then'session'
 when p_event in('receipt_submitted','payment_submit_receipt','payment_replace_receipt','receipt_needs_information','receipt_rejected')then'receipt'
 when p_event in('payment_allocated','receipt_approved','allocation_corrected')then'payment'
 when p_event in('refund_approved','approve_refund','refund_settled','refund_failed','reconcile_refund','record_refund_reversal')then'refund'
 when p_event='preparation_ready'then'preparation'when p_event='handout_ready'then'handout'
 when p_event in('completion_approved','attendance_corrected','completion_submitted')then'completion'
 when p_event in('tutor_earning_posted','tutor_earning_adjusted')then'earning'
 when p_event in('payout_destination_submitted','payout_destination_verified','payout_settled','payout_unknown','payout_failed')then'payout'
 when p_event in('transfer_exception','transfer_reversed','record_transfer_reversal','critical_delivery_failed')then'exception'
 else null end$$;

create function app_private.notification_recipients(p_event_id uuid)returns table(account_id uuid,audience text,content jsonb)language plpgsql stable security definer set search_path='' as $$
declare e app_private.domain_events%rowtype;k text;o app_private.occurrences%rowtype;oid uuid;lid uuid;cid uuid;pid uuid;tid uuid;rid uuid;learner_ids uuid[]:='{}';direct_ids uuid[]:='{}';tutor_ids uuid[]:='{}';staff_ids uuid[]:='{}';gscope text:='booking';customer_path text:='/learn/bookings';tutor_path text:='/tutor/schedule';staff_path text:='/admin';owner uuid;
begin select * into e from app_private.domain_events where id=p_event_id;k:=app_private.notification_kind(e.event_type);if k is null then return;end if;
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
 elsif k='amendment'then select p.occurrence_id into oid from app_private.operation_proposals p where p.id=coalesce(app_private.notification_uuid(e.payload->>'proposal_id'),e.aggregate_id);
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
 elsif k='earning'then tutor_path:='/tutor/statements';
 elsif k='payout'then tutor_path:='/tutor/statements';staff_path:='/admin/finance';
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
 if k in('receipt','refund','exception','payout')or e.event_type in('completion_submitted','tutor_earning_adjusted')then select q.account_id into owner from app_private.notification_queue_owners q where q.queue=case when e.event_type='completion_submitted'then'completion'when k in('receipt','refund','payout','exception')then'payments'else'general'end;staff_ids:=array_append(coalesce(staff_ids,'{}'),owner);end if;
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

create function app_private.route_notification_event(p_job_id uuid,p_lease_token uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid;r record;channel text;did uuid;created integer:=0;recipients integer:=0;supported boolean;begin
 select j.event_id into eid from app_private.outbox_jobs j where j.id=p_job_id and j.purpose='notifications.route'and j.state='leased'and j.lease_token=p_lease_token and j.lease_expires_at>now();if eid is null then raise exception'LEASE_LOST';end if;
 perform pg_advisory_xact_lock(hashtextextended('notifications:'||eid::text,0));select app_private.notification_kind(e.event_type)is not null into supported from app_private.domain_events e where e.id=eid;
 for r in select * from app_private.notification_recipients(eid)loop recipients:=recipients+1;foreach channel in array array['in_app','email']loop
  did:=null;insert into app_private.notification_deliveries(event_id,recipient_account_id,channel,audience,state)values(eid,r.account_id,channel,r.audience,case when channel='in_app'then'delivered'else'queued'end)on conflict do nothing returning id into did;
  if did is not null then created:=created+1;if channel='email'then insert into app_private.notification_attempts(delivery_id,attempt_number)values(did,1);perform app_private.enqueue_event(gen_random_uuid(),'notification_dispatch',did,jsonb_build_object('delivery_id',did),'notifications.send');end if;end if;
 end loop;end loop;
 insert into app_private.notification_route_results(event_id,supported,recipient_count)values(eid,supported,recipients)on conflict do nothing;
 return jsonb_build_object('created',created,'supported',supported,'recipient_count',recipients);
end $$;

create function app_private.prepare_notification_delivery(p_delivery_id uuid,p_job_id uuid,p_lease_token uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare d app_private.notification_deliveries%rowtype;a app_private.notification_attempts%rowtype;c app_private.verified_contacts%rowtype;context jsonb;scenario text:='success';begin
 if not exists(select 1 from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.id=p_job_id and j.purpose='notifications.send'and j.state='leased'and j.lease_token=p_lease_token and j.lease_expires_at>now()and e.aggregate_id=p_delivery_id and e.payload=jsonb_build_object('delivery_id',p_delivery_id))then raise exception'LEASE_LOST';end if;
 select * into d from app_private.notification_deliveries where id=p_delivery_id for update;if d.id is null or d.channel<>'email'then raise exception'NOT_FOUND';end if;
 select * into a from app_private.notification_attempts where delivery_id=d.id order by attempt_number desc limit 1 for update;
 if d.state in('sent','delivered','bounced','suppressed')then return jsonb_build_object('state','complete','delivery_id',d.id,'attempt_id',a.id);end if;
 select r.content into context from app_private.notification_recipients(d.event_id)r where r.account_id=d.recipient_account_id and r.audience=d.audience;
 select v.* into c from app_private.verified_contacts v cross join lateral app_private.auth_account(v.account_id)auth where v.account_id=d.recipient_account_id and v.channel='email'and v.verified_at is not null and v.revoked_at is null and lower(v.destination)=lower(auth.email)and auth.email_confirmed_at is not null and auth.deleted_at is null and(auth.banned_until is null or auth.banned_until<=now());
 if context is null or c.id is null or exists(select 1 from app_private.notification_preferences p where p.account_id=d.recipient_account_id and not p.email_enabled)or(a.started_at is not null and(a.contact_id<>c.id or a.content<>context))then
  update app_private.notification_deliveries set state='suppressed',safe_error_code='CURRENT_AUTHORITY_REQUIRED',version=version+1,updated_at=now()where id=d.id;update app_private.notification_attempts set state='suppressed'where id=a.id;
  return jsonb_build_object('state','complete','delivery_id',d.id,'attempt_id',a.id);
 end if;
 if a.state='failed'then return jsonb_build_object('state','complete','delivery_id',d.id,'attempt_id',a.id);end if;
 if a.started_at is null then update app_private.notification_attempts set contact_id=c.id,destination=c.destination,content=context,started_at=now()where id=a.id returning * into a;end if;
 if exists(select 1 from app_private.environment_metadata where environment in('test','development')and fixture_marker is not null)then select coalesce((select s.scenario from app_private.notification_fake_scenarios s where s.delivery_id=d.id),'success')into scenario;end if;
 return jsonb_build_object('state','ready','delivery_id',d.id,'attempt_id',a.id,'destination',a.destination,'content',a.content,'scenario',scenario,'attempt_state',a.state);
end $$;

create function app_private.notification_observe(p_attempt_id uuid,p_source_identity text,p_outcome text,p_provider_message_id text,p_safe_error_code text,p_observed_at timestamptz)returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.notification_attempts%rowtype;d app_private.notification_deliveries%rowtype;nextstate text;begin
 if p_outcome not in('sent','delivered','bounced','failed','unknown')or length(p_source_identity)not between 1 and 300 or p_observed_at is null or p_observed_at>now()+interval'5 minutes'or(p_provider_message_id is not null and length(p_provider_message_id)not between 1 and 300)or(p_safe_error_code is not null and p_safe_error_code!~'^[A-Z0-9_]{1,80}$')then raise exception'VALIDATION_ERROR';end if;
 select * into a from app_private.notification_attempts where id=p_attempt_id for update;if a.id is null or a.started_at is null then raise exception'NOT_FOUND';end if;
 select * into d from app_private.notification_deliveries where id=a.delivery_id for update;
 if a.provider_message_id is not null and p_provider_message_id is distinct from a.provider_message_id then raise exception'STATE_CONFLICT';end if;
 if exists(select 1 from app_private.notification_observations where source_identity=p_source_identity)then return jsonb_build_object('delivery_id',d.id,'state',d.state);end if;
 insert into app_private.notification_observations(attempt_id,source_identity,outcome,provider_message_id,safe_error_code,observed_at)values(a.id,p_source_identity,p_outcome,p_provider_message_id,p_safe_error_code,p_observed_at);
 nextstate:=case when a.state='bounced'or p_outcome='bounced'then'bounced'when a.state='delivered'or p_outcome='delivered'then'delivered'when a.state='sent'or p_outcome='sent'then'sent'when a.state='suppressed'then'suppressed'else p_outcome end;
 update app_private.notification_attempts set state=nextstate,provider_message_id=coalesce(provider_message_id,p_provider_message_id)where id=a.id;
 if not exists(select 1 from app_private.notification_attempts n where n.delivery_id=d.id and n.attempt_number>a.attempt_number)then update app_private.notification_deliveries set state=nextstate,safe_error_code=p_safe_error_code,version=version+1,updated_at=now()where id=d.id;end if;
 if nextstate='bounced'then insert into app_private.notification_contact_tasks(account_id,contact_id,delivery_id)values(d.recipient_account_id,a.contact_id,d.id)on conflict do nothing;end if;
 return jsonb_build_object('delivery_id',d.id,'state',nextstate);
end $$;
create function app_private.finalize_notification_delivery(p_delivery_id uuid,p_attempt_id uuid,p_job_id uuid,p_lease_token uuid,p_observation jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where j.id=p_job_id and j.purpose='notifications.send'and j.state='leased'and j.lease_token=p_lease_token and j.lease_expires_at>now()and e.aggregate_id=p_delivery_id)then raise exception'LEASE_LOST';end if;
 if not exists(select 1 from app_private.notification_attempts a where a.id=p_attempt_id and a.delivery_id=p_delivery_id)then raise exception'NOT_FOUND';end if;
 if p_observation is null or jsonb_typeof(p_observation)<>'object'or p_observation-array['outcome','provider_message_id','safe_error_code','observed_at']<>'{}'::jsonb then raise exception'VALIDATION_ERROR';end if;
 return app_private.notification_observe(p_attempt_id,'job:'||p_job_id||':'||p_lease_token,p_observation->>'outcome',p_observation->>'provider_message_id',p_observation->>'safe_error_code',(p_observation->>'observed_at')::timestamptz);
end $$;
create function app_private.record_email_callback(p_attempt_id uuid,p_provider_message_id text,p_callback_id uuid,p_outcome text,p_observed_at timestamptz)returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_outcome not in('sent','delivered','bounced','failed')or p_provider_message_id is null then raise exception'VALIDATION_ERROR';end if;
 return app_private.notification_observe(p_attempt_id,'sns:'||p_callback_id,p_outcome,p_provider_message_id,case when p_outcome='bounced'then'EMAIL_BOUNCED'when p_outcome='failed'then'EMAIL_REJECTED'end,p_observed_at);
end $$;

create function api.list_my_notifications(p_limit integer default 25,p_cursor uuid default null)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();items jsonb;lastid uuid;begin
 if p_limit not between 1 and 100 then raise exception'VALIDATION_ERROR';end if;
 if p_cursor is not null and not exists(select 1 from app_private.notification_deliveries where id=p_cursor and recipient_account_id=actor and channel='in_app')then raise exception'NOT_FOUND';end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]'::jsonb)into items from(select d.id,d.created_at,jsonb_build_object('delivery_id',d.id,'event_id',d.event_id,'state',d.state,'created_at',d.created_at,'content',r.content) item from app_private.notification_deliveries d cross join lateral app_private.notification_recipients(d.event_id)r where d.recipient_account_id=actor and r.account_id=actor and r.audience=d.audience and d.channel='in_app'and(p_cursor is null or(d.created_at,d.id)<(select c.created_at,c.id from app_private.notification_deliveries c where c.id=p_cursor))order by d.created_at desc,d.id desc limit p_limit)x;
 if jsonb_array_length(items)=p_limit then lastid:=(items->(p_limit-1)->>'delivery_id')::uuid;end if;return jsonb_build_object('items',items,'next_cursor',lastid);
end $$;
create function api.retry_notification(p_delivery_id uuid,p_reason text,p_idempotency_key text)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();d app_private.notification_deliveries%rowtype;ctx jsonb;attempt uuid;begin
 if not app_private.has_role(actor,'admin')and not(app_private.has_role(actor,'customer_service')and exists(select 1 from app_private.notification_queue_owners q where q.account_id=actor))then raise exception'FORBIDDEN';end if;
 select * into d from app_private.notification_deliveries where id=p_delivery_id for update;if d.id is null then raise exception'NOT_FOUND';end if;
 if not app_private.has_role(actor,'admin')and not exists(select 1 from app_private.notification_recipients(d.event_id)r where r.account_id=actor and r.audience='staff')then raise exception'FORBIDDEN';end if;
 ctx:=app_private.booking_begin(actor,'retry_notification',jsonb_build_object('delivery_id',p_delivery_id,'reason',p_reason),p_idempotency_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 if p_reason is null or length(btrim(p_reason))not between 1 and 2000 then raise exception'VALIDATION_ERROR';end if;if d.channel<>'email'or d.state<>'failed'then raise exception'STATE_CONFLICT';end if;
 insert into app_private.notification_attempts(delivery_id,attempt_number)select d.id,coalesce(max(a.attempt_number),0)+1 from app_private.notification_attempts a where a.delivery_id=d.id returning id into attempt;
 update app_private.notification_deliveries set state='queued',safe_error_code=null,version=version+1,updated_at=now()where id=d.id returning * into d;
 perform app_private.enqueue_event(gen_random_uuid(),'notification_dispatch',d.id,jsonb_build_object('delivery_id',d.id),'notifications.send');
 return app_private.booking_finish(ctx,d.id,d.version,jsonb_build_object('delivery_id',d.id,'attempt_id',attempt),'notification_retry_requested',jsonb_build_object('delivery_id',d.id));
end $$;
create function api.set_notification_preferences(p_email_enabled boolean,p_expected_version integer,p_idempotency_key text)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();ctx jsonb;v integer;begin
 insert into app_private.notification_preferences(account_id)values(actor)on conflict do nothing;select version into v from app_private.notification_preferences where account_id=actor for update;
 ctx:=app_private.booking_begin(actor,'set_notification_preferences',jsonb_build_object('email_enabled',p_email_enabled,'expected_version',p_expected_version),p_idempotency_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 if p_email_enabled is null then raise exception'VALIDATION_ERROR';end if;if v<>p_expected_version then raise exception'VERSION_CONFLICT';end if;update app_private.notification_preferences set email_enabled=p_email_enabled,version=version+1,updated_at=now()where account_id=actor returning version into v;
 return app_private.booking_finish(ctx,actor,v,jsonb_build_object('email_enabled',p_email_enabled),'notification_preferences_changed','{}');end $$;
create function api.get_notification_preferences()returns jsonb language plpgsql stable security definer set search_path='' as $$declare actor uuid:=app_private.require_actor();begin return coalesce((select jsonb_build_object('email_enabled',email_enabled,'version',version)from app_private.notification_preferences where account_id=actor),jsonb_build_object('email_enabled',true,'version',1));end$$;
create function api.assign_notification_queue(p_queue text,p_account_id uuid,p_expected_version integer,p_idempotency_key text)returns jsonb language plpgsql security definer set search_path='' as $$declare actor uuid:=app_private.require_actor();ctx jsonb;v integer;begin
 perform app_private.require_role(actor,'admin');if p_queue not in('general','payments','completion')or not(app_private.has_role(p_account_id,'admin')or(p_queue='payments'and app_private.has_role(p_account_id,'customer_service')))then raise exception'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('notification-queue:'||p_queue,0));
 ctx:=app_private.booking_begin(actor,'assign_notification_queue',jsonb_build_object('queue',p_queue,'account_id',p_account_id,'expected_version',p_expected_version),p_idempotency_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 if coalesce((select version from app_private.notification_queue_owners where queue=p_queue),0)<>p_expected_version then raise exception'VERSION_CONFLICT';end if;
 insert into app_private.notification_queue_owners(queue,account_id)values(p_queue,p_account_id)on conflict(queue)do update set account_id=excluded.account_id,version=app_private.notification_queue_owners.version+1,updated_at=now()returning version into v;
 return app_private.booking_finish(ctx,p_account_id,v,jsonb_build_object('queue',p_queue,'account_id',p_account_id),'notification_queue_assigned','{}');end$$;

create function api.list_notification_deliveries(p_limit integer default 25,p_cursor uuid default null,p_state text default null)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();items jsonb;lastid uuid;admin boolean:=app_private.has_role(actor,'admin');begin
 if not admin and not(app_private.has_role(actor,'customer_service')and exists(select 1 from app_private.notification_queue_owners where account_id=actor))then raise exception'FORBIDDEN';end if;
 if p_limit not between 1 and 100 or(p_state is not null and p_state not in('queued','sent','delivered','bounced','suppressed','failed','unknown'))then raise exception'VALIDATION_ERROR';end if;
 if p_cursor is not null and not exists(select 1 from app_private.notification_deliveries d where d.id=p_cursor and(admin or exists(select 1 from app_private.notification_recipients(d.event_id)r where r.account_id=actor and r.audience='staff')))then raise exception'NOT_FOUND';end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]'::jsonb)into items from(select d.id,d.created_at,jsonb_build_object('delivery_id',d.id,'event_type',e.event_type,'audience',d.audience,'channel',d.channel,'state',d.state,'safe_error_code',d.safe_error_code,'masked_recipient',coalesce(left(c.destination,1)||'***@'||split_part(c.destination,'@',2),'Unavailable'),'created_at',d.created_at,'version',d.version,'can_retry',d.channel='email'and d.state='failed')item from app_private.notification_deliveries d join app_private.domain_events e on e.id=d.event_id left join app_private.verified_contacts c on c.account_id=d.recipient_account_id and c.revoked_at is null where(admin or exists(select 1 from app_private.notification_recipients(d.event_id)r where r.account_id=actor and r.audience='staff'))and(p_state is null or d.state=p_state)and(p_cursor is null or(d.created_at,d.id)<(select c.created_at,c.id from app_private.notification_deliveries c where c.id=p_cursor))order by d.created_at desc,d.id desc limit p_limit)x;
 if jsonb_array_length(items)=p_limit then lastid:=(items->(p_limit-1)->>'delivery_id')::uuid;end if;return jsonb_build_object('items',items,'next_cursor',lastid);
end$$;
create function api.list_notification_queues()returns jsonb language plpgsql stable security definer set search_path='' as $$declare actor uuid:=app_private.require_actor();begin
 perform app_private.require_role(actor,'admin');return jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('queue',name,'account_id',q.account_id,'version',coalesce(q.version,0)))from unnest(array['general','payments','completion'])name left join app_private.notification_queue_owners q on q.queue=name));end$$;

do $$declare t record;f record;begin
 for t in select tablename from pg_tables where schemaname='app_private'and tablename like'notification_%'loop
 execute format('alter table app_private.%I enable row level security',t.tablename);execute format('create policy commands_access on app_private.%I to git_tutor_commands using(true)with check(true)',t.tablename);execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,git_tutor_worker',t.tablename);execute format('grant select,insert on app_private.%I to git_tutor_commands',t.tablename);
 if t.tablename in('notification_deliveries','notification_attempts','notification_preferences','notification_queue_owners','notification_contact_tasks')then execute format('grant update on app_private.%I to git_tutor_commands',t.tablename);else execute format('create trigger immutable_row before update or delete on app_private.%I for each row execute function app_private.reject_immutable_change()',t.tablename);end if;
 end loop;
 for f in select p.oid::regprocedure::text signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','app_private')and(p.proname like'notification_%'or p.proname=any(array['route_notification_event','prepare_notification_delivery','finalize_notification_delivery','record_email_callback','list_my_notifications','retry_notification','set_notification_preferences','get_notification_preferences','assign_notification_queue','list_notification_deliveries','list_notification_queues']))loop
 execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
 if f.nspname='api'then execute format('grant execute on function %s to authenticated',f.signature);elsif f.proname in('route_notification_event','prepare_notification_delivery','finalize_notification_delivery','record_email_callback')then execute format('grant execute on function %s to git_tutor_worker',f.signature);end if;
 end loop;end$$;
revoke create on schema api,app_private from git_tutor_commands;
