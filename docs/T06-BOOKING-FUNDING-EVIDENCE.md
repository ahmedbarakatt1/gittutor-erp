# T06 booking and package financial foundation

This is an intermediate checkpoint, not completion of T06 or the T04–T06 integration barrier. All data used here is synthetic, authenticated against the actual local Supabase stack. No live payment, email, calendar or file-scanner readiness is asserted. Receipt fixtures are guarded metadata fixtures and do not attest uploaded bytes.

## Implemented and exercised

- Genuine ordinary quote acceptance issues one immutable tuition charge. Added amendment learners receive a conditional charge bound to their actual Q2 acceptance; the current Q1 enrollment is not silently replaced.
- Named entitlement coverage can carry 50000 against reference tuition 57500 with zero tuition debt. Value coverage applies its actual carrying value once, leaving an explicit accepted top-up. Released excess cash retains its original payer, transfer and allocation lineage.
- Full settled purchase funding activates one purchased grant. Separate bonus grants do not settle that purchase. Approved-credit grants consume an exact current source-payer intent and real credit reservation, with a balanced unapplied-funds/deferred-package posting.
- Pure funding and confirmation reads do not confirm meetings. Commands recheck schedule, exact fee, current authority, roster, consent and actual funding under the complete ordered financial graph.
- Group additions and repricing preserve the original fee/roster commitment, append exact replacement quote acceptances, post referenced tuition/coverage adjustments, and release original-payer excess cash. Positive future debits reserve real source credit before commit. Consuming those reservations does not require the old CS review lease to remain live; it does recheck current evidence, payer/beneficiary authority, proposal and source consent.
- Decline and actual deadline expiry release amendment earmarks without deleting settled cash. Booking commands, proposal commands and due-worker entry acquire the complete financial graph before taking the first tutor lock. The renamed private worker implementation is not executable by the worker role.
- Cancellation requests can be replaced by a new immutable, explicitly reviewed proposal. Customer hashes contain only their own remedy; private tutor compensation remains in tutor/admin terms and is bounded by the current approved agreement. Exact learner/tutor consent and admin approval precede execution. The exercised prestart cancellation clears tuition debt, produces traceable payer credit and an immutable remedy plan, and records compensation as `approved_pending_T08_posting`, not as earned or paid.

## Executed checks

All commands below used pinned Node 24.22.1 through the project pnpm runtime. Native exit codes were propagated after writing logs.

| Command | Observed result | Local artifact |
|---|---|---|
| `pnpm exec vitest run tests/integration/funded-amendments.test.ts tests/integration/package-ledger.test.ts tests/integration/booking-concurrency.test.ts tests/integration/operation-proposals.test.ts` | 49/49 passed before the final cancellation consumption stage | `.local/t06-amendment-coverage-green.log` |
| `pnpm exec vitest run tests/integration/cancellation-remedies.test.ts` | 1/1 passed: review, scope/bounds, supersession, consent, approval, cancellation and replay | `.local/t06-cancellation-consumption-green.log` |
| `pnpm exec vitest run tests/unit/booking-funding.test.ts tests/unit/package-contracts.test.ts` | 14/14 passed | `.local/t06-tooling-checkpoint-unit.log` |
| `pnpm exec tsc --noEmit` | Exit 0 | `.local/t06-tooling-checkpoint-types.log` |
| `pnpm exec eslint src/modules/booking src/modules/packages src/modules/catalog/policies.ts src/modules/catalog/queries.ts tests/helpers/financial-booking.ts tests/helpers/funded-amendments.ts tests/integration/funded-amendments.test.ts tests/integration/cancellation-remedies.test.ts tests/integration/package-ledger.test.ts tests/integration/booking-concurrency.test.ts` | Exit 0 | `.local/t06-tooling-checkpoint-lint.log` |

The broader command below executed 62 tests: 60 passed and two aborted with the documented `RETRYABLE_CONFLICT` while concurrent browser fixtures changed the shared canonical learners' financial graph. These were actual safe transaction aborts, not passes. The owning test helper now retries only that exact error, at most three attempts, preserving the original request and idempotency key. Other errors propagate.

```text
pnpm exec vitest run tests/integration/booking-funding.test.ts tests/integration/package-funding.test.ts tests/integration/package-activation.test.ts tests/integration/conditional-package-funding.test.ts tests/integration/package-approved-credit.test.ts tests/integration/package-cash-coverage.test.ts tests/integration/funded-amendments.test.ts tests/integration/cancellation-remedies.test.ts tests/integration/booking-concurrency.test.ts tests/integration/package-ledger.test.ts tests/integration/operation-proposals.test.ts
```

Artifact: `.local/t06-tooling-checkpoint-sql.log`. The root consolidated run is authoritative for the later complete checkpoint result.

A subsequent focused run of `pnpm exec vitest run tests/integration/funded-amendments.test.ts tests/integration/cancellation-remedies.test.ts` passed 4/6 while browser fixtures were still running. Two fixture setup commands (`reserve_enrollment` and `approve_tutor_fee`) aborted with `RETRYABLE_CONFLICT`. The artifact is `.local/t06-tooling-checkpoint-focused-green.log`; despite that filename, this run failed and is not GREEN evidence. The later consolidated run uses the exclusive database test lane.

The final security regression first reproduced a booking-only guardian reading and accepting actual reviewed cancellation balances, then consuming the approved cancellation after payment scope was revoked. `pnpm exec vitest run tests/integration/cancellation-remedies.test.ts -t 'current guardian'` failed as expected in `.local/t06-cancellation-guardian-red.log`. Additive migration `20261111180627_cancellation_financial_scope.sql` now requires current booking and payments authority for reviewed customer terms, exact acceptance/replay, and accepted-actor rechecks before approval or consumption. Ordinary tuition-only proposals and the original unreviewed request retain their existing scope.

After applying that migration, `pnpm exec vitest run tests/integration/cancellation-remedies.test.ts` passed 2/2 at 20:06:48 Africa/Cairo, recorded in `.local/t06-cancellation-guardian-green.log`. The regression verifies that revoked payment authority leaves the confirmed enrollment and its actual EGP 500 charge/allocation unchanged. `pnpm exec eslint tests/integration/cancellation-remedies.test.ts` exited 0 (`.local/t06-cancellation-guardian-lint.log`). This was the final owned database mutation/test before handing the exclusive lane back to the root checkpoint run.

The subsequent typecheck found the test's optional learner filter using the wrong nested DTO path. The successful RPC run had resolved the guardian's single learner without that optional filter. The test now uses `seat.learner.learner_id` explicitly; `pnpm exec tsc --noEmit` then exited 0 (`.local/t06-cancellation-guardian-types-green.log`). Its final explicit-filter execution is included in the root consolidated run rather than starting another competing database test lane.

The root consolidated SQL run then recorded 196 passed, 4 failed and 1 deliberately skipped expiry case (`.local/t06-checkpoint-integration.log`). The guardian test passed with its explicit learner filter. The four failures were stale pre-T06 test expectations: an unfunded amendment now reports `INSUFFICIENT_FUNDS`, a new package charge has real unpaid balance 150000 rather than unavailable/null, and two reserve-versus-transfer races initially returned the graph-expansion `RETRYABLE_CONFLICT`. The race tests now preserve exactly one initial winner, retry only that exact error once using the original body/idempotency key on an independent connection, then require `VERSION_CONFLICT` and the original quantity/value conservation assertions. No production code changed for these corrections.

`pnpm exec vitest run tests/integration/group-amendments.test.ts tests/integration/package-transfers.test.ts tests/integration/package-booking-atomicity.test.ts` passed 16/16 (`.local/t06-checkpoint-stale-expectations-green.log`). Final typecheck exited 0 (`.local/t06-checkpoint-stale-types.log`); scoped ESLint for those three files exited 0 (`.local/t06-checkpoint-stale-lint.log`). The database test lane was released for the root browser suite immediately afterward.

The named-coverage inverse test runs its private inverse kernel inside an isolated rollback transaction. It verifies referenced arithmetic after repricing; it does not claim an authorized customer remedy or T08 delivery. Deadline expiry uses a real ten-second proposal window, without altering immutable timestamps. Representative actual RED artifacts are `.local/t06-amendment-reservation-red.log`, `.local/t06-future-amendment-red.log`, `.local/t06-amendment-terminal-red-actual.log`, `.local/t06-named-amendment-inverse-red.log`, and `.local/t06-cancellation-review-red.log`.

## Remaining local work before closing T06

- Removed-seat group amendments still cannot commit. They need the exact saved-policy cancellation/remedy and replacement-roster integration; addition-only success does not cover this path.
- Enrollment transfers remain unavailable. Destination consent, capacity, assignment/fee, charge identity, package eligibility and actual source-payer authorization must commit together. Existing money must not be silently retargeted.
- Non-full cancellation of reserved package units needs explicit reviewed quantity/value disposition and its postings. The current review refuses that case. This is unfinished local implementation, not an assertion that all published policies lack the necessary review rule.
- Financing holds correctly prevent new use of affected cash-backed purchased/approved-credit origins and descendants. Positive source requalification and audited release of those holds remain unfinished; clearing a reconciliation exception alone must not fabricate restored source value.
- Partially consumed package release depends on a genuine delivery/remedy outcome. T08 must supply the qualifying delivery/completion source; historical kernel fixtures do not satisfy that integration.
- T08 must consume the durable cancellation compensation obligation as the reviewed total for the occurrence, with immutable earning adjustments as appropriate. It must not add it blindly to the old teaching agreement.
- Full prestart cancellation and current guardian scope were exercised in the root database/browser checkpoint; see `IMPLEMENTATION-STATUS.md` for consolidated results and corrections. The remaining integration paths above still prevent closing T06. No full acceptance-case catalogue status was changed by these supporting tests.

Provider credentials remain separate external dependencies. The local unfinished items above are not credential blockers and remain scheduled work after this scoped checkpoint.
