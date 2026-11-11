# T01 database and worker evidence

Executed 11 November 2026 in `D:\GitTutor System`. This records database-foundation checks only; it does not claim T02 identity, Supabase Auth, storage, or business acceptance cases have passed.

## Local target

- Installed PostgreSQL executable: `C:\Program Files\PostgreSQL\17\bin\postgres.exe`, version **17.2**.
- New isolated cluster: `.local/postgres`; loopback `127.0.0.1:55432`; databases `gittutor_dev` and `gittutor_test`. Existing PostgreSQL services/databases were not modified.
- Random local administrator/worker credentials are stored only in ignored `.local/database.json`. Host connections use SCRAM authentication. The worker login has execute access to private worker functions and no direct application-table access.
- `tools/db-start.ps1` is idempotent and never resets data. `tools/db-migrate.ts` verifies the isolated target, locks migration execution, records checksums in the native-local `git_tutor_migrations.applied_migrations` table, and refuses changed applied migrations. It does not create or overload the Supabase CLI history namespace. `tools/db-seed.ts` performs no deletion and uses both URL/environment checks and a persisted database-environment marker.
- Installed Supabase CLI **3.1.0**. Read `--help`, `init --help`, and `migration new --help`; ran `pnpm dlx supabase@3.1.0 init` and `pnpm dlx supabase@3.1.0 migration new foundation_outbox`. Generated migration: `supabase/migrations/20261111103635_foundation_outbox.sql`.
- The generated CLI configuration exposes only `api`, disables automatic table exposure, and disables unguarded automatic SQL seeding.
- Native PostgreSQL is the local database test environment because Docker Desktop's Linux engine was unavailable. This does not simulate a successful Supabase Auth/Storage deployment. Supabase connector `search_docs` returned a reauthentication error; official documentation was read using the web fallback.

## Executed verification

| Command | Result |
|---|---|
| `powershell -NoProfile -File tools/db-start.ps1` | Exit 0; isolated databases created, rerun preserved them |
| `pnpm test:integration tests/integration/outbox.test.ts` before migration | Exit 1; 1 passed, 5 failed because the foundation schema and worker role did not exist |
| `pnpm db:migrate` | Exit 0; generated migration applied independently to both disposable databases |
| `pnpm test:integration tests/integration/outbox.test.ts` after migration/final tests | Exit 0; **10 passed, 0 failed, 0 skipped** |
| `pnpm seed:synthetic` | Exit 0; 12 deterministic actor fixture identities registered; domain activation remains owned by subsequent tasks |
| `pnpm db:verify` | Exit 0; 7 private tables have RLS and no browser grants, 5 private functions checked, `api` is the only exposed schema |
| `pnpm worker:dev --once` | Exit 0; configuration validated, explicit fake/manual integration states logged without secrets, single polling iteration exited |
| `pnpm typecheck` | Exit 0 at database-foundation checkpoint |
| `pnpm exec eslint src/server/database.ts src/worker tools/db-migrate.ts tools/db-seed.ts tools/db-verify.ts tests/helpers/environment.ts tests/integration/outbox.test.ts` | Exit 0, no findings |

Follow-up review verification (executed after the initial checks):

| Command | Result |
|---|---|
| `pnpm exec vitest run tests/unit/database-environment.test.ts tests/integration/outbox.test.ts tests/integration/migration-security.test.ts` before guard/verification fixes | Exit 1; **3 failed, 9 passed**. Demonstrated development DB accepted as integration target, persisted production marker accepted by test setup, and empty database incorrectly passing verification |
| Same command after fixes | Exit 0; **12 passed, 0 failed, 0 skipped** |
| `pnpm db:migrate` after local history correction | Exit 0; existing history/data preserved by exact-shape/marker-checked schema/table rename in both isolated databases |
| `pnpm db:verify` after fixes | Exit 0; required schemas, seven tables, five functions, applied migration checksums and worker grants exist before boundary inspection |
| `pnpm typecheck` after fixes | Exit 0 |

`GT-1604` maps to the explicitly named **foundation subset** in `tests/integration/outbox.test.ts`. Deterministic actor identity/replay and the production seed guards passed. Full GT-1604 remains **not run**: the case additionally requires ledger cash `130000`, tutor payable `30000`, relationship scopes, receipts, credits and complete business reseed equivalence. Those records are not implemented by T01; the original fixture acceptance status remains unchanged.

`GT-1605` maps to `tests/integration/migration-security.test.ts` and the private-boundary test in `tests/integration/outbox.test.ts`. It executes all current migrations twice from empty randomly named disposable databases, comparing table/sequence/function permissions and owner/search-path/RLS state. Only the newly created `gittutor_migration_<12 hexadecimal characters>` database is removed between runs. Existing `gittutor_dev` and `gittutor_test` contents are preserved. Normal integration connections accept **only** `gittutor_test` and verify the persisted test/disposable marker before writes. The production-marker regression restores the original marker values in `finally`.

The final integration tests exercise production-designated seed refusal (including a production database marker), deterministic seed replay, business/outbox rollback, event identity replay and changed-payload rejection, two distinct PostgreSQL backend PIDs racing one job, expired lease recovery, stale completion rejection, worker/browser raw-table denial, unknown-outcome reconciliation gating, and delayed/bounded retries.

An intermediate whole-repository `pnpm lint` encountered an executable-wrapper path failure while dependency installation overlapped. The final focused lint command above passed. Whole-repository lint belongs to the root T01 verification record.

## Decisions and remaining readiness

- The local SQL migration runner targets only the two disposable native databases; a hosted migration/deployment workflow must use the pinned Supabase CLI's documented remote target/consent flags.
- T01 registers synthetic actor labels and deterministic UUIDs. It does not invent authenticated accounts; T02 owns account creation, session validation, roles, and guardian links.
- `src/server/database.ts` supports explicit connection configuration; its administrator fallback is restricted to isolated local use. Sensitive user commands must use the authenticated RPC boundary implemented in T02. The separately scoped worker login can only call its lease/complete/failure functions.
- Unknown provider outcomes enter `reconciliation`, retain identity, and cannot be automatically claimed again. No live-provider delivery was attempted.
- PostgreSQL 17.2 is the available local executable; a current supported patch and the actual Supabase environment require independent staging verification before live release.

## Reproducing the native local environment

Use PowerShell from the project root with Node 22.22.2, pnpm 11.25.0 and PostgreSQL 17 binaries installed. `GITTUTOR_POSTGRES_BIN` may point to a different existing installation; no system PostgreSQL service is required or changed.

```powershell
$env:GITTUTOR_POSTGRES_BIN = 'C:\Program Files\PostgreSQL\17\bin'
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:migrate
pnpm seed:synthetic
pnpm test:integration
pnpm db:verify
pnpm worker:dev --once
```

The checked-in bootstrap is Windows-specific; other platforms need an equivalent native PostgreSQL 17 process on loopback port 55432 and the same private manifest contract, or the separately configured Supabase stack. Do not redirect integration tests to another database: a development database, missing/production marker, non-loopback host or unexpected port is rejected. No hosted URL or live credential is needed for these commands. Seed/reset operations are not enabled on hosted targets.

Docker Desktop 4.35.1 was subsequently launched with `Start-Process -WindowStyle Hidden` as an isolated-stack preflight. It exited before starting its engine. `docker info --format '{{.ServerVersion}}'` failed because `dockerDesktopLinuxEngine` was absent. The startup log reported that the stale `userAnalyticsOtlpHttp.sock` could not be accessed by the system. WSL reports the `docker-desktop` distribution stopped. No Docker settings, socket files, volumes or existing services were modified. This remains a local Supabase-stack dependency rather than evidence of Auth/Storage readiness.

Later authorized investigation recovered the Docker engine by preserving the stale runtime-only directory under a new name and creating an empty replacement; no container/volume data was removed. Engine 27.3.1 now responds. Follow-up Supabase-stack startup and the complete reversible recovery record are in `docs/T02-AUTH-PREFLIGHT.md`; this does not change the native PostgreSQL test evidence above.

## Official references consulted

- [Supabase changelog](https://supabase.com/changelog.md) and [CLI v3 local/remote targeting](https://supabase.com/changelog/supabase-cli-v3).
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction) and [database function grants/search paths](https://supabase.com/docs/guides/database/functions).
- [PostgreSQL 17 initdb](https://www.postgresql.org/docs/17/app-initdb.html) and [SELECT locking/SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html).
