-- Preserve narrow outbox grants; earned liabilities survive teaching-role withdrawal.
grant create on schema app_private to git_tutor_commands;
create or replace function app_private.schedule_occurrence_reminders(p_occurrence uuid)returns void language plpgsql security definer set search_path=''as $$
declare o app_private.occurrences%rowtype;lead integer;due timestamptz;event uuid;job uuid;begin
 select *into o from app_private.occurrences where id=p_occurrence for update;if o.state<>'confirmed'or o.start_at<=now()then return;end if;
 foreach lead in array array[1440,60]loop
  due:=o.start_at-make_interval(mins=>lead);if lead=1440 and due<=now()then continue;end if;due:=greatest(due,now());
  if exists(select 1 from app_private.notification_reminder_schedules s where s.occurrence_id=o.id and s.occurrence_version=o.version and s.lead_minutes=lead)then continue;end if;
  event:=gen_random_uuid();insert into app_private.domain_events(id,event_type,aggregate_id,payload,correlation_id)values(event,'session_reminder',o.id,jsonb_build_object('occurrence_id',o.id,'occurrence_version',o.version,'lead_minutes',lead),event);
  insert into app_private.outbox_jobs(event_id,purpose,available_at)values(event,'notifications.route',due) returning id into job;
  insert into app_private.notification_reminder_schedules values(o.id,o.version,lead,due,event);
 end loop;
end$$;
create or replace function app_private.payroll_assert_destination(p_version uuid,p_tutor uuid)returns finance_private.payout_destination_versions language plpgsql security definer set search_path=''as $$declare d finance_private.payout_destination_versions%rowtype;owner uuid;begin select *into d from finance_private.payout_destination_versions where id=p_version;if d.id is null or d.tutor_id<>p_tutor then raise exception'DESTINATION_UNVERIFIED';end if;select account_id into owner from app_private.tutors where id=p_tutor;perform app_private.require_role(d.verified_by,'admin');if not app_private.payment_verified_account(owner)or not app_private.payment_verified_account(d.verified_by)then raise exception'FORBIDDEN';end if;if not exists(select 1 from finance_private.tutor_payout_settings where tutor_id=p_tutor and d.channel=any(enabled_channels))then raise exception'METHOD_DISABLED';end if;if d.destination_id is distinct from(select id from finance_private.payout_destinations where tutor_id=p_tutor and channel=d.channel order by created_at desc,id desc limit 1)then raise exception'DESTINATION_UNVERIFIED';end if;return d;end$$;

revoke create on schema app_private from git_tutor_commands;
