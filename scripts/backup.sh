#!/usr/bin/env bash
#
# MoldPilot nightly backup: database dump + uploaded files mirror + git bundle.
#
# Usage:
#   BACKUP_DIR=/Volumes/NAS/moldpilot-backups ./scripts/backup.sh
#   (or set BACKUP_DIR in the environment / launchd plist)
#
# BACKUP_DIR must point OFF this machine's main disk (NAS, external drive,
# or a mounted share). The script refuses to write inside the project folder.
#
# Retention: database dumps older than 30 days are pruned. The uploads mirror
# and git bundle are overwritten in place (rsync incremental / bundle refresh).
#
# Restore (see also README "Backups" section):
#   gunzip -c moldpilot-db-YYYYmmdd-HHMMSS.sql.gz | psql "$DATABASE_URL"
#   rsync -a "$BACKUP_DIR/uploads-mirror/" ./storage/uploads/
#   git clone moldpilot-repo.bundle restored-repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS=30

fail() { echo "[backup FAIL] $*" >&2; exit 1; }
note() { echo "[backup] $*"; }

# --- Preconditions -----------------------------------------------------------

[ -n "${BACKUP_DIR:-}" ] || fail "BACKUP_DIR is not set. Point it at a NAS/external disk, e.g. BACKUP_DIR=/Volumes/Backup/moldpilot"

mkdir -p "$BACKUP_DIR" || fail "cannot create BACKUP_DIR: $BACKUP_DIR"
RESOLVED_BACKUP="$(cd "$BACKUP_DIR" && pwd -P)"
case "$RESOLVED_BACKUP" in
  "$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    fail "BACKUP_DIR resolves inside the project folder ($RESOLVED_BACKUP). A backup on the same disk next to the data it protects is not a backup."
    ;;
esac

# Read DATABASE_URL from environment or .env
if [ -z "${DATABASE_URL:-}" ] && [ -f "$PROJECT_ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')"
fi
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL not found in environment or .env"

# --- 1. Database dump --------------------------------------------------------

DB_OUT="$RESOLVED_BACKUP/moldpilot-db-$STAMP.sql.gz"

if command -v pg_dump >/dev/null 2>&1; then
  note "pg_dump via host binary"
  pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$DB_OUT"
elif command -v docker >/dev/null 2>&1 && docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps --status running 2>/dev/null | grep -q postgres; then
  note "pg_dump via docker compose postgres container"
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T postgres \
    pg_dump --no-owner --no-privileges -U moldpilot moldpilot | gzip > "$DB_OUT"
else
  fail "no pg_dump on PATH and no running docker postgres service — cannot dump the database"
fi

# A dump that small is a failed dump wearing a .gz suffix.
DB_BYTES=$(wc -c < "$DB_OUT" | tr -d ' ')
[ "$DB_BYTES" -gt 10240 ] || fail "database dump suspiciously small ($DB_BYTES bytes): $DB_OUT"
note "database dump OK: $DB_OUT ($DB_BYTES bytes)"

# --- 2. Uploaded files mirror --------------------------------------------------

UPLOADS_SRC="${MOLDPILOT_STORAGE_DIR:-$PROJECT_ROOT/storage/uploads}"
if [ -d "$UPLOADS_SRC" ]; then
  mkdir -p "$RESOLVED_BACKUP/uploads-mirror"
  rsync -a --delete "$UPLOADS_SRC/" "$RESOLVED_BACKUP/uploads-mirror/"
  note "uploads mirror OK: $(find "$RESOLVED_BACKUP/uploads-mirror" -type f | wc -l | tr -d ' ') files"
else
  note "uploads dir not found ($UPLOADS_SRC) — skipping mirror (fine before first upload)"
fi

# --- 3. Git bundle -------------------------------------------------------------

if [ -d "$PROJECT_ROOT/.git" ]; then
  git -C "$PROJECT_ROOT" bundle create "$RESOLVED_BACKUP/moldpilot-repo.bundle" --all >/dev/null 2>&1 \
    && note "git bundle OK" \
    || note "git bundle skipped (no commits or bundle failed) — not fatal"
fi

# --- 4. Retention ---------------------------------------------------------------

PRUNED=$(find "$RESOLVED_BACKUP" -maxdepth 1 -name 'moldpilot-db-*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$PRUNED" = "0" ] || note "pruned $PRUNED dump(s) older than $RETENTION_DAYS days"

note "backup complete → $RESOLVED_BACKUP"
