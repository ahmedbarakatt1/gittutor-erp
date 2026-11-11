# Environment setup and release readiness

## Repository bootstrap

Task T01 owns the concrete application bootstrap. Codex inspects the existing repository first, then records the selected versions and paths. A new project uses the default stack in the architecture document and one package manager, with a committed lockfile.

Choose a supported Node.js LTS compatible with the selected Next.js version. Pin the runtime in the repository and CI configuration. The current Next.js installation guide documents the framework requirements and initial project options. [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)

Discover the installed Supabase CLI version and command help before writing scripts. Supabase CLI v3 changed local and hosted command targeting, so use the selected version's documented flags consistently in development and CI. Record the version with the bootstrap evidence. [Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3)

## Required project commands

T01 establishes these package scripts, adapting their implementation to the existing repository when necessary.

| Command | Required behavior |
|---|---|
| `pnpm dev` | Start the web application |
| `pnpm worker:dev` | Start the durable local worker |
| `pnpm lint` | Lint the changed application and shared contracts |
| `pnpm typecheck` | Check TypeScript without emitting application code |
| `pnpm test:unit` | Run pure domain and projection tests |
| `pnpm test:integration` | Run tests against a disposable real PostgreSQL/Supabase environment |
| `pnpm test:e2e` | Run Playwright against the configured local application |
| `pnpm build` | Build the production application |
| `pnpm db:verify` | Validate migrations, constraints, exposed schemas and function grants |
| `pnpm seed:synthetic` | Populate deterministic development users and scenarios in an isolated environment |
| `pnpm check` | Run lint, types and the appropriate automated test suites |

The commands above describe the implementation target. This handoff includes a separate Python pack validator. Application scripts are delivered by the implementation tasks.

## Configuration

Copy the keys from `.env.example` into the local development environment. Supply values through the platform's secret manager for hosted environments. The two `NEXT_PUBLIC_` fields are the public Supabase URL and publishable key. Privileged keys, OAuth tokens, payout destination encryption and worker connections stay on server-side paths.

### Local providers

Fake adapters return deterministic provider identifiers, pending/success/failure sequences and callback replays. The development UI labels simulated delivery states. Unit tests use pure domain fixtures. Integration tests persist real records while substituting provider network boundaries.

The file-scan fake is confined to isolated tests and development. Live upload access depends on the configured scanning result. Production configuration validation reports a missing required live adapter as a readiness error.

### Live dependency checklist

| Dependency | Required input | Verification |
|---|---|---|
| Supabase | Project, Auth settings, publishable key, private server access, private buckets and allowed schemas | Separate student, guardian, tutor, CS and admin authorization tests |
| Incoming payments | Approved InstaPay destination, approved Vodafone Cash destination, responsible statement-verification staff | Match a controlled settled transfer, preserve evidence and reconcile allocations |
| Google Calendar/Meet | OAuth application, connected organizer calendar, allowed redirect, configured tutor host access | Create, reschedule, cancel and recover an occurrence with external learner admission |
| Email | Verified sending identity, chosen SES region and approved event destination | Deliver to controlled test recipients and process authenticated delivery/bounce events |
| WhatsApp | Business account, phone number, access token, webhook verification and approved templates | Inbound event, FAQ response, human handoff, service-window restriction and eligible template |
| File scanning | Reachable private scanner and allowed content policy | Safe fixture allowed, malicious or unsupported fixture quarantined |
| Recovery | Database backup, object storage recovery plan and job replay procedure | Restore isolated data and files, then reconcile financial and delivery records |

The payment design starts with manually verified receiving-account evidence. A future provider API is integrated through the reconciliation adapter after its actual access and settlement semantics are established.

## Development and staging

Use dedicated test accounts and synthetic data. Seed operations verify the target environment before changing records. Tests isolate their data and concurrent sessions. The staging environment has its own credentials, receiving destinations where appropriate, sender configuration and callback URLs.

Provider network timeouts are tested separately from business transaction failure. A repeated provider callback updates the same logical operation. A worker restart resumes persisted jobs without repeating a financial posting.

## Deployment topology

Deploy the Next.js application to a supported web host. Deploy the Node.js worker to a runtime that supports the required background lifetime and restart behavior. Supabase hosts Auth, PostgreSQL and private object storage. A web request schedules durable work and returns its saved state.

CI runs the required static, unit, real-database and browser checks before staging deployment. Database changes use reviewed additive migrations with a rehearsed recovery path. Record any existing data compatibility or backfill separately from the application deployment.

## Operational visibility

Expose dashboards and alerts for the oldest payment case, unallocated settled funds, unresolved payout outcomes, missing Meet links near class time, failed scans, stale outbox jobs, bounced critical email, unassigned human support and financial reconciliation differences.

Each job, command, provider operation and audit event shares an appropriate correlation identifier. Logs redact raw receipts, tokens, financial destinations and private study material. The retention policy identifies the owner, duration and authorized deletion/archive path for each record class.

## Recovery objectives

Use an initial staging rehearsal target of recovery within four hours and a data-loss window no greater than the configured backup interval. The owner selects the production RTO and RPO before release based on the actual hosting plan. The release record states the chosen values and measured recovery result.

The rehearsal restores database state and the associated private objects, validates referential integrity, resumes provider reconciliation and outbox processing, and compares seats, package entitlement, allocations and payouts against the pre-recovery controls.

## Release evidence

`docs/IMPLEMENTATION-STATUS.md` contains the task checklist and exact verification commands. The implementation agent also creates `docs/RELEASE-READINESS.md` with the current commit, environment, approved policy versions, provider states, unresolved issues and test evidence.

The live release requires complete offer terms, approved receiving accounts, working identity scopes, reconciled financial fixtures, a real private/group pilot, critical notification delivery, file-access checks and a successful recovery rehearsal.

## Documentation references

Use the current official documentation when implementing each adapter or framework boundary.

- [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [Codex repository instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Supabase changelog](https://supabase.com/changelog.md)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
