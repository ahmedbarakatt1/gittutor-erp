# T02 authentication preflight

Status: implementation proposal and local infrastructure investigation. No T02 acceptance result is claimed here.

## Verified framework boundary

Pinned packages are `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.119.0 and Next.js 16.4.6. Official SSR documentation and the versioned SSR design require one per-request server client, `getAll`/`setAll` cookie handling and a Next.js 16 `proxy.ts` refresh boundary. Use `getClaims()` to verify the token; never authorize from `getSession()` or user-editable metadata. Preserve refreshed cookies on both request and final response, including cache-control/expires/pragma supplied by the SSR adapter. Protected HTML/API/file responses are private and no-store.

The signed token establishes account and session identity. Every sensitive database function must additionally check the current `auth.sessions` row, current application account, current staff roles and current relationship scope. Official session documentation confirms that sign-out removes the relevant session rows; a still-valid access token alone does not prove its session remains active.

## Proposed database interfaces

All function names below are implementation proposals; final signatures must stay aligned with `docs/05-api-contracts.md`. Business actor IDs are never accepted as RPC input.

| Private interface | Return / responsibility |
|---|---|
| `app_private.require_actor(p_allow_anonymous boolean default false)` | Typed context `{account_id uuid, person_id uuid, session_id uuid, is_anonymous boolean}`. Derive `auth.uid()` and signed `auth.jwt()->>'session_id'`; require a matching current Auth session/user and active application account. Reject unverified/anonymous callers unless explicitly allowed. Inspect actual local Auth columns before writing expiry/banned-account predicates. |
| `app_private.require_current_role(p_role text)` | Authenticated context or scoped error. Query active, unrevoked database membership; ignore JWT/user metadata role claims. |
| `app_private.require_learner_scope(p_learner_id uuid,p_scope text)` | Current learner authority or non-disclosing `NOT_FOUND`. Own learner person or an accepted, unexpired, unrevoked guardian link with the exact required scope. Privileged alternatives are explicit per command, never a generic staff bypass. |
| `app_private.begin_command(p_command_name text,p_idempotency_key text,p_arguments jsonb)` | Derive actor; canonicalize already typed accepted arguments (including resource IDs/expected version), hash inside database, serialize same actor/name/key, reject changed-body replay. Calling command authorizes the current resource before returning any saved response. |
| `app_private.finish_command(p_command_id uuid,p_result jsonb)` | Store allowlisted response, audit and event/outbox effects in the owning transaction. No provider calls. |

Use a dedicated identity command owner and a separate private Auth reader, both `NOLOGIN NOBYPASSRLS`, with column/table privileges only for their functions. Tables retain separate ownership. Fixed empty search paths and fully qualified names apply throughout. The private Auth reader needs selected Auth user/session columns; the public authenticated role receives no raw-table grants. RLS policies and the function's checks both constrain actor/object scope; avoid recursive role policies by isolating the narrowly scoped private authorization helper.

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

Startup output is redirected to ignored `.local/supabase-start.log`, because normal CLI summaries include generated local credentials. Private Storage is excluded from this first minimal startup and remains a separately recorded integration state until enabled and checked. Startup/migration/health verification results will be appended after the process completes.

## References consulted

- [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- [SSR 0.12.7 design](https://github.com/supabase/ssr/blob/v0.12.7/docs/design.md) and [README](https://github.com/supabase/ssr/blob/v0.12.7/README.md), queried through Context7.
- [Supabase sessions and session revocation](https://supabase.com/docs/guides/auth/sessions).
- [getClaims reference](https://supabase.com/docs/reference/javascript/auth-getclaims).
- [Database function security](https://supabase.com/docs/guides/database/functions).
- [Docker Desktop Windows setup](https://docs.docker.com/desktop/setup/install/windows-install/).
