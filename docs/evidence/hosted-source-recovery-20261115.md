# Hosted development to local recovery rehearsal

Result: **passed**, 15 November 2026. Run `3f880af5-0ab0-4e2a-bcd8-53493c8780b2`.

The authorized hosted development pilot `tjrbvejvnquhmqdwsacy` was read through a verified TLS 1.3 connection and restored to newly created local targets. The database source marker, owner-authorized target guard, configured source hash and 139 workbook links were checked. Hosted database sessions explicitly used `default_transaction_read_only=on`; backup controls and `pg_dump` shared an exported repeatable-read, read-only snapshot. Hosted Storage access consisted of private object downloads. No hosted data mutation, source reset, source deletion, paid project creation, application restart or provider dispatch was performed.

The existing local stack was checked for its loopback address, disposable synthetic marker and Docker project label `GitTutor_System`. The following names were verified absent before creation:

- Database: `gittutor_hosted_restore_3f880af50ab0`
- Private bucket: `git-tutor-hosted-restore-3f880af50ab0`

All recovery scripts, backup data, object bytes and reports are retained under ignored `.local/hosted-recovery/`. The database dump contains private operational and Auth data. No backup or private record was committed or uploaded to a third party. The source workbook and existing practice state were preserved.

## Measured verification

| Check | Result |
|---|---|
| Business tables | 238 exact row counts and canonical row SHA-256 controls matched |
| Auth tables | 27 exact row counts and SHA-256 controls matched |
| Storage metadata tables | 10 exact row counts and SHA-256 controls matched |
| Migration history | All 154 complete migration records matched; latest `20261115200000` |
| Workbook links | 139 restored and source count still 139 at completion |
| Private objects | All 29 original objects copied; 26,239,916 bytes verified |
| Registered immutable files | All 28 application file records matched their original stored SHA-256 and byte count; the additional Storage object was also copied and byte-verified |
| Private access | Target bucket remained private; public access denied for every copied object |
| Database protections | All business constraints validated; table RLS/raw authenticated-access check passed |
| Current SQL authorization | Existing restored student session allowed own account; student denied privileged payout list; deleting that session inside a rolled-back local transaction caused `SESSION_REVOKED` |
| Fake worker recovery | Expired lease reclaimed as `git_tutor_worker`; completed-provider reconciliation caused zero dispatches; test transaction rolled back |
| State after recovery checks | Every restored business, Auth and Storage metadata control still matched the original snapshot |

The source and destination PostgreSQL servers were both 17.11. The native export executable was PostgreSQL `pg_dump` 17.2. Credentials were read from ignored local configuration and passed to `pg_dump` through its child environment, never command arguments or normal output. Object downloads were serial; Node heap was bounded to 384 MB.

Core database/file restoration and authorization checks completed in **154.701 seconds**. Including diagnosis, repair of the local rehearsal connection and final independent verification, the run completed in **271.137 seconds**. These are measured hosted-source/local-target rehearsal times, not a production failover RTO or RPO.

## Executed commands and repair

From `D:\GitTutor System`:

```powershell
$env:APP_ENV='development'; node --max-old-space-size=256 --import tsx .local/hosted-recovery/preflight.ts
$env:APP_ENV='development'; node --max-old-space-size=384 --import tsx .local/hosted-recovery/rehearse.ts
$env:APP_ENV='development'; node --max-old-space-size=384 --import tsx .local/hosted-recovery/finish-verification.ts
```

Preflight passed. The first full rehearsal command restored and verified the database and files, then exited 1 at its optional fake worker check: PostgreSQL code `42501`, `permission denied to set role "git_tutor_worker"`. The local `postgres` account cannot assume that role. That attempted check was inside a transaction and rolled back.

A read-only local role probe confirmed that the existing `supabase_admin` account is the local superuser. The private script was corrected to use that existing account for the isolated restore connection. The verification continuation used the already-created recovery database and bucket; it did not overwrite or restore into any existing source target. It recomputed every database control, migration record and all saved/restored object SHA-256 values, compared the immutable application-file hashes, ran the fake retry under the actual worker role inside a rollback-only transaction, and confirmed all original database controls again. It exited **0**. No global role grants were changed. The original failure evidence remains alongside the final manifest.

## Scope limits

This verifies **hosted development source → isolated local database and local private Storage bucket**. It does not verify a separate hosted-project failover, production restoration, DNS/application cutover, a runnable second hosted stack, scheduled backups or a production backup interval/data-loss window.

Auth schema data and database-side session/role enforcement were restored and tested. A separately configured Auth service, JWT signing keys, encrypted provider credentials, SMTP, OAuth refresh, browser sign-in and recovery-email delivery were not recovered or tested. No real provider operation was replayed. The worker result is a controlled fake reconciliation test, not live provider readiness.

Storage objects use a manifest mapping from each original bucket/name to the unique local recovery bucket. Application configuration was not redirected to the restore. External production recovery objectives and a separate hosted failover remain release requirements.

Private detailed evidence: `manifest.json`, `snapshot-controls.json`, `database.dump`, the original `failure.json` and per-object `.bin` files in this directory.
