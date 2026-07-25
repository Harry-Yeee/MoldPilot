# Mac Mini Intranet Server

This is the source-of-truth setup for running MoldPilot on a dedicated Mac mini
inside the factory LAN.

## Deployment Shape

- The Mac mini uses wired Ethernet and a router DHCP reservation.
- GitHub stores source and migration history only.
- The production checkout uses a read-only GitHub deploy key.
- Native Homebrew PostgreSQL 16 stores operational data on the Mac mini.
- Homebrew Node.js 24 runs the built Next.js application in production mode.
- Preferred deployment keeps Next.js on `127.0.0.1:3000`; Caddy is the only
  LAN-facing listener, terminates HTTPS, pins the expected host, and restricts
  requests to the approved factory CIDR.
- The currently accepted temporary pilot may use direct HTTP on the isolated
  factory LAN. In that mode Next.js binds only to the stable hostname/IP in
  `MOLDPILOT_BASE_URL`, never every interface. Credentials and cookies are not
  encrypted, so router port forwarding and internet exposure are forbidden.
- Local ClamAV signature scanning is mandatory. New uploaded files remain in a
  private quarantine until validation and scanning return an explicit clean
  result.
- A per-user launchd agent keeps MoldPilot running after login and restarts it
  after a process failure.
- Released uploads and quarantined bytes live outside Git in separate private
  directories under `~/MoldPilotData`.
- Versioned `age`-encrypted database, upload, and recovery-config archives go
  to a mounted NAS or external disk.
- Docker Desktop is not required for production. Python is needed only for the
  separately approved Office-aware `oletools` legacy-workbook review.

The launch agent is a user service. The dedicated server account must remain
logged in, although the screen can stay locked. After a restart or power loss,
log that account in so Homebrew PostgreSQL and MoldPilot start.

## 1. Prepare The Mac Mini

1. Connect the Mac mini to the factory router or managed switch with Ethernet.
2. Install current macOS updates.
3. Give the Mac a clear name such as `MoldPilot Server` under **System Settings
   > General > About**.
4. Turn on **System Settings > General > Sharing > Remote Login** for the
   administrator who will maintain MoldPilot.
5. Under **System Settings > Energy**, enable **Prevent automatic sleeping when
   the display is off** and **Wake for network access**.
6. Keep internet router port forwarding disabled. Never expose PostgreSQL port
   5432 to the LAN or internet. In temporary HTTP mode, port 3000 may be
   reachable only from the trusted factory LAN; preferred HTTPS mode must not
   expose it beyond loopback.

## 2. Reserve A Stable LAN Address

A stable address is required because phones and desktops bookmark the exact
`MOLDPILOT_BASE_URL`: temporarily `http://SERVER-IP:3000`, and preferably
`https://SERVER-IP` after the managed certificate rollout.

Prefer a router-side DHCP reservation over entering a manual IP on macOS:

1. On the Mac mini, run `networksetup -listallhardwareports`.
2. Find **Hardware Port: Ethernet** and record its **Ethernet Address**.
3. Sign in to the router/firewall administration page.
4. Open its LAN, DHCP, Address Reservation, or Static Lease section.
5. Reserve an unused address for the recorded Ethernet address. Reusing the
   Mac's current DHCP address is usually simplest.
6. On the Mac, open **System Settings > Network > Ethernet > Details > TCP/IP**
   and renew the DHCP lease, or reconnect Ethernet.
7. Confirm the reserved address with `ipconfig getifaddr en0`. If Ethernet uses
   another interface, find it with `route get default`.

Do not guess an address and enter it manually without checking the router's DHCP
pool; that can create duplicate-IP failures. If the router cannot reserve
addresses, use Apple's **Configure IPv4: Manually** controls with an address
outside the DHCP pool and the router's correct subnet mask, router, and DNS.

## 3. Prepare GitHub Access

Use a server-specific read-only deploy key and the `github-moldpilot` SSH alias.
Do not copy the development Mac's private key. See the project setup discussion
and GitHub deploy-key documentation for the complete key steps.

The clone should be:

```text
~/LJ_ERP/MoldPilot
```

Verify it:

```bash
cd ~/LJ_ERP/MoldPilot
git remote -v
git status --short --branch
```

## 4. Install Reviewed Security Prerequisites

The bootstrap will not execute the mutable Homebrew `curl | bash` installer.
Install a reviewed official Homebrew `.pkg`, then obtain approval for the
machine-level package and service changes in
`security-hardening-runbook.md`. Before bootstrap, these checks must pass:

```bash
brew --version
caddy version
clamscan --version
age --version
freshclam
bash scripts/check-malware-scanner.sh
```

Do not continue if the scanner health check fails. Caddy installation alone
does not expose the server; the separately approved activation step does.

## 5. Run The One-Time Bootstrap

After the deployment scripts have been committed and pushed from the
development Mac:

```bash
cd ~/LJ_ERP/MoldPilot
git pull --ff-only origin main
bash scripts/server-bootstrap-macos.sh --production
```

The script:

1. Checks Apple Command Line Tools.
2. Refuses to proceed if a reviewed Homebrew installation, ClamAV, or Caddy is
   missing.
3. Installs Homebrew `node@24` and `postgresql@16`.
4. Activates pnpm 11.5.3.
5. Starts PostgreSQL as a login service and verifies it is not listening beyond
   localhost.
6. Generates a random database password and session secret.
7. Writes a mode-`0600` `.env` with
   `MOLDPILOT_DEPLOYMENT_MODE=production`, a strong session secret,
   `MOLDPILOT_SESSION_COOKIE_SECURE=auto`, preferred HTTPS/trusted-proxy
   settings, and private release/quarantine directories.
8. Verifies the local malware scanner and renders a reviewed Caddy
   configuration without activating the privileged proxy.
9. Applies Prisma production migrations.
10. Bootstraps real users, roles, permissions, clients, machines, and the
    process-sheet template without demo projects.
11. Runs typecheck, domain tests, and the production build.
12. Installs and starts the loopback-only `com.moldpilot.app` launch agent.

Production bootstrap is fresh-database-only. It refuses to overwrite a database
that already contains users, projects, or activity logs.

For a disposable rehearsal server:

```bash
bash scripts/server-bootstrap-macos.sh --demo-data
```

For a database restored from a real backup before bootstrap:

```bash
bash scripts/server-bootstrap-macos.sh --existing-data
```

### Existing Temporary HTTP Pilot

For the already-running trusted-LAN HTTP pilot, edit the protected server
`.env` before deploying this patch:

```text
MOLDPILOT_DEPLOYMENT_MODE=production
MOLDPILOT_BASE_URL=http://SERVER-IP:3000
MOLDPILOT_SESSION_COOKIE_SECURE=auto
```

Keep `.env` mode `0600`. Do not put these values in Git. The production
configuration checker resolves `auto` to `Secure=false` for this HTTP URL and
prints a prominent warning. An explicit `true` is rejected for HTTP. When the
server moves to HTTPS, change only the base URL to `https://SERVER-IP`; `auto`
then resolves to `Secure=true`.

Do not launch `run-moldpilot.command`, `pnpm pilot:start`, or another local
pilot command on this checkout. The production marker makes those paths exit
before migrations or seed and directs the operator to the deploy script.

## 6. Verify Current Access And Activate Preferred HTTPS

For temporary HTTP, first validate without restarting anything:

```bash
cd ~/LJ_ERP/MoldPilot
set -a
source .env
set +a
node scripts/check-production-config.mjs
```

Expected: `session cookie Secure=false` plus the warning that credentials and
cookies are not encrypted. From a managed factory device, open the exact
`http://SERVER-IP:3000/login`, complete a forced password change, and confirm
the session reaches the dashboard.

For preferred HTTPS, follow the exact commands, access impact, and rollback
procedure in `security-hardening-runbook.md`. That approval-gated step copies
the rendered Caddy configuration, starts the privileged HTTPS service, trusts
the internal CA on managed clients, and optionally enables the macOS
application firewall with Caddy allowed.

On the Mac mini in HTTPS mode:

```bash
curl -I http://127.0.0.1:3000/login
launchctl print "gui/$(id -u)/com.moldpilot.app"
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl -kI "https://SERVER-IP/login"
```

On another factory computer or phone connected to the same LAN, open:

```text
https://SERVER-IP/login
```

Expected in HTTPS mode: Next.js appears only as `127.0.0.1:3000`; Caddy owns
the LAN-facing HTTPS listener; requests outside the configured factory CIDR
are rejected. Verify the browser shows a trusted certificate after the
internal CA is installed. Do not enable HSTS during the initial rollout.

Application logs:

```text
~/Library/Logs/MoldPilot/app.log
~/Library/Logs/MoldPilot/app-error.log
```

## 7. Immediate Security Steps

1. Log in as `admin`.
2. Change the bootstrap password immediately.
3. Confirm every seeded employee changes their password on first login.
4. Keep `.env` mode `0600` and outside Git.
5. Keep the production Git deploy key read-only.
6. Use the Admin UI and Prisma migrations for operational changes; do not edit
   live source or schema directly on the production checkout.

## 8. Deploy Future Releases

Push the reviewed commit from the development Mac, then run on the server:

```bash
cd ~/LJ_ERP/MoldPilot
bash scripts/server-deploy-macos.sh
```

The protected `.env` must contain `BACKUP_DIR` and
`BACKUP_AGE_RECIPIENT`. The deploy command only accepts a clean checkout, pulls
`main` with fast-forward-only, requires a successful encrypted off-machine
backup, validates deployment mode/base URL/cookie security before stopping the
app, verifies scanner settings, replaces `.next`, installs locked dependencies,
deploys migrations, verifies, builds, restarts, and checks `/login` at the
configured mode's health URL. It never seeds or resets production data.

Seed user upserts are credential-preserving as defense in depth: an existing
user keeps `passwordHash`, `forcePasswordChange`, `passwordUpdatedAt`, and
`lastLoginAt`. Production deployment still must not run a seed command.

Use `--no-pull` only when the desired commit is already checked out. Avoid
`--skip-tests` except during a documented emergency. `--skip-backup` is an
explicit emergency bypass and must be recorded; take a backup immediately when
the incident is stable.

## 9. Backups And Recovery

Generate an age identity on an offline recovery device. Put only its public
recipient in the production `.env`:

```text
BACKUP_DIR="/Volumes/FactoryBackup/MoldPilot"
BACKUP_AGE_RECIPIENT="age1..."
```

Render and inspect the LaunchAgent template, then obtain approval before loading
it:

```bash
set -a
source .env
set +a
bash scripts/render-backup-launchagent.sh \
  "$BACKUP_DIR" "$BACKUP_AGE_RECIPIENT"
plutil -lint "$HOME/Library/LaunchAgents/com.moldpilot.backup.plist"
```

Before accepting the server:

1. Run `bash scripts/backup.sh`.
2. Confirm a new `moldpilot-backup-*.tar.age` archive exists on the mounted
   off-machine volume with mode `0600`.
3. Restore it into an empty scratch database and separate scratch upload
   directory with `scripts/restore-backup-to-scratch.sh`.
4. Verify manifest hashes, database records, and at least one attachment.
5. Record the restore date and operator.

This LaunchAgent runs only while the dedicated server account is logged in. Use
a separately reviewed LaunchDaemon or NAS-native backup scheduler if logged-out
operation is required. Backups are versioned and never overwritten; retention
deletion is disabled unless explicitly configured.

GitHub is not a database or attachment backup.

## 10. Legacy Workbook

The active machine seed uses the reviewed JSON fixture and does not parse the
legacy `.xls`. The workbook must remain untrusted until the separately approved
quarantine operation runs both ClamAV and Office-aware `olevba` locally:

```bash
bash scripts/quarantine-legacy-workbook.sh --plan
# After explicit approval:
bash scripts/quarantine-legacy-workbook.sh --move
```

Do not upload this workbook to a public scanning service and do not call it
malware-free solely because the tools find no obvious indicator.
