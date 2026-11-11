# Implementation status

## Current handoff state

Implementation started 2026-11-11. T01–T03 are locally verified, including the catalog and approved commercial-policy workflow. T04 booking is next. No full acceptance case is marked passed without linked execution evidence; the original acceptance catalogue remains unrun pending its complete owning checks and later-domain prerequisites.

## Task progress

| Task | Deliverable | Status | Evidence |
|---|---|---|---|
| T01 | Repository foundation and test environment | Locally verified | `pnpm check` exit 0: lint, types, 46 unit, 14 integration, 10 browser tests, production build |
| T02 | Identity, roles and guardian scope | Locally verified | `pnpm check` exit 0: lint, types, 58 unit, 38 real database integration, 38 browser checks and production build; `docs/evidence/t02-check.log` |
| T03 | Catalog, confidential pricing and policy publication | Locally verified | `pnpm check` exit 0: lint, types, 174 unit, 56 integration, 50 browser checks and production build; `docs/evidence/t03-check.log` |
| T04 | Booking, formation and concurrency | Planned | Pending implementation |
| T05 | Package entitlement and renewals | Planned | Pending implementation |
| T06 | Receipt review, allocations and refunds | Planned | Pending implementation |
| T07 | Files, calendar and meeting access | Planned | Pending implementation |
| T08 | Completion, tutor earnings, payouts and finance | Planned | Pending implementation |
| T09 | Operational notifications | Planned | Pending implementation |
| T10 | Customer records, follow-ups and exports | Planned | Pending implementation |
| T11 | Support inbox and WhatsApp | Planned | Pending implementation |
| T12 | Campaign, student and team analytics | Planned | Pending implementation |
| T13 | Full acceptance, recovery and release readiness | Planned | Pending implementation |

## Bootstrap record

- Pack is at repository root `D:\GitTutor System`; no existing application, Git metadata, package manager, framework, tests or CodeGraph index was present. Pack documents and fixtures are preserved. Initialized Git `main`; no remote publication.
- Shell Node is 22.22.2 LTS; desktop pnpm actually uses bundled Node 24.22.1 LTS, now pinned in `.node-version` for CI. Selected pnpm 11.25.0, Next.js 16.4.6, React 19.3.1, TypeScript 5.9.3, Vitest 5.1.0, Playwright Test 1.65.0, Supabase JS 2.119.0, SSR 0.12.7 and CLI 3.1.0. Direct dependencies are exact; installation/lockfile verification in progress.
- Official documentation checked: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Node releases](https://nodejs.org/en/about/previous-releases), [Supabase changelog](https://supabase.com/changelog.md). Current registry versions queried before installation. Existing supported Node retained; TypeScript 5.9.3 chosen as the compatible stable baseline.
- `docker info --format '{{.ServerVersion}}'` failed: Docker Desktop Linux engine named pipe does not exist. Dedicated PostgreSQL 17.2 cluster created under ignored `.local/postgres`, loopback port 55432, databases `gittutor_dev` and `gittutor_test`. No pre-existing database modified. Supabase Auth/Storage end-to-end verification remains separate from these real PostgreSQL checks.
- Requested tooling installation provenance and versions: `docs/TOOLING-EVIDENCE.md`. Shared source paths follow the pack's module map directly. ESLint pinned to 9.39.5 to satisfy the Next React/import/accessibility plugin peer ranges; `pnpm peers check` exits 0. The lockfile is installed. Manrope 5.3.0 is self hosted; Three.js and its types are 0.187.0 for the bounded accent.

## Dependency checkpoint

T01 provides the durable outbox and worker claim primitive. T04 and T05 may enter `awaiting_T06_integration` after their independent foundation checks pass. T06 integrates funded confirmation, committed charge/fee amendments and cash/entitlement remedy reservations. Mark T04–T06 verified only when the combined transaction and concurrency checks pass. Resume the earliest unfinished task whose prerequisites are ready.

## Evidence log

### T01 executed checks (2026-11-11, isolated development/test)

Scoped foundation commit: `ec6d91a74a046c71d382fcb8498a462a1aaf11db`.

| Command | Observed result | Artifact |
|---|---|---|
| `pnpm install` | Initial attempt failed on large package download timeout; longer timeout and reduced fetch concurrency succeeded | `install.log`, `install-retry.log` (local) |
| `pnpm peers check` | Exit 0 after compatible ESLint pin | Terminal output |
| `python tools/verify-pack.py` | Exit 0, 147 cases, 84 preserved IDs, 18 requirements, 33 scenarios | Terminal output |
| `pnpm test:unit` | Exit 0, 46 passed in consolidated run | `.local/t01-check.log` |
| `pnpm exec vitest run tests/unit/config.test.ts` | Review regression: 2 failed then 9 passed after public-key classification fix | `.local/config-review-red.log`, `.local/config-review-green.log` |
| `pnpm exec vitest run tests/integration/worker-recovery.test.ts` | Review regression: 3 failed then 3 passed; reclaimed dispatch reconciles before retry | `.local/worker-review-red.log`, `.local/worker-review-green.log` |
| `pnpm test:integration` | Exit 0, 14 passed including scratch migration, isolated guards and worker recovery | `.local/integration-final.log` |
| `pnpm db:verify` | Exit 0, 7 private RLS tables, 5 functions and api-only exposure | `.local/db-verify-final.log` |
| `pnpm typecheck` | Exit 0 | `.local/types-final.log` |
| `pnpm build` | Exit 0, optimized homepage and not-found output, includes lazy decorative model | `.local/t01-check.log` |
| `pnpm test:e2e` | Exit 0, 10 passed desktop/mobile, including RTL and decorative lazy load; first attempt failed because Chromium was not installed, then installed and reran | `docs/DESIGN-REVIEW.md`, local Playwright artifacts |
| `pnpm lint` | Exit 0, no errors or warnings in consolidated run | `.local/t01-check.log` |
| `pnpm check` | Exit 0; lint, types, 46 unit + 14 database integration + 10 browser tests and production build all pass | `docs/evidence/t01-check.log` |

Fresh review identified public-key classification, uncertain provider redispatch, local migration-history namespace, development-target acceptance by tests, and false-positive empty-database verification. All five findings have regression fixes; the consolidated run above passes. Local migration history now lives in `git_tutor_migrations`, leaving Supabase's namespace available for the actual CLI.

No full acceptance status has been upgraded: GT-1601 has executed responsive/RTL browser checks but later public/portal routes remain to be built; GT-1603 has validator test coverage but its complete linked evidence is not yet recorded; GT-1604's full ledger seed depends on later financial modules; GT-1605 has scratch migration/privilege coverage. The catalogue remains 147 `not_run`, and feature-level results above must not be confused with full-product acceptance.

## T02 identity and local Auth

### T02 executed checks (2026-11-11, isolated local Supabase)

Scoped identity milestone commit: `eeb21ed94aaf45e3e9b617f7fb94979f37d68a40`.

Final consolidated `pnpm check`: **exit 0**, lint/types clean, **58 unit**, **38 real database integration**, **38 browser** checks passed, optimized production build succeeded. Browser checks ran with 6 workers and included the delayed-script regression. Preserved result: `docs/evidence/t02-check.log`. Supabase, both native baselines and synthetic seed repetition were separately verified as described below.

- `pnpm exec vitest run tests/integration/identity.test.ts`: initial missing-RPC RED, then 11 core checks passed. Extended direct-RPC, concurrency, queue scope and transport checks exposed two defects, fixed in additive migrations; latest executed run passed 23 checks including scoped management reads (`.local/t02-identity-final.log`).
- `pnpm exec vitest run tests/integration/staff-invitation-worker.test.ts`: 1 passed against real local Supabase Auth and Mailpit. A crash after the provider accepted the email was reclaimed and reconciled without a second email, Auth user or role grant. This check first ran after implementation and is regression evidence, not claimed RED evidence.
- `pnpm exec vitest run tests/unit/http.test.ts`: latest 7 passed. Host normalization and PKCE-hash regressions each failed before their fix; captured in `.local/t02-callback-host-{red,green}.log` and `.local/t02-callback-pkce-{red,green}.log`. Strict inputs, safe errors, cookie mutation origins and redirect host restrictions are covered.
- `pnpm exec playwright test tests/e2e/email-verification.spec.ts --workers=1`: 4 passed across desktop/mobile with actual Auth and Mailpit. Signup verification preserves ordinary customer access; staff verification/password setup still requires explicit invitation acceptance before the Operations link appears. All four verify `Referrer-Policy: no-referrer` on the token-bearing callback.
- Email browser RED exposed Next.js's normalized internal `localhost` URL and Supabase's legitimate `pkce_` hash prefix. Callback now validates the browser Host against approved origins and preserves the prefix for provider verification. Role-browser execution also found an incorrect test expectation (private object denial is scoped 404), creation status changes and cold-navigation/concurrent-run artifact interference. Failed runs remain documented separately; see `docs/T02-AUTH-PREFLIGHT.md`.
- A separate agent reviewed root Auth, HTTP and worker boundaries and found no new important issue. Current-session database checks, strict DTOs, allowed redirect origins and reconciliation-before-resend were inspected.
- CLI migrations added: `20261111105723_identity.sql`, `20261111112214_identity_auth_bridge.sql`, `20261111112624_identity_review_transport.sql`, `20261111113232_identity_management_reads.sql`. Applied migrations remain unchanged; corrections are additive.
- `pnpm db:verify`: exit 0; native baseline 7 RLS tables/5 functions and real Supabase 5 migrations/19 private RLS tables/37 function boundaries. `pnpm seed:synthetic`: repeat run exit 0; 12 deterministic actual Auth users and two scoped guardian links, without a data reset (`.local/t02-db-verify-final.log`, `.local/t02-seed-repeat.log`).
- UI review replaced manual concurrency-version fields with actual scoped relationship/role selection. Subsequent review fixes cover refreshed post-acceptance navigation, discarded stale pagination responses and approval choices limited to submitted subjects. Focused actual browser checks and the final consolidated run pass. Final CLI inspection of all four portals at desktop and 360px reports zero overflow, console errors/warnings or failing HTTP responses; see `docs/DESIGN-REVIEW.md` and `.impeccable/review/t02-inspection.json`.
- First consolidated `pnpm check`: lint/types passed, 58 unit and 38 integration checks passed, 35/36 browser checks passed, then exit 1 before build. The desktop invitation acceptance navigated to the same page without committing its command; the database still showed `pending`, `accepted_at:null`, version 1. A delayed-script regression reproduced enabled controls before hydration. Shared auth/identity/sign-out controls now remain disabled until their handlers are ready; the focused regression passed 2/2 and the subsequent consolidated run passed all 38 browser checks. Failure evidence remains in `docs/evidence/t02-check-first-failed.log`.

### Decisions and dependencies

- T03: shared restricted JSON Schemas are consumed by pinned Zod 4.6.7 and snapshotted into PostgreSQL validation. Unsupported converter features are excluded and tested; database semantics independently enforce publication cross-rules. Final focused coverage is 116 unit and 18 actual Supabase integration checks, including 71 shared policy and 15 pricing vectors, immutable publication, exact fee bands, approved tutor projections, transport and repeated seeds. The consolidated milestone and browser publication walkthroughs pass as recorded below.
- T03: preserve the supplied amounts in canonical synthetic seeds and exact arithmetic tests. A new explicitly approved, immutable pricing version may define different amounts or fee bands as a new approved contract; it cannot rewrite a prior published version or an accepted quote. Initial tier sizes remain 2, 3 and 4.
- T03: initial HTTP regression execution returned 2 failures as expected before routes existed (anonymous catalog returned 401; unavailable administrative route returned 404). `pnpm exec playwright test tests/e2e/catalog-transport.spec.ts --workers=1 --output=.local/t03-transport-green` now passes 6 desktop/mobile checks: anonymous filtering, unsupported/duplicate filter rejection, current customer denial of administrative reads/writes, and public reads with an invalid unexpired account cookie. The last case first reproduced HTTP 503 (`.local/t03-public-cookie-red.log`); public routes now use the stateless anonymous client. Passing output: `.local/t03-transport-green.log`. Full cross-domain acceptance remains unclaimed.

- T02: Docker was recovered by preserving its stale one-socket runtime directory and recreating the runtime directory; existing unrelated container configuration and volumes were preserved. Project-local Supabase is now running with ports bound to loopback, PostgreSQL 17.11, actual Auth/PostgREST/Storage/Mailpit and a persisted disposable-test marker. Local secrets are confined to ignored `.local/supabase.json`; web environment contains public Supabase configuration only.
- T02: actual Supabase exposed a migration-owner privilege difference masked by native superuser tests. A reproducible local preflight grants the required migration ownership permissions before applying the unchanged T01 migration through the CLI. Native migration checks retain an explicit T01-only baseline; identity tests use real Auth, never a fabricated auth schema. See `docs/T02-AUTH-PREFLIGHT.md`.
- T02: add own verified-contact and authenticated application-subject reads to support the specified command inputs in usable forms; keep the two-only anonymous RPC rule unchanged. Exact projections are recorded in the API contract.
- T02: actual Supabase prevents a custom role from receiving Auth-schema usage. Four narrowly scoped, private, read-only Auth bridge functions use the documented `postgres` owner exception. Exposed business functions retain dedicated NOLOGIN/NOBYPASSRLS ownership. The verifier checks each exact exception's signature, body, result, volatility and EXECUTE ACL; all other owner constraints remain enforced.
- T02: setup scripts now pair the isolated T01 native baseline with full real-Supabase migrations, verification and synthetic Auth seeding. Local Auth email is captured by Mailpit; invitation activation remains an explicit verified-recipient command after delivery.
- T02: guardian invitation and relationship business notices are durably queued. Their routed email delivery belongs to T09; only Auth-owned verification/invitation delivery is implemented here. No full cross-domain acceptance case is claimed from these identity checks.

- Ruling: execute the supplied design and ordered plan without a second design-approval round; the user explicitly authorized autonomous routine implementation. Cost if wrong: UI refinement may be needed; no live offer is published.
- Ruling: use the existing PostgreSQL binary for isolated real transaction tests while Docker is unavailable. Cost if wrong: Supabase-specific integration differences remain release blockers until the local/full staging stack is exercised.
- Preserve T04/T05 as `awaiting_T06_integration` after independent checks. Funded confirmation, financial amendments and shared remedies remain unavailable until real integrated transactions pass.
- All external providers remain fake/manual. Live Supabase, Google, SES, WhatsApp, scanner and approved collection settings require separate readiness evidence. No live data, sends or migrations are authorized by synthetic development.

### T03 executed checks (2026-11-11, isolated local Supabase)

Final consolidated `pnpm check`: **exit 0**, lint/types clean, **174 unit**, **56 real database integration**, **50 browser** checks passed, optimized production build succeeded. Browser checks use two workers with unchanged assertions and zero retries. Preserved output: `docs/evidence/t03-check.log`. Final CLI review covers five catalog surfaces at desktop/mobile and public RTL with no console errors, failing HTTP responses or horizontal overflow; `docs/DESIGN-REVIEW.md` and `.impeccable/review/t03-inspection.json` record the observations.

Delivered public subjects/offers/approved tutor biographies and structured admin pricing, package-policy and publication workflows. Synthetic seeding preserves two canonical pricing bundles, four policies and eight offers across five subjects; it rejects conflicting canonical content and unapproved noncanonical tutor drafts. Approval uses actual Auth-bound administrative commands. Exact seed identities, private/public boundaries and limitations are in `docs/T03-DATABASE-EVIDENCE.md`.

- Coordinating agent: `pnpm exec vitest run tests/unit/pricing.test.ts tests/unit/policies.test.ts tests/integration/catalog-privacy.test.ts` exited 0 on 2026-11-11 at 14:25 local time: 3 files, 125 tests passed (114 unit and 11 actual Supabase integration checks). Output: `.local/t03-root-domain.log`.
- Catalog transport: 6 desktop/mobile tests passed as detailed above. Browser publication, canonical seed repetition, final privilege verification and the consolidated regression run subsequently passed.
- Independent review found draft-update response fields that failed the strict DTO after a successful commit, and creation responses incorrectly returning 200. Six real RPC transport regressions failed before the correction and passed after additive migration `20261111123015_catalog_transport_contract.sql`: creation 201, replay 200, exact update shapes, durable replay and concurrent version conflict. Existing command history is preserved; legacy update results are safely projected on replay. Evidence: `.local/t03-rpc-transport-red.log`, `.local/t03-rpc-transport-green.log`. The earlier initial HTTP RED artifact was overwritten by a log-name collision; its observed failure is recorded above, but that original artifact is no longer available.
- `pnpm build` exited 0 during production-rendering review (`.local/t03-prerender-review.log`). `/subjects`, `/offers`, offer/tutor detail and admin catalog are server-rendered on demand. Subjects use the bundled Next.js `connection()` API so new publications appear without rebuilding. This diagnostic build precedes the final browser-driven loading-component correction and is not the final consolidated milestone run.
- Final validation review reproduced two parity defects: oversized safe-integer group settings threw during SQL integer conversion, and the TypeScript provenance helper accepted nonsynthetic development records which SQL rejected. Additive migration `20261111123430_catalog_policy_integer_validation.sql` and the aligned helper resolve both. The combined catalog unit/integration command now passes 134 checks (116 unit, 18 database), including 71 shared policy vectors and 15 pricing vectors; `.local/t03-parity-red.log` and `.local/t03-parity-combined-green.log` retain the executed results.
- First consolidated `pnpm check` exited 1 at lint: `src/app/page.tsx:41` used an anchor for `/offers`, which the Next.js internal-link rule rejects now that the route exists. Later stages did not run. Failure: `docs/evidence/t03-check-first-failed.log`. The link and reviewed mobile admin record-list height were corrected before the final run.
- Coordinating agent `pnpm db:verify` exited 0: native foundation 7 private RLS tables/5 functions, actual Supabase 9 migrations/25 private RLS tables/69 function boundaries (`.local/t03-root-verify.log`).
- Second consolidated `pnpm check`: lint/types, 174 unit and 56 integration checks passed; 44/50 browser checks passed, six timed out and build did not run. The six-worker run exceeded 5-second readiness/navigation assertions across catalog, Auth and the decorative model, plus both 30-second multi-account public-catalog journeys. Screenshots showed the completed Auth navigation after its assertion deadline. The local suite now bounds browser workers at two, preserving all assertions, zero retries and each test's independent accounts/connections. Failure evidence: `docs/evidence/t03-check-browser-timeouts.log`; the bounded rerun passed all 50 browser checks and the production build.
- `pnpm exec tsx tools/validate-evidence.ts` and `python tools/verify-pack.py` both passed: 147 original cases remain `not_run`, all 84 preserved IDs, 18 requirements, 13 tasks and 33 synthetic scenarios remain valid. Actual booking agreement records, funded confirmations, package ledgers, and real email/export/download confidentiality checks remain with their owning later tasks; no full cross-domain acceptance claim is inferred from catalog projections.

## Continuation

The first incomplete task is T04. T01–T03 pass their local milestone checks. Continue reservations, availability and proposal foundations. Preserve the T04–T06 integration barrier: funded confirmation, committed financial amendments and shared remedies require the combined T06 transaction/concurrency checks before all three tasks are marked verified.
