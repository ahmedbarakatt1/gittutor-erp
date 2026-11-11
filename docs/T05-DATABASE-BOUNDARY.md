# T05 Core Database Boundary

This supplements `docs/T05-PACKAGE-CONTRACT.md` following T04 commit `57a8a8927263753e18586a9e20086b155324dc53`. It defines implementation interfaces and does not claim executed T05 behavior.

## Catalog extension

Append a `catalog_validation_schemas` version 2 snapshot; preserve version 1 and approved historical policy JSON. The runtime JSON version 2 adds optional/null draft fields inside package_contract: `purchase_activation_rule: full_settled_charge` and `expiry_clock: elapsed_24_hour_days`. New complete approval/publication and package purchase requires both. Existing approved public summaries remain readable because their structural shape permits missing new fields. New drafts/updates are tagged schema_version2; historical approved rows keep their original tag. Canonical malformed vectors gain missing/null/unknown activation/clock cases and SQL/TS parity checks.

Expiry `days_from_grant` means exactly N*86400 UTC seconds; Cairo is display/business-date context. Reject overflowing/out-of-supported-range expiry. Both reservation time and occurrence start must be strictly before the lot expiry. No implicit refresh on transfer/restoration. `none` means null expiry.

Root approved fresh bootstrap ordering only for a verified EMPTY disposable project: apply through historical T03 cutoff, seed original identity/catalog through genuine approval RPCs, then apply T04/T05 additions and new T05 fixtures. Existing projects append migrations only. Original seeder reruns validate saved immutable hashes; they cannot republish an incomplete legacy draft under new rules. Production migration application remains fixture-free. Add guarded regression for the empty-project cutoff and explicit refusal to apply fresh-only setup to existing data. New T05 package policy/offer identities are required.

## Shared context and locks

All private functions live in app_private except journal helpers/records in finance_private. They are commands-owned NOLOGIN/NOBYPASSRLS, empty search_path, no browser or generic worker EXECUTE. Existing real Auth/current-scope checks happen in public command dispatcher before replay; input cannot name an actor or assert funding/qualification.

`package_begin(actor uuid,name text,input jsonb,key text) -> jsonb` and `package_finish(context jsonb,resource uuid,version int,result jsonb,event_type text,event_payload jsonb) -> jsonb` preserve the existing booking command context fields and atomic idempotency/audit/outbox behavior. Context carries actor_account_id,command_name,idempotency_key,command_id,request_hash,replay_result. Worker contexts have no forged human actor and use a separate durable due-run record.

`package_lock_learner(learner_id uuid) -> void` creates/locks one private learner_financial_mutex row. Multiple resources are locked in UUID order. Pure package operations begin here; booking coverage/release first acquires tutor, occurrence and enrollment in the already agreed order.

`package_lock_purchase(purchase_id uuid) -> package_purchases` looks up learner, acquires its mutex then locks purchase. Multi-purchase transfer first discovers both IDs/learner, acquires learner once, then locks sorted purchase IDs. It does not acquire any booking lock.

`package_assert_scope(actor uuid,learner_id uuid,scope text,allow_admin boolean default false) -> void` accepts only booking/payments and current verified session/account at public boundary; delegates relationship locking to the identity helper. Carrying-value projections/selection need payments scope in addition to booking scope.

## Table row contract for proposal owner

package_purchases: id,learner_id,purchaser_account_id,contract_version_id,contract_snapshot jsonb,contract_hash text,accepted_by,accepted_at,planned_credit_quanta bigint,purchase_value_minor bigint,currency,purchase_activation_rule,purchase_state,activated_at,charge_id uuid,version,created_at,updated_at.

package_lots: id,purchase_id,learner_id,origin_kind,original_lot_id,source_lot_id,grant_policy_version_id,contract_version_id,eligibility_snapshot jsonb,base_duration_minutes,coverage_rule,expires_at,grant_source_id,version,created_at. Bucket counters live on this row (eight quantity/value pairs: granted,transferred_in,adjustment,available,reserved,consumed,expired,transferred_out) and reconcile to append-only entitlement_movements. Signed adjustment may be negative; normal resulting buckets cannot.

package_reservations: id,purchase_id,learner_id,enrollment_id,quote_id,quote_hash,coverage_rule,required_credit_quanta,reserved_credit_quanta,allocated_value_minor,agreed_top_up_minor,coverage_proposal_id nullable,acceptance_refs jsonb,state,expires_at,version,created_at,updated_at.

package_reservation_allocations: id,reservation_id,lot_id,credit_quanta,value_minor,created_at. Original allocation immutable; remaining quantity/value is derived from movement lineage and optionally cached only with movement reconciliation. Proposal owner must not write lot counters or allocation rows directly.

entitlement_movements: id,lot_id,purchase_id,learner_id,kind,enrollment_id,reservation_id,allocation_id,original_movement_id,transfer_id,command_id,line_key,policy_version_id,delta jsonb (strict known quantity/value bucket fields),credit_quanta,value_minor,from_bucket,to_bucket,customer_reason_code,effective_at,recorded_at. Unique(command_id,line_key). Original source/reference fields are immutable.

package_transfers: id,source_purchase_id,target_purchase_id,source_lot_id,target_lot_id,source_credit_quanta,target_credit_quanta,value_minor,currency,conversion_proposal_id,command_id,created_at. Paired movement references make equality checkable; same learner always. Source/target ancestry edges persist and cannot be deleted to defeat cycle checks. Conversion transfers the original source quantity/value in its paired entries, then adds an explicitly authorized signed target quantity adjustment with zero value; the saved proposal explains the service-duration conversion. No unexplained additional units or value arise.

## Kernel interfaces

`package_balance(purchase_id uuid) -> jsonb` returns the exact DTO bucket keys and origin totals. `package_lot_balance(lot_id uuid) -> jsonb` returns one lot snapshot. `package_reconciliation(purchase_id uuid) -> jsonb` returns quantity/value differences and journal tie-outs, never repairs them.

`package_append_movement(lot_id uuid,kind text,delta jsonb,refs jsonb,command_context jsonb,line_key text) -> uuid` is a strict private conservation kernel. Caller has acquired learner/purchase/lot locks. It validates known fields, exact integral bounds, nonnegative final buckets and both conservation identities; inserts one append-only movement and updates the cache/version. The kernel does not assert delivery or financial qualification. A deployed qualified wrapper performs those checks; guarded historical test fixtures can exercise the kernel independently without a deployed test bypass.

`package_allocate_available(purchase_id uuid,credit_quanta bigint,at_occurrence_start timestamptz) -> jsonb` deterministically previews per-lot {lot_id,lot_version,credit_quanta,value_minor,expires_at}, using earliest expiry then created_at/id and exact remaining-value division. It runs under the same locks at preview/consumption and does not mutate. Source hash binds ordered lot IDs/versions/allocations.

`package_coverage_quote(purchase_id uuid,enrollment_id uuid,credit_quanta bigint) -> jsonb` returns customer-safe exact terms plus private caller-only allocation/source hash, based on the current ordinary enrollment/quote and saved lot eligibility. The public projection strips private helper metadata. Partial named remaining-service price is null until explicit reviewed terms; never calculate it from historical carrying value.

`package_reserve_allocations(purchase_id uuid,enrollment_id uuid,credit_quanta bigint,coverage_proposal_id uuid,accepted_terms jsonb,command_context jsonb) -> package_reservations` consumes validated package proposal terms, rechecks allocation versions/hash, then writes reservation and per-lot reserve movements atomically. Only dispatcher calls it after current authorization and proposal validation. Proposed fields cannot substitute for current quote/lot state.

`package_transfer_available(source_purchase_id uuid,target_purchase_id uuid,credit_quanta bigint,conversion_proposal_id uuid,conversion_terms jsonb,command_context jsonb) -> jsonb` returns transfer_ids,transferred_credit_quanta,carrying_value_minor. It validates compatibility or exact accepted conversion and appends paired movements/new child lots; it rechecks cycle freedom under learner mutex.

`package_assert_acyclic_transfer(source_purchase_id uuid,target_purchase_id uuid) -> void` rejects self-edge or target-to-source reachability before any movement. Renew calls the same helper after creating a new pending purchase and before carrying existing available units.

`package_release_for_hold_end(enrollment_id uuid,reason text,command_context jsonb) -> uuid[]` releases only remaining active reservation allocation quantities/values, to available or expired according to original expiry. It is called inside booking hold-end transaction after booking row locks. Same source allocation cannot release twice.

The installed `package_hold_end_release` statement trigger uses enrollment transition tables. It acquires the sorted set of affected learner financial locks before releasing any package, then processes purchases in learner/purchase order. A failure rolls back the entire booking statement and all releases. T06 commands that change several enrollment sets in separate statements must prelock the union of affected financial learners after all required booking locks; ordering each statement alone does not establish transaction-wide lock order.

Qualification gates remain as in the main draft: package_purchase_funding_status, package_activate_funded_purchase, package_lock_approved_credit, package_assert_delivery_qualification and package_reserve_remedy. No public consume endpoint; private qualified consume wrapper delegates to the kernel only after a real T08 decision. Shared remedy source records cap quantity and value separately, even for zero-value lots. Root froze `app_private.remedy_reservations` to match the owning data model; original monetary/benefit source accounting may live in `finance_private.remedy_sources`. Both remain unexposed with scoped command/query projections.

## Finance primitives

`finance_private.finance_post_balanced(source_posting_key text,source_type text,source_id uuid,currency text,effective_at timestamptz,lines jsonb,command_context jsonb) -> uuid` accepts only known account codes, exact safe signed integers and strict line fields; locks/replays the unique source key with matching hash, validates balance and writes immutable header/lines. No generic public journal API. Zero-valued issuance keeps a source header without invented nonzero lines. A deferred balance constraint independently protects committed transactions.

`finance_private.finance_issue_charge(charge_type text,learner_id uuid,responsible_account_id uuid,package_purchase_id uuid,enrollment_id uuid,contract_version_id uuid,accepted_terms_hash text,amount_minor bigint,command_context jsonb) -> uuid` creates immutable issued charge and balanced receivable/deferred posting in the same transaction. Exactly one target matches charge_type. Package charge currency derives from approved contract. T06 extends source/funding lineage without replacing charge/journal IDs.

Complimentary positive-value posting requires approved grant-policy lineage and uses promotional_subsidy_expense/deferred_package_obligation; it creates no cash/settlement and never reduces the purchase charge. approved_credit is unavailable until real source-credit locking exists. Future refund/restore code follows the same full resource lock order, including the shared original consumption/benefit source; it cannot lock funding first and then acquire booking locks.
