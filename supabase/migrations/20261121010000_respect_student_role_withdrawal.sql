create or replace function app_private.sync_auth_account(p_id uuid,p_email text,p_confirmed timestamptz,p_anonymous boolean,p_name text)
returns void language plpgsql security definer set search_path='' as $$
declare person uuid; contact app_private.verified_contacts%rowtype; next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('authsync:'||p_id::text,0));
  select person_id into person from app_private.accounts where id=p_id;
  if person is null and not p_anonymous then
    insert into app_private.people(display_name) values(left(coalesce(nullif(trim(p_name),''),'Learner'),120)) returning id into person;
  end if;
  insert into app_private.accounts(id,person_id,account_kind) values(p_id,person,case when p_anonymous then 'visitor' else 'customer' end)
    on conflict(id) do update set person_id=excluded.person_id,account_kind=excluded.account_kind,updated_at=now();
  if not p_anonymous then
    -- Provision the default learner once. Account maintenance must not undo
    -- an explicit withdrawal of the student role.
    if not exists(select 1 from app_private.account_roles where account_id=p_id and role='student')
       or exists(select 1 from app_private.account_roles where account_id=p_id and role='student' and revoked_at is null) then
      insert into app_private.learners(account_id,person_id) values(p_id,person) on conflict(account_id) do nothing;
      insert into app_private.account_roles(account_id,role,reason) values(p_id,'student','ordinary account registration') on conflict(account_id,role) where revoked_at is null do nothing;
    end if;
    select * into contact from app_private.verified_contacts where account_id=p_id and channel='email' and revoked_at is null for update;
    if p_email is not null and (contact.id is null or contact.destination<>lower(p_email) or contact.verified_at is distinct from p_confirmed) then
      update app_private.verified_contacts set revoked_at=now(),updated_at=now() where id=contact.id;
      select coalesce(max(version),0)+1 into next_version from app_private.verified_contacts where account_id=p_id and channel='email';
      insert into app_private.verified_contacts(account_id,person_id,channel,destination,verified_at,version) values(p_id,person,'email',lower(p_email),p_confirmed,next_version);
    end if;
  end if;
end $$;
