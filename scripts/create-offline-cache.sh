#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# The offline cache must live OUTSIDE the repo. Keeping it inside bloats the
# Next.js/Turbopack file watcher and persistent cache and can hang the dev server.
CACHE_DIR="${MOLDPILOT_OFFLINE_DIR:-$HOME/.moldpilot-offline}"

# Refuse to write the cache inside the project checkout, even if
# MOLDPILOT_OFFLINE_DIR was pointed here. Compare resolved absolute paths.
mkdir -p "$CACHE_DIR"
RESOLVED_CACHE_DIR="$(cd "$CACHE_DIR" && pwd -P)"
RESOLVED_ROOT_DIR="$(cd "$ROOT_DIR" && pwd -P)"
case "$RESOLVED_CACHE_DIR/" in
  "$RESOLVED_ROOT_DIR"/*)
    echo "[FAIL] Refusing to create the offline cache inside the project checkout:"
    echo "  $RESOLVED_CACHE_DIR"
    echo "A cache inside the repo bloats the dev server's file watcher and can hang compiles."
    echo "Unset MOLDPILOT_OFFLINE_DIR (defaults to \$HOME/.moldpilot-offline) or point it outside the repo, then rerun."
    exit 1
    ;;
esac

STORE_DIR="$CACHE_DIR/pnpm-store"
STORE_ARCHIVE="$CACHE_DIR/moldpilot-pnpm-store.tgz"
POSTGRES_IMAGE_ARCHIVE="$CACHE_DIR/postgres-16-image.tar"

echo "MoldPilot offline cache creator"
echo "Project: $ROOT_DIR"
echo

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "[INFO] pnpm was not found. Enabling Corepack..."
    corepack enable
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[FAIL] pnpm was not found on PATH."
  echo "While online, run:"
  echo "  corepack enable"
  echo "  corepack prepare pnpm@11.5.3 --activate"
  echo "Then rerun:"
  echo "  ./scripts/create-offline-cache.sh"
  exit 1
fi

echo "Fetching npm packages into $STORE_DIR..."
pnpm --store-dir "$STORE_DIR" fetch

echo
echo "Packing pnpm store into $STORE_ARCHIVE..."
tar -czf "$STORE_ARCHIVE" -C "$CACHE_DIR" pnpm-store

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo
  echo "Caching Docker image postgres:16..."
  docker pull postgres:16
  docker save postgres:16 -o "$POSTGRES_IMAGE_ARCHIVE"
else
  echo
  echo "[WARN] Docker Desktop is not running, so postgres:16 was not cached."
  echo "If you need fully offline Docker setup, run this script again while Docker Desktop is running."
fi

cat > "$CACHE_DIR/README.txt" <<EOF
MoldPilot offline cache

Created from:
  $ROOT_DIR

Use on the same project checkout:
  ./scripts/install-offline-deps.sh
  ./scripts/run-local-pilot.sh

This cache covers npm packages. If postgres-16-image.tar exists, it also covers
the Docker PostgreSQL image used by docker-compose.yml.

Node 24+, pnpm, and Docker Desktop must already be installed on the offline Mac.
EOF

echo
echo "[OK] Offline cache ready at $CACHE_DIR"
echo "For offline install later, run:"
echo "  ./scripts/install-offline-deps.sh"
