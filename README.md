# Git Tutor

Git Tutor takes a student's course materials from a tutoring request through scheduling, payment review, teaching and settlement. Start with the [colleague handoff](docs/handoff/README.md) for the current system, diagrams, source map and first-day runbook. The [shared preview](https://gittutor-erp-rho.vercel.app/login) is the hosted testing environment. The [launch review](docs/IMPLEMENTATION-STATUS.md) records the separate commercial release decision.

## Run the local implementation

The public website and student/guardian, tutor, customer-service and admin portals are implemented for synthetic testing. Start with the [guided demo](docs/DEMO-WALKTHROUGH.md), [local testing instructions](docs/LOCAL-TESTING.md) and [implementation status](docs/IMPLEMENTATION-STATUS.md). The original Instagram logo and red, charcoal, cream and yellow design are documented in [brand provenance](docs/BRAND-ASSETS.md). The [online-preview instructions](docs/ONLINE-PREVIEW.md) describe the hosted testing address and how to access it.

The separately authorized [actual workbook integration](docs/OPERATIONAL-DATA-PLAN.md) connects 139 historical source records to the main dashboards and workspaces, with 5 canonical student profiles, 11 tutors and 18 courses in a separate private preview backend. Historical payment/completion labels remain reported; uncertain identities can be reviewed without inventing financial evidence. New practice activity uses normal booking, payment, teaching and payroll commands with isolated providers. One designated private booking used real Google Meet. The source archive remains at `/admin/workflow`. Private logins, manifests and practice files are ignored under `.local/operational-preview/`; shared demonstration accounts cannot access that backend. Preserve both databases and use only separately guarded disposable environments for destructive tests. Current executed checks and availability are in [implementation status](docs/IMPLEMENTATION-STATUS.md).

Use the pinned Node runtime from `.node-version`, pnpm 11.25.0, Docker Desktop with its Linux engine running, and PostgreSQL 17 binaries for the isolated foundation tests.

```powershell
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:migrate
pnpm seed:synthetic
pnpm dev
```

Open `http://127.0.0.1:3000`. The local Supabase stack provides actual Auth, PostgreSQL, private Storage and a captured email inbox, bound to loopback ports 54321, 54322 and 54324. The bootstrap writes public web configuration to ignored `.env.local`; synthetic account credentials remain in ignored `.local/supabase.json`. Register a new account at `/signup` and open its verification email in the local inbox at `http://127.0.0.1:54324`. No external recipient is contacted.

For a verified empty disposable project, `pnpm db:migrate` first applies the historical catalog migrations and seeds their original approved synthetic records, then applies newer policy gates. A durable local bootstrap record allows an interrupted seed to resume. Existing projects receive additive migrations; their approved records are preserved. `pnpm seed:synthetic` remains repeatable. Generic production migrations contain no fixture seeding. See the current execution limits in the implementation status.

The synthetic catalog contains the supplied two-, three- and four-student tariffs, an explicit private-session example, and offers for Computer Science, Engineering, Business and Business Intelligence. Browse `/subjects` and `/offers`; use the seeded administrator account to manage versioned pricing, commercial terms and approved tutor biographies at `/admin/catalog`. Seeding preserves existing records and refuses conflicting canonical fixture content. Local synthetic publication does not approve those terms for a live environment.

The booking seed adds four future forming sessions with approved exact tutor agreements. Customers and authorized guardians choose a named learner at `/learn/bookings`, reserve a temporary seat, and review its exact quote. Tutors manage availability and their assigned schedule at `/tutor/schedule`; administrators manage schedules, agreements and scoped proposals at `/admin/schedule`. Run the worker for hold expiry, waitlist offers and formation-deadline decisions. Settled funding drives confirmation; group additions/removals/repricing, enrollment transfers, cancellation and package remedies use real financial transactions. The combined automated T04–T06 checkpoint has executed; the status document separates that result from open formal/manual acceptance variants. Repeated seeding preserves the original fixture clock and refuses to overwrite a changed schedule.

Package purchases and histories are available at `/learn/packages`, with approved bonus policies and review tools at `/admin/packages`. The synthetic package seed adds two approved contracts, matching sessions and separate bonus lots. A purchase creates an issued obligation; its purchased credits activate only after its saved funding rule is satisfied by settled allocations. Usable credits support reservation, release, renewal and transfer with recorded quantity/value history. Exceptional coverage and duration conversions require exact current consent. The worker processes lot expiry and releases package reservations when booking holds end.

Customers can inspect payment instructions and review status at `/learn/payments` and masked refund history at `/learn/refunds`. Customer service compares customer evidence with independently verified transfers at `/service/payments`; administrators manage collection accounts, reconciliation and refund attempts at `/admin/payments` and `/admin/refunds`. The payment seed adds a synthetic installment and source-owned surplus-credit example. Actual private uploads, scan gates and authorized downloads are implemented; the guided demo includes independent evidence and exact-byte download checks. All payment providers remain fake/manual; no real transfer is requested or sent.

Session delivery, tutor earnings/payouts, finance controls, notifications, customer records, scoped exports, support/WhatsApp handoff and acquisition/workload reports are implemented. Compensation, destinations and internal records remain behind role and relationship checks; customer-facing pages, responses and downloads use their separate safe projections. Automated fixtures are synthetic; the separately authorized preview contains real imported identities/history and explicitly labelled practice activity. Keep the GitHub repository private because the source includes privileged commercial configuration; keep `.local/` and `.env.local` untracked.

The separate native PostgreSQL foundation cluster uses port 55432 with disposable `gittutor_dev` and `gittutor_test` databases. Its migration runner covers T01 only; the same commands then apply and verify all domain migrations against actual Supabase. Integration checks require their persisted disposable-target marker and refuse the native development database. See [database setup evidence](docs/T01-DATABASE-EVIDENCE.md) and [Auth setup evidence](docs/T02-AUTH-PREFLIGHT.md). Restarts preserve local volumes; `pnpm supabase:restart` reloads Auth templates and configuration without resetting data.

Run the worker separately with `pnpm worker:dev`. Run `pnpm check` for static, unit, database, browser and build checks after `pnpm exec playwright install chromium`. Use `pnpm db:verify` for required migration objects and privilege checks. `pnpm exec tsx tools/validate-evidence.ts` validates acceptance evidence without changing case statuses.

Provider modes default to fake/manual in isolated development. The bootstrap configures local Supabase automatically; use `.env.example` as the key reference for other environments. Production startup requires an explicit `APP_ENV` and complete live configuration; the current local implementation is not a live-release approval.

## Original implementation pack

The original specification and implementation plan were prepared by Hossam Nabil Elsabbagh on 11 November 2026. They describe the starting requirements and remain useful for tracing a decision. Read [AGENTS.md](AGENTS.md) for repository instructions and [CODEX-START.md](CODEX-START.md) for the original implementation brief. For current ownership, runnable commands and remaining work, use the [handoff](docs/handoff/README.md).

## What controls implementation

| File | Purpose |
|---|---|
| [CODEX-START.md](CODEX-START.md) | Initial implementation prompt and continuation instructions |
| [AGENTS.md](AGENTS.md) | Persistent engineering rules |
| [docs/00-contract-spine.md](docs/00-contract-spine.md) | Shared vocabulary, requirement IDs and authoritative inputs |
| [docs/01-product-spec.md](docs/01-product-spec.md) | User journeys, scope and completion conditions |
| [docs/02-business-rules.md](docs/02-business-rules.md) | Pricing, packages, session and financial rules |
| [docs/03-architecture.md](docs/03-architecture.md) | Application boundaries and runtime architecture |
| [docs/04-data-model.md](docs/04-data-model.md) | Record grains, constraints and transaction responsibilities |
| [docs/05-api-contracts.md](docs/05-api-contracts.md) | Commands, queries, request fields and responses |
| [docs/06-security-integrations.md](docs/06-security-integrations.md) | Role scopes, files, Meet, payments, email and WhatsApp |
| [docs/07-ui-spec.md](docs/07-ui-spec.md) | Website, four portal experiences and component behavior |
| [docs/08-acceptance-tests.md](docs/08-acceptance-tests.md) | Test layers, traceability and required evidence |
| [docs/09-setup-release.md](docs/09-setup-release.md) | Environment setup, deployment and recovery readiness |
| [docs/superpowers/plans/2026-11-11-git-tutor.md](docs/superpowers/plans/2026-11-11-git-tutor.md) | Ordered, checkable implementation tasks |
| [contracts/pricing-policy.json](contracts/pricing-policy.json) | Confirmed pricing inputs and internal compensation ranges |
| [contracts/policy-settings.json](contracts/policy-settings.json) | Draft business settings and synthetic development examples |
| [fixtures/acceptance-cases.json](fixtures/acceptance-cases.json) | Machine-readable acceptance cases |
| [fixtures/domain-scenarios.json](fixtures/domain-scenarios.json) | Synthetic domain scenarios and expected outcomes |
| [docs/PACK-VALIDATION.md](docs/PACK-VALIDATION.md) | Handoff validation results and implementation status |

## Verifying the pack

Run `python tools/verify-pack.py` to check local document links, JSON structure, requirement coverage, pricing arithmetic and synthetic-fixture consistency. Run the application tests separately as described in [local testing](docs/LOCAL-TESTING.md) and the [operations guide](docs/handoff/03-operations-and-release.md).
