#!/usr/bin/env bash
#
# Cross-repo skew preflight, shared by scripts/server-first-deploy-macos.sh and
# scripts/server-deploy-macos.sh.
#
# The app release gate (tests/domain/platform-production-package.test.ts) asserts
# on files that live in the sibling LJ_ERP platform checkout, resolved as the
# parent directory of this app checkout. When that checkout is older than the app
# checkout, the gate dies deep inside the test run with ENOENT and regex noise
# that names neither the repository nor the fix. This check runs first, costs
# nothing, and names both.
#
# Usage:
#   bash scripts/platform-preflight-check.sh [APP_ROOT] [LOG_LABEL]
#
# Exits 0 and prints one summary line when the platform checkout carries every
# file this release reads. Exits 1 with an actionable message otherwise.

set -euo pipefail

# The oldest platform release that satisfies this app checkout's manifest.
PLATFORM_PINNED_RELEASE='D3.1.1 (7ade001)'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT_INPUT="${1:-$SCRIPT_DIR/..}"
LOG_LABEL="${2:-MoldPilot platform preflight}"

preflight_note() {
  printf '\n[%s] %s\n' "$LOG_LABEL" "$*"
}

preflight_fail() {
  printf '\n[%s ERROR] %s\n' "$LOG_LABEL" "$*" >&2
  exit 1
}

[ -d "$APP_ROOT_INPUT" ] ||
  preflight_fail "App checkout not found: $APP_ROOT_INPUT"
APP_ROOT="$(cd -- "$APP_ROOT_INPUT" && pwd)"

# Resolved exactly like tests/domain/platform-production-package.test.ts:
#   const platformRoot = path.resolve(appRoot, "..");
# The test honours no environment override, so neither does this check; any
# override here would let the deploy pass a checkout the gate never looks at.
PLATFORM_ROOT="$(cd -- "$APP_ROOT/.." && pwd)"
MANIFEST="$APP_ROOT/scripts/platform-required-files.txt"

[ -f "$MANIFEST" ] ||
  preflight_fail "Required-file manifest is missing: $MANIFEST"

[ "$PLATFORM_ROOT" != "$APP_ROOT" ] ||
  preflight_fail "App checkout $APP_ROOT has no parent directory to use as the LJ_ERP platform checkout."

if [ ! -e "$PLATFORM_ROOT/.git" ]; then
  preflight_fail "Platform checkout at $PLATFORM_ROOT is not a git checkout. This app checkout must sit directly inside the LJ_ERP platform repository. Fix: clone LJ_ERP, then place MoldPilot inside it as \"\$LJ_ERP/MoldPilot\"."
fi

if [ ! -d "$PLATFORM_ROOT/ops" ]; then
  preflight_fail "Platform checkout at $PLATFORM_ROOT has no ops/ directory. This app checkout must sit directly inside the LJ_ERP platform repository. Fix: git -C \"$PLATFORM_ROOT\" pull, then re-run. App release pins platform >= $PLATFORM_PINNED_RELEASE."
fi

REQUIRED_COUNT=0
MISSING_COUNT=0
FIRST_MISSING=""
MISSING_LIST=""

while IFS= read -r manifest_line || [ -n "$manifest_line" ]; do
  manifest_line="${manifest_line%%#*}"
  manifest_line="${manifest_line#"${manifest_line%%[![:space:]]*}"}"
  manifest_line="${manifest_line%"${manifest_line##*[![:space:]]}"}"
  [ -n "$manifest_line" ] || continue

  REQUIRED_COUNT=$((REQUIRED_COUNT + 1))
  if [ ! -f "$PLATFORM_ROOT/$manifest_line" ]; then
    MISSING_COUNT=$((MISSING_COUNT + 1))
    [ -n "$FIRST_MISSING" ] || FIRST_MISSING="$manifest_line"
    MISSING_LIST="$MISSING_LIST  $manifest_line"$'\n'
  fi
done < "$MANIFEST"

[ "$REQUIRED_COUNT" -gt 0 ] ||
  preflight_fail "Required-file manifest lists no files: $MANIFEST"

if [ "$MISSING_COUNT" -gt 0 ]; then
  printf '\n[%s ERROR] %s\n' "$LOG_LABEL" \
    "Platform checkout at $PLATFORM_ROOT is missing $MISSING_COUNT file(s) required by this app release (first: $FIRST_MISSING). It is likely behind. Fix: git -C \"$PLATFORM_ROOT\" pull, then re-run. App release pins platform >= $PLATFORM_PINNED_RELEASE." >&2
  printf 'Missing file(s), relative to the platform checkout:\n%s' \
    "$MISSING_LIST" >&2
  exit 1
fi

PLATFORM_HEAD="$(git -C "$PLATFORM_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
[ -n "$PLATFORM_HEAD" ] || PLATFORM_HEAD="unknown"

preflight_note "Platform checkout at $PLATFORM_ROOT carries all $REQUIRED_COUNT required file(s) (HEAD $PLATFORM_HEAD, pins >= $PLATFORM_PINNED_RELEASE)."
