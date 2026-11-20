# T04 booking implementation contract

Prepared 2026-11-11 from the T04 plan, business rules 2–4, data/API/UI/security contracts, T04 acceptance cases and GT-1205/GT-1209. T04 implementation follows T03 commit `5df05c2b8144c80a360f280b4871eab2fbd8c05e`. This document defines the agreed implementation boundary; execution results belong in the implementation status and evidence logs.

## Agreed invariants and implementation boundaries

- DB and TS agree ISO weekday 1=Monday through 7=Sunday, `Africa/Cairo`, same-day half-open availability intervals; date exceptions replace the entire local date. Empty exception intervals mean time off.
- Availability aggregate starts at version 0 when absent; first successful set with expected_version 0 creates version 1. Other mutable versions start at 1.
- Tutor scheduling resource lock precedes occurrence lock, enrollment/quote locks, then funding locks. Availability edit, occurrence create/reschedule and confirmation share the tutor lock. A GiST exclusion constraint prevents overlapping active tutor reservations. An edit excludes only its own occurrence from overlap detection.
- Scheduled forming meetings reserve the tutor interval even after their learner holds expire. An availability change cannot silently remove an existing scheduled commitment.
- Ordinary reservations count confirmed seats plus unexpired ordinary holds and stop at `min(capacity,target_tier)` for groups, 1 for private. Extra seats are provisional amendment holds only, still within physical capacity. Confirmation requires exactly the target roster and never chooses an arbitrary subset. Root approved this decision.
- Each enrollment has its own version. Ordinary hold creation, acceptance, expiry and promotion do not increment occurrence.version. Schedule/capacity/target/committed-roster changes and initial fee attachment do. A separate internal `occurrence.quote_terms_version` changes only for customer schedule/target/policy/price terms. Quote acceptance checks that counter and the current quote pointer; an unchanged-price capacity edit or initial fee attachment does not strand the quote. The quote's exposed occurrence_version remains creation provenance. A proposal pins the full occurrence version and an exact locked roster fingerprint of enrollment IDs, states, versions and quote IDs. Quote hashes never depend on unrelated temporary holds.
- Published policy/pricing references, each quote, exact approved fee agreement, accepted proposal terms and acceptances are immutable. Record corrections in new versions. Customer projections never contain fee agreement IDs, compensation-policy IDs, fee/range/contribution, internal notes, contacts, destinations or credentials.
- All mutations use current actor/session/role/relationship scope before replay, persistent key+canonical argument hash, target version where listed, atomic audit and outbox. New creations return 201, changes and replay 200; durable provider work returns 202 only where the result contract says queued work.
- Published session availability and approved tutor profiles require a verified account. Signed-in users also have a paginated schedule read.
- T04 reaches `awaiting_T06_integration`, never verified funded confirmation. The real funding hook is unavailable and fails closed even with a zero deposit; no caller/test flag may assert funded status. T05 and T06 supply package/funds implementations, then all three suites run together.

## Primitive shapes

All objects are strict; unknown fields fail. `UUID`, `Instant`, safe nonnegative `Minor`, positive int32 `Version`, `Hash` (64 lowercase hex), `Key` (1–200 characters) retain the existing conventions. Reasons are trimmed 1–2000 characters. Lists cap page size at 100. No client supplied clock, actor, state, approved flag, computed quote amount or computed refund amount.

```ts
type LocalInterval = { start_local: string; end_local: string }; // HH:mm, 00:00..23:59
type WeeklyInterval = LocalInterval & { weekday: 1|2|3|4|5|6|7 };
type DatedException = { local_date: string; intervals: LocalInterval[] }; // valid YYYY-MM-DD
// start_local < end_local; no overnight rows. Adjacent intervals are allowed.
// Weekly <= 70 rows, exceptions <= 366 dates, <= 10 intervals/date; unique exception dates.
// Reject overlap within each weekday/date. Canonical sort weekday/date then start/end before hashing.

type OccurrenceState = 'draft'|'forming'|'confirmed'|'in_progress'|'completion_pending'|'completed'|'cancelled';
type EnrollmentState = 'held'|'confirmed'|'expired'|'cancelled';
type WaitlistState = 'waiting'|'offered'|'accepted'|'expired'|'cancelled'|'ineligible';
type ProposalState = 'proposed'|'accepted'|'approved'|'committed'|'declined'|'expired';
type View = 'customer'|'tutor'|'admin';
type Page<T> = {items:T[];next_cursor:string|null};
type C = {command_id:UUID;resource_id:UUID;version:Version};
```

Persist source local rules plus resolved UTC occurrence instants. Create/reschedule require `time_zone:'Africa/Cairo'`, end after start and elapsed UTC duration exactly matching the saved offer. The assigned tutor must be current, active, publicly approved for the offer subject and available throughout the whole interval. Reject invalid/out-of-range times before integer casts.

TS will use the existing runtime's `Intl.DateTimeFormat(...).formatToParts()` for UTC-to-Cairo fields and an explicit round-trip candidate resolver for local form values, without a new dependency. A skipped local time yields no candidate; a repeated time requires explicit selection of an offset-bearing instant. Do not silently use the machine timezone. PostgreSQL validates the submitted instant with explicit `AT TIME ZONE 'Africa/Cairo'`. Test Cairo date boundaries, DST candidates, adjacency, overlap and elapsed duration in TS and SQL. This supports T04 and provides groundwork for GT-301; the full T07 case stays pending.

Official API references consulted: [ECMA-402 DateTimeFormat](https://tc39.es/ecma402/#sec-intl.datetimeformat.prototype.formattoparts), [PostgreSQL 17 date/time operators](https://www.postgresql.org/docs/17/functions-datetime.html). Node is already pinned to 24.22.1; record actual ICU/tz versions in later test evidence. No additional dependency is planned.

## Mutation RPCs and routes

SQL parameters use `p_` prefixes for every field below. `key` means `p_idempotency_key text`; IDs are uuid, versions integer, money bigint, instants timestamptz, array fields uuid[], structured fields jsonb. A route's ID is included in the hash. Body `expected_version` enters `p_expected_version`.

| Route | RPC arguments after p_ prefix | Result beyond C | Version meaning |
|---|---|---|---|
| POST /availability | set_availability(tutor_id,weekly_intervals,dated_exceptions,reason,expected_version,key) | conflicting_occurrence_ids:UUID[] (empty on success) | availability; 0 allowed initially |
| POST /occurrences | create_occurrence(offer_id,tutor_id,start_at,end_at,time_zone,target_tier,key) | occurrence_id,state | creation; target null private, 2/3/4 group; initial match published offer |
| POST /occurrences/{id}/holds | reserve_enrollment(occurrence_id,learner_id,key) | enrollment_id,hold_expires_at,quote_id,customer_price_minor,currency | new seat; current occurrence pinned under lock |
| POST /quotes/{id}/accept | accept_quote(quote_id,quote_hash,expected_version,key) | accepted_at | quote version; quote must still be current and unexpired |
| POST /occurrences/{id}/confirm | confirm_occurrence(occurrence_id,expected_version,key) | state,confirmed_enrollment_ids,meeting_status | occurrence; T04 fails closed at funding boundary |
| POST /occurrences/{id}/capacity | change_occurrence_capacity(occurrence_id,capacity,reason,expected_version,key) | capacity | occurrence; supplementary contract |
| POST /occurrences/{id}/waitlist | join_waitlist(occurrence_id,learner_id,key) | waitlist_entry_id,state | creation; explicit consent, never automatic on hold failure |
| POST /waitlist/{id}/leave | leave_waitlist(waitlist_entry_id,expected_version,key) | state | waitlist entry |
| POST /occurrences/{id}/fee-agreements | approve_tutor_fee(occurrence_id,tutor_id,fee_minor,currency,duration_minutes,compensation_policy_version_id,target_tier,purpose,reason,expected_version,key) | fee_agreement_id | occurrence; supplements target_tier/purpose |
| POST /occurrences/{id}/amendments | propose_group_amendment(occurrence_id,add_learner_ids,remove_enrollment_ids,target_tier,fee_agreement_id,replacement_policy_version_id,expires_at,reason,expected_version,key) | amendment_id,affected_quote_ids | occurrence; replacement_policy_version_id explicit |
| POST /amendments/{id}/accept | accept_group_amendment(amendment_id,terms_hash,expected_version,key) | accepted_at | immutable amendment terms version |
| POST /amendments/{id}/decline | decline_group_amendment(amendment_id,reason,expected_version,key) | state | affected learner/tutor or admin; releases only provisional holds |
| POST /amendments/{id}/commit | commit_group_amendment(amendment_id,expected_version,key) | occurrence_version,charge_adjustment_ids | amendment; also checks pinned occurrence+roster; T04 fails closed |
| POST /operation-proposals | create_operation_proposal(kind,target_id,requested_terms,reason,expected_version,key) | proposal_id,terms_hash,expires_at,required_actions | target aggregate; requested_terms below |
| POST /operation-proposals/{id}/accept | accept_operation_proposal(proposal_id,terms_hash,expected_version,key) | accepted_at | proposal terms version |
| POST /operation-proposals/{id}/decline | decline_operation_proposal(proposal_id,reason,expected_version,key) | state | affected learner/tutor; admin uses approval decision |
| POST /operation-proposals/{id}/approve | approve_operation_proposal(proposal_id,terms_hash,decision,reason,expected_version,key) | approval_id,state | proposal; decision approved/rejected |
| POST /enrollments/{id}/cancel | cancel_enrollment(enrollment_id,reason,remedy_proposal_id,expected_version,key) | state,remedy_id:null|UUID | enrollment |
| POST /occurrences/{id}/reschedule | reschedule_occurrence(occurrence_id,start_at,end_at,time_zone,reason,accepted_proposal_id,expected_version,key) | meeting_status,calendar_job_id | occurrence |
| POST /occurrences/{id}/cancel | cancel_occurrence(occurrence_id,reason,remedy_proposal_id,expected_version,key) | state,affected_enrollment_ids | occurrence |
| POST /enrollments/{id}/transfer | transfer_enrollment(enrollment_id,destination_occurrence_id,accepted_proposal_id,expected_version,key) | state,new_enrollment_id,charge_adjustment_ids | enrollment; T06 financial checkpoint, supplemental command |

Roles follow the original contract. Capacity, occurrence create/confirm/cancel/reschedule, fee approval and amendment create/commit are admin-only. Reserve/join/leave/quote acceptance require current learner booking scope. A tutor can edit only their own availability; admin selects any current tutor. Enrollment cancellation requires learner booking scope or admin. No staff-case read is enabled until a real CS case exists.

Capacity edits require target_tier <= capacity <= immutable policy group_capacity, private capacity=1, and capacity >= every confirmed/unexpired ordinary/provisional seat. They never change target/price. A blocked availability edit returns SCHEDULE_CONFLICT without mutation; safe field_errors may contain only conflicting occurrence IDs the caller can inspect. Shared scheduling conflict checks use server time and lock ordering.

`approve_tutor_fee.purpose` is initial|amendment. Initial approval attaches the first exact current-tutor/current-target/current-bundle agreement to a forming occurrence. It cannot overwrite an existing active agreement. Amendment approval creates immutable proposed evidence only, including same-tier fee changes, and cannot alter active compensation. Save fee, currency, duration, target, bundle reference, occurrence/base version, tutor, approving actor/time. Validate all bounds through T03's helper. Proposal commit in T06 replaces the active pointer and appends appropriate adjustment lineage atomically. No customer DTO includes the agreement reference.

Creating or accepting a quote/proposal has no cash/ledger effect. For T04, a hold is a seat reservation with an agreed quote, not a posted invoice. Its quote expires with the server-derived hold expiry, bounded by the saved confirmation deadline. A retry with the same key returns the original seat; a different-key duplicate learner seat fails without a second enrollment. UI first reviews the published terms, then reserves the timed hold and explicitly accepts its newly created exact quote; the existing RPC contract cannot accept a quote that has not yet been created. Explain hold expiry through both steps.

## Typed operation and amendment terms

```ts
type RequestedReschedule =
  | {target_type:'occurrence';start_at:Instant;end_at:Instant;time_zone:'Africa/Cairo';expires_at:Instant}
  | {target_type:'enrollment';destination_occurrence_id:UUID;expires_at:Instant};
type RequestedCancellation = {
  target_type:'enrollment'|'occurrence';
  remedy:'policy_default'|'cash_refund'|'monetary_account_credit'|'package_entitlement_restoration';
  expires_at:Instant;
};
// kind reschedule -> RequestedReschedule; kind cancellation_remedy -> RequestedCancellation.
// T05 adds package_coverage/package_conversion as separate strict unions, not arbitrary JSON.
```

The server computes consequences from current accepted quote/policy records. Requested JSON never accepts money, a fee, a coverage assertion, required party lists, base version overrides, acceptance/approval metadata or compensation. A learner requests their own enrollment transfer, not a unilateral move of an entire group. Only admin/assigned tutor may propose a whole group occurrence move; private learners may request their own private occurrence move. A tutor cannot request an individual customer's cash remedy. Admin can propose affected occurrence/seat cancellation; customer can propose only own seat cancellation. Actual funded remedy calculation/consumption and enrollment transfer remain unavailable until T06.

Each proposal records target type/id/version, pinned policy, exact roster fingerprint, immutable terms, server creation and validated future expiry. Expiry is no later than affected scheduled start; group amendments additionally obey the saved latest-amendment cutoff and acceptance window. Required parties are derived from the affected learner scopes and assigned tutor. One acceptance per participant scope is required, not one account total: a guardian with two affected learners accepts each learner's distinct scoped hash. Each acceptance rechecks current scope. Accepting does not increment the shared immutable terms version or invalidate another participant. Admin approval requires current exact party acceptances. A changed roster/schedule/target, expired window, revoked scope or stale quote fails closed and requires a new proposal.

Amendments retain current roster/quotes/policy/active fee until commit. Added learner seats are explicitly marked provisional and bounded by capacity. Customer replacement quotes use the requested approved replacement policy/pricing, compatible format/duration/currency/target. The current policy is allowed only when actually compatible; never select an implicit newest policy. Original quotes/acceptances remain historical. The occurrence retains its actual offer_id; package eligibility uses that actual offer identity even when terms change, and T05 may require an explicit coverage proposal. Removed learners keep their existing active seats until successful commit; their terms include the proposed cancellation/remedy. Expiry/decline releases only provisional holds and queues a funds-resolution intent without modifying independent money. Invalidated proposals enter canonical expired with a private invalidation reason; admin decision rejected maps to canonical declined. Accepted means every required party has accepted current terms, before administrative approval/commit.

The admin's commit is approval+commit for group amendments. Operation proposals have an explicit approval record; reschedule/cancel/transfer consumes the approved, current, fully accepted proposal exactly once in the same transaction as its effects. Financial paths remain blocked until T06. A no-obligation held seat may be released locally; unknown financial integration state must never be assumed to mean zero money. Empty/no-enrollment occurrences may be rescheduled/cancelled locally. For populated occurrences, commit requires the relevant accepted schedule terms and a real no-financial-change classification or the T06 hook.

## Read DTOs and exact query signatures

All pages use stable ordering and cursor+limit (1..100); no raw tables. Schedule ordering is `(start_at,id)` ascending; histories/queues use `(created_at,id)` ascending. Default time window is now through now+90 days when absent, and explicit windows satisfy from<to; historical customer records can be requested with explicit from/to. Exact occurrence-ID lookup omits implicit time-window limits, while honoring explicit limits and all existing role, assignment, offer-publication and public future-occurrence constraints. Inputs are filtered and scoped inside SQL, not after fetching.

```ts
type PublicOccurrence = {
  occurrence_id:UUID;version:Version;offer_id:UUID;
  tutor:{tutor_id:UUID;display_name:string};
  start_at:Instant;end_at:Instant;time_zone:'Africa/Cairo';
  state:'forming'|'confirmed';format:'private'|'group';target_tier:2|3|4|null;
  capacity:number;available_seats:number;waitlist_available:boolean;
  customer_price_minor:Minor;currency:'EGP';policy_version_id:UUID;pricing_version_id:UUID;
};
type Funding = {
  integration_state:'awaiting_T06_integration'|'ready';eligible:boolean;reason:string;
  charge_id:UUID|null;net_charge_minor:Minor|null;allocated_minor:Minor|null;
  balance_minor:Minor|null;required_for_confirmation_minor:Minor;
  reserved_credit_quanta:number|null;allocated_package_value_minor:Minor|null;top_up_minor:Minor|null;
};
type Quote = {
  quote_id:UUID;version:Version;enrollment_id:UUID;learner_id:UUID;
  occurrence_id:UUID;occurrence_version:Version;start_at:Instant;end_at:Instant;time_zone:'Africa/Cairo';
  target_tier:2|3|4|null;customer_price_minor:Minor;currency:'EGP';
  policy_version_id:UUID;pricing_version_id:UUID;customer_policy:PublicPolicySummary;
  quote_hash:Hash;expires_at:Instant;accepted_at:Instant|null;is_current:boolean;
};
type CustomerEnrollment = {
  enrollment_id:UUID;version:Version;learner:{learner_id:UUID;display_name:string};
  occurrence:PublicOccurrence;state:EnrollmentState;hold_expires_at:Instant|null;is_provisional:boolean;
  quote:Quote;funding:Funding;meeting_status:'not_requested'|'pending'|'ready'|'failed'|'revoked';
  authorized_file_ids:UUID[]; // [] until T07, never fake file metadata
  pending_proposals:{proposal_id:UUID;kind:'operation'|'amendment'}[];
};
type Availability = {
  tutor_id:UUID;version:number;time_zone:'Africa/Cairo';weekly_intervals:WeeklyInterval[];
  dated_exceptions:DatedException[];committed_occurrence_ids:UUID[];
};
type FeeAgreement = {
  fee_agreement_id:UUID;occurrence_id:UUID;occurrence_version:Version;tutor_id:UUID;
  target_tier:2|3|4|null;fee_minor:Minor;currency:'EGP';duration_minutes:number;
  compensation_policy_version_id:UUID;purpose:'initial'|'amendment';is_current:boolean;
  approved_at:Instant;accepted_at:Instant|null;
};
```

Public occurrence fields are customer safe, not privileged aggregates. `available_seats` is a snapshot and zero for confirmed groups unless a future valid amendment flow permits entry; it is not a capacity guarantee. No learner roster is public. The verified-account catalog availability object is `{scheduled_occurrences,next_start_at,next_occurrences:PublicOccurrence[],has_more:boolean}`, with next_occurrences limited to 5; logged-in users use paginated schedule discovery. Only eligible published/effective offers and operational future occurrences appear.

| GET route | RPC parameters | DTO |
|---|---|---|
| /booking/occurrences | list_offer_occurrences(p_offer_id,p_from=null,p_to=null,p_cursor=null,p_limit=25,p_occurrence_id=null) | Page<PublicOccurrence>, verified user; published offer required |
| /me/learners | list_my_booking_learners(p_cursor=null,p_limit=25) | Page<{learner_id,display_name}>, current own/guardian booking scope only; supplementary read |
| /me/enrollments | list_my_enrollments(p_learner_id=null,p_from=null,p_to=null,p_state=null,p_cursor=null,p_limit=25) | Page<CustomerEnrollment>, current own/guardian booking scope |
| /enrollments/{id} | get_enrollment(p_enrollment_id) | CustomerEnrollment; always customer projection, even admin viewing customer route |
| /quotes/{id} | get_quote(p_quote_id) | Quote; authorized own learner or admin, always customer projection |
| /me/waitlist | list_my_waitlist(p_learner_id=null,p_state=null,p_cursor=null,p_limit=25) | Page<{waitlist_entry_id,version,learner_id,occurrence:PublicOccurrence,state,position:number|null,offered_enrollment_id:UUID|null,offer_expires_at:Instant|null}> |
| /tutor/availability | get_tutor_availability() | Availability; own current tutor |
| /tutors/{id}/availability | get_admin_tutor_availability(p_tutor_id) | Availability; admin |
| /tutor/fee-agreements | list_tutor_fee_agreements(p_from=null,p_to=null,p_cursor=null,p_limit=25) | Page<FeeAgreement>; own immutable compensation ownership |
| /occurrences/{id}/fee-agreements | list_admin_fee_agreements(p_occurrence_id,p_cursor=null,p_limit=25) | Page<FeeAgreement>; admin |
| /tutor/occurrences | list_tutor_occurrences(p_from=null,p_to=null,p_state=null,p_cursor=null,p_limit=25,p_occurrence_id=null) | Page<TutorOccurrence>, current assigned tutor |
| /occurrences | list_admin_occurrences(p_from=null,p_to=null,p_state=null,p_format=null,p_tutor_id=null,p_cursor=null,p_limit=25,p_occurrence_id=null) | Page<AdminOccurrence>, admin |
| /booking/learners | list_booking_learners(p_q=null,p_cursor=null,p_limit=25) | Page<{learner_id,display_name}>, admin; active verified learners, no contacts |
| /amendments/{id} | get_group_amendment(p_amendment_id,p_view='customer',p_learner_id=null) | scoped Amendment below |
| /operation-proposals/{id} | get_operation_proposal(p_proposal_id,p_view='customer',p_learner_id=null) | scoped OperationProposal below |

For lists with omitted learner_id, SQL returns only authorized own/linked learners. A specified unauthorized learner yields scoped NOT_FOUND. T02 currently has only `/learners/{id}`, so the new `/me/learners` supplies the minimum names/IDs collection for customer selection. The admin learner selector supplement avoids manual IDs before the T10 customer register exists. Availability's committed IDs must include every still-active future reservation; actual rows come from existing paginated occurrence lists, not an arbitrary truncated conflict set.

`TutorOccurrence = {occurrence:PublicOccurrence, roster:[{enrollment_id,learner_id,display_name,state}], fee_agreement:FeeAgreement|null, pending_proposals:{proposal_id:UUID;kind:'operation'|'amendment'}[]}`. Tutor roster excludes payment/receipt/private contact details and other tutors' agreements. `AdminOccurrence = {occurrence:PublicOccurrence, roster:[{enrollment_id,version,learner_id,display_name,state,hold_expires_at,quote_id,quote_accepted_at,funding:Funding,provisional_amendment_id:null|UUID}],fee_agreement:FeeAgreement|null,confirmation_deadline:Instant,formation_resolution:{decision_id:UUID,action:'offer_revised_quote_or_cancel'|'cancel_and_resolve_funding',recorded_at:Instant}|null,pending_proposals:{proposal_id:UUID;kind:'operation'|'amendment'}[]}`. Operational admin records may include cancelled/completed states through a separate base occurrence schema; PublicOccurrence remains restricted for discovery, and shared field reuse must not accidentally reject valid historical states.

```ts
type ProposalBase = {
  proposal_id:UUID;version:Version;kind:'reschedule'|'cancellation_remedy';
  target_type:'occurrence'|'enrollment';target_id:UUID;base_version:Version;
  policy_version_id:UUID;state:ProposalState;expires_at:Instant;terms_hash:Hash;
  accepted_at:Instant|null;can_accept:boolean;required_actions:string[];
};
// GET view is explicit and independently authorized; it is not inferred by highest account role.
type CustomerProposalTerms = {
  learner_id:UUID;enrollment_id:UUID;old_occurrence_id:UUID;new_occurrence_id:UUID;
  old_start_at:Instant;old_end_at:Instant;start_at:Instant;end_at:Instant;time_zone:'Africa/Cairo';
  old_customer_price_minor:Minor;customer_price_minor:Minor;customer_adjustment_minor:number;
  currency:'EGP';policy_version_id:UUID;customer_policy:PublicPolicySummary;
  remedy:'none'|'policy_default'|'cash_refund'|'monetary_account_credit'|'package_entitlement_restoration';
  remedy_amount_minor:Minor|null;restored_credit_quanta:number|null;
};
type TutorProposalTerms = {
  tutor_id:UUID;occurrence_id:UUID;start_at:Instant;end_at:Instant;time_zone:'Africa/Cairo';
  target_tier:2|3|4|null;duration_minutes:number;fee_agreement_id:UUID|null;
  fee_minor:Minor|null;currency:'EGP';compensation_policy_version_id:UUID|null;
  fee_agreement_state:'pending_approval'|'approved';
};
// OperationProposal is ProposalBase + {view:'customer',terms:CustomerProposalTerms}
// OR + {view:'tutor',terms:TutorProposalTerms}
// OR + {view:'admin',terms:{customers:CustomerProposalTerms[],tutor:TutorProposalTerms|null},
//       required_acceptances:[{participant_type:'learner'|'tutor',participant_id:UUID,accepted_at:Instant|null}]}.
// For one guardian's multiple affected learners, p_learner_id selects one scoped terms/hash.
// Admin hash and tutor hash are never returned as the customer's hash.
```

Group amendment DTO uses `amendment_id` instead of proposal_id, `kind:'group_amendment'`, adds `occurrence_id`, `replacement_policy_version_id`, and the same explicit view-discriminated terms. Admin includes add_learner_ids/remove_enrollment_ids and required acceptances; customer sees only selected learner; tutor sees only their teaching/compensation. `customer_adjustment_minor` is signed safe integer. All monetary/null terms stay honestly unavailable where final funding/remedy calculation requires T06; a null financial consequence cannot be accepted as a final financial authorization.

## Due jobs and T06 hook

Restricted worker function `app_private.process_occurrence_booking_due(p_occurrence_id uuid,p_idempotency_key text) -> {expired_enrollment_ids:uuid[],promoted_waitlist_entry_id:uuid|null,enrollment_id:uuid|null,next_due_at:timestamptz|null}` runs with the same lock order, uses database time, records idempotent audit/events, and has no browser grant. Worker keys derive occurrence+persisted due-event identity, not caller timestamps. Repeated/reclaimed jobs re-evaluate current rows safely.

Expiry first releases expired ordinary/provisional holds and supersedes affected quotes/proposals. Then at most one oldest `(created_at,id)` eligible waitlist entry receives one policy-timed ordinary hold and a fresh customer quote. Promotion rechecks current verified active booker and guardian consent; revoked consent is ineligible, not silently reassigned. Queue offer expiry passes to the next entry exactly once. Queued notification payloads contain IDs only; recipient/materialized projection checks belong to delivery.

An eligible existing waitlist request has priority over a new ordinary reservation after a vacancy opens. The ordinary reservation returns the documented capacity conflict until the queue offer is processed. Ineligible requests cannot indefinitely block the seat. When another eligible waiter and ordinary vacancy remain after one promotion, schedule an immediate next due run rather than waiting for the first offer to expire; each run still promotes at most one learner.

Occurrence creation also queues its formation deadline, including when no learner hold is ever created. A group still forming at its deadline receives one immutable, version-bound formation decision carrying its saved policy action. The administrative schedule exposes that pending resolution. Tutor reservation and existing financial records remain intact until the authorized revised-offer or cancellation-resolution command commits; the pending decision never asserts successful funding or cancellation.

Private transactional `app_private.booking_funding_status(p_enrollment_id uuid,p_quote_id uuid,p_policy_version_id uuid) -> jsonb` initially returns integration_state awaiting_T06_integration, eligible false, reason T06_INTEGRATION_REQUIRED, and unavailable monetary/coverage fields null. The derived customer deposit threshold may be present as a quote requirement, not asserted funding. T06 replaces this hook under the same locks with settled-allocation/named-entitlement/value-plus-top-up decisions. No browser can call it or set eligibility. Confirm/financial amendment/cancellation/transfer commits raise DEPENDENCY_UNAVAILABLE until their real transactional requirements exist; successful funds allocations later remain successful even when booking confirmation stays unresolved.

## Required checks and honest milestone result

T04 independent checks: real barriers and separate connections for last seat, duplicate learner, overlapping tutor meetings, availability/create serialization, capacity versus reservation, expiry/promotion replay; exact scoped quote hashes; wrong/expired/revoked participant acceptance; unchanged money on proposal creation; immutable fee endpoints and malformed direct RPC inputs; customer/tutor/admin projection rejection; DST/interval/rounding pure tests and browser forms.

GT-201 funded confirmation, GT-203 invoice/payment request, GT-204 confirmed conflict, GT-205 late settled funds, GT-206 funded cancellation, GT-207 confirmed-seat capacity, GT-303 accepted funded reschedule, GT-304 priced enrollment transfer, GT-1206/1207 atomic confirmation, GT-1208 dropout and GT-1609 confirmation race need T06 combined evidence for their full stated cases. Execute independent subclaims now without marking entire cases passed. GT-208 has its e2e file mapping `tests/e2e/booking-concurrency.spec.ts`; do not silently substitute the plan's generic booking.spec mapping without recording it.

Planned TS exports: `bookingCommands`, `invokeBookingCommandWithStatus`, `BookingRpcError`; read wrappers camelCase of the listed RPCs; strict DTO types for UI. `src/modules/booking/scheduling.ts` exports `resolveCairoLocalTime(localDateTime:string):{instant:string,offset_minutes:number}[]` for exact YYYY-MM-DDTHH:mm values and `formatCairoInstant(instant:string):{local_date:string,local_time:string,weekday:1|2|3|4|5|6|7,offset_minutes:number}`. Resolver candidates are unique and chronological; no input normalization hides invalid dates. `src/modules/booking/quotes.ts` exports `calculateDepositThreshold(amountMinor:number,basisPoints:number,rounding:'ceiling_minor_unit'|'floor_minor_unit'|'half_up_minor_unit'):number`, using bigint intermediates with checked safe output. UI consumes type-only DTO exports and actual returned versions; no manual version/UUID inputs, no financial-success placeholders.

## SQL ownership and helper agreement after T03 commit

The agreed core table/helper boundary uses: `booking_lock_occurrence`, `booking_roster_fingerprint`, `booking_begin`, `booking_finish`, `booking_expire_holds`, `booking_assert_schedule`, `booking_apply_schedule`, `booking_funding_status`, plus existing `assert_learner_scope` and `assert_exact_tutor_fee`. The core owns availability, occurrences, assignments/reservations, ordinary and provisional enrollment storage, immutable quotes/acceptances, fee agreements, waitlists and worker due-run idempotency. Tooling owns a later additive proposal migration, its separate `booking_proposal_command` dispatcher, proposal reads and reschedule/cancel/transfer/amendment consumption wrappers. No edits to core booking_command are required.

The proposal migration owns these tables (all RLS, commands-owned functions, no raw browser/worker grants):

- `app_private.operation_proposals`: id,kind,target_type,target_id,occurrence_id,base_target_version,base_occurrence_version,base_roster_hash,policy_version_id,state,version,expires_at,created_by,reason,approved_at,approved_by,committed_at,invalidated_reason,created_at,updated_at. Immutable requested/customer terms are separate rows. State follows the canonical vocabulary; no in-place terms edit. Explicit schedule intent is stored with the proposal and never inferred from caller fields at consumption.
- `app_private.operation_customer_terms`: id,proposal_id,learner_id,enrollment_id,source_quote_id,proposed_quote_id,terms JSON,terms_hash,financial_terms_ready. Unique proposal/learner; its schema is the strict customer allowlist above. `financial_terms_ready=false` forbids final financial acceptance/commit, but does not claim there are no obligations.
- `finance_private.operation_tutor_terms`: id,proposal_id,tutor_id,fee_agreement_id nullable for no assigned fee,terms JSON,terms_hash. No customer read joins this table. Schedule-only requests preserve the exact existing compensation or explicitly say it is unapproved; they do not create an agreement.
- `app_private.operation_proposal_acceptances`: id,proposal_id,participant_type,participant_id,actor_account_id,terms_hash,accepted_at. Unique proposal/participant. Current authorization is rechecked at acceptance and consumption, including guardians who share an account across two learners. `terms_hash` identifies the exact authorized participant; it is not a public authorization capability. A hash alone never bypasses current scope.
- `app_private.operation_proposal_approvals`: id,proposal_id,terms_hash,decision,actor_account_id,reason,created_at; immutable. Reviewed decision and current all-party acceptance determine allowed lifecycle transition.
- `app_private.group_amendments`: id referencing the shared operation proposal, replacement_policy_version_id,pricing_version_id,target_tier,add_learner_ids,remove_enrollment_ids. The operation header owns occurrence/base versions, roster hash, immutable requested terms, lifecycle and expiry. One active group amendment per occurrence is sufficient; decline/expiry releases its provisional holds before another proposal.

Group amendments reuse the same scoped customer/tutor terms and participant-acceptance tables under `kind='group_amendment'`. This keeps the authorization and acceptance rules identical across proposal kinds without duplicating financial data. New immutable proposed quotes do not replace the current active quote pointer until a successful accepted commit. Added learners' enrollment rows use hold_kind amendment and amendment_id, with a deferred foreign key to the amendment created in the same transaction. Their reservation is visibly provisional through the customer-safe is_provisional flag. Ordinary quote acceptance rejects a provisional seat; consent uses the scoped amendment terms until atomic commitment. Customer terms and hashes are generated independently from tutor terms. Admin commit supplies the separately audited administrative decision; no financial posting occurs before T06.

Proposal tables use immutable terms triggers plus mutable lifecycle columns. Terms version remains stable across independent party acceptances; final lifecycle changes remain transactionally locked and checked. `proposed -> accepted` occurs when every required participant has accepted. Approval/decline/expiry/commit increments the aggregate version, while a repeated acceptance returns its recorded result only after current scope verification.

`booking_apply_schedule` must increment both occurrence.version and quote_terms_version and update the same tutor reservation; proposal consumer owns issuing replacement quote rows and recording the explicit accepted proposal references for affected learners. It must not reinterpret an old quote hash as acceptance of changed dates. Empty occurrences can move without replacement quotes. A forming occurrence's new confirmation deadline must remain in the future, and the new deadline is queued transactionally. A schedule-only proposal preserves price/fee and may commit locally when fully accepted; any changed monetary remedy remains fail-closed at T06.

Due processing must not depend on proposal tables before their migration exists. Add a private no-op core hook `booking_expire_proposals(p_occurrence_id uuid) returns uuid[]` that the proposal migration replaces with scoped expiry/invalidation and provisional hold release under the already-held occurrence lock. The due processor calls it after ordinary expiry and before promotion. Core also exposes private `booking_next_proposal_due(p_occurrence_id uuid) returns timestamptz` as a baseline-null hook, replaced by the proposal migration, and includes that instant when scheduling its next due job. Both hooks preserve migration order without broad table grants or dynamic SQL.

Root owns HTTP registry, worker integration, docs/status and scoped commits. DB owns core SQL/integration/seeder. Tooling owns TS validators/modules and the additive proposal SQL/integration tests after the core exists. UI owns forms and browser proof. Implementation began after the verified T03 commit; funded confirmation and financial amendments remain behind the T06 checkpoint.
