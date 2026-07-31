#!/usr/bin/env bash
#
# Repeatable in-place deployment for an already bootstrapped Mac mini.
# This script never seeds or resets the production database.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_LABEL="com.moldpilot.app"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/MoldPilot"
PULL_CHANGES=true
RUN_TESTS=true
RUN_BACKUP=true

note() {
  printf '\n[MoldPilot deploy] %s\n' "$*"
}

fail() {
  printf '\n[MoldPilot deploy ERROR] %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-pull)
      PULL_CHANGES=false
      ;;
    --skip-tests)
      RUN_TESTS=false
      ;;
    --skip-backup)
      RUN_BACKUP=false
      ;;
    --help|-h)
      cat <<'EOF'
Usage: bash scripts/server-deploy-macos.sh [--no-pull] [--skip-tests] [--skip-backup]

Preflights the parent LJ_ERP platform checkout before any other work: the release
test gate reads files from it, so a platform checkout that is behind this app
release is reported by name here instead of as ENOENT inside the gate. On skew,
git pull the parent repository and re-run. PLATFORM_PREFLIGHT_ONLY=1 runs only
that check.

Pulls main with --ff-only, requires an encrypted off-machine backup, stops the
launchd service, installs locked dependencies, deploys Prisma migrations,
verifies and builds, restarts the service, and checks /login.

--skip-backup is an explicit emergency bypass. Record why it was used and take
a verified backup as soon as the incident is stable.
EOF
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

# Platform preflight runs before every other gate, including the host checks.
# This release reads files from the parent LJ_ERP platform checkout, and a
# platform checkout that is behind the app checkout otherwise fails much later,
# inside `pnpm test`, as unreadable ENOENT and regex noise.
PLATFORM_PREFLIGHT="$PROJECT_ROOT/scripts/platform-preflight-check.sh"
[ -f "$PLATFORM_PREFLIGHT" ] ||
  fail "Platform preflight is missing: $PLATFORM_PREFLIGHT"
note "Verifying the LJ_ERP platform checkout"
bash "$PLATFORM_PREFLIGHT" "$PROJECT_ROOT" "MoldPilot deploy"

if [ "${MOLDPILOT_PLATFORM_PREFLIGHT_ONLY:-${PLATFORM_PREFLIGHT_ONLY:-0}}" = "1" ]; then
  note "PLATFORM_PREFLIGHT_ONLY=1 is set. Stopping before any deployment work."
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || fail "This deployment script supports macOS only."
[ -f "$PLIST_PATH" ] || fail "Launch service not found. Run scripts/server-bootstrap-macos.sh first."

if [ -x /opt/homebrew/bin/brew ]; then
  BREW_BIN=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW_BIN=/usr/local/bin/brew
else
  fail "Homebrew is unavailable. Run scripts/server-bootstrap-macos.sh."
fi

NODE_BIN="$("$BREW_BIN" --prefix node@24)/bin"
PG_BIN="$("$BREW_BIN" --prefix postgresql@16)/bin"
export PATH="$NODE_BIN:$PG_BIN:$("$BREW_BIN" --prefix)/bin:$PATH"

LOCK_DIR="$HOME/Library/Caches/MoldPilot/deploy.lock"
mkdir -p "$(dirname "$LOCK_DIR")"
mkdir "$LOCK_DIR" 2>/dev/null || fail "Another deployment appears to be running: $LOCK_DIR"

SERVICE_STOPPED=false
NEXT_ENV_SNAPSHOT=""
restore_next_env() {
  if [ -n "$NEXT_ENV_SNAPSHOT" ] && [ -f "$NEXT_ENV_SNAPSHOT" ]; then
    cp "$NEXT_ENV_SNAPSHOT" "$PROJECT_ROOT/next-env.d.ts"
    rm -f "$NEXT_ENV_SNAPSHOT"
    NEXT_ENV_SNAPSHOT=""
  fi
}
cleanup() {
  status=$?
  restore_next_env || status=1
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  if [ "$status" -ne 0 ] && [ "$SERVICE_STOPPED" = true ]; then
    launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"
[ -z "$(git status --porcelain)" ] || fail "The production checkout has local changes. Resolve them before deploying."
[ -f .env ] || fail "Protected production .env is missing."
set -a
# shellcheck disable=SC1091
source .env
set +a

"$NODE_BIN/node" "$PROJECT_ROOT/scripts/check-production-config.mjs"
if [[ "$MOLDPILOT_BASE_URL" == https://* ]]; then
  [ "${MOLDPILOT_TRUST_PROXY:-}" = "1" ] ||
    fail "MOLDPILOT_TRUST_PROXY=1 is required behind the approved TLS proxy."
fi
"$PROJECT_ROOT/scripts/check-malware-scanner.sh"

if [ "$PULL_CHANGES" = true ]; then
  note "Pulling origin/main with fast-forward only"
  git pull --ff-only origin main
fi

if [ "$RUN_BACKUP" = true ]; then
  [ -n "${BACKUP_DIR:-}" ] ||
    fail "BACKUP_DIR is required for deployment. Configure encrypted off-machine backups or use --skip-backup only for a documented emergency."
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] ||
    fail "BACKUP_AGE_RECIPIENT is required for deployment."
  note "Creating the required encrypted pre-deployment backup"
  bash scripts/backup.sh
else
  printf '\n[MoldPilot deploy WARNING] Emergency deployment is proceeding without a fresh backup.\n' >&2
fi

note "Stopping the running application before replacing .next"
launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
SERVICE_STOPPED=true

note "Installing locked dependencies and generating Prisma Client"
pnpm install --frozen-lockfile
pnpm exec prisma generate

note "Applying pending production migrations"
pnpm exec prisma migrate deploy

NEXT_ENV_SNAPSHOT="$(mktemp "$HOME/Library/Caches/MoldPilot/next-env.deploy.XXXXXX")"
cp "$PROJECT_ROOT/next-env.d.ts" "$NEXT_ENV_SNAPSHOT"

if [ "$RUN_TESTS" = true ]; then
  note "Running typecheck and domain tests"
  pnpm typecheck
  CI=true pnpm test
fi

note "Building the production application"
pnpm build
restore_next_env

STANDALONE_ROOT="$PROJECT_ROOT/.next/standalone"
[ -f "$STANDALONE_ROOT/server.js" ] ||
  fail "Next standalone server was not generated."
[ -d "$PROJECT_ROOT/.next/static" ] ||
  fail "Next static assets were not generated."
[ -d "$PROJECT_ROOT/public" ] ||
  fail "Public assets are missing."
note "Assembling the standalone production runtime"
mkdir -p "$STANDALONE_ROOT/.next"
ditto "$PROJECT_ROOT/.next/static" "$STANDALONE_ROOT/.next/static"
ditto "$PROJECT_ROOT/public" "$STANDALONE_ROOT/public"

note "Restarting MoldPilot"
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/$SERVICE_LABEL"
SERVICE_STOPPED=false

HEALTH_URL="http://127.0.0.1:3000/login"
if [[ "$MOLDPILOT_BASE_URL" == http://* ]]; then
  HEALTH_URL="${MOLDPILOT_BASE_URL%/}/login"
fi

for _ in $(seq 1 30); do
  if curl --fail --silent --output /dev/null "$HEALTH_URL"; then
    note "Deployment healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

fail "Health check failed. Inspect $LOG_DIR/app-error.log."
