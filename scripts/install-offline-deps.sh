#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# The offline cache lives OUTSIDE the repo by default. A legacy in-repo
# ./.moldpilot-offline is still honored, but with a loud warning to move it.
CACHE_DIR="${MOLDPILOT_OFFLINE_DIR:-$HOME/.moldpilot-offline}"
LEGACY_CACHE_DIR="$ROOT_DIR/.moldpilot-offline"

new_cache_present() {
  [ -d "$CACHE_DIR/pnpm-store" ] || [ -f "$CACHE_DIR/moldpilot-pnpm-store.tgz" ]
}

legacy_cache_present() {
  [ -d "$LEGACY_CACHE_DIR/pnpm-store" ] || [ -f "$LEGACY_CACHE_DIR/moldpilot-pnpm-store.tgz" ]
}

if [ -z "${MOLDPILOT_OFFLINE_DIR:-}" ] && ! new_cache_present && legacy_cache_present; then
  echo "############################################################"
  echo "[WARN] Using LEGACY in-repo offline cache: $LEGACY_CACHE_DIR"
  echo "[WARN] An offline cache inside the repo bloats the Next.js/Turbopack"
  echo "[WARN] file watcher and persistent cache and can hang the dev server."
  echo "[WARN] Move it out of the repo now:"
  echo "[WARN]   mv .moldpilot-offline ~/.moldpilot-offline"
  echo "############################################################"
  echo
  CACHE_DIR="$LEGACY_CACHE_DIR"
fi

STORE_DIR="$CACHE_DIR/pnpm-store"
STORE_ARCHIVE="$CACHE_DIR/moldpilot-pnpm-store.tgz"
POSTGRES_IMAGE_ARCHIVE="$CACHE_DIR/postgres-16-image.tar"
REQUIRED_BINS=(
  "node_modules/.bin/prisma"
  "node_modules/.bin/next"
)

echo "MoldPilot offline dependency installer"
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
  echo "Offline install still needs pnpm already installed."
  echo "While online, run:"
  echo "  corepack enable"
  echo "  corepack prepare pnpm@11.5.3 --activate"
  exit 1
fi

if [ ! -d "$STORE_DIR" ]; then
  if [ -f "$STORE_ARCHIVE" ]; then
    echo "Extracting pnpm store from $STORE_ARCHIVE..."
    mkdir -p "$CACHE_DIR"
    tar -xzf "$STORE_ARCHIVE" -C "$CACHE_DIR"
  else
    echo "[FAIL] Offline pnpm store was not found."
    echo "Create it while online with:"
    echo "  ./scripts/create-offline-cache.sh"
    exit 1
  fi
fi

if [ -f "$POSTGRES_IMAGE_ARCHIVE" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker image inspect postgres:16 >/dev/null 2>&1; then
    echo "[OK] Docker image postgres:16 is already available."
  else
    echo "Loading Docker image postgres:16 from $POSTGRES_IMAGE_ARCHIVE..."
    docker load -i "$POSTGRES_IMAGE_ARCHIVE"
  fi
fi

missing_required_bins() {
  for bin_path in "${REQUIRED_BINS[@]}"; do
    if [ ! -x "$bin_path" ]; then
      return 0
    fi
  done

  return 1
}

echo
echo "Installing npm packages from offline pnpm store..."
pnpm --store-dir "$STORE_DIR" --config.virtual-store-only=false install --offline --frozen-lockfile

if missing_required_bins; then
  echo
  echo "[WARN] node_modules exists but required project binaries are missing."
  echo "[INFO] Rebuilding generated node_modules links from the offline store..."
  rm -rf node_modules
  pnpm --store-dir "$STORE_DIR" --config.virtual-store-only=false install --offline --frozen-lockfile
fi

if missing_required_bins; then
  echo
  echo "[FAIL] Offline install completed, but required binaries are still missing:"
  for bin_path in "${REQUIRED_BINS[@]}"; do
    if [ ! -x "$bin_path" ]; then
      echo "  - $bin_path"
    fi
  done
  echo
  echo "The offline cache may be incomplete. While online, rerun:"
  echo "  pnpm offline:cache"
  exit 1
fi

echo
echo "[OK] Offline dependencies installed."
