-- Customer-safe package histories and selectors; authorization is rechecked on every read.
grant create on schema api,app_private to git_tutor_commands;
create table app_private.package_renewals(id uuid primary key default gen_random_uuid(),source_purchase_id uuid not null references app_private.package_purchases(id),target_purchase_id uuid not null unique references app_private.package_purchases(id),command_id uuid not null,created_at timestamptz not null default now(),check(source_purchase_id<>target_purchase_id));
alter table app_private.package_renewals enable row level security;
grant select,insert on app_private.package_renewals to git_tutor_commands;
create policy commands_access on app_private.package_renewals to git_tutor_commands using(true) with check(true);
revoke all on app_private.package_renewals from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_package_renewals before update or delete on app_private.package_renewals for each row execute function app_private.reject_immutable_change();
create function app_private.package_can_access(p_actor uuid,p_learner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.accounts where id=p_actor and active) and(exists(select 1 from app_private.learners where id=p_learner and account_id=p_actor) or exists(select 1 from app_private.guardian_links where guardian_account_id=p_actor and learner_id=p_learner and revoked_at is null and valid_from<=now() and valid_until>now() and 'payments'=any(scopes)))
$$;
create function app_private.package_page(p_rows jsonb,p_limit integer) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('items',coalesce((select jsonb_agg(value->'data' order by ordinality) from jsonb_array_elements(p_rows) with ordinality where ordinality<=p_limit),'[]'::jsonb),'next_cursor',case when jsonb_array_length(p_rows)>p_limit then(p_rows->(p_limit-1)->>'at')||'|'||(p_rows->(p_limit-1)->>'id') else null end)
$$;
create function app_private.package_lot_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lot_id',id,'version',version,'origin_kind',origin_kind,'original_lot_id',original_lot_id,'source_lot_id',source_lot_id,'base_duration_minutes',base_duration_minutes,'coverage_rule',coverage_rule,'eligible_offer_ids',eligibility_snapshot->'eligible_offer_ids','eligible_formats',eligibility_snapshot->'eligible_formats','expires_at',expires_at,'balances',balances,'created_at',created_at) from app_private.package_lots where id=p_id
$$;
create function app_private.package_movement_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('movement_id',id,'kind',kind,'lot_id',lot_id,'enrollment_id',enrollment_id,'reservation_id',reservation_id,'original_movement_id',original_movement_id,'transfer_id',transfer_id,'credit_quanta',credit_quanta,'value_minor',value_minor,'currency','EGP','from_bucket',from_bucket,'to_bucket',to_bucket,'customer_reason_code',customer_reason_code,'effective_at',effective_at,'recorded_at',recorded_at) from app_private.entitlement_movements where id=p_id
$$;
create function app_private.package_coverage_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.package_reservations%rowtype;e app_private.enrollments%rowtype;reserved numeric;consumed numeric;released numeric;begin
 select * into r from app_private.package_reservations where id=p_id;select * into e from app_private.enrollments where id=r.enrollment_id;
 select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0),coalesce(sum((delta->>'consumed_credit_quanta')::numeric),0),coalesce(sum(credit_quanta) filter(where kind='release'),0) into reserved,consumed,released from app_private.entitlement_movements where reservation_id=r.id;
 return jsonb_build_object('reservation_id',r.id,'version',r.version,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'learner_id',r.learner_id,'quote_id',r.quote_id,'coverage_rule',r.coverage_rule,'required_credit_quanta',r.required_credit_quanta,'reserved_credit_quanta',reserved,'consumed_credit_quanta',consumed,'released_credit_quanta',released,'carrying_value_minor',r.allocated_value_minor,'agreed_top_up_minor',r.agreed_top_up_minor,'service_satisfied',r.state in('reserved','partially_consumed','consumed') and reserved+consumed>=r.required_credit_quanta,'can_release',e.state='held' and e.hold_kind='ordinary' and e.hold_expires_at>now() and r.state in('reserved','partially_consumed') and reserved>0,'state',r.state,'expires_at',r.expires_at,'funding_integration_state','awaiting_T06_integration','coverage_proposal_id',r.coverage_proposal_id);
end $$;
create function app_private.package_transfer_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('transfer_id',id,'source_package_id',source_purchase_id,'target_package_id',target_purchase_id,'source_lot_id',source_lot_id,'target_lot_id',target_lot_id,'source_credit_quanta',source_credit_quanta,'target_credit_quanta',target_credit_quanta,'value_minor',value_minor,'currency',currency,'conversion_proposal_id',conversion_proposal_id,'created_at',created_at) from app_private.package_transfers where id=p_id
$$;
create function app_private.package_renewal_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('renewal_id',id,'source_package_id',source_purchase_id,'target_package_id',target_purchase_id,'created_at',created_at) from app_private.package_renewals where id=p_id
$$;
create function app_private.package_grant_policy_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('grant_policy_version_id',id,'version',version,'status',status,'content',content,'environment_scope',environment_scope,'is_synthetic',is_synthetic,'approved_by',approved_by,'approved_at',approved_at,'effective_at',effective_at,'content_hash',app_private.catalog_hash(content),'validation_errors',app_private.package_grant_policy_errors(content)) from app_private.package_grant_policy_versions where id=p_id
$$;
create function app_private.package_enrollment_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enrollment_id',e.id,'version',e.version,'learner_id',e.learner_id,'occurrence_id',e.occurrence_id,'offer_id',o.offer_id,'title',s.title,'start_at',o.start_at,'end_at',o.end_at,'state',e.state,'is_provisional',e.hold_kind='amendment','quote_id',q.id,'quote_version',q.version,'quote_hash',q.terms_hash,'customer_price_minor',q.customer_price_minor,'currency','EGP') from app_private.enrollments e join app_private.occurrences o on o.id=e.occurrence_id join app_private.offers f on f.id=o.offer_id join app_private.subjects s on s.id=f.subject_id join app_private.quotes q on q.id=e.current_quote_id where e.id=p_id
$$;
create function app_private.package_read(p_kind text,p_filters jsonb,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();learner uuid:=(p_filters->>'learner_id')::uuid;target uuid:=(p_filters->>'package_id')::uuid;after_at timestamptz;after_id uuid;rows jsonb;sql text;source text;timecol text:='created_at';projection text;condition text;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;if not isfinite(after_at) then raise exception 'VALIDATION_ERROR';end if;end if;
 if p_kind in('admin','grant_policies') then perform app_private.require_role(actor,'admin');end if;
 if learner is not null then perform app_private.package_assert_scope(actor,learner,'payments',p_kind in('contracts','admin','enrollments'));end if;
 if target is not null then select learner_id into learner from app_private.package_purchases where id=target;if learner is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,learner,'payments',true);end if;
 if p_kind in('mine','admin') then source:='app_private.package_purchases';projection:='app_private.package_summary(x.id,$1)';condition:='($2 is null or x.learner_id=$2) and ($4->>''purchase_state'' is null or x.purchase_state=$4->>''purchase_state'')';if p_kind='mine' then condition:=condition||' and app_private.package_can_access($1,x.learner_id)';end if;
 elsif p_kind='learners' then source:='app_private.learners';projection:='jsonb_build_object(''learner_id'',x.id,''display_name'',(select display_name from app_private.people where id=x.person_id))';condition:='app_private.package_can_access($1,x.id)';
 elsif p_kind='contracts' then
  if learner is null then raise exception 'VALIDATION_ERROR';end if;source:='app_private.policy_versions';projection:='app_private.package_contract_dto(x.id)';condition:='x.status=''published'' and x.effective_at<=now() and x.content->>''package_enabled''=''true'' and x.content#>>''{package_contract,purchase_activation_rule}''=''full_settled_charge'' and x.content#>>''{package_contract,expiry_clock}''=''elapsed_24_hour_days'' and exists(select 1 from app_private.offers o where o.policy_version_id=x.id and app_private.booking_offer_sellable(o.id) and x.content#>''{package_contract,eligible_offer_ids}''?o.id::text and ($4->>''offer_id'' is null or o.id=($4->>''offer_id'')::uuid))';
 elsif p_kind='enrollments' then
  if learner is null then raise exception 'VALIDATION_ERROR';end if;perform app_private.package_assert_scope(actor,learner,'booking',true);source:='app_private.enrollments';projection:='app_private.package_enrollment_dto(x.id)';condition:='x.learner_id=$2 and ($4->>''state'' is null or x.state=$4->>''state'')';
 elsif p_kind='grant_policies' then source:='app_private.package_grant_policy_versions';projection:='app_private.package_grant_policy_dto(x.id)';condition:='($4->>''status'' is null or x.status=$4->>''status'') and cardinality(app_private.package_grant_policy_errors(x.content))=0';
 elsif p_kind in('lots','movements','coverage','lineage','renewals') then
  if target is null then raise exception 'VALIDATION_ERROR';end if;
  case p_kind when 'lots' then source:='app_private.package_lots';projection:='app_private.package_lot_dto(x.id)';condition:='x.purchase_id=$3';
  when 'movements' then source:='app_private.entitlement_movements';projection:='app_private.package_movement_dto(x.id)';condition:='x.purchase_id=$3';timecol:='recorded_at';
  when 'coverage' then source:='app_private.package_reservations';projection:='app_private.package_coverage_dto(x.id)';condition:='x.purchase_id=$3';
  when 'lineage' then source:='app_private.package_transfers';projection:='app_private.package_transfer_dto(x.id)';condition:='(x.source_purchase_id=$3 or x.target_purchase_id=$3)';
  when 'renewals' then source:='app_private.package_renewals';projection:='app_private.package_renewal_dto(x.id)';condition:='(x.source_purchase_id=$3 or x.target_purchase_id=$3)';end case;
 else raise exception 'VALIDATION_ERROR';end if;
 sql:=format('select coalesce(jsonb_agg(jsonb_build_object(''id'',x.id,''at'',x.%1$I,''data'',%2$s) order by x.%1$I desc,x.id desc),''[]''::jsonb) from(select x.* from %3$s x where %4$s and($5 is null or(x.%1$I,x.id)<($5,$6)) order by x.%1$I desc,x.id desc limit $7)x',timecol,projection,source,condition);
 execute sql into rows using actor,learner,target,p_filters,after_at,after_id,p_limit+1;return app_private.package_page(rows,p_limit);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;
create or replace function api.get_my_package(p_package_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();p app_private.package_purchases%rowtype;filters jsonb:=jsonb_build_object('package_id',p_package_id);begin
 select * into p from app_private.package_purchases where id=p_package_id;if p.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,p.learner_id,'payments',true);
 return jsonb_build_object('package',app_private.package_summary(p.id,actor),'contract',p.contract_snapshot,'purchase_terms_hash',p.contract_hash,'eligible_offers',app_private.package_offer_labels(p.contract_snapshot),'lot_page',app_private.package_read('lots',filters),'movement_page',app_private.package_read('movements',filters),'coverage_page',app_private.package_read('coverage',filters),'lineage_page',app_private.package_read('lineage',filters),'renewal_page',app_private.package_read('renewals',filters));end $$;
create function app_private.package_reconciliation(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lot app_private.package_lots%rowtype;bucket text;actualq numeric;actualv numeric;diffq numeric;diffv numeric;violations jsonb:='[]';counted integer:=0;consistent boolean:=true;begin
 for lot in select * from app_private.package_lots where purchase_id=p_id order by id loop counted:=counted+1;
  foreach bucket in array array['granted','transferred_in','adjustment','available','reserved','consumed','expired','transferred_out'] loop
   select coalesce(sum((delta->>(bucket||'_credit_quanta'))::numeric),0),coalesce(sum((delta->>(bucket||'_value_minor'))::numeric),0) into actualq,actualv from app_private.entitlement_movements where lot_id=lot.id;
   diffq:=(lot.balances->>(bucket||'_credit_quanta'))::numeric-actualq;diffv:=(lot.balances->>(bucket||'_value_minor'))::numeric-actualv;
   if diffq<>0 or diffv<>0 then consistent:=false;if jsonb_array_length(violations)<100 then violations:=violations||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'bucket',bucket,'credit_quanta_difference',diffq,'value_minor_difference',diffv));end if;end if;
  end loop;
 end loop;return jsonb_build_object('package_purchase_id',p_id,'consistent',consistent,'checked_lots',counted,'violations',violations);end $$;
create function api.get_package_reconciliation(p_package_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();begin perform app_private.require_role(actor,'admin');if not exists(select 1 from app_private.package_purchases where id=p_package_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;return app_private.package_reconciliation(p_package_id);end $$;
create function api.get_package_coverage_options(p_enrollment_id uuid,p_package_id uuid default null,p_credit_quanta bigint default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();seat app_private.enrollments%rowtype;occ app_private.occurrences%rowtype;q app_private.quotes%rowtype;p app_private.package_purchases%rowtype;preview jsonb;summary jsonb;rows jsonb:='[]';coverage uuid;after_at timestamptz;after_id uuid;available numeric;requested bigint:=coalesce(p_credit_quanta,1000);begin
 select * into seat from app_private.enrollments where id=p_enrollment_id;if seat.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 perform app_private.package_assert_scope(actor,seat.learner_id,'booking',true);perform app_private.package_assert_scope(actor,seat.learner_id,'payments',true);
 if p_limit is null or p_limit not between 1 and 100 or requested not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;end if;
 occ:=app_private.booking_lock_occurrence(seat.occurrence_id);select * into seat from app_private.enrollments where id=p_enrollment_id for update;select * into q from app_private.quotes where id=seat.current_quote_id;
 perform app_private.package_lock_learner(seat.learner_id);
 if p_package_id is not null and not exists(select 1 from app_private.package_purchases where id=p_package_id and learner_id=seat.learner_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select id into coverage from app_private.package_reservations where enrollment_id=seat.id and state in('reserved','partially_consumed');
 for p in select * from app_private.package_purchases where learner_id=seat.learner_id and purchase_state<>'cancelled' and(p_package_id is null or id=p_package_id) and(p_cursor is null or(created_at,id)<(after_at,after_id)) order by created_at desc,id desc limit p_limit+1 loop
  preview:=app_private.package_coverage_quote(p.id,seat.id,requested);summary:=app_private.package_summary(p.id,actor);
  select coalesce(sum((balances->>'available_credit_quanta')::numeric),0) into available from app_private.package_lots where purchase_id=p.id and(expires_at is null or expires_at>greatest(now(),occ.start_at));
  rows:=rows||jsonb_build_array(jsonb_build_object('id',p.id,'at',p.created_at,'data',jsonb_build_object('package_purchase_id',p.id,'version',p.version,'title',summary->>'title','contract_version_id',p.contract_version_id,'coverage_rule',p.contract_snapshot->>'coverage_rule','available_credit_quanta',available,'required_credit_quanta',1000,'requested_credit_quanta',requested,'max_reservable_credit_quanta',least(available,1000),'carrying_value_minor',preview#>'{terms,carrying_value_minor}','standalone_reference_price_minor',q.customer_price_minor,'agreed_top_up_minor',preview#>'{terms,agreed_top_up_minor}','eligible',(preview->>'eligible')::boolean,'reason',preview->>'reason','requires_proposal',(preview->>'requires_proposal')::boolean,'requires_admin_review',(preview->>'requires_admin_review')::boolean,'coverage_proposal_id',null)));
 end loop;return app_private.package_page(rows,p_limit)||jsonb_build_object('enrollment',jsonb_build_object('enrollment_id',seat.id,'version',seat.version,'learner_id',seat.learner_id,'quote_id',q.id,'quote_version',q.version,'quote_hash',q.terms_hash),'current_coverage',case when coverage is not null then app_private.package_coverage_dto(coverage) else null end);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;

create function api.list_my_package_learners(p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('learners',jsonb_build_object(),p_cursor,p_limit) $$;

create function api.list_package_contracts(p_learner_id uuid,p_offer_id uuid default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('contracts',jsonb_build_object('learner_id',p_learner_id,'offer_id',p_offer_id),p_cursor,p_limit) $$;

create function api.list_my_packages(p_learner_id uuid default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('mine',jsonb_build_object('learner_id',p_learner_id),p_cursor,p_limit) $$;

create function api.list_admin_packages(p_learner_id uuid default null,p_purchase_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('admin',jsonb_build_object('learner_id',p_learner_id,'purchase_state',p_purchase_state),p_cursor,p_limit) $$;

create function api.list_package_enrollments(p_learner_id uuid,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('enrollments',jsonb_build_object('learner_id',p_learner_id,'state',p_state),p_cursor,p_limit) $$;

create function api.list_package_grant_policies(p_status text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('grant_policies',jsonb_build_object('status',p_status),p_cursor,p_limit) $$;

create function api.list_package_lots(p_package_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('lots',jsonb_build_object('package_id',p_package_id),p_cursor,p_limit) $$;

create function api.list_package_movements(p_package_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('movements',jsonb_build_object('package_id',p_package_id),p_cursor,p_limit) $$;

create function api.list_package_coverage(p_package_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('coverage',jsonb_build_object('package_id',p_package_id),p_cursor,p_limit) $$;

create function api.list_package_lineage(p_package_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('lineage',jsonb_build_object('package_id',p_package_id),p_cursor,p_limit) $$;

create function api.list_package_renewals(p_package_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('renewals',jsonb_build_object('package_id',p_package_id),p_cursor,p_limit) $$;

create or replace function app_private.package_allocate_available(p_purchase_id uuid,p_credit_quanta bigint,p_at_occurrence_start timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare lot app_private.package_lots%rowtype;remaining bigint:=p_credit_quanta;quantity bigint;amount bigint;rows jsonb:='[]';begin
 if p_credit_quanta is null or p_credit_quanta not between 1 and 9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 -- Read-only preview. Mutating callers hold the learner mutex and lock lots before effects.
 for lot in select * from app_private.package_lots where purchase_id=p_purchase_id and(expires_at is null or(expires_at>now() and(p_at_occurrence_start is null or expires_at>p_at_occurrence_start))) and(balances->>'available_credit_quanta')::numeric>0 order by expires_at nulls last,created_at,id loop
  quantity:=least(remaining,(lot.balances->>'available_credit_quanta')::bigint);
  amount:=floor((lot.balances->>'available_value_minor')::numeric*quantity/(lot.balances->>'available_credit_quanta')::numeric)::bigint;
  rows:=rows||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'lot_version',lot.version,'credit_quanta',quantity,'value_minor',amount,'expires_at',lot.expires_at));remaining:=remaining-quantity;exit when remaining=0;
 end loop;if remaining>0 then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;return rows;
end $$;

create or replace function app_private.package_reserve_allocations(p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint,p_coverage_proposal_id uuid,p_accepted_terms jsonb,p_context jsonb) returns app_private.package_reservations language plpgsql security definer set search_path='' as $$
declare preview jsonb;terms jsonb;allocation jsonb;seat app_private.enrollments%rowtype;reservation app_private.package_reservations%rowtype;allocation_id uuid;begin
 preview:=app_private.package_coverage_quote(p_purchase_id,p_enrollment_id,p_credit_quanta);
 if not(preview->>'eligible')::boolean then if preview->>'reason'='INSUFFICIENT_ENTITLEMENT' then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;raise exception 'STATE_CONFLICT';end if;
 if p_coverage_proposal_id is not null then
  if p_accepted_terms->>'source_hash' is distinct from preview->>'source_hash' or p_accepted_terms->'allocations' is distinct from preview->'allocations' or ((p_accepted_terms->'terms')-array['agreed_top_up_minor','remaining_service_price_minor']) is distinct from((preview->'terms')-array['agreed_top_up_minor','remaining_service_price_minor']) then raise exception 'VERSION_CONFLICT';end if;
  terms:=p_accepted_terms->'terms';
 else if(preview->>'requires_proposal')::boolean then raise exception 'CONSENT_REQUIRED';end if;terms:=preview->'terms';end if;
 select * into seat from app_private.enrollments where id=p_enrollment_id;
 if exists(select 1 from app_private.package_reservations where enrollment_id=seat.id and state in('reserved','partially_consumed')) then raise exception 'STATE_CONFLICT';end if;
 insert into app_private.package_reservations(purchase_id,learner_id,enrollment_id,quote_id,quote_hash,coverage_rule,required_credit_quanta,reserved_credit_quanta,allocated_value_minor,agreed_top_up_minor,coverage_proposal_id,acceptance_refs,expires_at) values(p_purchase_id,seat.learner_id,seat.id,seat.current_quote_id,terms->>'quote_hash',terms->>'coverage_rule',(terms->>'required_credit_quanta')::bigint,p_credit_quanta,(terms->>'carrying_value_minor')::bigint,(terms->>'agreed_top_up_minor')::bigint,p_coverage_proposal_id,p_accepted_terms-array['terms','allocations'],least(seat.hold_expires_at,(select expires_at from app_private.quotes where id=seat.current_quote_id))) returning * into reservation;
 for allocation in select value from jsonb_array_elements(preview->'allocations') loop
  insert into app_private.package_reservation_allocations(reservation_id,lot_id,credit_quanta,value_minor) values(reservation.id,(allocation->>'lot_id')::uuid,(allocation->>'credit_quanta')::bigint,(allocation->>'value_minor')::bigint) returning id into allocation_id;
  perform app_private.package_append_movement((allocation->>'lot_id')::uuid,'reserve',jsonb_build_object('available_credit_quanta',-(allocation->>'credit_quanta')::bigint,'reserved_credit_quanta',(allocation->>'credit_quanta')::bigint,'available_value_minor',-(allocation->>'value_minor')::bigint,'reserved_value_minor',(allocation->>'value_minor')::bigint),jsonb_build_object('enrollment_id',seat.id,'reservation_id',reservation.id,'allocation_id',allocation_id,'credit_quanta',(allocation->>'credit_quanta')::bigint,'value_minor',(allocation->>'value_minor')::bigint,'from_bucket','available','to_bucket','reserved','customer_reason_code','booking_reservation'),p_context,'reserve:'||allocation_id);
 end loop;return reservation;
end $$;

create or replace function app_private.process_package_due(p_purchase_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase app_private.package_purchases%rowtype;prior app_private.package_due_runs%rowtype;run_id uuid:=gen_random_uuid();expired uuid[];next_due timestamptz;result jsonb;begin
 if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 purchase:=app_private.package_lock_purchase(p_purchase_id);
 select * into prior from app_private.package_due_runs where purchase_id=p_purchase_id and idempotency_key=p_idempotency_key;if prior.id is not null then return prior.result;end if;
 perform app_private.package_expire_proposals(p_purchase_id);
 expired:=app_private.package_expire_available(p_purchase_id,jsonb_build_object('command_id',run_id));
 if cardinality(expired)>0 then update app_private.package_purchases set version=version+1,updated_at=now() where id=p_purchase_id;end if;
 select min(expires_at) into next_due from app_private.package_lots where purchase_id=p_purchase_id and expires_at>now() and(balances->>'available_credit_quanta')::numeric>0;
 next_due:=least(next_due,app_private.package_next_proposal_due(p_purchase_id));
 if next_due is not null then perform app_private.package_enqueue_due(p_purchase_id,next_due);end if;
 result:=jsonb_build_object('expired_lot_ids',expired,'next_due_at',next_due);
 insert into app_private.package_due_runs(id,purchase_id,idempotency_key,result) values(run_id,p_purchase_id,p_idempotency_key,result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run_id,'package_due_processed',p_purchase_id,jsonb_build_object('actor_kind','worker','expired_count',cardinality(expired)));
 perform app_private.enqueue_event(run_id,'package_due_processed',p_purchase_id,jsonb_build_object('package_purchase_id',p_purchase_id),'notifications.route');return result;
end $$;

do $$ declare f record;begin for f in select p.oid::regprocedure::text as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and p.proname like 'package_%') or(n.nspname='api' and p.proname in('list_my_package_learners','list_package_contracts','list_my_packages','list_admin_packages','list_package_enrollments','list_package_grant_policies','list_package_lots','list_package_movements','list_package_coverage','list_package_lineage','list_package_renewals','get_my_package','get_package_reconciliation','get_package_coverage_options')) loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
