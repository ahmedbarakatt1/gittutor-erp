-- T06 scoped customer and operator reads. No read issues debt, allocates cash or confirms a booking.
grant create on schema api,app_private,finance_private to git_tutor_commands;

create function app_private.payment_file_dto(p_file uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('file_id',id,'purpose',purpose,'checksum_sha256',checksum_sha256,'detected_mime',detected_mime,'byte_size',byte_size,'scan_state',scan_state,'source_provenance',source_provenance,'created_at',created_at,'can_download',false) from app_private.files where id=p_file
$$;
create function app_private.payment_assert_case_read(p_actor uuid,p_case uuid) returns app_private.review_cases language plpgsql stable security definer set search_path='' as $$
declare saved app_private.review_cases%rowtype;begin
 perform app_private.payment_current_staff(p_actor);select * into saved from app_private.review_cases where id=p_case;
 if saved.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if not app_private.has_role(p_actor,'admin') and(saved.owner_id is distinct from p_actor or saved.claim_expires_at is null or saved.claim_expires_at<=now()) then raise exception 'OWNER_REQUIRED';end if;return saved;
end $$;
create function app_private.payment_assert_receipt_read(p_actor uuid,p_receipt uuid) returns app_private.receipts language plpgsql stable security definer set search_path='' as $$
declare saved app_private.receipts%rowtype;begin
 select * into saved from app_private.receipts where id=p_receipt;if saved.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if not app_private.has_role(p_actor,'admin') and not app_private.package_can_access(p_actor,saved.learner_id) then
  perform app_private.payment_assert_case_read(p_actor,(select id from app_private.review_cases where receipt_id=saved.id));
 end if;return saved;
end $$;
create function app_private.payment_receipt_dto(p_receipt uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;c app_private.review_cases%rowtype;v finance_private.receiving_account_versions%rowtype;begin
 select * into r from app_private.receipts where id=p_receipt;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
 select * into c from app_private.review_cases where receipt_id=r.id;select * into v from finance_private.receiving_account_versions where id=e.receiving_account_version_id;
 return jsonb_build_object('receipt_id',r.id,'version',r.version,'learner',(app_private.payment_charge_dto(r.charge_id)->'learner'),'charge_id',r.charge_id,'enrollment_id',r.enrollment_id,'reported_amount_minor',e.reported_amount_minor,'currency',e.currency,'channel',e.channel,'reference',e.reference,'transferred_at',e.transferred_at,
  'receiving_account',jsonb_build_object('receiving_account_id',v.receiving_account_id,'receiving_account_version_id',v.id,'instructions_version',v.instructions_version,'approved_recipient_display',v.collection_identifier),
  'evidence',jsonb_build_object('file_id',e.file_id,'evidence_version',e.evidence_version,'state',e.state,'submitted_at',e.submitted_at,'can_download',false),
  'review',jsonb_build_object('case_id',c.id,'version',c.version,'state',c.state,'owner_display_name',(select p.display_name from app_private.accounts a join app_private.people p on p.id=a.person_id where a.id=c.owner_id),
  'next_action',case c.state when 'needs_information' then 'Provide the requested payment evidence.' when 'resolved' then 'Review the recorded payment and balance.' when 'waiting_for_evidence' then 'Payment evidence is being checked.' when 'escalated' then 'An administrator is reviewing this payment.' else 'Waiting for independent payment review.' end),'created_at',r.created_at);
end $$;
create function app_private.payment_case_dto(p_case uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c app_private.review_cases%rowtype;r app_private.receipts%rowtype;e app_private.receipt_evidence%rowtype;missing jsonb:='[]';begin
 select * into c from app_private.review_cases where id=p_case;select * into r from app_private.receipts where id=c.receipt_id;select * into e from app_private.receipt_evidence where id=r.current_evidence_id;
 if c.owner_id is null or c.claim_expires_at is null or c.claim_expires_at<=now() then missing:=missing||jsonb_build_array('CURRENT_REVIEW_OWNER_REQUIRED');end if;
 if e.state<>'ready_for_review' then missing:=missing||jsonb_build_array('CURRENT_SAFE_EVIDENCE_REQUIRED');end if;
 return jsonb_build_object('case_id',c.id,'version',c.version,'state',c.state,'owner_id',c.owner_id,'owner_display_name',(select p.display_name from app_private.accounts a join app_private.people p on p.id=a.person_id where a.id=c.owner_id),'claim_expires_at',c.claim_expires_at,'learner',app_private.payment_charge_dto(r.charge_id)->'learner','charge_id',r.charge_id,'receipt_id',r.id,'current_evidence_version',c.current_evidence_version,'evidence_state',e.state,'reported_amount_minor',e.reported_amount_minor,'currency',e.currency,'updated_at',c.updated_at,'unmet_prerequisites',missing);
end $$;
create function app_private.payment_plan_read_dto(p_plan uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('payment_plan_id',p.id,'plan_version',p.plan_version,'plan_hash',p.plan_hash,'receipt_id',p.receipt_id,'evidence_version',p.evidence_version,'targets',coalesce((select jsonb_agg(jsonb_build_object('charge_id',t.charge_id,'amount_minor',t.amount_minor,'conditional_amendment_id',t.conditional_amendment_id) order by t.charge_id) from app_private.payment_plan_targets t where t.plan_id=p.id),'[]'::jsonb)) from app_private.payment_allocation_plans p where p.id=p_plan
$$;
create function finance_private.finance_refundable_surplus(p_transfer_id uuid) returns bigint language sql stable security definer set search_path='' as $$
 select case when b->>'reconciliation_state'<>'clear' then 0 else least((b->>'available_minor')::numeric,coalesce((select sum(finance_private.finance_credit_available(l.id)) from finance_private.customer_credit_lots l where l.transfer_id=p_transfer_id and l.origin_kind in('settlement','refund_reversal')),0))::bigint end from(select finance_private.finance_transfer_balance(p_transfer_id) b)x
$$;

create function app_private.payment_read_page(p_kind text,p_filters jsonb,p_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();target uuid:=(p_filters->>'target_id')::uuid;after_at timestamptz;after_id uuid;rows jsonb;source text;projection text;condition text;timecol text:='created_at';sql text;learner uuid;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_cursor is not null then if length(p_cursor)>200 or array_length(string_to_array(p_cursor,'|'),1)<>2 then raise exception 'VALIDATION_ERROR';end if;after_at:=split_part(p_cursor,'|',1)::timestamptz;after_id:=split_part(p_cursor,'|',2)::uuid;if not isfinite(after_at) then raise exception 'VALIDATION_ERROR';end if;end if;
 if p_kind in('cases','incoming','statement_files') then perform app_private.payment_current_staff(actor);end if;
 if p_kind in('candidates','case_files','case_events') then perform app_private.payment_assert_case_read(actor,target);end if;
 if p_kind in('receipt_versions','payment_allocations') then perform app_private.payment_assert_receipt_read(actor,target);end if;
 if p_kind='charges' then
  if target is null then raise exception 'VALIDATION_ERROR';end if;perform app_private.package_assert_scope(actor,target,'payments',true);
  if p_filters->>'state' is not null and p_filters->>'state' not in('unpaid','partially_paid','settled','requires_review') then raise exception 'VALIDATION_ERROR';end if;
  source:='finance_private.charges';projection:='app_private.payment_charge_dto(x.id)';condition:='x.learner_id=$2 and($3->>''state'' is null or $3->>''state''=case when finance_private.finance_charge_balance(x.id)->>''reconciliation_state''=''requires_review'' then ''requires_review'' when(finance_private.finance_charge_balance(x.id)->>''receivable_minor'')::bigint<=0 then ''settled'' when(finance_private.finance_charge_balance(x.id)->>''allocated_cash_minor'')::bigint+(finance_private.finance_charge_balance(x.id)->>''allocated_package_value_minor'')::bigint>0 then ''partially_paid'' else ''unpaid'' end)';
 elsif p_kind='my_receipts' then
  if target is not null then perform app_private.package_assert_scope(actor,target,'payments');end if;
  if(p_filters->>'from' is not null and not isfinite((p_filters->>'from')::timestamptz)) or(p_filters->>'to' is not null and not isfinite((p_filters->>'to')::timestamptz)) or(p_filters->>'from')::timestamptz>(p_filters->>'to')::timestamptz then raise exception 'VALIDATION_ERROR';end if;
  source:='app_private.receipts';projection:='app_private.payment_receipt_dto(x.id)';condition:='app_private.package_can_access($1,x.learner_id) and($2 is null or x.learner_id=$2) and($3->>''from'' is null or x.created_at>=($3->>''from'')::timestamptz) and($3->>''to'' is null or x.created_at<=($3->>''to'')::timestamptz)';
 elsif p_kind='my_transfers' then
  source:='finance_private.incoming_transfers';projection:='app_private.payment_transfer_dto(x.id,$1,false)';condition:='exists(select 1 from finance_private.transfer_payer_bindings b where b.id=x.current_payer_binding_id and b.payer_account_id=$1)';
 elsif p_kind='incoming' then
  if p_filters->>'state' is not null and p_filters->>'state' not in('pending','settled','reversed') or p_filters->>'payer_state' is not null and p_filters->>'payer_state' not in('unbound','bound') then raise exception 'VALIDATION_ERROR';end if;
  source:='finance_private.incoming_transfers';projection:='app_private.payment_transfer_dto(x.id,$1,true)';condition:='($3->>''state'' is null or x.state=$3->>''state'') and($3->>''payer_state'' is null or($3->>''payer_state''=''unbound'')=(x.current_payer_binding_id is null))';
 elsif p_kind='cases' then
  if p_filters->>'state' is not null and p_filters->>'state' not in('waiting_for_evidence','unassigned','claimed','needs_information','escalated','resolved') then raise exception 'VALIDATION_ERROR';end if;
  if p_filters->>'updated_after' is not null and not isfinite((p_filters->>'updated_after')::timestamptz) then raise exception 'VALIDATION_ERROR';end if;
  source:='app_private.review_cases';timecol:='updated_at';projection:='app_private.payment_case_dto(x.id)';condition:='($3->>''state'' is null or x.state=$3->>''state'') and($3->>''owner_id'' is null or x.owner_id=($3->>''owner_id'')::uuid) and($3->>''updated_after'' is null or x.updated_at>($3->>''updated_after'')::timestamptz)';
 elsif p_kind='candidates' then
  source:='finance_private.incoming_transfers';projection:='app_private.payment_transfer_dto(x.id,$1,true)';condition:='x.state in(''pending'',''settled'') and exists(select 1 from app_private.review_cases c join app_private.receipts r on r.id=c.receipt_id join app_private.receipt_evidence e on e.id=r.current_evidence_id where c.id=$2 and x.receiving_account_version_id=e.receiving_account_version_id and x.channel=e.channel and x.currency=e.currency)';
 elsif p_kind='receipt_files' then
  select learner_id into learner from finance_private.charges where id=target;if learner is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,learner,'payments');
  source:='app_private.files';projection:='app_private.payment_file_dto(x.id)';condition:='x.parent_type=''charge'' and x.parent_id=$2 and x.charge_id=$2 and x.purpose=''payment_receipt'' and x.uploader_account_id=$1 and x.scan_state=''clean'' and x.byte_size<=5242880 and x.detected_mime in(''application/pdf'',''image/png'',''image/jpeg'',''image/webp'')';
 elsif p_kind='statement_files' then
  source:='app_private.files';projection:='app_private.payment_file_dto(x.id)';condition:='x.parent_type=''receiving_account'' and x.purpose=''statement'' and x.scan_state=''clean'' and($2 is null or x.parent_id=$2)';
 elsif p_kind='receipt_versions' then
  source:='app_private.receipt_evidence';timecol:='submitted_at';projection:='jsonb_build_object(''receipt_id'',x.receipt_id,''evidence_version'',x.evidence_version,''is_current'',x.id=(select current_evidence_id from app_private.receipts where id=x.receipt_id),''state'',x.state,''submitted_at'',x.submitted_at,''file'',app_private.payment_file_dto(x.file_id))';condition:='x.receipt_id=$2';
 elsif p_kind='case_files' then
  source:='app_private.receipt_evidence';timecol:='submitted_at';projection:='app_private.payment_file_dto(x.file_id)';condition:='x.receipt_id=(select receipt_id from app_private.review_cases where id=$2)';
 elsif p_kind='case_events' then
  source:='app_private.review_case_events';timecol:='recorded_at';projection:='jsonb_build_object(''event_id'',x.id,''event_type'',x.event_type,''recorded_at'',x.recorded_at,''reason'',x.reason)';condition:='x.case_id=$2';
 elsif p_kind='payment_allocations' then
  source:='finance_private.payment_allocations';timecol:='recorded_at';projection:='jsonb_build_object(''allocation_id'',x.id,''charge_id'',x.charge_id,''amount_minor'',x.amount_minor,''reversed_minor'',coalesce((select sum(a.amount_minor) from finance_private.allocation_reversals a where a.allocation_id=x.id),0),''created_at'',x.recorded_at)';condition:='x.receipt_id=$2 and exists(select 1 from finance_private.charges c where c.id=x.charge_id and(app_private.has_role($1,''admin'') or app_private.package_can_access($1,c.learner_id)))';
 elsif p_kind='transfer_allocations' then
  perform app_private.require_role(actor,'admin');if not exists(select 1 from finance_private.incoming_transfers where id=target) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  source:='finance_private.payment_allocations';timecol:='recorded_at';projection:='jsonb_build_object(''allocation_id'',x.id,''charge_id'',x.charge_id,''receipt_id'',x.receipt_id,''title'',app_private.payment_charge_dto(x.charge_id)->>''title'',''learner'',app_private.payment_charge_dto(x.charge_id)->''learner'',''active_minor'',x.amount_minor-coalesce((select sum(a.amount_minor) from finance_private.allocation_reversals a where a.allocation_id=x.id),0))';condition:='x.transfer_id=$2 and x.amount_minor>coalesce((select sum(a.amount_minor) from finance_private.allocation_reversals a where a.allocation_id=x.id),0)';
 else raise exception 'VALIDATION_ERROR';end if;
 sql:=format('select coalesce(jsonb_agg(jsonb_build_object(''id'',x.id,''at'',x.%1$I,''data'',%2$s) order by x.%1$I desc,x.id desc),''[]''::jsonb) from(select x.* from %3$s x where %4$s and($4 is null or(x.%1$I,x.id)<($4,$5)) order by x.%1$I desc,x.id desc limit $6)x',timecol,projection,source,condition);
 execute sql into rows using actor,target,p_filters,after_at,after_id,p_limit+1;return app_private.package_page(rows,p_limit);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';end $$;

create function api.list_payment_learners(p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.package_read('learners','{}',p_cursor,p_limit) $$;
create function api.list_my_charges(p_learner_id uuid,p_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('charges',jsonb_build_object('target_id',p_learner_id,'state',p_state),p_cursor,p_limit) $$;
create function api.list_my_payments(p_learner_id uuid default null,p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('my_receipts',jsonb_build_object('target_id',p_learner_id,'from',p_from,'to',p_to),p_cursor,p_limit) $$;
create function api.list_my_transfers(p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('my_transfers','{}',p_cursor,p_limit) $$;
create function api.list_incoming_transfers(p_state text default null,p_payer_state text default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('incoming',jsonb_build_object('state',p_state,'payer_state',p_payer_state),p_cursor,p_limit) $$;
create function api.list_review_cases(p_state text default null,p_owner_id uuid default null,p_updated_after timestamptz default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('cases',jsonb_build_object('state',p_state,'owner_id',p_owner_id,'updated_after',p_updated_after),p_cursor,p_limit) $$;
create function api.list_transfer_candidates(p_case_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('candidates',jsonb_build_object('target_id',p_case_id),p_cursor,p_limit) $$;
create function api.list_receipt_files(p_charge_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('receipt_files',jsonb_build_object('target_id',p_charge_id),p_cursor,p_limit) $$;
create function api.list_statement_evidence(p_receiving_account_id uuid default null,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('statement_files',jsonb_build_object('target_id',p_receiving_account_id),p_cursor,p_limit) $$;
create function api.list_receipt_versions(p_receipt_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('receipt_versions',jsonb_build_object('target_id',p_receipt_id),p_cursor,p_limit) $$;
create function api.list_transfer_allocations(p_transfer_id uuid,p_cursor text default null,p_limit integer default 25) returns jsonb language sql security definer set search_path='' as $$ select app_private.payment_read_page('transfer_allocations',jsonb_build_object('target_id',p_transfer_id),p_cursor,p_limit) $$;

create function api.get_payment_instructions(p_charge_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();c finance_private.charges%rowtype;charge jsonb;funding jsonb;confirmation jsonb;channels jsonb;quote uuid;policy uuid;occurrence uuid;required bigint;additional bigint;begin
 select * into c from finance_private.charges where id=p_charge_id;if c.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,c.learner_id,'payments',true);charge:=app_private.payment_charge_dto(c.id);
 if c.enrollment_id is null then required:=greatest(0,(charge->>'net_minor')::bigint);additional:=greatest(0,(charge->>'balance_minor')::bigint);confirmation:=jsonb_build_object('state','not_applicable','occurrence_id',null,'reason',null);
 else
  quote:=(charge->>'funding_quote_id')::uuid;select policy_version_id into policy from app_private.quotes where id=quote;select occurrence_id into occurrence from app_private.enrollments where id=c.enrollment_id;
  funding:=app_private.booking_funding_status(c.enrollment_id,quote,policy);required:=(funding->>'required_for_confirmation_minor')::bigint;additional:=(funding->>'additional_required_minor')::bigint;
  confirmation:=app_private.booking_confirmation_status(occurrence);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('channel',a.channel,'receiving_account_id',a.id,'receiving_account_version_id',v.id,'instructions_version',v.instructions_version,'approved_recipient_display',v.collection_identifier,'collection_identifier',v.collection_identifier,'display_instructions',v.display_instructions) order by a.channel,a.created_at,a.id),'[]') into channels from finance_private.receiving_accounts a join finance_private.receiving_account_versions v on v.id=a.current_version_id where a.enabled and v.approved_at is not null and charge->>'commitment_state'<>'resolution_required';
 return jsonb_build_object('charge',charge,'required_for_confirmation_minor',required,'additional_required_minor',additional,'channels',channels,'confirmation',confirmation);
end $$;
create function api.get_review_case_charge(p_case_id uuid,p_charge_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();c app_private.review_cases%rowtype;r app_private.receipts%rowtype;begin
 c:=app_private.payment_assert_case_read(actor,p_case_id);select * into r from app_private.receipts where id=c.receipt_id;
 if r.charge_id<>p_charge_id and not exists(select 1 from app_private.payment_allocation_plans p join app_private.payment_plan_targets t on t.plan_id=p.id where p.receipt_id=r.id and p.evidence_version=r.current_evidence_version and p.state='active' and t.charge_id=p_charge_id and t.receipt_evidence_id=r.current_evidence_id and app_private.payment_verified_account(t.author_account_id) and app_private.package_can_access(t.author_account_id,t.learner_id)) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 return app_private.payment_charge_dto(p_charge_id);
end $$;
create function api.get_review_case(p_case_id uuid,p_evidence_cursor text default null,p_event_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();c app_private.review_cases%rowtype;r app_private.receipts%rowtype;plan uuid;begin
 c:=app_private.payment_assert_case_read(actor,p_case_id);select * into r from app_private.receipts where id=c.receipt_id;
 select id into plan from app_private.payment_allocation_plans where receipt_id=r.id and evidence_version=r.current_evidence_version and state='active' order by plan_version desc limit 1;
 return jsonb_build_object('case',app_private.payment_case_dto(c.id),'receipt',app_private.payment_receipt_dto(r.id),'charge',app_private.payment_charge_dto(r.charge_id),
 'evidence_files',app_private.payment_read_page('case_files',jsonb_build_object('target_id',c.id),p_evidence_cursor,p_limit),'candidate_transfers',api.list_transfer_candidates(c.id,null,p_limit),'payment_plan',app_private.payment_plan_read_dto(plan),'review_events',app_private.payment_read_page('case_events',jsonb_build_object('target_id',c.id),p_event_cursor,p_limit));
end $$;
create function api.lookup_transfer_payer(p_transfer_id uuid,p_contact_channel text,p_exact_contact text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();items jsonb;destination text;begin
 perform app_private.payment_current_staff(actor);if not exists(select 1 from finance_private.incoming_transfers where id=p_transfer_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if p_exact_contact is null or length(p_exact_contact) not between 1 and 320 or p_exact_contact<>btrim(p_exact_contact) then raise exception 'VALIDATION_ERROR';end if;
 if p_contact_channel='email' then if p_exact_contact!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_ERROR';end if;destination:=lower(p_exact_contact);
 elsif p_contact_channel='phone' then if p_exact_contact!~'^\+[1-9][0-9]{6,14}$' then raise exception 'VALIDATION_ERROR';end if;destination:=p_exact_contact;else raise exception 'VALIDATION_ERROR';end if;
 select coalesce(jsonb_agg(app_private.payment_payer_dto(x.account_id) order by x.account_id),'[]') into items from(select distinct c.account_id from app_private.verified_contacts c where c.channel=p_contact_channel and c.destination=destination and c.verified_at is not null and c.revoked_at is null and app_private.payment_verified_account(c.account_id) order by c.account_id limit 10)x;
 return jsonb_build_object('items',items);
end $$;

-- Refunded source pages are supplied by the refund domain. The fail-closed bridge prevents silently dropping future records.
create function app_private.payment_source_refunds_page(p_actor uuid,p_source_type text,p_source_id uuid,p_cursor text,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 100 or(p_cursor is not null and length(p_cursor)>200) then raise exception 'VALIDATION_ERROR';end if;
 if to_regclass('finance_private.refunds') is not null then raise exception 'DEPENDENCY_UNAVAILABLE';end if;
 return jsonb_build_object('items','[]'::jsonb,'next_cursor',null);
end $$;
create function api.get_my_payment(p_payment_id uuid,p_allocation_cursor text default null,p_refund_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();r app_private.receipts%rowtype;transfer uuid;credit jsonb;balance jsonb;begin
 select * into r from app_private.receipts where id=p_payment_id;if r.id is null then raise exception 'NOT_FOUND' using errcode='P0002';end if;perform app_private.package_assert_scope(actor,r.learner_id,'payments',true);
 select case when count(distinct a.transfer_id)=1 then (array_agg(distinct a.transfer_id))[1] else null end into transfer from finance_private.payment_allocations a join finance_private.transfer_payer_bindings b on b.id=a.payer_binding_id where a.receipt_id=r.id and b.payer_account_id=actor;
 if transfer is not null then balance:=finance_private.finance_transfer_balance(transfer);credit:=jsonb_build_object('source_type','unapplied_credit','source_id',transfer,'available_minor',balance->'available_minor','refund_reserved_minor',balance->'refund_reserved_minor','refundable_minor',finance_private.finance_refundable_surplus(transfer));end if;
 return jsonb_build_object('view','learner','receipt',app_private.payment_receipt_dto(r.id),'charge',app_private.payment_charge_dto(r.charge_id),'matched_transfer',case when transfer is null then null else app_private.payment_transfer_dto(transfer,actor,false) end,'allocation_page',app_private.payment_read_page('payment_allocations',jsonb_build_object('target_id',r.id),p_allocation_cursor,p_limit),'credit',credit,'refund_page',app_private.payment_source_refunds_page(actor,'charge',r.charge_id,p_refund_cursor,p_limit));
end $$;
create or replace function api.get_my_transfer(p_transfer_id uuid,p_refund_cursor text default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();b jsonb;begin
 b:=finance_private.finance_transfer_balance(p_transfer_id);if (b->>'payer_account_id')::uuid is distinct from actor then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 return jsonb_build_object('view','payer_only','transfer',app_private.payment_transfer_dto(p_transfer_id,actor,false),'credit',jsonb_build_object('source_type','unapplied_credit','source_id',p_transfer_id,'available_minor',b->'available_minor','refund_reserved_minor',b->'refund_reserved_minor','refundable_minor',finance_private.finance_refundable_surplus(p_transfer_id)),'refund_page',app_private.payment_source_refunds_page(actor,'unapplied_credit',p_transfer_id,p_refund_cursor,p_limit));
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure::text signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='finance_private' and p.proname='finance_refundable_surplus') or(n.nspname='app_private' and p.proname in('payment_file_dto','payment_assert_case_read','payment_assert_receipt_read','payment_receipt_dto','payment_case_dto','payment_plan_read_dto','payment_read_page','payment_source_refunds_page')) or(n.nspname='api' and p.proname in('list_payment_learners','list_my_charges','list_my_payments','list_my_transfers','list_incoming_transfers','list_review_cases','list_transfer_candidates','list_receipt_files','list_statement_evidence','list_receipt_versions','list_transfer_allocations','get_payment_instructions','get_review_case_charge','get_review_case','lookup_transfer_payer','get_my_payment','get_my_transfer')) loop
  execute format('alter function %s owner to git_tutor_commands',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role,git_tutor_worker',f.signature);if f.nspname='api' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke create on schema api,app_private,finance_private from git_tutor_commands;
