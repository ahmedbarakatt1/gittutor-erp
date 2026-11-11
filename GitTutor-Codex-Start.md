# Start the Git Tutor implementation

You are the senior software engineer responsible for building Git Tutor from this implementation pack.

## Goal

Implement the public website and the student/guardian, tutor, customer-service and admin portals. Deliver the complete local application, database migrations, synthetic seeds, automated tests, provider adapters and deployment documentation described in the pack.

## First actions

1. Locate this pack and inspect the repository, current branch, existing instructions, package manager, framework, tests and uncommitted changes.
2. Read `AGENTS.md`, `docs/00-contract-spine.md`, `docs/01-product-spec.md`, `docs/02-business-rules.md`, and `docs/superpowers/plans/2026-11-11-git-tutor.md`.
3. Read the architecture, data model and API contracts. Record the chosen or existing stack, exact supported versions, and any path mapping in `docs/IMPLEMENTATION-STATUS.md`.
4. Start T01 and continue through the ordered tasks. Honor the T06 integration barrier for T04 and T05. Use the acceptance criteria to determine completion. Resolve ordinary implementation choices autonomously and document meaningful choices.

## Product requirements that must survive every phase

- Private sessions and group classes use an occurrence with individual student enrollments.
- Group prices are EGP 575 per student for two students, EGP 550 for three, and EGP 500 for four. Internal tutor fees are EGP 450, EGP 600–650 and EGP 700–750 respectively. Store one exact approved fee for each confirmed occurrence.
- Customer payloads and outputs expose tuition, payments, credits, refunds and balances according to authorization. Internal compensation and margins remain in privileged records and responses.
- Packages support entitlement reservation, use, restoration and renewal transfers with explicit quantity and value conservation.
- A student or authorized guardian uploads payment proof. Customer service confirms a routine payment only after independently matching settled incoming funds. Handle installments, excess transfers, late transfers, reversals and refunds.
- Tutors manage profiles, availability, assigned teaching, preparation files, countdowns, their fee statements and payout methods.
- Session completion and subsequent corrections are auditable. Approved completion creates the base tutor earning exactly once. Settled payout allocations reduce the payable.
- Every customer and session has a durable identity and record history. Exports are scoped, filter-aware, auditable and safe for spreadsheet use.
- Email covers the essential operational events. Website support, WhatsApp FAQ and human handoff use explicit ownership and delivery state.
- Campaign reports count verified learner progression through first attendance. Keep returning learners, unknown history, unknown sources and verified organic traffic identifiable.

## Implementation approach

For a new repository, use Next.js App Router and TypeScript with Supabase Auth, PostgreSQL and private Storage, plus a durable Node.js worker. Follow an existing compatible repository's established patterns when one is present. Consult current official documentation and pin supported dependencies during bootstrap.

Build the narrow API/RPC boundary in the contracts. Use current database authorization, transactions, idempotency and optimistic versions. Keep external network calls in background adapters after durable business commits. Implement the documented failure and recovery states.

Use `contracts/pricing-policy.json` as internal authoring input and construct the separate customer pricing projection. Use `contracts/policy-settings.json` for draft commercial settings and clearly identified synthetic examples. Implement the admin policy-publication checks so the application can be developed before the owner finalizes every commercial term.

The original workbook supplies business scenarios. Use the synthetic fixtures in this pack for development. The UI specification is self-contained. If the earlier HTML preview is available, use it as an additional visual reference. The audited logic defects have corrected contracts here.

## Verification and progress

Create and maintain `docs/IMPLEMENTATION-STATUS.md` with a checklist of T01–T13, the last passing commands, failed checks, decisions and external dependencies. Map acceptance-case IDs to test files. Start each financial or concurrency task with its regression tests, implement the smallest coherent change, and rerun the owning checks.

Use separate real database connections for concurrency tests and real browser sessions for role isolation. Validate customer response schemas, file authorization, financial conservation, provider replay, and recovery. Review rendered desktop and mobile journeys.

If a provider credential or external account is unavailable, finish the adapter contract, local fake-provider tests, configuration validation and operator error states. Record the exact outstanding live check and continue other tasks. Keep test messages and synthetic data in the configured test environment.

Finish with the implemented features, test evidence, running instructions, unresolved defects and integration-readiness table. Continue until all locally achievable implementation tasks are complete.

## Resume prompt

Read `AGENTS.md`, `docs/IMPLEMENTATION-STATUS.md` and the implementation plan. Inspect the current diff and test results. Resume the earliest unfinished task whose prerequisites are ready, honoring the T06 integration barrier. Preserve completed work and continue through the remaining locally achievable tasks using the contracts and acceptance cases.
