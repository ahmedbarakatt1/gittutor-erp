# T05 Package Contract

T05 implementation follows the supplied task plan after booking foundation commit `57a8a8927263753e18586a9e20086b155324dc53`. This document records the agreed interfaces and decisions; executed results belong in `IMPLEMENTATION-STATUS.md` and the database evidence.

**Goal:** Persist package purchases, real issued charges, explicitly authorized entitlement lots, quantity/value movements, scoped histories, and coverage/conversion consent while keeping unimplemented funding, delivery, and shared remedies unavailable.

**Architecture:** PostgreSQL commands own current authorization, idempotency, source versions, balanced postings, lot movements and outbox events. Pure TypeScript calculates exact reference results and validates strict RPC projections. Public/client code never imports internal compensation, journal or subsidy authoring inputs.

**Tech stack:** Existing pinned Next.js, TypeScript, Zod, Supabase Auth/PostgreSQL, Vitest and Playwright; no new dependency required.

**Spec:** docs/00-contract-spine.md; docs/01-product-spec.md R05/R07/R13/R18; docs/02-business-rules.md §6–7; docs/04-data-model.md packages/financial records; docs/05-api-contracts.md package reads/commands and operation proposals; docs/06-security-integrations.md; docs/07-ui-spec.md package screen; contracts/policy-settings.json; fixtures/domain-scenarios.json SCN-PACKAGE-* and SCN-PACKAGE-COVERAGE-MODES; T05/T06/T08 in the implementation plan.

## Fixed constraints and root decisions

- Currency EGP; integer minor units and credit quanta fit JavaScript safe integers. A standard contract session is exactly 1000 quanta. Use bigint/numeric for multiplication and sums before validating outputs.
- Preserve canonical movement types: grant, reserve, release, consume, restore, transfer_out, transfer_in, expire, adjust. No editing or deleting posted movements, charges or journal lines.
- An accepted package purchase creates a real contract and real issued charge. It contributes **zero purchased usable entitlement** until the approved funding rule is satisfied. T05 never fabricates settlement, an incoming transfer, a payment allocation or a funded flag.
- Root approved a separate immutable, versioned administrative grant policy. Complimentary value defaults to zero. Positive carrying value requires an explicitly selected approved subsidy policy; synthetic local policy approval may authorize a non-cash subsidy-expense/deferred-obligation posting.
- A complimentary lot is an **extra bonus lot**. It neither settles/waives the purchase charge nor activates the scheduled purchased grant. Read/UI models show pending purchased credits/debt separately from usable bonus/carried credits.
- `approved_credit` requires a real eligible source credit locked and consumed through T06. It remains DEPENDENCY_UNAVAILABLE until that implementation exists.
- Root approved minimal real `finance_private.charges`, `ledger_transactions`, `ledger_lines` primitives in T05. T06 extends these tables, never creates competing charge or ledger identities.
- Root approved lock order: tutor UUIDs -> occurrence UUIDs -> enrollment UUIDs -> learner financial mutex UUIDs -> purchase UUIDs -> lot UUIDs -> reservation/consumption/remedy source UUIDs -> funding source locks, each set sorted. Pure package commands may start at learner mutex and **never later acquire booking locks**. T06 allocations must discover their affected booking IDs first and use the same order, avoiding finance-first followed by confirmation.
- Guardian operations need current appropriate scopes. `booking` authorizes entitlement reservation/coverage; `payments` authorizes purchase/renewal/value statements/grants-related financial reads (the existing identity enum is verified as `payments`). A broad `authorized_learner_ids` array is not sufficient authority. Own learner always uses the current identity relationship, not payer equality.
- Keep two anonymous RPC exceptions only. All package interfaces require current verified non-anonymous Auth, current role/relationship checks before replay, and allowlisted DTOs.
- Financial confirmation/amendment/refund integrations remain `awaiting_T06_integration`; delivery qualification remains T08-owned. Do not mark full acceptance cases passed based on independent movement kernel tests.

## Resolved policy and evidence decisions

1. New package contracts explicitly save `purchase_activation_rule:'full_settled_charge'` and `expiry_clock:'elapsed_24_hour_days'`. Catalog schema snapshot2 permits missing/null in drafts and requires both at new complete approval/publication and purchase. Schema1 and historical approved policy JSON remain unchanged and readable; missing fields prevent new package purchase without changing existing booking behavior. DB owns catalog schema/semantic/parity-vector changes. For a verified empty disposable bootstrap only: apply historical T03 cutoff, seed original identity/catalog through real RPCs, then apply later migrations and distinct T05 synthetic policy/offer fixtures. Generic production migrations never seed or bypass validation.
2. `days_from_grant` is exactly N*86400 elapsed seconds from the UTC grant instant. Display the resulting expiry in Cairo; business-date reports still use Cairo. Both reservation time and occurrence start must be strictly before expiry. `none` is null; transfer/restoration preserve original expiry, including an expired unusable destination bucket.
3. Test the private movement kernel with isolated guarded historical fixtures/DBA setup. There is no deployed synthetic bypass or fake T08 qualification. Public consume is absent; restore fails closed without a real shared remedy. Full funded/delivery/refund cases remain deferred to actual T06/T08 checks.
4. Partial named coverage requires explicit admin-reviewed remaining-service cash terms and current learner/guardian acceptance. Historical carrying value never supplies the missing service price.
5. `app_private.remedy_reservations` is canonical; original monetary/benefit sources may live in finance_private. Quantity and value caps are independent, including zero-value lots.

## Package contract identity, purchase and grants

`package_contract_version_id` is the existing owning approved booking `policy_versions.id` whose package_contract has `package_policy_version_id` equal to that same UUID. Copy the complete immutable customer package contract into the purchase snapshot. The contract is eligible for new purchases only if complete, effective, environment/provenance-compatible and attached to at least one currently published eligible offer. Existing lots retain their saved eligibility after tariff changes; no implicit newest policy selection.

The customer contract hash is SHA-256 over explicit canonical customer fields, package-contract version and the saved purchase-activation/expiry rule. It excludes approver identity, compensation, internal notes and journal accounts. Save a distinct purchase acceptance record binding hash, actor, actual learner and time. A guardian's acceptance does not turn the guardian into the learner or assert they ultimately paid.

Suggested records:

- `app_private.package_purchases`: id, learner_id, purchaser_account_id, contract_version_id, immutable contract_snapshot/hash, accepted_by/at, planned_credit_quanta, purchase_value_minor, currency, purchase_activation_rule, purchase_state (`pending_funding|activated|cancelled`), activated_at nullable, charge_id, version/timestamps. `activated` describes the scheduled purchased grant only; bonuses do not change it.
- `app_private.package_lots`: id, purchase_id, learner_id, origin_kind (`purchase|complimentary|approved_credit|transfer`), original_lot_id, source_lot_id nullable, grant_policy_version_id nullable, pinned eligibility/base duration/coverage/expiry, grant source ID, version. Quantity/value counters are a cache reconciled to append-only movements, not independent editable balances.
- `app_private.package_purchase_acceptances`: immutable contract hash, purchase/learner/actor and timestamp.
- `finance_private.charges`: id, charge_type (`package_purchase|enrollment`), learner_id, responsible_account_id, package_purchase_id/enrollment_id nullable exclusive by type, accepted_contract_version_id/hash, amount_minor, currency, state (`draft|issued|voided`), version/timestamps. Original amount immutable once issued; corrections use charge_adjustments. The initial package charge is issued once, even for zero price, and is not evidence of funding.
- Minimal immutable `finance_private.ledger_transactions` and `ledger_lines`: source_posting_key unique, source_type/id, actor/command, effective_at/recorded_at, currency; lines account_code, learner_id/purchase_id/lot_id where applicable, signed_minor; deferred constraint sums to zero per transaction/currency. Issue purchase: debit receivable, credit deferred_package_obligation. No channel cash line. Zero-value events still retain command/source identity without invented nonzero posting.
- `app_private.package_grant_policy_versions`: approved immutable eligibility/limits/provenance; private subsidy account mapping stays in finance_private. Draft fields below. Browser tables unavailable; only explicit admin RPCs.

Grant policy editable fields: `name`, `eligible_package_contract_version_ids:uuid[]`, `currency:'EGP'`, `valuation_rule:'zero_value'|'reviewed_exact_capped_subsidy'`, `maximum_credit_quanta_per_grant`, `maximum_carrying_value_minor_per_grant`. Zero policy requires maximum value=0. Positive policy requires an admin approval note, effective_at and a fixed server-owned `promotional_subsidy_expense -> deferred_package_obligation` mapping. Environment/is_synthetic/approved_by/time are server-derived. Grant amount/quanta must be bounded by the selected policy and the target package eligibility, and cannot be changed after approval.

`approve_package_grant` adds a `grant_policy_version_id` field to the original allowlist. For zero-value complimentary grants, a current applicable approved zero policy may be selected explicitly; if omitted, use only a unique explicitly configured zero policy, otherwise POLICY_INCOMPLETE. For positive value the selected policy ID is mandatory. Admin enters exact approved quanta/value and reason; source_credit_id is null for complimentary, nonnull for approved_credit. Evidence_file_id is optional for zero grants; positive grants obey their approved evidence requirement. No T07 fake file success: absent file infrastructure either policy permits approval-note evidence for the synthetic policy or the action remains EVIDENCE_REQUIRED.

## Quantity/value ledger and deterministic allocation

`app_private.entitlement_movements` has immutable id, lot_id, purchase_id, learner_id, kind, enrollment_id nullable, reservation_id nullable, original_movement_id nullable, transfer_id nullable, command_id/line_key, policy_version_id, signed deltas for available/reserved/consumed/expired/transferred_in/transferred_out/granted/adjustment quanta **and matching value buckets**, effective_at/recorded_at, safe customer reason code. Administrative prose and evidence IDs are separately privileged.

Per lot, for quantity and independently for value:

`granted + transferred_in + signed_adjustments = available + reserved + consumed_net_of_restores + expired + transferred_out`

Normal bucket balances must never be negative. Value may be zero for positive quantity; quantity zero cannot retain unexplained movable value. Entirely consumed/transferred final allocation receives remaining residual. Every lot's cached aggregate must equal the sum of movements; constraints/private append helpers enforce this in one transaction. Add a checked diagnostic returning differences, not a repair mutation.

- Reserve allocates from **remaining available** value/quanta. Save exact per-lot allocations on `package_reservation_allocations`; moving other units later cannot revalue them.
- Partial consume allocates from the reservation allocation's **remaining reserved** value/quanta, not from the current lot balance. Consume 500 of reserved1000 carrying50000 -> consume25000; release remaining500/25000 if approved closeout calls for release.
- Release references the reservation allocation and its remaining quantity/value. It returns to available unless original lot expiry has passed; then it moves to expired under preserved original terms. Idempotent same-key replay returns the exact original movement.
- Restore references a specific consume movement and its remaining unrestored quantity/value. The final partial restore receives its residual. It moves consumed back to available or expired according to original expiry, never creates a fresh expiry. Shared benefit reservation is required before restore.
- Transfer allocates from source available buckets, produces exactly paired transfer_out/in entries with the same quantity/value/currency and lineage ID, and creates a child lot retaining original carrying value and original expiry/eligibility. No cash/revenue posting; obligation dimension transfer may be balanced between lots if the ledger uses lot dimensions.
- Expire only eligible **available** units/value. Reserved or consumed units remain in their own buckets. Expired value stays separately visible until approved retained-value accounting resolves it; expiry does not silently recognize revenue.
- Adjust requires an authorized signed quantity/value, explicit source/reason and a balance-preserving outcome. No customer endpoint for arbitrary adjustment.

Pure helper exports in `src/modules/packages/value.ts`:

`allocateSequential({remaining_credit_quanta,remaining_value_minor,requested_credit_quanta}) -> {allocated_value_minor,remaining_credit_quanta,remaining_value_minor}`

`allocateBatch({total_value_minor,allocations:[{allocation_id,credit_quanta}]}) -> [{allocation_id,value_minor}]`

`calculateProratedQuanta({delivered_seconds,base_duration_minutes,rounding:'floor'|'ceiling'|'half_up'}) -> credit_quanta` only where the approved policy explicitly supplies rounding; never infer it from cash rounding. Reviewed partial consumption accepts exact authorized quanta instead.

`assertLotConservation(bucketSnapshot)`; `describeCoverage({coverage_rule,required_credit_quanta,reserved_credit_quanta,carrying_value_minor,accepted_customer_price_minor,remaining_service_terms})`.

BigInt products; reject fractional/negative/unsafe arguments and oversized outputs. Sequential floor allocation: 100000 in equal1000/1000/1000 gives33333/33333/33334; 100001 gives33333/33334/33334; 100000 in1000/500/1500 gives33333/16666/50001. Batch100001 over equal weights gives33334/33334/33333 using stable allocation UUID byte order on equal remainders. Never swap batch and sequential algorithms.

## Reservation and coverage boundary

`app_private.package_reservations`: id, purchase_id, learner_id, enrollment_id, quote_id/hash, coverage_rule, required_credit_quanta, reserved_credit_quanta, allocated_value_minor, agreed_top_up_minor nullable, coverage_proposal_id/derived_acceptance_refs, state (`reserved|partially_consumed|consumed|released`), expires_at, version. Per-lot allocation rows immutable; mutable remaining values are derived/cached with source movement references. At most one active effective coverage selection for an enrollment; additional allocation requests cannot over-cover required service.

Eligibility rechecks current learner booking scope, active ordinary held/confirmed enrollment, quote pointer/terms revision, saved accepted quote, approved package contract, actual occurrence.offer_id, format and base-duration compatibility, lot original expiry and availability. Provisional amendment seats cannot reserve ordinary package coverage before amendment commit. A reserved lot quantity cannot also transfer, expire or support another reservation. Lock and expire relevant available lots before choosing deterministic earliest-expiry-then-created/id allocation.

Named mode: full eligible1000 quanta carrying50000 for an occurrence with reference57500 gives `service_satisfied=true`, `agreed_top_up_minor=0`; no new tuition receivable may be inferred from the7500 difference. Consumed revenue/refund cap is original50000, not57500. The25000 carrying-value variant likewise has zero additional cash demand. Partial named500 quanta requires an accepted remaining-service proposal; there is no formula `reference_price - carrying_value`.

Value mode: explicitly accepted57500 quote and50000 package allocation gives agreed7500 top-up. With25000 package value, remaining32500; a50% deposit threshold28750 requires3750 additional eligible monetary funding. Service quanta and value remain separate. When allocation value exceeds agreed monetary price, do not burn the excess silently: reject or require explicit reviewed coverage terms preserving unused quantity/value.

T05 may reserve real existing usable lots and record the agreed coverage calculation, but `booking_funding_status` remains unavailable until T06 integrates the real coverage adjustment, charge/funding postings and atomic confirmation. Return `funding_integration_state:'awaiting_T06_integration'`, never `eligible:true`. A known agreed top-up is a contract amount, not a statement of settled money or created enrollment debt. In T05 `net_charge_minor`, paid and balance fields remain null where no real T06 calculation exists.

## Renewal, transfers, conversion and operation proposal extension

Renew creates a new purchase/charge and acceptance; its new purchased units remain pending funding. Eligible carryover is independently transferred from source available lots and can remain usable under its original funded/bonus origin. UI distinguishes carried units from pending newly purchased units. The source purchase's historical consumption remains visible; a successor label alone moves no value.

Customer renewal explicitly accepts the new contract hash. Administrative renewal additionally requires a current learner/guardian acceptance and approval of a proposal that includes the new purchase price, purchased quantity and contract hash; an admin cannot manufacture customer acceptance. A zero-carryover renewal uses explicit 0/0 source/target quantities only with a new-purchase proposal and creates no transfer movement. Existing-target conversions require positive quantities.

Routine compatibility requires same learner, currency, base duration, coverage rule and equivalent eligible-offer/format sets. Prices may differ without repricing old lots. Preserve narrower original lot expiry and eligibility. Incompatible terms require a separately accepted/admin-approved conversion proposal. The conversion carries exact original quantity/value, exact target quanta/base duration, disclosed service-duration change and rounding decision; carried value/currency remain conserved. No implied cash gain, loss or debt.

All transfer edges acquire the learner mutex and sorted source/target purchases/lots; reject self-transfer, target→source reachability, repeated movement source and insufficient available quantity. Existing-package transfer is supplemental because the original renew API only creates a new successor, which alone cannot exercise a multi-package cycle.

Extend shared operation proposal spine additively: kinds package_coverage/package_conversion; target_type enrollment/package_purchase; nullable occurrence_id only for package_conversion; conditional checks keep all existing T04 rows and semantics valid. Existing booking dispatcher remains owned by booking; `api.create/accept/decline/approve/get_operation_proposal` route new kinds to a separate package dispatcher, retaining current authorization before replay. Package conversion gets package freshness checks rather than joining a nonexistent occurrence.

Coverage immutable customer terms: `{learner_id,enrollment_id,package_purchase_id,quote_id,quote_hash,package_contract_version_id,coverage_rule,required_credit_quanta,reserved_credit_quanta,carrying_value_minor,standalone_reference_price_minor,agreed_top_up_minor,remaining_service_credit_quanta,remaining_service_price_minor,currency}` plus per-lot IDs/values internally. Hash binds quote revision, package/lot versions, actual offer, learner, expiry and exact customer terms. No tutor terms are needed when teaching/compensation is unchanged. Partial named coverage or an exception requires current admin review; routine full named may derive consent from accepted package contract and current quote with explicit saved references. Positive value-mode top-up requires a displayed accepted proposal.

Conversion immutable terms: `{learner_id,source_package_id,target_package_id:null|uuid,new_contract_version_id,new_contract_terms_hash,creates_new_purchase,new_purchase_credit_quanta,new_purchase_value_minor,source_credit_quanta,target_credit_quanta,carrying_value_minor,currency,old_base_duration_minutes,new_base_duration_minutes,original_expiry_at,converted_expiry_at,eligibility_changes,service_duration_delta_second_quanta,rounding_rule}`. New-purchase quantity/value are the exact accepted contract amounts when the target is null, and 0/0 for transfers into an existing purchase. Renewal-to-new-package proposals target the existing source purchase and desired immutable contract; target ID is server-derived on consumption. Keep actor/role/guardian checks and source versions current at actual reserve/renew/transfer consumption. Replays must never reapply a transfer.

## Exact RPC/HTTP proposal

Every mutation takes p_idempotency_key, all listed fields prefixed p_; HTTP body omits prefix. C is command_id/resource_id/version. Creates201, changes/replays200. All array/read filters strict. UUIDs and bounded safe integer amounts. Except grant-policy drafts, arbitrary JSON is forbidden.

| Route | RPC and input fields beyond key | Result beyond C | Scope/version |
|---|---|---|---|
| POST /packages | purchase_package(learner_id,package_contract_version_id,accepted_terms_hash) | package_purchase_id,charge_id | L payments; create |
| POST /packages/{id}/complimentary-grants | approve_package_grant(package_id,credit_quanta,carrying_value_minor,currency,grant_kind,grant_policy_version_id nullable,source_credit_id nullable,reason,evidence_file_id nullable,expected_version) | lot_id,grant_movement_id | admin; purchase version |
| POST /packages/{id}/reserve | reserve_package_credit(package_id,enrollment_id,credit_quanta,coverage_proposal_id nullable,expected_version) | reservation_id,reserved_credit_quanta,carrying_value_minor,top_up_minor | L booking; purchase version plus internal pinned quote/proposal versions |
| POST /package-reservations/{id}/release | release_package_reservation(reservation_id,reason,expected_version) | released_credit_quanta,released_value_minor,movement_ids | L booking/admin; reservation version; held-only routine release |
| POST /packages/{id}/renew | renew_package(package_id,new_contract_version_id,transfer_credit_quanta,accepted_terms_hash,conversion_proposal_id nullable,expected_version) | successor_package_id,transfer_ids,charge_id | L payments/admin; source purchase version |
| POST /packages/{id}/transfers | transfer_package_credit(package_id,target_package_id,credit_quanta,conversion_proposal_id nullable,reason,expected_version,expected_target_version) | transfer_id,transferred_credit_quanta,carrying_value_minor,target_package_version | same-learner L payments/admin; both purchase versions |
| POST /package-consumptions/{id}/restore | restore_package_credit(consumption_id,credit_quanta,remedy_id,reason,expected_version) | movement_id,restored_credit_quanta | admin; source benefit/remedy aggregate version; unavailable until shared remedy guard ready |
| POST /package-grant-policies | create_package_grant_policy(content) | grant_policy_version_id,validation_errors | admin |
| POST /package-grant-policies/{id}/approve | approve_package_grant_policy(grant_policy_version_id,effective_at,approval_note,expected_version) | state | admin; immutable approval |

Do not add a public freeform `consume` endpoint. Private `package_consume_reservation(enrollment_id,reservation_id,approved_delivery_decision_id,credit_quanta,release_remaining,command_context)` verifies T08 qualification and exact policy, then posts consume/release and recognized carrying-value journal exactly once. Same shared kernel can be exercised by guarded synthetic historical fixtures independently, with those evidence limits explicit.

Read RPCs all return collection envelope where listed:

- `list_package_contracts(p_learner_id,p_offer_id=null,p_cursor=null,p_limit=25)` GET /me/package-contracts. Current payments scope. Items: contract_version_id,title,contract,terms_hash,purchase_activation_rule,environment_label (`synthetic_development|live`), no compensation.
- `get_package_contract(p_package_contract_version_id,p_learner_id)` GET /package-contracts/{id}?learner_id=...; current payments scope; same exact approved package-only customer DTO and hash as list. This hash is distinct from offer/booking terms and is the purchase/renew acceptance input. Both interfaces remain authenticated. No manual hash entry in UI.
- `list_my_packages(p_learner_id=null,p_cursor=null,p_limit=25)` GET /me/packages; current payments scope. Explicit named learner filter for guardians. Default all currently authorized payment learners, never booking-only scopes.
- `get_my_package(p_package_id)` GET /packages/{id}; L payments/admin; customer-safe detail even if actor has admin role. No privileged default branch.
- `list_admin_packages(p_learner_id=null,p_purchase_state=null,p_cursor=null,p_limit=25)` GET /admin/packages; admin. Same customer-safe summary plus operator action flags, no raw contact/payout fields.
- `list_package_lots`, `list_package_movements`, `list_package_coverage`, `list_package_lineage`: `(p_package_id,p_cursor=null,p_limit=25)` child routes /packages/{id}/{lots|movements|coverage|lineage}; same package scope. Stable created_at/id DESC; no unbounded embedded histories.
- `list_package_grant_policies(p_status=null,p_cursor=null,p_limit=25)` admin only. Explicit safe policy metadata, no private journal account names needed in client.
- `get_package_coverage_options(p_enrollment_id)` GET /enrollments/{id}/package-options; L booking, additionally payment scope for carrying-value disclosure. If actor lacks payment scope, return only learner-authorized nonfinancial service eligibility and no carrying-value statement, or reject financial selection with CONSENT_REQUIRED. Prefer rejecting selection until both scopes available rather than inventing partial DTO authority.

`PackageSummary` exact fields:

`{package_purchase_id,version,learner:{learner_id,display_name},contract_version_id,title,purchase_state,currency,purchased_credit_quanta,purchase_value_minor,purchased_granted_credit_quanta,charge:{charge_id,state:'issued'|'voided',original_minor,net_minor,allocated_minor:null|minor,balance_minor:null|minor,funding_integration_state},balances:{available_credit_quanta,reserved_credit_quanta,consumed_credit_quanta,expired_credit_quanta,transferred_out_credit_quanta,available_value_minor,reserved_value_minor,consumed_value_minor,expired_value_minor,transferred_out_value_minor},origin_totals:[{origin_kind,granted_credit_quanta,granted_value_minor}],next_expiry_at:null|instant,created_at}`.

The charge net amount is real issued amount plus actual adjustments; while T06 is absent, allocated/balance can remain null with an explicit unavailable state. Do not report paid0 as verified payment reconciliation. Usable balances are actual lot movements and therefore may be nonzero for bonus/carryover despite pending purchase.

`PackageDetail={package:PackageSummary,contract:CustomerPackageContract,purchase_terms_hash,eligible_offers,lot_page:Page<PackageLot>,movement_page:Page<PackageMovement>,coverage_page:Page<PackageCoverage>,lineage_page:Page<PackageTransfer>,renewal_page:Page<PackageRenewal>}`; each initial page25 then child endpoint.

`PackageSummary` additionally includes `usable_available_credit_quanta` and `usable_available_value_minor`, derived from unexpired lots at server time. Raw `balances` remain the posted ledger buckets and can include an expired lot awaiting worker processing. Reads do not post expiry movements or present those unprocessed amounts as usable.

`PackageRenewal={renewal_id,source_package_id,target_package_id,created_at}` records each immediate renewal edge, including zero carryover. `list_package_renewals(p_package_id,p_cursor=null,p_limit=25)` maps to `GET /packages/{id}/renewals`; it returns a paginated collection matching either immediate source or target, never an unbounded recursive graph.

`PackageLot={lot_id,version,origin_kind,original_lot_id,source_lot_id:null|uuid,base_duration_minutes,coverage_rule,eligible_offer_ids,eligible_formats,expires_at:null|instant,balances,created_at}`.

`PackageMovement={movement_id,kind,lot_id,enrollment_id:null|uuid,reservation_id:null|uuid,original_movement_id:null|uuid,transfer_id:null|uuid,credit_quanta,value_minor,currency,from_bucket:null|bucket,to_bucket:null|bucket,customer_reason_code,effective_at,recorded_at}`. Values are positive magnitudes except explicitly authorized adjust; delta structure stays typed. No internal admin prose or evidence paths.

`PackageCoverage={reservation_id,version,package_purchase_id,enrollment_id,learner_id,quote_id,coverage_rule,required_credit_quanta,reserved_credit_quanta,consumed_credit_quanta,released_credit_quanta,carrying_value_minor,agreed_top_up_minor:null|minor,service_satisfied,state,can_release,expires_at,funding_integration_state,coverage_proposal_id:null|uuid}`. The server derives `can_release` from current enrollment and remaining-reservation state; confirmed bookings cannot use a routine held-seat release.

`PackageTransfer={transfer_id,source_package_id,target_package_id,source_lot_id,target_lot_id,source_credit_quanta,target_credit_quanta,value_minor,currency,conversion_proposal_id:null|uuid,created_at}`; every link is same currently authorized learner; no other payer identity leaked.

## Shared remedy and explicitly unavailable hooks

`finance_private.remedy_sources`/`app_private.remedy_reservations` save original consumption/allocation identity, eligible quantity and value, prior returned/reserved quantity/value and lifecycle. A unique source row is the common lock for restoration, cash refund, credit remedy and entitlement extinguishment. Quantity and value caps are independent: a zero-value consumed1000-quanta bonus permits at most1000 restored quanta even though the money cap is0.

Private hook contracts to freeze with T06/T08:

- `package_purchase_funding_status(p_purchase_id) -> {integration_state,eligible,reason,qualified_value_minor:null|minor,source_allocation_ids:uuid[]}`; T05 unavailable/false/no allocations.
- `package_activate_funded_purchase(p_purchase_id,p_funding_source_ids,p_command_context)` callable only by real funding command after locking/rechecking source. T05 rejects; public caller cannot assert sources settled.
- `package_lock_approved_credit(p_source_credit_id,p_learner_id,p_value_minor) -> typed funding source`; unavailable until T06.
- `package_assert_delivery_qualification(p_enrollment_id,p_decision_id) -> approved exact quantities/value/source`; unavailable until T08 owns approved completion/partial-delivery decisions.
- `package_reserve_remedy(p_consumption_id,p_remedy_id,p_credit_quanta,p_value_minor,p_mode) -> remedy reservation`; unavailable until shared T06 benefit source/credit/cash limits are installed. Restoration cannot bypass it.
- `package_release_for_hold_end(p_enrollment_id,p_reason,p_command_context)` moves only active remaining reservation allocations, idempotently; booking expiry/cancel/decline hooks invoke inside the existing booking lock. It never touches unrelated settled funds.
- `process_package_due(p_purchase_id,p_idempotency_key)` private worker RPC for available-lot expiry, IDs-only event payload, null human audit actor with explicit worker provenance; no caller-supplied clock.

The existing T04 due processor remains authoritative for enrollment hold expiry. `booking_expire_holds` must invoke the package release hook in the **same transaction** that marks the enrollment expired, acquiring learner/package locks after its existing tutor/occurrence/enrollment locks. A failed release rolls back both actions; retries cannot strand or duplicate reserved credits. The package worker does not independently mutate enrollment state. Expiry/release leaves the package purchase charge and any independent settled funding intact. Available-only lot expiry and restoration into an already expired lot leave those quantities unusable under preserve_original_lot_terms.

## UI responsibilities

Customer /learn/packages: learner chooser, published package contract choice/explicit acceptance, purchase result with real charge reference and pending funding banner; usable bonus/carried units separate. Detail shows available/reserved/used/restored/transferred/expired quantity and allocated carrying value in a chronological paged ledger, with related booking links. Named coverage says Covered by package +exact credits; value mode shows applied value and explicitly accepted top-up. Partial named coverage requests review instead of inventing a price. Existing account return_to behavior preserves authorized deep links.

Admin /admin/packages: scoped learner/package selection, explicit zero/approved-subsidy bonus grant form, grant policy creation/approval, quantity/value tie-out, transfer/renewal preview and conversion review. Hidden current versions from fetched rows; retained idempotency keys for unchanged retry; current-state refresh after conflict. No manual paid/funded switch or freeform journal writer. Unknown monetary integration state is visible and financial controls unavailable. Tutor/CS have no generic package financial reads.

## Ownership split and checkpoints

1. **DB agent:** new package core schema, minimal charge/journal primitives, grant policy +purchase/grant/lot/reserve/release/transfer/renew/expiry SQL, source constraints, integration tests and synthetic seed. Own changes to booking hold-end hook wiring. Send exact table/private-helper signatures before proposal work begins.
2. **Tooling agent:** src/modules/packages/{value,eligibility,commands,queries}.ts, strict shared typed schemas, pure allocation/conservation tests; then separate additive package proposal migration/tests using frozen core helpers. Own extension adapters for existing operation proposal SQL wrappers only after DB publishes core tables. Coordinate existing booking TS union extension with root/UI to avoid circular runtime imports (a separate packages/proposal-contract.ts contains only Zod/customer types).
3. **Root:** thin HTTP registry/transport, private due worker adapter/manifest, docs/status/checkpoint; integration of minimal finance primitive ownership with upcoming T06.
4. **UI agent:** customer/admin package pages/forms and actual browser journeys using published DTOs, no domain or DB files.

Private core helper proposal: `package_begin/finish` reuse command-results/audit/outbox invariants; `package_lock_learner`; `package_lock_purchase`; `package_assert_scope`; `package_append_movement`; `package_allocate_available`; `package_transfer_available`; `package_balance`; `package_assert_acyclic_transfer`; `finance_post_balanced`; `finance_issue_charge`; `package_contract_dto`; `package_coverage_quote`. No generic privileged function receives actor/settled assertions from a public wrapper.

### Test and delivery sequence

- [ ] Write/run RED pure integer vectors: all quantity/value movements, zero-value lots, half500 consumption, residual sequences, batch tie-break, overflow/fractional rejection.
- [ ] Write/run actual Auth RED purchase and grant tests: issued real charge/balanced non-cash posting, no scheduled grant while pending, admin bonus cannot pay charge, policy/env rejection, direct forged fields, guardian scope/revocation and idempotency.
- [ ] Implement core and run focused GREEN; verify grants/RLS/search_path/ownership with the existing guarded verifier. Record actual generated migration names and preserve applied checksums.
- [ ] Write/run concurrent independent connection tests with observed lock barriers: last1000 units to two enrollments, reserve vs transfer, consume/release contention, two cycle-forming transfers, and idempotent retries.
- [ ] Implement proposal types and consent consumption; test full named50000→57500 and25000→57500 no inferred debt, value-mode7500/32500 top-up, partial named without explicit service terms rejected, stale/revoked/expired consent rejected, confidentiality across dual roles.
- [ ] Exercise private consumption/restore kernel only with declared synthetic historical decision fixtures while qualification hooks unavailable; preserve full acceptance catalogue not_run/awaiting integration status.
- [ ] Actual desktop/mobile browser journeys: pending purchase, zero-valued bonus, approved valued subsidy bonus, reserve/renew/transfer histories, guardian sibling isolation, admin policy approval, conflict/replay affordances, no premature funding confirmation.
- [ ] Focused lint/types/build plus core/package SQL/browser checks, root review and scoped commit. Record T05 awaiting_T06_integration with specific deferred full cases and T08 delivery dependency. No full funded/revenue/refund acceptance claim until those actual combined checks execute.

This contract records interface/design decisions only. It is not evidence that a T05 test or implementation has run.

## Frozen UI and proposal supplements (T04 commit 57a8a89; T05 implementation authorized)

These exact additions resolve the selector/consent gaps without manual IDs or client-calculated money:

- `list_my_package_learners(p_cursor=null,p_limit=25)` -> Page<{learner_id,display_name}>; GET /me/package-learners; own learner plus current guardian `payments` scope. Booking-only learner enumeration is not reused.
- Package contract DTO adds `eligible_offers:[{offer_id,title,format,duration_minutes,availability:'currently_published'|'historical'|'unavailable'}]`. A historical purchase uses its saved permitted label; a never-published/unavailable offer is labeled unavailable without disclosing draft title. Contract hash uses approved contract fields, not mutable display labels.
- `list_package_enrollments(p_learner_id,p_state=null,p_cursor=null,p_limit=25)` -> Page<{enrollment_id,version,learner_id,occurrence_id,offer_id,title,start_at,end_at,state,is_provisional,quote_id,quote_version,quote_hash,customer_price_minor,currency}>; GET /package-enrollments. Admin or current learner/guardian with both booking and payments scopes. This is the actual record selector for package coverage; no raw enrollment UUID input.
- `get_package_coverage_options(p_enrollment_id,p_package_id=null,p_credit_quanta=null,p_cursor=null,p_limit=25)` -> `{enrollment:{enrollment_id,version,learner_id,quote_id,quote_version,quote_hash},current_coverage:PackageCoverage|null,items:CoverageOption[],next_cursor}`; GET /enrollments/{id}/package-options. Both booking and payments scopes or admin; exact optional requested quantity supports partial previews. Each `CoverageOption={package_purchase_id,version,title,contract_version_id,coverage_rule,available_credit_quanta,required_credit_quanta,requested_credit_quanta,max_reservable_credit_quanta,carrying_value_minor:null|minor,standalone_reference_price_minor,agreed_top_up_minor:null|minor,eligible,reason,requires_proposal,requires_admin_review,coverage_proposal_id:null|uuid}`. Reason enum: `ELIGIBLE|INSUFFICIENT_ENTITLEMENT|EXPIRED|OFFER_INELIGIBLE|FORMAT_INELIGIBLE|DURATION_CONVERSION_REQUIRED|QUOTE_NOT_ACCEPTED|PROVISIONAL_ENROLLMENT|PARTIAL_NAMED_REQUIRES_REVIEW|VALUE_TOP_UP_CONSENT_REQUIRED|STATE_CONFLICT`. All monetary previews derive on server; unknown partial named price is null, never zero by assumption.
- `list_package_operation_proposals(p_learner_id=null,p_state=null,p_cursor=null,p_limit=25)` -> Page<PackageProposalSummary>; GET /package-proposals; current admin or currently authorized participant. Coverage requires both booking and payments scopes; conversion and renewal require payments scope. Summary `{proposal_id,kind:'package_coverage'|'package_conversion',learner:{learner_id,display_name},target_type:'enrollment'|'package_purchase',target_id,state,version,expires_at,can_accept}`. Full detail uses existing get_operation_proposal with explicit customer/admin view. Package summary/detail additionally expose `pending_proposals:[{proposal_id,kind:'package_coverage'|'package_conversion'}]` scoped to that learner/package. Existing booking operation links dispatch package kinds to the package proposal view.

`create_operation_proposal` requested_terms additions (outer target_id/expected_version retain the target aggregate semantics):

1. package_coverage: `{target_type:'enrollment',package_purchase_id,expected_package_version,credit_quanta,remaining_service_price_minor:null|minor,expires_at}`. Current learner/guardian may create full named/value-mode review using null remaining-service price; only admin may author a non-null partial named remaining-service price. Server computes required/remaining service, carrying value and monetary top-up; current immutable quote/lot versions and allocations bind the terms hash. Partial named proposal requires admin approval and learner acceptance before reserve consumes it.

   A customer partial-named request with unknown remaining-service price is durable and has `can_accept:false`. The paired optional fields `replaces_proposal_id:uuid|null` and `expected_replaced_version:positive|null` let an administrator create a new immutable exact-price proposal for the same enrollment/package. Replacement expires the prior unaccepted review request atomically and requires fresh customer consent; it never edits previously accepted terms.
2. package_conversion: `{target_type:'package_purchase',target_package_id:null|uuid,new_contract_version_id,expected_target_version:null|positive,source_credit_quanta,target_credit_quanta,expires_at}`. Admin creates the exact conversion after selecting actual purchases/contracts; source owner/guardian accepts and admin approves. Existing target must match new_contract_version_id. Null target means renewal creates the successor while consuming the proposal. No assigned tutor party is required for conversion of available credits.

Package proposal DTO base uses the existing operation identity/state/terms_hash/expiry/version/required_actions/can_accept, but `policy_version_id` is the pinned package contract; no tutor terms. Customer view has `{view:'customer',terms:CoverageTerms|ConversionTerms}`; admin view has `{view:'admin',terms:CoverageTerms|ConversionTerms,required_acceptances:[{participant_type:'learner',participant_id,accepted_at}]}`. Exact terms fields are in the coverage/conversion section above; `eligibility_changes` is `{removed_offer_ids:uuid[],added_offer_ids:uuid[],old_formats:('private'|'group')[],new_formats:('private'|'group')[]}`.

Conversion keeps paired transfer quantity/value equal at the original source quanta, then appends a referenced signed quantity adjustment with zero value on the target lot. `target_credit_quanta-source_credit_quanta` is explicit. The pure conversion oracle compares BigInt `target_quanta*new_duration_minutes <= source_quanta*old_duration_minutes`; additional service requires a separate approved bonus grant. Default target quantity is floor of that ratio; a smaller explicitly reviewed target may disclose service loss. Exact service delta is integer `service_duration_delta_second_quanta = (target_quanta*new_minutes-source_quanta*old_minutes)*60`, at 1000 second-quanta per second. This avoids falsely rounding a3.6-second difference to an integer second. Source/target quantities and actual carrying value appear separately in transfer history.

Conversion terms also pin `lot_allocations:[{lot_id,source_credit_quanta,target_credit_quanta,value_minor,expires_at}]`. Each child preserves its source value and expiry; a blended total cannot conceal a changed per-lot allocation. Service duration cannot increase for any individual source lot. The proposal rejects an integer allocation that satisfies the aggregate duration constraint but increases a particular lot's service, so accepted terms remain executable without moving value or expiry between sources.

Core helper signatures in `docs/T05-DATABASE-BOUNDARY.md` are accepted. Proposal owner calls `package_coverage_quote`, `package_allocate_available` and `package_reserve_allocations` under frozen locks; proposal code never edits lot counters. Add two hooks owned by the proposal migration, initially fail-closed in core: `package_validate_coverage_proposal(proposal_id uuid,actor uuid,purchase_id uuid,enrollment_id uuid,credit_quanta bigint)->jsonb` and `package_validate_conversion_proposal(proposal_id uuid,actor uuid,source_purchase_id uuid,target_purchase_id uuid,new_contract_version_id uuid,credit_quanta bigint)->jsonb`. They return exact approved current terms plus proposal ID/version/source hash after role/scope/freshness checks. After successful reservation/transfer, the core calls `package_commit_proposal(proposal_id uuid,command_context jsonb)->void` in the same transaction. Null proposal is handled only by the routine already-accepted full coverage/compatible transfer path, never by bypassing exceptional consent. Wrappers hold the approved-proposal row lock until effects commit; replay remains at the command boundary before new consumption.

Ownership: DB owns shared catalog schema2/semantic vectors and core SQL/read DTOs/seed; tooling owns package modules, pure conversion/value oracles, package proposal SQL/strict view union and proposal tests; root owns HTTP/worker/docs; UI owns all components and actual browser journeys. No remaining blocking interface decision identified.

