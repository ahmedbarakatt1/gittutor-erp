# Docker recovery — 13 November 2026

## Recurrence during production preparation,14 November2026

The engine was absent and the restarted backend repeated the stale `userAnalyticsOtlpHttp.sock` failure. After confirming/stopping the failed Docker processes and stopped WSL distribution, the exact runtime-only directory was preserved as `C:\Users\barak\AppData\Local\Docker\run.stale-20261114-114637`. A replacement runtime directory and hidden Docker launch restored engine27.3.1. No existing database volume or WSL data disk was deleted or reset. Both existing Supabase stacks restarted. The actual web/worker image builds and fresh disposable container smoke passed afterward; those checks did not use either existing database. This repair is recurring infrastructure recovery, not a permanent correction to Docker Desktop's Windows socket handling.

## Recurrence after laptop shutdown, 20:24 Cairo

The backend failed again with the same observed `userAnalyticsOtlpHttp.sock` error. Docker Desktop/backend and its WSL distribution were confirmed stopped. The exact runtime-only path was checked and renamed to `C:\Users\barak\AppData\Local\Docker\run.stale-20261113-202444`; an empty replacement was created. No data volume or disk was removed. Engine 27.3.1 recovered and the six existing Supabase services became healthy/running.

Executed `pnpm exec tsx .local/docker-recovery-check.ts`: existing database readable with 148 migrations, 2519 accounts, 2086 occurrences, 6812 financial transactions and 356 stored objects. Actual sign-in/verified claims and Auth/Storage HTTP 200 checks passed. Those totals include the retained synthetic development history; the original database also holds the separately protected actual workbook snapshot. This is recovery evidence, not a new application acceptance result. The stopped application worker, web server and temporary tunnel require their own restart/check.

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
