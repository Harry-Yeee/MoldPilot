# shellcheck shell=bash
#
# ─────────────────────────────────────────────────────────────────────────────
#  APP IDENTITY BLOCK — the only application-specific configuration in the
#  Backup v2 chain. scripts/backup.sh and scripts/backup-verify.sh contain no
#  application name at all; they read everything from here.
#
#  ESTATE CONVENTION (security-hardening-runbook.md §7b):
#    ONE Aliyun OSS bucket for the whole estate, ONE 30-day locked WORM policy,
#    ONE lifecycle policy (four rules). Per app: a prefix, a prefix-scoped,
#    no-delete (Put/Get/List) RAM key, a status file, and an admin health widget.
#
#  ONBOARDING THE NEXT APP (SupplyDesk / ClientView / Warehouse):
#    copy this file into that app's scripts/, change the five values in the
#    "App identity" section, create its OSS prefix + RAM key. Never edit the
#    logic in backup.sh / backup-verify.sh.
#
#  Sourced, never executed. The caller must define PROJECT_ROOT first, and
#  should source its .env BEFORE this file so .env values win: every setting
#  below uses ${VAR:-default}, so anything already exported takes precedence.
# ─────────────────────────────────────────────────────────────────────────────

# ── App identity ─────────────────────────────────────────────────────────────
# Short lowercase slug. Names the archive, the recovery config inside it, the
# OSS prefix, and the `app` field of the status JSON.
BACKUP_APP_NAME="${BACKUP_APP_NAME:-moldpilot}"

# Human/product spelling. Only used for the macOS Application Support folder
# that holds the legacy `last-success` breadcrumb.
BACKUP_APP_DISPLAY_NAME="${BACKUP_APP_DISPLAY_NAME:-MoldPilot}"

# PostgreSQL database that gets dumped, and the role used by the Docker
# fallback path in backup.sh.
BACKUP_APP_DB_NAME="${BACKUP_APP_DB_NAME:-moldpilot}"
BACKUP_APP_DB_USER="${BACKUP_APP_DB_USER:-$BACKUP_APP_DB_NAME}"

# Released attachment storage. Also the default home of the status file, so the
# health JSON rides off-machine inside the nightly archive.
BACKUP_APP_STORAGE_DIR="${BACKUP_APP_STORAGE_DIR:-${MOLDPILOT_STORAGE_DIR:-$PROJECT_ROOT/storage/uploads}}"

# Object prefix inside the estate bucket. One per app, never shared.
BACKUP_OSS_PREFIX="${BACKUP_OSS_PREFIX:-$BACKUP_APP_NAME}"

# Health file the admin page reads. Written atomically by scripts/backup-status.mjs.
BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-$BACKUP_APP_STORAGE_DIR/backup-status.json}"

# Legacy escape hatch: allow a non-/Volumes BACKUP_DIR (development only).
BACKUP_ALLOW_LOCAL="${BACKUP_ALLOW_LOCAL:-${MOLDPILOT_ALLOW_LOCAL_BACKUP:-}}"

# ── Estate-wide settings (identical in every app) ─────────────────────────────
# rclone remote name configured on the mini (`rclone config`, type: s3,
# provider: Alibaba). The remote holds the app's prefix-scoped, no-delete
# (Put/Get/List) RAM key.
BACKUP_OSS_REMOTE="${BACKUP_OSS_REMOTE:-ljerp-oss}"
# One bucket for the estate. Versioning ON, compliance retention 30 days LOCKED,
# and one lifecycle policy of four rules (current versions expire at 180 days,
# noncurrent at 30, expired delete markers cleaned, incomplete multipart uploads
# aborted at 7 days). All of it is set from the owner's laptop with root/admin
# credentials — never from the mini.
BACKUP_OSS_BUCKET="${BACKUP_OSS_BUCKET:-lj-erp-backups}"

# ── Derived — do not edit when onboarding an app ──────────────────────────────
BACKUP_ARCHIVE_PREFIX="${BACKUP_ARCHIVE_PREFIX:-$BACKUP_APP_NAME-backup-}"
BACKUP_ARCHIVE_SUFFIX="${BACKUP_ARCHIVE_SUFFIX:-.tar.age}"
BACKUP_ARCHIVE_GLOB="$BACKUP_ARCHIVE_PREFIX*$BACKUP_ARCHIVE_SUFFIX"
BACKUP_OSS_DESTINATION="$BACKUP_OSS_REMOTE:$BACKUP_OSS_BUCKET/$BACKUP_OSS_PREFIX"

# Scratch database for the nightly restore proof. The name must end in
# `_verify` or `_verify_scratch`; backup-verify.sh refuses anything else, so a
# typo can never point the drop at production.
BACKUP_VERIFY_DB_NAME="${BACKUP_VERIFY_DB_NAME:-${BACKUP_APP_DB_NAME}_verify_scratch}"

# Tables the nightly verify asserts are non-empty, and the human label used in
# the log line. Change these with the app, not the logic.
BACKUP_VERIFY_TABLES="${BACKUP_VERIFY_TABLES:-users:userCount mold_trial_projects:projectCount}"

# Helper used by both legs to reach the shared status writer.
BACKUP_STATUS_WRITER="${BACKUP_STATUS_WRITER:-$PROJECT_ROOT/scripts/backup-status.mjs}"

# Pre-v2 breadcrumb, kept because it HAS a reader outside this repo: the
# platform's ops/docker/backup/native-inventory.sh computes "backup age" from
# the mtime of
#   $HOME/Library/Application Support/MoldPilot/backup-status/last-success
# (overridable there via MOLDPILOT_NATIVE_BACKUP_STATUS_FILE). Moving it under
# MOLDPILOT_STORAGE_DIR would silently report "no backup" to the D3 inventory,
# so the Application Support default stays until that reader moves with it.
# Any harness MUST override this — it is the one path in this config that
# defaults outside the app's own storage directory.
BACKUP_LEGACY_STATUS_DIR="${BACKUP_LEGACY_STATUS_DIR:-$HOME/Library/Application Support/$BACKUP_APP_DISPLAY_NAME/backup-status}"

# Cloud drill cadence. The drill runs when the last SUCCESSFUL drill is older
# than this many days (or has never run), retried nightly until it passes —
# never on a fixed day of the month. See cloud_drill_due() in backup-lib.sh.
BACKUP_DRILL_MAX_AGE_DAYS="${BACKUP_DRILL_MAX_AGE_DAYS:-30}"
