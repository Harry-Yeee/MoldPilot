#!/usr/bin/env bash
#
# One-command first deployment wrapper for a dedicated MoldPilot Mac mini.
# Homebrew itself and client certificate trust remain explicit operator steps.

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL=""
TRUSTED_CIDR=""
RESTORE_ARCHIVE=""
RESTORE_IDENTITY=""
RESTORE_SHA256=""
INSTALL_PREREQUISITES=false
ACTIVATE_HTTPS=false

note() {
  printf '\n[MoldPilot first deploy] %s\n' "$*"
}

fail() {
  printf '\n[MoldPilot first deploy ERROR] %s\n' "$*" >&2
  exit 1
}

require_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] ||
    fail "$1 requires a value."
}

usage() {
  cat <<'EOF'
Usage:
  bash scripts/server-first-deploy-macos.sh \
    --base-url https://SERVER-IP \
    --trusted-cidr FACTORY-CIDR \
    [--restore-archive /path/to/database.dump[.age] \
     --restore-sha256 SHA256 \
     --age-identity /path/to/age-identity] \
    [--install-prerequisites] \
    [--activate-https]

Examples:
  Fresh production bootstrap from reviewed fixtures:
    bash scripts/server-first-deploy-macos.sh \
      --base-url https://192.168.0.11 \
      --trusted-cidr 192.168.0.0/24 \
      --install-prerequisites --activate-https

  Restore the accepted clean production database:
    bash scripts/server-first-deploy-macos.sh \
      --base-url https://192.168.0.11 \
      --trusted-cidr 192.168.0.0/24 \
      --restore-archive "$HOME/incoming/moldpilot-clean.dump.age" \
      --restore-sha256 EXPECTED_PLAINTEXT_DUMP_SHA256 \
      --age-identity "$HOME/.config/age/moldpilot-transfer.key" \
      --install-prerequisites --activate-https

The script never installs Homebrew, resets an existing database, changes router
settings, or installs the internal CA on client devices. --activate-https uses
sudo to install and restart the reviewed Caddy configuration.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-url)
      require_value "$@"
      BASE_URL="$2"
      shift 2
      ;;
    --trusted-cidr)
      require_value "$@"
      TRUSTED_CIDR="$2"
      shift 2
      ;;
    --restore-archive)
      require_value "$@"
      RESTORE_ARCHIVE="$2"
      shift 2
      ;;
    --restore-sha256)
      require_value "$@"
      RESTORE_SHA256="$2"
      shift 2
      ;;
    --age-identity)
      require_value "$@"
      RESTORE_IDENTITY="$2"
      shift 2
      ;;
    --install-prerequisites)
      INSTALL_PREREQUISITES=true
      shift
      ;;
    --activate-https)
      ACTIVATE_HTTPS=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      fail "Unknown option: $1"
      ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || fail "This deployment supports macOS only."
[ "$EUID" -ne 0 ] || fail "Run as the dedicated server user, not with sudo."
[ -n "$BASE_URL" ] || fail "--base-url is required."
[ -n "$TRUSTED_CIDR" ] || fail "--trusted-cidr is required."

case "$BASE_URL" in
  https://*|http://*) ;;
  *) fail "--base-url must begin with https:// or http://." ;;
esac
[[ "$BASE_URL" != */ ]] || fail "--base-url must not end with a slash."
[[ "$TRUSTED_CIDR" =~ ^[0-9.]+/[0-9]{1,2}$ ]] ||
  fail "--trusted-cidr must look like 192.168.0.0/24."

if [ -n "$RESTORE_ARCHIVE" ]; then
  [ -f "$RESTORE_ARCHIVE" ] || fail "Restore archive not found: $RESTORE_ARCHIVE"
  [[ "$RESTORE_SHA256" =~ ^[0-9A-Fa-f]{64}$ ]] ||
    fail "--restore-sha256 is required and must contain 64 hexadecimal characters."
  if [[ "$RESTORE_ARCHIVE" == *.age ]]; then
    [ -n "$RESTORE_IDENTITY" ] ||
      fail "--age-identity is required for an encrypted .age archive."
    [ -f "$RESTORE_IDENTITY" ] || fail "Age identity not found: $RESTORE_IDENTITY"
  elif [ -n "$RESTORE_IDENTITY" ]; then
    fail "--age-identity is only accepted with an encrypted .age archive."
  fi
elif [ -n "$RESTORE_SHA256" ] || [ -n "$RESTORE_IDENTITY" ]; then
  fail "Restore hash or identity was provided without --restore-archive."
fi

if [ "$ACTIVATE_HTTPS" = true ] && [[ "$BASE_URL" != https://* ]]; then
  fail "--activate-https requires an https:// base URL."
fi

if command -v brew >/dev/null 2>&1; then
  BREW_BIN="$(command -v brew)"
elif [ -x /opt/homebrew/bin/brew ]; then
  BREW_BIN=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW_BIN=/usr/local/bin/brew
else
  fail "Install a reviewed official Homebrew .pkg, then rerun this command."
fi

eval "$("$BREW_BIN" shellenv)"
BREW_PREFIX="$("$BREW_BIN" --prefix)"

if [ "$INSTALL_PREREQUISITES" = true ]; then
  note "Installing reviewed Homebrew prerequisites"
  "$BREW_BIN" update
  for package in caddy clamav age; do
    "$BREW_BIN" list --versions "$package" >/dev/null 2>&1 ||
      "$BREW_BIN" install "$package"
  done
fi

for package in caddy clamav age; do
  "$BREW_BIN" list --versions "$package" >/dev/null 2>&1 ||
    fail "$package is missing. Rerun with --install-prerequisites."
done

CLAM_ETC="$BREW_PREFIX/etc/clamav"
if [ ! -f "$CLAM_ETC/freshclam.conf" ]; then
  [ -f "$CLAM_ETC/freshclam.conf.sample" ] ||
    fail "FreshClam sample configuration is missing."
  cp "$CLAM_ETC/freshclam.conf.sample" "$CLAM_ETC/freshclam.conf"
  sed -i '' 's/^Example/# Example/' "$CLAM_ETC/freshclam.conf"
fi

note "Updating ClamAV definitions"
"$BREW_PREFIX/bin/freshclam"

export MOLDPILOT_BOOTSTRAP_BASE_URL="$BASE_URL"
export MOLDPILOT_BOOTSTRAP_TRUSTED_CIDR="$TRUSTED_CIDR"

BOOTSTRAP_MODE=(--production)
if [ -n "$RESTORE_ARCHIVE" ]; then
  export MOLDPILOT_BOOTSTRAP_RESTORE_ARCHIVE="$RESTORE_ARCHIVE"
  export MOLDPILOT_BOOTSTRAP_RESTORE_SHA256="$(
    printf '%s' "$RESTORE_SHA256" | tr '[:upper:]' '[:lower:]'
  )"
  export MOLDPILOT_BOOTSTRAP_RESTORE_IDENTITY="$RESTORE_IDENTITY"
  export MOLDPILOT_BOOTSTRAP_VERIFY_PRODUCTION=1
  BOOTSTRAP_MODE=(--existing-data)
fi

note "Running the one-time MoldPilot bootstrap"
bash "$PROJECT_ROOT/scripts/server-bootstrap-macos.sh" "${BOOTSTRAP_MODE[@]}"

if [ "$ACTIVATE_HTTPS" = true ]; then
  CADDY_SOURCE="$HOME/Library/Application Support/MoldPilot/Caddyfile"
  [ -f "$CADDY_SOURCE" ] || fail "Rendered Caddy configuration is missing."

  note "Validating and activating Caddy HTTPS"
  "$BREW_PREFIX/bin/caddy" validate \
    --config "$CADDY_SOURCE" \
    --adapter caddyfile
  sudo install -o root -g wheel -m 600 \
    "$CADDY_SOURCE" "$BREW_PREFIX/etc/Caddyfile"
  sudo "$BREW_BIN" services restart caddy
  curl --fail --insecure --silent --output /dev/null "${BASE_URL%/}/login" ||
    fail "Caddy started, but the HTTPS login health check failed."
fi

cat <<EOF

First deployment completed.

Browser URL: $BASE_URL/login
Application status:
  launchctl print "gui/\$(id -u)/com.moldpilot.app"

Remaining operator steps:
1. Reserve this Mac mini's Ethernet address in router DHCP.
2. Install and verify the Caddy internal CA on managed client devices.
3. Change the protected Admin bootstrap password immediately.
4. Configure an encrypted off-machine backup and complete a scratch restore.

Future code deployments:
  cd "$PROJECT_ROOT"
  bash scripts/server-deploy-macos.sh
EOF
