# T02 authentication preflight

Status: real local infrastructure established. Executed infrastructure, worker/email and browser checks are recorded below; broader T02 acceptance coverage is tracked in `IMPLEMENTATION-STATUS.md`.

## Verified framework boundary

Pinned packages are `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.0 and Next.js 16.4.6. Official SSR documentation and the versioned SSR design require one per-request server client, `getAll`/`setAll` cookie handling and a Next.js 16 `proxy.ts` refresh boundary. Use `getClaims()` to verify the token; never authorize from `getSession()` or user-editable metadata. Preserve refreshed cookies on both request and final response, including cache-control/expires/pragma supplied by the SSR adapter. Protected HTML/API/file responses are private and no-store.

The signed token establishes account and session identity. Every sensitive database function must additionally check the current `auth.sessions` row, current application account, current staff roles and current relationship scope. Official session documentation confirms that sign-out removes the relevant session rows; a still-valid access token alone does not prove its session remains active.

## Implemented database interfaces

The initial preflight proposals were reconciled with the implemented interfaces below. `docs/05-api-contracts.md` owns public signatures. Business actor IDs are never accepted as RPC input.

| Private interface | Return / responsibility |
|---|---|
| `app_private.require_actor(p_allow_guest boolean default false)` | Returns the actor UUID from verified request claims; checks the current matching Auth session/user, active application account, verification, anonymous state and ban/deletion. |
| `app_private.require_role(p_actor uuid,p_role text)` | Private helper takes only the actor already derived by the caller. Requires current active database membership, ignoring JWT/user metadata role claims. |
| `app_private.assert_learner_scope(p_actor uuid,p_learner uuid,p_scope text,p_allow_admin boolean default false)` | Own learner identity or an accepted, unexpired, unrevoked guardian link with exact scope; otherwise non-disclosing `NOT_FOUND`. Admin access is explicit per command. |
| `app_private.identity_command(p_name text,p_args jsonb,p_key text)` | Derives actor; canonicalizes typed accepted arguments, hashes and serializes actor/name/key; rejects changed-body replay. Current object authorization precedes replay. Stores allowlisted result, audit and domain-event/outbox effects atomically. No provider calls. |

Business functions use the `NOLOGIN NOBYPASSRLS` command owner; the Auth synchronization trigger has a separate `NOLOGIN NOBYPASSRLS` owner. Tables retain separate ownership. Fixed empty search paths and qualified names apply throughout. Actual hosted-compatible testing found that `postgres` cannot grant custom roles USAGE on the managed `auth` schema. The follow-up migration uses the [official narrow private bridge pattern](https://supabase.com/kb/troubleshooting/permission-errors-when-granting-custom-roles-access-to-the-auth-schema-9e32e7): exactly `auth_account(uuid)`, `auth_session_active(uuid,uuid)`, `auth_email_exists(text)` and `auth_invited_user(uuid,text,timestamptz)` remain postgres-owned, read-only SQL functions. Only the command owner can execute them. Direct Auth column privileges were revoked. No exposed business RPC is exempt from the restricted owner rule. The verifier checks these four exact signatures, full read source and return shape, SQL/STABLE properties, empty search path and executor ACLs.

Public identity RPCs, granted by exact signature only to `authenticated`:

- `api.get_my_account()` returns only account ID, verified status, own current roles, locale and authorized learner IDs; anonymous Auth returns only guest state.
- `api.create_guardian_invitation(contact_id,scopes,expires_at,idempotency_key)` binds a high-entropy single-use challenge to the verified intended recipient and learner, storing only its hash.
- `api.accept_guardian_invitation(id,single_use_token,expected_version,idempotency_key)` atomically checks recipient, consent scope, expiry and single use; `api.revoke_guardian_link(id,reason,expected_version,idempotency_key)` changes current authority and emits durable revocation work.
- `api.grant_staff_role(account_id,role,reason,idempotency_key)` and `api.revoke_staff_role(id,reason,expected_version,idempotency_key)` require current admin membership. Application signup cannot select staff privileges.
- Tutor application submit/review and own-profile update follow the exact transport contract; approval creates a separately audited role grant. Public profile publication remains T03.

Supabase Auth owns signup, verification, recovery and invitations. An application bootstrap trigger may create only an ordinary customer account/person from an Auth identity, with no metadata-derived staff authority. Staff activation remains a distinct admin command. Logout revokes the current Supabase session and only reports success after revocation, so the next RPC rejects the old token.

## Local infrastructure findings

The first hidden Docker Desktop startup failed on `C:\Users\barak\AppData\Local\Docker\run\userAnalyticsOtlpHttp.sock`. The directory contained only that zero-byte stale compressed socket (25 October timestamp), with no remaining Docker process and user-owned full-control ACLs. The confirmed runtime directory was preserved as `run.stale-gittutor-20261111`; a new empty `run` directory was created, then Docker Desktop relaunched hidden. No container data, volumes, user Auth accounts or settings were deleted.

`docker info --format '{{.ServerVersion}}'` subsequently returned **27.3.1**. Existing `openwa-api` and `openwa-docker-proxy` containers resumed under their own restart policies; the task did not change them. The existing API binds loopback port 2785, separate from planned Supabase 54321/54322/54324 ports.

Inspected `pnpm exec supabase start --help`. Started project-local Auth, PostgreSQL, PostgREST, Kong and Mailpit via:

```powershell
pnpm exec supabase start --exclude realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
```

Startup output is redirected to ignored `.local/supabase-start.log`, because normal CLI summaries include generated local credentials.

## Actual runtime and reproducible bootstrap

`pnpm exec tsx tools/supabase-local.ts bootstrap` completed with exit 0. The actual services are PostgreSQL **17.11.0.018**, Supabase Auth/GoTrue **v2.197.0**, PostgREST **v16.5**, Kong **2.8.1**, Mailpit **v1.31.3**, and Storage **v1.90.1**. Auth, database, Kong, Mailpit and Storage report healthy; PostgREST passes the CLI's REST health check. This proves local service startup, not every application/provider acceptance case.

Published endpoints are bound only to loopback: API `127.0.0.1:54321`, PostgreSQL `127.0.0.1:54322`, Mailpit `127.0.0.1:54324`. The project-specific bridge `gittutor_local_isolated` sets `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`; no global Docker settings or unrelated networks were changed. Storage is now included, but application private-bucket/upload checks remain T07.

The first attempt exposed a real platform compatibility issue: Supabase's constrained `postgres` role could not change the new function owner's default privileges. The unchanged T01 migration is retained, including its checksum. The reproducible bootstrap starts the actual platform from an ignored configuration copy with automatic application migrations disabled and PostgREST temporarily excluded. It verifies the exact project container, workdir and loopback binding, creates NOLOGIN/NOBYPASSRLS command-owner roles, grants the migration administrator membership plus temporary schema CREATE rights, and runs the unchanged foundation with **the official CLI**. It then revokes temporary CREATE privileges and restarts the same project with PostgREST and `api`-only exposure. No Auth shim is used.

The initial migrations-disabled attempt with PostgREST enabled failed correctly because `api` did not yet exist; the retry excludes PostgREST until the foundation exists. No unhealthy-service override was used. Both failed commands and the successful replacement are preserved in ignored startup logs; no generated credentials are copied into this document.

The standard commands are:

```powershell
pnpm exec tsx tools/supabase-local.ts bootstrap
pnpm exec tsx tools/supabase-local.ts migrate
pnpm exec tsx tools/supabase-local.ts seed
pnpm exec tsx tools/supabase-local.ts verify
```

`bootstrap` establishes the service/foundation boundary only; `migrate` applies all completed project migrations through the real CLI. Do not apply an empty work-in-progress migration. The underlying native `tools/db-migrate.ts` / `tools/db-verify.ts` remain scoped to the T01 baseline; package scripts orchestrate both native and real Supabase checks. Authentication-dependent migrations are never installed into a fake native Auth schema.

The shared local Supabase environment is explicitly **disposable test**, backed by a persisted `git-tutor-supabase-local-v1` marker. It also serves the development UI. Tests create distinct synthetic accounts for each run and do not reset/mutate deterministic demonstration account data. `tests/helpers/supabase.ts` supplies genuine Auth clients, a guarded administrator fixture connection and the private local manifest. `.local/supabase.json` holds generated keys, database connection strings, random synthetic passwords and the restricted worker connection. `.env.local` contains the local application environment/base URL and public Supabase fields.

Owner preflight and migrations refuse a non-test/nonmatching persisted marker **before any grants or schema mutation**. An absent marker is accepted only for an explicitly verified fresh bootstrap with zero private application tables and zero Auth users. Local setup refuses to overwrite a production/staging-designated `.env.local`. Cleanup preserves the primary migration failure if revoking temporary permissions also fails. The worker login receives a random password and function-only authority; its connection is never placed in public environment fields.

Focused guard evidence: `pnpm exec vitest run tests/unit/supabase-local-guard.test.ts` initially returned **2 failed/2 passed**, demonstrating the marker and environment-file gaps; after the fixes it returned **4 passed/0 failed**. The earlier protocol-target regression also failed before its fix. `pnpm exec tsx tools/supabase-local.ts migrate --foundation-only` passed after correcting an explicitly typed PostgreSQL `format` parameter (`42P18` in the first worker-credential configuration attempt). Focused ESLint passed for the bootstrap/helper/guard files.

Local email confirmation is enabled and messages terminate in Mailpit. Synthetic seeding uses controlled Auth-admin creation only for `@example.test` identities, then genuine password sign-in sessions and authorized application RPCs. It bootstraps only the first synthetic administrator directly; staff roles and guardian consent use normal command interfaces. Guardian capability is additive: a customer who is also a guardian retains their own learner identity alongside the two separately scoped linked learners.

## Executed T02 infrastructure and mail checks

- `pnpm exec tsx tools/supabase-local.ts seed`: exit 0; 12 actual synthetic Auth identities, current staff roles and two separate guardian links. No account or mailbox reset.
- `pnpm exec vitest run tests/integration/staff-invitation-worker.test.ts`: **1 passed**. Real Auth-admin invitation reaches Mailpit, after a durable authorized command and restricted worker claim. Simulated process death after send is reclaimed with attempt 2 and reconciled without another user/email. Email verification alone grants no staff role; explicit acceptance and replay produce one role grant and one audit event. Existing unrelated queue rows are locked briefly while claiming the test's job, then released without mutation.
- `pnpm exec playwright test tests/e2e/email-verification.spec.ts --project=desktop --workers=1`: first run **2 failed**. Staff callback at `127.0.0.1` redirected to `localhost` and lost the host-scoped session, landing at `/login`; sanitized network inspection confirmed the 307 chain. The signup assertion also exceeded its initial 5-second cold compilation wait; its final screenshot was already on the email-verification screen.
- Follow-up browser runs exposed Next.js's normalized internal `localhost` URL despite browser `Host: 127.0.0.1`. The callback now uses only an allowed browser Host, checked against the configured origin. One concurrent compilation run also failed on a temporarily missing `getMyGuardianLinks` export; this was a failed run, not acceptance evidence. Stable-code diagnostic staff run then passed **1/1**.
- Full email rerun then produced **2 passed / 2 failed**: both staff journeys passed, while signup token validation still failed. Actual Supabase SSR confirmation hashes were 61 characters with the documented `pkce_` prefix; a hex-only callback validator rejected them before calling Auth. A controlled provider check verified the unchanged token successfully. The callback now accepts the bounded prefixed form and still delegates verification to Supabase. Focused signup rerun passed **1/1**.
- Final `pnpm exec playwright test tests/e2e/email-verification.spec.ts --workers=1 --output=.local/test-results-email`: **4 passed / 0 failed**, 14.2 seconds. Desktop and mobile signup follow actual Mailpit links into verified ordinary customer accounts. Desktop and mobile staff invitation journeys set a password, explicitly accept, and enter the newly authorized Operations navigation link. Every callback asserts `Referrer-Policy: no-referrer`.
- `pnpm exec tsx tools/supabase-local.ts verify`: initially failed `SUPABASE_DEFINER_INVALID:auth_account`; after the exact documented bridge exception, passed **4 migrations, 19 private RLS tables, 35 function boundaries**. Repeated after management-read migration: **5 migrations, 19 private RLS tables, 37 function boundaries**, exit 0.
- `pnpm exec vitest run tests/unit/supabase-local-guard.test.ts`: bridge regression **1 failed / 4 passed** before the exception; **5 passed** after. Altered signature, source, return type, language properties, owner, search path and extra executor are rejected.
- `pnpm exec eslint tools/supabase-local.ts tests/unit/supabase-local-guard.test.ts tests/integration/staff-invitation-worker.test.ts tests/e2e/email-verification.spec.ts`: exit 0.
- `pnpm typecheck`: exit 0. `pnpm test:unit`: **56 passed**, and `pnpm test:integration`: **36 passed** at the earlier T02 checkpoint before subsequent root callback/management additions; final whole-project release checks belong to the main status record.

Auth templates use server-side token-hash verification. Mail is searched only by each test's unique recipient; no deletion or outbound relay API is used. Secret-bearing browser traces are disabled for ongoing email-link tests; the initial ignored failure trace was inspected with only host/path/status output. No token values or generated credentials are published as evidence. This is local Supabase/Mailpit evidence, not live production email readiness.

## References consulted

- [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- [SSR 0.12.7 design](https://github.com/supabase/ssr/blob/v0.12.7/docs/design.md) and [README](https://github.com/supabase/ssr/blob/v0.12.7/README.md), queried through Context7.
- [Supabase sessions and session revocation](https://supabase.com/docs/guides/auth/sessions).
- [getClaims reference](https://supabase.com/docs/reference/javascript/auth-getclaims).
- [Database function security](https://supabase.com/docs/guides/database/functions).
- [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
- [Mailpit API](https://mailpit.axllent.org/docs/api-v1/).
- [Supabase Auth verification source](https://github.com/supabase/auth/blob/master/internal/api/verify.go) and [PKCE prefix model](https://pkg.go.dev/github.com/supabase/auth/internal/models).
- [Docker Desktop Windows setup](https://docs.docker.com/desktop/setup/install/windows-install/).
