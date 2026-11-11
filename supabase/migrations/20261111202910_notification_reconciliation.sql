grant create on schema api,app_private to git_tutor_commands;
-- Match prepare's delivery-then-attempt lock order before provider callbacks update observations.
do $$declare definition text;changed text;begin
 definition:=pg_get_functiondef('app_private.notification_observe(uuid,text,text,text,text,timestamp with time zone)'::regprocedure);
 changed:=replace(definition,' select * into a from app_private.notification_attempts where id=p_attempt_id for update;', ' perform 1 from app_private.notification_deliveries where id=(select delivery_id from app_private.notification_attempts where id=p_attempt_id) for update; select * into a from app_private.notification_attempts where id=p_attempt_id for update;');
 if changed=definition then raise exception'NOTIFICATION_LOCK_SOURCE_CHANGED';end if;execute changed;
 definition:=pg_get_functiondef('api.list_notification_deliveries(integer,uuid,text)'::regprocedure);
 changed:=replace(definition,'''can_retry'',d.channel=''email''and d.state=''failed''','''can_retry'',d.channel=''email''and d.state=''failed'',''can_reconcile'',d.channel=''email''and d.state=''unknown''');
 if changed=definition then raise exception'NOTIFICATION_READ_SOURCE_CHANGED';end if;execute changed;
end$$;
create function api.reconcile_notification(p_delivery_id uuid,p_reason text,p_idempotency_key text)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();d app_private.notification_deliveries%rowtype;ctx jsonb;attempt uuid;event uuid:=gen_random_uuid();job uuid;begin
 if not app_private.has_role(actor,'admin')and not(app_private.has_role(actor,'customer_service')and exists(select 1 from app_private.notification_queue_owners q where q.account_id=actor))then raise exception'FORBIDDEN';end if;
 select * into d from app_private.notification_deliveries where id=p_delivery_id for update;if d.id is null then raise exception'NOT_FOUND';end if;
 if not app_private.has_role(actor,'admin')and not exists(select 1 from app_private.notification_recipients(d.event_id)r where r.account_id=actor and r.audience='staff')then raise exception'FORBIDDEN';end if;
 ctx:=app_private.booking_begin(actor,'reconcile_notification',jsonb_build_object('delivery_id',p_delivery_id,'reason',p_reason),p_idempotency_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 if p_reason is null or length(btrim(p_reason))not between 1 and 2000 then raise exception'VALIDATION_ERROR';end if;if d.channel<>'email'or d.state<>'unknown'then raise exception'STATE_CONFLICT';end if;
 if exists(select 1 from app_private.outbox_jobs j join app_private.domain_events e on e.id=j.event_id where e.aggregate_id=d.id and j.purpose='notifications.send'and j.state in('pending','leased'))then raise exception'STATE_CONFLICT';end if;
 select id into attempt from app_private.notification_attempts where delivery_id=d.id order by attempt_number desc limit 1;
 perform app_private.enqueue_event(event,'notification_dispatch',d.id,jsonb_build_object('delivery_id',d.id),'notifications.send');select id into job from app_private.outbox_jobs where event_id=event and purpose='notifications.send';
 return app_private.booking_finish(ctx,d.id,d.version,jsonb_build_object('delivery_id',d.id,'attempt_id',attempt,'job_id',job),'notification_reconciliation_requested',jsonb_build_object('delivery_id',d.id));
end$$;
alter function api.reconcile_notification(uuid,text,text)owner to git_tutor_commands;
revoke all on function api.reconcile_notification(uuid,text,text)from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.reconcile_notification(uuid,text,text)to authenticated;

alter function app_private.notification_kind(text)rename to notification_kind_v1;
create function app_private.notification_kind(p_event text)returns text language sql immutable set search_path='' as $$select case when p_event='tutor_unavailable'then'exception'else app_private.notification_kind_v1(p_event)end$$;
alter function app_private.notification_recipients(uuid)rename to notification_recipients_v1;
create function app_private.notification_recipients(p_event_id uuid)returns table(account_id uuid,audience text,content jsonb)language sql stable security definer set search_path='' as $$
 select r.* from app_private.notification_recipients_v1(p_event_id)r where not exists(select 1 from app_private.domain_events e where e.id=p_event_id and e.event_type='tutor_unavailable')
 union all
 select c.owner_account_id,'staff'::text,jsonb_build_object('kind','exception','locale',a.locale,'audience','staff','action_path','/admin/teaching','starts_at',null)
 from app_private.domain_events e join app_private.unavailability_cases c on c.occurrence_id=e.aggregate_id and c.incident_id=app_private.notification_uuid(e.payload->>'incident_id')join app_private.accounts a on a.id=c.owner_account_id
 where e.id=p_event_id and e.event_type='tutor_unavailable'and c.state='open'and a.active and(app_private.has_role(a.id,'admin')or app_private.has_role(a.id,'customer_service'))
$$;
alter function app_private.notification_kind(text)owner to git_tutor_commands;
alter function app_private.notification_recipients(uuid)owner to git_tutor_commands;
revoke all on function app_private.notification_kind(text),app_private.notification_recipients(uuid)from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema api,app_private from git_tutor_commands;
