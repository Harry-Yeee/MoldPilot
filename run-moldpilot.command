#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

DEPLOYMENT_MODE="${MOLDPILOT_DEPLOYMENT_MODE:-}"
if [ -z "$DEPLOYMENT_MODE" ] && [ -f .env ]; then
  DEPLOYMENT_MODE="$(
    awk -F= '
      /^[[:space:]]*MOLDPILOT_DEPLOYMENT_MODE[[:space:]]*=/ {
        print substr($0, index($0, "=") + 1)
        exit
      }
    ' .env
  )"
fi

DEPLOYMENT_MODE="$(printf '%s' "$DEPLOYMENT_MODE" | tr -d "[:space:]\"'")"

if [ "$(printf '%s' "$DEPLOYMENT_MODE" | tr '[:upper:]' '[:lower:]')" = "production" ]; then
  echo "[FAIL] Local pilot setup is disabled for MOLDPILOT_DEPLOYMENT_MODE=production." >&2
  echo "Deploy this server with: bash scripts/server-deploy-macos.sh" >&2
  echo "No migration or seed was run." >&2
  exit 1
fi

bash scripts/run-local-pilot.sh
