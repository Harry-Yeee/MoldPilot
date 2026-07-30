#!/usr/bin/env bash

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT_ROOT/scripts/com.moldpilot.backup.plist"
# Backup v2 sibling: the nightly restore proof, which also runs the cloud drill
# whenever the last successful drill is older than BACKUP_DRILL_MAX_AGE_DAYS.
VERIFY_TEMPLATE="$PROJECT_ROOT/scripts/com.moldpilot.backup-verify.plist"
BACKUP_DIR="${1:-}"
AGE_RECIPIENT="${2:-}"
OUTPUT="${3:-$HOME/Library/LaunchAgents/com.moldpilot.backup.plist}"
VERIFY_OUTPUT="${4:-$HOME/Library/LaunchAgents/com.moldpilot.backup-verify.plist}"
LOG_DIR="$HOME/Library/Logs/MoldPilot"

fail() {
  printf '[MoldPilot backup scheduler ERROR] %s\n' "$*" >&2
  exit 1
}

[ -n "$BACKUP_DIR" ] || fail "Usage: $0 <backup-dir> <age-recipient> [output-plist]"
[ -n "$AGE_RECIPIENT" ] || fail "An age public recipient is required."
case "$BACKUP_DIR" in
  /Volumes/*) ;;
  *) fail "Backup directory must be a mounted NAS/external path under /Volumes." ;;
esac
[[ "$AGE_RECIPIENT" =~ ^(age1|ssh-) ]] ||
  fail "Age recipient must be an age X25519 or SSH public recipient."
[[ "$BACKUP_DIR" =~ ^[A-Za-z0-9._/\ -]+$ ]] ||
  fail "Backup directory contains unsupported characters."
[[ "$AGE_RECIPIENT" =~ ^[A-Za-z0-9+/=@:._-]+$ ]] ||
  fail "Age recipient contains unsupported characters."

mkdir -p "$(dirname "$OUTPUT")" "$(dirname "$VERIFY_OUTPUT")" "$LOG_DIR"
chmod 700 "$LOG_DIR"

render_agent() {
  template="$1"
  destination="$2"
  sed \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" \
    -e "s|__AGE_RECIPIENT__|$AGE_RECIPIENT|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$template" > "$destination"
  chmod 600 "$destination"
  plutil -lint "$destination" >/dev/null
  printf 'Rendered %s\n' "$destination"
}

render_agent "$TEMPLATE" "$OUTPUT"
render_agent "$VERIFY_TEMPLATE" "$VERIFY_OUTPUT"

printf 'Not activated. Loading the scheduler is an explicit approval step.\n'
