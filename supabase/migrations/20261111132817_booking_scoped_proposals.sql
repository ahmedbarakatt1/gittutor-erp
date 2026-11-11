-- T04 scoped proposals. Financial consumption remains unavailable until T06.
grant create on schema api,app_private,finance_private to git_tutor_commands;
create table app_private.operation_proposals(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('reschedule','cancellation_remedy','group_amendment')),
 target_type text not null check(target_type in ('occurrence','enrollment')),target_id uuid not null,occurrence_id uuid not null references app_private.occurrences(id),
 base_target_version integer not null,base_occurrence_version integer not null,base_roster_hash text not null,policy_version_id uuid not null references app_private.policy_versions(id),
 requested_terms jsonb not null,state text not null default 'proposed' check(state in ('proposed','accepted','approved','committed','declined','expired')),version integer not null default 1,
 expires_at timestamptz not null check(isfinite(expires_at)),created_by uuid not null references app_private.accounts(id),reason text not null,
 approved_by uuid references app_private.accounts(id),approved_at timestamptz,committed_at timestamptz,invalidated_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index operation_proposals_due on app_private.operation_proposals(occurrence_id,expires_at) where state in ('proposed','accepted','approved');
create table app_private.group_amendments(id uuid primary key references app_private.operation_proposals(id),replacement_policy_version_id uuid not null references app_private.policy_versions(id),pricing_version_id uuid not null references app_private.pricing_versions(id),target_tier integer not null check(target_tier between 2 and 4),add_learner_ids uuid[] not null,remove_enrollment_ids uuid[] not null);
alter table app_private.enrollments add constraint enrollment_amendment_fk foreign key(amendment_id) references app_private.group_amendments(id) deferrable initially deferred;
create table app_private.operation_customer_terms(id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.operation_proposals(id),learner_id uuid not null references app_private.learners(id),enrollment_id uuid not null references app_private.enrollments(id),source_quote_id uuid references app_private.quotes(id),proposed_quote_id uuid references app_private.quotes(id),terms jsonb not null,terms_hash text not null,financial_terms_ready boolean not null,unique(proposal_id,learner_id));
create table finance_private.operation_tutor_terms(id uuid primary key default gen_random_uuid(),proposal_id uuid not null unique references app_private.operation_proposals(id),tutor_id uuid not null references app_private.tutors(id),fee_agreement_id uuid references finance_private.tutor_fee_agreements(id),terms jsonb not null,terms_hash text not null);
create table app_private.operation_proposal_acceptances(id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.operation_proposals(id),participant_type text not null check(participant_type in ('learner','tutor')),participant_id uuid not null,actor_account_id uuid not null references app_private.accounts(id),terms_hash text not null,accepted_at timestamptz not null default now(),unique(proposal_id,participant_type,participant_id));
create table app_private.operation_proposal_approvals(id uuid primary key default gen_random_uuid(),proposal_id uuid not null references app_private.operation_proposals(id),terms_hash text not null,decision text not null check(decision in ('approved','rejected')),actor_account_id uuid not null references app_private.accounts(id),reason text not null,created_at timestamptz not null default now());
alter table app_private.quote_acceptances add column acceptance_basis text not null default 'direct_quote' check(acceptance_basis in ('direct_quote','operation_proposal')),
 add column source_proposal_acceptance_id uuid references app_private.operation_proposal_acceptances(id),add column source_terms_hash text,
 add check((acceptance_basis='direct_quote' and source_proposal_acceptance_id is null and source_terms_hash is null) or(acceptance_basis='operation_proposal' and source_proposal_acceptance_id is not null and source_terms_hash is not null));
do $$ declare name text;begin
 foreach name in array array['operation_proposals','group_amendments','operation_customer_terms','operation_proposal_acceptances','operation_proposal_approvals'] loop
 execute format('alter table app_private.%I enable row level security',name);execute format('grant select,insert on app_private.%I to git_tutor_commands',name);
 execute format('create policy commands_access on app_private.%I to git_tutor_commands using(true) with check(true)',name);execute format('revoke all on app_private.%I from public,anon,authenticated,service_role,git_tutor_worker',name);
 if name<>'operation_proposals' then execute format('create trigger immutable_terms before update or delete on app_private.%I for each row execute function app_private.reject_immutable_change()',name);end if;
 end loop;
end $$;
create function app_private.booking_proposal_customer_json(p_enrollment uuid,p_policy uuid,p_new_start timestamptz,p_new_end timestamptz,p_new_amount bigint,p_remedy text,p_new_occurrence uuid default null,p_added boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;q app_private.quotes%rowtype;o app_private.occurrences%rowtype;old_amount bigint;begin
 select * into e from app_private.enrollments where id=p_enrollment;select * into q from app_private.quotes where id=e.current_quote_id;select * into o from app_private.occurrences where id=e.occurrence_id;old_amount:=case when p_added then 0 else q.customer_price_minor end;
 return jsonb_build_object('learner_id',e.learner_id,'enrollment_id',e.id,'old_occurrence_id',o.id,'new_occurrence_id',coalesce(p_new_occurrence,o.id),'old_start_at',o.start_at,'old_end_at',o.end_at,'start_at',p_new_start,'end_at',p_new_end,'time_zone','Africa/Cairo','old_customer_price_minor',old_amount,'customer_price_minor',p_new_amount,'customer_adjustment_minor',p_new_amount-old_amount,'currency','EGP','policy_version_id',p_policy,'customer_policy',app_private.customer_policy_summary(p_policy),'remedy',p_remedy,'remedy_amount_minor',null,'restored_credit_quanta',null);
end $$;
create function app_private.booking_proposal_tutor_json(p_occurrence uuid,p_fee uuid,p_start timestamptz,p_end timestamptz,p_target integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.occurrences%rowtype;f finance_private.tutor_fee_agreements%rowtype;begin
 select * into o from app_private.occurrences where id=p_occurrence;select * into f from finance_private.tutor_fee_agreements where id=p_fee;
 return jsonb_build_object('tutor_id',o.tutor_id,'occurrence_id',o.id,'start_at',p_start,'end_at',p_end,'time_zone','Africa/Cairo','target_tier',p_target,'duration_minutes',o.duration_minutes,'fee_agreement_id',f.id,'fee_minor',f.fee_minor,'currency','EGP','compensation_policy_version_id',f.pricing_version_id,'fee_agreement_state',case when f.id is null then 'pending_approval' else 'approved' end);
end $$;
create function app_private.booking_proposal_new_quote(p_enrollment uuid,p_policy uuid,p_target integer,p_amount bigint,p_start timestamptz,p_end timestamptz,p_expires timestamptz,p_future boolean) returns app_private.quotes language plpgsql security definer set search_path='' as $$
declare e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;q app_private.quotes%rowtype;quote_id uuid:=gen_random_uuid();pricing_id uuid;terms jsonb;n integer;begin
 select * into e from app_private.enrollments where id=p_enrollment;select * into o from app_private.occurrences where id=e.occurrence_id;select pricing_version_id into pricing_id from app_private.policy_versions where id=p_policy;
 select coalesce(max(version),0)+1 into n from app_private.quotes where enrollment_id=e.id;
 terms:=jsonb_build_object('quote_id',quote_id,'enrollment_id',e.id,'learner_id',e.learner_id,'occurrence_id',o.id,'start_at',p_start,'end_at',p_end,'time_zone','Africa/Cairo','target_tier',p_target,'customer_price_minor',p_amount,'currency','EGP','policy_version_id',p_policy,'pricing_version_id',pricing_id,'customer_policy',app_private.customer_policy_summary(p_policy),'expires_at',p_expires);
 insert into app_private.quotes(id,enrollment_id,occurrence_id,version,base_occurrence_version,base_terms_version,policy_version_id,pricing_version_id,target_tier,customer_price_minor,currency,expires_at,customer_terms,terms_hash)
 values(quote_id,e.id,o.id,n,o.version,o.quote_terms_version+case when p_future then 1 else 0 end,p_policy,pricing_id,p_target,p_amount,'EGP',p_expires,terms,app_private.catalog_hash(terms)) returning * into q;return q;
end $$;
grant update on app_private.operation_proposals to git_tutor_commands;
alter table finance_private.operation_tutor_terms enable row level security;
grant select,insert on finance_private.operation_tutor_terms to git_tutor_commands;
create policy commands_access on finance_private.operation_tutor_terms to git_tutor_commands using(true) with check(true);
revoke all on finance_private.operation_tutor_terms from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_terms before update or delete on finance_private.operation_tutor_terms for each row execute function app_private.reject_immutable_change();
create function app_private.booking_proposal_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' or(to_jsonb(old)-array['state','version','approved_by','approved_at','committed_at','invalidated_reason','updated_at']) is distinct from(to_jsonb(new)-array['state','version','approved_by','approved_at','committed_at','invalidated_reason','updated_at']) then raise exception 'IMMUTABLE_VERSION';end if;return new;
end $$;
create trigger proposal_terms_immutable before update or delete on app_private.operation_proposals for each row execute function app_private.booking_proposal_immutable();

create function app_private.booking_proposal_fresh(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p.expires_at>now() and p.state in ('proposed','accepted','approved') and p.base_occurrence_version=o.version
 and p.base_roster_hash=app_private.booking_roster_fingerprint(o.id)
 and(p.target_type='occurrence' or exists(select 1 from app_private.enrollments e where e.id=p.target_id and e.version=p.base_target_version and e.state in ('held','confirmed')))
 from app_private.operation_proposals p join app_private.occurrences o on o.id=p.occurrence_id where p.id=p_id
$$;
create function app_private.booking_proposal_hash(p_id uuid,p_type text,p_participant uuid,p_terms jsonb,p_expires timestamptz,p_version integer) returns text language sql immutable set search_path='' as $$
 select app_private.catalog_hash(jsonb_build_object('proposal_id',p_id,'participant_type',p_type,'participant_id',p_participant,'terms',p_terms,'expires_at',p_expires,'base_version',p_version))
$$;
create function app_private.booking_proposal_admin_hash(p_id uuid) returns text language sql stable security definer set search_path='' as $$
 select app_private.catalog_hash(jsonb_build_object('proposal_id',p.id,'base_version',p.base_target_version,'policy_version_id',p.policy_version_id,'requested_terms',p.requested_terms,'expires_at',p.expires_at,
 'customers',coalesce((select jsonb_agg(terms_hash order by learner_id) from app_private.operation_customer_terms where proposal_id=p.id),'[]'),
 'tutor',(select terms_hash from finance_private.operation_tutor_terms where proposal_id=p.id))) from app_private.operation_proposals p where p.id=p_id
$$;
create function app_private.booking_proposal_participant(p_actor uuid,p_id uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare row app_private.operation_customer_terms%rowtype;tutor finance_private.operation_tutor_terms%rowtype;begin
 select * into row from app_private.operation_customer_terms where proposal_id=p_id and terms_hash=p_hash and app_private.booking_can_access(p_actor,learner_id);
 if row.id is not null then perform app_private.assert_learner_scope(p_actor,row.learner_id,'booking');return jsonb_build_object('type','learner','id',row.learner_id,'financial_terms_ready',row.financial_terms_ready);end if;
 select t.* into tutor from finance_private.operation_tutor_terms t join app_private.tutors person on person.id=t.tutor_id where t.proposal_id=p_id and t.terms_hash=p_hash and person.account_id=p_actor and app_private.has_role(p_actor,'tutor');
 if tutor.id is not null then perform app_private.require_role(p_actor,'tutor');return jsonb_build_object('type','tutor','id',tutor.tutor_id,'financial_terms_ready',true);end if;
 raise exception 'NOT_FOUND' using errcode='P0002';
end $$;
create function app_private.booking_proposal_all_accepted(p_id uuid,p_recheck boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare item record;accepted app_private.operation_proposal_acceptances%rowtype;begin
 for item in select 'learner' as kind,learner_id as id,terms_hash from app_private.operation_customer_terms where proposal_id=p_id union all select 'tutor',tutor_id,terms_hash from finance_private.operation_tutor_terms where proposal_id=p_id loop
  select * into accepted from app_private.operation_proposal_acceptances where proposal_id=p_id and participant_type=item.kind and participant_id=item.id and terms_hash=item.terms_hash;
  if accepted.id is null then return false;end if;
  if p_recheck then
   perform 1 from app_private.accounts where id=accepted.actor_account_id and active for share;if not found then raise exception 'CONSENT_REQUIRED';end if;
   if not exists(select 1 from app_private.auth_account(accepted.actor_account_id) where email_confirmed_at is not null and not coalesce(is_anonymous,false) and deleted_at is null and(banned_until is null or banned_until<=now())) then raise exception 'CONSENT_REQUIRED';end if;
   if item.kind='learner' and not app_private.booking_can_access(accepted.actor_account_id,item.id) then raise exception 'CONSENT_REQUIRED';end if;
   if item.kind='learner' then perform app_private.assert_learner_scope(accepted.actor_account_id,item.id,'booking');end if;
   if item.kind='tutor' then if not exists(select 1 from app_private.tutors where id=item.id and account_id=accepted.actor_account_id and app_private.has_role(accepted.actor_account_id,'tutor')) then raise exception 'CONSENT_REQUIRED';end if;perform app_private.require_role(accepted.actor_account_id,'tutor');end if;
  end if;
 end loop;return true;
end $$;

create function app_private.booking_proposal_dto(p_actor uuid,p_id uuid,p_view text,p_learner_id uuid,p_group boolean) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p app_private.operation_proposals%rowtype;g app_private.group_amendments%rowtype;c app_private.operation_customer_terms%rowtype;t finance_private.operation_tutor_terms%rowtype;result jsonb;terms jsonb;h text;accepted timestamptz;can_accept boolean:=false;n integer;begin
 select * into p from app_private.operation_proposals where id=p_id;if p.id is null or(p.kind='group_amendment') is distinct from p_group then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if p_view='admin' then perform app_private.require_role(p_actor,'admin');h:=app_private.booking_proposal_admin_hash(p.id);
  terms:=jsonb_build_object('customers',coalesce((select jsonb_agg(terms order by learner_id) from app_private.operation_customer_terms where proposal_id=p.id),'[]'),'tutor',(select terms from finance_private.operation_tutor_terms where proposal_id=p.id));
 elsif p_view='tutor' then
  select x.* into t from finance_private.operation_tutor_terms x join app_private.tutors tutor on tutor.id=x.tutor_id where x.proposal_id=p.id and tutor.account_id=p_actor and app_private.has_role(p_actor,'tutor');
  if t.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;terms:=t.terms;h:=t.terms_hash;
  select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='tutor' and participant_id=t.tutor_id;
  can_accept:=app_private.booking_proposal_fresh(p.id) and p.state in ('proposed','accepted') and accepted is null;
 elsif p_view='customer' then
  select count(*) into n from app_private.operation_customer_terms where proposal_id=p.id and(p_learner_id is null or learner_id=p_learner_id) and app_private.booking_can_access(p_actor,learner_id);
  if n=0 then raise exception 'NOT_FOUND' using errcode='P0002';elsif n<>1 then raise exception 'VALIDATION_ERROR';end if;
  select * into c from app_private.operation_customer_terms where proposal_id=p.id and(p_learner_id is null or learner_id=p_learner_id) and app_private.booking_can_access(p_actor,learner_id);
  terms:=c.terms;h:=c.terms_hash;select accepted_at into accepted from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=c.learner_id;
  can_accept:=app_private.booking_proposal_fresh(p.id) and p.state in ('proposed','accepted') and accepted is null and c.financial_terms_ready;
 else raise exception 'VALIDATION_ERROR';end if;
 result:=jsonb_build_object('proposal_id',p.id,'version',p.version,'kind',p.kind,'target_type',p.target_type,'target_id',p.target_id,'base_version',p.base_target_version,'policy_version_id',p.policy_version_id,'state',p.state,'expires_at',p.expires_at,'terms_hash',h,'accepted_at',accepted,'can_accept',can_accept,'required_actions',case when can_accept then '[]'::jsonb||'"review_terms"'::jsonb when p.state='committed' then '[]'::jsonb else '["review_current_status"]'::jsonb end,'view',p_view,'terms',terms);
 if p_view='admin' then result:=result||jsonb_build_object('required_acceptances',coalesce((select jsonb_agg(jsonb_build_object('participant_type',x.kind,'participant_id',x.id,'accepted_at',a.accepted_at) order by x.kind,x.id) from(select 'learner' as kind,learner_id as id from app_private.operation_customer_terms where proposal_id=p.id union all select 'tutor',tutor_id from finance_private.operation_tutor_terms where proposal_id=p.id)x left join app_private.operation_proposal_acceptances a on a.proposal_id=p.id and a.participant_type=x.kind and a.participant_id=x.id),'[]'));end if;
 if p_group then select * into g from app_private.group_amendments where id=p.id;result:=(result-'proposal_id')||jsonb_build_object('amendment_id',p.id,'occurrence_id',p.occurrence_id,'replacement_policy_version_id',g.replacement_policy_version_id);
  if p_view='admin' then result:=result||jsonb_build_object('add_learner_ids',g.add_learner_ids,'remove_enrollment_ids',g.remove_enrollment_ids);end if;
 end if;return result;
end $$;

create function app_private.booking_proposal_validate_terms(p_kind text,p_terms jsonb) returns void language plpgsql immutable set search_path='' as $$
declare allowed text[];field text;begin
 if jsonb_typeof(p_terms) is distinct from 'object' or p_kind is null or p_kind not in ('reschedule','cancellation_remedy') or p_terms->>'target_type' is null or p_terms->>'target_type' not in ('occurrence','enrollment') then raise exception 'VALIDATION_ERROR';end if;
 if p_kind='reschedule' and p_terms->>'target_type'='occurrence' then allowed:=array['target_type','start_at','end_at','time_zone','expires_at'];
 elsif p_kind='reschedule' then allowed:=array['target_type','destination_occurrence_id','expires_at'];
 else allowed:=array['target_type','remedy','expires_at'];end if;
 if p_terms-allowed<>'{}'::jsonb then raise exception 'VALIDATION_ERROR';end if;
 foreach field in array allowed loop if jsonb_typeof(p_terms->field) is distinct from 'string' or length(p_terms->>field)=0 then raise exception 'VALIDATION_ERROR';end if;end loop;
 foreach field in array array['start_at','end_at','expires_at'] loop
  if p_terms?field and(p_terms->>field)!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_TIME';end if;
 end loop;
 if p_terms?'time_zone' and p_terms->>'time_zone'<>'Africa/Cairo' then raise exception 'INVALID_TIME';end if;
 if p_kind='cancellation_remedy' and p_terms->>'remedy' not in ('policy_default','cash_refund','monetary_account_credit','package_entitlement_restoration') then raise exception 'VALIDATION_ERROR';end if;
 if p_terms?'destination_occurrence_id' and(p_terms->>'destination_occurrence_id')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'VALIDATION_ERROR';end if;
end $$;

create function app_private.booking_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;context jsonb;occ app_private.occurrences%rowtype;destination app_private.occurrences%rowtype;seat app_private.enrollments%rowtype;
 p app_private.operation_proposals%rowtype;q app_private.quotes%rowtype;newq app_private.quotes%rowtype;policy app_private.policy_versions%rowtype;fee finance_private.tutor_fee_agreements%rowtype;
 ct app_private.operation_customer_terms%rowtype;acceptance app_private.operation_proposal_acceptances%rowtype;
 resource uuid:=gen_random_uuid();resource_version integer:=1;result jsonb:='{}';event_name text;terms jsonb;customer jsonb;tutor_terms jsonb;kind text;target_type text;target_id uuid;participant jsonb;
 start_time timestamptz;end_time timestamptz;expiry timestamptz;new_policy uuid;new_target integer;new_price bigint;old_price bigint;expected integer;reason text;financial_ready boolean;is_admin boolean;is_tutor boolean;
 adds uuid[];removes uuid[];learner uuid;active_count integer;removed_count integer;proposed_quotes uuid[]:='{}';approval_id uuid;h text;replay jsonb;
begin
 actor:=app_private.require_actor();is_admin:=app_private.has_role(actor,'admin');expected:=(p_input->>'expected_version')::int;
 if p_name='create_operation_proposal' then
  kind:=p_input->>'kind';terms:=p_input->'requested_terms';perform app_private.booking_proposal_validate_terms(kind,terms);target_type:=terms->>'target_type';target_id:=(p_input->>'target_id')::uuid;
  if target_type='enrollment' then select * into seat from app_private.enrollments where id=target_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking',true);occ:=app_private.booking_lock_occurrence(seat.occurrence_id);
  else occ:=app_private.booking_lock_occurrence(target_id);is_tutor:=exists(select 1 from app_private.tutors where id=occ.tutor_id and account_id=actor and app_private.has_role(actor,'tutor'));
   if is_admin then perform app_private.require_role(actor,'admin');elsif is_tutor and kind='reschedule' then perform app_private.require_role(actor,'tutor');
   elsif occ.format='private' and kind='reschedule' then select * into seat from app_private.enrollments where occurrence_id=occ.id and state in ('held','confirmed') and app_private.booking_can_access(actor,learner_id);if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking');
   else raise exception 'NOT_FOUND' using errcode='P0002';end if;
  end if;
 elsif p_name='propose_group_amendment' then perform app_private.require_role(actor,'admin');occ:=app_private.booking_lock_occurrence((p_input->>'occurrence_id')::uuid);kind:='group_amendment';target_type:='occurrence';target_id:=occ.id;
 elsif p_name in ('reschedule_occurrence','cancel_occurrence','cancel_enrollment','transfer_enrollment') then
  if p_name in ('cancel_enrollment','transfer_enrollment') then select * into seat from app_private.enrollments where id=(p_input->>'enrollment_id')::uuid;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.assert_learner_scope(actor,seat.learner_id,'booking',true);occ:=app_private.booking_lock_occurrence(seat.occurrence_id);resource:=seat.id;
  else perform app_private.require_role(actor,'admin');occ:=app_private.booking_lock_occurrence((p_input->>'occurrence_id')::uuid);resource:=occ.id;end if;
 else
  select * into p from app_private.operation_proposals where id=coalesce((p_input->>'proposal_id')::uuid,(p_input->>'amendment_id')::uuid);
  if p.id is null or(p.kind='group_amendment') is distinct from(p_name in ('accept_group_amendment','decline_group_amendment','commit_group_amendment')) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  occ:=app_private.booking_lock_occurrence(p.occurrence_id);select * into p from app_private.operation_proposals where id=p.id for update;resource:=p.id;
  if p_name in ('approve_operation_proposal','commit_group_amendment') then perform app_private.require_role(actor,'admin');
  elsif p_name in ('accept_operation_proposal','accept_group_amendment') then participant:=app_private.booking_proposal_participant(actor,p.id,p_input->>'terms_hash');
  elsif p_name in ('decline_operation_proposal','decline_group_amendment') then
   if is_admin and p_name='decline_group_amendment' then perform app_private.require_role(actor,'admin');else
    select terms_hash into h from app_private.operation_customer_terms where proposal_id=p.id and app_private.booking_can_access(actor,learner_id) order by learner_id limit 1;
    if h is null then select t.terms_hash into h from finance_private.operation_tutor_terms t join app_private.tutors person on person.id=t.tutor_id where t.proposal_id=p.id and person.account_id=actor;end if;
    participant:=app_private.booking_proposal_participant(actor,p.id,h);
   end if;
  else raise exception 'VALIDATION_ERROR';end if;
 end if;
 context:=app_private.booking_begin(actor,p_name,p_input,p_key);replay:=context->'replay_result';if replay is not null and replay<>'null'::jsonb then return replay;end if;
 if p_name in ('create_operation_proposal','propose_group_amendment','reschedule_occurrence','cancel_occurrence','cancel_enrollment','transfer_enrollment') then
  if expected is null or expected is distinct from(case when(p_name='create_operation_proposal' and target_type='enrollment') or p_name in ('cancel_enrollment','transfer_enrollment') then seat.version else occ.version end) then raise exception 'VERSION_CONFLICT';end if;
 else if expected is null or expected<>p.version then raise exception 'VERSION_CONFLICT';end if;end if;
 if p_name not in ('accept_operation_proposal','accept_group_amendment','commit_group_amendment','transfer_enrollment') then reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;end if;

 if p_name in ('create_operation_proposal','propose_group_amendment') then
  if occ.state not in ('forming','confirmed') then raise exception 'STATE_CONFLICT';end if;
  perform app_private.booking_expire_holds(occ.id);perform app_private.booking_expire_proposals(occ.id);
  if target_type='enrollment' and(seat.state not in ('held','confirmed') or(seat.state='held' and seat.hold_expires_at<=now())) then raise exception 'WINDOW_CLOSED';end if;
  start_time:=occ.start_at;end_time:=occ.end_at;new_policy:=occ.policy_version_id;new_target:=occ.target_tier;financial_ready:=true;
  if p_name='create_operation_proposal' then
   expiry:=(terms->>'expires_at')::timestamptz;
   if kind='reschedule' and target_type='occurrence' then start_time:=(terms->>'start_at')::timestamptz;end_time:=(terms->>'end_at')::timestamptz;
    if not isfinite(start_time) or not isfinite(end_time) or start_time<=now() or end_time-start_time<>make_interval(mins=>occ.duration_minutes) then raise exception 'INVALID_TIME';end if;
    perform app_private.booking_assert_schedule(occ.tutor_id,start_time,end_time,occ.id);
    if occ.state='forming' and start_time-make_interval(mins=>least((app_private.policy_content(occ.policy_version_id)->>'confirmation_deadline_minutes_before_start')::numeric,2147483647)::int)<=now() then raise exception 'WINDOW_CLOSED';end if;
   elsif kind='reschedule' then
    select * into destination from app_private.occurrences where id=(terms->>'destination_occurrence_id')::uuid and state='forming' and start_at>now();
    if destination.id is null or destination.id=occ.id then raise exception 'NOT_FOUND' using errcode='P0002';end if;start_time:=destination.start_at;end_time:=destination.end_at;new_policy:=destination.policy_version_id;new_target:=destination.target_tier;financial_ready:=false;
   else financial_ready:=false;
    if terms->>'remedy'<>'policy_default' and not(app_private.policy_content(occ.policy_version_id)->'allowed_refund_remedies'?(terms->>'remedy')) then raise exception 'POLICY_INCOMPLETE';end if;
   end if;
  else
   if occ.format<>'group' or exists(select 1 from app_private.operation_proposals where occurrence_id=occ.id and kind='group_amendment' and state in ('proposed','accepted','approved')) then raise exception 'STATE_CONFLICT';end if;
   if jsonb_typeof(p_input->'add_learner_ids') is distinct from 'array' or jsonb_typeof(p_input->'remove_enrollment_ids') is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
   select coalesce(array_agg(value::uuid),'{}') into adds from jsonb_array_elements_text(p_input->'add_learner_ids');select coalesce(array_agg(value::uuid),'{}') into removes from jsonb_array_elements_text(p_input->'remove_enrollment_ids');
   if cardinality(adds)>4 or cardinality(removes)>4 or(select count(distinct x) from unnest(adds)x)<>cardinality(adds) or(select count(distinct x) from unnest(removes)x)<>cardinality(removes) then raise exception 'VALIDATION_ERROR';end if;
   new_target:=(p_input->>'target_tier')::int;new_policy:=(p_input->>'replacement_policy_version_id')::uuid;expiry:=(p_input->>'expires_at')::timestamptz;
   select * into policy from app_private.policy_versions where id=new_policy for share;
   if policy.id is null or policy.status not in ('approved','published') or policy.scope<>'group' or policy.effective_at>now() then raise exception 'POLICY_INCOMPLETE';end if;
   perform app_private.assert_catalog_publication(app_private.catalog_environment(),policy.environment_scope,policy.is_synthetic);
   customer:=app_private.policy_content(policy.id);
   if new_target is null or new_target not between 2 and 4 or new_target>occ.capacity or(customer->>'group_target_size')::int<>new_target or(customer->>'group_capacity')::numeric<occ.capacity or(customer->>'duration_minutes')::numeric<>occ.duration_minutes then raise exception 'POLICY_INCOMPLETE';end if;
   if now()>=occ.start_at-make_interval(mins=>least((customer->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int) then raise exception 'WINDOW_CLOSED';end if;
   expiry:=least(expiry,now()+make_interval(mins=>least((customer->>'amendment_acceptance_minutes')::numeric,2147483647)::int),occ.start_at-make_interval(mins=>least((customer->>'latest_amendment_minutes_before_start')::numeric,2147483647)::int));
   select * into fee from finance_private.tutor_fee_agreements where id=(p_input->>'fee_agreement_id')::uuid;
   if fee.id is null or fee.occurrence_id<>occ.id or fee.tutor_id<>occ.tutor_id or fee.purpose<>'amendment' or fee.base_occurrence_version<>occ.version or fee.target_tier<>new_target or fee.pricing_version_id<>policy.pricing_version_id or fee.duration_minutes<>occ.duration_minutes then raise exception 'POLICY_INCOMPLETE';end if;
   perform app_private.assert_exact_tutor_fee(fee.pricing_version_id,new_target,fee.fee_minor,fee.currency,fee.duration_minutes);
   select count(*) into active_count from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now()));
   select count(*) into removed_count from app_private.enrollments where occurrence_id=occ.id and id=any(removes) and(state='confirmed' or(state='held' and hold_expires_at>now()));
   if removed_count<>cardinality(removes) or active_count-removed_count+cardinality(adds)<>new_target or active_count+cardinality(adds)>occ.capacity then raise exception 'CAPACITY_CONFLICT';end if;
   foreach learner in array adds loop
    if not exists(select 1 from app_private.learners l join app_private.accounts a on a.id=l.account_id where l.id=learner and a.active) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if exists(select 1 from app_private.enrollments where occurrence_id=occ.id and learner_id=learner and state in ('held','confirmed')) then raise exception 'STATE_CONFLICT';end if;
   end loop;
   terms:=jsonb_build_object('target_type','occurrence','target_tier',new_target,'replacement_policy_version_id',new_policy,'add_learner_ids',adds,'remove_enrollment_ids',removes,'expires_at',expiry);
  end if;
  if expiry is null or not isfinite(expiry) or expiry<=now() or expiry>least(occ.start_at,start_time) then raise exception 'INVALID_TIME';end if;
  select least(expiry,min(hold_expires_at)) into expiry from app_private.enrollments where occurrence_id=occ.id and state='held' and hold_expires_at>now() and(target_type='occurrence' or id=target_id);
  if p_name='propose_group_amendment' then foreach learner in array adds loop perform app_private.booking_new_hold(occ.id,learner,actor,resource,new_policy,new_target,expiry);end loop;end if;
  insert into app_private.operation_proposals(id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason)
   values(resource,kind,target_type,target_id,occ.id,case when target_type='enrollment' then seat.version else occ.version end,occ.version,app_private.booking_roster_fingerprint(occ.id),new_policy,terms,expiry,actor,reason) returning * into p;
  if p_name='propose_group_amendment' then insert into app_private.group_amendments(id,replacement_policy_version_id,pricing_version_id,target_tier,add_learner_ids,remove_enrollment_ids) values(p.id,new_policy,policy.pricing_version_id,new_target,adds,removes);end if;
  for seat in select * from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now())) and(target_type='occurrence' or id=target_id) order by id for update loop
   select * into q from app_private.quotes where id=seat.current_quote_id;new_price:=q.customer_price_minor;
   if p_name='propose_group_amendment' then
    select (value->>'seat_price_minor')::bigint into new_price from app_private.pricing_versions v,jsonb_array_elements(v.customer_pricing->'group_tiers') where v.id=policy.pricing_version_id and(value->>'group_size')::int=new_target;
    if seat.id=any(removes) then new_price:=0;end if;
    newq:=app_private.booking_proposal_new_quote(seat.id,new_policy,new_target,new_price,start_time,end_time,least(q.expires_at,expiry),true);proposed_quotes:=array_append(proposed_quotes,newq.id);
   elsif kind='reschedule' and target_type='enrollment' then new_price:=(app_private.booking_occurrence_dto(destination.id)->>'customer_price_minor')::bigint;end if;
   customer:=app_private.booking_proposal_customer_json(seat.id,new_policy,start_time,end_time,new_price,case when kind='cancellation_remedy' then terms->>'remedy' when p_name='propose_group_amendment' and seat.id=any(removes) then 'policy_default' else 'none' end,destination.id,p_name='propose_group_amendment' and seat.learner_id=any(adds));
   insert into app_private.operation_customer_terms(proposal_id,learner_id,enrollment_id,source_quote_id,proposed_quote_id,terms,terms_hash,financial_terms_ready)
    values(p.id,seat.learner_id,seat.id,q.id,newq.id,customer,app_private.booking_proposal_hash(p.id,'learner',seat.learner_id,customer,p.expires_at,p.base_target_version),financial_ready and not coalesce(seat.id=any(removes),false));
  end loop;
  tutor_terms:=app_private.booking_proposal_tutor_json(occ.id,case when p_name='propose_group_amendment' then fee.id else occ.current_fee_agreement_id end,start_time,end_time,new_target);
  insert into finance_private.operation_tutor_terms(proposal_id,tutor_id,fee_agreement_id,terms,terms_hash) values(p.id,occ.tutor_id,case when p_name='propose_group_amendment' then fee.id else occ.current_fee_agreement_id end,tutor_terms,app_private.booking_proposal_hash(p.id,'tutor',occ.tutor_id,tutor_terms,p.expires_at,p.base_target_version));
  perform app_private.booking_enqueue_due(occ.id,p.expires_at);
  if p_name='propose_group_amendment' then result:=jsonb_build_object('amendment_id',p.id,'affected_quote_ids',proposed_quotes);event_name:='group_amendment_proposed';
  else h:=case when is_admin then app_private.booking_proposal_admin_hash(p.id) when is_tutor then(select terms_hash from finance_private.operation_tutor_terms where proposal_id=p.id) else(select terms_hash from app_private.operation_customer_terms where proposal_id=p.id and app_private.booking_can_access(actor,learner_id) order by learner_id limit 1) end;
   result:=jsonb_build_object('proposal_id',p.id,'terms_hash',h,'expires_at',p.expires_at,'required_actions','["review_terms"]'::jsonb);event_name:='operation_proposal_created';end if;
  perform set_config('response.status','201',true);
 elsif p_name in ('accept_operation_proposal','accept_group_amendment','decline_operation_proposal','decline_group_amendment','approve_operation_proposal','commit_group_amendment') then
  if p.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
  if not app_private.booking_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
  if p_name in ('accept_operation_proposal','accept_group_amendment') then
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;if not(participant->>'financial_terms_ready')::boolean then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   insert into app_private.operation_proposal_acceptances(proposal_id,participant_type,participant_id,actor_account_id,terms_hash) values(p.id,participant->>'type',(participant->>'id')::uuid,actor,p_input->>'terms_hash') on conflict(proposal_id,participant_type,participant_id) do nothing;
   select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type=participant->>'type' and participant_id=(participant->>'id')::uuid;
   if acceptance.actor_account_id<>actor then raise exception 'STATE_CONFLICT';end if;
   if app_private.booking_proposal_all_accepted(p.id) then update app_private.operation_proposals set state='accepted',updated_at=now() where id=p.id;end if;
   result:=jsonb_build_object('accepted_at',acceptance.accepted_at);event_name:='proposal_terms_accepted';resource_version:=p.version;
  elsif p_name in ('decline_operation_proposal','decline_group_amendment') then
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   update app_private.operation_proposals set state='declined',version=version+1,updated_at=now() where id=p.id returning version into resource_version;
   update app_private.enrollments set state='cancelled',version=version+1,updated_at=now() where amendment_id=p.id and state='held';perform app_private.booking_enqueue_due(occ.id,now());
   result:=jsonb_build_object('state','declined');event_name:='proposal_declined';
  elsif p_name='approve_operation_proposal' then
   if p_input->>'decision' is null or p_input->>'decision' not in ('approved','rejected') or p_input->>'terms_hash' is distinct from app_private.booking_proposal_admin_hash(p.id) then raise exception 'VALIDATION_ERROR';end if;
   if p.state not in ('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   if p_input->>'decision'='approved' and not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
   if p_input->>'decision'='approved' and exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and not financial_terms_ready) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,p_input->>'terms_hash',p_input->>'decision',actor,reason) returning id into approval_id;
   update app_private.operation_proposals set state=case when p_input->>'decision'='approved' then 'approved' else 'declined' end,version=version+1,approved_by=actor,approved_at=now(),updated_at=now() where id=p.id returning * into p;
   resource_version:=p.version;result:=jsonb_build_object('approval_id',approval_id,'state',p.state);event_name:='operation_proposal_reviewed';
  else
   if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
   raise exception 'DEPENDENCY_UNAVAILABLE'; -- T06 owns atomic charge/credit/fee/roster postings.
  end if;
 elsif p_name='reschedule_occurrence' then
  if p_input->>'time_zone' is distinct from 'Africa/Cairo' then raise exception 'INVALID_TIME';end if;
  start_time:=(p_input->>'start_at')::timestamptz;end_time:=(p_input->>'end_at')::timestamptz;
  if p_input->>'accepted_proposal_id' is not null then
   select * into p from app_private.operation_proposals where id=(p_input->>'accepted_proposal_id')::uuid for update;
   if p.id is null or p.kind<>'reschedule' or p.target_type<>'occurrence' or p.target_id<>occ.id or p.state<>'approved' then raise exception 'STATE_CONFLICT';end if;
   if not app_private.booking_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
   if(p.requested_terms->>'start_at')::timestamptz is distinct from start_time or(p.requested_terms->>'end_at')::timestamptz is distinct from end_time or not app_private.has_role(p.approved_by,'admin') then raise exception 'CONSENT_REQUIRED';end if;
   if not app_private.booking_proposal_all_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
  elsif exists(select 1 from app_private.enrollments where occurrence_id=occ.id and(state='confirmed' or(state='held' and hold_expires_at>now()))) then raise exception 'CONSENT_REQUIRED';end if;
  occ:=app_private.booking_apply_schedule(occ.id,start_time,end_time,actor,(context->>'command_id')::uuid);
  if p.id is not null then
   for ct in select * from app_private.operation_customer_terms where proposal_id=p.id order by enrollment_id loop
    select * into seat from app_private.enrollments where id=ct.enrollment_id for update;select * into q from app_private.quotes where id=seat.current_quote_id;
    newq:=app_private.booking_proposal_new_quote(seat.id,q.policy_version_id,q.target_tier,q.customer_price_minor,start_time,end_time,least(q.expires_at,occ.confirmation_deadline_at),false);
    select * into acceptance from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=ct.learner_id;
    insert into app_private.quote_acceptances(quote_id,actor_account_id,learner_id,terms_hash,accepted_at,acceptance_basis,source_proposal_acceptance_id,source_terms_hash) values(newq.id,acceptance.actor_account_id,ct.learner_id,newq.terms_hash,acceptance.accepted_at,'operation_proposal',acceptance.id,ct.terms_hash);
    update app_private.enrollments set current_quote_id=newq.id,hold_expires_at=case when state='held' then least(hold_expires_at,newq.expires_at) else hold_expires_at end,version=version+1,updated_at=now() where id=seat.id;
   end loop;
   update app_private.operation_proposals set state='committed',version=version+1,committed_at=now(),updated_at=now() where id=p.id;
  end if;
  resource_version:=occ.version;result:=jsonb_build_object('meeting_status',occ.meeting_status,'calendar_job_id',occ.calendar_job_id);event_name:='occurrence_rescheduled';
 elsif p_name='cancel_occurrence' then
  if occ.state not in ('draft','forming','confirmed') then raise exception 'STATE_CONFLICT';end if;
  if exists(select 1 from app_private.enrollments where occurrence_id=occ.id) then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
  update app_private.occurrences set state='cancelled',meeting_status='revoked',version=version+1,updated_at=now() where id=occ.id returning version into resource_version;update app_private.tutor_reservations set active=false where occurrence_id=occ.id;
  update app_private.waitlist_entries set state='cancelled',version=version+1,updated_at=now() where occurrence_id=occ.id and state in ('waiting','offered');
  result:=jsonb_build_object('state','cancelled','affected_enrollment_ids','[]'::jsonb);event_name:='occurrence_cancelled';
 elsif p_name in ('cancel_enrollment','transfer_enrollment') then raise exception 'DEPENDENCY_UNAVAILABLE';
 else raise exception 'VALIDATION_ERROR';end if;
 return app_private.booking_finish(context,resource,resource_version,result,event_name,jsonb_build_object('resource_id',resource,'occurrence_id',occ.id,'version',resource_version));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;

create or replace function app_private.booking_expire_proposals(p_occurrence_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;ids uuid[]:='{}';event_id uuid;begin
 for p in select * from app_private.operation_proposals where occurrence_id=p_occurrence_id and state in ('proposed','accepted','approved') order by id for update loop
  if p.expires_at<=now() or not app_private.booking_proposal_fresh(p.id) then
   update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason=case when p.expires_at<=now() then 'window_closed' else 'stale_terms' end,updated_at=now() where id=p.id;
   update app_private.enrollments set state='expired',version=version+1,updated_at=now() where amendment_id=p.id and state='held';
   ids:=array_append(ids,p.id);event_id:=gen_random_uuid();
   insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,event_id,'booking_proposal_expired',p.id,jsonb_build_object('actor_kind','system','occurrence_id',p_occurrence_id));
   perform app_private.enqueue_event(event_id,'booking_proposal_expired',p.id,jsonb_build_object('proposal_id',p.id,'occurrence_id',p_occurrence_id),'notifications.route');
  end if;
 end loop;return ids;
end $$;
create or replace function app_private.booking_next_proposal_due(p_occurrence_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select min(expires_at) from app_private.operation_proposals where occurrence_id=p_occurrence_id and state in ('proposed','accepted','approved')
$$;
create or replace function app_private.booking_pending_proposals(p_occurrence_id uuid,p_learner_id uuid default null,p_tutor_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposal_id',p.id,'kind',case when p.kind='group_amendment' then 'amendment' else 'operation' end) order by p.created_at,p.id),'[]') from app_private.operation_proposals p
 where p.occurrence_id=p_occurrence_id and p.state in ('proposed','accepted','approved') and p.expires_at>now()
 and(p_learner_id is null or exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and learner_id=p_learner_id))
 and(p_tutor_id is null or exists(select 1 from finance_private.operation_tutor_terms where proposal_id=p.id and tutor_id=p_tutor_id))
$$;

create function api.create_operation_proposal(p_kind text,p_target_id uuid,p_requested_terms jsonb,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('create_operation_proposal',jsonb_build_object('kind',p_kind,'target_id',p_target_id,'requested_terms',p_requested_terms,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.accept_operation_proposal(p_proposal_id uuid,p_terms_hash text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('accept_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'terms_hash',p_terms_hash,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.decline_operation_proposal(p_proposal_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('decline_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.approve_operation_proposal(p_proposal_id uuid,p_terms_hash text,p_decision text,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('approve_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'terms_hash',p_terms_hash,'decision',p_decision,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.propose_group_amendment(p_occurrence_id uuid,p_add_learner_ids uuid[],p_remove_enrollment_ids uuid[],p_target_tier integer,p_fee_agreement_id uuid,p_replacement_policy_version_id uuid,p_expires_at timestamptz,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('propose_group_amendment',jsonb_build_object('occurrence_id',p_occurrence_id,'add_learner_ids',p_add_learner_ids,'remove_enrollment_ids',p_remove_enrollment_ids,'target_tier',p_target_tier,'fee_agreement_id',p_fee_agreement_id,'replacement_policy_version_id',p_replacement_policy_version_id,'expires_at',p_expires_at,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.accept_group_amendment(p_amendment_id uuid,p_terms_hash text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('accept_group_amendment',jsonb_build_object('amendment_id',p_amendment_id,'terms_hash',p_terms_hash,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.decline_group_amendment(p_amendment_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('decline_group_amendment',jsonb_build_object('amendment_id',p_amendment_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.commit_group_amendment(p_amendment_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('commit_group_amendment',jsonb_build_object('amendment_id',p_amendment_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.reschedule_occurrence(p_occurrence_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_time_zone text,p_reason text,p_accepted_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('reschedule_occurrence',jsonb_build_object('occurrence_id',p_occurrence_id,'start_at',p_start_at,'end_at',p_end_at,'time_zone',p_time_zone,'reason',p_reason,'accepted_proposal_id',p_accepted_proposal_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.cancel_occurrence(p_occurrence_id uuid,p_reason text,p_remedy_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('cancel_occurrence',jsonb_build_object('occurrence_id',p_occurrence_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.cancel_enrollment(p_enrollment_id uuid,p_reason text,p_remedy_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('cancel_enrollment',jsonb_build_object('enrollment_id',p_enrollment_id,'reason',p_reason,'remedy_proposal_id',p_remedy_proposal_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.transfer_enrollment(p_enrollment_id uuid,p_destination_occurrence_id uuid,p_accepted_proposal_id uuid,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.booking_proposal_command('transfer_enrollment',jsonb_build_object('enrollment_id',p_enrollment_id,'destination_occurrence_id',p_destination_occurrence_id,'accepted_proposal_id',p_accepted_proposal_id,'expected_version',p_expected_version),p_idempotency_key) $$;
create function api.get_operation_proposal(p_proposal_id uuid,p_view text default 'customer',p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$ declare actor uuid;begin actor:=app_private.require_actor();return app_private.booking_proposal_dto(actor,p_proposal_id,p_view,p_learner_id,false);end $$;
create function api.get_group_amendment(p_amendment_id uuid,p_view text default 'customer',p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$ declare actor uuid;begin actor:=app_private.require_actor();return app_private.booking_proposal_dto(actor,p_amendment_id,p_view,p_learner_id,true);end $$;
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure::text as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and(p.proname like 'booking_proposal_%' or p.proname in ('booking_expire_proposals','booking_next_proposal_due','booking_pending_proposals'))) or(n.nspname='api' and p.proname in ('create_operation_proposal','accept_operation_proposal','decline_operation_proposal','approve_operation_proposal','propose_group_amendment','accept_group_amendment','decline_group_amendment','commit_group_amendment','reschedule_occurrence','cancel_occurrence','cancel_enrollment','transfer_enrollment','get_operation_proposal','get_group_amendment')) loop
  execute format('alter function %s owner to git_tutor_commands',fn.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',fn.signature);
  if fn.nspname='api' then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
notify pgrst,'reload schema';
