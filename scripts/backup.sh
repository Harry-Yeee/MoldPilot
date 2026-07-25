#!/usr/bin/env bash
#
# Encrypted, versioned MoldPilot backup.
#
# Required:
#   BACKUP_DIR=/Volumes/FactoryBackup/MoldPilot
#   BACKUP_AGE_RECIPIENT=age1...
#
# The age recipient is public. Keep the private recovery identity offline and
# outside the application account. BACKUP_DIR must be a mounted NAS/external
# volume in production. Existing archives are never overwritten.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STATUS_DIR="$HOME/Library/Application Support/MoldPilot/backup-status"

fail() {
  printf '[backup FAIL] %s\n' "$*" >&2
  exit 1
}

note() {
  printf '[backup] %s\n' "$*"
}

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

[ -n "${BACKUP_DIR:-}" ] ||
  fail "BACKUP_DIR is required and must point to a mounted NAS or external disk."
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] ||
  fail "BACKUP_AGE_RECIPIENT is required. Keep its private identity offline."
command -v age >/dev/null 2>&1 || fail "age is not installed or not on PATH."

mkdir -p "$BACKUP_DIR"
RESOLVED_BACKUP="$(cd "$BACKUP_DIR" && pwd -P)"
if [ "${MOLDPILOT_ALLOW_LOCAL_BACKUP:-}" != "1" ]; then
  case "$RESOLVED_BACKUP" in
    /Volumes/*) ;;
    *) fail "BACKUP_DIR must resolve under /Volumes for production off-machine backup." ;;
  esac
  ROOT_DEVICE="$(stat -f '%d' / 2>/dev/null || stat -c '%d' /)"
  BACKUP_DEVICE="$(stat -f '%d' "$RESOLVED_BACKUP" 2>/dev/null || stat -c '%d' "$RESOLVED_BACKUP")"
  [ "$BACKUP_DEVICE" != "$ROOT_DEVICE" ] ||
    fail "BACKUP_DIR is under /Volumes but is not a mounted external/NAS filesystem."
fi

case "$RESOLVED_BACKUP" in
  "$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    fail "BACKUP_DIR resolves inside the project folder."
    ;;
esac

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is missing."
PG_DATABASE_URL="${DATABASE_URL%%\?*}"
UPLOADS_SRC="${MOLDPILOT_STORAGE_DIR:-$PROJECT_ROOT/storage/uploads}"

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/moldpilot-backup.XXXXXX")"
ENCRYPTED_TEMP="$STAGING_DIR/encrypted-backup.age"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT
chmod 700 "$STAGING_DIR"

DB_OUT="$STAGING_DIR/database.dump"
PG_DUMP_BIN="$(command -v pg_dump 2>/dev/null || true)"
if [ -z "$PG_DUMP_BIN" ]; then
  for candidate in \
    /opt/homebrew/opt/postgresql@16/bin/pg_dump \
    /usr/local/opt/postgresql@16/bin/pg_dump; do
    if [ -x "$candidate" ]; then
      PG_DUMP_BIN="$candidate"
      break
    fi
  done
fi

if [ -n "$PG_DUMP_BIN" ]; then
  note "creating PostgreSQL custom-format dump"
  "$PG_DUMP_BIN" --format=custom --no-owner --no-privileges \
    --file="$DB_OUT" "$PG_DATABASE_URL"
elif command -v docker >/dev/null 2>&1 &&
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps --status running 2>/dev/null |
    grep -q postgres; then
  note "creating PostgreSQL dump through Docker"
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T postgres \
    pg_dump --format=custom --no-owner --no-privileges -U moldpilot moldpilot > "$DB_OUT"
else
  fail "No pg_dump executable or running Docker PostgreSQL service is available."
fi

DB_BYTES="$(wc -c < "$DB_OUT" | tr -d ' ')"
[ "$DB_BYTES" -gt 10240 ] ||
  fail "Database dump is suspiciously small ($DB_BYTES bytes)."

mkdir -p "$STAGING_DIR/uploads" "$STAGING_DIR/recovery"
if [ -d "$UPLOADS_SRC" ]; then
  rsync -a --exclude '.DS_Store' "$UPLOADS_SRC/" "$STAGING_DIR/uploads/"
fi
if [ -f "$PROJECT_ROOT/.env" ]; then
  install -m 600 "$PROJECT_ROOT/.env" "$STAGING_DIR/recovery/moldpilot.env"
fi

cat > "$STAGING_DIR/backup-info.txt" <<EOF
format=moldpilot-encrypted-backup-v1
createdAt=$STAMP
databaseFormat=postgresql-custom
uploadsIncluded=true
recoveryConfigIncluded=$([ -f "$PROJECT_ROOT/.env" ] && printf true || printf false)
EOF

(
  cd "$STAGING_DIR"
  find database.dump uploads recovery backup-info.txt -type f -print |
    LC_ALL=C sort |
    while IFS= read -r file; do
      shasum -a 256 "$file"
    done > manifest.sha256
)

note "encrypting backup archive"
tar -C "$STAGING_DIR" \
  -cf - database.dump uploads recovery backup-info.txt manifest.sha256 |
  age --recipient "$BACKUP_AGE_RECIPIENT" --output "$ENCRYPTED_TEMP"

ENCRYPTED_BYTES="$(wc -c < "$ENCRYPTED_TEMP" | tr -d ' ')"
[ "$ENCRYPTED_BYTES" -gt "$DB_BYTES" ] ||
  fail "Encrypted archive is unexpectedly small."

DESTINATION="$RESOLVED_BACKUP/moldpilot-backup-$STAMP.tar.age"
[ ! -e "$DESTINATION" ] || fail "Refusing to overwrite existing archive: $DESTINATION"
PARTIAL="$DESTINATION.partial.$$"
install -m 600 "$ENCRYPTED_TEMP" "$PARTIAL"
mv "$PARTIAL" "$DESTINATION"

mkdir -p "$STATUS_DIR"
chmod 700 "$STATUS_DIR"
cat > "$STATUS_DIR/last-success" <<EOF
createdAt=$STAMP
archive=$DESTINATION
sizeBytes=$ENCRYPTED_BYTES
EOF
chmod 600 "$STATUS_DIR/last-success"

if [ "${BACKUP_MANAGE_RETENTION:-}" = "1" ]; then
  RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
  [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_DAYS must be numeric."
  find "$RESOLVED_BACKUP" -maxdepth 1 -type f \
    -name 'moldpilot-backup-*.tar.age' -mtime +"$RETENTION_DAYS" -delete
fi

note "encrypted backup complete: $DESTINATION ($ENCRYPTED_BYTES bytes)"
note "A backup is not accepted until a separate scratch restore succeeds."
