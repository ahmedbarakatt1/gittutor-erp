-- Derive activation from actual immutable allocations, never a caller funding flag.
grant create on schema app_private,finance_private to git_tutor_commands;
create unique index purchased_origin_once on app_private.package_lots(purchase_id) where origin_kind='purchase';
create or replace function app_private.package_purchase_funding_status(p_purchase_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.package_purchases%rowtype;b jsonb;row record;total numeric:=0;ids uuid[]:='{}';reason text:='ELIGIBLE';begin
 select * into p from app_private.package_purchases where id=p_purchase_id;if p.id is null then raise exception 'NOT_FOUND';end if;
 b:=finance_private.finance_charge_balance(p.charge_id);
 if p.purchase_state='cancelled' or p.purchase_activation_rule<>'full_settled_charge' or(b->>'commercial_net_minor')::bigint<>p.purchase_value_minor then reason:='STATE_CONFLICT';
 elsif b->>'reconciliation_state'<>'clear' then reason:='RECONCILIATION_REQUIRED';end if;
 for row in select a.id,a.transfer_id,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) amount,t.state,t.currency,t.current_payer_binding_id,a.payer_binding_id from finance_private.payment_allocations a join finance_private.incoming_transfers t on t.id=a.transfer_id where a.charge_id=p.charge_id order by a.id loop
  if row.amount<=0 then continue;end if;
  if row.state<>'settled' or row.currency<>p.currency or row.current_payer_binding_id is distinct from row.payer_binding_id or not exists(select 1 from finance_private.transfer_settlements where transfer_id=row.transfer_id) or finance_private.finance_transfer_balance(row.transfer_id)->>'reconciliation_state'<>'clear' then reason:='RECONCILIATION_REQUIRED';end if;
  total:=total+row.amount;ids:=array_append(ids,row.id);
 end loop;
 if total>9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 if reason='ELIGIBLE' and(total<>p.purchase_value_minor or(b->>'allocated_cash_minor')::bigint<>p.purchase_value_minor) then reason:='INSUFFICIENT_FUNDS';end if;
 return jsonb_build_object('integration_state','ready','eligible',reason='ELIGIBLE','reason',reason,'qualified_value_minor',total,'source_allocation_ids',ids);
end $$;
create or replace function app_private.package_activate_funded_purchase(p_purchase_id uuid,p_funding_source_ids uuid[],p_command_context jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare p app_private.package_purchases%rowtype;funding jsonb;contract jsonb;lot_id uuid;movement_id uuid;expiry timestamptz;source record;begin
 p:=app_private.package_lock_purchase(p_purchase_id);funding:=app_private.package_purchase_funding_status(p.id);
 if not(funding->>'eligible')::boolean then raise exception 'INSUFFICIENT_FUNDS';end if;
 if array(select value::uuid from jsonb_array_elements_text(funding->'source_allocation_ids') order by value::uuid) is distinct from array(select distinct x from unnest(p_funding_source_ids) x order by x) then raise exception 'VERSION_CONFLICT';end if;
 if exists(select 1 from app_private.package_lots where purchase_id=p.id and origin_kind='purchase') then return;end if;
 contract:=p.contract_snapshot;
 if contract->>'purchase_activation_rule' is distinct from 'full_settled_charge' or contract->>'expiry_clock' is distinct from 'elapsed_24_hour_days' then raise exception 'POLICY_INCOMPLETE';end if;
 expiry:=case when contract->>'expiry_mode'='days_from_grant' then now()+interval '1 second'*((contract->>'expiry_days')::numeric*86400)::double precision else null end;
 if expiry is not null then perform app_private.booking_validate_times(now(),expiry);end if;
 lot_id:=gen_random_uuid();
 insert into app_private.package_lots(id,purchase_id,learner_id,origin_kind,original_lot_id,contract_version_id,eligibility_snapshot,base_duration_minutes,coverage_rule,expires_at,grant_source_id,balances) values(lot_id,p.id,p.learner_id,'purchase',lot_id,p.contract_version_id,contract,(contract->>'base_duration_minutes')::integer,contract->>'coverage_rule',expiry,p.charge_id,app_private.package_empty_balance());
 movement_id:=app_private.package_append_movement(lot_id,'grant',jsonb_build_object('granted_credit_quanta',p.planned_credit_quanta,'available_credit_quanta',p.planned_credit_quanta,'granted_value_minor',p.purchase_value_minor,'available_value_minor',p.purchase_value_minor),jsonb_build_object('credit_quanta',p.planned_credit_quanta,'value_minor',p.purchase_value_minor,'to_bucket','available','customer_reason_code','purchased_package_activated'),p_command_context,'purchased-grant:'||p.id);
 for source in select a.id,a.transfer_id,a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) amount from finance_private.payment_allocations a where a.id=any(p_funding_source_ids) order by a.id loop
  insert into finance_private.package_funding_sources(purchase_id,original_lot_id,origin_kind,transfer_id,allocation_id,amount_minor,command_id) values(p.id,lot_id,'purchased',source.transfer_id,source.id,source.amount,(p_command_context->>'command_id')::uuid);
 end loop;
 update app_private.package_purchases set purchase_state='activated',activated_at=now(),version=version+1,updated_at=now() where id=p.id;
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values((p_command_context->>'actor_account_id')::uuid,(p_command_context->>'command_id')::uuid,'purchased_package_activated',p.id,jsonb_build_object('lot_id',lot_id,'grant_movement_id',movement_id,'source_allocation_ids',funding->'source_allocation_ids'));
 perform app_private.enqueue_event(gen_random_uuid(),'purchased_package_activated',p.id,jsonb_build_object('package_purchase_id',p.id,'lot_id',lot_id),'notifications.route');
end $$;
-- The hold is operational, not a destructive rewrite of posted entitlement balances.
create table app_private.package_financing_hold_events(id uuid primary key default gen_random_uuid(),hold_id uuid not null references app_private.package_financing_holds(id),action text not null check(action in('held','released')),command_id uuid not null,actor_account_id uuid references app_private.accounts(id),evidence_file_id uuid references app_private.files(id),reason text not null,recorded_at timestamptz not null default now());
create function app_private.package_mark_financing_hold(p_source_type text,p_source_id uuid,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare origin uuid;held uuid;ids uuid[]:='{}';purchase uuid;begin
 if p_source_type is null or p_source_type not in('transfer','allocation','credit_application') or p_source_id is null then raise exception 'VALIDATION_ERROR';end if;
 for origin in select distinct original_lot_id from finance_private.package_funding_sources where(p_source_type='transfer' and transfer_id=p_source_id) or(p_source_type='allocation' and allocation_id=p_source_id) or(p_source_type='credit_application' and credit_application_id=p_source_id) order by original_lot_id loop
  insert into app_private.package_financing_holds(original_lot_id,source_type,source_id,command_id) values(origin,p_source_type,p_source_id,(p_context->>'command_id')::uuid) on conflict(original_lot_id,source_type,source_id) do update set active=true,resolved_at=null,resolution_command_id=null where not package_financing_holds.active returning id into held;
  if held is not null then insert into app_private.package_financing_hold_events(hold_id,action,command_id,actor_account_id,reason) values(held,'held',(p_context->>'command_id')::uuid,(p_context->>'actor_account_id')::uuid,'Underlying settled source requires reconciliation');end if;
  ids:=array_append(ids,origin);
 end loop;
 for purchase in select distinct purchase_id from app_private.package_lots where original_lot_id=any(ids) order by purchase_id loop
  update app_private.package_purchases set version=version+1,updated_at=now() where id=purchase;
  if not exists(select 1 from app_private.reconciliation_exceptions where source_type='package_financing_hold' and source_id=purchase and state='open') then insert into app_private.reconciliation_exceptions(source_type,source_id,kind,owner_id,signed_exposure_minor,reason) values('package_financing_hold',purchase,'package_financing_hold',(p_context->>'actor_account_id')::uuid,0,'Requalify the actual source before further entitlement use');end if;
  perform app_private.enqueue_event(gen_random_uuid(),'package_financing_hold',purchase,jsonb_build_object('package_purchase_id',purchase),'notifications.route');
 end loop;return ids;
end $$;
alter table app_private.package_financing_hold_events enable row level security;
create policy commands_access on app_private.package_financing_hold_events to git_tutor_commands using(true) with check(true);
grant select,insert on app_private.package_financing_hold_events to git_tutor_commands;
revoke all on app_private.package_financing_hold_events from public,anon,authenticated,service_role,git_tutor_worker;
create trigger immutable_package_financing_hold_events before update or delete on app_private.package_financing_hold_events for each row execute function app_private.reject_immutable_change();
do $$ declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in('package_purchase_funding_status','package_activate_funded_purchase','package_mark_financing_hold') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema app_private,finance_private from git_tutor_commands;

grant create on schema app_private to git_tutor_commands;
create function app_private.package_original_is_held(p_original_lot_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from app_private.package_financing_holds where original_lot_id=p_original_lot_id and active) $$;
create or replace function app_private.package_summary(p_id uuid,p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.package_purchases%rowtype;c finance_private.charges%rowtype;name text;origins jsonb;title text;funding jsonb;begin
 select * into p from app_private.package_purchases where id=p_id;select * into c from finance_private.charges where id=p.charge_id;select display_name into name from app_private.people where id=(select person_id from app_private.learners where id=p.learner_id);
 select s.title||' package' into title from app_private.offers o join app_private.subjects s on s.id=o.subject_id where o.policy_version_id=p.contract_version_id and o.published_at is not null order by o.created_at,o.id limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('origin_kind',origin_kind,'granted_credit_quanta',q,'granted_value_minor',v) order by origin_kind),'[]') into origins from(select origin_kind,sum((balances->>'granted_credit_quanta')::numeric+(balances->>'transferred_in_credit_quanta')::numeric) q,sum((balances->>'granted_value_minor')::numeric+(balances->>'transferred_in_value_minor')::numeric) v from app_private.package_lots where purchase_id=p.id group by origin_kind)x;
 funding:=finance_private.finance_charge_balance(c.id);
 return jsonb_build_object('package_purchase_id',p.id,'version',p.version,'learner',jsonb_build_object('learner_id',p.learner_id,'display_name',name),'contract_version_id',p.contract_version_id,'title',coalesce(title,'Learning package'),'purchase_state',p.purchase_state,'currency',p.currency,'purchased_credit_quanta',p.planned_credit_quanta,'purchase_value_minor',p.purchase_value_minor,'purchased_granted_credit_quanta',coalesce((select sum((balances->>'granted_credit_quanta')::numeric) from app_private.package_lots where purchase_id=p.id and origin_kind='purchase'),0),'usable_available_credit_quanta',coalesce((select sum((balances->>'available_credit_quanta')::numeric) from app_private.package_lots where purchase_id=p.id and(expires_at is null or expires_at>now()) and not app_private.package_original_is_held(original_lot_id)),0),'usable_available_value_minor',coalesce((select sum((balances->>'available_value_minor')::numeric) from app_private.package_lots where purchase_id=p.id and(expires_at is null or expires_at>now()) and not app_private.package_original_is_held(original_lot_id)),0),'held_credit_quanta',coalesce((select sum((balances->>'available_credit_quanta')::numeric+(balances->>'reserved_credit_quanta')::numeric) from app_private.package_lots where purchase_id=p.id and app_private.package_original_is_held(original_lot_id)),0),'held_value_minor',coalesce((select sum((balances->>'available_value_minor')::numeric+(balances->>'reserved_value_minor')::numeric) from app_private.package_lots where purchase_id=p.id and app_private.package_original_is_held(original_lot_id)),0),'financing_state',case when exists(select 1 from app_private.package_lots where purchase_id=p.id and app_private.package_original_is_held(original_lot_id)) then 'held' else 'clear' end,'charge',jsonb_build_object('charge_id',c.id,'state',c.state,'original_minor',c.amount_minor,'net_minor',funding->'commercial_net_minor','allocated_minor',funding->'allocated_cash_minor','balance_minor',greatest(0,(funding->>'receivable_minor')::bigint),'funding_integration_state','ready'),'balances',app_private.package_visible_balance(app_private.package_balance(p.id)),'origin_totals',origins,'next_expiry_at',(select min(expires_at) from app_private.package_lots where purchase_id=p.id and expires_at>now() and (balances->>'available_credit_quanta')::numeric>0),'created_at',p.created_at,'pending_proposals',app_private.package_pending_proposals(p.id,p_actor));
end $$;
create or replace function app_private.package_allocate_available(p_purchase_id uuid,p_credit_quanta bigint,p_at_occurrence_start timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare lot app_private.package_lots%rowtype;remaining bigint:=p_credit_quanta;quantity bigint;amount bigint;rows jsonb:='[]';begin
 if p_credit_quanta is null or p_credit_quanta not between 1 and 9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 -- Read-only preview. Mutating callers hold the learner mutex and lock lots before effects.
 for lot in select * from app_private.package_lots where purchase_id=p_purchase_id and(expires_at is null or(expires_at>now() and(p_at_occurrence_start is null or expires_at>p_at_occurrence_start))) and not app_private.package_original_is_held(original_lot_id) and(balances->>'available_credit_quanta')::numeric>0 order by expires_at nulls last,created_at,id loop
  quantity:=least(remaining,(lot.balances->>'available_credit_quanta')::bigint);
  amount:=floor((lot.balances->>'available_value_minor')::numeric*quantity/(lot.balances->>'available_credit_quanta')::numeric)::bigint;
  rows:=rows||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'lot_version',lot.version,'credit_quanta',quantity,'value_minor',amount,'expires_at',lot.expires_at));remaining:=remaining-quantity;exit when remaining=0;
 end loop;if remaining>0 then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;return rows;
end $$;

create or replace function app_private.package_lot_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lot_id',id,'version',version,'origin_kind',origin_kind,'original_lot_id',original_lot_id,'source_lot_id',source_lot_id,'base_duration_minutes',base_duration_minutes,'coverage_rule',coverage_rule,'eligible_offer_ids',eligibility_snapshot->'eligible_offer_ids','eligible_formats',eligibility_snapshot->'eligible_formats','expires_at',expires_at,'financing_state',case when app_private.package_original_is_held(original_lot_id) then 'held' else 'clear' end,'balances',balances,'created_at',created_at) from app_private.package_lots where id=p_id
$$;
create or replace function app_private.package_coverage_dto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.package_reservations%rowtype;e app_private.enrollments%rowtype;reserved numeric;consumed numeric;released numeric;begin
 select * into r from app_private.package_reservations where id=p_id;select * into e from app_private.enrollments where id=r.enrollment_id;
 select coalesce(sum((delta->>'reserved_credit_quanta')::numeric),0),coalesce(sum((delta->>'consumed_credit_quanta')::numeric),0),coalesce(sum(credit_quanta) filter(where kind='release'),0) into reserved,consumed,released from app_private.entitlement_movements where reservation_id=r.id;
 return jsonb_build_object('reservation_id',r.id,'version',r.version,'package_purchase_id',r.purchase_id,'enrollment_id',r.enrollment_id,'learner_id',r.learner_id,'quote_id',r.quote_id,'coverage_rule',r.coverage_rule,'required_credit_quanta',r.required_credit_quanta,'reserved_credit_quanta',reserved,'consumed_credit_quanta',consumed,'released_credit_quanta',released,'carrying_value_minor',r.allocated_value_minor,'agreed_top_up_minor',r.agreed_top_up_minor,'service_satisfied',not exists(select 1 from app_private.package_reservation_allocations x join app_private.package_lots l on l.id=x.lot_id where x.reservation_id=r.id and app_private.package_original_is_held(l.original_lot_id)) and r.state in('reserved','partially_consumed','consumed') and reserved+consumed>=r.required_credit_quanta,'can_release',e.state='held' and e.hold_kind='ordinary' and e.hold_expires_at>now() and r.state in('reserved','partially_consumed') and reserved>0,'state',r.state,'expires_at',r.expires_at,'funding_integration_state','ready','coverage_proposal_id',r.coverage_proposal_id);
end $$;

alter function app_private.package_original_is_held(uuid) owner to git_tutor_commands;
revoke all on function app_private.package_original_is_held(uuid) from public,anon,authenticated,service_role,git_tutor_worker;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';

grant create on schema api to git_tutor_commands;
create or replace function app_private.package_grant_policy_errors(p_content jsonb) returns text[] language plpgsql immutable set search_path='' as $$
#variable_conflict use_column
declare value jsonb;begin
 if jsonb_typeof(p_content) is distinct from 'object' or(p_content-array['name','eligible_package_contract_version_ids','currency','valuation_rule','maximum_credit_quanta_per_grant','maximum_carrying_value_minor_per_grant'])<>'{}' then return array['content'];end if;
 if jsonb_typeof(p_content->'name') is distinct from 'string' or length(btrim(coalesce(p_content->>'name',''))) not between 1 and 200 or p_content->>'currency' is distinct from 'EGP' or p_content->>'valuation_rule' is null or p_content->>'valuation_rule' not in('zero_value','reviewed_exact_capped_subsidy','reviewed_exact_source_credit') or jsonb_typeof(p_content->'eligible_package_contract_version_ids') is distinct from 'array' or jsonb_array_length(p_content->'eligible_package_contract_version_ids') not between 1 and 100 then return array['content'];end if;
 for value in select value from jsonb_array_elements(p_content->'eligible_package_contract_version_ids') loop if jsonb_typeof(value)<>'string' then return array['eligible_package_contract_version_ids'];end if;if (value#>>'{}') !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' then return array['eligible_package_contract_version_ids'];end if;end loop;
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p_content->'eligible_package_contract_version_ids')) then return array['eligible_package_contract_version_ids'];end if;
 perform app_private.package_safe_integer(p_content->'maximum_credit_quanta_per_grant',1);perform app_private.package_safe_integer(p_content->'maximum_carrying_value_minor_per_grant');
 if p_content->>'valuation_rule'='zero_value' and(p_content->>'maximum_carrying_value_minor_per_grant')::numeric<>0 then return array['maximum_carrying_value_minor_per_grant'];end if;return '{}';
exception when others then return array['content'];end $$;

drop function api.approve_package_grant(uuid,bigint,bigint,text,text,uuid,uuid,text,uuid,integer,text);
create function api.approve_package_grant(p_package_id uuid,p_credit_quanta bigint,p_carrying_value_minor bigint,p_currency text,p_grant_kind text,p_grant_policy_version_id uuid,p_source_credit_id uuid,p_reason text,p_evidence_file_id uuid,p_expected_version integer,p_idempotency_key text,p_credit_conversion_intent_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare args jsonb;begin
 if(p_grant_kind='approved_credit' and(p_credit_conversion_intent_id is null or p_source_credit_id is null or p_grant_policy_version_id is null or p_carrying_value_minor<=0)) or(p_grant_kind='complimentary' and p_credit_conversion_intent_id is not null) then raise exception 'VALIDATION_ERROR';end if;
 args:=jsonb_build_object('package_id',p_package_id,'credit_quanta',p_credit_quanta,'carrying_value_minor',p_carrying_value_minor,'currency',p_currency,'grant_kind',p_grant_kind,'grant_policy_version_id',p_grant_policy_version_id,'source_credit_id',p_source_credit_id,'reason',p_reason,'evidence_file_id',p_evidence_file_id,'expected_version',p_expected_version);
 if p_credit_conversion_intent_id is not null then args:=args||jsonb_build_object('credit_conversion_intent_id',p_credit_conversion_intent_id);end if;
 return app_private.package_command('approve_package_grant',args,p_idempotency_key);
end $$;
alter function api.approve_package_grant(uuid,bigint,bigint,text,text,uuid,uuid,text,uuid,integer,text,uuid) owner to git_tutor_commands;
revoke all on function api.approve_package_grant(uuid,bigint,bigint,text,text,uuid,uuid,text,uuid,integer,text,uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.approve_package_grant(uuid,bigint,bigint,text,text,uuid,uuid,text,uuid,integer,text,uuid) to authenticated;
revoke create on schema api from git_tutor_commands;
notify pgrst,'reload schema';
