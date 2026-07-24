#!/usr/bin/env bash

set -euo pipefail

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
exec "$NODE_BIN/node" "$PROJECT_ROOT/node_modules/next/dist/bin/next" start \
  --hostname 0.0.0.0 \
  --port "${PORT:-3000}"
