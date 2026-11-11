create or replace function app_private.finalize_statement_import(p_import_id uuid,p_expected_version integer,p_checksum_sha256 text,p_state text,p_candidates jsonb,p_reason_code text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare imported finance_private.statement_imports%rowtype;run finance_private.statement_import_runs%rowtype;file app_private.files%rowtype;item jsonb;amount bigint;observed timestamptz;business_date date;refs text[]:='{}';t finance_private.incoming_transfers%rowtype;created integer:=0;duplicates integer:=0;digest text;final_result jsonb;begin
 select * into imported from finance_private.statement_imports where id=p_import_id;if imported.id is null then raise exception 'NOT_FOUND';end if;
 perform 1 from finance_private.receiving_accounts where id=imported.receiving_account_id for update;
 select * into imported from finance_private.statement_imports where id=imported.id for update;select * into run from finance_private.statement_import_runs where idempotency_key=p_idempotency_key and import_id=imported.id for update;
 if run.id is null then raise exception 'FORBIDDEN';end if;
 digest:=app_private.catalog_hash(jsonb_build_object('import_id',p_import_id,'expected_version',p_expected_version,'checksum_sha256',p_checksum_sha256,'state',p_state,'candidates',p_candidates,'reason_code',p_reason_code));
 if run.result is not null then if run.request_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT';end if;return run.result;end if;
 if imported.version<>p_expected_version or run.prepared_version<>p_expected_version then raise exception 'VERSION_CONFLICT';end if;
 file:=app_private.payment_assert_file(imported.file_id,'statement','receiving_account',imported.receiving_account_id);
 if p_checksum_sha256 is distinct from file.checksum_sha256 or p_state is null or p_state not in('completed','requires_manual_review','awaiting_file_bytes','failed','unknown') or jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>10000 then raise exception 'VALIDATION_ERROR';end if;
 if p_state='completed' then
  if p_reason_code is not null or file.detected_mime not in('text/csv','application/csv') then raise exception 'VALIDATION_ERROR';end if;
  -- Entire batch first. A malformed direct worker call cannot partially insert candidates.
  for item in select value from jsonb_array_elements(p_candidates) loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['external_id','amount_minor','currency','observed_at']<>'{}'::jsonb or jsonb_typeof(item->'external_id') is distinct from 'string' or length(btrim(item->>'external_id')) not between 1 and 200 or item->>'currency' is distinct from 'EGP' or jsonb_typeof(item->'observed_at') is distinct from 'string' then raise exception 'VALIDATION_ERROR';end if;
   amount:=app_private.package_safe_integer(item->'amount_minor',1);observed:=(item->>'observed_at')::timestamptz;
   if not isfinite(observed) or observed<timestamptz '0001-01-01 00:00:00+00' or observed>=timestamptz '10000-01-01 00:00:00+00' or observed>now() then raise exception 'INVALID_TIME';end if;
   business_date:=(observed at time zone 'Africa/Cairo')::date;if business_date<(imported.statement_period->>'from')::date or business_date>(imported.statement_period->>'to')::date then raise exception 'INVALID_TIME';end if;
   if btrim(item->>'external_id')=any(refs) then raise exception 'DUPLICATE_TRANSFER';end if;refs:=array_append(refs,btrim(item->>'external_id'));
   select * into t from finance_private.incoming_transfers where receiving_account_id=imported.receiving_account_id and channel=imported.channel and external_id=btrim(item->>'external_id');
   if t.id is not null and(t.amount_minor<>amount or t.currency<>item->>'currency' or t.observed_at<>observed) then p_state:='requires_manual_review';p_reason_code:='DUPLICATE_EXTERNAL_ID';exit;end if;
  end loop;
 else
  if jsonb_array_length(p_candidates)<>0 or p_reason_code is null or p_reason_code not in('PDF_REQUIRES_MANUAL_REVIEW','UNSUPPORTED_FILE_TYPE','INPUT_LIMIT_EXCEEDED','INVALID_UTF8','MALFORMED_CSV','HEADER_MISMATCH','INVALID_ROW','OUTSIDE_STATEMENT_PERIOD','DUPLICATE_EXTERNAL_ID','CHECKSUM_MISMATCH','FILE_SIZE_MISMATCH','FILE_BYTES_UNAVAILABLE','FILE_READ_FAILED') then raise exception 'VALIDATION_ERROR';end if;
  if(p_state='awaiting_file_bytes') is distinct from(p_reason_code='FILE_BYTES_UNAVAILABLE') or(p_state='failed') is distinct from(p_reason_code='FILE_READ_FAILED') then raise exception 'VALIDATION_ERROR';end if;
 end if;
 if p_state='completed' then
  for item in select value from jsonb_array_elements(p_candidates) loop
   select * into t from finance_private.incoming_transfers where receiving_account_id=imported.receiving_account_id and channel=imported.channel and external_id=btrim(item->>'external_id');
   if t.id is null then insert into finance_private.incoming_transfers(receiving_account_id,receiving_account_version_id,channel,external_id,amount_minor,currency,observed_at,statement_evidence_file_id,created_by) values(imported.receiving_account_id,imported.receiving_account_version_id,imported.channel,btrim(item->>'external_id'),(item->>'amount_minor')::bigint,'EGP',(item->>'observed_at')::timestamptz,file.id,imported.created_by) returning * into t;created:=created+1;
    insert into finance_private.statement_import_candidates(import_id,run_id,transfer_id,was_duplicate) values(imported.id,run.id,t.id,false);
   else duplicates:=duplicates+1;insert into finance_private.statement_import_candidates(import_id,run_id,transfer_id,was_duplicate) values(imported.id,run.id,t.id,true);end if;
  end loop;
 end if;
 final_result:=jsonb_build_object('state',p_state,'candidate_count',created,'duplicate_count',duplicates);
 update finance_private.statement_imports set state=p_state,accepted_count=created,rejected_count=case when p_state='completed' then 0 else jsonb_array_length(p_candidates) end,failure_code=p_reason_code,version=version+1,updated_at=now() where id=imported.id;
 update finance_private.statement_import_runs set request_hash=digest,result=final_result,completed_at=now() where id=run.id;
 insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,run.id,'statement_import_validated',imported.id,final_result);
 return final_result;
end $$;

