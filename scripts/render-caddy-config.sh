#!/usr/bin/env bash

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT_ROOT/scripts/Caddyfile.moldpilot.template"
OUTPUT="${3:-$PROJECT_ROOT/generated/Caddyfile.moldpilot}"
HOST="${1:-}"
TRUSTED_CIDR="${2:-}"

fail() {
  printf '[MoldPilot proxy config ERROR] %s\n' "$*" >&2
  exit 1
}

[ -n "$HOST" ] || fail "Usage: $0 <hostname-or-ip> <trusted-cidr> [output-path]"
[ -n "$TRUSTED_CIDR" ] || fail "A trusted CIDR is required, for example 192.168.50.0/24."
[[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Host contains unsupported characters."
[[ "$TRUSTED_CIDR" =~ ^[0-9A-Fa-f:.]+/[0-9]{1,3}$ ]] ||
  fail "Trusted CIDR must look like 192.168.50.0/24 or fd00::/64."

mkdir -p "$(dirname "$OUTPUT")"
sed \
  -e "s|__MOLDPILOT_HOST__|$HOST|g" \
  -e "s|__MOLDPILOT_TRUSTED_CIDR__|$TRUSTED_CIDR|g" \
  "$TEMPLATE" > "$OUTPUT"
chmod 600 "$OUTPUT"

printf 'Rendered %s\n' "$OUTPUT"
printf 'Public origin: https://%s\n' "$HOST"
printf 'Trusted network: %s\n' "$TRUSTED_CIDR"
