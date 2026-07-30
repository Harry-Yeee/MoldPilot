# shellcheck shell=bash
#
# Shared logic for the Backup v2 chain (local archive → cloud copy → verify).
#
# ESTATE RULE: this file names no application. Every app-specific value arrives
# from scripts/backup-app-config.sh, which the caller sources first. Adding the
# next app must never require an edit here.
#
# Sourced, never executed. Targets bash 3.2 (the /bin/bash launchd runs on
# macOS): no associative arrays, no `mapfile`, no `${var,,}`.

BACKUP_NODE_BIN="${BACKUP_NODE_BIN:-}"

# Resolve a node binary the same way backup.sh resolves pg_dump: PATH first,
# then the two Homebrew prefixes, because a launchd job inherits a thin PATH.
resolve_node_bin() {
  if [ -n "$BACKUP_NODE_BIN" ]; then
    return 0
  fi

  BACKUP_NODE_BIN="$(command -v node 2>/dev/null || true)"
  if [ -z "$BACKUP_NODE_BIN" ]; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
      if [ -x "$candidate" ]; then
        BACKUP_NODE_BIN="$candidate"
        break
      fi
    done
  fi

  [ -n "$BACKUP_NODE_BIN" ]
}

backup_timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# record_status <stage> <status> [detail] [fact=value ...]
#
# Never aborts the caller. A status file we could not write is a monitoring
# gap, not a reason to abandon an otherwise good archive — and the age
# thresholds turn the admin light red within 26h anyway, which is the honest
# outcome. The writer sanitizes `detail`; nothing secret may be passed here.
record_status() {
  local stage="$1"
  local status="$2"
  local detail="${3:-}"

  shift 2
  if [ "$#" -gt 0 ]; then
    shift
  fi

  local -a status_args
  status_args=(
    --file "$BACKUP_STATUS_FILE"
    --app "$BACKUP_APP_NAME"
    --stage "$stage"
    --status "$status"
    --at "$(backup_timestamp)"
  )

  if [ -n "$detail" ]; then
    status_args=("${status_args[@]}" --detail "$detail")
  fi

  local fact
  for fact in "$@"; do
    status_args=("${status_args[@]}" --fact "$fact")
  done

  if ! resolve_node_bin; then
    printf '[backup WARN] node not on PATH; %s=%s was not recorded in the status file.\n' \
      "$stage" "$status" >&2
    return 0
  fi

  if ! "$BACKUP_NODE_BIN" "$BACKUP_STATUS_WRITER" "${status_args[@]}" >/dev/null; then
    printf '[backup WARN] could not write the status file; %s=%s is unrecorded.\n' \
      "$stage" "$status" >&2
    return 0
  fi

  return 0
}

# cloud_drill_due
#
# Prints `run` or `skip` on stdout and a one-line reason on stderr. The drill is
# due when the last SUCCESSFUL cloud drill recorded in the status file is older
# than BACKUP_DRILL_MAX_AGE_DAYS, or when it has never succeeded — never on a
# calendar day. A day-of-month trigger read the UTC date on a Beijing-time
# machine (03:30 local = the previous UTC day) and one offline night skipped the
# whole month; age-based scheduling simply retries every night until it passes.
#
# Fail-safe direction: if the answer cannot be computed (no node, unreadable
# file), say `run`. A drill that runs a night early costs a download; a drill
# that never runs costs the proof.
cloud_drill_due() {
  local max_age="${BACKUP_DRILL_MAX_AGE_DAYS:-30}"

  case "$max_age" in
    '' | *[!0-9]*)
      printf '[verify WARN] BACKUP_DRILL_MAX_AGE_DAYS is not a whole number of days; using 30.\n' >&2
      max_age=30
      ;;
  esac
  [ "$max_age" -gt 0 ] 2>/dev/null || max_age=30

  if ! resolve_node_bin; then
    printf '[verify WARN] node not on PATH; cannot read the drill age — running the drill.\n' >&2
    printf 'run\n'
    return 0
  fi

  local answer
  answer="$("$BACKUP_NODE_BIN" "$BACKUP_STATUS_WRITER" \
    --file "$BACKUP_STATUS_FILE" --drill-due --max-age-days "$max_age" 2>/dev/null)" || answer=""

  case "$answer" in
    run*)
      printf '[verify] cloud drill is due (%s).\n' "${answer#run }" >&2
      printf 'run\n'
      ;;
    skip*)
      printf '[verify] cloud drill is not due yet (%s).\n' "${answer#skip }" >&2
      printf 'skip\n'
      ;;
    *)
      printf '[verify WARN] could not read the last drill age — running the drill.\n' >&2
      printf 'run\n'
      ;;
  esac

  return 0
}

# newest_archive <directory>
#
# Prints the newest archive path, or nothing. The stamp is
# %Y%m%dT%H%M%SZ, so a byte-wise sort is a chronological sort — no `ls -t`
# output parsing, and no surprise when a file is touched.
newest_archive() {
  local directory="$1"

  [ -d "$directory" ] || return 0
  find "$directory" -maxdepth 1 -type f -name "$BACKUP_ARCHIVE_GLOB" 2>/dev/null |
    LC_ALL=C sort |
    tail -n 1
}

# is_offline_error <text>
#
# Distinguishes "the mini has no network right now" (tolerated: recorded,
# exit 0, the 26h threshold raises it) from "the upload is genuinely broken"
# (nonzero exit). Deliberately conservative: anything unrecognised counts as a
# real failure.
is_offline_error() {
  local lowered
  lowered="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  case "$lowered" in
    *"no such host"*) return 0 ;;
    *"nodename nor servname"*) return 0 ;;
    *"temporary failure in name resolution"*) return 0 ;;
    *"network is unreachable"*) return 0 ;;
    *"no route to host"*) return 0 ;;
    *"connection refused"*) return 0 ;;
    *"connection reset by peer"*) return 0 ;;
    *"i/o timeout"*) return 0 ;;
    *"tls handshake timeout"*) return 0 ;;
    *"dial tcp"*) return 0 ;;
    *"couldn't connect"*) return 0 ;;
    *"could not resolve host"*) return 0 ;;
  esac

  return 1
}

# require_verify_database_name <name>
#
# Belt and braces against ever pointing a create/restore/DROP at production.
# The scratch database must carry the `_verify` marker at the end of its name
# (`..._verify` or the `..._verify_scratch` form this chain uses by default).
# Anything else — including the production name — is refused before a single
# connection is opened.
require_verify_database_name() {
  local name="$1"

  case "$name" in
    *_verify | *_verify_scratch) ;;
    *)
      printf '[verify FAIL] Refusing to operate on "%s": a verify scratch database name must end in _verify or _verify_scratch.\n' \
        "$name" >&2
      return 1
      ;;
  esac

  case "$name" in
    *[!a-zA-Z0-9_]*)
      printf '[verify FAIL] Refusing "%s": scratch database names are limited to letters, digits and underscores.\n' \
        "$name" >&2
      return 1
      ;;
  esac

  return 0
}
