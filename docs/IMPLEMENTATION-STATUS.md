# Implementation status

## Current handoff state

Implementation started 2026-11-11. T01's local foundation is verified; T02 begins next. No full acceptance case is marked passed without linked execution evidence; the original acceptance catalogue remains unrun pending its owning checks and later-domain prerequisites.

## Task progress

| Task | Deliverable | Status | Evidence |
|---|---|---|---|
| T01 | Repository foundation and test environment | Locally verified | `pnpm check` exit 0: lint, types, 46 unit, 14 integration, 10 browser tests, production build |
| T02 | Identity, roles and guardian scope | Starting | Real local Supabase stack downloading; auth preflight documented |
| T03 | Catalog, confidential pricing and policy publication | Planned | Pending implementation |
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

## Decisions and dependencies

- Ruling: execute the supplied design and ordered plan without a second design-approval round; the user explicitly authorized autonomous routine implementation. Cost if wrong: UI refinement may be needed; no live offer is published.
- Ruling: use the existing PostgreSQL binary for isolated real transaction tests while Docker is unavailable. Cost if wrong: Supabase-specific integration differences remain release blockers until the local/full staging stack is exercised.
- Preserve T04/T05 as `awaiting_T06_integration` after independent checks. Funded confirmation, financial amendments and shared remedies remain unavailable until real integrated transactions pass.
- All external providers remain fake/manual. Live Supabase, Google, SES, WhatsApp, scanner and approved collection settings require separate readiness evidence. No live data, sends or migrations are authorized by synthetic development.

## Continuation

The first incomplete task is T02. T01 foundation passes its local checks. Continue actual Supabase Auth/session/role implementation, then T03. Preserve the T04–T06 integration barrier and execute each owning suite before marking it verified.
