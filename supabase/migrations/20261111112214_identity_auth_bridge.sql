-- Hosted Supabase deliberately prevents custom-role USAGE on auth. These narrow read-only
-- bridges are the documented postgres-owned exception; business functions stay independently owned.
-- https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7
create function app_private.auth_account(p_id uuid)
returns table(email text,email_confirmed_at timestamptz,is_anonymous boolean,deleted_at timestamptz,banned_until timestamptz)
language sql stable security definer set search_path='' as $$
  select u.email::text,u.email_confirmed_at,u.is_anonymous,u.deleted_at,u.banned_until from auth.users u where u.id=p_id
$$;
create function app_private.auth_session_active(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>now()))
$$;
create function app_private.auth_email_exists(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where lower(email)=lower(p_email))
$$;
create function app_private.auth_invited_user(p_invitation uuid,p_email text,p_created_at timestamptz) returns uuid
language sql stable security definer set search_path='' as $$
  select id from auth.users where lower(email)=p_email and created_at>=p_created_at and invited_at is not null
    and raw_user_meta_data->>'staff_invitation_id'=p_invitation::text and deleted_at is null
$$;
revoke all on function app_private.auth_account(uuid),app_private.auth_session_active(uuid,uuid),
  app_private.auth_email_exists(text),app_private.auth_invited_user(uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.auth_account(uuid),app_private.auth_session_active(uuid,uuid),
  app_private.auth_email_exists(text),app_private.auth_invited_user(uuid,text,timestamptz) to git_tutor_commands;
-- Remove now-unused direct Auth column privileges; access goes through bounded read bridges only.
revoke select(id,user_id,not_after) on auth.sessions from git_tutor_commands;
revoke select(id,email,email_confirmed_at,is_anonymous,deleted_at,banned_until,created_at,invited_at,raw_user_meta_data) on auth.users from git_tutor_commands;

create or replace function app_private.require_actor(p_allow_guest boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; session uuid; claims jsonb; account app_private.accounts%rowtype; u record;
begin
  claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  begin actor:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),claims->>'sub')::uuid;
  exception when invalid_text_representation then raise exception 'AUTH_REQUIRED' using errcode='28000'; end;
  if actor is null or coalesce(claims->>'session_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  begin session:=(claims->>'session_id')::uuid; exception when invalid_text_representation then raise exception 'AUTH_REQUIRED' using errcode='28000'; end;
  select * into account from app_private.accounts where id=actor for share;
  if account.id is null or not account.active or not app_private.auth_session_active(actor,session) then
    raise exception 'SESSION_REVOKED' using errcode='28000';
  end if;
  select email,email_confirmed_at,is_anonymous,deleted_at,banned_until into u from app_private.auth_account(actor);
  if not found or u.deleted_at is not null or u.banned_until>now() then raise exception 'SESSION_REVOKED' using errcode='28000'; end if;
  if coalesce(u.is_anonymous,false) then
    if not p_allow_guest then raise exception 'VERIFIED_ACCOUNT_REQUIRED' using errcode='28000'; end if;
  elsif u.email_confirmed_at is null or nullif(u.email,'') is null then raise exception 'VERIFIED_ACCOUNT_REQUIRED' using errcode='28000'; end if;
  return actor;
end $$;

create or replace function app_private.identity_command(p_name text,p_args jsonb,p_key text) returns jsonb
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
        or not exists(select 1 from app_private.auth_account(actor) where lower(email)=staff_invite.email and email_confirmed_at is not null) then
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
      perform 1 from app_private.accounts a cross join lateral app_private.auth_account(a.id) u where a.id=target and a.active and a.account_kind='customer' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for share of a;
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
      if app_private.auth_email_exists(p_args->>'email') or exists(select 1 from app_private.staff_invitations where email=lower(p_args->>'email') and state='pending') then raise exception 'STATE_CONFLICT'; end if;
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

create or replace function app_private.get_staff_invitation_delivery(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation app_private.staff_invitations%rowtype; reconciled uuid;
begin
  select * into invitation from app_private.staff_invitations where id=p_invitation_id;
  if invitation.id is null or invitation.state<>'pending' or invitation.expires_at<=now() or not app_private.has_role(invitation.approved_by,'admin') then return null; end if;
  reconciled:=app_private.auth_invited_user(invitation.id,invitation.email,invitation.created_at);
  return jsonb_build_object('invitation_id',invitation.id,'email',invitation.email,'role',invitation.role,'version',invitation.version,
    'delivery_version',invitation.delivery_version,'delivery_state',invitation.delivery_state,'state',invitation.state,'expires_at',invitation.expires_at,
    'created_at',invitation.created_at,'provider_user_id',invitation.provider_user_id,'reconciled_user_id',reconciled);
end $$;

create or replace function app_private.record_staff_invitation_delivery(p_invitation_id uuid,p_expected_version integer,p_outcome text,p_provider_user_id uuid default null,p_error_code text default null)
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
  if p_outcome='sent' and (p_provider_user_id is null or p_provider_user_id is distinct from app_private.auth_invited_user(invitation.id,invitation.email,invitation.created_at)) then raise exception 'EVIDENCE_REQUIRED'; end if;
  update app_private.staff_invitations set delivery_state=p_outcome,provider_user_id=p_provider_user_id,last_error_code=p_error_code,delivery_version=delivery_version+1,updated_at=now()
    where id=invitation.id returning * into invitation;
  return jsonb_build_object('invitation_id',invitation.id,'delivery_version',invitation.delivery_version,'delivery_state',invitation.delivery_state);
end $$;
notify pgrst,'reload schema';
