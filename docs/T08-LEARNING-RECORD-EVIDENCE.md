# GT-803 published learning record evidence

Implemented locally on 13 November 2026. The supplemental contract is `docs/T08-LEARNING-RECORD-CONTRACT.md`; the additive migration is `20261113183000_learning_records.sql`. Internal completion facts remain separate. Publication does not create or change financial postings.

The current assigned tutor or an administrator explicitly publishes a shared class summary or feedback for one named confirmed learner after approved completion. Each correction appends an immutable revision. Current authority is checked before idempotent replay. Customer reads contain the latest shared summary and only the selected authorized learner's feedback. Current guardian `materials` scope is required. The customer DTO omits roster, history, author identifiers, internal completion notes, fees and margins.

The completed delivery panel has separate audience-confirmed authoring forms and privileged revision history. The completed customer booking displays the published summary and own feedback. The initial forms do not copy internal completion notes. The independent strict endpoint is `/api/v1/learning-records/{occurrence_id}`.

The T09 wrapper handles `learning_record_published` from the actual saved record/revision. It sends pointer-only `completion` content with `/learn/bookings`, without publication content or peer IDs. Current confirmed learners receive shared-publication pointers; individual feedback selects only its named learner. Guardians require both current `materials` and `notifications` scopes. Other events delegate unchanged to the previous T09 helpers.

## Executed checks

- `pnpm exec vitest run tests/unit/learning-records.test.ts`: missing-module RED, then GREEN. Strict command input rejects internal completion fields; customer output rejects a roster.
- `pnpm exec vitest run tests/integration/learning-records.test.ts`: actual-auth RED reproduced missing public RPC before migration. Staged SQL validated in a rollback transaction before applying the fresh migration; applied migrations were preserved.
- `pnpm exec vitest run tests/integration/learning-records.test.ts tests/unit/learning-records.test.ts`: **2/2 passed**, `.local/t08-learning-focused.log`. One genuine three-person funded completion fixture checks pre-completion denial; no automatic publication of raw internal notes; student/service-staff authoring denial; group vs individual privacy; non-roster/classmate denial; request-hash/replay and stale-version protection; retained immutable revisions; current guardian read then immediate revoked-link denial; pointer-only current-scope recipients; tutor role revocation denying reads and even replay.
- Scoped ESLint and full typecheck passed (`.local/t08-learning-eslint.log`, `.local/t08-learning-typecheck.log`).
- `pnpm exec playwright test tests/e2e/learning-records.spec.ts`: **2/2 passed**, desktop and mobile, `.local/t08-learning-browser.log`. The real tutor UI explicitly publishes shared and selected-learner content; the learner's booking shows both and excludes the internal note canary. Screenshots are `.local/screenshots/t08-learning-record-{desktop,mobile}.png`; the mobile record was visually inspected, with no horizontal overflow.

The learning publication itself requires no external provider. Email transport follows T09's separate fake/live readiness and reconciliation gates. Root owns the combined release checks and final status.
