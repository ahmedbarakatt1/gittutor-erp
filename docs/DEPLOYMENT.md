# Deploying Git Tutor

Production activation is pending. The actual-data preview contains private imported history alongside explicitly fictional practice activity; it is not a production database. Preserve both local databases and the source workbook. Use a separate hosted staging project before the clean production cutover.

## Portable web and worker images

`Dockerfile` provides pinned Node24.22.1/pnpm11.25.0 targets. Both processes must use the same reviewed commit and matching migrations. The strict `.dockerignore` allowlist excludes local credentials, source workbooks, test fixtures, browser state and authored compensation policy. `contracts/runtime` contains the application schemas needed at runtime. No private build arguments or build secrets are required. Next standalone output is opt-in, preserving ordinary local `next start` behavior.

```powershell
docker build --target web --tag gittutor-web:REVIEWED_COMMIT .
docker build --target worker --tag gittutor-worker:REVIEWED_COMMIT .
```

Publish these only to the selected private registry, then deploy immutable digests. `compose.production.yml` expects `GIT_TUTOR_WEB_IMAGE`, `GIT_TUTOR_WORKER_IMAGE` and an absolute private `GIT_TUTOR_ENV_FILE`. It runs both processes without root privileges, with read-only root filesystems, bounded writable caches and a 120-second stop grace period. It exposes web port3000 only to the container network. The chosen host must supply HTTPS ingress, DNS, secret storage, a private scanner, automatic restarts, monitoring and backups. No hosting account or paid resources have been provisioned.

Use `deploy/production.env.example` as the runtime key inventory. Inject actual values through the host secret manager; never commit them. Both adapters and `APP_ENV=production` must be explicit. Preserve versioned encryption keys across deployments and recover them separately from backups. Public Supabase configuration is projected by the server through its allowlist; these images are built without project-specific public or private settings.

`GET /healthz` is **web liveness only**; it does not attest Auth, database, storage or providers. Next may remain running while invalid production configuration makes requests and liveness fail. The worker healthcheck requires a recent successful queue/handler heartbeat. Neither healthcheck replaces the preflight and controlled hosted journeys below. Container restart alone does not reconcile unknown financial/provider outcomes.

The executable packaging smoke check uses a fresh labelled PostgreSQL container with an empty stub queue and no existing database access:

```powershell
docker build --target web --tag gittutor-web:production-check .
docker build --target worker --tag gittutor-worker:production-check .
pnpm exec tsx tools/verify-production-images.ts
```

It checks image contents/non-root execution, the read-only web image and logo/security headers, idle worker heartbeat/SIGTERM, and rejection of unconfigured production. It is not a substitute for the real-database integration suite or an in-flight shutdown test. Successful runs remove only their own labelled disposable resources; failed runs preserve them for diagnosis.

## Hosted database preparation and preflight

Use separate operator and restricted worker credentials. The runtime worker connects as `git_tutor_worker`; the operator connection is never provided to the web or worker. Use certificate-verified TLS, direct PostgreSQL or the session pooler on5432, and the exact selected Supabase project. The transaction pooler is not the documented worker target. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Supabase CLI3.1.0 targets local services by default. The following remote syntax was verified with the installed CLI help; these commands have **not** been run against a hosted project:

```powershell
pnpm exec supabase migration list --remote=SELECTED_PROJECT_REF
pnpm exec supabase db push --remote=SELECTED_PROJECT_REF --dry-run --skip-vault
# Only after reviewing the exact target and pending migrations:
pnpm exec supabase db push --remote=SELECTED_PROJECT_REF --skip-vault --yes
```

Apply reviewed migrations in filename order. Never use seed flags, synthetic bootstrap tools, a preview database dump or destructive reset commands on the hosted target. Keep applied checksums unchanged. On the clean target only, set its environment metadata to its actual staging/production identity with no fixture marker; do not relabel a populated preview. Provision the restricted worker login with a private password, required narrow grants, private Storage buckets, API schema exposure, Auth redirects/SMTP and an initial verified owner. These operator steps require the selected hosted project and must be reviewed there before activation.

Run the production preflight from the reviewed source checkout with private runtime settings plus operator-only `deploy/preflight.env.example` values. An example using private files outside the repository is:

```powershell
node --env-file=C:/private/git-tutor-runtime.env --env-file=C:/private/git-tutor-preflight.env --import tsx tools/production-preflight.ts --config-only
node --env-file=C:/private/git-tutor-runtime.env --env-file=C:/private/git-tutor-preflight.env --import tsx tools/production-preflight.ts
```

Configuration-only success means `configuration_valid_target_unverified`. The full command uses read-only transactions and rejects preview origins, fake adapters, mismatched projects, insecure/privileged worker connections, test identities/fixtures, migration mismatch, unsafe raw-table grants and missing row security. It verifies all35 exact worker RPC signatures, required owners and effective execution including PUBLIC/inherited permissions; missing or extra application RPC access blocks promotion. Output contains fixed check names and booleans, never credential values or database errors. Exit1 blocks promotion. A passing technical report still says `technical_checks_passed_activation_pending`: it does not approve commercial policy, verify provider credentials or close hosted recovery and data-review gates. Repeat complete role, private-file and revocation checks in staging; static configuration cannot prove them.

## Real data cutover

The owner authorized migrating the workbook's real records. Reuse its unchanged source checksum and reviewed canonical mapping, not the preview's Auth users, practice sessions, simulated payments, synthetic policies or generated credentials. The existing local import/preparation tools intentionally refuse production and must not be repointed by disabling their guards.

On the selected clean hosted target, prepare a separate transactional migration: bind the import to the verified owner; retain the139 immutable source links; create only reviewed canonical identities/courses; reconcile source counts/checksums and every role projection. Keep unresolved identities, missing dates, package terms and reported balances unresolved. Historical `Paid`/`Completed` labels do not establish settlement, attendance, entitlement or payroll postings. Verify real account ownership/guardian relationships before granting access; do not send invitations automatically. Any financial opening entries require independent evidence and referenced adjustments, preserving originals.

Before switching DNS, compare customer pages, APIs, email payloads, exports and downloaded files against the compensation allowlist. Test denied-role access separately from privileged owner/tutor views. Retain the source and rollback manifest privately; disable new writes during final reconciliation rather than merging unreviewed activity afterward.

## Provider activation, recovery and release gates

Follow [release readiness](RELEASE-READINESS.md) for controlled live checks: approved commercial policy, bank settlement evidence, Calendar/Meet organizer permissions, SES sender/SNS callbacks, WhatsApp account/templates/consent, malware quarantine and hosted Auth delivery. Fake modes remain confined to isolated development/test. Expose only approved HTTPS callbacks with signature/account/redirect validation.

Schedule linked database/private-object backups and approve retention, RPO/RTO and an accountable operator. Restore into a separate hosted project and verify Auth access, object hashes, financial controls, encryption-key recovery and pending-job reconciliation before launch. `tools/recovery-rehearsal.ts` is a marked-local runner and cannot prove hosted recovery.

CI provisions fresh disposable data and runs static, unit, database, browser, build and evidence-format checks. Record each real outcome in [implementation status](IMPLEMENTATION-STATUS.md); never turn an unexecuted acceptance variant into a pass. Production requires completed acceptance/recovery gates plus hosted verification, not just a successful image build. Packaging follows [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Docker build-secret guidance](https://docs.docker.com/build/building/secrets/).
