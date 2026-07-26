# Docker D2.1 Private Scanner And Persistent Storage Proof

## Status

Docker Milestone D2.1 is an isolated development proof. It adds a private clamd
scanner contract and proves released and retained quarantined files survive
replacement of the MoldPilot application container.

**D2.1 is not a production deployment or cutover.** It does not change the
parent LJ_ERP Compose/Caddy topology, native launchd service, live PostgreSQL
database, production data, backup/restore, deploy, migration, or rollback path.
The native Mac mini deployment remains operational and continues to use its
local-command scanner.

The immutable D1 foundation checkpoint is:

```text
f4af0e7 Docker D1: add standalone container runtime foundation
```

Independent review found and D2.1.1 corrected a connected-socket listener gap
that could emit uncaught `ECONNRESET` between streamed writes. The correction
passed deterministic fault injection and the complete disposable proof. The
combined D2.1/D2.1.1 checkpoint is:

```text
8680d63 Docker D2.1: finalize crash-safe private scanner and persistent storage proof
```

It is not deployed.

## Scanner Backends

MoldPilot now has an explicit scanner backend:

- `local`: preserves native Homebrew/local-command scanning. Missing scanner
  mode defaults to this backend only for native compatibility.
- `clamd`: streams files from disk through the official clamd `INSTREAM`
  protocol. Container startup requires this mode explicitly and rejects a local
  scanner command; there is no fallback.

The clamd client sends `zINSTREAM\0`, four-byte big-endian chunk lengths,
64 KiB file chunks with socket backpressure, and a zero-length terminating
chunk. It accepts only the exact clean response as clean. `FOUND` is infected.
Daemon `ERROR`, malformed or oversized responses, disconnects, timeouts, input
growth, and scanner size rejection are unavailable/error and fail closed.

The 300 MiB upload is streamed from disk. It is not loaded into application
memory as one buffer.

## D2.1.1 Transport Lifecycle

Each scan and PING socket now has one continuous lifecycle owner. It installs
meaningful `error`, `end`, and `close` listeners before connect and retains them
until actual socket close. There is no listener gap before the first write,
between disk-stream chunks, between the final framed write and response reader,
or after response completion before destruction.

Connection refusal, `ECONNRESET`, `EPIPE`, write failure, premature end/close,
and connection/response/total timeout are controlled scanner-unavailable
results. Malformed response, daemon `ERROR`, oversized response, and invalid or
oversized input remain scanner-error results. Timers, file streams, operation
waiters, listeners, and sockets use idempotent cleanup. The implementation does
not use a process-level exception handler or a no-op socket listener.

A crash-observable child process, running with strict unhandled-rejection
behavior and no process exception handlers, injected 30 resets immediately
after the daemon received `INSTREAM`. Before the correction this fixture
terminated on an unhandled `ECONNRESET`; afterward all 30 scans returned
`unavailable`, the child exited 0 with empty stderr, and no listener warning was
emitted. Separate deterministic tests cover reset between 64 KiB chunks, idle
connected-socket failure, premature close, and PING reset.

## Pinned ClamAV Runtime

The disposable service derives from:

```text
clamav/clamav:1.4.5-debian13-slim@sha256:0542880c8abebb7430be5366657aec561f03693ed7be4e64a45fd2ee60b08d02
```

That digest is an OCI multi-architecture manifest. The D2.1 run verified its
arm64 variant on Apple Silicon. The scanner uses the official supported
`/init-unprivileged` entrypoint and the image's `clamav` account, UID/GID
`1000:1000`. The application remains UID/GID `10001:10001`.

The signature database is a named disposable volume mounted read-only by the
daemon. A networkless, capability-limited one-shot helper prepares fresh volume
ownership, then a networkless unprivileged helper copies the image's bundled
signature files when the volume is empty. The daemon root filesystem is
read-only and all capabilities are dropped.

Clamd is reachable only on the Compose `scanner` internal network shared with
the application. Port 3310 is never published. PostgreSQL uses a separate
internal network.

## Size And Memory Limits

`docker/clamav/clamd.conf` uses:

```text
StreamMaxLength 320M
MaxFileSize 320M
MaxScanSize 512M
MaxScanTime 600000
AlertExceedsMax yes
```

These settings cover the current 300 MiB application upload maximum while
mapping ClamAV limit rejection to a fail-closed result.

ClamAV signature loading is memory intensive. The D2 smoke refuses to start
unless the Docker Linux VM reports at least **4 GiB** of memory. Allocate 4 GiB
or more in Docker Desktop; 3 GiB is the practical lower bound documented by the
official image, not the accepted MoldPilot preflight threshold.

## Container Scanner Configuration

The disposable container uses:

```text
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

Validation rejects missing/invalid values, a non-private D2 endpoint, a local
scanner command in container mode, known development session secrets, and
production session secrets shorter than 32 characters. `.env.example`
documents both backends without storing real credentials.

## Health Contract

`GET /api/health/live` checks only that Next.js can serve a request. It remains
HTTP 200 during database, storage, or scanner outages.

`GET /api/health/ready` runs bounded checks for:

- PostgreSQL
- released-file storage
- quarantine storage
- exact clamd `PING`/`PONG`

It returns HTTP 200 only when every component is ready. Otherwise it returns
HTTP 503 with only `ready`/`unavailable` component states. Paths, connection
strings, credentials, daemon output, SQL errors, and stack traces are never
returned. Readiness recovers automatically after clamd recovers.

## Disposable Proof

Run:

```bash
pnpm docker:d2:smoke
```

The runner creates a unique Compose project and:

1. Refuses production-marked inherited configuration and insufficient Docker
   memory.
2. Builds temporary application, migrator, and pinned ClamAV runtime images.
3. Starts isolated PostgreSQL, signature initialization, and private clamd.
4. Applies existing migrations and inserts only a synthetic smoke account,
   permissions, client, and project.
5. Confirms PING and full readiness.
6. Generates a valid PDF at runtime, uploads it, and verifies its released
   download hash.
7. Constructs EICAR at runtime from non-contiguous fragments, verifies infected
   rejection, and confirms no released file or database record exists.
8. Stops clamd, verifies upload HTTP 503, liveness HTTP 200, readiness HTTP 503,
   no release/database record, and retained private quarantine.
9. Restarts clamd and waits for readiness to recover to HTTP 200.
10. Force-recreates only the app container, then confirms both the released
    download and retained quarantine file have unchanged SHA-256 hashes.
11. Removes only the run's unique containers, two networks, four volumes,
    fixtures, and three temporary images on success, failure, or interruption.

`pnpm docker:d1:smoke` is retained as a documented compatibility alias to this
hardened disposable proof. The original D1 implementation remains preserved in
the checkpoint above; the active runtime must not regress to scanner-blind
readiness.

## Verified D2.1 Evidence

On the Apple Silicon development Mac:

- Docker VM memory: 7.8 GiB
- application UID/GID: `10001:10001`
- clamd UID/GID: `1000:1000`
- temporary app smoke image: 112,559,287 bytes
- pinned ClamAV base image: 185,922,220 bytes
- derived ClamAV runtime image: 185,921,137 bytes
- focused clamd lifecycle tests: 16/16 pass
- repeated reset stress: 30/30 controlled `unavailable`, child exit 0, empty
  stderr
- clean PDF: released and recorded
- EICAR: HTTP 422, not released or recorded
- scanner outage upload: HTTP 503, retained only in quarantine
- outage liveness/readiness: HTTP 200 / HTTP 503
- recovered readiness: HTTP 200
- released-file SHA-256 before and after app replacement:
  `b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
- retained-quarantine SHA-256 before and after app replacement:
  `b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
- cleanup: all run-scoped containers, networks, volumes, and temporary images
  removed

Hashes identify deterministic disposable fixtures, not business files.
Architecture-specific image sizes may vary.

## Remaining D2.2 Blockers

Before production cutover can be proposed:

- complete D2.2.1 correction and the full production-shaped disposable
  rehearsal documented in `docker-d2-production-package.md`
- preserve native Caddy and native MoldPilot as the rollback path through D3
- establish version control and release distribution for the parent `LJ_ERP`
  platform package
- rehearse representative real production backup/restore and rollback during
  D3 without modifying live data until the approved maintenance window
- verify the complete app acceptance/golden path against restored
  representative data before cutover

Do not describe MoldPilot as containerized in production until those items and
the D3 rehearsal/cutover acceptance are complete.
