# Deploying Git Tutor

The local preview is a synthetic test environment. Hosted activation remains separate from local testing. Use a dedicated staging Supabase project and controlled recipient accounts first.

## Processes and build

The root `Procfile` defines separate web and durable worker processes. Both must deploy the same reviewed commit and database migration version. Use Node24.22.1 and pnpm11.25.0, install with `pnpm install --frozen-lockfile`, then run `pnpm build`. Retain the runtime dependencies needed by the TypeScript worker. The web process uses the host's `PORT`; give the worker a continuous process with automatic restart and a termination grace period for its current leased jobs.

Supply public Supabase URL/publishable-key settings during the web build. Supply server settings through the hosting platform's secret manager, following `.env.example`. Never deploy `.local`, `.env.local`, browser authentication state, test reports or recovery archives. Never put server keys, payout encryption keys or the worker connection into public build settings. Preserve encryption keys across deployments and rotate them using the implemented versioned procedure.

## Database and storage

Apply reviewed `supabase/migrations` in filename order using the platform's migration mechanism. The local `supabase:start`, seed and native-database tools deliberately target marked disposable environments and are not production migration commands. Keep applied migration checksums unchanged. Create private Storage buckets and constrain the worker login to its documented RPC grants. Run `pnpm db:verify` locally before promotion and reproduce the documented role/grant checks against staging using its authorized operator connection.

Do not copy local synthetic Auth users, fixture registries or financial history into production. Real customer migration requires a separate authorized task. Configure Auth redirects and SMTP, connect the approved organizer, verify payment destinations, and publish complete approved commercial policies before accepting bookings.

## Provider activation and recovery

Production must use configured live providers. Fake adapters are restricted to isolated development/test environments. Follow the exact controlled checks in [release readiness](RELEASE-READINESS.md) before changing provider modes or directing customers to the host. Expose only the configured HTTPS callback routes and validate provider signatures, topics/accounts and redirect allowlists.

Schedule linked database/private-object backups. Approve retention, recovery targets and an accountable operator before launch. Keep backup manifests and encryption material private and separately recoverable. `tools/recovery-rehearsal.ts` performs a source-preserving rehearsal against the marked local Supabase instance; it cannot be pointed at production. A hosted rehearsal must also validate restoration into a separate project, including Auth sessions, object bytes, financial control totals and pending-job reconciliation.

The checked-in CI workflow provisions fresh synthetic databases and runs the required application checks. Its first hosted run and any staging/production deployment must be recorded separately; local execution does not attest either.
