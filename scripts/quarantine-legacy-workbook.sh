#!/usr/bin/env bash
#
# One-time legacy Office workbook isolation. This intentionally requires an
# explicit --move because removing the source from RAW is destructive. The file
# stays quarantined even when both tools complete without detections; a clean
# tool exit is not a guarantee that the workbook is malware-free.

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$PROJECT_ROOT/RAW/Injection-Machines-2026.07.02.xls"
QUARANTINE_DIR="${MOLDPILOT_LEGACY_QUARANTINE_DIR:-$HOME/MoldPilotData/legacy-quarantine}"
MODE="${1:---plan}"

fail() {
  printf '[legacy workbook quarantine ERROR] %s\n' "$*" >&2
  exit 1
}

[ -f "$SOURCE" ] || fail "Legacy workbook was not found at $SOURCE."
if [ "$MODE" = "--plan" ]; then
  cat <<EOF
Legacy workbook quarantine plan
Source:      $SOURCE
Destination: $QUARANTINE_DIR/Injection-Machines-2026.07.02.xls
Tools:       local ClamAV and Office-aware olevba
Effect:      moves the source outside the repository; no public upload
Disposition: QUARANTINED_PENDING_SECURITY_REVIEW regardless of a clean tool exit

After explicit approval, run:
  $0 --move
EOF
  exit 0
fi
[ "$MODE" = "--move" ] ||
  fail "Use --plan or --move."
command -v olevba >/dev/null 2>&1 ||
  fail "olevba (oletools) is required for Office-aware static analysis."

SCANNER="${MOLDPILOT_SCANNER_COMMAND:-}"
if [ -z "$SCANNER" ]; then
  SCANNER="$(command -v clamscan 2>/dev/null || command -v clamdscan 2>/dev/null || true)"
fi
[ -x "$SCANNER" ] || fail "A working ClamAV scanner is required."

case "$QUARANTINE_DIR" in
  "$PROJECT_ROOT"|"$PROJECT_ROOT"/*)
    fail "Legacy quarantine must be outside the repository."
    ;;
esac

HEADER="$(od -An -tx1 -N8 "$SOURCE" | tr -d ' \n')"
[ "$HEADER" = "d0cf11e0a1b11ae1" ] ||
  fail "Workbook does not have the expected OLE compound-file signature."

mkdir -p "$QUARANTINE_DIR"
chmod 700 "$QUARANTINE_DIR"
DESTINATION="$QUARANTINE_DIR/Injection-Machines-2026.07.02.xls"
REPORT="$QUARANTINE_DIR/Injection-Machines-2026.07.02.analysis.txt"
[ ! -e "$DESTINATION" ] || fail "Quarantine destination already exists."

mv "$SOURCE" "$DESTINATION"
chmod 600 "$DESTINATION"
HASH="$(shasum -a 256 "$DESTINATION" | awk '{print $1}')"

set +e
"$SCANNER" --no-summary "$DESTINATION" > "$REPORT" 2>&1
CLAM_STATUS=$?
olevba "$DESTINATION" >> "$REPORT" 2>&1
OLEVBA_STATUS=$?
set -e

{
  printf '\nsha256=%s\n' "$HASH"
  printf 'clamavExit=%s\n' "$CLAM_STATUS"
  printf 'olevbaExit=%s\n' "$OLEVBA_STATUS"
  printf 'disposition=QUARANTINED_PENDING_SECURITY_REVIEW\n'
  printf 'note=No scanner result is a guarantee that this workbook is malware-free.\n'
} >> "$REPORT"
chmod 600 "$REPORT"

if [ "$CLAM_STATUS" -ne 0 ] || [ "$OLEVBA_STATUS" -ne 0 ]; then
  fail "Analysis reported a detection or tool error. File remains quarantined; review $REPORT."
fi

printf 'Workbook moved to private quarantine: %s\n' "$DESTINATION"
printf 'Analysis completed without a tool error, but the file remains quarantined pending review.\n'
printf 'Report: %s\n' "$REPORT"
