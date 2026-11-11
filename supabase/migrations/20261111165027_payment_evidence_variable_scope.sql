grant create on schema api to git_tutor_commands;
create or replace function api.list_payment_evidence(p_action text,p_target_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();selected_purpose text;selected_parent_type text;selected_parent_id uuid;uploader uuid;after_at timestamptz;after_id uuid;rows jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 or p_action is null or(p_target_id is null and p_action<>'create_receiving_account') then raise exception 'VALIDATION_ERROR';end if;
 if p_action='create_receiving_account' then perform app_private.require_role(actor,'admin');selected_purpose:='receiving_ownership';selected_parent_type:='receiving_account';selected_parent_id:=null;uploader:=actor;
 elsif p_action in('create_statement_import','record_manual_transfer') then perform app_private.payment_current_staff(actor);if not exists(select 1 from finance_private.receiving_accounts where id=p_target_id) then raise exception 'NOT_FOUND';end if;selected_purpose:='statement';selected_parent_type:='receiving_account';selected_parent_id:=p_target_id;
 elsif p_action in('verify_transfer_settlement','bind_transfer_payer','record_transfer_reversal') then
  if p_action='record_transfer_reversal' then perform app_private.require_role(actor,'admin');else perform app_private.payment_current_staff(actor);end if;
  select receiving_account_id into selected_parent_id from finance_private.incoming_transfers where id=p_target_id;if selected_parent_id is null then raise exception 'NOT_FOUND';end if;
  if p_action='verify_transfer_settlement' then selected_purpose:='statement';selected_parent_type:='receiving_account';else selected_purpose:=case when p_action='bind_transfer_payer' then 'payer_ownership' else 'transfer_reversal' end;selected_parent_type:='transfer';selected_parent_id:=p_target_id;end if;
 elsif p_action='propose_refund_destination' then
  if to_regclass('finance_private.refunds') is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;perform app_private.refund_assert_scope(actor,p_target_id,true);selected_purpose:='refund_destination';selected_parent_type:='refund';selected_parent_id:=p_target_id;uploader:=actor;
 elsif p_action='verify_refund_destination' then
  perform app_private.require_role(actor,'admin');if to_regclass('finance_private.refund_destinations') is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;if not exists(select 1 from finance_private.refund_destinations where id=p_target_id) then raise exception 'NOT_FOUND';end if;selected_purpose:='refund_destination_verification';selected_parent_type:='refund_destination';selected_parent_id:=p_target_id;
 elsif p_action in('reconcile_refund','record_refund_reversal') then
  perform app_private.require_role(actor,'admin');if to_regclass('finance_private.refund_attempts') is null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;if not exists(select 1 from finance_private.refund_attempts where id=p_target_id) then raise exception 'NOT_FOUND';end if;selected_purpose:=case when p_action='reconcile_refund' then 'refund_outcome' else 'refund_reversal' end;selected_parent_type:='refund_attempt';selected_parent_id:=p_target_id;
 elsif p_action='resolve_package_financing_hold' then perform app_private.require_role(actor,'admin');if not exists(select 1 from app_private.package_purchases where id=p_target_id) then raise exception 'NOT_FOUND';end if;selected_purpose:='financing_hold';selected_parent_type:='package_purchase';selected_parent_id:=p_target_id;
 else raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'data',app_private.payment_file_dto(x.id)) order by x.created_at desc,x.id desc),'[]') into rows from(select f.* from app_private.files f where f.purpose=selected_purpose and f.parent_type=selected_parent_type and f.parent_id is not distinct from selected_parent_id and(uploader is null or f.uploader_account_id=uploader) and f.scan_state='clean' and(p_cursor is null or(f.created_at,f.id)<(after_at,after_id)) order by f.created_at desc,f.id desc limit p_limit+1)x;
 return app_private.package_page(rows,p_limit);
end $$;
alter function api.list_payment_evidence(text,uuid,text,integer) owner to git_tutor_commands;
revoke all on function api.list_payment_evidence(text,uuid,text,integer) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.list_payment_evidence(text,uuid,text,integer) to authenticated;
revoke create on schema api from git_tutor_commands;
notify pgrst,'reload schema';

