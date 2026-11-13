# Git Tutor

## Run the local implementation

The public website and student/guardian, tutor, customer-service and admin portals are implemented for synthetic testing. Start with the [guided demo](docs/DEMO-WALKTHROUGH.md), [local testing instructions](docs/LOCAL-TESTING.md) and [implementation status](docs/IMPLEMENTATION-STATUS.md). The original Instagram logo and red, charcoal, cream and yellow design are documented in [brand provenance](docs/BRAND-ASSETS.md). The [online-preview instructions](docs/ONLINE-PREVIEW.md) describe temporary access from other devices and its current verification state.

The separately authorized [actual workbook import](docs/ACTUAL-DATA-IMPORT.md) is now available at `/admin/workflow`, private to its own records-owner account. Its 139 historical source records are searchable and retain reported values and review flags; they do not become verified operational transactions automatically. The real-data login and manifest are ignored under `.local/workflow-import/`. Demonstration accounts cannot read them. This database now contains real private records: preserve it and use a separate disposable environment for destructive tests.

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

Session delivery, tutor earnings/payouts, finance controls, notifications, customer records, scoped exports, support/WhatsApp handoff and acquisition/workload reports are implemented. Compensation, destinations and internal records remain behind role and relationship checks; customer-facing pages, responses and downloads use their separate safe projections. All development identities and files are synthetic. Keep the GitHub repository private because the source includes privileged commercial configuration; keep `.local/` and `.env.local` untracked.

The separate native PostgreSQL foundation cluster uses port 55432 with disposable `gittutor_dev` and `gittutor_test` databases. Its migration runner covers T01 only; the same commands then apply and verify all domain migrations against actual Supabase. Integration checks require their persisted disposable-target marker and refuse the native development database. See [database setup evidence](docs/T01-DATABASE-EVIDENCE.md) and [Auth setup evidence](docs/T02-AUTH-PREFLIGHT.md). Restarts preserve local volumes; `pnpm supabase:restart` reloads Auth templates and configuration without resetting data.

Run the worker separately with `pnpm worker:dev`. Run `pnpm check` for static, unit, database, browser and build checks after `pnpm exec playwright install chromium`. Use `pnpm db:verify` for required migration objects and privilege checks. `pnpm exec tsx tools/validate-evidence.ts` validates acceptance evidence without changing case statuses.

Provider modes default to fake/manual in isolated development. The bootstrap configures local Supabase automatically; use `.env.example` as the key reference for other environments. Production startup requires an explicit `APP_ENV` and complete live configuration; the current local implementation is not a live-release approval.

Prepared by Hossam Nabil Elsabbagh. Revision 1, 11 November 2026.

This folder is a development handoff for the Git Tutor website and tutoring operations platform. It contains the requirements, pricing contracts, data and API design, implementation tasks, synthetic scenarios, and acceptance criteria that Codex should use when building the application.

## Start in Codex

1. Extract this folder into the directory where the application will be developed.
2. For a new project, open this folder as the project root. For an existing repository, place the pack in `implementation/git-tutor/` and ask Codex to merge the relevant root instructions while preserving that repository's existing guidance.
3. Open the project in Codex. For the CLI, open a terminal in that directory and run `codex` after completing the normal installation and sign-in flow.
4. Paste the contents of [CODEX-START.md](CODEX-START.md) into the first task.
5. Codex should inspect the repository, record its bootstrap choices, and execute the ordered implementation tasks. Missing external credentials are tracked in the integration readiness table while local implementation continues.

`AGENTS.md` provides compact repository instructions. Codex supports repository instructions through this filename. [Official AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

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

## Choices made for the handoff

- A greenfield implementation uses Next.js App Router, TypeScript and Supabase Auth/PostgreSQL/private Storage, plus a durable Node.js worker.
- The currency starts with EGP and the business timezone is Africa/Cairo. The supplied group amounts are interpreted as per occurrence in development scenarios.
- Tutor compensation and margins are privileged internal data. The customer contract contains tuition and the customer's financial position.
- The workbook supplies workflow examples. Test and seed records are synthetic. The supplied names, contacts, balances and payment history are excluded from this pack.
- Duration, deposits, holds, cancellation remedies, package terms and group amendments remain versioned commercial settings. Synthetic settings allow implementation and testing. Publication checks require complete, approved offer terms.
- The visual starting point is the earlier red, ink and warm-ivory Git Tutor interface. The latest pricing image supplies the commercial amounts. Brand assets and theme approval are recorded before public publication.

## Pack verification

Run `python tools/verify-pack.py` from this folder to check document links, JSON structure, requirement coverage, pricing arithmetic and synthetic-fixture consistency. This checks the handoff resources. Application test commands are established by task T01 and then executed by each owning task.

## Expected first deliverable from Codex

A running local application with working authentication boundaries, the public catalog, confidential group pricing, a persisted private/group reservation, and the first automated database and browser checks. Subsequent tasks complete packages, payment review, teaching, finance, notifications, customer records, support and analytics.

Continue through the implementation plan until its local completion conditions are met. Record the exact external configuration still required for live integrations in `docs/IMPLEMENTATION-STATUS.md`.
