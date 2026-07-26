# Docker D1 Runtime Foundation

## Status

Docker Milestone D1 proves that MoldPilot can build and run as a standalone,
non-root Next.js container. It is a development/runtime foundation only.

**D1 is not approved for production cutover.** The native Mac mini
Homebrew/launchd deployment remains operational and is the accepted rollback
path. D1 does not change the parent LJ_ERP Compose structure, shared PostgreSQL,
Caddy, production backup, live migrations, or production data.

The independently verified D1 checkpoint is
`f4af0e7 Docker D1: add standalone container runtime foundation`. D2.1 now
hardens the active container contract with private clamd scanning and
persistent-file proof; see `docker-d2-private-scanner-storage.md`.

## Runtime Shape

```text
health/live  -> Next process only
health/ready -> PostgreSQL + upload/quarantine + clamd PING

container (UID 10001)
  Next standalone :3000 on 0.0.0.0
  /data/uploads
  /data/quarantine
       |
       +-- PostgreSQL on private database network
       +-- clamd on private scanner network
```

The final image uses the multi-architecture manifest for
`node:24.18.0-bookworm-slim`, pinned by digest. It installs only the OpenSSL
runtime needed for predictable Prisma compatibility, copies the traced
standalone runtime, `.next/static`, `public`, and required startup helpers, and
runs as UID/GID `10001:10001`.

The image entrypoint validates production authentication configuration,
required runtime variables, PostgreSQL URL shape, separate absolute storage
paths, and writable directories. It then `exec`s `node server.js`, so the Next
server is PID 1 and receives SIGTERM directly.

The entrypoint never runs migrations, seed, reset, local pilot setup, or the
host Homebrew ClamAV check. After D2.1 it requires explicit clamd configuration
and never silently falls back to the local-command backend.

## Required Runtime Environment

Inject these values when the container starts; never bake them into the image:

```text
NODE_ENV=production
MOLDPILOT_DEPLOYMENT_MODE=production
MOLDPILOT_SESSION_SECRET=<generated secret>
MOLDPILOT_BASE_URL=<actual HTTP or HTTPS origin>
MOLDPILOT_SESSION_COOKIE_SECURE=auto|true|false
DATABASE_URL=<PostgreSQL URL>
MOLDPILOT_STORAGE_DIR=/data/uploads
MOLDPILOT_QUARANTINE_DIR=/data/quarantine
MOLDPILOT_SCANNER_MODE=clamd
MOLDPILOT_CLAMD_HOST=clamav
MOLDPILOT_CLAMD_PORT=3310
MOLDPILOT_CLAMD_CONNECT_TIMEOUT_MS=3000
MOLDPILOT_CLAMD_HEALTH_TIMEOUT_MS=5000
MOLDPILOT_CLAMD_RESPONSE_TIMEOUT_MS=10000
MOLDPILOT_CLAMD_SCAN_TIMEOUT_MS=600000
MOLDPILOT_CLAMD_MAX_STREAM_BYTES=335544320
MOLDPILOT_READINESS_TIMEOUT_MS=7000
```

`MOLDPILOT_SESSION_COOKIE_SECURE` must match the base URL scheme under the
existing production validator. The storage paths must exist, be distinct, and
be writable by UID 10001.

## Build

From the MoldPilot repository:

```bash
docker build -t moldpilot:d1 .
```

The Docker build uses a syntactically valid, non-secret PostgreSQL URL only in
the builder stage. Runtime credentials are absent from the final image config
and layers. `.dockerignore` excludes `.env`, uploads, storage, backups, RAW,
generated exports, browser artifacts, local logs, and offline caches.

## Health Endpoints

`GET /api/health/live`

- Always dynamic and `Cache-Control: no-store`.
- Returns `200` and `{ "status": "ok" }` when Next can serve requests.
- Does not query PostgreSQL.

`GET /api/health/ready`

- Always dynamic and `Cache-Control: no-store`.
- Executes a minimal PostgreSQL query and write/delete probes in the configured
  upload and quarantine directories, plus a bounded exact clamd `PING`/`PONG`.
- Returns `200` with component states only when all checks pass.
- Returns `503` with `ready`/`unavailable` component states when a dependency
  fails. It never returns filesystem paths, database URLs, credentials, SQL
  errors, daemon output, or stack traces.

The Docker `HEALTHCHECK` uses Node's built-in `fetch` against liveness, so curl
is not part of the image.

## Disposable Smoke Test

Run:

```bash
pnpm docker:d1:smoke
```

After D2.1 this command is a compatibility alias to `pnpm docker:d2:smoke`.
Preserving the command keeps old review instructions working without restoring
the scanner-blind D1 runtime. The hardened runner:

1. Generates a unique disposable Compose project name and temporary
   random test credentials.
2. Builds the application, a separate disposable migrator target, and the exact
   pinned ClamAV runtime.
3. Starts PostgreSQL 16 and clamd on separate internal-only Docker networks
   without publishing port 5432 or 3310.
4. Runs `prisma migrate deploy` once against only that disposable database.
5. Starts the read-only-root application with private `/tmp` and separate named
   release/quarantine volumes.
6. Verifies health, clean and infected scanning, outage/recovery, and file
   persistence across application-container replacement.
7. Verifies forbidden local-data paths and runtime secrets are absent from the
   production image.
8. Removes only the unique smoke containers, networks, volumes, fixtures, and
   temporary images on success, failure, SIGINT, or SIGTERM.

The runner rejects inherited database URLs or Compose names marked as
production. Only this uniquely scoped disposable runner uses Compose volume
deletion; production scripts must never use `docker compose down -v`.

## Verified D1 Result

- Final image: `moldpilot:d1`
- Uncompressed image size on the tested arm64 Mac: `112,530,778` bytes
  (`107.3 MiB`)
- Runtime identity: UID/GID `10001:10001`
- Docker health: `healthy`
- Liveness: HTTP `200`
- Readiness, including a real Prisma/PostgreSQL query: HTTP `200`
- Login page: HTTP `200`
- Disposable migrations: all 21 applied successfully
- Smoke environment and volumes: removed after verification
- Native `scripts/run-production-macos.sh`: unchanged

Image size can differ slightly between architectures without changing the
runtime contract.

## Remaining D2.2 Work

D2.1 completed private clamd integration and replacement persistence in a
disposable environment. These blockers remain before production cutover can be
proposed:

- Prove persistent upload/quarantine ownership, backup, restore, and rollback.
- Design platform Caddy routing, shared PostgreSQL connectivity, per-app
  deployment, migration orchestration, and rollback in the parent LJ_ERP
  infrastructure.
- Run production-like multi-architecture and graceful-shutdown verification.

Until those checks pass, keep the native Mac mini deployment and its existing
backup/security runbooks operational.
