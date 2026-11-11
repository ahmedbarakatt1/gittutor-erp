grant create on schema api to git_tutor_commands;

create function api.get_review_case_payer_intent(p_case_id uuid,p_transfer_id uuid,p_payment_plan_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();review app_private.review_cases%rowtype;selected_link uuid;begin
 review:=app_private.payment_assert_case_read(actor,p_case_id);
 if not exists(select 1 from app_private.payment_allocation_plans p join app_private.receipts r on r.id=p.receipt_id where p.id=p_payment_plan_id and p.receipt_id=review.receipt_id and p.state='active' and p.evidence_version=r.current_evidence_version) then raise exception 'NOT_FOUND';end if;
 select l.id into selected_link from app_private.transfer_payment_plan_links l join finance_private.incoming_transfers t on t.id=l.transfer_id where l.case_id=review.id and l.transfer_id=p_transfer_id and l.payment_plan_id=p_payment_plan_id and l.payer_binding_id=t.current_payer_binding_id and l.expires_at>now() and l.state in('awaiting_payer_acceptance','accepted') order by l.created_at desc,l.id desc limit 1;
 return jsonb_build_object('intent',case when selected_link is null then null else app_private.payment_payer_intent_dto(selected_link) end);
end $$;
create or replace function api.get_transfer_payment_plan(p_plan_link_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();selected_case uuid;owns_source boolean;begin
 select l.case_id,b.payer_account_id=actor into selected_case,owns_source from app_private.transfer_payment_plan_links l join finance_private.incoming_transfers t on t.id=l.transfer_id join finance_private.transfer_payer_bindings b on b.id=t.current_payer_binding_id where l.id=p_plan_link_id;
 if selected_case is null then raise exception 'NOT_FOUND';end if;if not owns_source then perform app_private.payment_assert_case_read(actor,selected_case);end if;return app_private.payment_payer_intent_dto(p_plan_link_id);end $$;
alter function api.get_review_case_payer_intent(uuid,uuid,uuid) owner to git_tutor_commands;
revoke all on function api.get_review_case_payer_intent(uuid,uuid,uuid) from public,anon,authenticated,service_role,git_tutor_worker;
grant execute on function api.get_review_case_payer_intent(uuid,uuid,uuid) to authenticated;

revoke create on schema api from git_tutor_commands;
notify pgrst,'reload schema';
