#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.d1-smoke.yml"
APP_IMAGE="${MOLDPILOT_D1_APP_IMAGE:-moldpilot:d1}"
SMOKE_SUFFIX="$(date -u +%Y%m%d%H%M%S)-$$-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(3).toString("hex"))')"
PROJECT_NAME="moldpilot-d1-smoke-$SMOKE_SUFFIX"
MIGRATOR_IMAGE="moldpilot:d1-migrator-$SMOKE_SUFFIX"

fail() {
  printf '[MoldPilot D1 smoke FAIL] %s\n' "$*" >&2
  exit 1
}

note() {
  printf '[MoldPilot D1 smoke] %s\n' "$*"
}

case "${COMPOSE_PROJECT_NAME:-}" in
  *[Pp][Rr][Oo][Dd]*) fail "Refusing a COMPOSE_PROJECT_NAME marked as production." ;;
esac
case "${DATABASE_URL:-}" in
  *[Pp][Rr][Oo][Dd]*) fail "Refusing to run while DATABASE_URL is marked as production." ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker is required."
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."
[ -f "$COMPOSE_FILE" ] || fail "Missing $COMPOSE_FILE"

MOLDPILOT_D1_SMOKE_DB_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
MOLDPILOT_D1_SMOKE_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
MOLDPILOT_D1_SMOKE_DATABASE_URL="postgresql://moldpilot_d1_smoke:${MOLDPILOT_D1_SMOKE_DB_PASSWORD}@postgres:5432/moldpilot_d1_smoke?schema=public"
MOLDPILOT_D1_APP_IMAGE="$APP_IMAGE"
MOLDPILOT_D1_MIGRATOR_IMAGE="$MIGRATOR_IMAGE"
export MOLDPILOT_D1_SMOKE_DB_PASSWORD MOLDPILOT_D1_SMOKE_SESSION_SECRET
export MOLDPILOT_D1_SMOKE_DATABASE_URL MOLDPILOT_D1_APP_IMAGE MOLDPILOT_D1_MIGRATOR_IMAGE

case "$PROJECT_NAME:$MOLDPILOT_D1_SMOKE_DATABASE_URL" in
  *[Pp][Rr][Oo][Dd]*) fail "Disposable smoke identity must never be marked as production." ;;
esac
case "$MOLDPILOT_D1_SMOKE_DATABASE_URL" in
  *"@postgres:5432/moldpilot_d1_smoke"*) ;;
  *) fail "Disposable database URL escaped the internal smoke PostgreSQL service." ;;
esac

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  set +e
  compose down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm "$MIGRATOR_IMAGE" >/dev/null 2>&1
  if [ "$status" -eq 0 ]; then
    note "Removed disposable project $PROJECT_NAME and its volumes."
  else
    printf '[MoldPilot D1 smoke] Cleaned disposable project %s after failure.\n' "$PROJECT_NAME" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for_health() {
  service="$1"
  attempts=0
  while [ "$attempts" -lt 90 ]; do
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

note "Using isolated Compose project $PROJECT_NAME (PostgreSQL is not host-published)."
note "Building final image $APP_IMAGE."
docker build --target runner --tag "$APP_IMAGE" "$PROJECT_ROOT"

note "Building disposable migration target."
docker build --target migrator --tag "$MIGRATOR_IMAGE" "$PROJECT_ROOT"

RUNTIME_USER="$(docker image inspect --format '{{.Config.User}}' "$APP_IMAGE")"
case "$RUNTIME_USER" in
  ""|0|0:0|root|root:root) fail "Final image runtime user is root." ;;
esac

IMAGE_ENV="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$APP_IMAGE")"
if printf '%s\n' "$IMAGE_ENV" | grep -Eq '^(DATABASE_URL|MOLDPILOT_SESSION_SECRET|MOLDPILOT_BASE_URL)='; then
  fail "Final image contains runtime configuration that must be injected at startup."
fi
docker run --rm --entrypoint /bin/sh "$APP_IMAGE" -c \
  'test ! -e /app/.env && test ! -e /app/RAW && test ! -e /app/storage && test ! -e /app/generated' \
  || fail "Final image contains a forbidden local-data path."

note "Starting disposable PostgreSQL 16."
compose up --detach postgres
wait_for_health postgres

note "Applying migrations once to the disposable database."
compose run --rm migrator migrate deploy

note "Starting the non-root standalone application."
compose up --detach --no-deps app
wait_for_health app

compose exec -T app node --input-type=module -e '
  const checks = [
    ["/api/health/live", (response, body) => response.status === 200 && body.status === "ok"],
    ["/api/health/ready", (response, body) => response.status === 200 && body.status === "ready"],
    ["/login", (response, body) => response.status === 200 && typeof body === "string" && body.includes("type=\"password\"")]
  ];
  for (const [pathname, passes] of checks) {
    const response = await fetch(`http://127.0.0.1:3000${pathname}`, { cache: "no-store" });
    const body = pathname === "/login" ? await response.text() : await response.json();
    if (!passes(response, body)) throw new Error(`${pathname} check failed with HTTP ${response.status}`);
    console.log(`[OK] ${pathname} HTTP ${response.status}`);
  }
' 

RUNTIME_IDENTITY="$(compose exec -T app node -e '
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid == null || uid === 0) process.exit(1);
  process.stdout.write(`${uid}:${gid}`);
')" || fail "Application process is running as root."

APP_CONTAINER_ID="$(compose ps --quiet app)"
APP_HEALTH="$(docker inspect --format '{{.State.Health.Status}}' "$APP_CONTAINER_ID")"
IMAGE_SIZE_BYTES="$(docker image inspect --format '{{.Size}}' "$APP_IMAGE")"
IMAGE_SIZE_MIB="$(node -e 'process.stdout.write((Number(process.argv[1]) / 1024 / 1024).toFixed(1))' "$IMAGE_SIZE_BYTES")"

note "Runtime user: $RUNTIME_USER (process UID:GID $RUNTIME_IDENTITY)."
note "Container health: $APP_HEALTH."
note "Final image size: ${IMAGE_SIZE_MIB} MiB."
note "No .env, RAW, storage, generated data, or injected runtime secrets were found in the final image."
note "Disposable container smoke test passed."
