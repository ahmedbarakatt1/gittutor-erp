# Acceptance tests and synthetic scenarios

Prepared by Hossam Nabil Elsabbagh. Revision 1, 11 November 2026.

The catalogue contains **147 planned acceptance cases**, comprising the original 84 operational-risk cases and 63 focused regressions. Each case currently has `implementation_status = planned` and `execution_status = not_run`. The 33 domain scenarios supply synthetic identities, policy versions, state transitions and exact monetary expectations.

Current verification covers manifest structure, preserved IDs, requirement mappings, fixture references and independent arithmetic checks. Application execution evidence is added as Codex implements and runs each test.

[acceptance-cases.json](../fixtures/acceptance-cases.json)

[domain-scenarios.json](../fixtures/domain-scenarios.json)

## Release gates

| Priority | Cases | Required treatment |
|---|---:|---|
| P0 | 104 | Blocks release of the affected feature and every full-product release until the test is implemented and passes with recorded evidence. These cases protect authorization, money, package balances, booking capacity and irreversible side effects. |
| P1 | 41 | Required for the promised in-scope workflow. A failing or unexecuted case blocks completion of its owning milestone. |
| P2 | 2 | Preserve the case and its deferred status explicitly. Keep incomplete behavior disabled or record an accepted scope deferral. |

The two P2 cases are `GT-208` for waitlist progression and `GT-703` for customer archiving. A skipped test, an empty test body or a mock-only pass cannot satisfy a P0 gate requiring database, browser or provider behavior.

Original IDs remain stable as `GT-101` through `GT-1108`, with their original priorities. `GT-207` and `GT-604` retain their original invariants using synthetic examples within the confirmed two-to-four-person group tiers. New IDs occupy `GT-1201–GT-1214`, `GT-1301–GT-1318`, `GT-1401–GT-1412`, `GT-1501–GT-1510` and `GT-1601–GT-1609`.

## Case structure

| Field | Contract |
|---|---|
| `id` | Stable `GT-` identifier, unique across the catalogue |
| `title` | Human-readable acceptance behavior |
| `requirement_id` | Primary requirement from R01–R18 |
| `related_requirement_ids` | Other requirements exercised by the case |
| `owning_task` | Primary implementation owner from T01–T13 |
| `priority` | P0, P1 or P2 |
| `layer` | Primary test layer from the catalogue enum |
| `supporting_layers` | Additional evidence required for a cross-boundary case |
| `test_file` | Proposed repository test path |
| `source_case_id` | Original source ID or `null` for a new regression |
| `scenario` | Fixture references, initial state, action, optional variants and concurrency setup |
| `expected` | Required assertions, exact minor-unit money and exact quantities where applicable |
| `implementation_status` | Initially `planned`. Change to `implemented` when the test body and its fixture adapter exist. |
| `execution_status` | Initially `not_run`. Record `passed`, `failed`, `blocked` or `skipped` only from an actual execution outcome. |

Include the case ID in each test title so CI and local runs can select it directly. A case may expand into several parameterized tests while retaining one acceptance identifier. Keep `expected` values independent from the production function under test.

A future passing result should attach the test command, Git commit, environment, migration version, provider mode, timestamps, exit code and artifact path. Implement the T01 application manifest validator to enforce `execution_evidence_contract` before accepting a `passed` status. Each current case has `evidence_required = true` and `execution_evidence = null`. The handoff validator currently checks the specification structure, references and arithmetic. Preserve the prior failed run when a later fix passes.

## Synthetic policy context

The fixture envelope is synthetic and cannot be published live. Its simulated group policy is complete and `published` inside `development_test` with `is_synthetic = true`, so local end-to-end booking flows can run. Scenario-specific changes create separate synthetic policy versions and preserve the shared published fixture.

The supplied group prices are confirmed inputs. Duration, deposit, cancellation, partial delivery, renewal, hold and amendment choices remain explicit fixture settings. The canonical example uses a 60-minute base duration and a configured 50% deposit. Production publication follows the decision register and policy gate. The dropout fixture keeps its selected price guarantee. The voluntary replacement-terms fixture selects a separate synthetic policy version with the guarantee disabled and requires every affected booker, the assigned tutor and administrative approval before an atomic amendment.

Identifiers such as `learner_a` map deterministically to test UUIDs. Human labels use LearnerA and similar synthetic names. Email addresses use `example.test`. Providers run through local fakes or isolated sandboxes and capture outbound work for assertions.

The workbook contributes scenarios such as partial sessions, fee changes, paid cancellations and renewal obligations. Development records come from these synthetic manifests.

## Exact arithmetic

All monetary values use integer minor units. EGP 575 is `57500`. Entitlements use `credit_quanta`, with `credit_quanta_per_session = 1000`. A half-session consumes 500 quanta when the selected policy and approved delivery decision explicitly authorize that result.

| Scenario | Exact expectation |
|---|---|
| Two participants | Seat 57500, total tuition 115000, one approved tutor fee 45000, internal contribution 70000 |
| Three participants | Seat 55000, total tuition 165000, approved tutor fee 62500, internal contribution 102500 |
| Four participants | Seat 50000, total tuition 200000, approved tutor fee 72500, internal contribution 127500 |
| Configured half deposit | Charge 57500, deposit 28750, remaining charge 28750 |
| Overpayment | Receipt 55000, allocation 50000, customer credit liability 5000 |
| Partial payout | Earned 25000, settled payout 15000, outstanding payable 10000 |
| Partial package delivery | Grant 3000 quanta with value 150000, reserve 1000, consume 500, release 500, remaining 2500 with value 125000 |
| Approved half-delivery tutor adjustment | Preserve the 72500 agreement, append a -36250 adjustment and produce an approved earning of 36250 |
| Fee correction | Preserve the 62500 earning, append a 2500 adjustment and produce a payable of 65000 |

`GT-1205` deliberately supplies one fractional minor-unit value as a rejection input. Its valid expectations remain integers.

For sequential package consumption, calculate each allocation from the **remaining lot value and remaining credit quantity**. The final portion receives the residual. The exact integer operation for a nonfinal portion is `floor(remaining_value_minor * consumed_credit_quanta / remaining_credit_quanta)`. Use exact intermediate arithmetic with validated bounds.

`GT-1315` distinguishes the supported rounding modes.

| Mode | Package value | Credit portions | Expected minor-unit allocations |
|---|---:|---|---|
| Sequential equal portions | 100001 | 1000, 1000, 1000 | 33333, 33334, 33334 |
| Sequential uneven portions | 100000 | 1000, 500, 1500 | 33333, 16666, 50001 |
| Stable-ordered largest-remainder batch | 100001 | 1000, 1000, 1000 | 33334, 33334, 33333 |

The batch tie-breaker uses stable allocation IDs. Every mode must conserve the original package value, keep quantities nonnegative and finish at zero remaining liability after full consumption.

## Package coverage modes

`GT-1318` gives a full eligible credit its selected contractual meaning. The current standalone reference price is 57500 minor units, and one eligible occurrence requires 1000 credit quanta.

| Coverage mode | Original credit value | Additional customer debt | Confirmation funding | Package-funded revenue on consumption | Package-funded refund cap |
|---|---:|---:|---|---:|---:|
| Named service entitlement | 50000 | 0 | Full eligible reserved unit satisfies service coverage | 50000 | 50000 |
| Explicit monetary value | 50000 | 7500 | Applied value exceeds the fixture deposit threshold of 28750 | 50000 | 50000 |
| Named service entitlement | 25000 | 0 | Full eligible reserved unit satisfies service coverage | 25000 | 25000 |
| Explicit monetary value | 25000 | 32500 | Requires 3750 verified top-up to reach the fixture threshold of 28750 | 25000 | 25000 |

Named service coverage preserves the discounted entitlement and its original carrying value. Explicit value coverage posts the agreed monetary shortfall. After authorized full delivery, explicit value mode recognizes total agreed tuition of 57500, comprising the original package-funded value and the separately contracted monetary amount. In both modes, the customer balance, collection queue and revenue recognition follow the selected policy. Refunds against the package-funded component use its original consumed value and the shared remedy limit. Separately settled top-up payments retain their own refund allocations.

## Primary-ledger oracle

`SCN-LEDGER` combines a package receipt, a private-session receipt with surplus, approved delivery, a partial tutor payout and a paid expense. The fixture selects its own synthetic accounting policy amounts.

| Control | Expected minor units |
|---|---:|
| Cash receipts | 155000 |
| Cash disbursements | 25000 |
| Closing cash | 130000 |
| Customer receivable | 0 |
| Remaining package obligation | 50000 |
| Customer credit liability | 5000 |
| Tutor payable | 30000 |
| Earned tuition | 100000 |
| Tutor expense | 45000 |
| Marketing expense | 10000 |
| Operating result | 45000 |

Closing cash equals receipts less disbursements. The 50000 package obligation, 5000 customer credit, 30000 tutor payable and 45000 earned result sum to the same 130000. Derive these controls from primary journal entries. Administrative action labels and exported summaries cannot become balance sources.

`GT-1506` separately tests gross obligations. A tutor advance stays identifiable while another tutor's payable remains fully visible. `GT-1509` counts an occurrence-level fee once across participant detail and recomputes conversion ratios from their matching numerators and denominators.

## Test layers

| Layer | Primary cases | Verification target |
|---|---:|---|
| `e2e` | 9 | Browser journeys, visible state, responsive layouts and delivered message audiences |
| `http_authorization` | 23 | Real request identities, object scope, RPC access and field allowlists |
| `provider_contract` | 8 | Calendar, payment, scanner and messaging adapter contracts with controlled responses |
| `recovery` | 10 | Timeouts, crash windows, replay, outbox restart and checkpoint restoration |
| `sql_concurrency` | 25 | Independent connections racing on the same seat, credit, transfer or version |
| `sql_integration` | 55 | Real PostgreSQL constraints, atomic journals, scoped reads and persistent state |
| `unit` | 17 | Exact pricing, policy boundaries, allocation arithmetic and analytics definitions |

SQL concurrency tests use at least two independent PostgreSQL connections and explicit barriers. Race the actual commands and inspect committed rows and balances after both requests finish. Exercise unique constraints, locks, idempotency keys and `expected_version` checks. Test both meaningful transaction orderings for allocation versus reversal and cancellation versus consumption.

HTTP authorization tests authenticate each actual role and object relationship. Include an anonymous visitor, an authorized and unrelated guardian, another student, the assigned and replaced tutor, current and revoked staff, and an administrator. Exercise the sanitized API and direct Supabase read/RPC paths using their effective grants.

Customer confidentiality tests recursively inspect JSON, HTML, files, message bodies, exports, metadata, browser network responses and analytics payloads. The allowlist excludes tutor agreements, fee bands, costs, margins, payout destinations, internal notes and credentials. `GT-1212` covers every surface listed in its fixture, and `GT-1213` attempts bypasses through database access, RPC arguments and extra writable fields.

Provider contract tests cover authentic and invalid callbacks, repeated events, timeout-after-success, stale events and unavailable credentials. Calendar revocation tests verify the configured provider's actual admission behavior. Production readiness remains blocked for a capability whose provider contract has not been verified.

Recovery tests inject failures before commit, after commit before acknowledgment, after provider acceptance before response, during outbox processing and during restore/replay. Reconcile money, entitlements, seats and delivery counts against the fixed checkpoint after recovery.

Tutor onboarding has dedicated regressions. `GT-1607` protects administrative approval and role assignment, `GT-1608` separates private edits from the reviewed public profile, and `GT-1609` serializes availability changes with teaching commitments.

## Proposed test layout

```text
tests/unit/pricing.test.ts
tests/unit/deposit-policy.test.ts
tests/unit/package-value-allocation.test.ts
tests/unit/acquisition-analytics.test.ts
tests/unit/acceptance-manifests.test.ts
tests/integration/migration-security.test.ts
tests/integration/database-and-rpc-authorization.test.ts
tests/integration/tutor-applications.test.ts
tests/integration/approved-tutor-profiles.test.ts
tests/integration/availability-concurrency.test.ts
tests/integration/customer-field-confidentiality.test.ts
tests/integration/booking-concurrency.test.ts
tests/integration/group-amendments.test.ts
tests/integration/package-concurrency.test.ts
tests/integration/package-coverage-modes.test.ts
tests/integration/package-transfers.test.ts
tests/integration/receipt-reconciliation.test.ts
tests/integration/review-evidence-concurrency.test.ts
tests/integration/allocation-reversal-concurrency.test.ts
tests/integration/tutor-settlement.test.ts
tests/integration/primary-ledger-reconciliation.test.ts
tests/integration/calendar.contract.test.ts
tests/integration/payout-outcome.contract.test.ts
tests/integration/restore-and-replay.test.ts
tests/e2e/public-website.spec.ts
tests/e2e/transactional-email.spec.ts
tests/e2e/support-handoff.spec.ts
```

Each case also supplies its proposed `test_file`. Implement fixture adapters that create isolated database or schema state, verified actors, policies, ledger entries and fake-provider responses. Provide separate unit, database, browser, provider-contract and recovery commands. Commands must report missing prerequisites as blocked verification.

## Requirement traceability

Counts below use each case's primary requirement. Related requirement IDs provide additional cross-boundary coverage without inflating the total.

| Requirement | Scope | Primary cases |
|---|---|---:|
| R01 | Public website and bilingual-ready UI | 1 |
| R02 | Authentication and object permissions | 8 |
| R03 | Pricing, policies and confidentiality | 9 |
| R04 | Bookings, availability and concurrency | 14 |
| R05 | Package entitlement and partial delivery | 17 |
| R06 | Receipt review and reconciliation | 23 |
| R07 | Refunds and monetary corrections | 6 |
| R08 | Scheduling and meeting access | 7 |
| R09 | Private files and materials | 4 |
| R10 | Attendance and controlled completion | 4 |
| R11 | Tutor agreements and payouts | 8 |
| R12 | Customer register and exports | 9 |
| R13 | Primary-ledger finance reporting | 4 |
| R14 | Operational email and outbox | 10 |
| R15 | Support and WhatsApp handoff | 8 |
| R16 | Acquisition and staff-workload analytics | 10 |
| R17 | Security, recovery and release | 3 |
| R18 | Synthetic fixtures and delivery evidence | 2 |

All 18 requirements have primary coverage. The catalogue contains zero duplicate IDs and zero dangling fixture references. The full 84-case source set is present exactly once.

## Milestone test sequence

The selected cases establish the first working slice of each milestone. Finish the remaining owned cases and required cross-layer checks before declaring the milestone complete.

| Task | Milestone | Owned cases | Initial required set |
|---|---|---:|---|
| T01 | Foundation | 4 | GT-1601, GT-1603, GT-1604, GT-1605 |
| T02 | Identity | 8 | GT-101, GT-102, GT-104, GT-105, GT-106, GT-1213, GT-1607 |
| T03 | Catalog, pricing and policy | 9 | GT-1201–GT-1205, GT-1211, GT-1212, GT-1602, GT-1608 |
| T04 | Booking concurrency | 14 | GT-201–GT-205, GT-303, GT-1206–GT-1208, GT-1609 |
| T05 | Packages | 17 | GT-1301–GT-1313, GT-1315–GT-1318 |
| T06 | Receipts, reconciliation and refunds | 29 | GT-501–GT-509, GT-601–GT-603, GT-1209, GT-1210, GT-1314, GT-1401–GT-1412, GT-1505 |
| T07 | Materials and meetings | 11 | GT-301, GT-401–GT-407 |
| T08 | Completion, earnings, payouts and finance | 16 | GT-604–GT-608, GT-801, GT-802, GT-807, GT-1214, GT-1501–GT-1504, GT-1506, GT-1510 |
| T09 | Notifications | 10 | GT-307, GT-805, GT-901–GT-908 |
| T10 | Customer register and exports | 9 | GT-701–GT-707, GT-1509 |
| T11 | Support and WhatsApp | 8 | GT-1101–GT-1108 |
| T12 | Analytics | 10 | GT-1001–GT-1008, GT-1507, GT-1508 |
| T13 | Release | 2 | GT-806, GT-1606, then the complete in-scope catalogue |

For T01, implement the manifest validator, deterministic UUID mapping, idempotent synthetic seed and clean-database privilege checks. Add the initial public-route browser smoke from `GT-1601`. Confirm that the test commands execute real assertions and persist evidence before proceeding to authentication-dependent workflows.

T04 and T05 run their standalone booking and entitlement invariants with controlled synthetic funding inputs. After those checks pass, their milestone state is `awaiting_T06_integration`. The combined T04/T05/T06 barrier closes only after the real receipt, reconciliation and funding flow passes the linked booking, hold, package, refund and replay scenarios. T06 requires review ownership, current evidence, independent settlement and atomic allocations before payment confirmation is enabled. T08 requires controlled completion and payout-outcome reconciliation before tutor disbursement workflows are enabled.

T13 runs the full in-scope catalogue and consolidates results by case ID, requirement, layer and owning task. Resolve P0 failures and complete the in-scope P1 evidence. Preserve any explicit P2 deferral in the implementation status record.
