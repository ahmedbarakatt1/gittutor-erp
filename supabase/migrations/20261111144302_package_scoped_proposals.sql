-- T05 package-only scoped consent. No funding/delivery qualification is invented.
grant create on schema api,app_private to git_tutor_commands;
alter table app_private.operation_proposals drop constraint operation_proposals_kind_check;
alter table app_private.operation_proposals add check(kind in('reschedule','cancellation_remedy','group_amendment','package_coverage','package_conversion'));
alter table app_private.operation_proposals drop constraint operation_proposals_target_type_check;
alter table app_private.operation_proposals add check(target_type in('occurrence','enrollment','package_purchase'));
alter table app_private.operation_proposals alter column occurrence_id drop not null;
alter table app_private.operation_proposals add check((kind='package_conversion' and target_type='package_purchase' and occurrence_id is null) or(kind<>'package_conversion' and target_type<>'package_purchase' and occurrence_id is not null));
create table app_private.package_operation_terms(
 proposal_id uuid primary key references app_private.operation_proposals(id),learner_id uuid not null references app_private.learners(id),source_purchase_id uuid not null references app_private.package_purchases(id),target_purchase_id uuid references app_private.package_purchases(id),
 new_contract_version_id uuid references app_private.policy_versions(id),source_purchase_version integer not null,target_purchase_version integer,source_quote_id uuid references app_private.quotes(id),allocation_snapshot jsonb not null,source_hash text not null,
 customer_terms jsonb not null,terms_hash text not null,financial_terms_ready boolean not null,requires_admin_approval boolean not null,replaces_proposal_id uuid references app_private.operation_proposals(id)
);
alter table app_private.package_operation_terms enable row level security;
grant select,insert on app_private.package_operation_terms to git_tutor_commands;
create policy commands_access on app_private.package_operation_terms to git_tutor_commands using(true) with check(true);
revoke all on app_private.package_operation_terms from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_package_proposal before update or delete on app_private.package_operation_terms for each row execute function app_private.reject_immutable_change();

create function app_private.package_proposal_can_access(p_actor uuid,p_learner uuid,p_kind text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.accounts a where a.id=p_actor and a.active) and(exists(select 1 from app_private.learners l where l.id=p_learner and l.account_id=p_actor) or exists(select 1 from app_private.guardian_links g where g.learner_id=p_learner and g.guardian_account_id=p_actor and g.revoked_at is null and g.valid_until>now() and 'payments'=any(g.scopes) and(p_kind<>'package_coverage' or 'booking'=any(g.scopes))))
$$;
create function app_private.package_proposal_scope(p_actor uuid,p_learner uuid,p_kind text,p_allow_admin boolean default false) returns void language plpgsql security definer set search_path='' as $$ begin
 perform app_private.package_assert_scope(p_actor,p_learner,'payments',p_allow_admin);
 if p_kind='package_coverage' then perform app_private.package_assert_scope(p_actor,p_learner,'booking',p_allow_admin);end if;
end $$;
create table app_private.package_proposal_consumptions(
 proposal_id uuid primary key references app_private.operation_proposals(id),command_id uuid not null,actor_account_id uuid not null references app_private.accounts(id),terms_hash text not null,accepted_actor_account_id uuid not null references app_private.accounts(id),accepted_at timestamptz not null,consumed_at timestamptz not null default now()
);
alter table app_private.package_proposal_consumptions enable row level security;
grant select,insert on app_private.package_proposal_consumptions to git_tutor_commands;
create policy commands_access on app_private.package_proposal_consumptions to git_tutor_commands using(true) with check(true);
revoke all on app_private.package_proposal_consumptions from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_package_proposal_consumption before update or delete on app_private.package_proposal_consumptions for each row execute function app_private.reject_immutable_change();
create function app_private.package_proposal_validate(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;a app_private.operation_proposal_acceptances%rowtype;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;
 if t.proposal_id is null then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.package_proposal_scope(p_actor,t.learner_id,p.kind,true);
 -- Caller has acquired booking (when applicable), learner, purchase and lot locks in order.
 select * into p from app_private.operation_proposals where id=p_id for update;
 if p.state not in('accepted','approved') or p.expires_at<=now() or not t.financial_terms_ready then raise exception 'CONSENT_REQUIRED';end if;
 if not app_private.package_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
 if not app_private.package_proposal_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 if t.requires_admin_approval then
  if p.state<>'approved' or p.approved_by is null then raise exception 'CONSENT_REQUIRED';end if;
  perform app_private.require_role(p.approved_by,'admin');
  if not exists(select 1 from app_private.operation_proposal_approvals where proposal_id=p.id and terms_hash=t.terms_hash and actor_account_id=p.approved_by and decision='approved') then raise exception 'CONSENT_REQUIRED';end if;
 end if;
 select * into a from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=t.learner_id and terms_hash=t.terms_hash;
 return jsonb_build_object('proposal_id',p.id,'proposal_version',p.version,'terms',t.customer_terms,'source_hash',t.source_hash,'allocations',t.allocation_snapshot,'accepted_actor_account_id',a.actor_account_id,'accepted_at',a.accepted_at);
end $$;
create or replace function app_private.package_validate_coverage_proposal(p_proposal_id uuid,p_actor uuid,p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.package_proposal_validate(p_proposal_id,p_actor);
 if not exists(select 1 from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id where p.id=p_proposal_id and p.kind='package_coverage' and p.target_id=p_enrollment_id and t.source_purchase_id=p_purchase_id and(t.customer_terms->>'reserved_credit_quanta')::bigint=p_credit_quanta) then raise exception 'CONSENT_REQUIRED';end if;return result;
end $$;
create or replace function app_private.package_validate_conversion_proposal(p_proposal_id uuid,p_actor uuid,p_source_purchase_id uuid,p_target_purchase_id uuid,p_new_contract_version_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=app_private.package_proposal_validate(p_proposal_id,p_actor);
 if not exists(select 1 from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id where p.id=p_proposal_id and p.kind='package_conversion' and t.source_purchase_id=p_source_purchase_id and t.target_purchase_id is not distinct from p_target_purchase_id and t.new_contract_version_id=p_new_contract_version_id and(t.customer_terms->>'source_credit_quanta')::bigint=p_credit_quanta) then raise exception 'CONSENT_REQUIRED';end if;return result;
end $$;
create or replace function app_private.package_commit_proposal(p_proposal_id uuid,p_command_context jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;a app_private.operation_proposal_acceptances%rowtype;actor uuid;begin
 if p_proposal_id is null then return;end if;actor:=(p_command_context->>'actor_account_id')::uuid;
 select * into p from app_private.operation_proposals where id=p_proposal_id for update;select * into t from app_private.package_operation_terms where proposal_id=p_proposal_id;
 if p.state not in('accepted','approved') or t.proposal_id is null or actor is null or p.expires_at<=now() then raise exception 'CONSENT_REQUIRED';end if;
 perform app_private.package_proposal_scope(actor,t.learner_id,p.kind,true);if not app_private.package_proposal_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;
 if t.requires_admin_approval then if p.state<>'approved' then raise exception 'CONSENT_REQUIRED';end if;perform app_private.require_role(p.approved_by,'admin');end if;
 select * into a from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=t.learner_id and terms_hash=t.terms_hash;
 insert into app_private.package_proposal_consumptions(proposal_id,command_id,actor_account_id,terms_hash,accepted_actor_account_id,accepted_at) values(p.id,(p_command_context->>'command_id')::uuid,actor,t.terms_hash,a.actor_account_id,a.accepted_at);
 update app_private.operation_proposals set state='committed',version=version+1,committed_at=now(),updated_at=now() where id=p.id;
end $$;
create or replace function app_private.package_expire_proposals(p_purchase_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;ids uuid[]:='{}';event_id uuid;begin
 for p in select p.* from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id where t.source_purchase_id=p_purchase_id and p.state in('proposed','accepted','approved') and p.expires_at<=now() order by p.id for update of p loop
  update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason='window_closed',updated_at=now() where id=p.id;ids:=array_append(ids,p.id);event_id:=gen_random_uuid();
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,event_id,'package_proposal_expired',p.id,jsonb_build_object('actor_kind','system','package_purchase_id',p_purchase_id));
  perform app_private.enqueue_event(event_id,'package_proposal_expired',p.id,jsonb_build_object('proposal_id',p.id,'package_purchase_id',p_purchase_id),'notifications.route');
 end loop;return ids;
end $$;
create or replace function app_private.package_next_proposal_due(p_purchase_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$ select min(p.expires_at) from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id where t.source_purchase_id=p_purchase_id and p.state in('proposed','accepted','approved') and p.expires_at>now() $$;
create or replace function app_private.package_pending_proposals(p_purchase_id uuid,p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposal_id',p.id,'kind',p.kind) order by p.created_at,p.id),'[]') from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id where(t.source_purchase_id=p_purchase_id or t.target_purchase_id=p_purchase_id) and p.state in('proposed','accepted','approved') and p.expires_at>now() and(app_private.has_role(p_actor,'admin') or app_private.package_proposal_can_access(p_actor,t.learner_id,p.kind))
$$;
create function app_private.package_route_operation(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if(p_name='create_operation_proposal' and p_input->>'kind' in('package_coverage','package_conversion')) or(p_name<>'create_operation_proposal' and exists(select 1 from app_private.package_operation_terms where proposal_id=(p_input->>'proposal_id')::uuid)) then return app_private.package_proposal_command(p_name,p_input,p_key);end if;
 return app_private.booking_proposal_command(p_name,p_input,p_key);
end $$;
create or replace function api.create_operation_proposal(p_kind text,p_target_id uuid,p_requested_terms jsonb,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_route_operation('create_operation_proposal',jsonb_build_object('kind',p_kind,'target_id',p_target_id,'requested_terms',p_requested_terms,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create or replace function api.accept_operation_proposal(p_proposal_id uuid,p_terms_hash text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_route_operation('accept_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'terms_hash',p_terms_hash,'expected_version',p_expected_version),p_idempotency_key) $$;
create or replace function api.decline_operation_proposal(p_proposal_id uuid,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_route_operation('decline_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create or replace function api.approve_operation_proposal(p_proposal_id uuid,p_terms_hash text,p_decision text,p_reason text,p_expected_version integer,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_route_operation('approve_operation_proposal',jsonb_build_object('proposal_id',p_proposal_id,'terms_hash',p_terms_hash,'decision',p_decision,'reason',p_reason,'expected_version',p_expected_version),p_idempotency_key) $$;
create or replace function api.get_operation_proposal(p_proposal_id uuid,p_view text default 'customer',p_learner_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();learner uuid;begin
 select learner_id into learner from app_private.package_operation_terms where proposal_id=p_proposal_id;
 if learner is not null then if p_learner_id is not null and p_learner_id<>learner then raise exception 'NOT_FOUND' using errcode='P0002';end if;return app_private.package_proposal_dto(actor,p_proposal_id,p_view);end if;
 return app_private.booking_proposal_dto(actor,p_proposal_id,p_view,p_learner_id,false);
end $$;
create function api.list_package_operation_proposals(p_learner_id uuid default null,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();is_admin boolean:=app_private.has_role(actor,'admin');row record;items jsonb:='[]';next_cursor text;cut_time timestamptz;cut_id uuid;count integer:=0;dto jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 or(p_state is not null and p_state not in('proposed','accepted','approved','committed','declined','expired')) then raise exception 'VALIDATION_ERROR';end if;
 if p_learner_id is not null then perform app_private.package_assert_scope(actor,p_learner_id,'payments',true);end if;
 if p_cursor is not null then begin cut_time:=split_part(p_cursor,'|',1)::timestamptz;cut_id:=split_part(p_cursor,'|',2)::uuid;exception when others then raise exception 'VALIDATION_ERROR';end;end if;
 for row in select p.*,t.learner_id,l.display_name from app_private.operation_proposals p join app_private.package_operation_terms t on t.proposal_id=p.id join app_private.learners l on l.id=t.learner_id where(p_learner_id is null or t.learner_id=p_learner_id) and(p_state is null or p.state=p_state) and(is_admin or app_private.package_proposal_can_access(actor,t.learner_id,p.kind)) and(cut_time is null or(p.created_at,p.id)<(cut_time,cut_id)) order by p.created_at desc,p.id desc limit p_limit+1 loop
  count:=count+1;if count>p_limit then exit;end if;dto:=app_private.package_proposal_dto(actor,row.id,case when is_admin then 'admin' else 'customer' end);
  items:=items||jsonb_build_array(jsonb_build_object('proposal_id',row.id,'kind',row.kind,'learner',jsonb_build_object('learner_id',row.learner_id,'display_name',row.display_name),'target_type',row.target_type,'target_id',row.target_id,'state',row.state,'version',row.version,'expires_at',row.expires_at,'can_accept',dto->'can_accept'));next_cursor:=row.created_at::text||'|'||row.id;
 end loop;return jsonb_build_object('items',items,'next_cursor',case when count>p_limit then next_cursor else null end);
end $$;

create function app_private.package_proposal_convert_allocations(p_allocations jsonb,p_target_quanta bigint) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;begin
 if p_target_quanta=0 and p_allocations='[]'::jsonb then return '[]'::jsonb;end if;
 if p_target_quanta is null or p_target_quanta<1 or p_target_quanta>9007199254740991 or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then raise exception 'VALIDATION_ERROR';end if;
 with source as(select value->>'lot_id' as id,(value->>'credit_quanta')::numeric q,value from jsonb_array_elements(p_allocations)),weights as(select *,sum(q) over() total from source),floors as(select *,floor(p_target_quanta*q/total) base,mod(p_target_quanta*q,total) remainder from weights),ranked as(select *,row_number() over(order by remainder desc,id) rank,p_target_quanta-sum(base) over() extras from floors)
 select jsonb_agg(jsonb_build_object('lot_id',id,'source_credit_quanta',q,'target_credit_quanta',base+case when rank<=extras then 1 else 0 end,'value_minor',value->'value_minor','expires_at',value->'expires_at') order by id) into result from ranked;
 if exists(select 1 from jsonb_array_elements(result) x where(x->>'target_credit_quanta')::numeric<1) then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;return result;
end $$;

create function app_private.package_proposal_command(p_name text,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid;admin boolean;context jsonb;p app_private.operation_proposals%rowtype;old_p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;old_t app_private.package_operation_terms%rowtype;
 source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;a app_private.operation_proposal_acceptances%rowtype;
 requested jsonb;allowed text[];field text;kind text;resource uuid:=gen_random_uuid();resource_version integer:=1;result jsonb;event_name text;terms jsonb;preview jsonb;allocations jsonb:='[]';converted jsonb:='[]';contract jsonb;view jsonb;
 source_hash text;terms_hash text;expiry timestamptz;original_expiry timestamptz;ready boolean:=true;needs_admin boolean:=false;source_q bigint;target_q bigint;value_minor bigint;old_minutes bigint;new_minutes bigint;service_delta numeric;reason text;approval uuid;
begin
 actor:=app_private.require_actor();admin:=app_private.has_role(actor,'admin');
 if p_name='create_operation_proposal' then
  kind:=p_input->>'kind';requested:=p_input->'requested_terms';
  if kind is null or kind not in('package_coverage','package_conversion') or jsonb_typeof(requested) is distinct from 'object' then raise exception 'VALIDATION_ERROR';end if;
  if kind='package_coverage' then
   allowed:=array['target_type','package_purchase_id','expected_package_version','credit_quanta','remaining_service_price_minor','expires_at','replaces_proposal_id','expected_replaced_version'];
   if requested->>'target_type' is distinct from 'enrollment' then raise exception 'VALIDATION_ERROR';end if;
   select * into e from app_private.enrollments where id=(p_input->>'target_id')::uuid;if e.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   select * into source from app_private.package_purchases where id=(requested->>'package_purchase_id')::uuid;
   if source.id is null or source.learner_id<>e.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   perform app_private.package_proposal_scope(actor,source.learner_id,kind,true);
   o:=app_private.booking_lock_occurrence(e.occurrence_id);select * into e from app_private.enrollments where id=e.id for update;
   if e.occurrence_id<>o.id then raise exception 'VERSION_CONFLICT';end if;
  else
   allowed:=array['target_type','target_package_id','new_contract_version_id','expected_target_version','source_credit_quanta','target_credit_quanta','expires_at'];
   if requested->>'target_type' is distinct from 'package_purchase' then raise exception 'VALIDATION_ERROR';end if;
   perform app_private.require_role(actor,'admin');
   select * into source from app_private.package_purchases where id=(p_input->>'target_id')::uuid;if source.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
   if requested->>'target_package_id' is not null then
    select * into target from app_private.package_purchases where id=(requested->>'target_package_id')::uuid;
    if target.id is null or target.learner_id<>source.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if target.id=source.id then raise exception 'STATE_CONFLICT';end if;
   end if;
  end if;
  if requested-allowed<>'{}'::jsonb then raise exception 'VALIDATION_ERROR';end if;
  foreach field in array allowed loop if field not in('replaces_proposal_id','expected_replaced_version') and not(requested?field) then raise exception 'VALIDATION_ERROR';end if;end loop;
  perform app_private.package_lock_learner(source.learner_id);perform 1 from app_private.package_purchases where id=source.id or id=target.id order by id for update;
  select * into source from app_private.package_purchases where id=source.id;if target.id is not null then select * into target from app_private.package_purchases where id=target.id;end if;
  perform 1 from app_private.package_lots where purchase_id=source.id order by id for update;
 else
  select * into p from app_private.operation_proposals where id=(p_input->>'proposal_id')::uuid;select * into t from app_private.package_operation_terms where proposal_id=p.id;
  if t.proposal_id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;kind:=p.kind;
  if p_name='approve_operation_proposal' then perform app_private.require_role(actor,'admin');else perform app_private.package_proposal_scope(actor,t.learner_id,kind,p_name='decline_operation_proposal');end if;
  p:=app_private.package_proposal_lock(p.id);resource:=p.id;
 end if;
 context:=app_private.package_begin(actor,p_name,p_input,p_key);if context->'replay_result'<>'null'::jsonb then return context->'replay_result';end if;
 if p_name='create_operation_proposal' then
  if source.purchase_state='cancelled' or(target.id is not null and target.purchase_state='cancelled') then raise exception 'STATE_CONFLICT';end if;
  if(p_input->>'expected_version')::int is distinct from(case when kind='package_coverage' then e.version else source.version end) then raise exception 'VERSION_CONFLICT';end if;
  if requested->>'expires_at' is null or (requested->>'expires_at')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_TIME';end if;
  expiry:=(requested->>'expires_at')::timestamptz;if expiry is null or not isfinite(expiry) or expiry<=now() or expiry>='10000-01-01'::timestamptz then raise exception 'INVALID_TIME';end if;
  reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
  if kind='package_coverage' then
   if app_private.package_safe_integer(requested->'expected_package_version',1)<>source.version then raise exception 'VERSION_CONFLICT';end if;
   source_q:=app_private.package_safe_integer(requested->'credit_quanta',1);
   preview:=app_private.package_coverage_quote(source.id,e.id,source_q);
   if preview->'terms' is null or preview->'terms'='null'::jsonb then raise exception 'STATE_CONFLICT';end if;
   terms:=preview->'terms';allocations:=preview->'allocations';source_hash:=preview->>'source_hash';needs_admin:=coalesce((preview->>'requires_admin_review')::boolean,false);
   if terms->>'coverage_rule'='named_entitlement_covers_eligible_occurrence' and(terms->>'remaining_service_credit_quanta')::bigint>0 then
    needs_admin:=true;
    if requested->>'remaining_service_price_minor' is not null then perform app_private.require_role(actor,'admin');value_minor:=app_private.package_safe_integer(requested->'remaining_service_price_minor');terms:=terms||jsonb_build_object('remaining_service_price_minor',value_minor,'agreed_top_up_minor',value_minor);
    else ready:=false;end if;
   elsif requested->>'remaining_service_price_minor' is not null then raise exception 'VALIDATION_ERROR';end if;
   expiry:=least(expiry,e.hold_expires_at,(select expires_at from app_private.quotes where id=e.current_quote_id));if expiry<=now() then raise exception 'WINDOW_CLOSED';end if;
   if(requested->>'replaces_proposal_id' is null)<>(requested->>'expected_replaced_version' is null) then raise exception 'VALIDATION_ERROR';end if;
   if requested->>'replaces_proposal_id' is not null then
    perform app_private.require_role(actor,'admin');
    select * into old_p from app_private.operation_proposals where id=(requested->>'replaces_proposal_id')::uuid for update;select * into old_t from app_private.package_operation_terms where proposal_id=old_p.id;
    if old_t.proposal_id is null or old_p.kind<>kind or old_p.target_id<>e.id or old_t.source_purchase_id<>source.id or old_t.learner_id<>source.learner_id then raise exception 'NOT_FOUND' using errcode='P0002';end if;
    if old_p.version<>app_private.package_safe_integer(requested->'expected_replaced_version',1) then raise exception 'VERSION_CONFLICT';end if;
    if not ready or old_t.financial_terms_ready or old_p.state<>'proposed' or exists(select 1 from app_private.operation_proposal_acceptances where proposal_id=old_p.id) then raise exception 'STATE_CONFLICT';end if;
    update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason='replaced_by_reviewed_terms',updated_at=now() where id=old_p.id;
   end if;
  else
   if(requested->>'target_package_id' is null)<>(requested->>'expected_target_version' is null) then raise exception 'VALIDATION_ERROR';end if;
   if target.id is not null and(target.version<>app_private.package_safe_integer(requested->'expected_target_version',1) or target.contract_version_id<>(requested->>'new_contract_version_id')::uuid) then raise exception 'VERSION_CONFLICT';end if;
   view:=app_private.package_contract_dto((requested->>'new_contract_version_id')::uuid);contract:=view->'contract';
   source_q:=app_private.package_safe_integer(requested->'source_credit_quanta');target_q:=app_private.package_safe_integer(requested->'target_credit_quanta');
   if(source_q=0 or target_q=0) and not(source_q=0 and target_q=0 and target.id is null) then raise exception 'VALIDATION_ERROR';end if;
   old_minutes:=(source.contract_snapshot->>'base_duration_minutes')::bigint;new_minutes:=(contract->>'base_duration_minutes')::bigint;
   service_delta:=(target_q::numeric*new_minutes-source_q::numeric*old_minutes)*60;if service_delta>0 or service_delta< -9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
   allocations:=case when source_q=0 then '[]'::jsonb else app_private.package_allocate_available(source.id,source_q,null) end;source_hash:=app_private.catalog_hash(allocations);converted:=app_private.package_proposal_convert_allocations(allocations,target_q);
   select coalesce(sum((x->>'value_minor')::numeric),0),min((x->>'expires_at')::timestamptz) into value_minor,original_expiry from jsonb_array_elements(allocations)x;
   if value_minor>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
   terms:=jsonb_build_object('learner_id',source.learner_id,'source_package_id',source.id,'target_package_id',target.id,'new_contract_version_id',requested->>'new_contract_version_id','new_contract_terms_hash',view->>'terms_hash','creates_new_purchase',target.id is null,'new_purchase_credit_quanta',case when target.id is null then(contract->>'grant_credit_quanta')::bigint else 0 end,'new_purchase_value_minor',case when target.id is null then(contract->>'purchase_value_minor')::bigint else 0 end,'source_credit_quanta',source_q,'target_credit_quanta',target_q,'carrying_value_minor',value_minor,'currency','EGP','old_base_duration_minutes',old_minutes,'new_base_duration_minutes',new_minutes,'original_expiry_at',original_expiry,'converted_expiry_at',original_expiry,'lot_allocations',converted,'eligibility_changes',jsonb_build_object('removed_offer_ids',coalesce((select jsonb_agg(x) from jsonb_array_elements(source.contract_snapshot->'eligible_offer_ids')x where not(contract->'eligible_offer_ids'@>jsonb_build_array(x))),'[]'),'added_offer_ids',coalesce((select jsonb_agg(x) from jsonb_array_elements(contract->'eligible_offer_ids')x where not(source.contract_snapshot->'eligible_offer_ids'@>jsonb_build_array(x))),'[]'),'old_formats',source.contract_snapshot->'eligible_formats','new_formats',contract->'eligible_formats'),'service_duration_delta_second_quanta',service_delta,'rounding_rule','reviewed_exact_credit_quanta');needs_admin:=true;
  end if;
  insert into app_private.operation_proposals(id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,requested_terms,expires_at,created_by,reason)
   values(resource,kind,requested->>'target_type',(p_input->>'target_id')::uuid,o.id,case when kind='package_coverage' then e.version else source.version end,coalesce(o.version,1),source_hash,case when kind='package_coverage' then source.contract_version_id else(requested->>'new_contract_version_id')::uuid end,requested,expiry,actor,reason) returning * into p;
  terms_hash:=app_private.catalog_hash(jsonb_build_object('proposal_id',p.id,'learner_id',source.learner_id,'terms',terms,'expires_at',expiry,'base_version',p.base_target_version,'source_hash',source_hash));
  insert into app_private.package_operation_terms(proposal_id,learner_id,source_purchase_id,target_purchase_id,new_contract_version_id,source_purchase_version,target_purchase_version,source_quote_id,allocation_snapshot,source_hash,customer_terms,terms_hash,financial_terms_ready,requires_admin_approval,replaces_proposal_id)
   values(p.id,source.learner_id,source.id,target.id,case when kind='package_conversion' then(requested->>'new_contract_version_id')::uuid else null end,source.version,target.version,e.current_quote_id,allocations,source_hash,terms,terms_hash,ready,needs_admin,old_p.id);
  perform app_private.package_enqueue_due(source.id,expiry);
  result:=jsonb_build_object('proposal_id',p.id,'terms_hash',terms_hash,'expires_at',expiry,'required_actions',case when ready then '["review_terms"]'::jsonb else '["await_admin_remaining_service_terms"]'::jsonb end);event_name:='package_proposal_created';perform set_config('response.status','201',true);
 else
  if(p_input->>'expected_version')::int is distinct from p.version then raise exception 'VERSION_CONFLICT';end if;
  if p.expires_at<=now() then raise exception 'WINDOW_CLOSED';end if;
  if not app_private.package_proposal_fresh(p.id) then raise exception 'VERSION_CONFLICT';end if;
  if p_name='accept_operation_proposal' then
   if p_input->>'terms_hash' is distinct from t.terms_hash then raise exception 'VERSION_CONFLICT';end if;
   if not t.financial_terms_ready then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   insert into app_private.operation_proposal_acceptances(proposal_id,participant_type,participant_id,actor_account_id,terms_hash) values(p.id,'learner',t.learner_id,actor,t.terms_hash) on conflict(proposal_id,participant_type,participant_id) do nothing;
   select * into a from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=t.learner_id;
   if a.actor_account_id<>actor then raise exception 'STATE_CONFLICT';end if;
   update app_private.operation_proposals set state='accepted',updated_at=now() where id=p.id;
   result:=jsonb_build_object('accepted_at',a.accepted_at);resource_version:=p.version;event_name:='package_proposal_accepted';
  elsif p_name='decline_operation_proposal' then
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
   update app_private.operation_proposals set state='declined',version=version+1,updated_at=now() where id=p.id returning version into resource_version;result:=jsonb_build_object('state','declined');event_name:='package_proposal_declined';
  elsif p_name='approve_operation_proposal' then
   if p_input->>'terms_hash' is distinct from t.terms_hash or p_input->>'decision' is null or p_input->>'decision' not in('approved','rejected') then raise exception 'VALIDATION_ERROR';end if;
   reason:=trim(p_input->>'reason');if reason is null or length(reason) not between 1 and 2000 then raise exception 'VALIDATION_ERROR';end if;
   if p.state not in('proposed','accepted') then raise exception 'STATE_CONFLICT';end if;
   if p_input->>'decision'='approved' then if not t.financial_terms_ready then raise exception 'DEPENDENCY_UNAVAILABLE';end if;if not app_private.package_proposal_accepted(p.id,true) then raise exception 'CONSENT_REQUIRED';end if;end if;
   insert into app_private.operation_proposal_approvals(proposal_id,terms_hash,decision,actor_account_id,reason) values(p.id,t.terms_hash,p_input->>'decision',actor,reason) returning id into approval;
   update app_private.operation_proposals set state=case when p_input->>'decision'='approved' then 'approved' else 'declined' end,version=version+1,approved_by=actor,approved_at=now(),updated_at=now() where id=p.id returning * into p;
   resource_version:=p.version;result:=jsonb_build_object('approval_id',approval,'state',p.state);event_name:='package_proposal_reviewed';
  else raise exception 'VALIDATION_ERROR';end if;
 end if;
 return app_private.package_finish(context,resource,resource_version,result,event_name,jsonb_build_object('proposal_id',resource,'learner_id',coalesce(source.learner_id,t.learner_id)));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;
create function app_private.package_proposal_lock(p_id uuid) returns app_private.operation_proposals language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;e app_private.enrollments%rowtype;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;
 if p.id is null or t.proposal_id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if p.kind='package_coverage' then perform app_private.booking_lock_occurrence(p.occurrence_id);select * into e from app_private.enrollments where id=p.target_id for update;if e.occurrence_id is distinct from p.occurrence_id then raise exception 'VERSION_CONFLICT';end if;end if;
 perform app_private.package_lock_learner(t.learner_id);
 perform 1 from app_private.package_purchases where id=t.source_purchase_id or id=t.target_purchase_id order by id for update;
 perform 1 from app_private.package_lots where purchase_id=t.source_purchase_id order by id for update;
 select * into p from app_private.operation_proposals where id=p_id for update;return p;
end $$;
create function app_private.package_proposal_fresh(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;source app_private.package_purchases%rowtype;target app_private.package_purchases%rowtype;e app_private.enrollments%rowtype;o app_private.occurrences%rowtype;preview jsonb;contract jsonb;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;
 if p.id is null or t.proposal_id is null or p.state not in('proposed','accepted','approved') or p.expires_at<=now() then return false;end if;
 select * into source from app_private.package_purchases where id=t.source_purchase_id;if source.version<>t.source_purchase_version or source.purchase_state='cancelled' then return false;end if;
 if p.kind='package_coverage' then
  select * into e from app_private.enrollments where id=p.target_id;select * into o from app_private.occurrences where id=p.occurrence_id;
  if e.version<>p.base_target_version or e.current_quote_id<>t.source_quote_id or o.version<>p.base_occurrence_version then return false;end if;
  preview:=app_private.package_coverage_quote(source.id,e.id,(t.customer_terms->>'reserved_credit_quanta')::bigint);
  return preview->'terms'<>'null'::jsonb and preview->>'source_hash'=t.source_hash;
 else
  contract:=app_private.package_contract_dto(t.new_contract_version_id);if contract->>'terms_hash' is distinct from t.customer_terms->>'new_contract_terms_hash' then return false;end if;
  if t.target_purchase_id is not null then select * into target from app_private.package_purchases where id=t.target_purchase_id;if target.version<>t.target_purchase_version or target.purchase_state='cancelled' then return false;end if;end if;
  preview:=case when(t.customer_terms->>'source_credit_quanta')::bigint=0 then '[]'::jsonb else app_private.package_allocate_available(source.id,(t.customer_terms->>'source_credit_quanta')::bigint,null) end;
  return app_private.catalog_hash(preview)=t.source_hash;
 end if;
exception when raise_exception then if sqlerrm in('POLICY_INCOMPLETE','INSUFFICIENT_ENTITLEMENT','STATE_CONFLICT','WINDOW_CLOSED','VERSION_CONFLICT') then return false;else raise;end if;
end $$;
create function app_private.package_proposal_accepted(p_id uuid,p_recheck boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare t app_private.package_operation_terms%rowtype;p app_private.operation_proposals%rowtype;a app_private.operation_proposal_acceptances%rowtype;begin
 select * into t from app_private.package_operation_terms where proposal_id=p_id;select * into p from app_private.operation_proposals where id=p_id;
 select * into a from app_private.operation_proposal_acceptances where proposal_id=p_id and participant_type='learner' and participant_id=t.learner_id and terms_hash=t.terms_hash;
 if a.id is null then return false;end if;
 if p_recheck then
  perform 1 from app_private.accounts where id=a.actor_account_id and active for share;if not found then raise exception 'CONSENT_REQUIRED';end if;
  if not exists(select 1 from app_private.auth_account(a.actor_account_id) u where u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())) or not app_private.package_proposal_can_access(a.actor_account_id,t.learner_id,p.kind) then raise exception 'CONSENT_REQUIRED';end if;
  perform app_private.package_proposal_scope(a.actor_account_id,t.learner_id,p.kind);
 end if;return true;
end $$;
create function app_private.package_proposal_dto(p_actor uuid,p_id uuid,p_view text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;t app_private.package_operation_terms%rowtype;a app_private.operation_proposal_acceptances%rowtype;result jsonb;can_accept boolean:=false;begin
 select * into p from app_private.operation_proposals where id=p_id;select * into t from app_private.package_operation_terms where proposal_id=p_id;if t.proposal_id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if p_view='admin' then perform app_private.require_role(p_actor,'admin');elsif p_view='customer' then perform app_private.package_proposal_scope(p_actor,t.learner_id,p.kind);else raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into a from app_private.operation_proposal_acceptances where proposal_id=p.id and participant_type='learner' and participant_id=t.learner_id;
 can_accept:=p_view='customer' and p.state in('proposed','accepted') and a.id is null and t.financial_terms_ready and app_private.package_proposal_fresh(p.id);
 result:=jsonb_build_object('proposal_id',p.id,'version',p.version,'kind',p.kind,'target_type',p.target_type,'target_id',p.target_id,'base_version',p.base_target_version,'policy_version_id',p.policy_version_id,'state',p.state,'expires_at',p.expires_at,'terms_hash',t.terms_hash,'accepted_at',a.accepted_at,'can_accept',can_accept,'required_actions',case when not t.financial_terms_ready then '["await_admin_remaining_service_terms"]'::jsonb when can_accept then '["review_terms"]'::jsonb else '[]'::jsonb end,'view',p_view,'terms',t.customer_terms);
 if p_view='admin' then result:=result||jsonb_build_object('required_acceptances',jsonb_build_array(jsonb_build_object('participant_type','learner','participant_id',t.learner_id,'accepted_at',a.accepted_at)));end if;return result;
end $$;
create or replace function app_private.booking_expire_proposals(p_occurrence_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;ids uuid[]:='{}';event_id uuid;begin
 for p in select * from app_private.operation_proposals where occurrence_id=p_occurrence_id and kind in ('reschedule','cancellation_remedy','group_amendment') and state in ('proposed','accepted','approved') order by id for update loop
  if p.expires_at<=now() or not app_private.booking_proposal_fresh(p.id) then
   update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason=case when p.expires_at<=now() then 'window_closed' else 'stale_terms' end,updated_at=now() where id=p.id;
   update app_private.enrollments set state='expired',version=version+1,updated_at=now() where amendment_id=p.id and state='held';
   ids:=array_append(ids,p.id);event_id:=gen_random_uuid();
   insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,event_id,'booking_proposal_expired',p.id,jsonb_build_object('actor_kind','system','occurrence_id',p_occurrence_id));
   perform app_private.enqueue_event(event_id,'booking_proposal_expired',p.id,jsonb_build_object('proposal_id',p.id,'occurrence_id',p_occurrence_id),'notifications.route');
  end if;
 end loop;return ids;
end $$;
create or replace function app_private.booking_pending_proposals(p_occurrence_id uuid,p_learner_id uuid default null,p_tutor_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposal_id',p.id,'kind',case when p.kind='group_amendment' then 'amendment' else 'operation' end) order by p.created_at,p.id),'[]') from app_private.operation_proposals p
 where p.occurrence_id=p_occurrence_id and p.state in('proposed','accepted','approved') and p.expires_at>now()
 and(p_learner_id is null or exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and learner_id=p_learner_id) or exists(select 1 from app_private.package_operation_terms t where t.proposal_id=p.id and t.learner_id=p_learner_id and app_private.package_proposal_can_access(auth.uid(),t.learner_id,p.kind)))
 and(p_tutor_id is null or exists(select 1 from finance_private.operation_tutor_terms where proposal_id=p.id and tutor_id=p_tutor_id))
$$;
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and(p.proname like 'package_proposal_%' or p.proname in('package_route_operation','package_validate_coverage_proposal','package_validate_conversion_proposal','package_commit_proposal','package_expire_proposals','package_next_proposal_due','package_pending_proposals','booking_expire_proposals','booking_pending_proposals'))) or(n.nspname='api' and p.proname in('create_operation_proposal','accept_operation_proposal','decline_operation_proposal','approve_operation_proposal','get_operation_proposal','list_package_operation_proposals')) loop
 execute format('alter function %s owner to git_tutor_commands',fn.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',fn.signature);
 if fn.nspname='api' then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
