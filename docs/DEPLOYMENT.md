# Deploying Git Tutor

The [hosted testing preview](ONLINE-PREVIEW.md) uses its own authorized historical and practice records. The clean production project has separate credentials and data. The latest release decision and environment checks are in [implementation status](IMPLEMENTATION-STATUS.md). Mailjet is the selected email provider. The owner selected Vercel for production on 19 November. The commercial project uses dedicated settings on the current team. The earlier Oracle option is recorded in the [hosting decision](FREE-SERVICE-PLAN.md). Review [production inputs](PRODUCTION-INPUTS.md) before switching environments.

## Worker dispatch tracking rollout

Drain the previous worker revision, apply `20261122010100_worker_dispatch_tracking.sql`, run the restricted-worker grant check from the new revision, and start the updated workers. The database keeps both legacy claim signatures for existing callers. Older workers lack dispatch checkpoints and can park untouched jobs if they reclaim them during a mixed-version rollout.

Each updated worker leases one job at a time. If it stops before committing the send checkpoint, a successor can start the untouched job. A committed checkpoint means a send may have reached the provider. Recovery consults the provider or retains the job for reconciliation. Existing in-flight leases without checkpoint history receive the same conservative treatment.

## Vercel testing environment

The selected [gittutor-erp project](https://vercel.com/gittutor2-2821/gittutor-erp) is `prj_IVsk4r5XCIBXXP0HMcr27IIgTtmg` under the newly authenticated `gittutor2-2821` team, `team_pXDCumF5MnW3q30r2TXYm9BZ`. On15November, deployment `dpl_CpvZkQ9YoCEiCeUrThmuoxQwps48` became READY at [the stable hosted preview](https://gittutor-erp-rho.vercel.app), with one ready Frankfurt worker. Next.js uses Node24.x, pinned frozen pnpm installation and Corepack. The pilot is deployed explicitly. The later bounded Calendar pilot uses organizer consent for its nominated occurrence. The earlier account's project and both local databases remain unchanged. The owner requested keeping Hobby; no paid upgrade occurred.

This project uses Vercel's Production deployment scope because Daemons require it, but **the application and database are development-only** (`APP_ENV=development`, operational preview marker, isolated adapters and one bounded live Calendar pilot). The public landing/login are reachable without Vercel authentication; ordinary application authentication and database role/scope checks protect the imported records. Fresh aliases and private walkthrough files are in ignored `.local/hosted-preview`. Do not promote this database or its fictional practice postings to production.

Use Vercel CLI 65.16.0 with `--global-config 'D:/GitTutor System/.local/vercel-brave-auth'` for the new account. Do not silently fall back to the original CLI credentials. The new Supabase login uses `.local/supabase-brave-profile.yaml` and `SUPABASE_HOME=.local/supabase-brave-auth`; its verified organization is `gittutor` (`jsnlueglhoymfefjeloc`) and holds separate hosted projects for testing and production. Authentication files remain private and ignored. The separately unauthenticated app connector does not prevent CLI management.

Root `vercel.json` remains the web template. The isolated pilot source uses the daemon example with one1GiB `fra1` instance and120-second shutdown grace. Its private deployment configuration is `.local/hosted-preview/normal-vercel.json`; preserve that explicit choice on subsequent pilot deploys. `.vercelignore` limits uploads to application/build inputs and runtime contracts, excluding the workbook, `.local`, credentials, authored compensation, tests and browser sessions. A regression verifies directory traversal as well as leaf files. The exact injected Vercel observability key is discarded by server configuration without widening the customer DTO. Full CI passed on `d17bec41a214e37dd75d7ac4cf92d11143169391`; subsequent focused changes and actual hosted journey results are recorded in IMPLEMENTATION-STATUS. Current-plan testing does not establish commercial production eligibility or uninterrupted worker capacity.

Connect the `ahmedbarakatt1/gittutor-erp` repository to the selected Vercel team. Review `codex/production-readiness` before selecting a production branch; do not promote an unverified revision automatically. Use these project settings:

| Setting | Value |
|---|---|
| Framework / root |Next.js / repository root|
| Node runtime |24.x; Vercel manages its patch version|
| Package manager |`pnpm@11.25.0`, from `packageManager`|
| Build environment |`ENABLE_EXPERIMENTAL_COREPACK=1`|
| Install / build |Commands in `vercel.json`; frozen lockfile|
| Output |Framework default; leave `GIT_TUTOR_STANDALONE` unset|
| Testing origin |The stable project alias. Configure the commercial hostname and matching Auth and organizer callbacks after the owner selects a suitable production host.|
| Region |Select after inspecting the Supabase project region and connection limits|

Add production runtime keys from `deploy/production.env.example` through Vercel's secret/environment settings. Keep operator database credentials out of Vercel. Separate Preview and Production settings and databases; never expose real records through a shared demo login. Configure Supabase site/redirect URLs and provider callbacks for the exact assigned origin. A fresh Vercel deployment URL is not evidence that its database, worker or external providers work. [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build), [Node runtime versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [upload exclusions](https://vercel.com/docs/deployments/vercel-ignore).

Git Tutor needs the continuous worker for exports, quarantine scans, notifications, scheduling and other durable jobs. Vercel now offers **Daemons in public beta**. `deploy/vercel-daemon.example.json` is a reviewable complete configuration with the worker stopped (`fra1:0`); its region is a placeholder. After selecting the region, account plan and operating budget, merge it into root `vercel.json` and explicitly enable one instance. The existing Dockerfile's final target is the worker, so Vercel can use its default command; no Next server runs inside that daemon. The 120-second grace period matches the portable deployment. Current health evidence covers the Docker heartbeat check and idle shutdown; the daemon has no configured HTTP liveness probe, and hosted restart/loaded shutdown still require verification. [Daemon configuration](https://vercel.com/docs/daemons/config-reference).

Daemons run only in Vercel's Production environment. Use a separate staging Vercel project for a hosted worker rehearsal, or an isolated external worker; a normal Preview web deployment alone cannot exercise the full flow. Hobby daemon quotas stop workers when exhausted:420 GB-hours/month supports approximately17.5 days at1 GiB, even while idle. Confirm an appropriate plan and budget before activation. The private malware scanner needs a reachable secured endpoint; another daemon cannot accept its inbound TCP traffic. [Daemon limits and billing](https://vercel.com/docs/daemons/limits). Git Tutor is a commercial service, so use a commercial plan: Vercel restricts Hobby to personal, non-commercial use. Inspect the owner's existing plan before proposing any upgrade. [Vercel plans](https://vercel.com/pricing).

After hosted database preparation below, run preflight, then verify `/healthz`, authenticated roles, a controlled booking/payment/file/export journey, actual queue processing, confidentiality, provider delivery and recovery on the hosted target. Record the deployed Git revision and provider/runtime settings without secrets. Keep production writes closed until those gates pass.

### Private scanner for the selected Vercel production host

The commercial worker has a separate, zero-instance configuration example. It requests 8 GiB for the Node worker, ClamD and signature updater in one Linux amd64 daemon. ClamAV recommends at least 3 GiB for its scanner and prefers 4 GiB. Vercel offers the 8 GiB size on Pro and Enterprise. The current 1 GiB pilot continues to use its isolated scanner. [Production daemon example](../deploy/vercel-private-scanner.example.json) · [Vercel daemon quotas and networking](https://vercel.com/docs/daemons/limits) · [ClamAV memory requirements](https://docs.clamav.net/manual/Installing/Docker.html)

The production image pins the official ClamAV 1.4.7 LTS and Node 24.22.1 images by Linux amd64 digest. It starts ClamD on the container's IPv4 loopback and checks the kernel's listeners before starting the worker. ClamD and FreshClam run under a separate user with a restricted environment. The worker streams up to 25 MiB through the existing adapter. Each scan checks the content hash, engine response and signature age. A stale signature, timeout, scan-limit alert, encrypted input or infection prevents release. Every daemon replacement starts from bundled signatures and refreshes them from ClamAV. Update the pinned engine and image digests as new security patches arrive. [ClamAV release](https://blog.clamav.net/2026/11/clamav-155-147-security-patch-release.html) · [ClamD socket guidance](https://docs.clamav.net/manual/Usage/Scanning.html) · [Image and supervisor](../deploy/vercel-scanner/Dockerfile)

**Image rehearsal.** The [19 November cloud rehearsal](https://github.com/ahmedbarakatt1/gittutor-erp/actions/runs/44552463030) passed with the pinned image, real signatures and the harmless antivirus test. Run the manual GitHub Actions workflow *Private scanner image rehearsal* on the reviewed revision. A maintainer can also apply the `verify-private-scanner` label to its pull request. The job uses one standard Ubuntu runner for at most 20 minutes, builds locally on that runner, checks the Linux amd64 architecture and absence of published ports, and exercises the clean and EICAR outcomes with signed definitions. It uses synthetic bytes and requires no hosted application credentials. A green job should log `private_scanner_self_test_passed`. To keep this private-repository run within the included allowance, check remaining Actions compute and the billing account's hard overage limit before dispatch. [Workflow](../.github/workflows/private-scanner-rehearsal.yml) · [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Budget controls](https://docs.github.com/en/billing/how-tos/set-up-budgets)

Activation still requires the owner's commercial plan, verified production settings with `FILE_SCAN_ADAPTER=clamav` and `FILE_SCAN_URL=tcp://127.0.0.1:3310`, and explicit approval to scale the production daemon to one. The same endpoint value satisfies web configuration validation. The worker alone connects to it. Verify a 25 MiB clean upload, a synthetic quarantine, signature refresh across restart and queue recovery in the selected project before accepting customer uploads.

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

The new account's Free organization owns [gittutor-erp-staging](https://supabase.com/dashboard/project/tjrbvejvnquhmqdwsacy), region `eu-central-1`. All151 migrations applied on15November. The authorized139 source records and canonical identities are imported with their original historical uncertainty; separate fictional practice supports hosted verification. This is the isolated development preview: `APP_ENV=development`, explicit fake adapters and operational marker. Never promote it by relabelling its data. The application rejects fake adapters in `staging`/`production` mode.

Before a first hosted migration, execute [bootstrap-owner-roles.sql](../deploy/bootstrap-owner-roles.sql) as the database operator against the verified empty target. It mirrors the local migration runner's role-membership and temporary schema-CREATE prerequisites and refuses existing Auth users or application relations. The first hosted `db push` failed at `ALTER DEFAULT PRIVILEGES` without these grants; it rolled back entirely. After bootstrap, the unchanged migration chain succeeded. Revoke the temporary CREATE grants as shown in that file after migration, including on an interrupted attempt before leaving the target unattended. Do not alter applied migration checksums.

Hosted TLS uses `sslmode=verify-full` and `sslrootcert=contracts%2Fruntime%2Fsupabase-root-2021.crt`. The public CA is included in actual Next server traces and worker images; deployed file transport/worker execution passed. Provenance: Supabase Studio's [official configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) and [CA download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt), SHA256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Keep hostname/certificate validation enabled. Upstream SSL enforcement, both operator/worker TLS connections,35 exact RPCs,zero unsafe table grants/missing RLS and private Storage were checked. Signup is disabled;18 private test aliases were prepared without contacting real learners.

Use separate operator and restricted worker credentials. The runtime worker connects as `git_tutor_worker`; the operator connection is never provided to the web or worker. Use certificate-verified TLS, direct PostgreSQL or the session pooler on5432, and the exact selected Supabase project. The transaction pooler is not the documented worker target. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Supabase CLI3.1.0 targets local services by default. The following remote syntax was verified with the installed CLI help and the migration push/dry run executed against the isolated hosted development preview:

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

Configuration-only success means `configuration_valid_target_unverified`. The full command uses read-only transactions and rejects preview origins, fake adapters, mismatched projects, insecure/privileged worker connections, test identities/fixtures, migration mismatch, unsafe raw-table grants and missing row security. It verifies the exact worker RPC signatures listed in the production preflight, required owners and effective execution including PUBLIC/inherited permissions; missing or extra application RPC access blocks promotion. Output contains fixed check names and booleans, never credential values or database errors. Exit1 blocks promotion. A passing technical report still says `technical_checks_passed_activation_pending`: it does not approve commercial policy, verify provider credentials or close hosted recovery and data-review gates. Repeat complete role, private-file and revocation checks in staging; static configuration cannot prove them.

## Real data cutover

The owner authorized migrating the workbook's real records. Reuse its unchanged source checksum and reviewed canonical mapping, not the preview's Auth users, practice sessions, simulated payments, synthetic policies or generated credentials. The existing local import/preparation tools intentionally refuse production and must not be repointed by disabling their guards.

On the selected clean hosted target, prepare a separate transactional migration: bind the import to the verified owner; retain the139 immutable source links; create only reviewed canonical identities/courses; reconcile source counts/checksums and every role projection. Keep unresolved identities, missing dates, package terms and reported balances unresolved. Historical `Paid`/`Completed` labels do not establish settlement, attendance, entitlement or payroll postings. Verify real account ownership/guardian relationships before granting access; do not send invitations automatically. Any financial opening entries require independent evidence and referenced adjustments, preserving originals.

Before switching DNS, compare customer pages, APIs, email payloads, exports and downloaded files against the compensation allowlist. Test denied-role access separately from privileged owner/tutor views. Retain the source and rollback manifest privately; disable new writes during final reconciliation rather than merging unreviewed activity afterward.

## Private upload staging and cleanup

Vercel requests use3MiB pieces while preserving5MiB receipt and25MiB teaching-file limits. Complete bytes still pass server type/size/hash/archive checks before immutable adoption, and scanning/current access remain mandatory. Downloads and exports stream through the authorized application route. The local Linux Vercel build and local tests do not prove the hosted payload path; include a25MiB upload/interruption/retry/download in the hosted pilot.

Every chunked intent writes a private, immutable version1 cleanup manifest at `git-tutor-private/<file-id>/parts/<intent-checksum>/cleanup.json` before staging bytes. Successful adoption attempts deletion of only those parts. Failed deletion emits `file_chunk_cleanup_pending` with a file ID; the manifest remains even after success to cover process death or a late concurrent write. Manifests and keys are never public attachments.

Until an approved retention schedule is configured, the responsible Storage operator must reconcile candidates explicitly:

1. Inspect private manifests through the authorized Storage account. Match `file_id`, whole checksum and size to the immutable database upload intent. Accept only version1/kind `file_chunk_cleanup_candidate` and the exact derived index0–8 paths; never trust an arbitrary supplied deletion path.
2. For an adopted upload, independently verify that its canonical immutable object exists and matches the recorded complete checksum/size. Delete only the listed staging pieces, never the adopted object or manifest. Check the provider error field and confirm absence; record the result privately. Repeated reconciliation is safe, including after a concurrent late write.
3. For an unadopted or disputed upload, preserve candidate bytes until the owner-approved retention/incident policy authorizes cleanup. No age-based deletion schedule is invented by this deployment.

The manifest is a durable candidate inventory, not an assertion that cleanup succeeded. Configure operator ownership, retention and alert routing before production activation.

## Provider activation, recovery and release gates

At launch, set `WHATSAPP_ADAPTER=manual` on both web and worker processes. Leave the Meta settings empty. Customers can open the WhatsApp link for +20 15 08823452 or use the website inbox. Staff answer each conversation in its original channel. Manual mode skips WhatsApp queue entries and rejects Cloud callbacks. Keep previous delivery records for review before enabling any later Cloud integration.

Follow [release readiness](RELEASE-READINESS.md) for controlled live checks covering approved commercial policy, bank settlement evidence, Calendar/Meet organizer permissions and session-length entitlement, the selected Mailjet sender, actual Auth link journeys and the final worker sender, malware quarantine and hosted Auth delivery. A successful SMTP submission records a send. Verify delivery independently and reconcile unknown attempts. Never activate a live sender against a preview backlog. Fake modes remain confined to isolated development/test. Expose only approved HTTPS callbacks with signature/account/redirect validation.

Schedule linked database/private-object backups and approve retention, RPO/RTO and an accountable operator. Restore into a separate hosted project and verify Auth access, object hashes, financial controls, encryption-key recovery and pending-job reconciliation before launch. `tools/recovery-rehearsal.ts` is a marked-local runner and cannot prove hosted recovery.

CI provisions fresh disposable data and runs static, unit, database, browser, build and evidence-format checks. Record each real outcome in [implementation status](IMPLEMENTATION-STATUS.md); never turn an unexecuted acceptance variant into a pass. Production requires completed acceptance/recovery gates plus hosted verification, not just a successful image build. Packaging follows [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Docker build-secret guidance](https://docs.docker.com/build/building/secrets/).
