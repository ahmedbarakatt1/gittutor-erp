create or replace function app_private.finance_qualified_proof(p_case_id uuid,p_evidence_version integer,p_transfer_id uuid,p_charge_ids uuid[],p_payment_plan_id uuid,p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare review app_private.review_cases%rowtype;r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;t finance_private.incoming_transfers%rowtype;b finance_private.transfer_payer_bindings%rowtype;plan app_private.payment_allocation_plans%rowtype;link app_private.transfer_payment_plan_links%rowtype;acceptance uuid;target record;targets jsonb:='[]';begin
 perform app_private.payment_current_staff(p_actor);select * into review from app_private.review_cases where id=p_case_id;
 if review.id is null then raise exception 'NOT_FOUND';end if;
 if not app_private.has_role(p_actor,'admin') and(review.owner_id is distinct from p_actor or review.claim_expires_at<=now() or review.claim_expires_at is null) then raise exception 'OWNER_REQUIRED';end if;
 if review.state not in('claimed','needs_information','escalated') then raise exception 'STATE_CONFLICT';end if;
 select * into r from app_private.receipts where id=review.receipt_id;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
 if e.evidence_version is distinct from p_evidence_version or review.current_evidence_version<>p_evidence_version or e.state<>'ready_for_review' then raise exception 'EVIDENCE_REQUIRED';end if;
 if not coalesce(app_private.payment_verified_account(e.uploader_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;perform app_private.package_assert_scope(e.uploader_account_id,e.learner_id,'payments');perform app_private.payment_assert_file(e.file_id,'payment_receipt','charge',e.charge_id,e.uploader_account_id);
 select * into t from finance_private.incoming_transfers where id=p_transfer_id;select * into b from finance_private.transfer_payer_bindings where id=t.current_payer_binding_id;
 if t.id is null then raise exception 'NOT_FOUND';end if;if t.state<>'settled' or not exists(select 1 from finance_private.transfer_settlements where transfer_id=t.id) then raise exception 'TRANSFER_UNSETTLED';end if;
 if b.id is null then raise exception 'CONSENT_REQUIRED';end if;if not coalesce(app_private.payment_verified_account(b.payer_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;
 if e.receiving_account_version_id<>t.receiving_account_version_id or e.channel<>t.channel or e.currency<>t.currency then raise exception 'EVIDENCE_REQUIRED';end if;
 if p_payment_plan_id is null then
  if cardinality(p_charge_ids)<>1 or p_charge_ids[1]<>e.charge_id or e.uploader_account_id<>b.payer_account_id then raise exception 'CONSENT_REQUIRED';end if;
  targets:=jsonb_build_array(jsonb_build_object('charge_id',e.charge_id,'learner_id',e.learner_id,'evidence_id',e.id,'plan_target_id',null,'authority_ref',e.submission_authority));
 else
  select * into plan from app_private.payment_allocation_plans where id=p_payment_plan_id;
  if plan.id is null or plan.receipt_id<>r.id or plan.evidence_version<>e.evidence_version or plan.state<>'active' then raise exception 'CONSENT_REQUIRED';end if;
  select l.* into link from app_private.transfer_payment_plan_links l join app_private.transfer_payment_plan_acceptances a on a.plan_link_id=l.id and a.source_intent_hash=l.source_intent_hash where l.payment_plan_id=plan.id and l.transfer_id=t.id and l.payer_binding_id=b.id and l.state='accepted' and l.expires_at>now() order by l.created_at desc,l.id limit 1;
  if link.id is null then raise exception 'CONSENT_REQUIRED';end if;select id into acceptance from app_private.transfer_payment_plan_acceptances where plan_link_id=link.id and payer_account_id=b.payer_account_id;
  if acceptance is null then raise exception 'CONSENT_REQUIRED';end if;
  for target in select pt.* from app_private.payment_plan_targets pt where pt.plan_id=plan.id and pt.charge_id=any(p_charge_ids) order by pt.charge_id loop
   if target.receipt_evidence_id<>e.id or target.file_id<>e.file_id or target.checksum_sha256<>e.checksum_sha256 then raise exception 'EVIDENCE_REQUIRED';end if;
   if not coalesce(app_private.payment_verified_account(target.author_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;perform app_private.package_assert_scope(target.author_account_id,target.learner_id,'payments');
   targets:=targets||jsonb_build_array(jsonb_build_object('charge_id',target.charge_id,'learner_id',target.learner_id,'evidence_id',e.id,'plan_target_id',target.id,'authority_ref',target.authority_ref));
  end loop;
  if jsonb_array_length(targets)<>cardinality(p_charge_ids) then raise exception 'CONSENT_REQUIRED';end if;
 end if;
 return jsonb_build_object('case_id',review.id,'receipt_id',r.id,'evidence_version',e.evidence_version,'payer_binding_id',b.id,'payer_account_id',b.payer_account_id,'payment_plan_id',p_payment_plan_id,'payer_intent_acceptance_id',acceptance,'targets',targets);
end $$;
create or replace function app_private.payment_current_plan(p_plan_id uuid) returns app_private.payment_allocation_plans language plpgsql stable security definer set search_path='' as $$
declare plan app_private.payment_allocation_plans%rowtype;r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;target app_private.payment_plan_targets%rowtype;begin
 select * into plan from app_private.payment_allocation_plans where id=p_plan_id;if plan.id is null or plan.state<>'active' then raise exception 'CONSENT_REQUIRED';end if;
 select * into r from app_private.receipts where id=plan.receipt_id;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
 if e.evidence_version<>plan.evidence_version or e.state<>'ready_for_review' then raise exception 'EVIDENCE_REQUIRED';end if;
 if not coalesce(app_private.payment_verified_account(plan.author_account_id),false) then raise exception 'CONSENT_REQUIRED';end if;perform app_private.payment_assert_file(e.file_id,'payment_receipt','charge',e.charge_id,e.uploader_account_id);
 for target in select * from app_private.payment_plan_targets where plan_id=plan.id loop
  if target.receipt_evidence_id<>e.id or target.file_id<>e.file_id or target.checksum_sha256<>e.checksum_sha256 or target.author_account_id<>plan.author_account_id then raise exception 'EVIDENCE_REQUIRED';end if;
  perform app_private.package_assert_scope(target.author_account_id,target.learner_id,'payments');
 end loop;return plan;
end $$;

