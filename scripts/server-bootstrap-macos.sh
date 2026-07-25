#!/usr/bin/env bash
#
# One-time MoldPilot production bootstrap for a dedicated macOS server account.
# Installs the toolchain, configures native PostgreSQL, prepares a fresh or
# restored database, builds the app, and installs a per-user launchd service.

set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_LABEL="com.moldpilot.app"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/MoldPilot"
SEED_MODE="production"

note() {
  printf '\n[MoldPilot] %s\n' "$*"
}

fail() {
  printf '\n[MoldPilot ERROR] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/server-bootstrap-macos.sh [option]

Options:
  --production       Fresh production DB: real master data/users, no demo projects (default)
  --demo-data        Rehearsal DB: install acceptance/demo projects
  --existing-data    Database was restored already: do not seed or reset it
  --help             Show this help

The script never resets a database. Production bootstrap refuses to run when
users, projects, or activity logs already exist.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --production)
      SEED_MODE="production"
      ;;
    --demo-data)
      SEED_MODE="demo"
      ;;
    --existing-data)
      SEED_MODE="existing"
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
  shift
done

[ "$(uname -s)" = "Darwin" ] || fail "This bootstrap supports macOS only."
[ "$EUID" -ne 0 ] || fail "Run this as the dedicated server user, not with sudo."
[ -f "$PROJECT_ROOT/package.json" ] || fail "Run the script from a complete MoldPilot clone."

note "Checking Apple Command Line Tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  fail "Finish the Command Line Tools installer, then run this script again."
fi

if command -v brew >/dev/null 2>&1; then
  BREW_BIN="$(command -v brew)"
elif [ -x /opt/homebrew/bin/brew ]; then
  BREW_BIN=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW_BIN=/usr/local/bin/brew
else
  fail "Homebrew is required but was not found. Install a reviewed official Homebrew .pkg first; this bootstrap will not execute a mutable remote installer pipeline."
fi

if [ -n "${BREW_BIN:-}" ]; then
  :
elif [ -x /opt/homebrew/bin/brew ]; then
  BREW_BIN=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW_BIN=/usr/local/bin/brew
else
  fail "Homebrew installation finished but brew was not found."
fi

eval "$("$BREW_BIN" shellenv)"
BREW_PREFIX="$("$BREW_BIN" --prefix)"

note "Installing Node.js 24 and PostgreSQL 16"
"$BREW_BIN" list --versions node@24 >/dev/null 2>&1 || "$BREW_BIN" install node@24
"$BREW_BIN" list --versions postgresql@16 >/dev/null 2>&1 || "$BREW_BIN" install postgresql@16

if ! "$BREW_BIN" list --versions clamav >/dev/null 2>&1; then
  fail "ClamAV is not installed. Install and update it as an explicit security prerequisite before bootstrap."
fi
if ! "$BREW_BIN" list --versions caddy >/dev/null 2>&1; then
  fail "Caddy is not installed. Install it only after approving the documented TLS-proxy service steps."
fi

NODE_BIN="$("$BREW_BIN" --prefix node@24)/bin"
PG_BIN="$("$BREW_BIN" --prefix postgresql@16)/bin"
export PATH="$NODE_BIN:$PG_BIN:$BREW_PREFIX/bin:$PATH"

if ! command -v corepack >/dev/null 2>&1; then
  "$NODE_BIN/npm" install --global corepack
fi
corepack enable
corepack prepare pnpm@11.5.3 --activate

PROFILE_MARKER="# MoldPilot server toolchain"
if ! grep -Fq "$PROFILE_MARKER" "$HOME/.zprofile" 2>/dev/null; then
  {
    printf '\n%s\n' "$PROFILE_MARKER"
    printf 'export PATH="%s:%s:%s/bin:$PATH"\n' "$NODE_BIN" "$PG_BIN" "$BREW_PREFIX"
  } >> "$HOME/.zprofile"
fi

note "Starting PostgreSQL 16 as a login service"
"$BREW_BIN" services start postgresql@16
for _ in $(seq 1 30); do
  if "$PG_BIN/pg_isready" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
"$PG_BIN/pg_isready" -d postgres >/dev/null 2>&1 || fail "PostgreSQL did not become ready."

cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  note "Creating PostgreSQL role, database, secrets, and .env"
  DB_PASSWORD="$(openssl rand -hex 24)"
  SESSION_SECRET="$(openssl rand -hex 32)"

  DEFAULT_INTERFACE="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  DETECTED_IP=""
  if [ -n "$DEFAULT_INTERFACE" ]; then
    DETECTED_IP="$(ipconfig getifaddr "$DEFAULT_INTERFACE" 2>/dev/null || true)"
  fi

  printf 'Stable LAN IP for this Mac mini [%s]: ' "${DETECTED_IP:-required}"
  read -r SERVER_IP
  SERVER_IP="${SERVER_IP:-$DETECTED_IP}"
  [ -n "$SERVER_IP" ] || fail "A LAN IP is required. Configure Ethernet, then retry."
  [[ "$SERVER_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] ||
    fail "Enter the Mac mini's IPv4 address, for example 192.168.1.50."
  printf 'Trusted factory subnet in CIDR form [192.168.1.0/24]: '
  read -r TRUSTED_CIDR
  TRUSTED_CIDR="${TRUSTED_CIDR:-192.168.1.0/24}"
  [[ "$TRUSTED_CIDR" =~ ^[0-9.]+/[0-9]{1,2}$ ]] ||
    fail "Enter a trusted IPv4 CIDR, for example 192.168.1.0/24."

  if "$PG_BIN/psql" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='moldpilot'" | grep -q 1; then
    "$PG_BIN/psql" -v ON_ERROR_STOP=1 -d postgres \
      -c "ALTER ROLE moldpilot WITH LOGIN PASSWORD '$DB_PASSWORD';" >/dev/null
  else
    "$PG_BIN/createuser" --login moldpilot
    "$PG_BIN/psql" -v ON_ERROR_STOP=1 -d postgres \
      -c "ALTER ROLE moldpilot WITH PASSWORD '$DB_PASSWORD';" >/dev/null
  fi

  if ! "$PG_BIN/psql" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='moldpilot'" | grep -q 1; then
    "$PG_BIN/createdb" --owner=moldpilot moldpilot
  fi

  STORAGE_DIR="$HOME/MoldPilotData/uploads"
  QUARANTINE_DIR="$HOME/MoldPilotData/quarantine"
  mkdir -p "$STORAGE_DIR" "$QUARANTINE_DIR"
  cat > .env <<EOF
DATABASE_URL="postgresql://moldpilot:$DB_PASSWORD@127.0.0.1:5432/moldpilot?schema=public"
MOLDPILOT_DEPLOYMENT_MODE="production"
MOLDPILOT_SESSION_SECRET="$SESSION_SECRET"
MOLDPILOT_STORAGE_DIR="$STORAGE_DIR"
MOLDPILOT_QUARANTINE_DIR="$QUARANTINE_DIR"
MOLDPILOT_SCANNER_COMMAND="$BREW_PREFIX/bin/clamscan"
MOLDPILOT_BASE_URL="https://$SERVER_IP"
MOLDPILOT_SESSION_COOKIE_SECURE="auto"
MOLDPILOT_TRUST_PROXY="1"
MOLDPILOT_TRUSTED_CIDR="$TRUSTED_CIDR"
EOF
  chmod 600 .env
else
  note "Using the existing protected .env"
  chmod 600 .env
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is missing from .env."
[ -n "${MOLDPILOT_SESSION_SECRET:-}" ] || fail "MOLDPILOT_SESSION_SECRET is missing from .env."
[ "$MOLDPILOT_SESSION_SECRET" != "moldpilot-local-pilot-session-secret" ] ||
  fail "Replace the local fallback session secret before deploying."
"$NODE_BIN/node" "$PROJECT_ROOT/scripts/check-production-config.mjs"

MOLDPILOT_STORAGE_DIR="${MOLDPILOT_STORAGE_DIR:-$HOME/MoldPilotData/uploads}"
MOLDPILOT_QUARANTINE_DIR="${MOLDPILOT_QUARANTINE_DIR:-$HOME/MoldPilotData/quarantine}"
mkdir -p "$MOLDPILOT_STORAGE_DIR" "$MOLDPILOT_QUARANTINE_DIR"
chmod 700 "$MOLDPILOT_STORAGE_DIR" "$MOLDPILOT_QUARANTINE_DIR"

"$PROJECT_ROOT/scripts/check-malware-scanner.sh"

case "$MOLDPILOT_BASE_URL" in
  https://*)
    [ "${MOLDPILOT_TRUST_PROXY:-}" = "1" ] ||
      fail "MOLDPILOT_TRUST_PROXY=1 is required behind the approved TLS proxy."
    [ -n "${MOLDPILOT_TRUSTED_CIDR:-}" ] ||
      fail "MOLDPILOT_TRUSTED_CIDR is required behind the approved TLS proxy."
    PROXY_CONFIG="$HOME/Library/Application Support/MoldPilot/Caddyfile"
    bash "$PROJECT_ROOT/scripts/render-caddy-config.sh" \
      "${MOLDPILOT_BASE_URL#https://}" \
      "$MOLDPILOT_TRUSTED_CIDR" \
      "$PROXY_CONFIG"
    ;;
  http://*)
    note "Temporary trusted-LAN HTTP mode selected; HTTPS proxy rendering was skipped"
    ;;
esac

LISTEN_ADDRESSES="$("$PG_BIN/psql" -d postgres -Atc "SHOW listen_addresses;")"
case "$LISTEN_ADDRESSES" in
  "*"|"0.0.0.0"|"::")
    fail "PostgreSQL is listening beyond localhost. Restrict it before deployment."
    ;;
esac

DB_CONNECT_URL="${DATABASE_URL%%\?*}"
"$PG_BIN/psql" "$DB_CONNECT_URL" -Atc "SELECT 1;" >/dev/null ||
  fail "The application DATABASE_URL cannot connect to PostgreSQL."

note "Installing locked application dependencies"
pnpm install --frozen-lockfile

note "Applying production migrations"
pnpm exec prisma generate
pnpm exec prisma migrate deploy

USER_COUNT="$("$PG_BIN/psql" "$DB_CONNECT_URL" -Atc "SELECT COUNT(*) FROM users;")"
case "$SEED_MODE" in
  production)
    if [ "$USER_COUNT" = "0" ]; then
      note "Bootstrapping production users, roles, clients, machines, and templates"
      pnpm prisma:bootstrap
    else
      note "Existing users detected; production bootstrap skipped"
    fi
    ;;
  demo)
    printf '\nWARNING: demo mode creates MP-SEED/MP-PILOT/report fixtures and is not for live use.\n'
    printf 'Type DEMO to continue: '
    read -r DEMO_CONFIRMATION
    [ "$DEMO_CONFIRMATION" = "DEMO" ] || fail "Demo seed cancelled."
    pnpm prisma:seed
    ;;
  existing)
    [ "$USER_COUNT" -gt 0 ] || fail "--existing-data was selected, but no users exist after migration."
    note "Restored/existing operational data retained; no seed command was run"
    ;;
esac

note "Running release verification"
pnpm typecheck
CI=true pnpm test
pnpm build

note "Installing the MoldPilot launchd service"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROJECT_ROOT/scripts/run-production-macos.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/app.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/app-error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST_PATH" >/dev/null
launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
for _ in $(seq 1 10); do
  if ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port 3000 is already in use by another process. Stop it, then rerun bootstrap."
fi
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/$SERVICE_LABEL"

note "Waiting for MoldPilot"
HEALTH_URL="http://127.0.0.1:3000/login"
if [[ "$MOLDPILOT_BASE_URL" == http://* ]]; then
  HEALTH_URL="${MOLDPILOT_BASE_URL%/}/login"
fi
for _ in $(seq 1 30); do
  if curl --fail --silent --output /dev/null "$HEALTH_URL"; then
    break
  fi
  sleep 1
done
curl --fail --silent --output /dev/null "$HEALTH_URL" ||
  fail "MoldPilot did not become healthy. Check $LOG_DIR/app-error.log."

cat <<EOF

MoldPilot is running.

Health check URL: $HEALTH_URL
Configured browser URL: ${MOLDPILOT_BASE_URL}

Next:
1. Complete the documented, approval-required Caddy service and client CA steps.
2. Reserve this Mac mini's Ethernet address in the router DHCP settings.
3. Log in as admin and change the bootstrap password immediately.
4. Configure encrypted off-machine backups and complete a restore drill.
5. Keep the dedicated server user logged in; this launch agent starts at login.

Future deployments:
  cd "$PROJECT_ROOT"
  bash scripts/server-deploy-macos.sh
EOF
