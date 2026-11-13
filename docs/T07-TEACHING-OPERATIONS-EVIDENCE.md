# Teaching operations execution evidence

Implementation uses the agreed T07 contract and synthetic local Supabase Auth, private Storage and fake provider adapters. These checks are focused implementation evidence; they do not complete the T04–T06 checkpoint or live-provider acceptance.

Applied migrations: `20261111202612_teaching_availability_series.sql`, `20261111203920_tutor_reassignment.sql`, and additive `20261111204016_tutor_reassignment_term_binding.sql`. Original migration files remain unchanged.

| Executed check | Observed result | Artifact |
|---|---|---|
| `pnpm exec vitest run tests/unit/teaching-operations.test.ts` before the operations module | 2 expected failures | `.local/t07-operations-unit-red.log` |
| `pnpm exec vitest run tests/integration/teaching-operations.test.ts` before RPCs | 2 expected missing-RPC failures | `.local/t07-operations-sql-red.log` |
| Same integration command after migration | 2 passed | `.local/t07-operations-first.log` |
| `pnpm exec vitest run tests/integration/tutor-reassignment.test.ts` before RPCs | 1 expected missing-RPC failure | `.local/t07-reassignment-sql-red.log` |
| Same command after first implementation | 1 failed at commit; diagnostic found an unqualified SQL term variable | `.local/t07-reassignment-first.log` |
| Same command after additive term binding correction | 1 passed, 3.26 seconds total | `.local/t07-reassignment-green.log` |
| `pnpm exec vitest run tests/unit/payroll.test.ts tests/unit/teaching-operations.test.ts` | 5 passed, including all 3 operations input tests | `.local/t08-payroll-unit-green.log` |

Unavailability creates assigned resolution cases for affected future meetings and blocks new commitments within the recorded interval. Series changes select exact future occurrence versions and create independent consent proposals. Completed historical schedules and charges stay unchanged. Case resolution reads return a current eligible committed resolution ID, so operators need no manual identifier entry.

Reassignment stores separate customer, previous-tutor and replacement-tutor terms and hashes. Real independent actors consent before current-admin approval and commit. The executed check preserves source charges and assignment history, checks the separate original-tutor compensation obligation, uses actual uploaded/scanned private bytes to verify the previous tutor loses access and the replacement gains access, and retries the committed command with the same key.

The replacement assignment receives a new exact agreement. Original-tutor compensation remains an approved obligation until the T08 earning command posts it; it is not described as paid. Customer projections and events exclude either tutor's amounts. The event aggregate is the occurrence, with IDs-only assignment payloads. Calendar synchronization changes the conference generation and clears local access until the current assignment's event is ready.

Live Google OAuth, organizer verification, invitation delivery, and external-room revocation still require configured credentials and controlled live checks. Local access revocation is exercised; a remote participant already holding an external room URL is not claimed removed by a local permission check. Browser execution is owned and recorded separately by the UI agent.
