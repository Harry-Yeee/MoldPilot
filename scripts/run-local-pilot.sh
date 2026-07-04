#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "MoldPilot local runner"
echo "Project: $ROOT_DIR"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js was not found on PATH."
  echo "Install Node 24+, then rerun this script."
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "[FAIL] Node $NODE_VERSION detected. MoldPilot local pilot needs Node 24+."
  exit 1
fi

echo "[OK] Node $NODE_VERSION"

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "[INFO] pnpm was not found. Enabling Corepack..."
    corepack enable
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[FAIL] pnpm was not found on PATH."
  echo "Run this, then rerun the script:"
  echo "  corepack enable"
  exit 1
fi

echo "[OK] pnpm $(pnpm --version)"

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    echo "[OK] Docker Desktop is running."
  else
    echo "[FAIL] Docker is installed, but Docker Desktop is not running."
    echo "Open Docker Desktop, wait until it says it is running, then rerun this script."
    exit 1
  fi
else
  echo "[WARN] Docker was not found."
  echo "The script will continue only if your .env DATABASE_URL points to a running PostgreSQL database."
fi

echo
echo "Installing dependencies..."
# Offline cache lives OUTSIDE the repo by default; a legacy in-repo copy is
# still detected (install-offline-deps.sh prints the migration warning).
OFFLINE_DIR="${MOLDPILOT_OFFLINE_DIR:-$HOME/.moldpilot-offline}"
LEGACY_OFFLINE_DIR="$ROOT_DIR/.moldpilot-offline"
if [ -d "$OFFLINE_DIR/pnpm-store" ] || [ -f "$OFFLINE_DIR/moldpilot-pnpm-store.tgz" ]; then
  echo "[INFO] Offline dependency cache detected at $OFFLINE_DIR."
  bash scripts/install-offline-deps.sh
elif [ -z "${MOLDPILOT_OFFLINE_DIR:-}" ] && { [ -d "$LEGACY_OFFLINE_DIR/pnpm-store" ] || [ -f "$LEGACY_OFFLINE_DIR/moldpilot-pnpm-store.tgz" ]; }; then
  echo "[WARN] Legacy in-repo offline cache detected. Move it with: mv .moldpilot-offline ~/.moldpilot-offline"
  echo "[WARN] An in-repo cache bloats the dev server's file watcher and can hang compiles."
  bash scripts/install-offline-deps.sh
else
  pnpm install
fi

echo
echo "Preparing database, seed data, and starting the website..."
echo "When Next.js says it is ready, open Chrome at http://localhost:3000"
echo "Keep this terminal open. Press Ctrl+C to stop MoldPilot."
echo

node scripts/local-pilot.mjs
