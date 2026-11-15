-- A provider may accept an API send before deciding that the email cannot be sent.
create index notification_signed_terminal_outcome
  on app_private.notification_observations (attempt_id, outcome)
  where source_identity like 'sns:%' and outcome in ('failed', 'suppressed');

create or replace function app_private.notification_observe(
  p_attempt_id uuid, p_source_identity text, p_outcome text, p_provider_message_id text,
  p_safe_error_code text, p_observed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  attempt app_private.notification_attempts%rowtype;
  delivery app_private.notification_deliveries%rowtype;
  terminal_callback text;
  next_state text;
  next_error_code text;
begin
  if p_source_identity is null or length(p_source_identity) not between 1 and 300
      or p_outcome is null or p_outcome not in ('sent', 'delivered', 'bounced', 'failed', 'unknown', 'suppressed')
      or (p_outcome = 'suppressed' and p_source_identity not like 'sns:%')
      or p_observed_at is null or p_observed_at > now() + interval '5 minutes'
      or (p_provider_message_id is not null and length(p_provider_message_id) not between 1 and 300)
      or (p_safe_error_code is not null and p_safe_error_code !~ '^[A-Z0-9_]{1,80}$') then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Keep the delivery-then-attempt lock order shared with prepare and retry.
  select d.* into delivery from app_private.notification_deliveries d
  join app_private.notification_attempts a on a.delivery_id = d.id
  where a.id = p_attempt_id for update of d;
  select * into attempt from app_private.notification_attempts where id = p_attempt_id for update;
  if attempt.id is null or attempt.started_at is null then raise exception 'NOT_FOUND'; end if;
  if attempt.provider_message_id is not null and p_provider_message_id is not null
      and p_provider_message_id <> attempt.provider_message_id then
    raise exception 'STATE_CONFLICT';
  end if;
  if exists (select 1 from app_private.notification_observations where source_identity = p_source_identity) then
    return jsonb_build_object('delivery_id', delivery.id, 'state', delivery.state);
  end if;

  insert into app_private.notification_observations
    (attempt_id, source_identity, outcome, provider_message_id, safe_error_code, observed_at)
  values (attempt.id, p_source_identity, p_outcome, p_provider_message_id, p_safe_error_code, p_observed_at);

  -- The legacy sns: identity prefix denotes observations from the signed callback RPC.
  select o.outcome into terminal_callback from app_private.notification_observations o
  where o.attempt_id = attempt.id and o.source_identity like 'sns:%' and o.outcome in ('failed', 'suppressed')
  order by o.outcome desc limit 1;

  next_state := case
    when attempt.state = 'bounced' or p_outcome = 'bounced' then 'bounced'
    when attempt.state = 'delivered' or p_outcome = 'delivered' then 'delivered'
    when terminal_callback is not null then terminal_callback
    when attempt.state = 'sent' or p_outcome = 'sent' then 'sent'
    when attempt.state = 'suppressed' then 'suppressed'
    else p_outcome
  end;
  next_error_code := case
    when next_state = 'bounced' then 'EMAIL_BOUNCED'
    when next_state in ('sent', 'delivered') then null
    when next_state = terminal_callback and terminal_callback = 'suppressed' then 'EMAIL_SUPPRESSED'
    when next_state = terminal_callback and terminal_callback = 'failed' then 'EMAIL_REJECTED'
    when next_state = p_outcome then p_safe_error_code
    else delivery.safe_error_code
  end;

  update app_private.notification_attempts
  set state = next_state, provider_message_id = coalesce(provider_message_id, p_provider_message_id)
  where id = attempt.id;
  if not exists (
    select 1 from app_private.notification_attempts a
    where a.delivery_id = delivery.id and a.attempt_number > attempt.attempt_number
  ) then
    update app_private.notification_deliveries
    set state = next_state, safe_error_code = next_error_code, version = version + 1, updated_at = now()
    where id = delivery.id;
  end if;
  if next_state = 'bounced' or (next_state = 'suppressed' and terminal_callback = 'suppressed') then
    insert into app_private.notification_contact_tasks (account_id, contact_id, delivery_id)
    values (delivery.recipient_account_id, attempt.contact_id, delivery.id) on conflict do nothing;
  end if;
  return jsonb_build_object('delivery_id', delivery.id, 'state', next_state);
end;
$$;

create or replace function app_private.record_email_callback(
  p_attempt_id uuid, p_provider_message_id text, p_callback_id uuid, p_outcome text, p_observed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome is null or p_outcome not in ('sent', 'delivered', 'bounced', 'failed', 'suppressed')
      or p_provider_message_id is null or p_callback_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;
  return app_private.notification_observe(
    p_attempt_id, 'sns:' || p_callback_id, p_outcome, p_provider_message_id,
    case p_outcome
      when 'bounced' then 'EMAIL_BOUNCED'
      when 'failed' then 'EMAIL_REJECTED'
      when 'suppressed' then 'EMAIL_SUPPRESSED'
    end,
    p_observed_at
  );
end;
$$;
