#!/bin/bash
# dev-refresh.sh — everything the DEV Mac needs after a `git pull`. Dev only:
# refuses to run in production mode (the mini uses server-deploy-macos.sh).
#
# Steps: install deps if the lockfile changed → migrate + regenerate client +
# seed + typecheck + tests (via the battle-tested migrate-and-verify.py, which
# also handles the migration-history repair) → remind you to restart pnpm dev.
#
# The #1 historical dev incident is a STALE GENERATED PRISMA CLIENT after
# pulling schema changes; migrate-and-verify.py's migrate step regenerates it,
# which is why this wrapper exists.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

MODE="${MOLDPILOT_DEPLOYMENT_MODE:-}"
if [ -z "$MODE" ] && [ -f .env ]; then
  MODE="$(grep -E '^MOLDPILOT_DEPLOYMENT_MODE=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ "$MODE" = "production" ]; then
  echo "[dev-refresh ERROR] This machine is in production mode. Use scripts/server-deploy-macos.sh on the mini." >&2
  exit 1
fi

echo "[dev-refresh] 1/3 Installing dependencies (no-op if lockfile unchanged)"
pnpm install

echo "[dev-refresh] 2/3 Migrate + regenerate client + seed + typecheck + tests"
python3 scripts/migrate-and-verify.py

echo "[dev-refresh] 3/3 Done. If a dev server is running it holds the OLD client:"
echo "               stop it (Ctrl+C) and start again:  pnpm dev"
