#!/usr/bin/env bash
#
# Backup v2 — nightly restore proof + monthly cloud drill.
#
# A backup that has never restored is a hope, not a backup. This script proves
# the chain every night without a human:
#
#   nightly      restore the newest LOCAL archive into a scratch database,
#                verify the manifest, assert the key tables are non-empty,
#                then drop the scratch database.
#   cloud drill  whenever the last SUCCESSFUL drill is older than
#                BACKUP_DRILL_MAX_AGE_DAYS (default 30) or has never run — or
#                on demand with --cloud-drill — pull the newest archive FROM the
#                OSS bucket into a fresh temporary directory, never the local
#                backup disk, and run the same proof against those bytes. A
#                failed or offline drill is simply retried the next night.
#
# It NEVER touches the production database. The scratch name must end in
# `_verify` / `_verify_scratch`; anything else is refused before a connection
# is opened, and the scratch database is dropped even when the run fails.
#
# Required:
#   BACKUP_DIR                   mounted archive destination (same as backup.sh)
#   DATABASE_URL                 used only for host/port/credentials; the
#                                database name is replaced by the scratch name
#   BACKUP_VERIFY_IDENTITY_FILE  age identity able to read the archives. See
#                                runbook §7b: this is a SECOND, machine-resident
#                                reader enrolled with BACKUP_VERIFY_RECIPIENT.
#                                The escrowed recovery identity stays offline.
#
# Usage:
#   bash scripts/backup-verify.sh                # nightly (+ drill when due)
#   bash scripts/backup-verify.sh --cloud-drill  # drill only, ignoring the age
#   bash scripts/backup-verify.sh --local        # nightly only
#   bash scripts/backup-verify.sh --archive PATH # prove one specific archive
#
# ESTATE RULE: this file names no application. Identity comes from
# scripts/backup-app-config.sh; shared helpers from scripts/backup-lib.sh.

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_LOCAL=1
RUN_DRILL=auto
EXPLICIT_ARCHIVE=""

note() {
  printf '[verify] %s\n' "$*"
}

warn() {
  printf '[verify WARN] %s\n' "$*" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cloud-drill)
      RUN_LOCAL=0
      RUN_DRILL=1
      ;;
    --local)
      RUN_LOCAL=1
      RUN_DRILL=0
      ;;
    --archive)
      shift
      [ "$#" -gt 0 ] || {
        printf '[verify FAIL] --archive requires a path.\n' >&2
        exit 2
      }
      EXPLICIT_ARCHIVE="$1"
      RUN_DRILL=0
      ;;
    -h | --help)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      printf '[verify FAIL] Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

# Overridable for the rehearsal harness — see the same block in backup.sh.
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

STAGING_DIR=""
DRILL_DIR=""
SCRATCH_CREATED=0

# ── Production guards, checked before anything can connect ───────────────────
require_verify_database_name "$BACKUP_VERIFY_DB_NAME" || exit 2

if [ "$BACKUP_VERIFY_DB_NAME" = "$BACKUP_APP_DB_NAME" ]; then
  printf '[verify FAIL] The scratch database name equals the production database name.\n' >&2
  exit 2
fi

[ -n "${DATABASE_URL:-}" ] || {
  printf '[verify FAIL] DATABASE_URL is missing.\n' >&2
  exit 2
}

PG_DATABASE_URL="${DATABASE_URL%%\?*}"
PG_SERVER_URL="${PG_DATABASE_URL%/*}"
SCRATCH_DATABASE_URL="$PG_SERVER_URL/$BACKUP_VERIFY_DB_NAME"
MAINTENANCE_DATABASE_URL="${BACKUP_MAINTENANCE_DATABASE_URL:-$PG_SERVER_URL/postgres}"

if [ "$SCRATCH_DATABASE_URL" = "$PG_DATABASE_URL" ]; then
  printf '[verify FAIL] The scratch connection resolves to the production database.\n' >&2
  exit 2
fi

drop_scratch_database() {
  # Re-guard on every drop: this command is the only destructive statement in
  # the file and it must be impossible to aim it anywhere else.
  require_verify_database_name "$BACKUP_VERIFY_DB_NAME" || return 1
  psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$BACKUP_VERIFY_DB_NAME\";" > /dev/null 2>&1 || return 1
  return 0
}

cleanup() {
  if [ "$SCRATCH_CREATED" = "1" ]; then
    if drop_scratch_database; then
      note "scratch database dropped: $BACKUP_VERIFY_DB_NAME"
    else
      warn "scratch database $BACKUP_VERIFY_DB_NAME could not be dropped — drop it by hand."
    fi
  fi
  [ -n "$STAGING_DIR" ] && rm -rf "$STAGING_DIR"
  [ -n "$DRILL_DIR" ] && rm -rf "$DRILL_DIR"
  return 0
}
trap cleanup EXIT

for tool in age psql pg_restore shasum tar; do
  command -v "$tool" > /dev/null 2>&1 || {
    printf '[verify FAIL] %s is not installed or not on PATH.\n' "$tool" >&2
    record_status nightlyVerify failed "$tool is not installed on this machine"
    exit 1
  }
done

if [ -z "${BACKUP_VERIFY_IDENTITY_FILE:-}" ] || [ ! -f "${BACKUP_VERIFY_IDENTITY_FILE:-}" ]; then
  warn "BACKUP_VERIFY_IDENTITY_FILE is not configured; the unattended proof cannot decrypt an archive."
  record_status nightlyVerify skipped "verify identity is not configured (runbook 7b)"
  exit 3
fi

IDENTITY_MODE="$(stat -f '%Lp' "$BACKUP_VERIFY_IDENTITY_FILE" 2>/dev/null || stat -c '%a' "$BACKUP_VERIFY_IDENTITY_FILE")"
if [ "$IDENTITY_MODE" != "600" ] && [ "$IDENTITY_MODE" != "400" ]; then
  warn "verify identity mode is $IDENTITY_MODE; expected 0600. Fix with chmod 600."
fi

# ── The proof ────────────────────────────────────────────────────────────────
# verify_one <stage> <archive-path> <source-label>
# Prints "key=value" facts on stdout, one per line, and returns nonzero with a
# short reason on stderr. Never writes outside its own staging directory.
VERIFY_FACTS=""
VERIFY_ERROR=""

verify_one() {
  local stage="$1"
  local archive="$2"
  local source_label="$3"

  VERIFY_FACTS=""
  VERIFY_ERROR=""

  if [ ! -f "$archive" ]; then
    VERIFY_ERROR="archive not found: $(basename "$archive")"
    return 1
  fi

  STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/backup-verify.XXXXXX")"
  chmod 700 "$STAGING_DIR"

  if ! age --decrypt --identity "$BACKUP_VERIFY_IDENTITY_FILE" "$archive" |
    tar -C "$STAGING_DIR" -xf - 2> "$STAGING_DIR/decrypt.err"; then
    VERIFY_ERROR="decrypt or extract failed: $(tail -n 2 "$STAGING_DIR/decrypt.err" 2> /dev/null | tr '\n' ' ')"
    return 1
  fi

  if ! (cd "$STAGING_DIR" && shasum -a 256 -c manifest.sha256 > /dev/null 2>&1); then
    VERIFY_ERROR="manifest verification failed"
    return 1
  fi

  # Refuse to restore a stale scratch database left behind by a crashed run.
  drop_scratch_database > /dev/null 2>&1 || true

  if ! psql "$MAINTENANCE_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "CREATE DATABASE \"$BACKUP_VERIFY_DB_NAME\";" > "$STAGING_DIR/createdb.err" 2>&1; then
    VERIFY_ERROR="could not create the scratch database: $(tail -n 2 "$STAGING_DIR/createdb.err" 2> /dev/null | tr '\n' ' ')"
    return 1
  fi
  SCRATCH_CREATED=1

  local existing_tables
  existing_tables="$(psql "$SCRATCH_DATABASE_URL" -Atc \
    "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public';" 2> /dev/null || printf 'x')"
  if [ "$existing_tables" != "0" ]; then
    VERIFY_ERROR="scratch database is not empty"
    return 1
  fi

  if ! pg_restore --exit-on-error --no-owner --no-privileges \
    --dbname "$SCRATCH_DATABASE_URL" "$STAGING_DIR/database.dump" \
    > "$STAGING_DIR/restore.err" 2>&1; then
    VERIFY_ERROR="pg_restore failed: $(tail -n 2 "$STAGING_DIR/restore.err" 2> /dev/null | tr '\n' ' ')"
    return 1
  fi

  local entry table fact_name count
  for entry in $BACKUP_VERIFY_TABLES; do
    table="${entry%%:*}"
    fact_name="${entry##*:}"

    case "$table" in
      *[!a-z0-9_]*)
        VERIFY_ERROR="unsupported table name in BACKUP_VERIFY_TABLES"
        return 1
        ;;
    esac

    count="$(psql "$SCRATCH_DATABASE_URL" -Atc "SELECT COUNT(*) FROM \"$table\";" 2> /dev/null || printf '')"
    case "$count" in
      '' | *[!0-9]*)
        VERIFY_ERROR="table $table is missing from the restored archive"
        return 1
        ;;
    esac
    if [ "$count" -le 0 ]; then
      VERIFY_ERROR="table $table restored with zero rows"
      return 1
    fi

    VERIFY_FACTS="$VERIFY_FACTS $fact_name=$count"
  done

  local created_at
  created_at="$(sed -n 's/^createdAt=//p' "$STAGING_DIR/backup-info.txt" 2> /dev/null | head -n 1)"

  VERIFY_FACTS="$VERIFY_FACTS archiveName=$(basename "$archive") source=$source_label manifest=verified"
  [ -n "$created_at" ] && VERIFY_FACTS="$VERIFY_FACTS archiveCreatedAt=$created_at"

  if drop_scratch_database; then
    SCRATCH_CREATED=0
  fi

  rm -rf "$STAGING_DIR"
  STAGING_DIR=""
  return 0
}

# record_verify <stage> <status> <detail>  — facts come from $VERIFY_FACTS
record_verify() {
  local stage="$1"
  local status="$2"
  local detail="$3"
  # shellcheck disable=SC2086
  record_status "$stage" "$status" "$detail" $VERIFY_FACTS
}

EXIT_CODE=0

# ── Nightly: the newest LOCAL archive ────────────────────────────────────────
if [ "$RUN_LOCAL" = "1" ]; then
  if [ -n "$EXPLICIT_ARCHIVE" ]; then
    LOCAL_ARCHIVE="$EXPLICIT_ARCHIVE"
  else
    [ -n "${BACKUP_DIR:-}" ] || {
      printf '[verify FAIL] BACKUP_DIR is missing.\n' >&2
      record_status nightlyVerify failed "BACKUP_DIR is not configured"
      exit 1
    }
    LOCAL_ARCHIVE="$(newest_archive "$BACKUP_DIR")"
  fi

  if [ -z "$LOCAL_ARCHIVE" ]; then
    printf '[verify FAIL] No archive found in %s — is the backup volume mounted?\n' "${BACKUP_DIR:-}" >&2
    record_status nightlyVerify failed "no archive found in the backup directory"
    EXIT_CODE=1
  else
    note "restoring $(basename "$LOCAL_ARCHIVE") into $BACKUP_VERIFY_DB_NAME"
    if verify_one nightlyVerify "$LOCAL_ARCHIVE" local; then
      record_verify nightlyVerify ok ""
      note "nightly restore proof passed:$VERIFY_FACTS"
    else
      printf '[verify FAIL] %s\n' "$VERIFY_ERROR" >&2
      record_verify nightlyVerify failed "$VERIFY_ERROR"
      EXIT_CODE=1
    fi
  fi
fi

# ── The cloud drill: the same proof, from OSS bytes ──────────────────────────
# Scheduled by AGE, not by calendar day. See cloud_drill_due() in backup-lib.sh:
# the drill runs whenever the last successful drill is older than
# BACKUP_DRILL_MAX_AGE_DAYS (default 30) or has never happened, and is retried
# on the next nightly run until it succeeds.
if [ "$RUN_DRILL" = "auto" ]; then
  if [ "$(cloud_drill_due)" = "run" ]; then
    RUN_DRILL=1
  else
    RUN_DRILL=0
  fi
fi

if [ "$RUN_DRILL" = "1" ]; then
  if ! command -v rclone > /dev/null 2>&1; then
    warn "rclone is not installed; the cloud drill did not run. See runbook 7b."
    record_status cloudDrill unconfigured "rclone is not installed on this machine"
  elif [ -z "${BACKUP_OSS_REMOTE:-}" ] || [ -z "${BACKUP_OSS_BUCKET:-}" ]; then
    warn "cloud leg not configured; the cloud drill did not run."
    record_status cloudDrill unconfigured "OSS remote or bucket is not configured"
  else
    DRILL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/backup-drill.XXXXXX")"
    chmod 700 "$DRILL_DIR"

    RCLONE_BASE=()
    if [ -n "${BACKUP_RCLONE_CONFIG:-}" ]; then
      RCLONE_BASE=(--config "$BACKUP_RCLONE_CONFIG")
    fi

    DRILL_LOG="$DRILL_DIR/rclone.log"
    REMOTE_ARCHIVE="$(rclone "${RCLONE_BASE[@]+"${RCLONE_BASE[@]}"}" lsf --files-only \
      "$BACKUP_OSS_DESTINATION/" 2> "$DRILL_LOG" |
      grep "^$BACKUP_ARCHIVE_PREFIX" | LC_ALL=C sort | tail -n 1 || true)"

    if [ -z "$REMOTE_ARCHIVE" ]; then
      DRILL_ERROR="$(tail -n 5 "$DRILL_LOG" 2> /dev/null | tr '\n' ' ')"
      if is_offline_error "$DRILL_ERROR"; then
        warn "cloud drill skipped: this machine appears to be offline."
        record_status cloudDrill offline "$DRILL_ERROR"
      else
        printf '[verify FAIL] no archive listed under %s: %s\n' "$BACKUP_OSS_DESTINATION" "$DRILL_ERROR" >&2
        record_status cloudDrill failed "no archive listed under the app prefix: $DRILL_ERROR"
        EXIT_CODE=1
      fi
    elif ! rclone "${RCLONE_BASE[@]+"${RCLONE_BASE[@]}"}" copy \
      "$BACKUP_OSS_DESTINATION/$REMOTE_ARCHIVE" "$DRILL_DIR/" --no-traverse \
      > "$DRILL_LOG" 2>&1; then
      DRILL_ERROR="$(tail -n 5 "$DRILL_LOG" 2> /dev/null | tr '\n' ' ')"
      if is_offline_error "$DRILL_ERROR"; then
        warn "cloud drill skipped: this machine appears to be offline."
        record_status cloudDrill offline "$DRILL_ERROR"
      else
        printf '[verify FAIL] cloud download failed: %s\n' "$DRILL_ERROR" >&2
        record_status cloudDrill failed "$DRILL_ERROR"
        EXIT_CODE=1
      fi
    else
      # These bytes came down the wire into a fresh temporary directory. The
      # local backup disk is not in this path, so a drill cannot silently pass
      # on a cached local copy.
      DRILL_ARCHIVE="$DRILL_DIR/$REMOTE_ARCHIVE"
      case "$DRILL_ARCHIVE" in
        "${BACKUP_DIR:-/nonexistent}"/*)
          printf '[verify FAIL] The drill archive resolved onto the local backup disk.\n' >&2
          record_status cloudDrill failed "drill archive resolved onto the local backup disk"
          EXIT_CODE=1
          ;;
        *)
          note "cloud drill: restoring $REMOTE_ARCHIVE pulled from $BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX"
          if verify_one cloudDrill "$DRILL_ARCHIVE" oss; then
            record_verify cloudDrill ok ""
            note "cloud drill passed:$VERIFY_FACTS"
          else
            printf '[verify FAIL] %s\n' "$VERIFY_ERROR" >&2
            record_verify cloudDrill failed "$VERIFY_ERROR"
            EXIT_CODE=1
          fi
          ;;
      esac
    fi
  fi
fi

exit "$EXIT_CODE"
