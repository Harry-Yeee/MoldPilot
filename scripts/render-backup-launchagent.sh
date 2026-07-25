#!/usr/bin/env bash

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT_ROOT/scripts/com.moldpilot.backup.plist"
BACKUP_DIR="${1:-}"
AGE_RECIPIENT="${2:-}"
OUTPUT="${3:-$HOME/Library/LaunchAgents/com.moldpilot.backup.plist}"
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

mkdir -p "$(dirname "$OUTPUT")" "$LOG_DIR"
chmod 700 "$LOG_DIR"
sed \
  -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
  -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" \
  -e "s|__AGE_RECIPIENT__|$AGE_RECIPIENT|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$TEMPLATE" > "$OUTPUT"
chmod 600 "$OUTPUT"
plutil -lint "$OUTPUT" >/dev/null

printf 'Rendered %s\n' "$OUTPUT"
printf 'Not activated. Loading the scheduler is an explicit approval step.\n'
