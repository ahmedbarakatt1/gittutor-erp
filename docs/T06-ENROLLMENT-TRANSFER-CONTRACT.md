# T06 enrollment transfer — staged destination

Status: **bounded same-offer implementation and focused database checks executed; broader checkpoint regression pending**. This supplements the existing booking and financial contracts. The prior checkpoint is `661bc27f6ef1f0c89eadf87323054ba5f996c504`. The implemented transfer slice does not by itself close the T04–T06 integration checkpoint. See [database evidence](T06-DATABASE-EVIDENCE.md).

## Frozen decisions and remaining specifics

1. **Frozen — stage timing:** the initial customer request reserves no destination capacity; an administrator's immutable reviewed replacement creates the destination hold and quote. It is an ordinary held enrollment with a separate transfer link guarding ordinary acceptance and confirmation. The conditional charge is issued only after genuine learner acceptance. Never create two counted destination holds for one logical transfer.
2. **Frozen — destination scope:** future sessions of the same offer. Reuse the current actual paged occurrence picker and enforce the same-offer constraint in SQL. Cross-offer moves are not offered by this slice; do not accept an arbitrary manually entered occurrence reference.
3. **Frozen — reviewed source consequence:** saved policy resolves the source cancellation charge, released cash and explicit entitlement disposition; admin submits the exact bounded `source_tutor_fee_minor` total after withdrawal and selected exact `carryover_allocations`. Both source and destination must have approved fee agreements before review. Unknown results remain non-consentable. Destination assignment/fee are unchanged, pinned and rechecked; ordinary admission requires no fresh destination-tutor acceptance.
4. **Frozen — eligibility at commit:** require the destination's saved funding threshold from actual qualified allocations and expressly accepted original-payer carryover. Normal group formation still applies; a destination may remain forming while other roster requirements are unmet. The source stays active until atomic commit. For a source group with remaining confirmed learners, the reviewed exact fee must preserve the original agreement and remaining charges stay unchanged. A below-minimum source group requires the saved `admin_proposal_with_customer_acceptance` action and records an explicit unresolved operational decision; it never silently reprices remaining learners.
5. **Frozen — package coverage:** source package coverage uses an explicit reviewed disposition `{released_credit_quanta,extinguished_credit_quanta}`; enrollment identity and carrying-value consequences derive on the server. Destination funding is cash from qualified new payments plus expressly authorized carryover until commit. Normal eligible package coverage may be requested after commit. Review copy must explain this practical limit. No source entitlement is silently moved or converted to cash.
6. **Frozen — expiry/source authority:** use the earlier of the saved transfer window, destination hold deadline and source's applicable deadline. Expiry/decline releases conditional capacity and carryover reservations while leaving the source active. If actual new destination money exists, preserve those allocations and record the destination charge as `resolution_required` with an owned funding-resolution event; this is not automatic refund or successful cancellation accounting. Carryover additionally requires current learner transfer authority and the actual payer's exact saved consent. Original qualified allocation evidence remains immutable.

The scoped reads, consent DTOs and review fields below are implemented. The existing `transfer_enrollment` mutation contract remains unchanged. Reviewed source/destination schedule snapshots use their immutable quotes, so later rescheduling does not rewrite the historical accepted presentation. Post-commit additional-payment totals exclude carryover allocations.

## Lifecycle and authority

- Source enrollment, accepted quote, charge and funded/confirmed state remain active throughout proposal review. Creating or accepting a transfer does not cancel the source, release its funds, earn a tutor fee, or provision a destination meeting.
- Reviewed staging creates a distinct ordinary held destination enrollment, quote and separate transfer link. It counts against the destination's physical and saleable capacity and cannot bypass a waiting eligible learner. Its transfer link blocks direct quote acceptance and independent confirmation until commit.
- Customer acceptance binds both the exact destination quote and the exact source cancellation consequence. Derive a genuine destination quote acceptance with existing `acceptance_basis:'operation_proposal'` and `source_terms_hash`, then call `finance_ensure_enrollment_charge`; retain its existing `source_kind:'quote'`. Mark that issued destination charge conditional on the transfer. It does not replace or mutate the source charge.
- Additional funds use the ordinary customer-proof, independent-settlement, actual-payer and current CS-owned allocation workflow against that real conditional destination charge. Allocation can succeed while confirmation returns `TRANSFER_PENDING`.
- Original funds remain allocated to the source until atomic commit. A separate carryover authorization binds exact source allocation portions and the exact destination quote/charge/proposal. It is not an incoming payment, refund, package bonus or new cash journal.
- Actual bound original payers accept only their own carryover intent. Verified payer access survives loss of learner/guardian roles. A learner/guardian cannot accept for another payer, and staff cannot substitute for either party. A guardian accepting financial transfer terms needs current booking and payments scope.
- The source tutor reviews the exact total teaching fee after withdrawal under the saved policy. The existing destination tutor assignment and approved fee remain unchanged and are pinned/rechecked at commit. Adding an ordinary held seat does not create a new destination-tutor acceptance requirement. Admin can inspect both private agreements; the source tutor sees only their own consequence. Customer and payer DTOs never include compensation or internal fee references.
- Admin approval and final commit recheck all current roles/scopes, quote/policy/hold versions, source allocation availability, payer bindings/acceptance, tutor terms, financial reconciliation, both occurrence states/capacity and the exact proposal expiry. Changed terms require a new immutable proposal and fresh affected consent.

At atomic commit: apply the approved source cancellation adjustment, release source package reservations as explicitly reviewed, reverse the pinned carried allocation portions and reallocate the same owned value to the destination, leave any uncarried source release owned by its original payer, activate the accepted destination quote/charge commitment, move the source enrollment to its canonical final state, save predecessor/successor links, and evaluate genuine destination confirmation. Post the related audit/outbox events in that transaction. No second incoming cash posting and no invented tutor earning.

Failed commit leaves source booking, destination commitment and all original financial postings unchanged. A declined/expired transfer frees its conditional destination seat and carryover claims; settled new funds remain traceable to their actual payer and enter explicit charge-resolution/refund handling rather than disappearing.

## Small shared DTO extensions

Use integer minor units, UUIDs, UTC instants and existing strict page envelopes. Names below deliberately distinguish an incoming cash transfer from an enrollment transfer.

| Existing shape | Proposed additive change |
|---|---|
| `CustomerEnrollment` | `transfer_link: null | {proposal_id,role:'source'|'destination',other_enrollment_id,stage:'awaiting_review'|'awaiting_consents'|'awaiting_funding'|'ready'|'committed'|'closed'}`. A source may initially have no staged destination, so `other_enrollment_id` is nullable until staging. Persist successor linkage after commit. |
| Destination `CustomerEnrollment` | Keep its canonical ordinary hold and `is_provisional:false`; the separate transfer link hides ordinary quote acceptance and guards confirmation. UI says “Proposed replacement session”, not “Group amendment”. Existing unrelated provisional semantics stay unchanged. |
| Pending proposal references | Add `kind:'enrollment_transfer'` for transfer-aware routing in source/destination customer, tutor and admin records. Existing operation/amendment/package kinds remain unchanged. |
| `ChargeSummary` | Add `conditional_transfer_proposal_id:UUID|null`; add `awaiting_transfer` to `commitment_state`. Preserve distinct `conditional_amendment_id`, mutually exclusive. Existing title, learner, enrollment, quote and money fields supply payment selectors. |
| Ready `Funding` | Add `conditional_transfer_proposal_id:UUID|null` and reason `TRANSFER_PENDING`. `eligible:false` while conditional even if `financially_eligible:true`. Never count unposted carryover intent as `allocated_minor`. |
| `ConfirmationResult` | Add `TRANSFER_PENDING` reason. Existing result state and occurrence reference remain unchanged. |
| `PaymentPlan.targets` and `PayerIntent.targets` | Add nullable `conditional_transfer_proposal_id`, mutually exclusive with `conditional_amendment_id`. Normal additional-fund allocation targets the actual destination charge; this field identifies its commitment, not the old-charge future-debit reservation path. Bind it and the accepted destination quote in the source-intent hash. |

The destination charge may be absent before customer acceptance. A read must return `null`, not a fabricated zero charge. Customer transfer review shows `planned_carryover_minor`, `accepted_carryover_minor`, actual destination allocations and `additional_required_minor` separately. `additional_required_minor = max(0, required_for_confirmation_minor - posted_additional_minor - planned_carryover_minor)` is the expected new cash assuming the reviewed carryover proceeds. Acceptance and still-unspent source funds are independently required by `can_apply`. The exact reviewed carryover reserves destination receivable capacity: cumulative additional allocations cannot exceed `destination net debt - planned carryover`, even if more money was received. This is not a posted allocation or settlement. Charge balances continue to show actual postings; pending payer consent remains a separate blocker. A changed or declined carryover plan requires an immutable reviewed replacement before its earmark can be reassigned. Only the server computes these limits.

No change is required to the generic single-tutor proposal schema for unrelated reschedules, cancellations or group amendments. Enrollment transfers use the scoped read below; generic proposal lists disclose only the safe routing reference.

## Scoped transfer review

Proposed RPC `get_enrollment_transfer_proposal(p_proposal_id,p_view,p_learner_id default null)`, HTTP `GET /enrollment-transfer-proposals/{id}?view=customer|tutor|admin&learner_id=...`.

Common fields:

```ts
type TransferProposalBase = {
  proposal_id: UUID;
  version: Version; // proposal lifecycle version
  kind: 'enrollment_transfer';
  state: ExistingProposalState;
  expires_at: Instant;
  replaces_proposal_id: UUID | null;
  superseded_by_proposal_id: UUID | null;
  terms_hash: Hash; // exact requested view/current participant
  accepted_at: Instant | null;
  can_accept: boolean;
  required_actions: TransferActionCode[];
};
type BookingSnapshot = {
  enrollment_id: UUID;
  occurrence_id: UUID;
  title: string;
  tutor: { tutor_id: UUID; display_name: string };
  start_at: Instant; end_at: Instant; time_zone: 'Africa/Cairo';
  format: 'private' | 'group'; target_tier: 2 | 3 | 4 | null;
};
```

Customer view `{...base,view:'customer',learner,source,destination,terms,funding}`:

- `source:BookingSnapshot`; `destination:BookingSnapshot|null` until staging.
- `terms` contains source accepted tuition, source retained cancellation charge, exact released cash, explicitly released/extinguished source package quanta/value, destination quote snapshot (`quote_id`, price, currency, policy/pricing versions, public policy, quote hash), and a customer-safe aggregate carryover plan. Destination quote is nullable while unresolved.
- `funding` contains nullable destination charge ID, required destination threshold, actual allocated cash/package value, planned and accepted carryover, amount still required, current source reconciliation state, and aggregate consent counts. It excludes allocation IDs and other payer identities. Return explicit `financial_terms_ready`/`can_accept:false` while any displayed consequence is unknown.
- `required_actions` is a finite safe enum, proposed: `review_source_consequence`, `accept_transfer_terms`, `await_payer_consent`, `await_tutor_consent`, `provide_additional_funding`, `await_admin_approval`, `apply_transfer`, `refresh_stale_terms`, `resolve_funding`, `closed`. Applicability is server-derived, not inferred from nullable money.

Tutor view `{...base,view:'tutor',source_teaching_terms}`:

- Terms contain the source tutor's occurrence ID/time, original agreement/reference/value and exact reviewed total fee after the withdrawal, with the immutable review reference. Unknown private terms are explicit pending values and disable consent.
- Only the currently authorized source tutor can read/accept this view. They do not learn the destination tutor's fee. No payment-source data is present.

Admin view `{...base,view:'admin',customer,source_teaching_terms,destination_fee_snapshot,required_acceptances,carryover_page,can_apply,blockers,source_version}`:

- `customer` is the safe customer terms projection; private source review and destination fee snapshot are separate. Destination snapshot is a recheck dependency, not another required acceptance.
- Required learner/source-tutor acceptances have stable participant references and current status. Payer status derives from the separate carryover intents, never a generic learner/tutor acceptance.
- `carryover_page` is paged actual source allocations, with safe source reference, masked payer label, released/carryable amount and selected exact carryover. It contains the first25 and a real cursor. Admin-only `list_enrollment_transfer_sources(p_proposal_id,p_cursor,p_limit)` / `GET /enrollment-transfer-proposals/{id}/sources` supplies continuation. This supports structured review without raw UUID entry. Only admin sees all owners together.
- `source_version` is the current source enrollment version expected by the unchanged transfer mutation, not the proposal version. `can_apply` and finite `blockers` reflect live authoritative predicates.

Do not encode missing financial readiness as zero or make an unreviewed snapshot look final. The database owner agreed the field candidate below, including nullable whole `terms`/`funding` while unresolved.

Agreed field shapes (all objects strict):

```ts
type TransferCustomerTerms = {
  source_quote_id: UUID;
  source_policy_version_id: UUID;
  source_customer_policy: PublicPolicySummary;
  source_customer_price_minor: Minor;
  source_retained_charge_minor: Minor;
  source_charge_adjustment_minor: SignedMinor;
  source_cash_release_minor: Minor;
  source_package_disposition: null | {
    released_credit_quanta: Quanta; extinguished_credit_quanta: Quanta;
    released_value_minor: Minor; extinguished_value_minor: Minor;
  };
  destination_quote: Quote; // genuine staged enrollment/quote, public projection
  planned_carryover_minor: Minor;
  currency: 'EGP';
};
type TransferFunding = {
  destination_charge_id: UUID | null;
  required_for_confirmation_minor: Minor;
  planned_carryover_minor: Minor;
  accepted_carryover_minor: Minor;
  posted_additional_minor: Minor;
  additional_required_minor: Minor;
  carryover_required_count: number;
  carryover_accepted_count: number;
  can_receive_additional_payment: boolean;
  reconciliation_state: 'clear' | 'requires_review';
};
type TransferSourceTeachingTerms = {
  tutor_id: UUID; occurrence_id: UUID;
  start_at: Instant; end_at: Instant; time_zone: 'Africa/Cairo';
  source_fee_agreement_id: UUID;
  old_fee_minor: Minor;
  reviewed_fee_minor: Minor; // exact total after withdrawal, not a new earning
  review_id: UUID;
  currency: 'EGP';
};
type TransferCarryoverOption = { // admin only, paged
  allocation_id: UUID; transfer_id: UUID;
  source_reference: string; payer_masked_label: string;
  releasable_minor: Minor; selected_carryover_minor: Minor;
  currency: 'EGP';
};
```

These names are an agreed wire contract, not yet implemented exports. `source_package_disposition:null` authoritatively means no source reservation; otherwise all four exact fields are required. A source/destination without a current approved fee cannot be reviewed; a completed source teaching row therefore has a real agreement/value. Consumed package entitlement is outside this future-session slice and must fail closed. Admin `destination_fee_snapshot` reuses the existing strict `FeeAgreement` projection. The requested destination remains visible before staging through a separate `requested_destination:PublicOccurrence & {title:string}` (existing public tutor labels included); `destination:BookingSnapshot|null` identifies an actual held seat only.

Proposed dedicated strict review response: existing command envelope plus `{proposal_id,new_enrollment_id,destination_quote_id,replaces_proposal_id}`. The scoped read supplies current hashes, expiry and required actions. `replaces_proposal_id` is required for reliable handoff from the initial request. First creation returns201 and replay200. Learner/source-tutor accept/decline and admin approval retain existing operation-proposal envelopes. Payer carryover acceptance returns the command envelope plus `{consent_id,state:'accepted',accepted_at}`; decline returns `{consent_id,state:'declined'}`. Exact expected-version owners are proposal for review/ordinary acceptance/approval, consent for payer actions, and source enrollment for the unchanged final transfer command.

## Original-payer carryover consent

Proposed independent entity `EnrollmentTransferConsent`, one intent per actual payer per immutable reviewed proposal (multiple owned source portions may be included):

```ts
type EnrollmentTransferConsent = {
  consent_id: UUID; version: Version; proposal_id: UUID;
  state: 'awaiting_acceptance'|'accepted'|'declined'|'invalidated'|'consumed'|'expired';
  source_booking_reference: string;
  destination_booking_reference: string;
  destination_charge_id: UUID;
  destination_quote_id: UUID;
  sources: Array<{transfer_id:UUID; channel:Channel; amount_minor:Minor}>;
  carryover_minor: Minor; currency: 'EGP';
  terms_hash: Hash; expires_at: Instant; accepted_at: Instant | null;
  can_accept: boolean;
};
```

The source references and amounts are only the current account's actual funding. No learner name/profile, private teaching terms, other payer source or payment credentials appear when learner scope is absent. The immutable hash also binds private source allocation IDs/versions, original payer binding, reviewed source release, destination quote/charge/proposal and exact total; those private bindings need not be returned to the browser. Acceptance cannot expand an amount. Create these intents only after genuine learner acceptance creates the real conditional destination charge; no pre-charge payer intent is exposed.

Proposed endpoints:

| HTTP | RPC / action | Scope |
|---|---|---|
| `GET /me/enrollment-transfer-consents?state&cursor&limit` | `list_my_enrollment_transfer_consents` | Any current verified actual source payer, independent of learner roles |
| `GET /enrollment-transfer-consents/{id}` | `get_enrollment_transfer_consent` | Exact actual payer; admin reads scoped consent status through transfer review |
| `POST /enrollment-transfer-consents/{id}/accept` | `accept_enrollment_transfer_consent(consent_id,terms_hash,expected_version,key)` | Actual payer only |
| `POST /enrollment-transfer-consents/{id}/decline` | `decline_enrollment_transfer_consent(consent_id,reason,expected_version,key)` | Actual payer only |

All mutable commands use persisted idempotency keys and exact hashes/current versions. Each carryover portion is claimed by at most one current transfer intent; no simultaneous refund, correction or second transfer can spend it. At commit recheck source binding, unreturned/unreversed amount and current accepted intent. A source change invalidates stale consent rather than silently reducing its amount.

The reviewed split is already pinned in the proposal before learner acceptance. Creating the payer intents after charge issuance binds the actual destination charge without editing an existing accepted intent.

## Routes and UI reuse

1. `/learn/bookings/{sourceId}` retains Request a change and its actual paged destination picker. Initial success states exactly whether capacity was staged. Current source details remain visible.
2. Transfer-specific review appears from the safe pending reference. It compares source cancellation consequence and destination terms, then uses the existing `POST /operation-proposals/{id}/accept` or `/decline` with the scoped transfer hash/current proposal version. The dispatcher must select the exact authorized participant by hash, not default to the account's highest role.
3. A conditional destination booking links back to the source and proposal, hides ordinary acceptance and confirms “The original session remains booked until the transfer is applied.” Once the genuine destination charge exists, its existing `/learn/payments/charges/{id}` instructions and receipt flow are usable.
4. `/learn/payments` adds the source-owned carryover request list. `/learn/payments/enrollment-transfer-consents/{id}` is a verified-account page with no student-role gate, one exact consent form and live expiry display. Extend the bounded login return-path allowlist for this exact UUID route only.
5. The source tutor and relevant admin schedules expose transfer pending references. Their transfer-specific reviewer retains native disclosure state and renders source teaching terms; admin additionally sees the pinned destination agreement. Admin chooses any permitted source split/fee consequence from real record selectors, never JSON or raw IDs. Destination tutor has no new consent action while their existing assignment/fee is unchanged.
6. Admin immutable review command: `POST /enrollment-transfer-proposals/{id}/review`, `review_enrollment_transfer_proposal(proposal_id,source_tutor_fee_minor,carryover_allocations:[{allocation_id,amount_minor}],source_package_disposition?:{released_credit_quanta,extinguished_credit_quanta},reason,expected_version,key)`. It returns the new reviewed proposal/staged destination references. `source_tutor_fee_minor` is the reviewed total after withdrawal, not an extra earning. Empty carryover is allowed; source amounts and explicit package disposition remain authoritatively bounded. Reviewing terms does not apply the transfer.
7. Admin approval reuses `POST /operation-proposals/{id}/approve` with the admin transfer hash. Final Apply transfer reuses unchanged `POST /enrollments/{sourceId}/transfer` with `{destination_occurrence_id,accepted_proposal_id,expected_version:source_version}`. UI enables it only from live `can_apply`; SQL rechecks everything. Success uses returned `new_enrollment_id`, then reads actual status rather than assuming confirmed.

The generic `get_operation_proposal` response must not falsely expose transfer terms through the old single-tutor contract. Pending references can route directly to the new read. Freeze whether direct legacy transfer lookup returns an explicit safe typed routing response or the new union branch; unrelated proposals remain unchanged.

## Existing helper seams and boundaries

- Reuse `finance_ensure_enrollment_charge` after deriving a real destination quote acceptance from the current transfer-proposal acceptance. Preserve existing `source_kind:'quote'`; add the separate conditional transfer commitment. `finance_ensure_amendment_charge` is a useful conditional-account reference, but must not be invoked with a transfer proposal.
- Existing `finance_qualified_proof`, receipt author checks, current case ownership, source binding and payment-plan acceptance can qualify **additional** settled funds for the conditional destination charge. Their target/hash validation must bind the transfer commitment and accepted destination quote. Ordinary allocation must not auto-confirm a conditional seat.
- Existing `finance_discover_scope` / ordered graph locks and allocation reversal/new-allocation helpers should own carryover conservation. Expand both source and destination scope before acquiring locks; never lock destination booking after source money locks. A changed graph yields the existing explicit retryable rollback outcome.
- `booking_resolve_funding_basis` can retain its ordinary quote basis while exposing/rechecking the separate transfer link and proposal-derived acceptance. `booking_try_confirm_locked` must return pending for staged transfers even if money is sufficient. Direct quote acceptance and package operations must recheck the transfer link rather than rely on `is_provisional` or a group-amendment hold kind.
- The current source enrollment state enum has no `transferred` member. Retain the canonical cancelled/final state with durable predecessor/successor/proposal linkage rather than inventing a new state in one UI.

## Financing-hold compatibility (existing UI)

The existing administrator exception workflow already calls `POST /packages/{id}/resolve-financing-hold` with `{reason,evidence_file_id,expected_version}` and a persisted idempotency key. Expected version is the fresh package summary version, not a financial exception or evidence version. Strict result is common command/resource/version fields plus `{state:'clear'|'held',released_original_lot_ids:UUID[]}`.

Evidence is selected by action `resolve_package_financing_hold`, target package ID; it is eligible current admin evidence with purpose `financing_hold`, parent type `package_purchase`, exact parent ID. A selected file is not proof that source funds have recovered. SQL independently checks restored pinned purchased/approved-credit origins and all descendants, retains other unresolved holds, preserves original movements and confirmed meetings, and leaves valid subsidy origins unaffected. The UI reloads package/exception records and uses neutral “decision recorded” copy. Partial resolution must remain visibly held if any relevant origin remains blocked.

## Required executed evidence after contracts freeze

No result below is currently marked passed for this new slice:

- Exact learner quote/source consequence acceptance, original payer consent with zero learner roles, source tutor privacy/acceptance, unchanged destination-assignment/fee rechecks and admin apply.
- Destination capacity collision, expiry, source version/quote/policy change, stale or revoked guardian authority, payer-binding change, source reversal/refund conflict, and simultaneous competing carryover claims.
- Additional payment to the conditional destination charge does not remove/confirm the source or confirm the destination; declined/expired transfer preserves received funds and exposes the saved resolution path.
- Atomic fault/retry at source adjustment, carryover reversal/reallocation, destination activation and outbox boundaries: no partial move, duplicate cash or second credit benefit.
- Same-key replay and changed-body conflict; current pending references and durable successor links survive reload.
- Customer/payer HTML, DTOs, downloaded assets and eventual exports/email allowlists contain no compensation, internal source evidence or other payer identity.
- Desktop/360px browser walkthrough and scoped CLI review only after the actual SQL/DTO/HTTP paths exist. Acceptance manifest remains unchanged until the owning checks execute.
