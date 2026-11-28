# Architecture

## Runtime and ownership

Implements R01–R18 using the shared vocabulary in [00-contract-spine.md](00-contract-spine.md) and invariants in [02-business-rules.md](02-business-rules.md). Build one Next.js App Router application in TypeScript, Supabase Auth, PostgreSQL, private Supabase Storage, and a separately deployed durable Node.js worker. Pin supported versions and commit the lockfile during T01. These documents define the implementation contract. Generated application code and migrations belong to the implementation phase.

| Location | Responsibility |
|---|---|
| `src/app` | Pages, layouts, route handlers, accessibility, localized presentation |
| `src/modules/identity` | Accounts, current roles, guardian authority, verified contacts, tutor applications |
| `src/modules/catalog` | Public products, price versions, policy approval, safe public DTOs |
| `src/modules/booking` | Availability, occurrences, quotes, holds, group amendments |
| `src/modules/packages` | Purchases, lots, credit-quanta movements, renewal and remedies |
| `src/modules/payments` | Evidence, cases, transfers, allocations, refunds, accounting postings |
| `src/modules/teaching` | Attendance, actual delivery, completion, calendar requirements |
| `src/modules/tutor_pay` | Fee agreements, earnings, destinations, payout reservations |
| `src/modules/files` | Upload authorization, quarantine, scan results, authorized downloads |
| `src/modules/crm` | Identity review, follow-up ownership, imports, scoped snapshot exports |
| `src/modules/notifications` | Event routing, templates, recipient resolution, delivery state |
| `src/modules/support` | Website chat, WhatsApp messages, consent, human ownership |
| `src/modules/analytics` | Cohorts, attribution evidence, workload and reconciled projections |
| `src/server` | Request authentication, DTO serialization, database RPC client, provider adapters |
| `src/worker` | Job leases, integration execution, reconciliation, retry and scheduled work |
| `tests`, `supabase` | Synthetic tests, migration history and local infrastructure |

Each domain owns its validation schemas, DTOs, commands and query adapters. Route handlers validate transport, call one domain command, and serialize its allowlisted result. Database constraints and command transactions enforce cross-record invariants. Domain code imports another domain through its exported contract. Provider SDKs and secrets stay in server-only modules.

## Request boundary

Public pages use only sanitized catalog and tutor-profile reads. Signed-in pages and `/api/v1` routes use a per-request Supabase SSR client carrying the user's verified access token. Verify identity through `getClaims()`, refresh cookies through the framework's supported proxy integration, and retain the refreshed response cookies and cache headers. Protected HTML, API responses and file responses use `Cache-Control: private, no-store`. The application then checks current database authorization. [Supabase SSR client documentation](https://supabase.com/docs/guides/auth/server-side/creating-a-client)

Expose only the `api` PostgreSQL schema through the Data API. `app_private` owns operational records and `finance_private` owns money, compensation and sensitive destinations. Base tables receive zero `anon` or `authenticated` grants. Signed-out visitors read generic subject descriptions and published prices from the website. Catalog records, including session availability and tutor profiles, require a verified active account. No API function grants execution to the anonymous database role. [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)

Website FAQs are published static content. Visitor chat uses a scoped Supabase anonymous Auth session, which carries the PostgreSQL `authenticated` role. Its support RPCs permit only that account's own anonymous thread. Booking, relationship, file, financial and staff commands require a verified non-anonymous account. Inspect anonymous status explicitly alongside role checks. Linking a chat to a learner requires verified account ownership and a single-use thread challenge.

Sensitive commands execute inside one PostgreSQL function call. Its inputs contain business IDs and values. The function derives its actor through `auth.uid()`, validates the JWT session against the current Auth session and application account, reads current role membership and guardian scope, and locks affected records. Never send privileged user commands through a service credential. Function ownership, execution grants and RLS requirements are defined in [06-security-integrations.md](06-security-integrations.md).

## Atomic command protocol

Every business mutation has a stable command name, corresponding HTTP route and narrow RPC. The canonical naming and request fields appear in [05-api-contracts.md](05-api-contracts.md).

1. Authenticate and authorize the current account, session, role and resource scope.
2. Normalize accepted typed arguments and compute their canonical request hash inside the command boundary. Include command version and `expected_version`.
3. Claim the unique `(actor_account_id, command_name, idempotency_key)` row. Equal keys and hashes return the committed original result after current authorization. A different hash returns `IDEMPOTENCY_CONFLICT`.
4. Lock shared resources in stable UUID order, check versions, expiry and current policy, then enforce conservation and capacity.
5. Save business changes, immutable audit entries, accounting effects where applicable, domain events, and outbox jobs in the same transaction.
6. Commit and return the safe result. A failed transaction leaves no partial business effect. External provider calls run after commit.

Use a single lock order across commands, beginning with occurrence, then learner/package lots, transfer or financial obligation, and reservation. PostgreSQL uniqueness and exclusion constraints remain the final race controls. Retry a serialization/deadlock failure with the same idempotency key. Bound automatic retries to three attempts and return `RETRYABLE_CONFLICT` afterwards. Monetary arithmetic uses PostgreSQL integer operations and explicit rounding rules.

## Durable execution from T01

T01 creates the outbox, lease protocol, idempotency and audit primitives. T09 adds notification routing and templates to that queue. T04 implements holds, schedules, quotes and amendment proposals. T05 implements entitlement movements. T06 integrates settled funding, refund reservations, confirmation and accepted amendments. Mark T04–T06 `awaiting_T06_integration` until their shared concurrency and cash/entitlement-remedy tests pass together.

The worker claims due jobs with a short `FOR UPDATE SKIP LOCKED` transaction, records a lease token and expiry, commits, then calls the adapter. Completion updates require that lease token. Expired leases become reclaimable. Store `attempt_count`, `available_at`, `last_error_code`, provider request/reference IDs and correlation IDs. Use exponential backoff with jitter for transient failures, a configured maximum attempt count, and a visible failed-job queue with an assigned owner.

Provider message/event IDs deduplicate callbacks. A timeout after a possible external success enters reconciliation before another send, payout or event creation. Business posting remains idempotent. Notification reporting distinguishes one logical delivery from its attempts. Replays check current recipient authority, contact verification, consent and resource version before dispatch.

| Partial failure | User-visible result | Recovery action |
|---|---|---|
| Booking committed, Meet pending | Confirmed booking with meeting preparation status | Retry/reconcile existing calendar event |
| Payment evidence saved, scan pending | Evidence processing | Worker completes scan or requests replacement |
| Settled money, expired seat | Payment recorded, booking decision required | Capacity recheck or approved funds remedy |
| Email failure | Business action saved, delivery attention required | Owner corrects verified destination and requests logged resend |
| Payout/refund timeout | Transfer outcome unknown, amount reserved | Reconcile external evidence before another attempt |
| Export worker fails | Export failed with retry action | Retry the same authorized snapshot |

## Deployment and verification

Deploy web and worker separately against the same migration version. Use a least-privilege worker database login and server-only integration credentials. The web deployment needs user-token RPC access plus a constrained storage service wrapper. Readiness checks verify schema version and required dependencies. Graceful worker shutdown stops new leases and allows bounded in-flight completion.

Development uses deterministic fake adapters and synthetic records. Staging tests live adapters with approved test accounts. Production publication rejects synthetic policies and incomplete live-provider configuration. The 84 historical scenarios are acceptance plans. Record execution evidence against the current acceptance suite and fixtures before release.

The November 2026 Supabase CLI v3 change makes local targets the default and changes hosted-command flags and confirmation behavior. Bootstrap must inspect the pinned CLI's `--help`, record the selected target, and review generated migration diffs. [Supabase CLI v3 changelog](https://supabase.com/changelog/supabase-cli-v3)
