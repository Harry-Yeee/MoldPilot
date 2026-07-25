#!/usr/bin/env bash
#
# Restore an encrypted MoldPilot archive into an EMPTY scratch database and a
# separate scratch attachment directory. This script never targets the live
# attachment path and never drops a database.

set -euo pipefail
umask 077

ARCHIVE="${1:-}"
SCRATCH_UPLOADS="${2:-}"

fail() {
  printf '[restore FAIL] %s\n' "$*" >&2
  exit 1
}

[ -f "$ARCHIVE" ] ||
  fail "Usage: AGE_IDENTITY_FILE=/path RESTORE_DATABASE_URL=postgresql://... $0 <archive> <scratch-uploads-dir>"
[ -n "$SCRATCH_UPLOADS" ] || fail "A scratch upload directory is required."
[ -n "${AGE_IDENTITY_FILE:-}" ] || fail "AGE_IDENTITY_FILE is required."
[ -f "$AGE_IDENTITY_FILE" ] || fail "Age identity file was not found."
[ -n "${RESTORE_DATABASE_URL:-}" ] || fail "RESTORE_DATABASE_URL is required."
[ "${RESTORE_CONFIRM:-}" = "RESTORE_TO_EMPTY_SCRATCH" ] ||
  fail "Set RESTORE_CONFIRM=RESTORE_TO_EMPTY_SCRATCH after verifying the target is disposable."
command -v age >/dev/null 2>&1 || fail "age is unavailable."
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is unavailable."
command -v psql >/dev/null 2>&1 || fail "psql is unavailable."

case "$SCRATCH_UPLOADS" in
  /|"$HOME/MoldPilotData/uploads"|*/storage/uploads)
    fail "Refusing to restore into a live-looking attachment directory."
    ;;
esac

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/moldpilot-restore.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

age --decrypt --identity "$AGE_IDENTITY_FILE" "$ARCHIVE" |
  tar -C "$STAGING_DIR" -xf -

(
  cd "$STAGING_DIR"
  shasum -a 256 -c manifest.sha256
)

ROW_COUNT="$(psql "$RESTORE_DATABASE_URL" -Atc \
  "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
[ "$ROW_COUNT" = "0" ] || fail "Scratch database is not empty."

pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname "$RESTORE_DATABASE_URL" "$STAGING_DIR/database.dump"
mkdir -p "$SCRATCH_UPLOADS"
chmod 700 "$SCRATCH_UPLOADS"
rsync -a "$STAGING_DIR/uploads/" "$SCRATCH_UPLOADS/"

printf 'Scratch restore completed.\n'
printf 'Recovery configuration was decrypted only inside temporary staging and was not installed.\n'
