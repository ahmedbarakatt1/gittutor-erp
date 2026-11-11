# T05 database implementation evidence

Recorded on 2026-11-11 after T04 commit `57a8a8927263753e18586a9e20086b155324dc53`. This records executed local checks and their limits. It does not mark funded package, confirmed booking, delivery or refund acceptance cases complete. T05 remains subject to the T06 integration checkpoint; delivery qualification additionally belongs to T08.

## Environment and reproducibility

Checks used real project-local Supabase Auth, PostgreSQL and PostgREST at the existing loopback stack. Test clients obtained genuine independent Auth sessions. `adminDatabase()` verified the local URL and persisted `test` / `git-tutor-supabase-local-v1` marker before any test fixture writes. The separate native PostgreSQL T01 baseline and unrelated Docker services were not reset.

The process PATH selected bundled Node **24.22.1**, without changing the system PATH:

```powershell
$env:PATH=(Resolve-Path ((Split-Path (Get-Command pnpm).Source)+'/../../node/bin')).Path+';'+$env:PATH
```

Supabase CLI remains pinned at 3.1.0. Migration bodies were assembled under ignored `.local/`, then generated with `pnpm exec supabase migration new <name>` and copied complete before `pnpm exec tsx tools/supabase-local.ts migrate`. Credentials, Auth tokens and invitation links are not included in this document or committed logs.

## Applied additive migration sequence

| Version and suffix | Resulting boundary |
|---|---|
| `20261111141231_package_contract_v2` | Schema2 activation/elapsed-day rules; immutable historical schema1 contracts preserved. |
| `20261111142017_package_core` | Pending purchases, real issued charge/journal, approved bonus policies, immutable lots/movements and conservation primitives. |
| `20261111142054_package_lock_grant` | Narrow mutex column UPDATE permission needed by row locking. |
| `20261111142155_package_variable_scope` | Explicit PL/pgSQL local-variable qualification. |
| `20261111142250_package_trigger_validation` | Deferred journal trigger record variants and grant validator name resolution. |
| `20261111142901_package_allocation_expiry` | Exact allocation, available-only expiry worker and unavailable qualification hooks. |
| `20261111143412_package_reservations` | Quote-bound package reserve/release and transactional booking hold-end release. |
| `20261111144019_package_input_usable_boundaries` | Direct-RPC grant JSON shape parity and separate unexpired usable balances. |
| `20261111144302_package_scoped_proposals` | Tooling-owned immutable coverage/conversion consent and proposal lifecycle. |
| `20261111144518_package_scoped_reads` | Scoped paginated histories/selectors, renewal edges, current coverage and reconciliation. Read-only allocation preview; authoritative mutation callers retain financial locks. |
| `20261111144617_package_proposal_hook_boundaries` | Tooling-owned expiry alias and verified actor bridge corrections. |
| `20261111144843_package_transfer_renewal` | Same-learner transfer/renewal, exact lot ancestry, accepted conversion and separate new purchase charge. |
| `20261111144915_package_transfer_scope` | Unambiguous returned version variable. |
| `20261111145234_package_private_movement_kernel` | Private partial consumption/restoration mechanics and immutable remedy application references. Public qualification remains unavailable. |
| `20261111145328_package_conversion_service_conservation` | Tooling-owned per-lot service ceiling at proposal creation/freshness. |
| `20261111145747_package_remedy_source_residual` | Every remedy consumes proportional remaining original benefit quantity/value, including cash/account-credit modes. |
| `20261111145959_package_proposal_list_names` | Tooling-owned proposal list correction joins the learner's person record for its display name. |
| `20261111150117_package_accepted_coverage_option` | Selector discovers only current exact qualifying accepted coverage terms. |

Final executed verifier reported **37 migrations, 62 private RLS tables and 244 function boundaries**. `git diff --name-only 57a8a8927263753e18586a9e20086b155324dc53 -- supabase/migrations` returned no tracked historical migration changes. The two previously applied inert T04 placeholders (`20261111130611_booking_proposals.sql`, `20261111131428_booking_read_boundaries.sql`) remain untouched. They are historical empty entries, not pending implementations.

One first application of `144019` failed with an unterminated SQL string produced by JavaScript replacement-string expansion. PostgreSQL rolled it back; the unapplied file was corrected before successful application. Applied migrations were not rewritten to conceal defects. Other discovered implementation defects were corrected by the additive files listed above.

## Authorization, concurrency and accounting invariants

- Browser/API roles have no base access to package, journal, compensation or remedy records. Public package RPCs are authenticated; the existing two anonymous catalog RPCs remain the only anonymous application reads. Commands and private helpers use the non-login, non-bypass command owner and empty search paths. The restricted worker receives only its dedicated due function. Existing narrowly documented Auth bridge exceptions remain unchanged.
- Every public command derives a verified actor and checks current database role/relationship before idempotent replay. Financial package views require payments scope; enrollment coverage additionally requires booking scope. Customer DTOs are constructed from explicit fields, including for an account that also has admin authority. No compensation fields or journal account names are included in customer package data.
- Booking coverage locks tutor, occurrence and enrollment before the learner financial mutex. Pure package transfers start at the learner mutex and never acquire later booking locks. Purchases/lots are locked in stable order; immutable source versions, exact quote terms and allocation snapshots are rechecked before proposal consumption.
- A statement transition-table trigger releases package reservations in the transaction that ends an enrollment hold. It acquires the affected learner mutexes in UUID order. A wider transaction must prelock the union of learners before acquiring financial locks across separate statements; T06 must preserve this rule.
- Purchase creates an issued charge and balanced receivable/deferred obligation journal, without granting purchased units or asserting settled funding. An approved complimentary bonus is a separate lot. Positive local synthetic bonuses post explicit noncash subsidy/deferred entries and do not pay, waive or activate the purchase.
- All quantities and amounts use bounded integers. Allocation uses the exact remaining lot value and quantity, with the last allocation receiving the residual. Transfer retains original expiry and source lineage. Paired transfer movements conserve source quantity/value; a separately accepted signed zero-value adjustment accounts for duration conversion. Per-lot target service cannot exceed source service.
- Renewal records an immutable source/target edge even for zero carryover. Cycle detection includes both transfers and renewal edges under the learner mutex. An admin cannot supply learner acceptance: approved conversion consent carries the real accepting actor/time into the new purchase contract.
- Raw balance counters remain reconcilable to immutable movements. `usable_available_*` excludes elapsed lots using server time, without modifying history during reads. Released coverage appears only in history; `current_coverage` is active-only. Histories and renewal edges use stable timestamp/ID pagination rather than silently truncated arrays.
- Private historical tests exercise consumption/restoration mechanics through guarded DBA fixtures. Remedy reservations share an original consumption source lock, independently cap quantity and value, and use the remaining-original-source residual rule. A positive cash value with zero extinguished benefit quantity is rejected. Public restoration still stops at the unavailable T06 remedy gate; no deployed synthetic delivery or remedy bypass exists.
- The admin reconciliation DTO checks each lot's cached quantity/value buckets against its immutable movement totals. Journal balancing is separately enforced by deferred constraints and tested source postings; this DTO is not a claim that T06 cash/funding reconciliation exists.

## Synthetic seed identities and preservation

`tools/package-seed.ts` exports `seedPackages()` and `packageFixtureIds`. The new deterministic labels are `fixture_package_{named,value}_policy_v2`, `fixture_package_{named,value}_offer_v2`, and `fixture_package_{named,value}_bonus_policy_v2`, mapped through the existing `fixtureId()` function. They do not replace original catalog fixture IDs.

The guarded seed inserts only canonical draft authoring records, verifies saved content/provenance on repeat, then uses genuine current-admin approval/publication RPCs. Purchases and bonus grants use normal actor RPCs with durable idempotency keys. Registry labels `package_named_v2` and `package_value_v2` record actual purchase/charge/bonus-lot identities; `package_{named,value}_schedule_v2` records the two actual admin-created occurrences. The immutable seed clock preserves original dates. Both purchases have real independent charges; each separate synthetic bonus is 1000 quanta with EGP500 carrying value. Their normal booked session reference tuition remains EGP575, with the exact internal fee separately approved through its privileged command.

Repeat seeding preserves existing balances, state, issued charges, source content and identifiers. It does not reset consumed credits, extend expiry, refresh a past fixture clock, republish altered records or overwrite historical schema1 policy JSON. Fresh-project historical-cutoff orchestration is owned by `tools/supabase-local.ts`; production migrations remain fixture-free.

## Executed regressions and final focused checks

The following ignored logs record actual RED results before their implementations/fixes: `t05-policy-purchase-red.log`, `t05-core-purchase-red.log`, `t05-allocation-red.log`, `t05-expiry-red.log`, `t05-amount-red.log`, `t05-reserve-red.log`, `t05-grant-shape-red.log`, `t05-usable-red.log`, `t05-reads-red.log`, `t05-transfer-red.log`, `t05-kernel-red.log`, `t05-remedy-residual-red.log`, and `t05-coverage-option-red.log`. They include missing RPCs, strict JSON mismatch, missing usable fields, source-remedy overreach and accepted coverage not appearing in selectors. Expected test filtering in focused runs is not counted as passed acceptance coverage.

Latest owned combined command, after the accepted-option fix:

```text
pnpm exec vitest run tests/unit/pricing.test.ts tests/unit/policies.test.ts tests/unit/package-policy-contract.test.ts tests/integration/catalog-privacy.test.ts tests/integration/package-ledger.test.ts tests/integration/package-reads.test.ts tests/integration/package-transfers.test.ts tests/integration/package-movement-kernel.test.ts tests/integration/package-seed.test.ts
```

**9 files, 156 tests passed**, pinned Node24; `.local/t05-database-final.log` (17:02 run). This includes schema parity, original catalog privacy, real purchase/bonus provenance, independent reservation/transfer races, reserve-vs-transfer, cycle rejection, exact 100001 sequential residuals, consume-vs-release, repeated partial consumption/restoration, zero-value benefit caps, scoped typed reads, active-only coverage, current accepted top-up matching and deterministic seed repetition.

Additional executed checks:

- `pnpm exec tsx tools/supabase-local.ts verify` — exit0, **37/62/244**, `.local/t05-db-verify-final.log`.
- `pnpm exec tsx tools/package-seed.ts` — exit0; `.local/t05-seed-first.log`. The later seed repetition test exercised the added occurrences and passed, `.local/t05-seed-final.log`.
- `pnpm exec vitest run tests/integration/package-movement-kernel.test.ts` — **4/4**, `.local/t05-kernel-final.log`.
- `pnpm exec vitest run tests/integration/package-reads.test.ts` — **3/3**, `.local/t05-coverage-option-green.log`.
- `pnpm exec eslint tests/helpers/packages.ts tests/integration/package-ledger.test.ts tests/integration/package-reads.test.ts tests/integration/package-transfers.test.ts tests/integration/package-movement-kernel.test.ts tests/integration/package-seed.test.ts tests/unit/package-policy-contract.test.ts tests/unit/policy-vectors.ts src/modules/catalog/policies.ts tools/package-seed.ts` — exit0, `.local/t05-db-lint-final.log`.
- `pnpm typecheck` — exit0 after the final owned changes, `.local/t05-db-typecheck-final.log`. The root consolidated run owns final all-source build/browser evidence.

Root-owned worker recovery and booking atomicity tests and tooling-owned proposal/conversion checks are recorded separately in implementation status. No browser result or full acceptance case is inferred from these database checks.

### Current offered-seat read regression

The first root consolidated browser run exposed stale posted `offered` rows crowding the current-offer list. A genuine Auth regression first failed because the `state=offered, limit=1` query returned an expired hold before live offers (`.local/t05-waitlist-read-red.log`). Additive migration `20261111152717_booking_current_waitlist_reads.sql` filters that specific actionable view by current ordinary hold, current unexpired quote, future forming occurrence, open confirmation deadline, sale eligibility and active tutor. It does not update history; unfiltered reads retain every posted state and the original `created_at,id` cursor order.

- `pnpm exec vitest run tests/integration/booking-waitlist-reads.test.ts` — **1/1 passed**, `.local/t05-waitlist-read-green.log`, after the observed RED. Assertions cover current pages/cursor continuation, expired hold/state, closed deadline, tutor role revocation, cross-learner denial and byte-for-byte unchanged waitlist history.
- `pnpm exec vitest run tests/integration/booking-waitlist-reads.test.ts tests/integration/booking-concurrency.test.ts tests/integration/booking-due-worker.test.ts` — **3 files, 25 tests passed**, pinned Node24, `.local/t05-waitlist-read-regression.log`.
- `pnpm exec eslint tests/integration/booking-waitlist-reads.test.ts` — exit0, `.local/t05-waitlist-read-lint.log`.
- `pnpm exec tsx tools/supabase-local.ts verify` — exit0, **38 migrations, 62 private RLS tables, 244 function boundaries**, `.local/t05-waitlist-read-verify.log`.

The root browser rerun is recorded separately; these SQL checks do not attest the whole GT-208 case.

### No-expiry contract projection regression

The second consolidated browser run exposed valid approved contracts with `expiry_mode=none` and omitted, inapplicable `expiry_days`. Raw SQL collection reads succeeded, but the strict customer DTO required an explicit null. Both real learner and admin Auth reads reproduced the mismatch. An isolated newly approved contract and genuine purchase produced **2 failing tests** before correction (`.local/t05-no-expiry-red.log`).

Migration `20261111154218_package_no_expiry_projection.sql` adds explicit null only at the customer API boundaries for exact/paged contract reads and saved package detail. Internal source snapshots and contract hashing remain unchanged. No approved policy, existing purchase snapshot, acceptance hash or journal is rewritten. The regression checks original omitted keys and hashes, complete exact/list/detail DTOs, and zero-carryover renewal preserving the original saved snapshot/hash.

- `pnpm exec vitest run tests/integration/package-no-expiry.test.ts` — **2/2 passed**, `.local/t05-no-expiry-green.log`.
- `pnpm exec vitest run tests/integration/package-no-expiry.test.ts tests/integration/package-reads.test.ts tests/integration/package-transfers.test.ts tests/integration/package-proposals.test.ts` — **4 files, 19 tests passed**, pinned Node24, `.local/t05-no-expiry-regression.log`.
- `pnpm exec eslint tests/integration/package-no-expiry.test.ts` and `pnpm typecheck` — both exit0, `.local/t05-no-expiry-lint.log` and `.local/t05-no-expiry-typecheck.log`.
- `pnpm exec tsx tools/supabase-local.ts verify` — exit0, **39 migrations, 62 private RLS tables, 245 function boundaries**, `.local/t05-no-expiry-verify.log`.

The affected browser rerun and consolidated release result remain root-owned evidence.

## Explicit integration exclusions

Purchased grant activation, settled receipt allocation, approved-credit grants, funded booking confirmation, financial amendment/cancellation commits, cash/credit refunds and provider reconciliation remain T06 dependencies. Approved completion/partial delivery remains a T08 dependency. Private production evidence file validation remains T07; positive production subsidy grants currently fail closed. Local bonus history and guarded historical kernel fixtures are not evidence that those integrations have run.
