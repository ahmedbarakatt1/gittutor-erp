# Docker recovery — 13 November 2026

Docker Desktop failed before starting its Linux engine because Windows could not access a stale Unix socket at `C:\Users\barak\AppData\Local\Docker\run\userAnalyticsOtlpHttp.sock`. The backend log reported `running OTel manager: removing stale socket ... The file cannot be accessed by the system`. Restarting the application with that file still in place reproduced the failure. This matches the stale socket failure discussed in [Docker's issue tracker](https://github.com/docker/desktop-feedback/issues/527).

## Repair performed

Confirmed Docker Desktop/backend processes and the `docker-desktop` WSL distribution were stopped. Verified the exact absolute runtime path, then renamed only the runtime directory to `C:\Users\barak\AppData\Local\Docker\run.stale-20261113-1310`. Created a fresh `run` directory and launched Docker Desktop. The preserved directory contains the stale socket for diagnosis; it is not a database backup.

No factory reset, reinstall, volume deletion, WSL unregister, database migration or data-disk change was performed. Existing `wsl\disk\docker_data.vhdx` and `wsl\main\ext4.vhdx` remained in place. The Linux engine recovered as Docker27.3.1, and its existing containers restarted.

## Executed verification

- `docker version --format '{{.Server.Version}}'`:27.3.1.
- `docker ps --filter name=supabase --format '{{.Names}} | {{.Status}}'`: all six Git Tutor services running; database, Auth, Storage, Kong and Mailpit healthy. REST has no health marker.
- `pnpm exec tsx .local/docker-recovery-check.ts`: connected to the existing database and verified its synthetic-environment marker;126 applied migrations,1847 accounts,1522 occurrences,4417 financial transactions and36 stored objects were readable.
- Actual synthetic admin sign-in and verified Auth claims passed; the temporary session was signed out.
- `/auth/v1/health` and `/storage/v1/status` returned HTTP200.

Detailed local verification output: `.local/docker-recovery-check.log`. These are infrastructure recovery checks, not full application acceptance or a backup restoration rehearsal. The underlying Windows stale-socket issue may recur after an unclean shutdown. Quit Docker normally when stopping it. If it recurs, inspect the new error and confirm Docker is stopped before isolating only the affected runtime directory; do not reset its data volumes.
