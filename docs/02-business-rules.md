# Business rules

## 1. Contract scope and precision

This document implements R03–R07, R10, R11 and R13, with domain dependencies on R01, R02, R08, R09, R12 and R14–R18. Follow the precedence in [the shared contract](00-contract-spine.md). The supplied workbook contributes scenarios such as installments, package renewal, carryover and partial tutor payouts. Use synthetic identities and transactions for development. Historical workbook amounts establish neither opening balances nor production transactions.

Store money as integer minor units. EGP 575 is `57500`. Use integer arithmetic for percentages, allocation and rounding. Keep currency on every monetary record and require compatible currencies within an allocation. Pricing-policy versions, commercial-policy versions and accepted quote versions are immutable once used. Correct mistakes through a new version and linked adjustments.

The [pricing manifest](../contracts/pricing-policy.json) contains separate customer-pricing and internal-compensation contracts for server-side authoring. Public product and reservation responses project the customer contract. Internal compensation has its own authorized projection. Customer invoices, receipts and messages contain customer charges and customer balances. Tutor statements contain that tutor's agreed fees and payouts. R02 supplies the authorization boundary.

## 2. Confirmed price inputs and exact fee agreements

The user supplied the following group amounts. EGP per occurrence is the development interpretation. Live publication requires explicit approval of currency context, pricing unit and duration.

| Priced group size | Seat charge | Tuition total | Internal tutor fee | Contribution before other expenses |
|---:|---:|---:|---:|---:|
| 2 | 57500 | 115000 | 45000 | 70000 |
| 3 | 55000 | 165000 | 60000–65000 | 100000–105000 |
| 4 | 50000 | 200000 | 70000–75000 | 125000–130000 |

All amounts in this table are minor units. Tuition totals assume all seats use the standalone tier. Contribution uses the exact approved fee. The image's three-student contribution of EGP 1,050 applies at the EGP 600 fee. Its four-student figure of EGP 1,050 conflicts with the supplied charges and fees. Other expenses reduce contribution further.

For each occurrence, save an exact fee, currency, agreed duration, tutor, compensation-policy version, approving administrator and approval time. A three-student session cannot be confirmed with a fee range as its agreement. Validate the selected fee against the applicable range. Any proposed exception requires a separately approved compensation-policy version. Private prices and private compensation rules remain unset. Sizes beyond the supplied tiers require an approved pricing contract before sale. These are R03 and R11 rules.

## 3. Formation, target tiers and amendments

A group occurrence enters `forming` with a target tier of two, three or four, a scheduled duration, capacity and a confirmation deadline. Each held enrollment receives a versioned quote stating the target tier, its seat charge, expiry and applicable terms. A quote is accepted by an account authorized to book that enrollment. Record the actor, accepted quote hash and time. R04 reserves capacity atomically.

Confirmation requires the target number of eligible enrollments, accepted current quotes, qualifying funding, an exact approved tutor fee and an available tutor. Save the confirmed roster and pricing version together. If the target is unmet at the deadline, publish a revised proposal or follow the approved formation-failure policy. A different tier requires fresh acceptance of the affected quotes.

The recommended amendment workflow creates a proposal without immediately changing the confirmed roster. It identifies added or removed enrollments, revised charges, credits, exact tutor fee and expiry. The proposed acceptance policy requires every affected authorized booker and the assigned tutor to accept their own relevant terms, followed by administrative approval. This acceptance policy remains draft. Development fixtures exercise it explicitly.

| Accepted amendment | Customer charge adjustments | Revised internal fee |
|---|---|---|
| 2 → 3 | Credit each original seat 2500. Charge the third seat 55000. Total becomes 165000. | Approve one exact amount from 60000 through 65000. |
| 3 → 4 | Credit each original seat 5000. Charge the fourth seat 50000. Total becomes 200000. | Approve one exact amount from 70000 through 75000. |

Commit the accepted amendment in one version-checked operation. Post linked credit adjustments, the new charge, roster changes and the new fee agreement together. Admission amendments require a `forming` or `confirmed` occurrence and must meet the published latest-amendment cutoff. A stale acceptance or concurrent roster change requires a fresh proposal. A declined or expired proposal releases its additional holds and enters the appropriate funds-resolution workflow. Existing confirmed records continue to reference their last committed version.

Apply a tuition reduction to unpaid debt first. Excess allocated money becomes traceable customer credit pending an approved resolution. Cash refund, account credit and package restoration are distinct outcomes. Publish acceptance and allocation events only after commitment, supporting R06, R07 and R14.

## 4. Holds, funding, withdrawals and no-shows

An enrollment moves from `held` to `confirmed`, `expired` or `cancelled`. Store hold expiry and exclude expired holds from capacity. A settled transfer received after expiry remains recorded as money received. Rebooking requires fresh capacity and an accepted current quote.

Choose the package coverage rule before evaluating funding. A valid `named_entitlement_covers_eligible_occurrence` reservation satisfies the service obligation through the required eligible `credit_quanta`. Confirmation uses that unit-based coverage even when its carrying value is below the standalone seat price or monetary deposit threshold. The covered service creates zero additional tuition receivable. A customer quote identifies the covered service and the credit quantity.

For money-funded bookings and `allocated_value_with_explicit_top_up`, the commercial policy defines the monetary deposit basis. Compute its threshold from the issued net charge using basis points and the configured integer rounding rule. Track verified payment allocations and applied package value separately. The explicitly agreed remaining charge is collectible under those terms. Full settlement and confirmation eligibility remain separate derived results. Receipt upload alone supplies evidence.

The proposed post-confirmation dropout guarantee retains the remaining customers' accepted charges. It requires business approval. Before confirmation, a smaller proposed tier can increase prices only through accepted replacement quotes. After confirmation, cancellation remedies, retained cancellation charges and tutor compensation follow the saved policy version. A four-person group retaining three 50000 charges after one full 50000 refund has 150000 tuition, with contribution of 75000–80000 against the original fee range. Record the actual approved fee and remedy.

When a group falls below the approved minimum, create an operational decision for rescheduling, cancellation or explicitly accepted private conversion. Private conversion requires an approved private price and fee. The policy also determines whether a tutor's withdrawal, platform failure or learner withdrawal changes compensation.

A no-show is individual attendance. Use the accepted priced roster for tuition and the fee agreement for tutor compensation, subject to the published remedy policy. Store any no-show charge, refund or package consumption decision explicitly. These R04, R07 and R11 policies must be approved before publishing the affected offer.

## 5. Delivery, attendance and completion

Occurrence progression follows `draft`, `forming`, `confirmed`, `in_progress`, `completion_pending` and `completed`, with approved cancellation paths. Private occurrences use the same delivery controls with one enrollment. Capture actual start and end, delivered content, attendance per eligible enrollment and delivery exceptions. Future sessions cannot acquire factual attendance or actual delivery times.

Attendance retains the shared vocabulary `unmarked`, `present`, `absent` and `excused`. Record partial participation through integer `attended_seconds` and a reason alongside the attendance classification. Validate it against the occurrence's actual UTC interval. Define `present` as positive verified participation for domain calculations. A learner leaving early and a whole class ending early create different facts.

For a partially delivered class, record delivered duration, cause, affected enrollments and proposed remedies. The policy specifies reviewed adjustment or an exact proration rule and rounding. Apply the approved tuition, entitlement and tutor-fee adjustments together. An individual departure uses the individual remedy policy while the occurrence records its actual delivery.

An authorized completion approval verifies actual times, attendance, outcomes and resolved financial decisions, then creates an immutable completion. Completion creates one base earning under the applicable fee agreement. Later corrections append amendments with evidence, actor, reason and old/new values. R10 supplies the factual events used by R16. R08, R09 and R14 consume committed schedule, access and completion events.

## 6. Package entitlements and renewal

R05 treats each package purchase as a contract and a set of entitlement lots. Save eligible products, `base_duration_minutes`, eligible formats, allocated monetary value, expiry rule and policy version. The canonical quantity is integer `credit_quanta`, with 1000 quanta representing one standard session under that contract. A half-session consumes 500 quanta. Actual delivered duration comes from UTC timestamps and integer seconds. An approved duration-proration rule uses integer division with explicit rounding to whole quanta. Reviewed adjustments save the exact approved quanta and value.

Named service coverage and stored monetary value have different funding rules. For a standalone reference price of 57500, a valid full named entitlement carrying 25000 covers the eligible occurrence with zero cash top-up and zero additional receivable. Delivery recognizes 25000 from that lot's obligation. Under an explicitly selected value-and-top-up contract, applying 25000 to a 57500 charge leaves 32500 due. A 50% monetary deposit threshold then needs a further 3750 to reach 28750. Partial named entitlement requires an agreed remaining-service funding proposal. Its historical carrying value cannot manufacture a shortfall against today's public price.

A grant creates available entitlement. A reservation moves available units into a reservation tied to an enrollment. Consumption moves reserved units into consumed units after the qualifying delivery decision. Release returns a reservation to available units. Restore reverses a specific consumption up to its remaining unrestored quantity. Transfer moves units and their remaining allocated value between identified lots through paired `transfer_out` and `transfer_in` entries. Expiry acts on eligible available units under the saved policy. Adjustments require a signed quantity, value, reason and authorization.

Maintain this unit conservation identity per lot, using consumed quantities net of restores.

`granted + transferred_in + signed_adjustments = available + reserved + consumed + expired + transferred_out`

Validate nonnegative buckets after every normal command. Restoring an expired lot follows an explicit restoration-expiry rule. Restoring or releasing a reservation twice returns the original result through its idempotency identity.

Track monetary carrying value independently from quanta. Apply the same conservation identity to the value assigned to each bucket. A transferred entitlement carries its actual remaining allocated value, even when a later public price differs. Monetary batch allocations use a largest-remainder rule with a stable allocation-ID tie-break. Sequential consumption allocates from the remaining lot value and quantity, with the final portion receiving the residual. For example, a 100000-value lot consumed in three equal sequential portions allocates 33333, 33333 and 33334. Preserve the allocation references for subsequent refunds or restoration. Expired value follows the approved retained-value accounting rule.

A renewal grants purchased new quanta and optionally transfers eligible remaining quanta. Transfers require compatible base duration and eligibility definitions. An incompatible duration requires a separately approved conversion proposal. Preserve each transferred lot's ancestry, expiry decision and value. Enforce an acyclic renewal/transfer lineage. Reject self-renewal, a second transfer of the same available quantity and any cycle. The old package may retain historical consumed entries while its available balance moves to the successor.

An approved remedy specifies the portion restored as entitlement, paid as cash or issued as monetary account credit. Reserve the eligible quantity and value before executing that remedy. The sum of benefits returned cannot exceed the eligible original allocation. A cash refund that extinguishes entitlement includes a linked negative entitlement adjustment. Package restoration reverses the appropriate revenue allocation into a deferred obligation. These controls prevent returning both usable entitlement and cash for the same value.

## 7. Evidence, settled funds and allocation

R06 separates charges, evidence, review cases, incoming transfers and allocations. Charges progress through `draft`, `issued` and `voided`. Financial effects of an issued charge are corrected through linked debit or credit entries. Derived unpaid and partially paid balances do not replace its issued state.

Receipt evidence uses `uploaded`, `quarantined`, `ready_for_review`, `superseded` and `rejected`. Preserve uploader identity, eligibility at submission, enrollment, checksum and version. Staff attachments cannot satisfy the student/authorized-guardian proof requirement. Cases use the shared waiting, assignment, information, escalation and resolution states. Review ownership and the active evidence version are checked again at posting.

Incoming transfers use `pending`, `settled` and `reversed`. Deduplicate by receiving account, channel and external transaction identity. Store currency, gross amount, provider times, source provenance and settlement evidence. Partial reversal entries leave the transfer `settled` with a derived reversed amount. Full reversal changes its state to `reversed`.

A claimed CS review may post an allocation only with qualified evidence and independently verified settled funds matching the approved destination and currency. Store the review decision and allocation atomically. Allocation records have immutable posted amounts and linked reversals. One transfer can fund several explicitly authorized debts. Allocation requests enforce available settled value and preserve proof-to-enrollment lineage for every debt.

Capture the actual transferred amount even when it exceeds the debt. For 55000 received against 50000 due, post at most 50000 to that charge and retain 5000 as unapplied customer credit. Record unmatched settled money in cash and a corresponding unapplied obligation while its review remains open. A payment allocation can succeed while booking confirmation awaits capacity or an accepted amendment.

## 8. Refunds and financial corrections

R07 refund requests use `requested`, `approved`, `pending`, `settled`, `failed`, `unknown` and `cancelled`. An approved refund reserves eligible refundable value. A pending or unknown disbursement keeps that reservation. A verified failure or cancellation releases it. Settlement records the actual outgoing transaction and consumes the reservation exactly once.

Eligibility is bounded by the original settled funding, prior reversals, successful refunds, other refund reservations and benefits already returned through package or account-credit remedies. Verify the refund destination and preserve the original funding lineage. A provider timeout moves the attempt to `unknown` until reconciliation establishes settlement or failure.

Correct a wrong-seat allocation through a linked reversal and a new authorized allocation of the same transfer. Correct tuition with a charge adjustment and its corresponding allocation, obligation or refund decision. Every correction retains the original record and reason.

Provider reversals can arrive after a refund. Record the external cash effect exactly. Reopen affected debt or a separately reviewed recovery exposure, flag the overlap and reserve further reimbursement for an evidenced resolution. Preserve signed ledger balances rather than clipping an exceptional debit to zero. Normal allocations and refunds cannot exceed their available funding. External reversals trigger reconciliation exceptions when they violate an earlier assumption.

## 9. Tutor earnings, payouts and accounting basis

R11 earnings use `pending_approval` and `posted`. Completion approval posts one earning against the immutable exact fee agreement. A cancelled occurrence can instead receive an explicitly approved compensation award linked to its cancellation decision. Prevent overlapping awards for the same fee obligation. Subsequent fee corrections create separately identified earning adjustments with effective and posting dates. Their effect appears in the current statement while prior as-of statements remain reproducible.

Payout attempts use `draft`, `pending`, `settled`, `failed`, `unknown` and `reversed`. An authorized attempt reserves unpaid earnings and pins the verified destination version. Successful payout allocations reduce the payable. Pending and unknown attempts remain visible within the amount owed and reserve the amount available for another payout. Retry creates a linked new attempt only after verified failure. A payout reversal restores the relevant payable through a linked entry.

For 25000 earned and 15000 successfully paid, the statement shows 10000 owed. A further pending attempt for 4000 leaves 10000 owed and 6000 available for another authorization. Settlement of that attempt changes owed to 6000. Payout references and provider callbacks are idempotent.

R13 reports cash, earned revenue and obligations separately. Cash includes settled incoming transfers and opening balances approved through a separate controlled setup, less settled refunds, payouts and paid expenses. Customer advances, unapplied funds and unconsumed package value remain obligations until an eligible delivery or other contractually earned outcome occurs. Named-entitlement delivery recognizes the consumed lot's allocated carrying value. Value-and-top-up delivery recognizes the agreed tuition with its package-funded portion counted once. Earned cancellation charges require an explicit policy decision.

Tutor expense arises when the earning posts. Paying that liability changes cash and payable. Expense records distinguish incurred cost from cash settlement. Revenue adjustments, earning adjustments and refunds retain their effective and posting periods. Reports show as-of policy versions and reconciled transaction totals. Customer relationship views can repeat household context, so R12 financial exports declare their row grain and provide additive allocation-level totals.

The worked private example remains a synthetic accounting test with zero opening cash and only these transactions. A delivered 50000 charge, collected in full, earned tutor fee of 25000, paid overhead of 5000 and successful tutor payout of 15000 produce operating profit of 20000, cash of 30000 and tutor payable of 10000. Live private prices require their own approved tariff.

## 10. Policy publication and development

The [policy settings contract](../contracts/policy-settings.json) keeps unresolved runtime fields unset and provides concrete synthetic examples separately, including complete group and private booking policies. Synthetic seeders create simulated published policies within `development_test` scope, allowing R18 local booking and automated tests to run normally. The private fixture supplies its own customer-pricing and privileged compensation contracts. Publishing a live offer requires production scope, all applicable fields, compatible pricing and compensation contracts, an explicit approved policy version and effective time. Published versions are immutable. Live publication rejects synthetic records.

Required commercial decisions include duration, pricing unit, private tariffs, confirmation funding, hold/deadline rules, amendment acceptance, dropout guarantee, refunds, no-shows, partial delivery and package eligibility/expiry. Apply conditional gates so group-only publication does not depend on a private tariff, while private publication does. An offer using packages requires an approved package contract.

R01 presents the approved customer terms. R15 escalates policy exceptions with their record IDs. R16 uses approved attendance and current workload events. R17 verifies recovery of conserved balances and idempotent transitions. Each acceptance case records evidence against a specific policy and fixture version. A business-policy change creates a new version and reruns the affected R18 cases.
