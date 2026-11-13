# T10 CRM and scoped-export evidence

Local implementation date: 13 November 2026. This record describes executed focused checks; it does not mark the release catalogue passed. Root owns the release run, commits and execution manifest.

## Implemented paths and boundaries

- `/admin/customers` and `/service/customers`: durable learners, current owned-case/follow-up CS scope, contacts, chronological history, assigned follow-ups, archive/restore. Admin reviews shared-contact candidates and appends label aliases without merging identities or financial records.
- `/admin/sessions`: occurrence directory with date/status filters and an occurrence-grain export using the same filters.
- `/learn/exports`, `/tutor/exports`, `/admin/exports`: fixed field selections, current actor scope, immutable snapshot records, queued generation and authenticated CSV download.
- Actual local Supabase Auth, PostgreSQL and private Storage are used. Worker `exports.render` is lease-gated, byte/hash checked and replay-safe. The HTTP path rechecks authority before and after the Storage read; denied scope checks commit audit records.
- `as_of` is a financial posting cutoff. Identity, schedule and current agreement associations are captured at materialization; this is not historical reconstruction of mutable source fields.
- Limits: 10,000 rows, 25 MiB CSV, 24-hour access expiry. Retention removal of stored expired objects remains the deployment retention policy, not an anonymous download mechanism.

Applied additive migrations: `20261113140000_customer_register`, `20261113172000_crm_contacts_scoped_exports`, `20261113174000_crm_export_ready_history`, `20261113175500_crm_verified_phone_projection`, `20261113181000_export_terminal_state_projection`, `20261113182500_export_enrollment_grain_scope`.

## Executed checks

| Command | Observed result | Local log |
|---|---|---|
| `pnpm exec vitest run tests/integration/crm-exports.test.ts` | 9/9 passed after terminal-state and enrollment-grain scope corrections | `.local/t10-grain-green.log` |
| `pnpm exec playwright test tests/e2e/crm.spec.ts` | 2/2 passed: desktop and 360px mobile | `.local/t10-browser.log` |
| `pnpm exec vitest run tests/unit/customer-register-and-exports.test.ts` | 2/2 passed | `.local/t10-unit-final.log` |
| Focused ESLint over CRM module, components, routes, server/worker and owning tests | Passed | `.local/t10-lint-final.log` |
| `pnpm exec eslint tests/integration/crm-exports.test.ts` | Passed after enrollment-grain scope regression | `.local/t10-grain-lint.log` |
| `pnpm typecheck` | Passed after terminal-state correction; root's full release run remains authoritative across parallel changes | `.local/t10-terminal-typecheck.log` |

RED observations were preserved: missing contact RPC (`.local/t10-red.log`); missing ready notification (`.local/t10-worker-red.log`); missing confirmed phone projection (`.local/t10-phone-red.log`); actual exhausted worker job still projected as generating (`.local/t10-terminal-red.log`). A test targeting a prior shared-contact candidate was corrected to select its uniquely created observation. Auth can generate intermediate phone updates, so the phone regression asserts two distinct destinations and stable identity, rather than assuming exactly two provider update events.

## Acceptance mapping

`I` below is `tests/integration/crm-exports.test.ts`; `B` is `tests/e2e/crm.spec.ts`; `U` is `tests/unit/customer-register-and-exports.test.ts`. Catalogue `test_file` paths are updated; execution statuses are unchanged.

| Case | Actual test and assertion | Evidence limits |
|---|---|---|
| GT-107 | I: `GT-107 confirmed Auth phone changes preserve the same learner and booking history with immutable contact versions` | Real local Auth administrative confirmation of synthetic phones; no live SMS delivery claim. |
| GT-701 | I: `GT-701 concurrent booking and observed contact commands preserve one durable customer and verified values` | Two independent PostgreSQL connections and explicit barrier through `raceBookingCalls`; repeated commands preserve contact and customer identity; blank claims reject. |
| GT-702 | I: `shared observed contacts produce reviewed candidates without merging learner authority; exports freeze their declared grain` | Shared synthetic family email exercises channel-neutral candidate/review logic; the literal shared-phone fixture is not separately executed. GT-107 separately verifies confirmed-phone history. |
| GT-703 | I: `CRM reads durable identities, retains verified contacts and requires current case or follow-up scope` | Archive visibility, current staff scope, preserved customer history are asserted. The archive fixture has no payment allocation, so unchanged linked ledger rows are guaranteed structurally but not separately asserted in this test. |
| GT-704 | I: `guardian multi-learner export adds distinct enrollment rows and is invalidated when one relationship is revoked`; B: `admin customer follow-up and private CSV journey uses actual records; learner cannot download it` | Guardian selected rows equal the union of individual learner snapshots; revocation denies. Actual HTTP cross-account download is denied. A mixed valid/unrelated guardian HTTP request is not separately executed. |
| GT-705 | U: `GT-705 text formula prefixes are neutralized without mutating stored values or signed numeric columns` | Equals/plus/minus/at and whitespace prefix protection; exact large numeric strings. No spreadsheet desktop launch is claimed. |
| GT-706 | I: shared-contact/snapshot test above | A booking committed after snapshot creation does not change any ordered export row. Bounded materialization replaces multi-page live-source export reads. |
| GT-707 | I: `private CSV renders once, reconciles lost acknowledgement, rejects cross-account reads and audits revoked scope after storage read`; B: actual CSV journey above | Forwarded file is rejected over real HTTP; denied audit, after-read session revocation and immutable rows are asserted. Expiry is enforced by database conditions; a time-advanced expiry assertion is not separately executed. |
| GT-1509 | I: shared-contact/snapshot test: two accepted seats yield one occurrence export row, EGP 1150 tuition and EGP 450 fee. I: `admin allocation and occurrence grains reconcile to immutable sources; tutor exports contain only that tutor earnings`. U: customer export field-denial test. | Ratio portion belongs to `tests/unit/cohorts.test.ts`, `GT-1509 conversion ratio recomputes from matching summed counts, not average percentages` (T12 authored; root owns its executed result). |

## Browser and review evidence

Actual browser actions: sign in as admin, find one stable customer, record an unverified contact, assign a follow-up, request/render/download its CSV, reject a separate learner's HTTP download, and open the customer export and session directory pages. Screenshots: `.local/screenshots/t10-sessions-{desktop,mobile}.png` and `.local/screenshots/t10-exports-{desktop,mobile}.png`. Mobile screenshots were visually inspected; no horizontal overflow was found. The session screenshot captured the truthful loading state before directory data finished loading, so it is not evidence of a rendered loaded session list.

Read-only author review checked field/role allowlists, original requester/session binding, immutable source rows, current role/guardian scope checks, financial posting cutoff, additive guardian rows, occurrence-fee grain, CSV escaping, worker replay and restricted Storage access. No known cross-account data or compensation leak was found. UI polish remains: learner export choices currently show learner reference labels rather than names; native date fields could use the shared field spacing; mobile portal navigation is long. These do not weaken authorization.

A subsequent release review found and corrected a profile-only guardian inference gap: minimal selected columns still yielded enrollment-grain row counts and accepted booking-date filters. RED (`.local/t10-grain-red.log`) reproduced an accepted unauthorized request. The additive scope correction now requires booking scope for the whole enrollment grain at request, render and download. `profile-only guardian cannot infer enrollment counts through minimal columns or date filters` verifies both minimal and date-filtered requests are denied and create no export jobs; the full nine-test file then passed. No other actionable CRM/API/export-worker confidentiality or authorization defect was found in the bounded follow-up review.

Terminal rendering regression: `terminal worker failure is a failed export while an uncertain outcome remains recoverable` acquires a real restricted worker lease, prepares the immutable snapshot and records failure through the worker `fail_job` interface. A definite failure with exhausted attempts projects `failed` and cannot download; an uncertain outcome remains `generating` with its safe error and actual outbox `reconciliation` state. The read projection derives terminal failure from the outbox without rewriting source rows or changing a ready object after a lost acknowledgment. Unknown outcomes require reconciliation; expired-object removal remains an operator retention task. No live SMS, external email or production-retention approval is asserted.

## Ownership

T10 owns `src/modules/crm/*`, `src/components/crm/*`, `src/server/exports.ts`, `src/worker/exports.ts`, CRM/export HTTP routes, admin/service customer pages, admin sessions/exports pages, learner/tutor export pages, the six migrations above, `tests/integration/crm-exports.test.ts`, `tests/unit/customer-register-and-exports.test.ts`, `tests/e2e/crm.spec.ts`, `tests/helpers/{exports,export-worker}.ts`, this evidence and `T10-CRM-CONTRACT.md`. Additional read-only audits are `T01-T06-ACCEPTANCE-MAP.md` and `T07-T09-T13-ACCEPTANCE-MAP.md`. Root integrates `src/worker/index.ts`, worker-grant verification, portal navigation and the shared implementation status.
