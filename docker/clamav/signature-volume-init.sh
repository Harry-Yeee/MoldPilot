#!/bin/sh
set -eu

SIGNATURE_DIR="/signatures"

fail() {
  printf 'ClamAV signature-volume initialization failed.\n' >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail
[ -d "$SIGNATURE_DIR" ] || fail
[ ! -L "$SIGNATURE_DIR" ] || fail

# With only CAP_CHOWN, temporarily owning each flat database entry lets this
# one-shot initializer normalize its mode before returning ownership to clamd.
chown 0:0 "$SIGNATURE_DIR"
chmod 0750 "$SIGNATURE_DIR"

for entry in "$SIGNATURE_DIR"/* "$SIGNATURE_DIR"/.[!.]* "$SIGNATURE_DIR"/..?*; do
  [ -e "$entry" ] || continue
  [ ! -L "$entry" ] || fail
  [ -f "$entry" ] || fail
  chown 0:0 "$entry"
  chmod 0640 "$entry"
  chown 1000:1000 "$entry"
done

chown 1000:1000 "$SIGNATURE_DIR"
[ "$(stat -c '%u:%g' "$SIGNATURE_DIR")" = "1000:1000" ] || fail
