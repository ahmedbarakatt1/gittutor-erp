-- Source graph discovery is read-only. The shared booking orchestrator locks domain resources first.
grant create on schema finance_private to git_tutor_commands;
create or replace function finance_private.finance_discover_scope(p_charge_ids uuid[],p_transfer_ids uuid[],p_refund_ids uuid[],p_consumption_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
declare charges uuid[]:=coalesce(p_charge_ids,'{}');transfers uuid[]:=coalesce(p_transfer_ids,'{}');enrollments uuid[]:='{}';occurrences uuid[]:='{}';learners uuid[]:='{}';purchases uuid[]:='{}';lots uuid[]:='{}';sources uuid[]:='{}';before_graph jsonb;graph jsonb;iteration integer:=0;begin
 if cardinality(coalesce(p_refund_ids,'{}'))>0 then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 loop
  before_graph:=jsonb_build_array(charges,transfers,enrollments,occurrences,learners,purchases,lots);
  select coalesce(array_agg(id order by id),'{}') into charges from(select unnest(charges) id union select charge_id from finance_private.payment_allocations where transfer_id=any(transfers) union select id from finance_private.charges where enrollment_id=any(enrollments) or package_purchase_id=any(purchases))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into enrollments from(select unnest(enrollments) id union select enrollment_id from finance_private.charges where id=any(charges) union select id from app_private.enrollments where occurrence_id=any(occurrences))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into occurrences from(select unnest(occurrences) id union select occurrence_id from app_private.enrollments where id=any(enrollments))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select package_purchase_id from finance_private.charges where id=any(charges) union select purchase_id from finance_private.package_funding_sources where transfer_id=any(transfers) union select purchase_id from app_private.package_reservations where enrollment_id=any(enrollments) union select purchase_id from app_private.entitlement_movements where id=any(coalesce(p_consumption_ids,'{}')))x where id is not null;
  select coalesce(array_agg(id order by id),'{}') into learners from(select unnest(learners) id union select learner_id from finance_private.charges where id=any(charges) union select learner_id from app_private.enrollments where id=any(enrollments) union select learner_id from app_private.package_purchases where id=any(purchases))x where id is not null;
  -- All packages of an affected learner share one financial mutex and can be selected by a new coverage command.
  select coalesce(array_agg(id order by id),'{}') into purchases from(select unnest(purchases) id union select id from app_private.package_purchases where learner_id=any(learners))x;
  select coalesce(array_agg(id order by id),'{}') into lots from app_private.package_lots where purchase_id=any(purchases);
  select coalesce(array_agg(id order by id),'{}') into transfers from(select unnest(transfers) id union select transfer_id from finance_private.payment_allocations where charge_id=any(charges) union select transfer_id from finance_private.package_funding_sources where purchase_id=any(purchases))x where id is not null;
  iteration:=iteration+1;exit when before_graph=jsonb_build_array(charges,transfers,enrollments,occurrences,learners,purchases,lots);
  if iteration>=64 then raise exception 'RETRYABLE_CONFLICT';end if;
 end loop;
 select coalesce(array_agg(id order by id),'{}') into sources from finance_private.remedy_sources where consumption_id in(select id from app_private.entitlement_movements where purchase_id=any(purchases));
 graph:=jsonb_build_object('charge_ids',charges,'transfer_ids',transfers,'refund_ids',coalesce(p_refund_ids,'{}'),'enrollment_ids',enrollments,'occurrence_ids',occurrences,'learner_ids',learners,'purchase_ids',purchases,'lot_ids',lots,'remedy_source_ids',sources,
  'tutor_ids',(select coalesce(jsonb_agg(id order by id),'[]') from(select distinct tutor_id id from app_private.occurrences where id=any(occurrences))x),
  'case_ids',(select coalesce(jsonb_agg(c.id order by c.id),'[]') from app_private.review_cases c join app_private.receipts r on r.id=c.receipt_id where r.charge_id=any(charges)),
  'receipt_ids',(select coalesce(jsonb_agg(id order by id),'[]') from app_private.receipts where charge_id=any(charges)),
  'credit_lot_ids',(select coalesce(jsonb_agg(id order by id),'[]') from finance_private.customer_credit_lots where transfer_id=any(transfers)));
 return graph||jsonb_build_object('source_fingerprint',app_private.catalog_hash(graph));
end $$;
create or replace function finance_private.finance_lock_targets(p_charge_ids uuid[],p_transfer_ids uuid[],p_refund_ids uuid[],p_credit_lot_ids uuid[],p_source_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare fresh jsonb;begin
 perform 1 from finance_private.charge_accounts where charge_id=any(p_charge_ids) order by charge_id for update;
 perform 1 from finance_private.incoming_transfers where id=any(p_transfer_ids) order by id for update;
 perform 1 from finance_private.credit_lot_accounts where credit_lot_id=any(p_credit_lot_ids) order by credit_lot_id for update;
 perform 1 from finance_private.credit_reservations where credit_lot_id=any(p_credit_lot_ids) order by id for update;
 fresh:=finance_private.finance_discover_scope(p_charge_ids,p_transfer_ids,p_refund_ids,'{}');
 if fresh->>'source_fingerprint' is distinct from p_source_fingerprint then raise exception 'RETRYABLE_CONFLICT';end if;
 return jsonb_build_object('source_fingerprint',p_source_fingerprint,'charge_versions',(select coalesce(jsonb_object_agg(charge_id,version),'{}') from finance_private.charge_accounts where charge_id=any(p_charge_ids)),'transfer_versions',(select coalesce(jsonb_object_agg(id,version),'{}') from finance_private.incoming_transfers where id=any(p_transfer_ids)),'credit_versions',(select coalesce(jsonb_object_agg(credit_lot_id,version),'{}') from finance_private.credit_lot_accounts where credit_lot_id=any(p_credit_lot_ids)));
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('finance_discover_scope','finance_lock_targets') loop execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);end loop;end $$;
revoke create on schema finance_private from git_tutor_commands;

