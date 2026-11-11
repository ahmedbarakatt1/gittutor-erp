# T04 database foundation evidence

Recorded on 2026-11-11 against the guarded, disposable local Supabase project. This is evidence for independent T04 behavior, not a declaration that any whole acceptance case or the T04–T06 integration checkpoint has passed. The final consolidated result belongs in `IMPLEMENTATION-STATUS.md`.

## Migration history and environment

The pinned Supabase CLI 3.1.0 generated these additive files. All applied file checksums remain unchanged.

| Migration | Purpose |
|---|---|
| `20261111125622_booking_core.sql` | Availability, occurrence reservations, holds, immutable quotes and fees, scoped reads, commands, restricted due worker. |
| `20261111130611_booking_proposals.sql` | Preserved zero-byte placeholder, applied while proposal implementation was still staged. |
| `20261111131428_booking_read_boundaries.sql` | Preserved zero-byte placeholder after a local assembly command failed before the migration command ran. |
| `20261111131548_booking_read_boundaries_fix.sql` | Complete exact-ID reads, canonical availability hashing, direct-RPC validation and current tutor checks. |
| `20261111132334_booking_formation_deadline.sql` | Deadline scheduling and immutable pending formation decisions, including empty occurrences. |
| `20261111132817_booking_scoped_proposals.sql` | Scoped operation and group amendment terms, consent, lifecycle and due hooks. |
| `20261111133015_booking_timing_queue.sql` | Forming reschedule cutoff and deadline queue, eligible waitlist priority and sequential vacancy filling. |
| `20261111133643_booking_proposal_lock_refresh.sql` | Refresh enrollment after tutor/occurrence lock acquisition; lock current approving admin authority during consumption. |
| `20261111133844_booking_proposal_unresolved_terms.sql` | Unresolved tutor financial remedies remain unavailable for final consent. |
| `20261111134228_booking_admission_boundaries.sql` | Provisional quote guard, explicit provisional DTO, sale eligibility parity and bounded UTC instants. |

The two inert placeholders intentionally remain inert because their versions are already in local CLI history. They do not stand in for implementation. Subsequent bodies were staged outside `supabase/migrations`, then copied into freshly generated files before applying. The supported application command is `pnpm exec tsx tools/supabase-local.ts migrate`; it checks the project/loopback target and persisted disposable marker before mutation, applies the real CLI migrations and revokes temporary schema CREATE privileges afterward.

Actual Auth/PostgREST/PostgreSQL run on loopback API 54321 / PostgreSQL 54322. The persisted marker is `test` / `git-tutor-supabase-local-v1`. Existing unrelated Docker services and the separate native PostgreSQL T01 baseline are preserved. Tests create distinct synthetic Auth accounts and independent real sessions. No Auth shim or provider-success mock is used. Credentials remain in ignored local files and are absent from evidence logs.

These focused checks ran through the then-current child shell Node 22.22.2 (ICU 78.2, tz 2025c). The pnpm launcher bundles Node 24.22.1, but that alone does not make its child Node 24. The project remains pinned to Node 24; the parent’s final consolidated check explicitly selects bundled Node 24.22.1 (ICU 78.3, tz 2026e) through process-local PATH. Earlier focused results are not relabeled as Node 24 results.

## Transaction and authorization boundaries

Every sensitive browser command derives its actor from the genuine Auth session and checks current database roles or current learner/guardian booking scope before durable idempotent replay. Stable command identity and request hash serialize duplicate submissions; the database transaction stores the result, audit record and unique outbox event together. Availability arrays are validated and canonically sorted before hashing.

Scheduling uses one lock order: tutor scheduling row, occurrence row, enrollment/quote/proposal rows. Independent scheduling mutations share that tutor lock. Active UTC tutor reservations also have a GiST half-open range exclusion constraint, so adjacent meetings are allowed and overlapping reservations cannot both commit. Cairo weekly intervals and dated replacement exceptions are checked against actual UTC instants; empty dated intervals mean time off. Supported schedule instants are finite UTC years `[0001,10000)`, with end strictly after start, before future/duration/cutoff checks.

Ordinary seats are capped at `min(capacity,target_tier)` (one for private). Additional group amendment seats are explicitly provisional and cannot exceed physical capacity. Hold creation does not invalidate unrelated quotes by incrementing the occurrence operational version. Quote terms have their own version; capacity-only and initial fee changes preserve the current customer quote. Schedule and commercial changes require new immutable quote evidence. Proposal freshness additionally binds the exact active roster fingerprint.

Current tutor authorization is checked for creation, new admission, confirmation and fee approval. Discovery excludes inactive tutor assignments. A shared private sale gate checks published/effective offers and compatible published/effective policy and pricing, active subject and persisted server environment/synthetic provenance. Retired offers cannot be used for new direct reservation, waitlist admission or worker promotion; existing enrollment history remains readable.

Customer responses and hashes contain allowlisted customer terms only. Exact internal fee agreements live in `finance_private`, are immutable, and are exposed only to authorized admin or assigned tutor projections. A prospective amendment fee does not replace the current active agreement. Customer proposal views remain explicitly customer-scoped even for accounts that also have admin authority. Added seats expose `is_provisional`; ordinary quote acceptance rejects them with `STATE_CONFLICT` and `is_current` is false until the accepted amendment is actually committed.

All private tables have RLS. Browser roles have no raw base-table grants. Business functions have a NOLOGIN/NOBYPASSRLS owner and an empty search path. Only the established two public catalog RPCs are anonymous. The narrow due command is executable by the restricted worker; other booking helpers are not worker-executable. The existing four documented private Auth-read bridge exceptions remain unchanged and are verified separately.

## Due jobs and recovery

Occurrence creation queues its confirmation deadline even with no holds. A still-forming group at its deadline receives one immutable, policy-bound pending formation decision. It retains its tutor reservation and does not assert cancellation or money resolution. The administrative DTO exposes the required policy action.

Due processing uses database time, the same tutor/occurrence lock order, a durable worker idempotency record and an audit event with a null actor plus explicit worker kind. It expires holds, expires/invalidates proposals, records any formation decision, then offers at most one oldest eligible waiting request. Eligibility rechecks current verified active account and current learner/guardian scope. Ineligible requests cannot block direct admission indefinitely. An eligible queued request has priority over a new direct reservation. A remaining vacancy and eligible waiter schedule an immediate separate pass, rather than waiting for an unrelated first offer to expire.

The actual restricted worker test commits the database effect, simulates a missing acknowledgement, reclaims the expired lease and replays using the same stable job key. It verifies the same result and no duplicated promotion/audit effect. Revoked guardian consent is independently tested before promotion. Scheduled reschedules enqueue the new deadline; old jobs inspect current state and remain harmless.

## Canonical synthetic schedule

`tools/booking-seed.ts` runs after identity and catalog seeding through `tools/supabase-local.ts seed`. The deterministic labels are `fixture_private_occurrence_v1`, `fixture_group2_occurrence_v1`, `fixture_group3_occurrence_v1` and `fixture_group4_occurrence_v1`, converted by the existing `fixtureId` namespace. Source version is `t04-booking-seed-v1`. The persisted `booking_seed_clock_v1` anchors the initial private slot at 10:00 UTC seven days after first seeding; group slots follow on successive days. Reruns preserve this anchor rather than moving existing records with the clock.

The seeder requires the guarded disposable project, authenticates the real synthetic admin and serializes with an advisory lock. It verifies the current tutor role/account, approved profile and subject coverage. It creates availability only when the aggregate is absent; existing availability is preserved and must cover the intended slots. Canonical occurrence/assignment/reservation insertion uses the actual schedule helper and exclusion constraint, records an audit/outbox event and queues the deadline. Exact initial fees are approved through the normal authenticated command. No learner hold, allocation, entitlement or confirmed occurrence is seeded.

Existing canonical records must match their immutable bindings, time, target, capacity and fee. Conflicts or expired seed clocks fail with a preservation message instead of overwriting user work. Repeated seed checks compare occurrence versions, times, fee identity and audit count. The guarded seed completed and its repeated execution is included in the final core suite.

## Executed focused checks

| Executed command or check | Observed result / local log |
|---|---|
| `pnpm exec vitest run tests/integration/booking-concurrency.test.ts -t 'an absent availability'` before implementation | RED: 1 failed because the real RPC was absent; 7 filtered tests. `.local/t04-core-red.log`. |
| Availability/filter/error-boundary regressions before their additive fix | RED: 3 failures in `.local/t04-core-edge-red.log`; separate fee/strict-input regressions in `.local/t04-core-parity-red.log`. |
| Formation deadline regression before deadline scheduling | RED: 1 failure, 18 filtered tests. `.local/t04-formation-red.log`. |
| Forming cutoff and queue-priority regressions before their fix | RED: 2 failures, 19 filtered tests. `.local/t04-timing-red.log`. |
| `pnpm exec vitest run tests/integration/booking-concurrency.test.ts -t 'retired offers'` before the admission fix | RED: direct reservation succeeded after retirement; 1 failed, 21 filtered. `.local/t04-retired-offer-red.log`. |
| Parent-owned direct-RPC UTC range regression before the boundary fix | RED: year 10000 committed; 1 failed. `.local/t04-time-boundary-red.log`. |
| Tooling-owned provisional quote regression before the core guard | RED: ordinary acceptance succeeded for an amendment hold; 1 failed, 7 filtered. `.local/t04-provisional-consent-red.log`. |
| `pnpm exec tsx tools/booking-seed.ts` | Exit 0; four future forming occurrences and approved exact fee agreements. `.local/t04-seed-first.log`. |
| `pnpm exec vitest run tests/integration/booking-concurrency.test.ts tests/integration/booking-due-worker.test.ts tests/integration/booking-time-boundaries.test.ts` | GREEN: 25/25 in 3 files, 9.62 seconds (22 core, 2 worker, 1 UTC range). `.local/t04-core-boundaries-green.log`. |
| `pnpm exec vitest run tests/integration/catalog-privacy.test.ts` after sale-gate changes | GREEN: 12/12, 3.20 seconds. `.local/t04-catalog-boundary-regression.log`. |
| `pnpm exec tsx tools/supabase-local.ts verify` | Exit 0: 19 migrations, 43 private RLS tables, 146 function boundaries. `.local/t04-database-verify.log`. |
| `pnpm exec eslint tools/booking-seed.ts tools/supabase-local.ts tests/helpers/booking.ts tests/integration/booking-concurrency.test.ts` | Exit 0, no diagnostics. `.local/t04-database-lint.log`. |
| `pnpm typecheck` | Exit 0. `.local/t04-database-typecheck.log`. |
| `pnpm exec vitest run tests/integration/operation-proposals.test.ts tests/integration/group-amendments.test.ts tests/unit/booking-scheduling.test.ts tests/unit/booking-quotes.test.ts tests/unit/booking-contracts.test.ts` (tooling owner execution) | GREEN: 36/36: 10 operation, 9 amendment SQL checks and 17 unit checks. `.local/t04-proposals-final.log`; owning typecheck/lint also exited 0 in `.local/t04-proposals-{typecheck,lint}-final.log`. |

The core concurrency suite uses distinct authenticated PostgreSQL connections with real session claims and an explicit start barrier. It covers last ordinary seat, duplicate same-key and different-key learner requests, overlapping tutor meetings, availability removal versus occurrence creation, and capacity reduction versus reservation. Fixture setup failure releases the barrier rather than hanging other connections. It also verifies scoped quotes, immutable exact fees, current tutor revocation, exact-ID reads beyond default pagination windows, formation decisions, queue ordering, preservation on reseed and fail-closed confirmation.

Independent proposal review identified an enrollment read before the shared scheduling lock and an approving-admin role check without a role lock. The tooling owner reproduced the stale-read race using an actually blocked authenticated request and a concurrent committed seat-version change, then fixed both in `33643`. A separate RED regression showed unresolved tutor financial remedies were incorrectly acceptable; `33844` makes their terms unavailable and blocks acceptance. The final proposal suite checks the blocked-request race, roster fingerprint changes with unchanged occurrence version, immutable quote lineage from explicit proposal consent, guardian revocation, fee isolation, 2→3 and 3→4 proposals, physical capacity, decline/expiry and provisional consent. These results do not include any successful financial amendment commit.

## T06 exclusions and integration obligations

`booking_funding_status` currently returns `awaiting_T06_integration`, eligible false and unavailable monetary/coverage fields null. A derived deposit threshold is a requirement preview, not proof of payment. Confirmation always fails closed until real settled allocations or package coverage are evaluated and committed under the shared locks. Financial group amendment commit, cancellation/remedy and enrollment transfer likewise cannot report success.

The following remain for combined T06 execution: funded exact-roster confirmation; settled late payment behavior; invoice/payment request creation; conservation and reversals; entitlement/value-plus-top-up coverage; atomic roster/quote/charge/credit/fee transitions; guaranteed confirmed dropout behavior and its approved replacement policy; funded cancellation/transfer; capacity/availability races against actual confirmation. Schedule-only accepted rescheduling has local evidence but does not establish financial-remedy correctness.

Added provisional holds record the proposing admin as their creation/booker provenance. T06 must derive payer and financial ownership from explicit authorized acceptance and payment/coverage ownership, never infer an admin payer from that creation field. Empty-occurrence financial operations must establish absence of obligations through the real ledger integration; no T04 unavailable field is proof of zero liability. Live calendar, notification and financial providers remain separate external configuration and delivery work.
