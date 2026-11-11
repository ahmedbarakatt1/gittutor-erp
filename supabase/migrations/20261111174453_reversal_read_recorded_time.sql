create or replace function api.get_transfer_reversal(p_reversal_id uuid,p_allocation_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
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
  select a.id,a.recorded_at created_at,jsonb_build_object('allocation_id',a.id,'charge_id',a.charge_id,'title',app_private.payment_charge_dto(a.charge_id)->'title','learner',app_private.payment_charge_dto(a.charge_id)->'learner','remaining_resolvable_minor',least(remaining,b.active_minor)) data
  from finance_private.payment_allocations a cross join lateral(select a.amount_minor-coalesce((select sum(r.amount_minor) from finance_private.allocation_reversals r where r.allocation_id=a.id),0) active_minor)b
  where a.transfer_id=transfer.id and remaining>0 and b.active_minor>0 and(after_at is null or(a.recorded_at,a.id)<(after_at,after_id)) order by a.recorded_at desc,a.id desc limit p_limit+1
 )x;
 return jsonb_build_object('reversal_id',reversal.id,'version',transfer.version,'transfer',app_private.payment_transfer_dto(transfer.id,actor,true),'amount_minor',reversal.amount_minor,'resolved_minor',resolved,'remaining_unresolved_minor',remaining,'unapplied_resolvable_minor',coalesce(unapplied,0),'allocation_page',app_private.package_page(rows,p_limit));
end $$;
notify pgrst,'reload schema';