# Git Tutor engineering instructions

Read `README.md`, `docs/00-contract-spine.md`, `docs/01-product-spec.md`, and the implementation plan before making changes. Read the owning domain contracts before each task. In an existing repository, reconcile these paths with the pack's actual location and preserve established project instructions.

## Product and data

- Build all four portal experiences for student/guardian, tutor, customer service and admin, together with the public website.
- Use the supplied group tuition of EGP 575, 550 and 500 per student for groups of 2, 3 and 4. Resolve one exact internal tutor fee from its configured range for each occurrence.
- Use integer minor units, explicit policy versions, UTC instants and Africa/Cairo business-date boundaries.
- Customer responses use an allowlist. Tutor fees, margins, internal notes, payout destinations and credentials require privileged access.
- Use synthetic seed data. The workflow spreadsheet is a source of scenarios. Real customer records require a separate authorized migration task.
- Draft commercial settings support local scenarios. Publishing an offer requires its complete, approved policy.

## Implementation

- Inspect the repository before choosing versions or creating files. Use the existing stack when compatible and record the mapping to the task plan. For greenfield work, use the stack in `docs/03-architecture.md`.
- Keep application logic in domain modules. Database transactions own capacity, allocations, entitlement movements, financial postings and outbox commits.
- Derive the actor from verified authentication and check current database role and relationship scope inside sensitive commands.
- Keep original financial postings immutable. Apply corrections through referenced adjustments. Count settled transfers and settled payouts according to the ledger rules.
- Persist idempotency keys and request hashes. Use version checks for conflicting edits. Test independent concurrent database connections.
- Implement provider adapters with explicit fake/live modes and visible integration states. Preserve failed and unknown outcomes for reconciliation.
- Keep project dependencies pinned and commit the lockfile. Verify current official documentation before installing or changing provider SDKs.
- Preserve user work and existing database contents. Keep development fixtures and destructive test resets isolated to disposable environments.

## Delivery

- Follow `docs/superpowers/plans/2026-11-11-git-tutor.md` task by task. Use installed execution/review skills when available. The documented task and evidence workflow also works directly in Codex.
- Add the tests required by the owning task and acceptance cases. Run focused checks after each change, then full release checks at T13.
- Keep `docs/IMPLEMENTATION-STATUS.md` current with task status, commands, results, decisions, known issues and external dependencies.
- Make scoped commits after passing the applicable checks. Continue through routine reversible work autonomously. Record credential-dependent integration checks and continue independent tasks.
- Report implementation, verification and live-provider readiness separately. Include the exact failing command for a blocked check.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
