#!/usr/bin/env bash
# Runs on a fresh, disposable ARM CI machine with no deployment credentials.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
export GIT_TUTOR_WORKER_IMAGE
GIT_TUTOR_WORKER_IMAGE=$(docker image inspect -f '{{.Id}}' git-tutor-arm:check)
export GIT_TUTOR_ENV_FILE="$RUNNER_TEMP/synthetic-worker.env"
unset GIT_TUTOR_WORKER_PURPOSE
compose=(docker compose -f deploy/arm-worker/compose.yml)
cp deploy/production.env.example "$GIT_TUTOR_ENV_FILE"
"${compose[@]}" run --rm -T --no-deps worker --verify-scanner

# Run the actual worker without Internet access. Only the synthetic DB is reachable.
docker network create --internal arm-qa-private
cat > "$RUNNER_TEMP/network.yml" <<'YAML'
networks:
  default:
    external: true
    name: arm-qa-private
YAML
compose+=(-f "$RUNNER_TEMP/network.yml")
docker run -d --name arm-qa-db --network arm-qa-private --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=synthetic-only postgres:17.12
for attempt in {1..30}; do
  if docker exec arm-qa-db pg_isready -q -h 127.0.0.1; then break; fi
  sleep 1
done
sql=(docker exec -i arm-qa-db psql -X -v ON_ERROR_STOP=1 -U postgres)
for migration in 20261111103635_foundation_outbox 20261119150400_manual_channel_queue_claims 20261122010100_worker_dispatch_tracking; do
  "${sql[@]}" -q < "supabase/migrations/$migration.sql"
done
"${sql[@]}" -q <<'SQL'
ALTER ROLE git_tutor_worker LOGIN PASSWORD 'synthetic-worker';
SELECT app_private.enqueue_event(gen_random_uuid(),'qa',gen_random_uuid(),'{}','foundation.healthcheck');
SQL
cat > "$GIT_TUTOR_ENV_FILE" <<'ENV'
APP_BASE_URL=https://app.example.invalid
NEXT_PUBLIC_SUPABASE_URL=https://storage.example.invalid
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test
SUPABASE_SECRET_KEY=synthetic-test-only
WORKER_DATABASE_URL=postgresql://git_tutor_worker:synthetic-worker@arm-qa-db/postgres
SECRET_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EMAIL_ADAPTER=mailjet
EMAIL_FROM=qa@example.invalid
MAILJET_API_KEY=synthetic-key-only
MAILJET_SECRET_KEY=synthetic-secret-only
CALENDAR_ADAPTER=google
GOOGLE_OAUTH_CLIENT_ID=synthetic
GOOGLE_OAUTH_CLIENT_SECRET=synthetic
GOOGLE_OAUTH_REDIRECT_URI=https://app.example.invalid/api/calendar/google/callback
WHATSAPP_ADAPTER=manual
PAYMENT_RECONCILIATION_ADAPTER=manual
ENV
"${compose[@]}" up -d --wait --wait-timeout 320 || { "${compose[@]}" logs --tail 30 worker; exit 1; }
id=$("${compose[@]}" ps -q worker)
test "$(docker inspect -f '{{len .HostConfig.PortBindings}} {{.HostConfig.ReadonlyRootfs}}' "$id")" = '0 true'
test "$("${compose[@]}" exec -T worker printenv WORKER_PURPOSE)" = files.scan
"${compose[@]}" stop worker
"${compose[@]}" up -d --wait --wait-timeout 320
test "$("${sql[@]}" -Atc "select count(*) from app_private.outbox_jobs where purpose='foundation.healthcheck' and state='pending' and attempt_count=0")" = 1
echo 'Scan-only worker healthy before and after restart. Unrelated job still pending with zero attempts.'
