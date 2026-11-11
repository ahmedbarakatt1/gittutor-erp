-- T05 exact allocation and restricted available-only expiry. No delivery/funding activation.
grant create on schema app_private to git_tutor_commands;
create function app_private.package_allocate_available(p_purchase_id uuid,p_credit_quanta bigint,p_at_occurrence_start timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare lot app_private.package_lots%rowtype;remaining bigint:=p_credit_quanta;quantity bigint;amount bigint;rows jsonb:='[]';begin
 if p_credit_quanta is null or p_credit_quanta not between 1 and 9007199254740991 then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from app_private.package_lots where purchase_id=p_purchase_id order by id for update;
 for lot in select * from app_private.package_lots where purchase_id=p_purchase_id and(expires_at is null or(expires_at>now() and(p_at_occurrence_start is null or expires_at>p_at_occurrence_start))) and(balances->>'available_credit_quanta')::numeric>0 order by expires_at nulls last,created_at,id loop
  quantity:=least(remaining,(lot.balances->>'available_credit_quanta')::bigint);
  amount:=floor((lot.balances->>'available_value_minor')::numeric*quantity/(lot.balances->>'available_credit_quanta')::numeric)::bigint;
  rows:=rows||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'lot_version',lot.version,'credit_quanta',quantity,'value_minor',amount,'expires_at',lot.expires_at));remaining:=remaining-quantity;exit when remaining=0;
 end loop;if remaining>0 then raise exception 'INSUFFICIENT_ENTITLEMENT';end if;return rows;
end $$;
create function app_private.package_enqueue_due(p_purchase_id uuid,p_due_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid:=gen_random_uuid();job_id uuid;begin if p_due_at is null then return null;end if;
 insert into app_private.domain_events(id,event_type,aggregate_id,payload,correlation_id) values(event_id,'package_due',p_purchase_id,jsonb_build_object('package_purchase_id',p_purchase_id),event_id);
 insert into app_private.outbox_jobs(event_id,purpose,available_at) values(event_id,'packages.process_due',greatest(p_due_at,now())) returning id into job_id;return job_id;end $$;
create function app_private.package_queue_lot_expiry() returns trigger language plpgsql security definer set search_path='' as $$
begin perform app_private.package_enqueue_due(new.purchase_id,new.expires_at);return new;end $$;
create trigger queue_package_lot_expiry after insert on app_private.package_lots for each row execute function app_private.package_queue_lot_expiry();
create function app_private.package_expire_available(p_purchase_id uuid,p_context jsonb) returns uuid[] language plpgsql security definer set search_path='' as $$
declare lot app_private.package_lots%rowtype;ids uuid[]:='{}';quantity bigint;amount bigint;begin
 for lot in select * from app_private.package_lots where purchase_id=p_purchase_id and expires_at<=now() and(balances->>'available_credit_quanta')::numeric>0 order by id for update loop
  quantity:=(lot.balances->>'available_credit_quanta')::bigint;amount:=(lot.balances->>'available_value_minor')::bigint;
  perform app_private.package_append_movement(lot.id,'expire',jsonb_build_object('available_credit_quanta',-quantity,'expired_credit_quanta',quantity,'available_value_minor',-amount,'expired_value_minor',amount),jsonb_build_object('credit_quanta',quantity,'value_minor',amount,'from_bucket','available','to_bucket','expired','customer_reason_code','original_contract_expiry'),p_context,'expire:'||lot.id);
  ids:=array_append(ids,lot.id);
 end loop;return ids;end $$;
create function app_private.process_package_due(p_purchase_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare purchase app_private.package_purchases%rowtype;prior app_private.package_due_runs%rowtype;run_id uuid:=gen_random_uuid();expired uuid[];next_due timestamptz;result jsonb;begin
 if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 purchase:=app_private.package_lock_purchase(p_purchase_id);
 select * into prior from app_private.package_due_runs where purchase_id=p_purchase_id and idempotency_key=p_idempotency_key;if prior.id is not null then return prior.result;end if;
 expired:=app_private.package_expire_available(p_purchase_id,jsonb_build_object('command_id',run_id));
 if cardinality(expired)>0 then update app_private.package_purchases set version=version+1,updated_at=now() where id=p_purchase_id;end if;
 select min(expires_at) into next_due from app_private.package_lots where purchase_id=p_purchase_id and expires_at>now() and(balances->>'available_credit_quanta')::numeric>0;
 if next_due is not null then perform app_private.package_enqueue_due(p_purchase_id,next_due);end if;
 result:=jsonb_build_object('expired_lot_ids',expired,'next_due_at',next_due);
 insert into app_private.package_due_runs(id,purchase_id,idempotency_key,result) values(run_id,p_purchase_id,p_idempotency_key,result);
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run_id,'package_due_processed',p_purchase_id,jsonb_build_object('actor_kind','worker','expired_count',cardinality(expired)));
 perform app_private.enqueue_event(run_id,'package_due_processed',p_purchase_id,jsonb_build_object('package_purchase_id',p_purchase_id),'notifications.route');return result;
end $$;
create function app_private.package_purchase_funding_status(p_purchase_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('integration_state','awaiting_T06_integration','eligible',false,'reason','T06_INTEGRATION_REQUIRED','qualified_value_minor',null,'source_allocation_ids','[]'::jsonb) $$;
create function app_private.package_activate_funded_purchase(p_purchase_id uuid,p_funding_source_ids uuid[],p_command_context jsonb) returns void language plpgsql security definer set search_path='' as $$ begin raise exception 'DEPENDENCY_UNAVAILABLE';end $$;
create function app_private.package_lock_approved_credit(p_source_credit_id uuid,p_learner_id uuid,p_value_minor bigint) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'DEPENDENCY_UNAVAILABLE';end $$;
create function app_private.package_assert_delivery_qualification(p_enrollment_id uuid,p_decision_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'DEPENDENCY_UNAVAILABLE';end $$;
create function app_private.package_reserve_remedy(p_consumption_id uuid,p_remedy_id uuid,p_credit_quanta bigint,p_value_minor bigint,p_mode text) returns uuid language plpgsql security definer set search_path='' as $$ begin raise exception 'DEPENDENCY_UNAVAILABLE';end $$;
create function app_private.package_validate_coverage_proposal(p_proposal_id uuid,p_actor uuid,p_purchase_id uuid,p_enrollment_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'CONSENT_REQUIRED';end $$;
create function app_private.package_validate_conversion_proposal(p_proposal_id uuid,p_actor uuid,p_source_purchase_id uuid,p_target_purchase_id uuid,p_new_contract_version_id uuid,p_credit_quanta bigint) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'CONSENT_REQUIRED';end $$;
create function app_private.package_commit_proposal(p_proposal_id uuid,p_command_context jsonb) returns void language plpgsql security definer set search_path='' as $$ begin if p_proposal_id is not null then raise exception 'CONSENT_REQUIRED';end if;end $$;
create or replace function app_private.package_balance(p_purchase_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=app_private.package_empty_balance();key text;total numeric;begin
 for key in select jsonb_object_keys(result) loop select coalesce(sum((balances->>key)::numeric),0) into total from app_private.package_lots where purchase_id=p_purchase_id;if abs(total)>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;result:=jsonb_set(result,array[key],to_jsonb(total));end loop;return result;
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure::text as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and(p.proname like 'package_%' or p.proname='process_package_due') loop
 execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.proname='process_package_due' then execute format('grant execute on function %s to git_tutor_worker',f.signature);end if;
end loop;end $$;
revoke create on schema app_private from git_tutor_commands;
notify pgrst,'reload schema';
