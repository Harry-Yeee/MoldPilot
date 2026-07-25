#!/usr/bin/env bash

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -x /opt/homebrew/bin/brew ]; then
  BREW_BIN=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW_BIN=/usr/local/bin/brew
else
  echo "Homebrew is not installed. Run scripts/server-bootstrap-macos.sh." >&2
  exit 1
fi

NODE_BIN="$("$BREW_BIN" --prefix node@24)/bin"
export PATH="$NODE_BIN:$("$BREW_BIN" --prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production

cd "$PROJECT_ROOT"
[ -f .env ] || {
  echo "Protected production .env is missing." >&2
  exit 1
}
set -a
# shellcheck disable=SC1091
source .env
set +a

"$NODE_BIN/node" "$PROJECT_ROOT/scripts/check-production-config.mjs"
if [[ "$MOLDPILOT_BASE_URL" == https://* ]] && [ "${MOLDPILOT_TRUST_PROXY:-}" != "1" ]; then
  echo "MOLDPILOT_TRUST_PROXY=1 is required behind the approved TLS proxy." >&2
  exit 1
fi

"$PROJECT_ROOT/scripts/check-malware-scanner.sh"

LISTEN_HOST="127.0.0.1"
if [[ "$MOLDPILOT_BASE_URL" == http://* ]]; then
  LISTEN_HOST="$(
    "$NODE_BIN/node" --input-type=module -e \
      'process.stdout.write(new URL(process.env.MOLDPILOT_BASE_URL).hostname)'
  )"
fi

exec "$NODE_BIN/node" "$PROJECT_ROOT/node_modules/next/dist/bin/next" start \
  --hostname "$LISTEN_HOST" \
  --port "${PORT:-3000}"
