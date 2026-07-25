#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
node "$SCRIPT_DIR/check-container-runtime.mjs"
exec "$@"
