# MoldPilot

Phase 1 is the Mold Trial Tracker. The first app module focuses on the trial control loop:

```text
Plan trial -> trial happens or is missed -> record reason/result -> track issues
-> set next trial date -> count completed trials against the limit
```

## Shipped modules (status 2026-07-07)

- **Trial control loop** — intake, scheduling, results, issues, corrections, trial limits, digital process sheets, activity log, bilingual EN/zh-CN UI.
- **Phone task list + PWA** — role-scoped tasks inline on the mobile dashboard (`/` below the KPI numbers); department inbox with claim flow; installable to the home screen. Phone = view and complete assigned items; all creation is desktop.
- **File attachments** — photos (thumbnail grids + lightbox), CAD (STEP/IGS/DWG/DXF), video (inline playback, Range streaming), Office/ZIP; per-type size caps; visibility tiers with IP-safe defaults (CAD/video default TECHNICAL; CUSTOMER_SAFE is never a default).
- **Trial issue photos** — client-side downscale, photos ride the issue form, count chips + galleries everywhere.
- **QC measurement reports** — per completed trial: amber "Missing" until QC uploads; Marketing downloads customer-safe files as `<project>_<trial>_measurement-report.<ext>`; dashboard missing-report count.
- **Date confirmation handshake** — PM proposes → Injection confirms with a machine or counter-proposes → Marketing approves/returns date changes (customer-target gap shown); never blocks recording reality.
- **Trial calendar** — `/calendar` month grid with per-day machine-load warnings (amber ≥3, red ≥4 on one machine); phones get a 7-day agenda; "This week's trials" on the mobile dashboard.
- **KPI phase-1 data layer** — admin Rules tab (deadline hours editable, changes logged), scoring engine (85% habit bar, <5-events floor, severity-weighted verified-only points), admin Scores tab with item-level audit drilldown, personal `/score` page gated by the staff-scoreboard toggle (default OFF for quiet baseline gathering). Design docs: `docs/06-kpi/`. Training posters: `docs/07-training/`.

### KPI & operations scripts

```bash
node scripts/simulate-kpi-data.mjs [--reset]  # generate ~6 weeks of MP-SIM- test activity with known persona scores
node scripts/run-kpi-snapshot.mjs             # persist daily KpiSnapshot rows (schedule nightly via launchd in production)
node scripts/run-kpi-snapshot.mjs --verify F  # recheck an archived snapshot JSON against its integrity code
node scripts/debug-my-plate.mjs <username>    # explain why an issue does/doesn't appear on someone's task list
pnpm training:examples [-- --reset]           # local MP-DEMO- training projects; actors resolve by role and --reset removes MP-DEMO- data/files only
pnpm training:examples -- --production-confirm "CREATE MP-DEMO TRAINING DATA" # production pilot only, after a verified backup; normal production use refuses
python3 scripts/migrate-and-verify.py         # migrate + seed + typecheck + tests in one go (restart dev server after)
pnpm slice:export -- --months 3 --out DIR     # dev slice: 1-12 months of sanitized activity (--out must be outside the repo; CLI only, never a web endpoint)
# A slice is not a backup: no password hashes, in-window projects only, trial photos <=400 KB. Safe for dev laptops, still confidential.
pnpm slice:import -- --slice DIR              # load a slice into a FRESH, empty dev database (gates: not production, manifest integrity, same migration, empty target; --dry-run checks without writing)
# Import gives every user the password "slice-dev-login" with a forced change at first login; the export carries no real hashes.
```

### Security & operations notes

- **Changing a password logs out the other devices.** Sessions are signed
  cookies with no server-side table; a cookie issued before the account's current
  `passwordUpdatedAt` (60 s clock-skew grace) is rejected like an expired one. The
  device that performs the change gets a fresh cookie and stays signed in; an
  admin reset logs the target out everywhere without touching the admin's session.
- **The monthly KPI snapshot is tamper-evident.** Each run writes a JSON archive
  and prints an `Integrity code / 校验码` — the first 12 hex characters of the
  SHA-256 over the snapshot data. Read it aloud at the prize meeting, write it on
  the page the CEO and both referees sign, and recheck later with `--verify`. Keep
  the JSON file with the signed page; the rows behind it also travel in the nightly
  encrypted database dump. It evidences tampering; it does not prevent database
  edits. Archive path: `MOLDPILOT_KPI_SNAPSHOT_DIR` if set, else
  `<MOLDPILOT_STORAGE_DIR>/kpi-snapshots/` — which `scripts/backup.sh` already
  tars, so the archive rides off-machine with the nightly backup — else
  `storage/kpi-snapshots/` in a plain development checkout.
- **Health endpoints for ops.** `GET /api/health/live` returns `200 {"status":"ok"}`
  from the Next process alone. `GET /api/health/ready` (also `HEAD`) runs bounded
  probes of PostgreSQL, upload storage, quarantine, and the scanner, returning
  `200` only when all four pass and `503` otherwise, with component verdicts and
  no error detail. Both are unauthenticated and uncached by design — the launch-agent
  capture wrapper and every ops smoke script curl them headlessly. Bound the probe
  with `MOLDPILOT_READINESS_TIMEOUT_MS` (default 7000, accepted range 500–60000).
- **Backup key escrow.** The private age identity lives in two sealed physical
  copies (office safe + off-site) and is drilled quarterly — see
  `docs/08-rollout/security-hardening-runbook.md` §7a.

## End-to-end smoke test

`pnpm test` covers the pure domain rules but never actually renders a page or hits
a route. `pnpm e2e:smoke` fills that gap: it forges role session cookies and drives
a running app to catch the bugs unit tests structurally cannot — pages that explode
at runtime, routes with broken auth, and pipeline wiring gaps.

**When to run:** after every migration or feature that touches a page, server
action, route, or the seed/simulator — and once more right before a pilot launch.

**Two-terminal recipe** (needs a seeded DB and MP-SIM- simulator data):

```bash
# One-time data prep, if not already present:
pnpm prisma:seed
node scripts/simulate-kpi-data.mjs

# Terminal 1 — keep the app running:
pnpm dev

# Terminal 2 — run the sweep:
pnpm e2e:smoke
```

It runs three parts and prints a pass/fail summary (exit 0 = all green, 1 = any
failure):

- **PART A** — page sweep across `/`, `/login`, `/me`, `/score`, `/calendar`,
  `/projects/[code]`, `/admin` (all tabs) and `/change-password` as admin, PM,
  Injection, Marketing, Design and viewer, asserting status, a role-appropriate
  sentinel, and the absence of any runtime-error boundary; plus negative-auth
  checks (unauthenticated → login, viewer → admin blocked).
- **PART B** — the `/api/attachments/[id]` route: auth, visibility (INTERNAL vs
  TECHNICAL), inline content-type, and 401/403/404/Range behaviour.
- **PART C** — DB golden-path pipeline assertions (prisma + pure domain, no HTTP):
  confirmed trials, resolved auto-misses, on-disk attachment files, verified-issue
  scoring, KPI leader groups, and the rule registry.

Each precondition (dev server down, DB unseeded, simulator data missing) fails with
a one-line instruction instead of a stack trace. Override the origin with
`MOLDPILOT_BASE_URL` (or `BASE_URL` / `PORT`).

## Stack

- Next.js + TypeScript
- Prisma
- PostgreSQL
- Tailwind CSS
- Node built-in test runner for the first pure domain tests

## Run the Local Pilot

Use Node 24+ and pnpm 11+. From a fresh checkout:

```bash
pnpm install
pnpm pilot:start
```

`pnpm pilot:start` creates `.env` from `.env.example` if needed, starts Docker PostgreSQL when Docker is available, runs Prisma generate/migrate/seed, verifies `MP-PILOT-001`, then starts the Next.js dev server.

Keep that terminal open. The website is available only while the dev server is running.

Open `http://localhost:3000` in Chrome. Prefer `localhost:3000` over `127.0.0.1:3000` unless Next dev origins are configured.

### One-command Mac runner

From Terminal:

```bash
cd /Users/ipwaikei/Documents/LJ_ERP/MoldPilot
./scripts/run-local-pilot.sh
```

That script checks Node, pnpm, and Docker Desktop, runs `pnpm install`, prepares the database and seed fixture, then starts the website.

You can also run the root launcher:

```bash
cd /Users/ipwaikei/Documents/LJ_ERP/MoldPilot
./run-moldpilot.command
```

If using Finder, double-click `run-moldpilot.command`. If macOS says it cannot run, use the Terminal command above.

### Offline dependency cache

`pnpm install` usually needs internet the first time. Docker may also need internet the first time to pull `postgres:16`.

While online, create the offline cache:

```bash
cd /Users/ipwaikei/Documents/LJ_ERP/MoldPilot
pnpm offline:cache
```

This creates `~/.moldpilot-offline/` (outside the repo by default) with:

- A pnpm package store archive for offline npm dependency install.
- A `postgres:16` Docker image archive if Docker Desktop is running.

The cache lives **outside** the project checkout on purpose: an in-repo cache bloats the Next.js/Turbopack file watcher and persistent cache and can hang the dev server. Override the location with the `MOLDPILOT_OFFLINE_DIR` environment variable (it must resolve outside the repo).

Migrating an existing setup: if you have an old in-repo `.moldpilot-offline/`, move it once with `mv .moldpilot-offline ~/.moldpilot-offline`.

Later, without internet, install from the cache:

```bash
cd /Users/ipwaikei/Documents/LJ_ERP/MoldPilot
pnpm offline:install
./scripts/run-local-pilot.sh
```

The local runner also detects the offline cache automatically and uses it instead of a normal online `pnpm install`. A legacy in-repo `.moldpilot-offline/` is still honored, with a warning to move it.

Offline mode still requires Node 24+, pnpm, and Docker Desktop already installed on the Mac.

If you only want to prepare the database and seed data without starting the website:

```bash
pnpm pilot:setup
```

For a detailed environment report:

```bash
pnpm pilot:preflight
```

The preflight checks Node, pnpm, Prisma Client availability, `DATABASE_URL`, PostgreSQL reachability, migrations, seed readiness, Docker availability, and port 3000. If PostgreSQL is missing, it prints the next command to run instead of a raw Prisma stack trace.

### Path A: Docker Desktop PostgreSQL

Use this path when Docker Desktop is installed and `docker --version` works:

```bash
pnpm pilot:db
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm pilot:check
pnpm dev
```

Keep `.env` as:

```bash
DATABASE_URL="postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public"
```

Open `http://localhost:3000` in Chrome while `pnpm dev` is still running.

With the dev server running, open a second terminal and run:

```bash
pnpm pilot:check
```

When port 3000 is already serving Next dev, `pilot:check` also smoke-tests `/` and `/projects/MP-PILOT-001`.

### Path B: Existing Local PostgreSQL

Use this path when Docker is not available or you already run PostgreSQL through Postgres.app, Homebrew, or another local service.

Example `.env` for Postgres.app or a local trust-auth database owned by your macOS user:

```bash
DATABASE_URL="postgresql://ipwaikei@localhost:5432/moldpilot?schema=public"
```

Replace `ipwaikei` with your macOS account name if different.

Example `.env` for a local user/password database:

```bash
DATABASE_URL="postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public"
```

Example `.env` for any custom PostgreSQL instance:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/moldpilot?schema=public"
```

Create the database before migrating. For Postgres.app or Homebrew with your macOS user, this is usually enough:

```bash
createdb moldpilot
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm pilot:check
pnpm dev
```

For a user/password setup, create the role and database first:

```bash
createuser moldpilot --pwprompt
createdb -O moldpilot moldpilot
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm pilot:check
pnpm dev
```

If anything fails, rerun:

```bash
pnpm pilot:preflight
```

It will tell you whether to start Docker Desktop, start Postgres.app, start Homebrew PostgreSQL, update `DATABASE_URL`, run migrations, seed data, or free port 3000.

### Pilot Commands

```bash
pnpm pilot:preflight  # explain local environment readiness and missing next steps
pnpm pilot:db         # start Docker PostgreSQL if Docker Desktop is available
pnpm pilot:setup      # prepare .env, DB, migrations, seed, and pilot fixture
pnpm pilot:start      # run setup, then start the website at localhost:3000
pnpm offline:cache    # while online, cache npm packages and optional postgres:16 image
pnpm offline:install  # while offline, install dependencies from the local cache
pnpm pilot:reset      # reset migrations, seed, then verify the pilot fixture
pnpm pilot:seed       # run Prisma seed and verify the pilot fixture
pnpm pilot:check      # verify DB, migrations, seed, dashboard data, and optional HTTP smoke
```

`pnpm prisma:seed` runs through the Prisma 7 `migrations.seed` setting in `prisma.config.ts`, which points to `node prisma/seed.ts`, then verifies the `MP-PILOT-001` fixture.

## Run A Mac Mini Intranet Server

The production Mac mini does not need Docker Desktop. The supported server path
uses Homebrew Node.js 24, pnpm 11.5.3, native PostgreSQL 16, Caddy TLS,
local ClamAV scanning, a fresh-database-only production bootstrap, and a
launchd application service. Preferred HTTPS keeps Next.js on
`127.0.0.1:3000` behind Caddy. The documented temporary factory-LAN HTTP mode
binds only to the stable address in `MOLDPILOT_BASE_URL`, warns that credentials
are unencrypted, and must never be internet-exposed.

The bootstrap intentionally does not install Homebrew through `curl | bash`.
After installing a reviewed official Homebrew package, the direct deployment
wrapper can install missing application packages, configure the protected
origin, restore the verified initial database, build, start the launch agent,
and optionally activate Caddy:

```bash
cd ~/LJ_ERP/MoldPilot
bash scripts/server-first-deploy-macos.sh \
  --base-url https://192.168.0.11 \
  --trusted-cidr 192.168.0.0/24 \
  --install-prerequisites \
  --activate-https
```

Add the documented restore archive, SHA-256, and age-identity arguments when
transferring the accepted clean production database. Router configuration,
client certificate trust, firewall, backup scheduling, and legacy-workbook
operations remain explicit approval-gated steps. See
`docs/08-rollout/mac-mini-intranet-server.md`.

Deploy later releases with:

```bash
cd ~/LJ_ERP/MoldPilot
bash scripts/server-deploy-macos.sh
```

`BACKUP_DIR` and `BACKUP_AGE_RECIPIENT` must be configured in the protected
production `.env`; a normal deploy stops if its encrypted off-machine backup
fails. Use a router DHCP reservation for the Mac mini's wired Ethernet address.
See `docs/08-rollout/mac-mini-intranet-server.md` for deploy-key, TLS,
certificate, network, scanner, backup, and restore instructions.

The initial test suite covers the Phase 1 domain rules documented in `docs/03-build/acceptance-tests.md`, especially trial-limit calculation and required workflow validations.

## Phone access (`/me` My Plate + PWA)

`/me` is the phone-first personal task list — everything waiting on the logged-in user, actionable in a few taps and installable to the home screen. It is the intended phone experience; the dashboard and project pages stay a desktop tool.

### Serve on the factory LAN

Use the production Mac mini deployment above. Preferred access is
`https://<reserved-server-ip>/me` through approved Caddy after the MoldPilot
internal CA is installed. During the explicitly accepted temporary HTTP pilot,
staff use `http://<reserved-server-ip>:3000/me` only on the trusted factory LAN;
router port forwarding must remain disabled.

- `MOLDPILOT_BASE_URL` must be the exact HTTP or HTTPS origin staff use.
- `MOLDPILOT_DEPLOYMENT_MODE=production` prevents local pilot/seed launchers.
- `MOLDPILOT_SESSION_COOKIE_SECURE=auto` follows that origin's scheme.
- The reverse proxy restricts requests to the configured factory CIDR and pins
  the expected Host value when HTTPS mode is active.
- Initial rollout deliberately does not enable HSTS.
- There is **no service worker / offline cache** by design — stale factory data is worse than an error page, so phones always fetch live data (or see an error when off-network).

### Add to the home screen

- **iOS Safari**: open the configured `MOLDPILOT_BASE_URL` with `/me`, tap the Share button, then **Add to Home Screen**. Launching the icon opens MoldPilot standalone (no browser chrome) straight to `/me`; if not logged in it redirects to the login page first.
- **Android Chrome**: open the same URL, then use the **⋮** menu → **Install app** / **Add to Home screen**. The app installs with the MoldPilot monogram icon and opens standalone to `/me`.

The manifest (`src/app/manifest.ts`) sets `start_url` `/me`, `standalone` display, and the brand theme color; icons live in `public/icons` (regenerate with `node scripts/generate-pwa-icons.mjs`).

## Seed Fixtures

The seed creates the acceptance-test fixtures from `docs/03-build/acceptance-tests.md`:

- Healthy T0 Planned
- Delayed T0
- T0 Correction
- Client Feedback Issue
- Pending Customer Feedback
- Near Limit
- At Limit
- Over Limit
- Design Change Allowance
- Custom Limit
- Realistic Pilot Fixture: `MP-PILOT-001`

`MP-PILOT-001` is the main manual pilot fixture. It includes a missed T0, completed-not-approved T0, technical/injection/QC/client-feedback issues, T1 planned with reason, an approved post-T0 design change, trial limit movement from 3 to 4, and ActivityLog entries for the workflow.

See `docs/03-build/pilot-acceptance-checklist.md` for the pilot smoke checklist.
