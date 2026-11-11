# API contracts

## Transport and authorization

Implements R01–R18. Base path is `/api/v1`. JSON uses `snake_case`. IDs are UUIDs, `_minor` amounts and `_credit_quanta` quantities are safe integers, and timestamps are RFC 3339 instants. Reject unknown body fields with `VALIDATION_ERROR`. Queries accept only the listed filters. Page reads use `cursor` and `limit` from 1 through 100, with stable `(sort_value, id)` ordering.

Every business mutation requires `Idempotency-Key`. Versioned changes require `expected_version`. The RPC computes the accepted-argument hash and derives the actor through `auth.uid()`. Path IDs enter the hash. No input accepts actor, staff role, approved fee, settlement status or verification assertions outside its specifically authorized command. Current authorization precedes replaying a saved result.

Approval actor/time, authorship, environment scope and synthetic provenance are server-owned metadata. Policy and pricing `content` accepts only the typed editable commercial fields. Draft creation sets its own state. Publishing derives approval identity from the authenticated command and rejects attempts to rewrite a synthetic record's provenance.

Responses contain `data` and `request_id`. Mutation result `C` below means `command_id`, `resource_id`, `version`, plus the listed fields. Collection results contain `items` and `next_cursor`. Errors contain `code`, `message`, `request_id`, and optional `field_errors`. Private failures use scoped `NOT_FOUND` where disclosing existence would exceed access. All authenticated routes return private, no-store responses.

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `AMOUNT_OUT_OF_RANGE`, `INVALID_TIME` |
| 401 | `AUTH_REQUIRED`, `SESSION_REVOKED`, `VERIFIED_ACCOUNT_REQUIRED` |
| 403 | `FORBIDDEN`, `CONSENT_REQUIRED`, `OWNER_REQUIRED` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CAPACITY_CONFLICT`, `SCHEDULE_CONFLICT`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_ENTITLEMENT`, `POLICY_INCOMPLETE`, `STATE_CONFLICT`, `EVIDENCE_REQUIRED`, `TRANSFER_UNSETTLED`, `DUPLICATE_TRANSFER`, `REMEDY_RESERVED`, `DESTINATION_UNVERIFIED`, `HISTORY_UNKNOWN` |
| 422 | `FILE_REJECTED`, `WINDOW_CLOSED`, `TEMPLATE_REQUIRED` |
| 429/503 | `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `RETRYABLE_CONFLICT` |

Use 201 for creation, 200 for committed changes or replay, and 202 for durable queued work. Provider webhooks authenticate the provider and deduplicate its event ID. Upload byte streams use their previously created file ID and current account authorization.

`A` means current admin, `CS` current customer service, `T` a current tutor account with the required resource assignment, `L` the learner or guardian with current requested scope, and `U` any verified non-anonymous account. Tutor profile and statement reads use the account's own tutor identity. Historical financial ownership follows the immutable agreement or earning. Teaching-file access follows current assignment. `V` means an anonymous Auth account limited to its own website conversation. Every scope is checked inside its RPC.

## Read allowlists

| GET route | RPC and scope | Allowed filters and returned fields |
|---|---|---|
| `/public/offers` | `list_public_offers`, public | `subject_id, format, from, to`. Offer ID, title, subject, format, approved duration, public price/currency, availability, policy summary/version |
| `/public/tutors/{id}` | `get_public_tutor`, public | Tutor ID, approved display name, subjects, bio, approved photo reference |
| `/me` | `get_my_account`, U/V | Account ID, verified status, own current roles, locale, authorized learner IDs. V receives only guest status |
| `/me/enrollments` | `list_my_enrollments`, L | `learner_id,from,to,state`. Authorized own/linked learner seats and customer booking DTOs |
| `/me/packages` | `list_my_packages`, L | `learner_id`. Contract, coverage rule, expiry, available/reserved/consumed credit-quanta and own carrying-value statement |
| `/packages/{id}` | `get_my_package`, L/A | Contract, authorized learner, movements, coverage allocations and renewal lineage |
| `/me/payments` | `list_my_payments`, L | `learner_id,from,to`. Own submitted receipts, allocations, customer credits and refund states |
| `/payments/{id}` | `get_my_payment`, L/A/CS case scope | Own amount/currency, reference, review outcome, allocation IDs and scoped evidence IDs |
| `/charges/{id}/payment-instructions` | `get_payment_instructions`, authorized charge payer/L | Enabled channel, approved collection identifier, receiving-account version, currency, amount due, funding threshold and transfer guidance |
| `/enrollments/{id}` | `get_enrollment`, L/A/CS case scope | Own learner, occurrence summary, quote, net customer charge, allocated funding, balance, entitlement coverage, state, meeting status, authorized file IDs |
| `/quotes/{id}` | `get_quote`, L/A | Own price, currency, expiry, customer policy summary, terms hash and version |
| `/amendments/{id}` | `get_group_amendment`, affected L/T/A | L sees own revised charge/terms, T sees own exact fee/teaching terms, A sees the authorized full proposal |
| `/operation-proposals/{id}` | `get_operation_proposal`, affected L/T/A | Own permitted terms, base/policy version, terms hash, expiry, required actions and current acceptance state |
| `/tutor/profile` | `get_tutor_profile`, T | Own draft/approved public fields, own verified contact status and configured payout methods |
| `/tutor/availability` | `get_tutor_availability`, T | Own weekly intervals, dated exceptions and committed occurrence IDs |
| `/tutor/fee-agreements` | `list_tutor_fee_agreements`, T | `from,to`. Own exact fee/currency/duration, policy version, acceptance and occurrence IDs |
| `/tutor/occurrences` | `list_tutor_occurrences`, T | `from,to,state`. Assigned occurrence, own roster names/IDs, preparation scopes, schedule, attendance status |
| `/tutor/statement` | `get_tutor_statement`, T | `from,to,as_of`. Own earned/adjusted/settled/owed/reserved/available amounts and linked entries |
| `/review-cases` | `list_review_cases`, CS/A | `state,owner_id,updated_after`. Case, authorized payer/learner, evidence and matching status |
| `/customers` | `list_customers`, CS case scope/A | `q,owner_id,has_balance`. Account/learner, verified contact status, scoped follow-up and customer balance |
| `/occurrences` | `list_admin_occurrences`, A | `from,to,state,format,tutor_id`. Authorized occurrence, roster, funding, meeting and closeout summaries |
| `/tutors` | `list_admin_tutors`, A | `subject_id,active`. Profile approval, application, verified contact and availability summaries |
| `/policies` | `list_policies`, A | `kind,scope,status`. Draft/published version, validated content, approval and effective interval |
| `/pricing-versions` | `list_pricing_versions`, A | `format,status`. Customer tariffs and separately privileged compensation contracts |
| `/conversations` | `list_my_conversations`, U/V | `channel,state`. Own thread ID, topic, state and latest permitted message summary |
| `/conversations/{id}` | `get_conversation`, owner U/V or assigned CS/A | Public transcript, channel/window and state. Private notes included only for authorized staff |
| `/service/conversations` | `list_service_conversations`, CS/A | `state,owner_id,channel`. Authorized inbox queue, assignment, wait age and next action |
| `/finance/summary` | `get_finance_summary`, A | `from,to,as_of`. Reconciled cash, revenue, expenses, obligations and source-entry IDs |
| `/jobs/{id}` | `get_job_status`, requester/authorized owner | Job state, safe last error, attempt count, next action |
| `/analytics/cohorts` | `get_cohort_report`, A | `from,to,campaign_id,source,format,subject_id,policy_version`. Cohort counts, unknown history, spend coverage, maturity and drilldown IDs |
| `/analytics/workload` | `get_workload_report`, A/CS scoped | `from,to`. Owned/open queues, elapsed and staffed response times, tutor capacity |

Customer/public DTOs exclude tutor fees/ranges, margin, payout destinations, internal notes, provider tokens and other learners' private records. Tutor DTOs expose only that tutor's compensation. Queries declare monetary and person-count grain. A named-entitlement response reports service quanta satisfied independently of carrying value and any explicitly accepted top-up.

## Identity, catalog and booking commands

### T02 onboarding read additions

The onboarding commands require verified contact, subject and current relationship identities. The implementation adds authenticated, allowlisted reads so the UI can supply existing contract inputs and version checks without exposing unrelated records or requiring users to enter concurrency versions:

- `GET /me/contacts` → `api.get_my_verified_contacts()`: own verified contacts only; `items[{contact_id,channel,masked_destination,verified}]`, `next_cursor:null`. A contact reference can be shared with a learner for an invitation; it grants no authority without recipient acceptance.
- `GET /me/application-subjects` → `api.list_application_subjects()`: verified non-anonymous accounts only; `items[{subject_id,title}]`, `next_cursor:null`. Minimal validated subject records support tutor onboarding; T03 owns the public catalog projection. No additional anonymous RPC grant is introduced.
- `GET /tutor-applications` → `api.get_tutor_applications(cursor,limit)`: the applicant's own records, or pending records for a current admin; fields are application/applicant IDs, submitted display name/bio/subject IDs, state, version and creation time.
- `GET /staff-invitations` → `api.list_staff_invitations(cursor,limit)`: current admin only; invitation ID, masked email, role, business/delivery states, version, creation time and safe delivery error code. Both queues have stable `(created_at,id)` pagination, default 25 and maximum 100.
- `GET /me/guardian-links` → `api.get_my_guardian_links(cursor,limit)`: active links for the actor's own learner or where the actor is the guardian; `guardian_link_id,learner_id,learner_name,guardian_masked_contact,scopes,version,can_revoke`. The own-learner side can revoke; unrelated links are absent. Current versions populate the command automatically.
- `GET /staff-role-grants` → `api.list_staff_role_grants(cursor,limit)`: current admin only; active `role_grant_id,account_id,display_name,masked_email,role,version`. These relationship lists use stable `(created_at,id)` pagination, default 25 and maximum 100. Neither list returns full contact destinations or internal notes.

Prospective staff invitations extend the existing-account role-grant command with `POST /staff-invitations` (`email,role,reason,expires_at`, admin) and `POST /staff-invitations/{id}/accept` (`expected_version`, verified intended recipient). Creation commits its audit and outbox before the worker invokes Supabase Auth. Auth owns its single-use email token; delivery and explicit acceptance do not trust client metadata for privileges. Acceptance rechecks the exact verified recipient, delivered Auth identity, invitation state/expiry and currently active approving admin before the role grant. Existing accounts use the original role-grant command. The invitation worker reconciles uncertain dispatch before attempting another email.

Authentication transport lives at `/api/auth/login`, `/signup`, `/logout` and `/password`; it uses verified Supabase sessions and strict input fields, cookie-origin protection, private responses and server-owned redirects. The password endpoint is for a currently verified account (including first-time invited staff). These Auth token operations are separate from business-command idempotency; Supabase owns their token lifecycle. `/auth/callback` accepts only known email verification types or PKCE authorization codes and never accepts an arbitrary destination URL.

Each POST maps to the named `api` RPC. Required common headers and version fields above apply.

| POST route | RPC and scope | Input allowlist beyond path/version | Result beyond C |
|---|---|---|---|
| `/guardian-invitations` | `create_guardian_invitation`, learner | `contact_id,scopes,expires_at` | `invitation_id,expires_at` |
| `/guardian-invitations/{id}/accept` | `accept_guardian_invitation`, U | `single_use_token` | `guardian_link_id,scopes` |
| `/guardian-links/{id}/revoke` | `revoke_guardian_link`, learner/A | `reason` | `revoked_at` |
| `/staff-role-grants` | `grant_staff_role`, A | `account_id,role,reason` | `role_grant_id` |
| `/staff-role-grants/{id}/revoke` | `revoke_staff_role`, A | `reason` | `revoked_at` |
| `/tutor-applications` | `submit_tutor_application`, U | `display_name,subject_ids,bio,contact_id` | `application_id` |
| `/tutor-applications/{id}/review` | `review_tutor_application`, A | `decision,reason,approved_subject_ids` | `tutor_id,decision` |
| `/tutor/profile` | `update_tutor_profile`, T | `display_name,bio,subject_ids,contact_id,locale` | `review_required_fields` |
| `/tutor-profiles/{id}/approve` | `approve_tutor_profile`, A | `profile_version_id,decision,reason` | `approved_profile_version_id` |
| `/policies` | `create_policy_draft`, A | `kind,scope,content` against the policy-settings schema | `policy_version_id,validation_errors` |
| `/policies/{id}/update` | `update_policy_draft`, A | `content` against the policy-settings schema | `validation_errors` |
| `/policies/{id}/approve` | `approve_policy_version`, A | `effective_at,approval_note` | `policy_version_id,approved_at` |
| `/pricing-versions` | `create_pricing_draft`, A | `scope,customer_pricing,compensation` against the pricing-policy schema | `pricing_version_id,validation_errors` |
| `/pricing-versions/{id}/update` | `update_pricing_draft`, A | `customer_pricing,compensation` against their schemas | `validation_errors` |
| `/pricing-versions/{id}/approve` | `approve_pricing_version`, A | `effective_at,approval_note` | `pricing_version_id,approved_at` |
| `/offers` | `create_offer`, A | `subject_id,format,duration_minutes,capacity,target_tier,pricing_version_id,policy_version_id` | `offer_id` |
| `/offers/{id}/publish` | `publish_offer`, A | `effective_at` | `published_at` |
| `/availability` | `set_availability`, T/A | `tutor_id,weekly_intervals,dated_exceptions,reason` | `conflicting_occurrence_ids` only within actor scope |
| `/occurrences` | `create_occurrence`, A | `offer_id,tutor_id,start_at,end_at,time_zone,target_tier` | `occurrence_id,state` |
| `/occurrences/{id}/holds` | `reserve_enrollment`, L | `learner_id` | `enrollment_id,hold_expires_at,quote_id,customer_price_minor,currency` |
| `/quotes/{id}/accept` | `accept_quote`, L | `quote_hash` | `accepted_at` |
| `/occurrences/{id}/confirm` | `confirm_occurrence`, A | none | `state,confirmed_enrollment_ids,meeting_status` |
| `/occurrences/{id}/amendments` | `propose_group_amendment`, A | `add_learner_ids,remove_enrollment_ids,target_tier,fee_agreement_id,expires_at,reason` | `amendment_id,affected_quote_ids` |
| `/amendments/{id}/accept` | `accept_group_amendment`, affected L/T | `terms_hash` | `accepted_at` |
| `/amendments/{id}/commit` | `commit_group_amendment`, A | none | `occurrence_version,charge_adjustment_ids` |
| `/enrollments/{id}/cancel` | `cancel_enrollment`, L/A | `reason,remedy_proposal_id` | `state,remedy_id` |
| `/occurrences/{id}/reschedule` | `reschedule_occurrence`, A | `start_at,end_at,time_zone,reason,accepted_proposal_id` | `meeting_status,calendar_job_id` |
| `/occurrences/{id}/cancel` | `cancel_occurrence`, A | `reason,remedy_proposal_id` | `state,affected_enrollment_ids` |
| `/operation-proposals` | `create_operation_proposal`, authorized affected L/T/A | `kind,target_id,requested_terms,reason` using a kind-specific schema | `proposal_id,terms_hash,expires_at,required_actions` |
| `/operation-proposals/{id}/accept` | `accept_operation_proposal`, affected L/T | `terms_hash` | `accepted_at` |
| `/operation-proposals/{id}/approve` | `approve_operation_proposal`, A | `terms_hash,decision,reason` | `approval_id,state` |

Application review creates a separately audited tutor-role grant. Contact changes require verification before activation. Availability updates reject conflicts with committed meetings. Confirmation rechecks capacity, quotes, funding, package coverage, exact approved fee and tutor availability atomically. Amendment commit requires current affected-party acceptances and posts all financial effects in the same transaction. T04–T06 verifies these funded paths together.

Proposal kinds are `reschedule`, `cancellation_remedy`, `package_coverage` and `package_conversion`. Bind each record to its target aggregate/version, policy version, immutable typed terms, scoped terms hashes, expiry and required parties. Customers see only their own charge, time and entitlement consequences. Tutors see their own teaching and fee consequences. The existing cancel, reschedule, reserve or renew command consumes the accepted current proposal and marks it committed in the same transaction as its effects.

Rescheduling and incompatible package conversion require the affected parties' current acceptance under the saved policy. Reviewed financial remedies and exceptions require admin approval. Routine package coverage or a fully determined cancellation rule may be derived internally from already accepted quote/package/policy versions, recording those acceptance references and the exact calculated outcome. Changed customer terms require explicit fresh acceptance. A stale, expired or declined proposal cannot authorize a mutation.

## Packages, payments and refunds

| POST route | RPC and scope | Input allowlist | Result beyond C |
|---|---|---|---|
| `/packages` | `purchase_package`, L | `learner_id,package_contract_version_id,accepted_terms_hash` | `package_purchase_id,charge_id` |
| `/packages/{id}/complimentary-grants` | `approve_package_grant`, A | `credit_quanta,carrying_value_minor,currency,grant_kind,source_credit_id,reason,evidence_file_id` | `lot_id,grant_movement_id` |
| `/packages/{id}/reserve` | `reserve_package_credit`, L | `enrollment_id,credit_quanta,coverage_proposal_id` | `reservation_id,reserved_credit_quanta,carrying_value_minor,top_up_minor` |
| `/packages/{id}/renew` | `renew_package`, L/A | `new_contract_version_id,transfer_credit_quanta,accepted_terms_hash,conversion_proposal_id` | `successor_package_id,transfer_ids,charge_id` |
| `/package-consumptions/{id}/restore` | `restore_package_credit`, A | `credit_quanta,remedy_id,reason` | `movement_id,restored_credit_quanta` |
| `/receipts` | `submit_receipt`, L | `enrollment_id,charge_id,file_id,channel,transferred_amount_minor,currency,reference` | `receipt_id,case_id,evidence_state` |
| `/receipts/{id}/replace` | `replace_receipt`, L | `file_id,reason` | `new_evidence_version,case_id` |
| `/review-cases/{id}/claim` | `claim_review_case`, CS/A | none | `owner_id,state` |
| `/review-cases/{id}/release` | `release_review_case`, owning CS/A | `reason` | `state` |
| `/review-cases/{id}/assign` | `assign_review_case`, A | `owner_id,reason` | `owner_id,state` |
| `/review-cases/{id}/decision` | `decide_review_case`, owning CS/A | `decision,reason` | `state` |
| `/statement-imports` | `create_statement_import`, CS/A | `file_id,receiving_account_id,channel,statement_period` | `import_id,validation_job_id` |
| `/receiving-accounts` | `create_receiving_account`, A | `channel,collection_identifier,display_instructions,ownership_evidence_file_id` | `receiving_account_id,version` |
| `/receiving-accounts/{id}/approve` | `approve_receiving_account`, A | `enabled,verification_note` | `verified_at,instructions_version` |
| `/transfers` | `record_manual_transfer`, authorized CS/A | `receiving_account_id,channel,external_id,amount_minor,currency,observed_at,statement_evidence_file_id` | `transfer_id,state` |
| `/transfers/{id}/verify` | `verify_transfer_settlement`, authorized CS/A | `statement_evidence_id,external_id,settled_at,amount_minor,currency,verification_note` | `transfer_id,state` |
| `/review-cases/{id}/allocate` | `allocate_transfer`, owning CS/A | `transfer_id,evidence_version,allocations[{charge_id,amount_minor}]` | `allocation_ids,unapplied_minor,confirmation_status` |
| `/allocations/{id}/correct` | `correct_allocation`, A | `replacement_charge_id,amount_minor,reason` | `reversal_id,new_allocation_id` |
| `/transfers/{id}/reversals` | `record_transfer_reversal`, A | `external_reversal_id,amount_minor,effective_at,evidence_file_id` | `reversal_id,reconciliation_exception_id` |
| `/refunds` | `request_refund`, authorized payer/L/A | `source_type,source_id,amount_minor,reason` | `refund_id,state` |
| `/refunds/{id}/destination` | `propose_refund_destination`, authorized payer/A | `channel,identifier,payee_name,source_evidence_file_id` | `destination_id,masked_identifier,verification_status` |
| `/refund-destinations/{id}/verify` | `verify_refund_destination`, A | `evidence_file_id,decision,reason` | `destination_version_id,verification_status` |
| `/refunds/{id}/approve` | `approve_refund`, A | `remedy_id,destination_version_id,amount_minor,reason` | `reserved_minor,state` |
| `/refunds/{id}/attempts` | `record_refund_attempt`, A | `external_reference` | `attempt_id,state` |
| `/refunds/{id}/reconcile` | `reconcile_refund`, A | `attempt_id,outcome,evidence_file_id,external_reference,settled_at` | `state,ledger_transaction_id` |

Channels are `instapay` and `vodafone_cash`. Statement import and manual transfer entry create `pending` candidates. Verification requires independent receiving-account evidence. Allocation requires settled funds and qualified payer evidence for every debt. `decision` is `needs_information`, `escalated` or `resolved_rejected`, with an allowed transition to the canonical case state. Refund `outcome` is `settled`, `failed` or `unknown`, supported by evidence. Package purchase grants activate only after approved funding criteria or explicit audited administrative grant. `grant_kind` is `complimentary` or `approved_credit`. Approved credit requires and locks an eligible `source_credit_id`. Complimentary carrying value follows the approved subsidy policy. Coverage follows `named_entitlement_covers_eligible_occurrence` or `allocated_value_with_explicit_top_up`. The first uses `reserved_named_package_entitlement` and zero additional debt for fully satisfied service. The second uses `reserved_eligible_package_value` and an accepted top-up where required.

Receipt submission always identifies its charge. An enrollment ID is required for an enrollment charge and absent for a standalone package-purchase charge. Derive the authorized learner/payer scope from that charge. An allocation may invoke the internal confirmation rule when all saved policy, agreement, quote, capacity and funding predicates succeed. Otherwise preserve the successful allocation and return the unresolved confirmation reason. Customer service cannot override those predicates. Refund destination approval verifies the original payer and funding lineage independently from the requested destination.

Refund `source_type` is `charge` or `unapplied_credit`. For `charge`, `source_id` is the eligible charge and the command resolves its actual settled allocation lineage. For `unapplied_credit`, `source_id` is the original incoming transfer and the command derives its customer-owned, currently unallocated amount. Lock the source and its remedy/refund reservations before approval. An unapplied 5000 surplus refund reduces cash and unapplied credit once while preserving the 50000 charge, its allocated payment and earned tuition. Own-payment reads expose the permitted refund source reference and currently eligible amount.

## Teaching, tutor pay and files

| POST route | RPC and scope | Input allowlist | Result beyond C |
|---|---|---|---|
| `/occurrences/{id}/start` | `start_occurrence`, T/A | `actual_start_at` | `state` |
| `/occurrences/{id}/attendance` | `record_attendance`, T/A | `actual_start_at,actual_end_at,entries[{enrollment_id,attendance,attended_seconds,reason}]` | `attendance_version` |
| `/occurrences/{id}/completion` | `submit_completion`, T | `attendance_version,topic_summary,delivery_exception_ids` | `state` |
| `/occurrences/{id}/completion/approve` | `approve_completion`, A | `completion_version,approved_remedy_ids` | `completion_id,base_earning_id` |
| `/completions/{id}/amend` | `amend_completion`, A | `corrected_facts,evidence_file_id,reason` using a typed facts schema | `amendment_id,adjustment_ids` |
| `/occurrences/{id}/fee-agreements` | `approve_tutor_fee`, A | `tutor_id,fee_minor,currency,duration_minutes,compensation_policy_version_id,reason` | `fee_agreement_id` |
| `/occurrences/{id}/cancellation-awards` | `approve_cancellation_award`, A | `cancellation_decision_id,amount_minor,reason` | `earning_id` |
| `/earnings/{id}/adjust` | `adjust_tutor_earning`, A | `delta_minor,effective_at,reason,evidence_file_id` | `adjustment_id` |
| `/tutor/payout-destinations` | `submit_payout_destination`, T | `channel,identifier,payee_name` | `destination_id,masked_identifier,verification_status` |
| `/payout-destinations/{id}/verify` | `verify_payout_destination`, A | `evidence_file_id,decision,reason` | `destination_version_id,verification_status` |
| `/payouts` | `authorize_payout`, A | `tutor_id,destination_version_id,allocations[{earning_id,amount_minor}]` | `payout_attempt_id,state,reserved_minor` |
| `/payouts/{id}/reconcile` | `reconcile_payout`, A | `outcome,external_reference,evidence_file_id,settled_at` | `state,owed_minor,available_minor` |
| `/expenses` | `record_expense`, A | `category,amount_minor,currency,incurred_at,description,evidence_file_id` | `expense_id,payable_minor` |
| `/expenses/{id}/settlements` | `record_expense_settlement`, A | `amount_minor,receiving_account_id,external_reference,settled_at,evidence_file_id` | `settlement_id,remaining_payable_minor` |
| `/files` | `create_file_upload`, authorized L/T/CS/A | `purpose,parent_id,filename,declared_type,size_bytes,checksum_sha256` | `file_id,upload_path` |
| `/files/{id}/complete` | `finalize_file_upload`, original uploader | `checksum_sha256` | `scan_state,scan_job_id` |

`PUT /files/{id}/content` streams bounded bytes through the authenticated server. `GET /files/{id}/content` reauthorizes current session and object scope, then streams the permitted file. `purpose` is `private_preparation`, `shared_handout`, `receipt`, `statement_evidence` or `review_evidence`. Completion `corrected_facts` allows `actual_start_at`, `actual_end_at`, `topic_summary` and `attendance_corrections[{enrollment_id,attendance,attended_seconds,reason}]`. Financial consequences use approved linked adjustments. Future factual attendance returns `INVALID_TIME`.

Payout destination `channel` must be enabled for that tutor. Validate InstaPay identifiers against the configured address format and Vodafone Cash numbers as normalized Egyptian mobile numbers. Store the encrypted full identifier and versioned verification evidence, return its masked form, and reject a wallet/address change until the new version is verified. Validation of syntax and verification of ownership are separate checks.

## CRM, messaging and analytics commands

Booking-intent and support commands, plus authenticated WhatsApp ingress, create idempotent inquiry events through a private internal command. Preserve the observed source parameters, server/provider observation time and evidence confidence before any attribution decision. Client-supplied source parameters remain observed claims until their configured evidence rule is satisfied. Identity linking preserves unknown and shared-contact cases for review. Campaign spend supports manual entry or approved import. Its optional expense reference prevents counting the same cost again in financial reports. Cohort reports use the recorded spend basis and show missing spend explicitly.

| POST route | RPC and scope | Input allowlist | Result beyond C |
|---|---|---|---|
| `/customers/{id}/follow-ups` | `assign_follow_up`, CS/A | `owner_id,due_at,reason,channel` | `follow_up_id` |
| `/identity-matches/{id}/review` | `review_identity_match`, A | `decision,person_id,evidence_note` | `mapping_version` |
| `/exports` | `request_export`, L/T/A | `kind,filters,columns,as_of` using per-kind allowlists | `export_id,snapshot_at,job_id` |
| `/deliveries/{id}/retry` | `retry_notification`, authorized CS/A | `reason` | `delivery_id,attempt_id` |
| `/conversations` | `start_conversation`, U/V | `channel,topic,source_token` | `conversation_id` |
| `/conversations/{id}/messages` | `submit_message`, own U/V | `client_message_id,text` | `message_id,state` |
| `/conversations/{id}/handoff` | `request_handoff`, own U/V | `reason` | `handoff_id,state` |
| `/conversations/{id}/claim` | `claim_conversation`, CS | none | `owner_id,version` |
| `/conversations/{id}/reply` | `reply_to_conversation`, owning CS | `text,template_id,template_parameters` as permitted by channel | `message_id,delivery_state` |
| `/conversations/{id}/transfer` | `transfer_conversation`, owner/A | `new_owner_id,private_reason` | `owner_id` |
| `/conversations/{id}/escalate` | `escalate_conversation`, owner CS | `private_reason` | `state,specialist_queue_id` |
| `/conversations/{id}/return` | `return_conversation`, A | `owner_id,private_instruction` | `state,owner_id` |
| `/conversations/{id}/resolve` | `resolve_conversation`, owner/A | `resolution_code,private_note` | `state` |
| `/conversations/{id}/link` | `link_conversation_account`, U | `single_use_thread_challenge,learner_id` | `link_id,authorized_scope` |
| `/attribution/{id}/review` | `review_attribution`, A | `inquiry_id,evidence_type,reason` | `revision_id,recalculation_job_id` |
| `/campaigns` | `create_campaign`, A | `source,external_campaign_id,name,active_from,active_to` | `campaign_id` |
| `/campaign-spend` | `record_campaign_spend`, A | `campaign_id,from,to,amount_minor,currency,evidence_file_id,expense_id` | `spend_entry_id` |
| `/campaign-spend/{id}/correct` | `correct_campaign_spend`, A | `amount_minor,reason,evidence_file_id` | `revision_id` |

Export kinds are `own_account`, `own_tutor_statement`, `admin_customers`, `admin_sessions` and `admin_finance`. L can request only own-account fields for self or currently linked learners. T can request only the current tutor statement. A can request approved administrative kinds. The server derives actor scope and validates any requested learner subset against it. Export filters and columns are intersected with the kind's approved schema. Exports materialize an authorized repeatable-read snapshot, escape CSV formula prefixes and expose a checked download route.

Website conversation creation and customer message submission operate on `website` threads. WhatsApp inbound threads and user timestamps originate only from verified provider callbacks. Website messages never reset a WhatsApp service window. Staff reply accepts exactly one free-text message or one template with its parameters. Provider ingress uses `/webhooks/whatsapp` and `/webhooks/email`, signature verification and private worker commands. The Google OAuth callback validates state/PKCE and stores an encrypted connection. These endpoints expose no raw financial mutation path. A V account cannot use learner, payment, export or staff commands.
