#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.d2-smoke.yml"
FIXTURE_FILE="$PROJECT_ROOT/docker/d2-smoke/bootstrap.sql"
CLAMAV_IMAGE="clamav/clamav:1.4.5-debian13-slim@sha256:0542880c8abebb7430be5366657aec561f03693ed7be4e64a45fd2ee60b08d02"
SMOKE_SUFFIX="$(date -u +%Y%m%d%H%M%S)-$$-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(3).toString("hex"))')"
PROJECT_NAME="moldpilot-d2-smoke-$SMOKE_SUFFIX"
APP_IMAGE="moldpilot:d2-app-$SMOKE_SUFFIX"
MIGRATOR_IMAGE="moldpilot:d2-migrator-$SMOKE_SUFFIX"
CLAMAV_RUNTIME_IMAGE="moldpilot:d2-clamav-$SMOKE_SUFFIX"
MODE="${1:-full}"

fail() {
  printf '[MoldPilot D2 smoke FAIL] %s\n' "$*" >&2
  exit 1
}

note() {
  printf '[MoldPilot D2 smoke] %s\n' "$*"
}

case "$MODE" in
  full|--d1-compat) ;;
  *) fail "Usage: $0 [--d1-compat]" ;;
esac

case "${COMPOSE_PROJECT_NAME:-}:${DATABASE_URL:-}" in
  *[Pp][Rr][Oo][Dd]*) fail "Refusing inherited configuration marked as production." ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker is required."
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."
[ -f "$COMPOSE_FILE" ] || fail "Missing $COMPOSE_FILE"
[ -f "$FIXTURE_FILE" ] || fail "Missing $FIXTURE_FILE"

DOCKER_MEMORY_BYTES="$(docker info --format '{{.MemTotal}}' 2>/dev/null || printf '0')"
MINIMUM_DOCKER_MEMORY_BYTES=4294967296
if [ "$DOCKER_MEMORY_BYTES" -lt "$MINIMUM_DOCKER_MEMORY_BYTES" ]; then
  fail "Docker must have at least 4 GiB RAM for ClamAV. Increase Docker Desktop Resources > Memory, then retry."
fi
DOCKER_MEMORY_GIB="$(node -e 'process.stdout.write((Number(process.argv[1]) / 1024 / 1024 / 1024).toFixed(1))' "$DOCKER_MEMORY_BYTES")"

MOLDPILOT_D2_SMOKE_DB_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
MOLDPILOT_D2_SMOKE_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
MOLDPILOT_D2_SMOKE_DATABASE_URL="postgresql://moldpilot_d2_smoke:${MOLDPILOT_D2_SMOKE_DB_PASSWORD}@postgres:5432/moldpilot_d2_smoke?schema=public"
MOLDPILOT_D2_APP_IMAGE="$APP_IMAGE"
MOLDPILOT_D2_MIGRATOR_IMAGE="$MIGRATOR_IMAGE"
MOLDPILOT_D2_CLAMAV_RUNTIME_IMAGE="$CLAMAV_RUNTIME_IMAGE"
export MOLDPILOT_D2_SMOKE_DB_PASSWORD MOLDPILOT_D2_SMOKE_SESSION_SECRET
export MOLDPILOT_D2_SMOKE_DATABASE_URL MOLDPILOT_D2_APP_IMAGE
export MOLDPILOT_D2_MIGRATOR_IMAGE MOLDPILOT_D2_CLAMAV_RUNTIME_IMAGE

case "$PROJECT_NAME:$MOLDPILOT_D2_SMOKE_DATABASE_URL" in
  *[Pp][Rr][Oo][Dd]*) fail "Disposable smoke identity must never be marked as production." ;;
esac
case "$MOLDPILOT_D2_SMOKE_DATABASE_URL" in
  *"@postgres:5432/moldpilot_d2_smoke"*) ;;
  *) fail "Disposable database URL escaped the internal PostgreSQL service." ;;
esac

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  set +e
  compose down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm "$APP_IMAGE" "$MIGRATOR_IMAGE" "$CLAMAV_RUNTIME_IMAGE" >/dev/null 2>&1
  if [ "$status" -eq 0 ]; then
    note "Removed disposable containers, two private networks, four volumes, and three temporary images for $PROJECT_NAME."
  else
    printf '[MoldPilot D2 smoke] Cleaned disposable project %s after failure.\n' "$PROJECT_NAME" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for_health() {
  service="$1"
  attempts=0
  while [ "$attempts" -lt 120 ]; do
    container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
    if [ -n "$container_id" ]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
      case "$health" in
        healthy) return 0 ;;
        unhealthy) compose logs --no-color "$service" >&2; fail "$service became unhealthy." ;;
      esac
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  compose logs --no-color "$service" >&2
  fail "Timed out waiting for $service health."
}

json_field() {
  json="$1"
  field="$2"
  node -e '
    const value = process.argv[1].split(".").reduce((current, key) => current?.[key], JSON.parse(process.argv[2]));
    if (value == null) process.exit(2);
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$field" "$json"
}

db_scalar() {
  compose exec -T postgres psql \
    --username moldpilot_d2_smoke \
    --dbname moldpilot_d2_smoke \
    --tuples-only --no-align \
    --command "$1"
}

probe() {
  compose exec -T \
    -e MOLDPILOT_D2_SESSION_COOKIE="${SESSION_TOKEN:-unused}" \
    -e MOLDPILOT_D2_PROJECT_ID="${PROJECT_ID:-unused}" \
    app node /opt/moldpilot-smoke/probe.mjs "$@"
}

note "Using isolated project $PROJECT_NAME with ${DOCKER_MEMORY_GIB} GiB Docker RAM."
note "ClamAV is pinned to 1.4.5 Debian 13 slim at sha256:0542880c8abebb7430be5366657aec561f03693ed7be4e64a45fd2ee60b08d02."

if ! docker image inspect "$CLAMAV_IMAGE" >/dev/null 2>&1; then
  note "Pulling the pinned official multi-architecture ClamAV image."
  docker pull "$CLAMAV_IMAGE"
fi

note "Building disposable non-root app, migrator, and pinned ClamAV runtime images."
docker build --target smoke-runner --tag "$APP_IMAGE" "$PROJECT_ROOT"
docker build --target migrator --tag "$MIGRATOR_IMAGE" "$PROJECT_ROOT"
docker build \
  --build-arg "CLAMAV_IMAGE=$CLAMAV_IMAGE" \
  --tag "$CLAMAV_RUNTIME_IMAGE" \
  "$PROJECT_ROOT/docker/clamav"

RUNTIME_USER="$(docker image inspect --format '{{.Config.User}}' "$APP_IMAGE")"
case "$RUNTIME_USER" in
  ""|0|0:0|root|root:root) fail "Final app image runtime user is root." ;;
esac

note "Starting private PostgreSQL and unprivileged clamd services."
compose up --detach postgres clamav
wait_for_health postgres
wait_for_health clamav

CLAMAV_PORTS="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$(compose ps --quiet clamav)")"
node -e '
  const ports = JSON.parse(process.argv[1]);
  if (
    ports != null &&
    Object.values(ports).some((bindings) => Array.isArray(bindings) && bindings.length > 0)
  ) {
    process.exit(1);
  }
' "$CLAMAV_PORTS" || fail "clamd published a host port."

note "Applying migrations once to the disposable database."
compose run --rm migrator migrate deploy

note "Starting the standalone application with explicit clamd mode."
compose up --detach --no-deps app
wait_for_health app

HEALTH="$(probe health)"
[ "$(json_field "$HEALTH" live.status)" = "200" ] || fail "Liveness did not return 200."
[ "$(json_field "$HEALTH" ready.status)" = "200" ] || fail "Readiness did not return 200."
[ "$(json_field "$HEALTH" ready.body.components.scanner)" = "ready" ] || fail "Readiness did not report the scanner ready."
LOGIN="$(probe login)"
[ "$(json_field "$LOGIN" status)" = "200" ] || fail "The login page did not return 200."

RUNTIME_IDENTITY="$(compose exec -T app node -e 'process.stdout.write(`${process.getuid?.()}:${process.getgid?.()}`)')"
CLAMAV_IDENTITY="$(compose exec -T clamav sh -c 'printf "%s:%s" "$(id -u)" "$(id -g)"')"
case "$RUNTIME_IDENTITY:$CLAMAV_IDENTITY" in
  0:*|*:0:*) fail "An application or ClamAV process is running as root." ;;
esac

APP_IMAGE_SIZE_BYTES="$(docker image inspect --format '{{.Size}}' "$APP_IMAGE")"
CLAMAV_IMAGE_SIZE_BYTES="$(docker image inspect --format '{{.Size}}' "$CLAMAV_IMAGE")"
CLAMAV_RUNTIME_IMAGE_SIZE_BYTES="$(docker image inspect --format '{{.Size}}' "$CLAMAV_RUNTIME_IMAGE")"

if [ "$MODE" = "--d1-compat" ]; then
  note "D1 compatibility passed through the hardened D2 runtime: live=200, ready=200, scanner=ready."
  note "App UID:GID $RUNTIME_IDENTITY; ClamAV UID:GID $CLAMAV_IDENTITY."
  note "App image $APP_IMAGE_SIZE_BYTES bytes; ClamAV base/runtime images $CLAMAV_IMAGE_SIZE_BYTES/$CLAMAV_RUNTIME_IMAGE_SIZE_BYTES bytes."
  exit 0
fi

note "Loading the synthetic disposable fixture for authenticated upload/download proof."
compose exec -T postgres psql \
  --username moldpilot_d2_smoke \
  --dbname moldpilot_d2_smoke \
  --set ON_ERROR_STOP=1 < "$FIXTURE_FILE"
ADMIN_ID="$(db_scalar 'SELECT id FROM users WHERE username = '\''admin'\'' LIMIT 1;' | tr -d '[:space:]')"
PROJECT_ID="$(db_scalar 'SELECT id FROM mold_trial_projects WHERE project_code = '\''MP-D2-SMOKE-001'\'' LIMIT 1;' | tr -d '[:space:]')"
[ -n "$ADMIN_ID" ] || fail "Synthetic admin was not found."
[ -n "$PROJECT_ID" ] || fail "Synthetic MP-D2-SMOKE-001 was not found."

SESSION_TOKEN="$(compose exec -T -e MOLDPILOT_D2_USER_ID="$ADMIN_ID" app node /opt/moldpilot-smoke/probe.mjs session)"
[ -n "$SESSION_TOKEN" ] || fail "Disposable authenticated session could not be created."

BASE_ATTACHMENT_COUNT="$(db_scalar 'SELECT count(*) FROM file_attachments;' | tr -d '[:space:]')"
BASE_ACTIVITY_COUNT="$(db_scalar 'SELECT count(*) FROM activity_logs;' | tr -d '[:space:]')"
BASE_INVENTORY="$(probe inventory)"

note "Uploading a runtime-generated clean valid PDF through quarantine and real clamd."
CLEAN_UPLOAD="$(probe upload-clean)"
[ "$(json_field "$CLEAN_UPLOAD" status)" = "200" ] || fail "Clean PDF upload failed."
CLEAN_ATTACHMENT_ID="$(json_field "$CLEAN_UPLOAD" body.attachmentId)"
CLEAN_SOURCE_SHA="$(json_field "$CLEAN_UPLOAD" sourceSha256)"
CLEAN_DOWNLOAD_BEFORE="$(probe download "$CLEAN_ATTACHMENT_ID")"
[ "$(json_field "$CLEAN_DOWNLOAD_BEFORE" status)" = "200" ] || fail "Clean attachment download failed."
CLEAN_HASH_BEFORE="$(json_field "$CLEAN_DOWNLOAD_BEFORE" sha256)"
[ "$CLEAN_SOURCE_SHA" = "$CLEAN_HASH_BEFORE" ] || fail "Released clean PDF hash differs from its source."

AFTER_CLEAN_COUNT="$(db_scalar 'SELECT count(*) FROM file_attachments;' | tr -d '[:space:]')"
[ "$AFTER_CLEAN_COUNT" -eq "$((BASE_ATTACHMENT_COUNT + 1))" ] || fail "Clean upload did not create exactly one FileAttachment."
AFTER_CLEAN_ACTIVITY_COUNT="$(db_scalar 'SELECT count(*) FROM activity_logs;' | tr -d '[:space:]')"
[ "$AFTER_CLEAN_ACTIVITY_COUNT" -eq "$((BASE_ACTIVITY_COUNT + 1))" ] || fail "Clean upload did not create exactly one ActivityLog."

note "Uploading a fragmented runtime-generated EICAR fixture."
EICAR_UPLOAD="$(probe upload-eicar)"
[ "$(json_field "$EICAR_UPLOAD" status)" = "422" ] || fail "EICAR upload was not rejected with 422."
AFTER_EICAR_COUNT="$(db_scalar 'SELECT count(*) FROM file_attachments;' | tr -d '[:space:]')"
[ "$AFTER_EICAR_COUNT" = "$AFTER_CLEAN_COUNT" ] || fail "EICAR created a FileAttachment."
AFTER_EICAR_ACTIVITY_COUNT="$(db_scalar 'SELECT count(*) FROM activity_logs;' | tr -d '[:space:]')"
[ "$AFTER_EICAR_ACTIVITY_COUNT" = "$AFTER_CLEAN_ACTIVITY_COUNT" ] || fail "EICAR created an ActivityLog."
AFTER_EICAR_INVENTORY="$(probe inventory)"
[ "$(json_field "$AFTER_EICAR_INVENTORY" quarantined.length)" = "0" ] || fail "Rejected malware remained in quarantine."
[ "$(json_field "$AFTER_EICAR_INVENTORY" released.length)" = "1" ] || fail "EICAR changed released storage."

note "Stopping clamd to prove fail-closed outage behavior."
compose stop clamav
OUTAGE_HEALTH="$(probe health)"
[ "$(json_field "$OUTAGE_HEALTH" live.status)" = "200" ] || fail "Liveness failed during scanner outage."
[ "$(json_field "$OUTAGE_HEALTH" ready.status)" = "503" ] || fail "Readiness did not return 503 during scanner outage."
[ "$(json_field "$OUTAGE_HEALTH" ready.body.components.scanner)" = "unavailable" ] || fail "Readiness leaked or misreported scanner state."

OUTAGE_UPLOAD="$(probe upload-outage)"
[ "$(json_field "$OUTAGE_UPLOAD" status)" = "503" ] || fail "Scanner-outage upload did not return 503."
AFTER_OUTAGE_COUNT="$(db_scalar 'SELECT count(*) FROM file_attachments;' | tr -d '[:space:]')"
[ "$AFTER_OUTAGE_COUNT" = "$AFTER_CLEAN_COUNT" ] || fail "Scanner-outage upload created a FileAttachment."
AFTER_OUTAGE_ACTIVITY_COUNT="$(db_scalar 'SELECT count(*) FROM activity_logs;' | tr -d '[:space:]')"
[ "$AFTER_OUTAGE_ACTIVITY_COUNT" = "$AFTER_CLEAN_ACTIVITY_COUNT" ] || fail "Scanner-outage upload created an ActivityLog."
OUTAGE_INVENTORY="$(probe inventory)"
[ "$(json_field "$OUTAGE_INVENTORY" released.length)" = "1" ] || fail "Scanner outage released a file."
[ "$(json_field "$OUTAGE_INVENTORY" quarantined.length)" = "1" ] || fail "Scanner outage did not retain one quarantine file."
QUARANTINE_NAME="$(json_field "$OUTAGE_INVENTORY" quarantined.0.name)"
QUARANTINE_HASH_BEFORE="$(json_field "$OUTAGE_INVENTORY" quarantined.0.sha256)"

note "Restarting clamd and waiting for readiness recovery."
compose start clamav
wait_for_health clamav
RECOVERED_HEALTH="$(probe health)"
[ "$(json_field "$RECOVERED_HEALTH" ready.status)" = "200" ] || fail "Readiness did not recover after clamd restart."

note "Force-recreating only the app container to prove persistent files."
APP_CONTAINER_BEFORE="$(compose ps --quiet app)"
compose up --detach --no-deps --force-recreate app
wait_for_health app
APP_CONTAINER_AFTER="$(compose ps --quiet app)"
[ "$APP_CONTAINER_BEFORE" != "$APP_CONTAINER_AFTER" ] || fail "App container was not replaced."

CLEAN_DOWNLOAD_AFTER="$(probe download "$CLEAN_ATTACHMENT_ID")"
CLEAN_HASH_AFTER="$(json_field "$CLEAN_DOWNLOAD_AFTER" sha256)"
[ "$CLEAN_HASH_AFTER" = "$CLEAN_HASH_BEFORE" ] || fail "Released attachment changed after app replacement."
FINAL_INVENTORY="$(probe inventory)"
[ "$(json_field "$FINAL_INVENTORY" quarantined.0.name)" = "$QUARANTINE_NAME" ] || fail "Retained quarantine file disappeared after app replacement."
QUARANTINE_HASH_AFTER="$(json_field "$FINAL_INVENTORY" quarantined.0.sha256)"
[ "$QUARANTINE_HASH_AFTER" = "$QUARANTINE_HASH_BEFORE" ] || fail "Quarantine bytes changed after app replacement."

FINAL_HEALTH="$(probe health)"
[ "$(json_field "$FINAL_HEALTH" live.status)" = "200" ] || fail "Final liveness check failed."
[ "$(json_field "$FINAL_HEALTH" ready.status)" = "200" ] || fail "Final readiness check failed."

note "Clean PDF: released and recorded; SHA-256 $CLEAN_HASH_BEFORE before/after replacement."
note "EICAR: rejected 422; no release, quarantine retention, or FileAttachment row."
note "Scanner outage: upload 503; liveness 200; readiness 503; no release/record."
note "Readiness recovered to 200 after clamd restart."
note "Retained quarantine: $QUARANTINE_NAME; SHA-256 $QUARANTINE_HASH_BEFORE before/after replacement."
note "App UID:GID $RUNTIME_IDENTITY; ClamAV UID:GID $CLAMAV_IDENTITY."
note "App image $APP_IMAGE_SIZE_BYTES bytes; ClamAV base/runtime images $CLAMAV_IMAGE_SIZE_BYTES/$CLAMAV_RUNTIME_IMAGE_SIZE_BYTES bytes."
note "D2.1 disposable scanner and persistent attachment proof passed."
