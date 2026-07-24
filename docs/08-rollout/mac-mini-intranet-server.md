# Mac Mini Intranet Server

This is the source-of-truth setup for running MoldPilot on a dedicated Mac mini
inside the factory LAN.

## Deployment Shape

- The Mac mini uses wired Ethernet and a router DHCP reservation.
- GitHub stores source and migration history only.
- The production checkout uses a read-only GitHub deploy key.
- Native Homebrew PostgreSQL 16 stores operational data on the Mac mini.
- Homebrew Node.js 24 runs the built Next.js application.
- A per-user launchd agent keeps MoldPilot running after login and restarts it
  after a process failure.
- Uploads live outside Git under `~/MoldPilotData/uploads`.
- Database dumps and upload mirrors go to a NAS or external disk.
- Python and Docker Desktop are not required for production.

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
6. Keep internet router port forwarding disabled. Port 3000 is for the trusted
   factory LAN only.

## 2. Reserve A Stable LAN Address

A stable address is required because phones and desktops will bookmark
`http://SERVER-IP:3000`.

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

## 4. Run The One-Time Bootstrap

After the deployment scripts have been committed and pushed from the
development Mac:

```bash
cd ~/LJ_ERP/MoldPilot
git pull --ff-only origin main
bash scripts/server-bootstrap-macos.sh --production
```

The script:

1. Checks Apple Command Line Tools.
2. Installs Homebrew from the official installer when missing.
3. Installs Homebrew `node@24` and `postgresql@16`.
4. activates pnpm 11.5.3.
5. Starts PostgreSQL as a login service.
6. Generates a random database password and session secret.
7. Writes a protected `.env`.
8. Creates persistent upload storage.
9. Applies Prisma production migrations.
10. Bootstraps real users, roles, permissions, clients, machines, and the
    process-sheet template without demo projects.
11. Runs typecheck, domain tests, and the production build.
12. Installs and starts `com.moldpilot.app` through launchd.

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

## 5. Verify Intranet Access

On the Mac mini:

```bash
curl -I http://127.0.0.1:3000/login
launchctl print "gui/$(id -u)/com.moldpilot.app"
```

On another factory computer or phone connected to the same LAN, open:

```text
http://SERVER-IP:3000/login
```

If macOS asks whether Node may accept incoming connections, allow it. Do not
expose PostgreSQL port 5432 or MoldPilot port 3000 through the internet router.

Application logs:

```text
~/Library/Logs/MoldPilot/app.log
~/Library/Logs/MoldPilot/app-error.log
```

## 6. Immediate Security Steps

1. Log in as `admin`.
2. Change the bootstrap password immediately.
3. Confirm every seeded employee changes their password on first login.
4. Keep `.env` mode `0600` and outside Git.
5. Keep the production Git deploy key read-only.
6. Use the Admin UI and Prisma migrations for operational changes; do not edit
   live source or schema directly on the production checkout.

## 7. Deploy Future Releases

Push the reviewed commit from the development Mac, then run on the server:

```bash
cd ~/LJ_ERP/MoldPilot
BACKUP_DIR="/Volumes/FactoryBackup/MoldPilot" bash scripts/server-deploy-macos.sh
```

The deploy command only accepts a clean checkout, pulls `main` with
fast-forward-only, optionally backs up, stops the app before replacing `.next`,
installs locked dependencies, deploys migrations, verifies, builds, restarts,
and checks `/login`. It never seeds or resets production data.

Use `--no-pull` only when the desired commit is already checked out. Avoid
`--skip-tests` except during a documented emergency.

## 8. Backups And Recovery

Set `BACKUP_DIR` to a mounted NAS or external drive and use
`scripts/com.moldpilot.backup.plist` for nightly backups. Before accepting the
server:

1. Run `BACKUP_DIR="/Volumes/..." bash scripts/backup.sh`.
2. Confirm the compressed SQL dump is larger than 10 KB.
3. Confirm `uploads-mirror` contains expected files.
4. Restore the dump into a scratch database.
5. Open at least one restored project and attachment.

GitHub is not a database or attachment backup.
