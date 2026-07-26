#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
exec "$PROJECT_ROOT/scripts/docker-d2-smoke.sh" --d1-compat
