#!/usr/bin/env bash
#
# Backup v2 — encrypted local archive + immutable off-site copy.
#
# Required:
#   BACKUP_DIR=/Volumes/FactoryBackup/<app>
#   BACKUP_AGE_RECIPIENT=age1...
#
# Optional cloud leg (security-hardening-runbook.md §7b):
#   BACKUP_OSS_REMOTE / BACKUP_OSS_BUCKET / BACKUP_OSS_PREFIX / BACKUP_RCLONE_CONFIG
# Optional nightly self-verify (§7b):
#   BACKUP_VERIFY_RECIPIENT=age1...   second age recipient whose identity lives
#                                     on this machine so backup-verify.sh can
#                                     restore last night's archive unattended.
#
# The age recipient is public. Keep the private recovery identity offline and
# outside the application account. BACKUP_DIR must be a mounted NAS/external
# volume in production. Existing archives are never overwritten, locally or in
# the bucket.
#
# ESTATE RULE: this file names no application. Identity comes from
# scripts/backup-app-config.sh; shared helpers from scripts/backup-lib.sh.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Which stage a failure belongs to, so `fail` records it against the right leg.
CURRENT_STAGE="localArchive"

note() {
  printf '[backup] %s\n' "$*"
}

# The server environment. Overridable so a harness (scripts/backup-rehearsal.sh)
# can point it at an empty file: sourcing the operator's real .env would
# override the harness's exported BACKUP_* values and could aim a rehearsal at
# the production backup disk.
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$PROJECT_ROOT/.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKUP_ENV_FILE"
  set +a
fi

# shellcheck source=scripts/backup-app-config.sh
. "$SCRIPT_DIR/backup-app-config.sh"
# shellcheck source=scripts/backup-lib.sh
. "$SCRIPT_DIR/backup-lib.sh"

fail() {
  printf '[backup FAIL] %s\n' "$*" >&2
  record_status "$CURRENT_STAGE" failed "$*"
  exit 1
}

STATUS_DIR="$BACKUP_LEGACY_STATUS_DIR"

[ -n "${BACKUP_DIR:-}" ] ||
  fail "BACKUP_DIR is required and must point to a mounted NAS or external disk."
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] ||
  fail "BACKUP_AGE_RECIPIENT is required. Keep its private identity offline."
command -v age >/dev/null 2>&1 || fail "age is not installed or not on PATH."

mkdir -p "$BACKUP_DIR" 2>/dev/null ||
  fail "BACKUP_DIR could not be created — is the backup volume mounted?"
RESOLVED_BACKUP="$(cd "$BACKUP_DIR" && pwd -P)" ||
  fail "BACKUP_DIR is not reachable — is the backup volume mounted?"
if [ "${BACKUP_ALLOW_LOCAL:-}" != "1" ]; then
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
  "$PROJECT_ROOT" | "$PROJECT_ROOT"/*)
    fail "BACKUP_DIR resolves inside the project folder."
    ;;
esac

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is missing."
PG_DATABASE_URL="${DATABASE_URL%%\?*}"
UPLOADS_SRC="$BACKUP_APP_STORAGE_DIR"

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/backup-staging.XXXXXX")"
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
    pg_dump --format=custom --no-owner --no-privileges \
    -U "$BACKUP_APP_DB_USER" "$BACKUP_APP_DB_NAME" > "$DB_OUT"
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
if [ -f "$BACKUP_ENV_FILE" ]; then
  install -m 600 "$BACKUP_ENV_FILE" "$STAGING_DIR/recovery/${BACKUP_APP_NAME}.env"
fi

cat > "$STAGING_DIR/backup-info.txt" <<EOF
format=${BACKUP_APP_NAME}-encrypted-backup-v1
createdAt=$STAMP
databaseFormat=postgresql-custom
uploadsIncluded=true
recoveryConfigIncluded=$([ -f "$BACKUP_ENV_FILE" ] && printf true || printf false)
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
AGE_RECIPIENT_ARGS=(--recipient "$BACKUP_AGE_RECIPIENT")
if [ -n "${BACKUP_VERIFY_RECIPIENT:-}" ]; then
  # Second reader, used only by the unattended nightly verify. Its identity
  # lives on this machine at mode 0600; the escrowed recovery identity never
  # does. Documented trade-off in runbook §7b.
  AGE_RECIPIENT_ARGS=("${AGE_RECIPIENT_ARGS[@]}" --recipient "$BACKUP_VERIFY_RECIPIENT")
fi

tar -C "$STAGING_DIR" \
  -cf - database.dump uploads recovery backup-info.txt manifest.sha256 |
  age "${AGE_RECIPIENT_ARGS[@]}" --output "$ENCRYPTED_TEMP"

ENCRYPTED_BYTES="$(wc -c < "$ENCRYPTED_TEMP" | tr -d ' ')"
[ "$ENCRYPTED_BYTES" -gt "$DB_BYTES" ] ||
  fail "Encrypted archive is unexpectedly small."

ARCHIVE_NAME="${BACKUP_ARCHIVE_PREFIX}${STAMP}${BACKUP_ARCHIVE_SUFFIX}"
DESTINATION="$RESOLVED_BACKUP/$ARCHIVE_NAME"
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

record_status localArchive ok "" \
  "archiveName=$ARCHIVE_NAME" \
  "sizeBytes=$ENCRYPTED_BYTES" \
  "verifyReaderEnrolled=$([ -n "${BACKUP_VERIFY_RECIPIENT:-}" ] && printf yes || printf no)"

note "encrypted backup complete: $DESTINATION ($ENCRYPTED_BYTES bytes)"

# ── Cloud leg — immutable off-site copy ──────────────────────────────────────
# ALWAYS `rclone copy`, NEVER `rclone sync`: sync propagates local deletions to
# the bucket, which is exactly what an immutable off-site copy must not do. The
# uploading key is prefix-scoped and no-delete (Put/Get/List only) and the bucket
# carries a locked 30-day WORM policy, so a mistake here cannot destroy history —
# but the command still must be right.
CURRENT_STAGE="cloudUpload"
UPLOAD_EXIT=0

if [ "${BACKUP_OSS_ENABLED:-1}" != "1" ]; then
  note "cloud leg disabled by configuration; local archive only."
  record_status cloudUpload skipped "cloud leg disabled by configuration" \
    "archiveName=$ARCHIVE_NAME"
elif [ -z "${BACKUP_OSS_REMOTE:-}" ] || [ -z "${BACKUP_OSS_BUCKET:-}" ] || [ -z "${BACKUP_OSS_PREFIX:-}" ]; then
  note "cloud leg not configured (remote/bucket/prefix); see runbook 7b."
  record_status cloudUpload unconfigured "OSS remote, bucket or prefix is not configured" \
    "archiveName=$ARCHIVE_NAME"
elif ! command -v rclone > /dev/null 2>&1; then
  note "rclone is not installed; the off-site copy did not run. See runbook 7b."
  record_status cloudUpload unconfigured "rclone is not installed on this machine" \
    "archiveName=$ARCHIVE_NAME"
else
  RCLONE_ARGS=(copy "$DESTINATION" "$BACKUP_OSS_DESTINATION/" --immutable --no-traverse --checksum)
  if [ -n "${BACKUP_RCLONE_CONFIG:-}" ]; then
    RCLONE_ARGS=(--config "$BACKUP_RCLONE_CONFIG" "${RCLONE_ARGS[@]}")
  fi

  UPLOAD_LOG="$STAGING_DIR/rclone-upload.log"
  note "copying archive to $BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX/"
  if rclone "${RCLONE_ARGS[@]}" > "$UPLOAD_LOG" 2>&1; then
    record_status cloudUpload ok "" \
      "archiveName=$ARCHIVE_NAME" \
      "sizeBytes=$ENCRYPTED_BYTES" \
      "destination=$BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX"
    note "off-site copy complete: $BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX/$ARCHIVE_NAME"
  else
    UPLOAD_ERROR="$(tail -n 5 "$UPLOAD_LOG" 2>/dev/null | tr '\n' ' ')"
    if is_offline_error "$UPLOAD_ERROR"; then
      # Tolerated: the mini is offline. The archive is safe on the mounted disk
      # and the next run retries. The 26h upload threshold turns the admin
      # light red if this keeps happening, so silence is not possible.
      note "off-site copy skipped: this machine appears to be offline."
      record_status cloudUpload offline "$UPLOAD_ERROR" \
        "archiveName=$ARCHIVE_NAME" \
        "destination=$BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX"
    else
      printf '[backup FAIL] off-site copy failed: %s\n' "$UPLOAD_ERROR" >&2
      record_status cloudUpload failed "$UPLOAD_ERROR" \
        "archiveName=$ARCHIVE_NAME" \
        "destination=$BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX"
      UPLOAD_EXIT=1
    fi
  fi
fi

if [ "${BACKUP_MANAGE_RETENTION:-}" = "1" ]; then
  # Local pruning only. The bucket's history is governed by its lifecycle rule,
  # set once from the owner's laptop — the mini has no delete rights at all.
  RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
  [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_DAYS must be numeric."
  find "$RESOLVED_BACKUP" -maxdepth 1 -type f \
    -name "$BACKUP_ARCHIVE_GLOB" -mtime +"$RETENTION_DAYS" -delete
fi

if [ "$UPLOAD_EXIT" -ne 0 ]; then
  note "local archive is intact; the off-site copy needs attention."
  exit "$UPLOAD_EXIT"
fi

note "A backup is not accepted until a separate scratch restore succeeds."
