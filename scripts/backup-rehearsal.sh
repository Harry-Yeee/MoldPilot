#!/usr/bin/env bash
#
# Backup v2 rehearsal — exercises the whole pipeline against a FAKE environment.
#
# WHAT THIS IS: a self-contained harness that runs scripts/backup.sh and
# scripts/backup-verify.sh end to end inside a throwaway temporary directory,
# with stand-in `rclone`, `age`, `pg_dump`, `psql` and `pg_restore` binaries on
# PATH. It proves the CONTROL FLOW of the chain: which status the pipeline
# records at each stage, which exit code it returns, that the upload command is
# `copy` and never `sync`, that a bad scratch-database name is refused, and that
# nothing secret reaches the status file.
#
# WHAT THIS IS NOT: proof that backups work. It touches no PostgreSQL server,
# no age key, no mounted disk and no OSS bucket. The four real acceptance
# tests — immutability, nightly restore, cloud drill, kill-switch — are run by
# hand on the Mac mini and are written up in
# docs/08-rollout/security-hardening-runbook.md §7b "Acceptance".
#
# HERMETICITY: every writable path the chain can reach is redirected into the
# temp root — including HOME, TMPDIR, the environment file the scripts source,
# and BACKUP_LEGACY_STATUS_DIR, which is the one config default that points
# outside the app's storage directory (~/Library/Application Support). The last
# scenario asserts that nothing outside the temp root was created or modified.
#
#   bash scripts/backup-rehearsal.sh          # run every scenario
#   bash scripts/backup-rehearsal.sh --keep   # keep the temp tree for inspection
#   pnpm backup:rehearse                      # the same thing, one command

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

REAL_HOME="$HOME"
REAL_TMPDIR="${TMPDIR:-/tmp}"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/backup-rehearsal.XXXXXX")"
case "$ROOT" in
  "$PROJECT_ROOT" | "$PROJECT_ROOT"/*)
    printf 'The rehearsal root must live outside the repository.\n' >&2
    exit 2
    ;;
esac

BIN="$ROOT/bin"
BACKUP_ROOT="$ROOT/FactoryBackup"
STORAGE_ROOT="$ROOT/storage"
BUCKET_ROOT="$ROOT/oss"
ARGV_LOG="$ROOT/argv.log"
STATUS_FILE="$STORAGE_ROOT/backup-status.json"
FAKE_HOME="$ROOT/home"
FAKE_TMP="$ROOT/tmp"
LEGACY_STATUS_ROOT="$ROOT/legacy-status"
FAKE_ENV_FILE="$ROOT/rehearsal.env"
mkdir -p "$BIN" "$BACKUP_ROOT" "$STORAGE_ROOT" "$BUCKET_ROOT" "$FAKE_HOME" "$FAKE_TMP"
: > "$ARGV_LOG"
# An EMPTY env file: sourcing the operator's real .env would override the
# exported values below and could aim this rehearsal at a production disk.
: > "$FAKE_ENV_FILE"

# The clock reference for the hermeticity check. Every file the run is allowed
# to touch lives under $ROOT; anything else newer than this marker is a leak.
HERMETIC_MARKER="$ROOT/.hermetic-marker"
: > "$HERMETIC_MARKER"

PASSED=0
FAILED=0

pass() {
  PASSED=$((PASSED + 1))
  printf '  PASS  %s\n' "$*"
}

miss() {
  FAILED=$((FAILED + 1))
  printf '  FAIL  %s\n' "$*"
}

scenario() {
  printf '\n== %s\n' "$*"
}

expect_eq() {
  if [ "$2" = "$3" ]; then pass "$1 ($3)"; else miss "$1 — expected '$3', got '$2'"; fi
}

expect_contains() {
  case "$2" in
    *"$3"*) pass "$1" ;;
    *) miss "$1 — '$3' not found" ;;
  esac
}

expect_absent() {
  case "$2" in
    *"$3"*) miss "$1 — '$3' should not be present" ;;
    *) pass "$1" ;;
  esac
}

# set_drill_age <days-ago|never> — rewrite the recorded cloud-drill success so
# the age-based scheduler can be driven without waiting a month.
set_drill_age() {
  node -e '
const fs = require("node:fs");
const [file, ageArgument] = process.argv.slice(1);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const drill = doc.stages.cloudDrill;
if (ageArgument === "never") {
  drill.status = "never";
  drill.at = null;
  drill.lastSuccessAt = null;
} else {
  const when = new Date(Date.now() - Number(ageArgument) * 86_400_000).toISOString();
  drill.status = "ok";
  drill.at = when;
  drill.lastSuccessAt = when;
}
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
' "$STATUS_FILE" "$1"
}

json() {
  node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.stdout.write("<unreadable>"); process.exit(0); }
let value = doc;
for (const key of process.argv[2].split(".")) { value = value == null ? undefined : value[key]; }
process.stdout.write(value === undefined ? "<missing>" : String(value));
' "$STATUS_FILE" "$1"
}

# ── Fake binaries ────────────────────────────────────────────────────────────
cat > "$BIN/age" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'age %s\n' "$*" >> "$REHEARSAL_ARGV_LOG"
mode=encrypt
out=""
file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --decrypt | -d) mode=decrypt ;;
    --identity | -i | --recipient | -r) shift ;;
    --output | -o)
      shift
      out="$1"
      ;;
    -*) ;;
    *) file="$1" ;;
  esac
  shift
done
# The rehearsal "cipher" is the identity function: the archive is the tar
# stream. Real archives are age-encrypted; the control flow is identical.
if [ "$mode" = encrypt ]; then cat > "$out"; else cat "$file"; fi
SHIM

cat > "$BIN/pg_dump" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'pg_dump %s\n' "$*" >> "$REHEARSAL_ARGV_LOG"
out=""
for arg in "$@"; do
  case "$arg" in --file=*) out="${arg#--file=}" ;; esac
done
[ -n "$out" ] || exit 1
[ "${REHEARSAL_PG_DUMP_MODE:-ok}" = "ok" ] || exit 1
head -c 20480 /dev/zero | tr '\0' 'D' > "$out"
SHIM

cat > "$BIN/psql" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'psql %s\n' "$*" >> "$REHEARSAL_ARGV_LOG"
query=""
previous=""
for arg in "$@"; do
  case "$previous" in -c | -Atc) query="$arg" ;; esac
  previous="$arg"
done
case "$query" in
  *pg_tables*) printf '0\n' ;;
  *'FROM "users"'*) printf '%s\n' "${REHEARSAL_USER_ROWS:-12}" ;;
  *'FROM "mold_trial_projects"'*) printf '%s\n' "${REHEARSAL_PROJECT_ROWS:-34}" ;;
esac
SHIM

cat > "$BIN/pg_restore" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'pg_restore %s\n' "$*" >> "$REHEARSAL_ARGV_LOG"
[ "${REHEARSAL_RESTORE_MODE:-ok}" = "ok" ] || {
  printf 'pg_restore: error: could not read from input file\n' >&2
  exit 1
}
SHIM

cat > "$BIN/rclone" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
printf 'rclone %s\n' "$*" >> "$REHEARSAL_ARGV_LOG"

case "${REHEARSAL_RCLONE_MODE:-ok}" in
  offline)
    printf 'ERROR : attempt 1/3 failed: dial tcp: lookup oss-cn-shenzhen.aliyuncs.com: no such host\n' >&2
    exit 1
    ;;
  error)
    # Deliberately carries a credential-shaped token so the harness can prove
    # the status writer redacts it.
    printf 'ERROR : Failed to copy: AccessDenied: you have no right to access this object AccessKeySecret=SUPERSECRETVALUE\n' >&2
    exit 1
    ;;
esac

subcommand=""
first=""
second=""
immutable=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      shift
      ;;
    --immutable) immutable=1 ;;
    --*) ;;
    *)
      if [ -z "$subcommand" ]; then
        subcommand="$1"
      elif [ -z "$first" ]; then
        first="$1"
      elif [ -z "$second" ]; then
        second="$1"
      fi
      ;;
  esac
  shift
done

resolve() {
  case "$1" in
    *:*) printf '%s/%s' "$REHEARSAL_BUCKET_ROOT" "${1#*:}" ;;
    *) printf '%s' "$1" ;;
  esac
}

case "$subcommand" in
  sync)
    printf 'REHEARSAL VIOLATION: the pipeline invoked `rclone sync`.\n' >&2
    exit 9
    ;;
  copy | copyto)
    source_path="$(resolve "$first")"
    target_path="$(resolve "$second")"
    mkdir -p "$target_path"
    target_file="$target_path/$(basename "$source_path")"
    if [ "$immutable" = "1" ] && [ -e "$target_file" ] &&
      ! cmp -s "$source_path" "$target_file"; then
      printf 'ERROR : Source and destination exist but do not match: immutable file modified\n' >&2
      exit 1
    fi
    cp "$source_path" "$target_file"
    ;;
  lsf)
    listing_path="$(resolve "$first")"
    [ -d "$listing_path" ] && ls -1 "$listing_path" || true
    ;;
  delete | deletefile | purge | rmdirs)
    # The RAM key is prefix-scoped and no-delete (Put/Get/List only). This is
    # what a delete attempt looks like against it.
    printf 'ERROR : Failed to delete: AccessDenied: You have no right to access this object because of bucket acl.\n' >&2
    exit 1
    ;;
  listremotes) printf 'ljerp-oss:\n' ;;
  *) ;;
esac
SHIM

chmod +x "$BIN"/*

export REHEARSAL_ARGV_LOG="$ARGV_LOG"
export REHEARSAL_BUCKET_ROOT="$BUCKET_ROOT"
export PATH="$BIN:$PATH"

# ── Hermetic environment: nothing may resolve outside $ROOT ───────────────────
# HOME and TMPDIR come first because they are the implicit roots: HOME feeds the
# BACKUP_LEGACY_STATUS_DIR default (~/Library/Application Support/...) and
# TMPDIR feeds every `mktemp -d` in the chain.
export HOME="$FAKE_HOME"
export TMPDIR="$FAKE_TMP"
export BACKUP_ENV_FILE="$FAKE_ENV_FILE"
export BACKUP_LEGACY_STATUS_DIR="$LEGACY_STATUS_ROOT"

# ── The fake app's identity, exactly as the estate convention prescribes ──────
export BACKUP_DIR="$BACKUP_ROOT"
export BACKUP_ALLOW_LOCAL=1
export BACKUP_AGE_RECIPIENT="age1rehearsalrecipientnotarealkey"
export BACKUP_VERIFY_RECIPIENT="age1rehearsalverifyrecipientnotarealkey"
export BACKUP_APP_STORAGE_DIR="$STORAGE_ROOT"
export BACKUP_STATUS_FILE="$STATUS_FILE"
export BACKUP_OSS_REMOTE="ljerp-oss"
export BACKUP_OSS_BUCKET="lj-erp-backups"
export BACKUP_OSS_PREFIX="rehearsal-app"
export BACKUP_RCLONE_CONFIG="$ROOT/rclone.conf"
export DATABASE_URL="postgresql://rehearsal@127.0.0.1:5432/rehearsal"
: > "$ROOT/rclone.conf"

VERIFY_IDENTITY="$ROOT/verify-identity.txt"
printf 'AGE-SECRET-KEY-REHEARSALNOTAREALKEY\n' > "$VERIFY_IDENTITY"
chmod 600 "$VERIFY_IDENTITY"
export BACKUP_VERIFY_IDENTITY_FILE="$VERIFY_IDENTITY"

printf 'Rehearsal root: %s\n' "$ROOT"

# ── 1. Happy path: archive + off-site copy ───────────────────────────────────
scenario "1. Local archive + off-site copy succeed"
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run1.log" 2>&1
expect_eq "backup.sh exits 0" "$?" "0"
expect_eq "localArchive status" "$(json stages.localArchive.status)" "ok"
expect_eq "cloudUpload status" "$(json stages.cloudUpload.status)" "ok"
expect_eq "upload failure streak reset" "$(json stages.cloudUpload.consecutiveFailures)" "0"
expect_eq "status app identity" "$(json app)" "moldpilot"
expect_eq "status schema" "$(json schema)" "lj-erp-backup-status-v1"
expect_contains "localArchive records the archive name" "$(json stages.localArchive.facts.archiveName)" "moldpilot-backup-"
[ "$(json stages.localArchive.facts.sizeBytes)" -gt 20480 ] &&
  pass "localArchive records a plausible size" ||
  miss "localArchive size is missing or too small"
expect_eq "cloudUpload destination" "$(json stages.cloudUpload.facts.destination)" "lj-erp-backups/rehearsal-app"
expect_contains "the upload used rclone copy" "$(cat "$ARGV_LOG")" "copy $BACKUP_ROOT/moldpilot-backup-"
expect_contains "the upload used the pinned rclone config" "$(cat "$ARGV_LOG")" "--config $ROOT/rclone.conf"
expect_absent "the upload never used rclone sync" "$(cat "$ARGV_LOG")" "rclone sync"
expect_absent "the upload never used rclone delete" "$(cat "$ARGV_LOG")" "rclone delete"
UPLOADED="$(ls -1 "$BUCKET_ROOT/lj-erp-backups/rehearsal-app" 2> /dev/null | head -1)"
expect_contains "the archive reached the bucket prefix" "$UPLOADED" "moldpilot-backup-"
LEFTOVER="$(find "$STORAGE_ROOT" -name '.backup-status.json.tmp.*' | wc -l | tr -d ' ')"
expect_eq "no temp status file left behind (atomic rename)" "$LEFTOVER" "0"
expect_absent "status file holds no age recipient" "$(cat "$STATUS_FILE")" "age1rehearsal"
expect_absent "status file holds no DATABASE_URL" "$(cat "$STATUS_FILE")" "postgresql://"

# ── 2. Offline tolerance ─────────────────────────────────────────────────────
scenario "2. The mini is offline — tolerated, recorded, exit 0"
sleep 1
REHEARSAL_RCLONE_MODE=offline bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run2.log" 2>&1
expect_eq "backup.sh still exits 0" "$?" "0"
expect_eq "localArchive still ok" "$(json stages.localArchive.status)" "ok"
expect_eq "cloudUpload records offline" "$(json stages.cloudUpload.status)" "offline"
expect_eq "failure streak advanced to 1" "$(json stages.cloudUpload.consecutiveFailures)" "1"
expect_contains "offline detail names the cause" "$(json stages.cloudUpload.detail)" "no such host"

# ── 3. A genuine upload failure ──────────────────────────────────────────────
scenario "3. The bucket refuses the object — nonzero exit, redacted detail"
sleep 1
REHEARSAL_RCLONE_MODE=error bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run3.log" 2>&1
expect_eq "backup.sh exits nonzero" "$?" "1"
expect_eq "localArchive still ok" "$(json stages.localArchive.status)" "ok"
expect_eq "cloudUpload records failed" "$(json stages.cloudUpload.status)" "failed"
expect_eq "failure streak advanced to 2" "$(json stages.cloudUpload.consecutiveFailures)" "2"
expect_contains "detail keeps the actionable part" "$(json stages.cloudUpload.detail)" "AccessDenied"
expect_absent "detail redacts the credential" "$(cat "$STATUS_FILE")" "SUPERSECRETVALUE"
expect_contains "detail shows the redaction" "$(json stages.cloudUpload.detail)" "redacted"

# ── 4. Kill switch: the backup disk is gone ──────────────────────────────────
# Two ways the mounted destination can vanish, and both must land in the status
# file rather than pass quietly.
scenario "4a. The destination cannot be created — local failure recorded"
printf 'not a directory\n' > "$ROOT/not-mounted"
BACKUP_DIR="$ROOT/not-mounted/FactoryBackup" \
  bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run4a.log" 2>&1
RUN4A_EXIT=$?
rm -f "$ROOT/not-mounted"
expect_eq "backup.sh exits nonzero" "$RUN4A_EXIT" "1"
expect_eq "localArchive records failed" "$(json stages.localArchive.status)" "failed"
expect_contains "detail points at the volume" "$(json stages.localArchive.detail)" "volume"

scenario "4b. The destination is not an off-machine volume — refused"
env -u BACKUP_ALLOW_LOCAL bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run4b.log" 2>&1
expect_eq "backup.sh exits nonzero" "$?" "1"
expect_eq "localArchive records failed" "$(json stages.localArchive.status)" "failed"
expect_contains "detail names the /Volumes rule" "$(json stages.localArchive.detail)" "/Volumes"

# ── 5. rclone missing entirely ───────────────────────────────────────────────
scenario "5. rclone is not installed — honest 'unconfigured', not silence"
mv "$BIN/rclone" "$ROOT/rclone.parked"
sleep 1
bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run5.log" 2>&1
expect_eq "backup.sh exits 0" "$?" "0"
expect_eq "cloudUpload records unconfigured" "$(json stages.cloudUpload.status)" "unconfigured"
expect_contains "detail says why" "$(json stages.cloudUpload.detail)" "rclone is not installed"
mv "$ROOT/rclone.parked" "$BIN/rclone"

# ── 6. Nightly restore proof ─────────────────────────────────────────────────
scenario "6. Nightly verify restores the newest local archive"
bash "$PROJECT_ROOT/scripts/backup-verify.sh" --local > "$ROOT/run6.log" 2>&1
expect_eq "backup-verify.sh exits 0" "$?" "0"
expect_eq "nightlyVerify status" "$(json stages.nightlyVerify.status)" "ok"
expect_eq "restored user rows" "$(json stages.nightlyVerify.facts.userCount)" "12"
expect_eq "restored project rows" "$(json stages.nightlyVerify.facts.projectCount)" "34"
expect_eq "manifest verified" "$(json stages.nightlyVerify.facts.manifest)" "verified"
expect_eq "source is the local disk" "$(json stages.nightlyVerify.facts.source)" "local"
expect_contains "scratch database was created" "$(cat "$ARGV_LOG")" 'CREATE DATABASE "moldpilot_verify_scratch"'
expect_contains "scratch database was dropped" "$(cat "$ARGV_LOG")" 'DROP DATABASE IF EXISTS "moldpilot_verify_scratch"'
expect_absent "production database was never dropped" "$(cat "$ARGV_LOG")" 'DROP DATABASE IF EXISTS "moldpilot"'

# ── 7. The scratch-name guard ────────────────────────────────────────────────
scenario "7. A scratch database name without the _verify marker is refused"
: > "$ARGV_LOG"
GUARD_OUTPUT="$(BACKUP_VERIFY_DB_NAME=moldpilot bash "$PROJECT_ROOT/scripts/backup-verify.sh" --local 2>&1)"
expect_eq "exit code is 2 (refused before connecting)" "$?" "2"
expect_contains "the refusal names the rule" "$GUARD_OUTPUT" "must end in _verify"
expect_eq "no command was run against any database" "$(wc -l < "$ARGV_LOG" | tr -d ' ')" "0"
for BAD_NAME in moldpilot moldpilot_production postgres verify_moldpilot moldpilot_verifyx template1; do
  : > "$ARGV_LOG"
  BACKUP_VERIFY_DB_NAME="$BAD_NAME" bash "$PROJECT_ROOT/scripts/backup-verify.sh" --local > /dev/null 2>&1
  BAD_EXIT=$?
  BAD_CALLS="$(wc -l < "$ARGV_LOG" | tr -d ' ')"
  if [ "$BAD_EXIT" = "2" ] && [ "$BAD_CALLS" = "0" ]; then
    pass "refused '$BAD_NAME' with no database contact"
  else
    miss "'$BAD_NAME' was not refused (exit $BAD_EXIT, $BAD_CALLS commands)"
  fi
done
for GOOD_NAME in moldpilot_verify moldpilot_verify_scratch supplydesk_verify_scratch; do
  : > "$ARGV_LOG"
  BACKUP_VERIFY_DB_NAME="$GOOD_NAME" bash "$PROJECT_ROOT/scripts/backup-verify.sh" --local > /dev/null 2>&1
  expect_eq "accepted '$GOOD_NAME'" "$?" "0"
done

# ── 8. Verify failure path ───────────────────────────────────────────────────
scenario "8. A restore that produces an empty table fails loudly"
REHEARSAL_USER_ROWS=0 bash "$PROJECT_ROOT/scripts/backup-verify.sh" --local > "$ROOT/run8.log" 2>&1
expect_eq "backup-verify.sh exits nonzero" "$?" "1"
expect_eq "nightlyVerify records failed" "$(json stages.nightlyVerify.status)" "failed"
expect_contains "detail names the empty table" "$(json stages.nightlyVerify.detail)" "zero rows"

# ── 9. Cloud drill from bucket bytes ─────────────────────────────────────────
scenario "9. Cloud drill restores bytes pulled from the bucket"
: > "$ARGV_LOG"
bash "$PROJECT_ROOT/scripts/backup-verify.sh" --cloud-drill > "$ROOT/run9.log" 2>&1
expect_eq "backup-verify.sh exits 0" "$?" "0"
expect_eq "cloudDrill status" "$(json stages.cloudDrill.status)" "ok"
expect_eq "source is the bucket" "$(json stages.cloudDrill.facts.source)" "oss"
expect_contains "the drill listed the app prefix" "$(cat "$ARGV_LOG")" "lsf --files-only ljerp-oss:lj-erp-backups/rehearsal-app/"
DRILL_TARGET="$(grep '^rclone .*copy ljerp-oss:' "$ARGV_LOG" | tail -1)"
expect_contains "the drill downloaded from the remote" "$DRILL_TARGET" "copy ljerp-oss:"
expect_absent "the drill did NOT read the local backup disk" "$DRILL_TARGET" "$BACKUP_ROOT"

# ── 10. Offline cloud drill ──────────────────────────────────────────────────
scenario "10. Cloud drill while offline — recorded, not a false failure"
REHEARSAL_RCLONE_MODE=offline bash "$PROJECT_ROOT/scripts/backup-verify.sh" --cloud-drill > "$ROOT/run10.log" 2>&1
expect_eq "backup-verify.sh exits 0" "$?" "0"
expect_eq "cloudDrill records offline" "$(json stages.cloudDrill.status)" "offline"

# ── 11. A corrupt status file must not stop the chain ────────────────────────
scenario "11. A corrupt status file is rewritten, not fatal"
printf '{ this is not json' > "$STATUS_FILE"
sleep 1
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup.sh" > "$ROOT/run11.log" 2>&1
expect_eq "backup.sh exits 0" "$?" "0"
expect_eq "status file is valid again" "$(json stages.localArchive.status)" "ok"

# ── 12. Age-based cloud-drill scheduling ─────────────────────────────────────
# The drill used to fire on a calendar day read in UTC, which on a Beijing-time
# machine is the wrong day and, when the mini was offline that night, skipped a
# whole month. It is now due whenever the last SUCCESSFUL drill is too old.
scenario "12. The cloud drill is scheduled by age, and retried until it passes"

drill_ran() {
  case "$(cat "$ARGV_LOG")" in
    *"lsf --files-only ljerp-oss:"*) printf 'yes' ;;
    *) printf 'no' ;;
  esac
}

# (a) never run → runs
set_drill_age never
: > "$ARGV_LOG"
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12a.log" 2>&1
expect_eq "never-run drill: exits 0" "$?" "0"
expect_eq "never-run drill: the drill ran" "$(drill_ran)" "yes"
expect_eq "never-run drill: recorded ok" "$(json stages.cloudDrill.status)" "ok"

# (b) it has just succeeded → skipped
: > "$ARGV_LOG"
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12b.log" 2>&1
expect_eq "fresh drill: exits 0" "$?" "0"
expect_eq "fresh drill: the drill was skipped" "$(drill_ran)" "no"
expect_contains "fresh drill: the reason is logged" "$(cat "$ROOT/run12b.log")" "not due yet"

# (c) older than BACKUP_DRILL_MAX_AGE_DAYS → runs again
set_drill_age 40
: > "$ARGV_LOG"
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12c.log" 2>&1
expect_eq "stale drill: exits 0" "$?" "0"
expect_eq "stale drill: the drill ran" "$(drill_ran)" "yes"

# (d) a drill that fails must be retried the NEXT night, not next month
set_drill_age 40
: > "$ARGV_LOG"
REHEARSAL_RCLONE_MODE=offline bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12d.log" 2>&1
expect_eq "failed drill: exits 0 (offline is tolerated)" "$?" "0"
expect_eq "failed drill: recorded offline" "$(json stages.cloudDrill.status)" "offline"
: > "$ARGV_LOG"
REHEARSAL_RCLONE_MODE=ok bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12e.log" 2>&1
expect_eq "next night: the drill is retried" "$(drill_ran)" "yes"
expect_eq "next night: the drill passes" "$(json stages.cloudDrill.status)" "ok"

# (e) the window is configurable, and a short one makes yesterday's drill due
set_drill_age 2
: > "$ARGV_LOG"
BACKUP_DRILL_MAX_AGE_DAYS=1 REHEARSAL_RCLONE_MODE=ok \
  bash "$PROJECT_ROOT/scripts/backup-verify.sh" > "$ROOT/run12f.log" 2>&1
expect_eq "BACKUP_DRILL_MAX_AGE_DAYS is honoured" "$(drill_ran)" "yes"
expect_absent "no calendar-day scheduling remains" "$(cat "$PROJECT_ROOT/scripts/backup-verify.sh")" "BACKUP_DRILL_DAY"

# ── 13. Two writers, one status file ─────────────────────────────────────────
# backup.sh and backup-verify.sh can overlap. Without the mkdir mutex both read
# the same document and the later rename silently drops the earlier stage.
scenario "13. Concurrent stage updates do not lose each other"
RACE_A_OK=1
RACE_B_OK=1
for ROUND in 1 2 3 4 5 6 7 8; do
  node "$PROJECT_ROOT/scripts/backup-status.mjs" --file "$STATUS_FILE" --app moldpilot \
    --stage localArchive --status ok --fact "raceA=$ROUND" > /dev/null 2>&1 &
  WRITER_A=$!
  node "$PROJECT_ROOT/scripts/backup-status.mjs" --file "$STATUS_FILE" --app moldpilot \
    --stage nightlyVerify --status ok --fact "raceB=$ROUND" > /dev/null 2>&1 &
  WRITER_B=$!
  wait "$WRITER_A" "$WRITER_B"
  [ "$(json stages.localArchive.facts.raceA)" = "$ROUND" ] || RACE_A_OK=0
  [ "$(json stages.nightlyVerify.facts.raceB)" = "$ROUND" ] || RACE_B_OK=0
done
expect_eq "every concurrent localArchive update survived" "$RACE_A_OK" "1"
expect_eq "every concurrent nightlyVerify update survived" "$RACE_B_OK" "1"
expect_eq "the status file is still valid JSON" "$(json schema)" "lj-erp-backup-status-v1"
LOCKS="$(find "$STORAGE_ROOT" -maxdepth 1 -name '.backup-status.json.lock' | wc -l | tr -d ' ')"
expect_eq "no lock directory left behind" "$LOCKS" "0"

# ── 14. Commissioning marker ─────────────────────────────────────────────────
scenario "14. The chain records that it has been commissioned"
expect_eq "commissioned marker is set after all three legs succeed" "$(json commissioned)" "true"

# ── 15. Hermeticity ──────────────────────────────────────────────────────────
# A harness that writes into ~/Library/Application Support or the operator's
# real TMPDIR is not a rehearsal, it is a side effect. Nothing outside $ROOT may
# have been created or modified while the scenarios above ran.
scenario "15. The rehearsal touched nothing outside its temp root"
LEAKS=""

# (1) Directories this chain owns exclusively: ANY change inside them is a leak.
#     The legacy breadcrumb dir is the one Codex actually caught being written.
check_untouched() {
  local target="$1"
  [ -e "$target" ] || return 0
  local found
  found="$(find "$target" -newer "$HERMETIC_MARKER" \
    -not -path "$ROOT" -not -path "$ROOT/*" 2> /dev/null | head -5)"
  [ -n "$found" ] && LEAKS="$LEAKS$found
"
  return 0
}

check_untouched "$REAL_HOME/Library/Application Support/MoldPilot"
check_untouched "$REAL_HOME/Library/Application Support/moldpilot"
check_untouched "$PROJECT_ROOT/storage"

# (2) Shared directories — the repo and the real TMPDIR — belong to the operator
#     and their editor, so an mtime sweep there would fail on an unrelated save.
#     Look instead for the artefacts only THIS chain creates. A stray staging
#     directory in the real TMPDIR means TMPDIR was not redirected; an archive or
#     a status file in the repo means the app-config defaults were not overridden.
find_stray() {
  find "$1" -maxdepth "$2" -newer "$HERMETIC_MARKER" \
    \( -name 'backup-staging.*' -o -name 'backup-verify.*' -o -name 'backup-drill.*' \
    -o -name '*-backup-*.tar.age' -o -name 'backup-status.json' \
    -o -name '.backup-status.json.lock' -o -name '.backup-status.json.tmp.*' \
    -o -name 'last-success' \) \
    -not -path "$ROOT" -not -path "$ROOT/*" 2> /dev/null | head -5
}

STRAY="$(find_stray "$REAL_TMPDIR" 1)
$(find_stray "$PROJECT_ROOT" 3)"
STRAY="$(printf '%s' "$STRAY" | sed '/^$/d')"
[ -n "$STRAY" ] && LEAKS="$LEAKS$STRAY
"

if [ -z "$LEAKS" ]; then
  pass "no file outside the temp root was created or modified"
else
  miss "files outside the temp root changed:
$LEAKS"
fi
expect_eq "the legacy breadcrumb stayed inside the temp root" \
  "$([ -f "$LEGACY_STATUS_ROOT/last-success" ] && printf yes || printf no)" "yes"

printf '\n────────────────────────────────────────\n'
printf 'passed %s / failed %s\n' "$PASSED" "$FAILED"
if [ "$KEEP" = "1" ]; then
  printf 'Kept: %s\n' "$ROOT"
else
  rm -rf "$ROOT"
fi
[ "$FAILED" -eq 0 ]
