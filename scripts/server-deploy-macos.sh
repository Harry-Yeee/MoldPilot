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
    --help|-h)
      cat <<'EOF'
Usage: bash scripts/server-deploy-macos.sh [--no-pull] [--skip-tests]

Pulls main with --ff-only, optionally runs a configured backup, stops the
launchd service, installs locked dependencies, deploys Prisma migrations,
verifies and builds, restarts the service, and checks /login.
EOF
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

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
cleanup() {
  status=$?
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  if [ "$status" -ne 0 ] && [ "$SERVICE_STOPPED" = true ]; then
    launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"
[ -z "$(git status --porcelain)" ] || fail "The production checkout has local changes. Resolve them before deploying."

if [ "$PULL_CHANGES" = true ]; then
  note "Pulling origin/main with fast-forward only"
  git pull --ff-only origin main
fi

if [ -n "${BACKUP_DIR:-}" ]; then
  note "Creating the configured pre-deployment backup"
  BACKUP_DIR="$BACKUP_DIR" bash scripts/backup.sh
else
  note "BACKUP_DIR is not set; no automatic pre-deployment backup ran"
fi

note "Stopping the running application before replacing .next"
launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
SERVICE_STOPPED=true

note "Installing locked dependencies and generating Prisma Client"
pnpm install --frozen-lockfile
pnpm exec prisma generate

note "Applying pending production migrations"
pnpm exec prisma migrate deploy

if [ "$RUN_TESTS" = true ]; then
  note "Running typecheck and domain tests"
  pnpm typecheck
  CI=true pnpm test
fi

note "Building the production application"
pnpm build

note "Restarting MoldPilot"
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/$SERVICE_LABEL"
SERVICE_STOPPED=false

for _ in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3000/login; then
    note "Deployment healthy at http://127.0.0.1:3000"
    exit 0
  fi
  sleep 1
done

fail "Health check failed. Inspect $LOG_DIR/app-error.log."
