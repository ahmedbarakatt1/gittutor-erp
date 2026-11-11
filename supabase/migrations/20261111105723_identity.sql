-- T02 requires the real Supabase Auth schema. There is deliberately no local Auth shim.
do $$ begin
  if to_regclass('auth.users') is null or to_regclass('auth.sessions') is null then
    raise exception 'SUPABASE_AUTH_REQUIRED';
  end if;
  if not exists(select 1 from pg_roles where rolname='git_tutor_identity_sync') then
    create role git_tutor_identity_sync nologin nobypassrls;
  end if;
end $$;
grant git_tutor_identity_sync to postgres;
grant usage on schema app_private to git_tutor_identity_sync;
grant create on schema app_private to git_tutor_identity_sync,git_tutor_commands;
grant create on schema api to git_tutor_commands;
grant usage on schema auth to git_tutor_commands;
grant select(id,user_id,not_after) on auth.sessions to git_tutor_commands;
grant select(id,email,email_confirmed_at,is_anonymous,deleted_at,banned_until) on auth.users to git_tutor_commands;
alter default privileges for role git_tutor_identity_sync revoke execute on functions from public;

create table app_private.people (
  id uuid primary key default gen_random_uuid(), display_name text not null check(length(display_name) between 1 and 120),
  history_complete boolean not null default false, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.accounts (
  id uuid primary key references auth.users(id), person_id uuid references app_private.people(id),
  account_kind text not null check(account_kind in ('customer','visitor')), active boolean not null default true,
  locale text not null default 'en' check(locale in ('en','ar')), version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.learners (
  id uuid primary key default gen_random_uuid(), account_id uuid not null unique references app_private.accounts(id),
  person_id uuid not null references app_private.people(id), version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.account_roles (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references app_private.accounts(id),
  role text not null check(role in ('student','guardian','tutor','customer_service','admin')),
  granted_by uuid references app_private.accounts(id), granted_at timestamptz not null default now(),
  revoked_at timestamptz, revoked_by uuid references app_private.accounts(id), reason text not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index account_roles_active on app_private.account_roles(account_id,role) where revoked_at is null;
create table app_private.verified_contacts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references app_private.accounts(id),
  person_id uuid not null references app_private.people(id), channel text not null check(channel='email'),
  destination text not null, verified_at timestamptz, revoked_at timestamptz,
  version integer not null check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(account_id,channel,version)
);
create unique index verified_contacts_active on app_private.verified_contacts(account_id,channel) where revoked_at is null;
create table app_private.guardian_invitations (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references app_private.learners(id),
  recipient_account_id uuid not null references app_private.accounts(id), contact_id uuid not null references app_private.verified_contacts(id),
  scopes text[] not null check(cardinality(scopes)>0 and scopes <@ array['profile','booking','payments','materials','notifications']),
  token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'), expires_at timestamptz not null,
  accepted_at timestamptz, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.guardian_links (
  id uuid primary key default gen_random_uuid(), guardian_account_id uuid not null references app_private.accounts(id),
  learner_id uuid not null references app_private.learners(id), invitation_id uuid not null unique references app_private.guardian_invitations(id),
  scopes text[] not null check(cardinality(scopes)>0 and scopes <@ array['profile','booking','payments','materials','notifications']),
  valid_from timestamptz not null default now(), valid_until timestamptz not null, revoked_at timestamptz, revoked_by uuid references app_private.accounts(id),
  revocation_reason text, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index guardian_links_active on app_private.guardian_links(guardian_account_id,learner_id) where revoked_at is null;
create index guardian_links_learner on app_private.guardian_links(learner_id,guardian_account_id);
-- Minimal subject identities support validated onboarding; T03 owns catalog expansion/publication.
create table app_private.subjects (
  id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null,
  active boolean not null default true, version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.tutor_applications (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references app_private.accounts(id),
  display_name text not null, subject_ids uuid[] not null, bio text not null,
  contact_id uuid not null references app_private.verified_contacts(id), state text not null default 'pending' check(state in ('pending','approved','rejected')),
  reviewed_by uuid references app_private.accounts(id), reviewed_at timestamptz, review_reason text, approved_subject_ids uuid[],
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index tutor_applications_pending on app_private.tutor_applications(account_id) where state='pending';
create table app_private.tutors (
  id uuid primary key default gen_random_uuid(), account_id uuid not null unique references app_private.accounts(id),
  contact_id uuid references app_private.verified_contacts(id), locale text not null default 'en' check(locale in ('en','ar')),
  draft_profile_version_id uuid, approved_profile_version_id uuid,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.tutor_profile_versions (
  id uuid primary key default gen_random_uuid(), tutor_id uuid not null references app_private.tutors(id),
  display_name text not null, subject_ids uuid[] not null, bio text not null,
  state text not null default 'draft' check(state in ('draft','approved','rejected')),
  created_by uuid not null references app_private.accounts(id), approved_by uuid references app_private.accounts(id), approved_at timestamptz,
  version integer not null check(version>0), created_at timestamptz not null default now(), unique(tutor_id,version)
);
alter table app_private.tutors add foreign key(draft_profile_version_id) references app_private.tutor_profile_versions(id);
alter table app_private.tutors add foreign key(approved_profile_version_id) references app_private.tutor_profile_versions(id);

do $$ declare t text; begin
  foreach t in array array['people','accounts','learners','account_roles','verified_contacts','guardian_invitations','guardian_links','subjects','tutor_applications','tutors','tutor_profile_versions'] loop
    execute format('alter table app_private.%I enable row level security',t);
    execute format('revoke all on app_private.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update on app_private.%I to git_tutor_commands',t);
    execute format('create policy identity_commands on app_private.%I to git_tutor_commands using(true) with check(true)',t);
  end loop;
  foreach t in array array['people','accounts','learners','account_roles','verified_contacts'] loop
    execute format('grant select,insert,update on app_private.%I to git_tutor_identity_sync',t);
    execute format('create policy auth_identity_sync on app_private.%I to git_tutor_identity_sync using(true) with check(true)',t);
  end loop;
end $$;

create function app_private.sync_auth_account(p_id uuid,p_email text,p_confirmed timestamptz,p_anonymous boolean,p_name text)
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
    insert into app_private.learners(account_id,person_id) values(p_id,person) on conflict(account_id) do nothing;
    insert into app_private.account_roles(account_id,role,reason) values(p_id,'student','ordinary account registration') on conflict(account_id,role) where revoked_at is null do nothing;
    select * into contact from app_private.verified_contacts where account_id=p_id and channel='email' and revoked_at is null for update;
    if p_email is not null and (contact.id is null or contact.destination<>lower(p_email) or contact.verified_at is distinct from p_confirmed) then
      update app_private.verified_contacts set revoked_at=now(),updated_at=now() where id=contact.id;
      select coalesce(max(version),0)+1 into next_version from app_private.verified_contacts where account_id=p_id and channel='email';
      insert into app_private.verified_contacts(account_id,person_id,channel,destination,verified_at,version) values(p_id,person,'email',lower(p_email),p_confirmed,next_version);
    end if;
  end if;
end $$;
alter function app_private.sync_auth_account(uuid,text,timestamptz,boolean,text) owner to git_tutor_identity_sync;
create function app_private.sync_auth_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform app_private.sync_auth_account(new.id,new.email,new.email_confirmed_at,coalesce(new.is_anonymous,false),coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)));
  return new;
end $$;
alter function app_private.sync_auth_identity() owner to git_tutor_identity_sync;
create trigger git_tutor_auth_identity after insert or update of email,email_confirmed_at,is_anonymous on auth.users
  for each row execute function app_private.sync_auth_identity();
-- Backfill existing verified/synthetic accounts without changing any Auth record or metadata.
select app_private.sync_auth_account(id,email,email_confirmed_at,coalesce(is_anonymous,false),coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1))) from auth.users;

create function app_private.require_actor(p_allow_guest boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; session uuid; claims jsonb; account app_private.accounts%rowtype; u record;
begin
  actor:=auth.uid(); claims:=auth.jwt();
  if actor is null or coalesce(claims->>'session_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  begin session:=(claims->>'session_id')::uuid; exception when invalid_text_representation then raise exception 'AUTH_REQUIRED' using errcode='28000'; end;
  select * into account from app_private.accounts where id=actor for share;
  if account.id is null or not account.active or not exists(select 1 from auth.sessions s where s.id=session and s.user_id=actor and (s.not_after is null or s.not_after>now())) then
    raise exception 'SESSION_REVOKED' using errcode='28000';
  end if;
  select email,email_confirmed_at,is_anonymous,deleted_at,banned_until into u from auth.users where id=actor;
  if not found or u.deleted_at is not null or u.banned_until>now() then raise exception 'SESSION_REVOKED' using errcode='28000'; end if;
  if coalesce(u.is_anonymous,false) then
    if not p_allow_guest then raise exception 'VERIFIED_ACCOUNT_REQUIRED' using errcode='28000'; end if;
  elsif u.email_confirmed_at is null or nullif(u.email,'') is null then raise exception 'VERIFIED_ACCOUNT_REQUIRED' using errcode='28000'; end if;
  return actor;
end $$;
alter function app_private.require_actor(boolean) owner to git_tutor_commands;
create function app_private.has_role(p_actor uuid,p_role text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.account_roles r join app_private.accounts a on a.id=r.account_id where r.account_id=p_actor and r.role=p_role and r.revoked_at is null and a.active)
$$;
alter function app_private.has_role(uuid,text) owner to git_tutor_commands;
create function app_private.require_role(p_actor uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from app_private.account_roles r join app_private.accounts a on a.id=r.account_id
    where r.account_id=p_actor and r.role=p_role and r.revoked_at is null and a.active for share of r,a;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
end $$;
alter function app_private.require_role(uuid,text) owner to git_tutor_commands;
create function app_private.assert_learner_scope(p_actor uuid,p_learner uuid,p_scope text,p_allow_admin boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from app_private.learners where id=p_learner and account_id=p_actor) then return; end if;
  if p_allow_admin and app_private.has_role(p_actor,'admin') then perform app_private.require_role(p_actor,'admin'); return; end if;
  perform 1 from app_private.guardian_links where learner_id=p_learner and guardian_account_id=p_actor and revoked_at is null
    and valid_from<=now() and valid_until>now() and p_scope=any(scopes) for share;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
end $$;
alter function app_private.assert_learner_scope(uuid,uuid,text,boolean) owner to git_tutor_commands;

create function api.get_my_account() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; account app_private.accounts%rowtype; roles jsonb; learner_ids jsonb;
begin
  actor:=app_private.require_actor(true); select * into account from app_private.accounts where id=actor;
  if account.account_kind='visitor' then return jsonb_build_object('is_guest',true); end if;
  select coalesce(jsonb_agg(role order by role),'[]') into roles from app_private.account_roles where account_id=actor and revoked_at is null and
    (role<>'guardian' or exists(select 1 from app_private.guardian_links where guardian_account_id=actor and revoked_at is null and valid_from<=now() and valid_until>now()));
  select coalesce(jsonb_agg(id order by id),'[]') into learner_ids from (
    select id from app_private.learners where account_id=actor union
    select learner_id from app_private.guardian_links where guardian_account_id=actor and revoked_at is null and valid_from<=now() and valid_until>now()
  ) permitted;
  return jsonb_build_object('account_id',actor,'verified',true,'roles',roles,'locale',account.locale,'authorized_learner_ids',learner_ids);
end $$;
create function api.get_learner_summary(p_learner_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor:=app_private.require_actor(); perform app_private.assert_learner_scope(actor,p_learner_id,'profile',true);
  select jsonb_build_object('learner_id',l.id,'display_name',p.display_name,'version',l.version) into result
    from app_private.learners l join app_private.people p on p.id=l.person_id where l.id=p_learner_id;
  if result is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if; return result;
end $$;
create function api.get_my_verified_contacts() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; items jsonb;
begin
  actor:=app_private.require_actor();
  select coalesce(jsonb_agg(jsonb_build_object('contact_id',id,'channel',channel,'masked_destination',left(destination,1)||'***@'||split_part(destination,'@',2),'verified',true) order by id),'[]') into items
  from app_private.verified_contacts where account_id=actor and verified_at is not null and revoked_at is null;
  return jsonb_build_object('items',items,'next_cursor',null);
end $$;
create function api.list_application_subjects() returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
  perform app_private.require_actor();
  select coalesce(jsonb_agg(jsonb_build_object('subject_id',id,'title',title) order by title,id),'[]') into items from app_private.subjects where active;
  return jsonb_build_object('items',items,'next_cursor',null);
end $$;
create function api.get_tutor_profile() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor:=app_private.require_actor(); perform app_private.require_role(actor,'tutor');
  select jsonb_build_object('tutor_id',t.id,'version',t.version,'display_name',coalesce(d.display_name,p.display_name),
    'bio',coalesce(d.bio,''),'subject_ids',coalesce(to_jsonb(d.subject_ids),'[]'),'contact_id',t.contact_id,'locale',t.locale,
    'contact_verified',coalesce(c.verified_at is not null and c.revoked_at is null,false),
    'draft_profile_version_id',t.draft_profile_version_id,'approved_profile_version_id',t.approved_profile_version_id,
    'approved_profile',case when a.id is null then null else jsonb_build_object('display_name',a.display_name,'bio',a.bio,'subject_ids',a.subject_ids) end,'payout_methods','[]'::jsonb) into result
  from app_private.tutors t join app_private.accounts ac on ac.id=t.account_id join app_private.people p on p.id=ac.person_id
  left join app_private.verified_contacts c on c.id=t.contact_id left join app_private.tutor_profile_versions d on d.id=t.draft_profile_version_id
  left join app_private.tutor_profile_versions a on a.id=t.approved_profile_version_id where t.account_id=actor;
  if result is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if; return result;
end $$;

create table app_private.staff_invitations (
  id uuid primary key default gen_random_uuid(), email text not null, role text not null check(role in ('tutor','customer_service','admin')),
  approved_by uuid not null references app_private.accounts(id), reason text not null, expires_at timestamptz not null,
  accepted_at timestamptz, accepted_by uuid references app_private.accounts(id), state text not null default 'pending' check(state in ('pending','accepted','cancelled')),
  delivery_state text not null default 'pending' check(delivery_state in ('pending','sent','unknown','failed')),
  delivery_version integer not null default 1, provider_user_id uuid references auth.users(id), last_error_code text,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index staff_invitation_pending on app_private.staff_invitations(lower(email)) where state='pending';
alter table app_private.staff_invitations enable row level security;
revoke all on app_private.staff_invitations from public,anon,authenticated;
grant select,insert,update on app_private.staff_invitations to git_tutor_commands;
create policy identity_commands on app_private.staff_invitations to git_tutor_commands using(true) with check(true);
grant select(created_at,invited_at,raw_user_meta_data) on auth.users to git_tutor_commands;

create function app_private.identity_command(p_name text,p_args jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid; command uuid:=gen_random_uuid(); resource uuid; resource_version integer:=1;
  digest text; saved app_private.command_results%rowtype; result jsonb:='{}'; action text; payload jsonb:='{}';
  learner uuid; target uuid; profile uuid; token text; role_name text; decision text; ids uuid[];
  invitation app_private.guardian_invitations%rowtype; link app_private.guardian_links%rowtype;
  contact app_private.verified_contacts%rowtype; application app_private.tutor_applications%rowtype;
  tutor app_private.tutors%rowtype; role_grant app_private.account_roles%rowtype; staff_invite app_private.staff_invitations%rowtype;
begin
  actor:=app_private.require_actor();
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR'; end if;
  if p_name in ('grant_staff_role','revoke_staff_role','review_tutor_application','create_staff_invitation') then
    perform app_private.require_role(actor,'admin');
  end if;
  -- Object authorization always precedes saved-result lookup, including current consent and roles.
  case p_name
    when 'create_guardian_invitation' then
      select id into learner from app_private.learners where account_id=actor;
      if learner is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    when 'accept_guardian_invitation' then
      select * into invitation from app_private.guardian_invitations where id=(p_args->>'invitation_id')::uuid for update;
      if invitation.id is null or invitation.recipient_account_id<>actor or invitation.expires_at<=now()
        or invitation.token_hash<>encode(extensions.digest(convert_to(coalesce(p_args->>'single_use_token',''),'UTF8'),'sha256'),'hex')
        or not exists(select 1 from app_private.verified_contacts where id=invitation.contact_id and account_id=actor and verified_at is not null and revoked_at is null) then
        raise exception 'NOT_FOUND' using errcode='P0002';
      end if;
      if invitation.accepted_at is not null and not exists(select 1 from app_private.guardian_links where invitation_id=invitation.id and revoked_at is null and valid_until>now()) then
        raise exception 'CONSENT_REQUIRED' using errcode='42501';
      end if;
    when 'revoke_guardian_link' then
      select * into link from app_private.guardian_links where id=(p_args->>'guardian_link_id')::uuid for update;
      if link.id is null or not (exists(select 1 from app_private.learners where id=link.learner_id and account_id=actor) or app_private.has_role(actor,'admin')) then
        raise exception 'NOT_FOUND' using errcode='P0002';
      end if;
    when 'revoke_staff_role' then
      select * into role_grant from app_private.account_roles where id=(p_args->>'role_grant_id')::uuid for update;
      if role_grant.id is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    when 'review_tutor_application' then
      select * into application from app_private.tutor_applications where id=(p_args->>'application_id')::uuid for update;
      if application.id is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    when 'update_tutor_profile' then
      perform app_private.require_role(actor,'tutor');
      select * into tutor from app_private.tutors where account_id=actor for update;
      if tutor.id is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    when 'accept_staff_invitation' then
      select * into staff_invite from app_private.staff_invitations where id=(p_args->>'invitation_id')::uuid for update;
      if staff_invite.id is null or staff_invite.expires_at<=now() or staff_invite.delivery_state<>'sent' or staff_invite.provider_user_id is distinct from actor
        or not exists(select 1 from auth.users where id=actor and lower(email)=staff_invite.email and email_confirmed_at is not null) then
        raise exception 'NOT_FOUND' using errcode='P0002';
      end if;
      perform app_private.require_role(staff_invite.approved_by,'admin');
    when 'grant_staff_role','submit_tutor_application','create_staff_invitation' then null;
    else raise exception 'VALIDATION_ERROR';
  end case;
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('version',1,'command',p_name,'args',p_args)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_name||':'||p_key,0));
  select * into saved from app_private.command_results where actor_account_id=actor and command_name=p_name and idempotency_key=p_key;
  if saved.id is not null then
    if saved.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return saved.result;
  end if;
  if p_name in ('accept_guardian_invitation','revoke_guardian_link','revoke_staff_role','review_tutor_application','update_tutor_profile','accept_staff_invitation')
    and coalesce((p_args->>'expected_version')::integer,0)<1 then raise exception 'VALIDATION_ERROR'; end if;
  if p_name in ('revoke_guardian_link','grant_staff_role','revoke_staff_role','review_tutor_application','create_staff_invitation')
    and coalesce(length(trim(p_args->>'reason')),0) not between 1 and 2000 then raise exception 'VALIDATION_ERROR'; end if;

  case p_name
    when 'create_guardian_invitation' then
      select * into contact from app_private.verified_contacts where id=(p_args->>'contact_id')::uuid and verified_at is not null and revoked_at is null for share;
      if contact.id is null or contact.account_id=actor then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
      if jsonb_typeof(p_args->'scopes')<>'array' or jsonb_array_length(p_args->'scopes') not between 1 and 5
        or exists(select 1 from jsonb_array_elements_text(p_args->'scopes') s where s not in ('profile','booking','payments','materials','notifications'))
        or (select count(*)<>count(distinct s) from jsonb_array_elements_text(p_args->'scopes') s)
        or (p_args->>'expires_at')::timestamptz<=now() or (p_args->>'expires_at')::timestamptz>now()+interval '30 days' then raise exception 'VALIDATION_ERROR'; end if;
      token:=encode(extensions.gen_random_bytes(32),'hex');
      insert into app_private.guardian_invitations(learner_id,recipient_account_id,contact_id,scopes,token_hash,expires_at)
      values(learner,contact.account_id,contact.id,array(select jsonb_array_elements_text(p_args->'scopes')),encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),(p_args->>'expires_at')::timestamptz)
      returning id into resource;
      action:='guardian_invitation_created';
      result:=jsonb_build_object('invitation_id',resource,'expires_at',p_args->>'expires_at');
      payload:=jsonb_build_object('recipient_account_id',contact.account_id,'single_use_token',token);
    when 'accept_guardian_invitation' then
      if invitation.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if invitation.accepted_at is not null then raise exception 'STATE_CONFLICT'; end if;
      perform 1 from app_private.learners where id=invitation.learner_id for update;
      if exists(select 1 from app_private.guardian_links where learner_id=invitation.learner_id and guardian_account_id=actor and revoked_at is null and valid_until>now()) then raise exception 'STATE_CONFLICT'; end if;
      update app_private.guardian_links set revoked_at=now(),revocation_reason='consent_expired',version=version+1,updated_at=now()
        where learner_id=invitation.learner_id and guardian_account_id=actor and revoked_at is null and valid_until<=now();
      insert into app_private.guardian_links(guardian_account_id,learner_id,invitation_id,scopes,valid_until)
        values(actor,invitation.learner_id,invitation.id,invitation.scopes,'infinity') returning id into resource;
      update app_private.guardian_invitations set accepted_at=now(),version=version+1,updated_at=now() where id=invitation.id;
      insert into app_private.account_roles(account_id,role,reason) values(actor,'guardian','verified learner consent') on conflict(account_id,role) where revoked_at is null do nothing;
      action:='guardian_link_accepted'; result:=jsonb_build_object('guardian_link_id',resource,'scopes',invitation.scopes);
    when 'revoke_guardian_link' then
      if link.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if link.revoked_at is not null then raise exception 'STATE_CONFLICT'; end if;
      update app_private.guardian_links set revoked_at=now(),revoked_by=actor,revocation_reason=p_args->>'reason',version=version+1,updated_at=now() where id=link.id returning version into resource_version;
      resource:=link.id; action:='guardian_link_revoked'; result:=jsonb_build_object('revoked_at',now());
    when 'grant_staff_role' then
      role_name:=p_args->>'role'; target:=(p_args->>'account_id')::uuid;
      if role_name is null or role_name not in ('tutor','customer_service','admin') then raise exception 'VALIDATION_ERROR'; end if;
      perform 1 from app_private.accounts a join auth.users u on u.id=a.id where a.id=target and a.active and a.account_kind='customer' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) for share of a;
      if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
      perform pg_advisory_xact_lock(hashtextextended('staff-role:'||target::text,0));
      if exists(select 1 from app_private.account_roles where account_id=target and role=role_name and revoked_at is null) then raise exception 'STATE_CONFLICT'; end if;
      insert into app_private.account_roles(account_id,role,granted_by,reason) values(target,role_name,actor,p_args->>'reason') returning id into resource;
      if role_name='tutor' then
        insert into app_private.tutors(account_id,contact_id) select target,id from app_private.verified_contacts where account_id=target and verified_at is not null and revoked_at is null on conflict(account_id) do nothing;
      end if;
      action:='staff_role_granted'; result:=jsonb_build_object('role_grant_id',resource);
    when 'revoke_staff_role' then
      if role_grant.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if role_grant.role not in ('tutor','customer_service','admin') or role_grant.revoked_at is not null then raise exception 'STATE_CONFLICT'; end if;
      update app_private.account_roles set revoked_at=now(),revoked_by=actor,version=version+1,updated_at=now() where id=role_grant.id returning version into resource_version;
      resource:=role_grant.id; action:='staff_role_revoked'; result:=jsonb_build_object('revoked_at',now());
    when 'submit_tutor_application','update_tutor_profile' then
      if coalesce(length(trim(p_args->>'display_name')),0) not between 1 and 120 or coalesce(length(trim(p_args->>'bio')),0) not between 1 and 5000 then raise exception 'VALIDATION_ERROR'; end if;
      ids:=array(select jsonb_array_elements_text(p_args->'subject_ids')::uuid);
      if cardinality(ids) not between 1 and 30 or (select count(distinct id) from unnest(ids) id)<>cardinality(ids)
        or (select count(*) from app_private.subjects where id=any(ids) and active)<>cardinality(ids) then raise exception 'VALIDATION_ERROR'; end if;
      select * into contact from app_private.verified_contacts where id=(p_args->>'contact_id')::uuid and account_id=actor and revoked_at is null and verified_at is not null for share;
      if contact.id is null then raise exception 'DESTINATION_UNVERIFIED'; end if;
      if p_name='submit_tutor_application' then
        if exists(select 1 from app_private.tutor_applications where account_id=actor and state='pending') then raise exception 'STATE_CONFLICT'; end if;
        insert into app_private.tutor_applications(account_id,display_name,subject_ids,bio,contact_id) values(actor,trim(p_args->>'display_name'),ids,trim(p_args->>'bio'),contact.id) returning id into resource;
        action:='tutor_application_submitted'; result:=jsonb_build_object('application_id',resource);
      else
        if tutor.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
        if p_args->>'locale' is null or p_args->>'locale' not in ('en','ar') then raise exception 'VALIDATION_ERROR'; end if;
        insert into app_private.tutor_profile_versions(tutor_id,display_name,subject_ids,bio,created_by,version)
          values(tutor.id,trim(p_args->>'display_name'),ids,trim(p_args->>'bio'),actor,tutor.version+1) returning id into profile;
        update app_private.tutors set draft_profile_version_id=profile,contact_id=contact.id,locale=p_args->>'locale',version=version+1,updated_at=now() where id=tutor.id returning version into resource_version;
        resource:=tutor.id; action:='tutor_profile_updated'; result:=jsonb_build_object('review_required_fields',array['display_name','bio','subject_ids']);
      end if;
    when 'review_tutor_application' then
      if application.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if application.state<>'pending' then raise exception 'STATE_CONFLICT'; end if;
      decision:=p_args->>'decision'; ids:=array(select jsonb_array_elements_text(p_args->'approved_subject_ids')::uuid);
      if decision is null or decision not in ('approved','rejected') then raise exception 'VALIDATION_ERROR'; end if;
      if decision='approved' and (cardinality(ids) not between 1 and 30 or not ids <@ application.subject_ids or (select count(distinct id) from unnest(ids) id)<>cardinality(ids)
        or (select count(*) from app_private.subjects where id=any(ids) and active)<>cardinality(ids)) then raise exception 'VALIDATION_ERROR'; end if;
      update app_private.tutor_applications set state=decision,approved_subject_ids=ids,reviewed_by=actor,reviewed_at=now(),review_reason=p_args->>'reason',version=version+1,updated_at=now() where id=application.id returning version into resource_version;
      target:=null;
      if decision='approved' then
        if not exists(select 1 from app_private.verified_contacts where id=application.contact_id and account_id=application.account_id and verified_at is not null and revoked_at is null) then raise exception 'DESTINATION_UNVERIFIED'; end if;
        insert into app_private.tutors(account_id,contact_id) values(application.account_id,application.contact_id) on conflict(account_id) do nothing;
        select * into tutor from app_private.tutors where account_id=application.account_id for update;
        insert into app_private.tutor_profile_versions(tutor_id,display_name,subject_ids,bio,created_by,version) values(tutor.id,application.display_name,ids,application.bio,actor,tutor.version) returning id into profile;
        update app_private.tutors set draft_profile_version_id=profile where id=tutor.id;
        -- The subordinate grant has its own command, immutable audit entry and outbox event.
        if not app_private.has_role(application.account_id,'tutor') then
          perform app_private.identity_command('grant_staff_role',jsonb_build_object('account_id',application.account_id,'role','tutor','reason',p_args->>'reason'),'application:'||command::text);
        end if;
        target:=tutor.id;
      end if;
      resource:=application.id; action:='tutor_application_reviewed'; result:=jsonb_build_object('tutor_id',target,'decision',decision);
    when 'create_staff_invitation' then
      role_name:=p_args->>'role';
      if role_name is null or role_name not in ('tutor','customer_service','admin') or coalesce(p_args->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or length(p_args->>'email')>254 or (p_args->>'expires_at')::timestamptz<=now() or (p_args->>'expires_at')::timestamptz>now()+interval '7 days' then raise exception 'VALIDATION_ERROR'; end if;
      perform pg_advisory_xact_lock(hashtextextended('staff-invite:'||lower(p_args->>'email'),0));
      if exists(select 1 from auth.users where lower(email)=lower(p_args->>'email')) or exists(select 1 from app_private.staff_invitations where email=lower(p_args->>'email') and state='pending') then raise exception 'STATE_CONFLICT'; end if;
      insert into app_private.staff_invitations(email,role,approved_by,reason,expires_at) values(lower(p_args->>'email'),role_name,actor,p_args->>'reason',(p_args->>'expires_at')::timestamptz) returning id into resource;
      action:='staff_invitation_created'; result:=jsonb_build_object('invitation_id',resource,'expires_at',p_args->>'expires_at','delivery_state','pending');
    when 'accept_staff_invitation' then
      if staff_invite.version<>(p_args->>'expected_version')::integer then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
      if staff_invite.state<>'pending' then raise exception 'STATE_CONFLICT'; end if;
      perform pg_advisory_xact_lock(hashtextextended('staff-role:'||actor::text,0));
      if exists(select 1 from app_private.account_roles where account_id=actor and role=staff_invite.role and revoked_at is null) then raise exception 'STATE_CONFLICT'; end if;
      insert into app_private.account_roles(account_id,role,granted_by,reason) values(actor,staff_invite.role,staff_invite.approved_by,staff_invite.reason) returning id into target;
      if staff_invite.role='tutor' then
        insert into app_private.tutors(account_id,contact_id) select actor,id from app_private.verified_contacts where account_id=actor and verified_at is not null and revoked_at is null on conflict(account_id) do nothing;
      end if;
      insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(actor,command,'staff_role_granted',target,jsonb_build_object('invitation_id',staff_invite.id,'approved_by',staff_invite.approved_by));
      update app_private.staff_invitations set state='accepted',accepted_at=now(),accepted_by=actor,version=version+1,updated_at=now() where id=staff_invite.id returning version into resource_version;
      resource:=staff_invite.id; action:='staff_invitation_accepted'; result:=jsonb_build_object('role_grant_id',target,'role',staff_invite.role);
  end case;
  result:=jsonb_build_object('command_id',command,'resource_id',resource,'version',resource_version)||result;
  insert into app_private.command_results(id,actor_account_id,command_name,idempotency_key,request_hash,result) values(command,actor,p_name,p_key,digest,result);
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(actor,command,action,resource,jsonb_build_object('command_name',p_name));
  perform app_private.enqueue_event(command,action,resource,payload||result,case when p_name='create_staff_invitation' then 'identity.staff_invitation' else 'notifications.route' end);
  return result;
end $$;
alter function app_private.identity_command(text,jsonb,text) owner to git_tutor_commands;

create function api.create_guardian_invitation(p_contact_id uuid,p_scopes text[],p_expires_at timestamptz,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('create_guardian_invitation',jsonb_build_object('contact_id',p_contact_id,'scopes',p_scopes,'expires_at',p_expires_at),p_idempotency_key) $$;
create function api.accept_guardian_invitation(p_invitation_id uuid,p_single_use_token text,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('accept_guardian_invitation',jsonb_build_object('invitation_id',p_invitation_id,'single_use_token',p_single_use_token,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.revoke_guardian_link(p_guardian_link_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('revoke_guardian_link',jsonb_build_object('guardian_link_id',p_guardian_link_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.grant_staff_role(p_account_id uuid,p_role text,p_reason text,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('grant_staff_role',jsonb_build_object('account_id',p_account_id,'role',p_role,'reason',p_reason),p_idempotency_key) $$;
create function api.revoke_staff_role(p_role_grant_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('revoke_staff_role',jsonb_build_object('role_grant_id',p_role_grant_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.submit_tutor_application(p_display_name text,p_subject_ids uuid[],p_bio text,p_contact_id uuid,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('submit_tutor_application',jsonb_build_object('display_name',p_display_name,'subject_ids',p_subject_ids,'bio',p_bio,'contact_id',p_contact_id),p_idempotency_key) $$;
create function api.review_tutor_application(p_application_id uuid,p_decision text,p_reason text,p_approved_subject_ids uuid[],p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('review_tutor_application',jsonb_build_object('application_id',p_application_id,'decision',p_decision,'reason',p_reason,'approved_subject_ids',p_approved_subject_ids,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.update_tutor_profile(p_display_name text,p_bio text,p_subject_ids uuid[],p_contact_id uuid,p_locale text,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('update_tutor_profile',jsonb_build_object('display_name',p_display_name,'bio',p_bio,'subject_ids',p_subject_ids,'contact_id',p_contact_id,'locale',p_locale,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.create_staff_invitation(p_email text,p_role text,p_reason text,p_expires_at timestamptz,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('create_staff_invitation',jsonb_build_object('email',p_email,'role',p_role,'reason',p_reason,'expires_at',p_expires_at),p_idempotency_key) $$;
create function api.accept_staff_invitation(p_invitation_id uuid,p_expected_version integer,p_idempotency_key text)
returns jsonb language sql security definer set search_path='' as $$ select app_private.identity_command('accept_staff_invitation',jsonb_build_object('invitation_id',p_invitation_id,'expected_version',p_expected_version),p_idempotency_key) $$;

create function api.get_tutor_applications(p_cursor text default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; after_time timestamptz; after_id uuid; result jsonb; next_cursor text;
begin
  actor:=app_private.require_actor();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is not null then
    begin after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception 'VALIDATION_ERROR'; end;
  end if;
  with matches as (select * from app_private.tutor_applications where (account_id=actor or app_private.has_role(actor,'admin'))
    and (p_cursor is null or (created_at,id)>(after_time,after_id)) order by created_at,id limit p_limit+1),
  page as (select * from matches order by created_at,id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('application_id',id,'applicant_account_id',account_id,'display_name',display_name,'bio',bio,'subject_ids',subject_ids,'version',version,'state',state,'created_at',created_at) order by created_at,id),'[]'),
    case when (select count(*) from matches)>p_limit then (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id::text from page order by created_at desc,id desc limit 1) end
    into result,next_cursor from page;
  return jsonb_build_object('items',result,'next_cursor',next_cursor);
end $$;
create function api.list_staff_invitations(p_cursor text default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; after_time timestamptz; after_id uuid; result jsonb; next_cursor text;
begin
  actor:=app_private.require_actor(); perform app_private.require_role(actor,'admin');
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_cursor is not null then
    begin after_time:=split_part(p_cursor,'|',1)::timestamptz; after_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception 'VALIDATION_ERROR'; end;
  end if;
  with matches as (select * from app_private.staff_invitations where p_cursor is null or (created_at,id)>(after_time,after_id) order by created_at,id limit p_limit+1),
  page as (select * from matches order by created_at,id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('invitation_id',id,'masked_email',left(email,1)||'***@'||split_part(email,'@',2),'role',role,'state',state,'delivery_state',delivery_state,'version',version,'created_at',created_at,'last_error_code',last_error_code) order by created_at,id),'[]'),
    case when (select count(*) from matches)>p_limit then (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id::text from page order by created_at desc,id desc limit 1) end
    into result,next_cursor from page;
  return jsonb_build_object('items',result,'next_cursor',next_cursor);
end $$;

create function app_private.get_staff_invitation_delivery(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation app_private.staff_invitations%rowtype; reconciled uuid;
begin
  select * into invitation from app_private.staff_invitations where id=p_invitation_id;
  if invitation.id is null or invitation.state<>'pending' or invitation.expires_at<=now() or not app_private.has_role(invitation.approved_by,'admin') then return null; end if;
  select id into reconciled from auth.users where lower(email)=invitation.email and created_at>=invitation.created_at and invited_at is not null
    and raw_user_meta_data->>'staff_invitation_id'=invitation.id::text and deleted_at is null;
  return jsonb_build_object('invitation_id',invitation.id,'email',invitation.email,'role',invitation.role,'version',invitation.version,
    'delivery_version',invitation.delivery_version,'delivery_state',invitation.delivery_state,'state',invitation.state,'expires_at',invitation.expires_at,
    'created_at',invitation.created_at,'provider_user_id',invitation.provider_user_id,'reconciled_user_id',reconciled);
end $$;
alter function app_private.get_staff_invitation_delivery(uuid) owner to git_tutor_commands;
create function app_private.record_staff_invitation_delivery(p_invitation_id uuid,p_expected_version integer,p_outcome text,p_provider_user_id uuid default null,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation app_private.staff_invitations%rowtype;
begin
  if p_outcome is null or p_outcome not in ('sent','unknown','failed') or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$') then raise exception 'VALIDATION_ERROR'; end if;
  select * into invitation from app_private.staff_invitations where id=p_invitation_id for update;
  if invitation.id is null then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if invitation.delivery_state=p_outcome and invitation.provider_user_id is not distinct from p_provider_user_id then
    return jsonb_build_object('invitation_id',invitation.id,'delivery_version',invitation.delivery_version,'delivery_state',invitation.delivery_state);
  end if;
  if p_expected_version is null or invitation.delivery_version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if invitation.delivery_state='sent' then raise exception 'STATE_CONFLICT'; end if;
  if p_outcome='sent' and (p_provider_user_id is null or not exists(select 1 from auth.users where id=p_provider_user_id and lower(email)=invitation.email and created_at>=invitation.created_at
    and invited_at is not null and raw_user_meta_data->>'staff_invitation_id'=invitation.id::text)) then raise exception 'EVIDENCE_REQUIRED'; end if;
  update app_private.staff_invitations set delivery_state=p_outcome,provider_user_id=p_provider_user_id,last_error_code=p_error_code,delivery_version=delivery_version+1,updated_at=now()
    where id=invitation.id returning * into invitation;
  return jsonb_build_object('invitation_id',invitation.id,'delivery_version',invitation.delivery_version,'delivery_state',invitation.delivery_state);
end $$;
alter function app_private.record_staff_invitation_delivery(uuid,integer,text,uuid,text) owner to git_tutor_commands;

-- Explicit execution grants: no exposed anonymous identity RPC, no browser base-table access.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' loop
    execute format('alter function %s owner to git_tutor_commands',f.signature);
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on function app_private.get_staff_invitation_delivery(uuid),app_private.record_staff_invitation_delivery(uuid,integer,text,uuid,text) to git_tutor_worker;
revoke create on schema app_private from git_tutor_identity_sync,git_tutor_commands;
revoke create on schema api from git_tutor_commands;
notify pgrst, 'reload schema';
