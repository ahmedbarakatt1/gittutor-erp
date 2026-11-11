-- Admin-only financial reconciliation projections; reads never resolve or alter source history.
grant create on schema api,app_private to git_tutor_commands;
create function app_private.payment_reversal_resolved_minor(p_reversal_id uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(r.unapplied_minor+(select coalesce(sum((item->>'amount_minor')::numeric),0) from jsonb_array_elements(r.allocations)item)),0)::bigint from finance_private.transfer_reversal_resolutions r where r.reversal_id=p_reversal_id
$$;
create function api.list_financial_exceptions(p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();after_at timestamptz;after_id uuid;rows jsonb;begin
 perform app_private.require_role(actor,'admin');
 if p_limit is null or p_limit not between 1 and 100 or(p_state is not null and p_state not in('open','resolved')) then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then
  if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;
  after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;if not isfinite(after_at) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('at',x.created_at,'id',x.id,'data',x.data) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from(
  select e.id,e.created_at,jsonb_build_object('exception_id',e.id,'version',e.version,'state',e.state,'kind',e.kind,'signed_exposure_minor',case when e.source_type='transfer' then -(finance_private.finance_transfer_balance(e.source_id)->>'recovery_exposure_minor')::bigint else e.signed_exposure_minor end,'currency',e.currency,'created_at',e.created_at,
   'resolution_target',case when e.state<>'open' then null when e.source_type='transfer' then(select jsonb_build_object('kind','transfer_reversal','reversal_id',r.id) from finance_private.transfer_reversals r where r.transfer_id=e.source_id and r.amount_minor>app_private.payment_reversal_resolved_minor(r.id) order by r.recorded_at,r.id limit 1)
    when e.source_type='package_financing_hold' then(select jsonb_build_object('kind','package_financing_hold','package_purchase_id',p.id,'package_version',p.version) from app_private.package_purchases p where p.id=e.source_id) else null end) data
  from app_private.reconciliation_exceptions e where(p_state is null or e.state=p_state) and(after_at is null or(e.created_at,e.id)<(after_at,after_id)) order by e.created_at desc,e.id desc limit p_limit+1
 )x;
 return app_private.package_page(rows,p_limit);
end $$;
create function api.get_transfer_reversal(p_reversal_id uuid,p_allocation_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();reversal finance_private.transfer_reversals%rowtype;transfer finance_private.incoming_transfers%rowtype;resolved bigint;remaining bigint;unapplied bigint;after_at timestamptz;after_id uuid;rows jsonb;begin
 perform app_private.require_role(actor,'admin');
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_allocation_cursor is not null then
  if length(p_allocation_cursor)>200 or array_length(string_to_array(p_allocation_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;
  after_at:=split_part(p_allocation_cursor,'|',1)::timestamptz;after_id:=split_part(p_allocation_cursor,'|',2)::uuid;if not isfinite(after_at) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 select * into reversal from finance_private.transfer_reversals where id=p_reversal_id;if reversal.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into transfer from finance_private.incoming_transfers where id=reversal.transfer_id;
 resolved:=app_private.payment_reversal_resolved_minor(reversal.id);remaining:=greatest(0,reversal.amount_minor-resolved);
 select least(remaining,greatest(0,a.unapplied_cap_minor-coalesce((select sum(r.unapplied_minor) from finance_private.transfer_reversal_resolutions r where r.reversal_id=reversal.id),0)))::bigint into unapplied from finance_private.transfer_reversal_accounts a where a.reversal_id=reversal.id;
 select coalesce(jsonb_agg(jsonb_build_object('at',x.created_at,'id',x.id,'data',x.data) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from(
  select a.id,a.created_at,jsonb_build_object('allocation_id',a.id,'charge_id',a.charge_id,'title',app_private.payment_charge_dto(a.charge_id)->'title','learner',app_private.payment_charge_dto(a.charge_id)->'learner','remaining_resolvable_minor',least(remaining,b.active_minor)) data
  from finance_private.payment_allocations a cross join lateral(select a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) active_minor)b
  where a.transfer_id=transfer.id and remaining>0 and b.active_minor>0 and(after_at is null or(a.created_at,a.id)<(after_at,after_id)) order by a.created_at desc,a.id desc limit p_limit+1
 )x;
 return jsonb_build_object('reversal_id',reversal.id,'version',transfer.version,'transfer',app_private.payment_transfer_dto(transfer.id,actor,true),'amount_minor',reversal.amount_minor,'resolved_minor',resolved,'remaining_unresolved_minor',remaining,'unapplied_resolvable_minor',coalesce(unapplied,0),'allocation_page',app_private.package_page(rows,p_limit));
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='app_private' and p.proname='payment_reversal_resolved_minor') or(n.nspname='api' and p.proname in('list_financial_exceptions','get_transfer_reversal')) loop
  execute format('alter function %s owner to git_tutor_commands',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);
  if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private from git_tutor_commands;
notify pgrst,'reload schema';
