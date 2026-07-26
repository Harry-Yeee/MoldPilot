#!/bin/sh
set -eu

SIGNATURE_DIR="/signatures"

fail() {
  printf 'ClamAV signature seeding failed.\n' >&2
  exit 1
}

[ "$(id -u):$(id -g)" = "1000:1000" ] || fail
[ -d "$SIGNATURE_DIR" ] || fail
[ -w "$SIGNATURE_DIR" ] || fail

if ! find "$SIGNATURE_DIR" -maxdepth 1 -type f \
  \( -name '*.cvd' -o -name '*.cld' \) -size +0c | grep -q .; then
  copied=0
  for source in /var/lib/clamav/*.cvd /var/lib/clamav/*.cld; do
    if [ -s "$source" ]; then
      cp "$source" "$SIGNATURE_DIR/"
      chmod 0640 "$SIGNATURE_DIR/$(basename "$source")"
      copied=1
    fi
  done
  [ "$copied" -eq 1 ] || fail
fi

find "$SIGNATURE_DIR" -maxdepth 1 -type f \
  \( -name '*.cvd' -o -name '*.cld' \) -size +0c | grep -q . || fail
