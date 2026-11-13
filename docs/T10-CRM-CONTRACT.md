# CRM and scoped export boundary

This is the implementation boundary for T10. Executed results are recorded separately; this document does not attest acceptance completion.

Directories read durable learner/account identities directly. A booking never inserts a second CRM customer or overwrites verified contact data. Customer row grain is one learner, independent of how many guardians or payers relate to that learner. Customer money is never tutor compensation. Customer and tutor exports use separate fixed schemas.

## Read and command ports

All JSON is strict, current-authorized and private/no-store. Pages have `items` and `next_cursor`, limits 1–100. IDs are UUIDs, instants UTC. Exact aggregate integers use a safe integer number or decimal string when outside the JavaScript safe range.

- `list_customers(p_q,p_owner_id,p_has_balance,p_archived=false,p_cursor,p_limit)` returns `CustomerSummary`: learner_id, person_id, account_id, display_name, version, archived, verified_contacts[{channel,destination,verified}], possible_duplicate_count, open_follow_up_count, balance_minor. Admin sees authorized customer records; CS sees only learners attached to a currently owned live review case or assigned open follow-up. No global customer directory for ordinary CS.
- `get_customer(p_learner_id,p_cursor,p_limit)` returns `{customer:CustomerSummary,history_page:Page<CustomerHistory>}`. History is an explicit customer-safe source projection `{event_id,event_type,occurred_at,reference_id,summary}`; it never serializes arbitrary audit or financial payloads.
- `list_crm_sessions(p_from,p_to,p_state,p_tutor_id,p_cursor,p_limit)` returns occurrence-grain session rows `{occurrence_id,title,start_at,end_at,state,format,tutor_id,learner_count,customer_tuition_minor,currency}`. Admin only. Exact source session workspaces retain their existing authorization.
- `list_follow_ups(p_learner_id,p_owner_id,p_state,p_cursor,p_limit)` returns `{follow_up_id,learner_id,learner_name,owner:{account_id,display_name},due_at,reason,channel,state,version,created_at,completed_at}`. States open/completed/cancelled; channels email/phone/whatsapp/portal. Staff scope is checked per row.
- `list_crm_owners()` returns currently authorized owner labels. Admin may select current CS/admin accounts; CS can select self.
- `assign_follow_up(p_learner_id,p_owner_id,p_due_at,p_reason,p_channel,p_expected_version,p_idempotency_key)` uses customer CRM version, creates a named open follow-up and returns C+follow_up_id.
- `complete_follow_up(p_follow_up_id,p_resolution,p_expected_version,p_idempotency_key)` appends the resolution and closes that assigned follow-up; C+state.
- `set_customer_archived(p_learner_id,p_archived,p_reason,p_expected_version,p_idempotency_key)` affects outreach visibility only; preserves all relationships and financial history. C+archived.

Observed family contact claims are separate from verified Auth contacts. `record_customer_contact(p_learner_id,p_channel,p_destination,p_evidence_note,p_expected_version,p_idempotency_key)` accepts email/phone as observed, normalizes it, and creates duplicate candidates without granting identity/guardian authority. It returns C+contact_observation_id. Shared contact candidates do not merge learners. `list_identity_matches(p_learner_id,p_state,p_cursor,p_limit)` is admin-only, with explicit candidate IDs, two learner/person labels, masked contact, pending/distinct/aliased state and version. Any later reviewed alias preserves original learner, account and financial IDs; never grants cross-account authority.

## Export schemas and grain

`request_export(p_kind,p_filters,p_columns,p_as_of,p_idempotency_key)` returns C+export_id/snapshot_at/job_id and HTTP202. Fixed kinds:

| Kind | Authorization | Grain | Allowed columns |
|---|---|---|---|
| own_account | Self/current guardian scope for every selected learner | Enrollment; a learner with no enrollments has one empty booking row | learner_id,display_name,enrollment_id,occurrence_id,start_at,state,customer_charge_minor,allocated_cash_minor,balance_minor,currency |
| own_tutor_statement | Current own tutor identity | Earning | earning_id,occurrence_id,source_type,earned_minor,adjustment_minor,net_earned_minor,settled_minor,reserved_minor,owed_minor,available_minor,currency,effective_at |
| admin_customers | Current admin | Learner | learner_id,account_id,display_name,email,phone,archived,balance_minor,currency |
| admin_sessions | Current admin | Occurrence | occurrence_id,title,start_at,end_at,state,format,tutor_id,learner_count,tuition_total_minor,tutor_fee_minor,currency |
| admin_finance | Current admin | Payment allocation | allocation_id,transfer_id,payer_account_id,charge_id,learner_id,enrollment_id,occurrence_id,amount_minor,reversed_minor,net_allocated_minor,currency,effective_at |

Filters are strict per-kind: own_account allows learner_ids/from/to; own_tutor_statement from/to; admin_customers q/archived; admin_sessions from/to/state/tutor_id; admin_finance from/to/learner_ids. Requested columns must be a nonempty distinct subset of that kind, never raw SQL identifiers. Customer exports cannot request fee/margin/internal notes/destinations. Every own-account export requires booking scope for every requested learner because its row count and date filters have enrollment grain, even with only profile columns selected. Names/learner identifiers additionally require profile scope, and money fields additionally require payments scope. Unknown/unrelated IDs reject the request; they are never silently included through shared contact data.

Materialization uses a repeatable-read RPC transaction, explicitly asserted at runtime, producing immutable ordered `export_rows`. The server records actual snapshot time, requested posting cutoff, requester, exact filters/columns/grain, count and scope. `as_of` is a posting cutoff, not a claim that mutable identity fields have been reconstructed historically. Rows are capped at 10,000 and rendered CSV at 25MiB. A new booking after materialization does not change the export. Administrative occurrence fees are represented once per occurrence, never once per participant. Allocation exports contain no occurrence fee field. Cohort conversion ratios remain T12 source calculations, not averaged row ratios.

`get_export(p_export_id)` returns export_id, kind, state (queued/generating/ready/failed), grain, columns, filters, snapshot_at, as_of, row_count, expires_at, version, can_download, download_path and safe_error_code. `list_my_exports(p_cursor,p_limit)` uses the same shape. Only the original requester with current required role/relationship scope may read/download. Artifacts have a visible 24-hour technical expiry; they are not anonymous bearer URLs.

Worker purpose `exports.render`, event `export_requested`, aggregate export ID, payload exactly `{export_id}`. The worker reads immutable rows through private lease-gated ports, renders a fixed header order, escapes spreadsheet-formula prefixes in text, writes an opaque immutable object in private Storage, verifies exact bytes/hash, and commits the observation. No browser can attest readiness. Download rechecks current session/scope before and after Storage read and records successful and denied authorization attempts. Scope revocation invalidates access to an already generated object without rewriting its snapshot.

PostgREST's documented function setting `SET default_transaction_isolation TO 'repeatable read'` supplies per-RPC isolation: [official transaction reference](https://postgrest.org/en/stable/references/transactions.html). No global role/database isolation setting is changed.

## Implemented additions

`list_customer_contacts(p_learner_id,p_cursor,p_limit)` lists explicitly unverified observations. `review_identity_match(p_match_id,p_decision,p_person_id,p_evidence_note,p_expected_version,p_idempotency_key)` appends a review (`distinct` or `aliased`) with a canonical person drawn from the candidate pair when aliased. It never rewrites original identities or grants access.

Confirmed phone changes arrive only from trusted Supabase Auth row triggers. `crm_verified_phone_versions` preserves every observed Auth phone state, including intermediate unconfirmed states; the customer projection exposes only a currently confirmed latest phone. Observed CRM contact claims cannot attest Auth verification. Existing email-based guardian authority and notification routing remain separate. Live phone verification requires an approved Auth SMS configuration; local tests use expressly confirmed synthetic Auth provider fixtures.

Successful export finalization emits one durable `export_ready` event, using the export UUID as the stable event UUID, payload exactly `{export_id}`, and `notifications.route` purpose. The notification router rechecks requester authority. Customer history is ordered by event time/ID, and export history by creation time/ID. The worker materializes at most 10,000 rows as a single bounded snapshot, so generating later pages never rereads changing source records.
