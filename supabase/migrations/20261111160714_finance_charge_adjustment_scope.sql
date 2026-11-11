create or replace function finance_private.finance_adjust_charge(p_charge_id uuid,p_signed_minor bigint,p_kind text,p_source_type text,p_source_id uuid,p_effective_at timestamptz,p_reason text,p_context jsonb,p_line_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c finance_private.charges%rowtype;saved finance_private.charge_adjustments%rowtype;b jsonb;new_net numeric;excess bigint;result jsonb;released jsonb:='{}';id uuid:=gen_random_uuid();version integer;digest text;begin
 if p_signed_minor is null or p_signed_minor=0 or abs(p_signed_minor::numeric)>9007199254740991 or p_kind is null or p_kind not in('commercial','named_coverage','partial_named_coverage','linked_inverse') or p_source_type is null or length(p_source_type) not between 1 and 100 or p_source_id is null or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 or p_line_key is null or length(p_line_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 digest:=app_private.catalog_hash(jsonb_build_object('charge_id',p_charge_id,'signed_minor',p_signed_minor,'kind',p_kind,'source_type',p_source_type,'source_id',p_source_id,'effective_at',p_effective_at,'reason',p_reason));
 perform 1 from finance_private.charge_accounts where charge_id=p_charge_id for update;
 select * into c from finance_private.charges charge_row where charge_row.id=p_charge_id;if c.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 select * into saved from finance_private.charge_adjustments where command_id=(p_context->>'command_id')::uuid and source_line_key=p_line_key;
 if saved.id is not null then if saved.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT';end if;return saved.result;end if;
 b:=finance_private.finance_charge_balance(c.id);new_net:=(b->>'commercial_net_minor')::numeric+p_signed_minor;
 if new_net<0 or new_net>9007199254740991 then raise exception 'AMOUNT_OUT_OF_RANGE';end if;
 if (b->>'allocated_package_value_minor')::numeric>new_net then raise exception 'POLICY_INCOMPLETE';end if;
 excess:=greatest(0,(b->>'allocated_cash_minor')::numeric+(b->>'allocated_package_value_minor')::numeric-new_net)::bigint;
 if excess>0 and to_regprocedure('finance_private.finance_release_cash_excess(uuid,bigint,uuid,jsonb)') is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 if excess>0 then released:=finance_private.finance_release_cash_excess(c.id,excess,id,p_context);end if;
 update finance_private.charge_accounts set version=charge_accounts.version+1,updated_at=now() where charge_id=c.id returning charge_accounts.version into version;
 result:=jsonb_build_object('adjustment_id',id,'commercial_net_minor',new_net,'charge_version',version,'allocation_reversal_ids',coalesce(released->'allocation_reversal_ids','[]'::jsonb),'released_credit_lot_ids',coalesce(released->'released_credit_lot_ids','[]'::jsonb));
 insert into finance_private.charge_adjustments(id,charge_id,signed_minor,kind,domain_source_type,domain_source_id,original_adjustment_id,reason,actor_account_id,command_id,source_line_key,effective_at,request_hash,result)
 values(id,c.id,p_signed_minor,p_kind,p_source_type,p_source_id,case when p_kind='linked_inverse' then p_source_id else null end,p_reason,(p_context->>'actor_account_id')::uuid,(p_context->>'command_id')::uuid,p_line_key,p_effective_at,digest,result);
 perform finance_private.finance_post_balanced('charge-adjustment:'||id,'charge_adjustment',id,c.currency,p_effective_at,jsonb_build_array(
  jsonb_build_object('account_code','receivable','learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'charge_id',c.id,'enrollment_id',c.enrollment_id,'signed_minor',p_signed_minor),
  jsonb_build_object('account_code',case when c.charge_type='package_purchase' then 'deferred_package_obligation' else 'deferred_tuition' end,'learner_id',c.learner_id,'package_purchase_id',c.package_purchase_id,'charge_id',c.id,'enrollment_id',c.enrollment_id,'signed_minor',-p_signed_minor)),p_context);
 return result;
end $$;
