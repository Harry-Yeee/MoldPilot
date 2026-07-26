# MoldPilot Development Log

This file records implementation attempts, failures, removals, fixes, and lessons learned.

Use it as engineering memory. The decision log explains product direction; this file explains what we tried in the build and why it worked, failed, or needs replacement.

## When To Add An Entry

Add an entry when work changes how future development should proceed, especially when:

- A coding prompt produces a meaningful milestone.
- A technical approach works and should be reused.
- A technical approach fails or is removed.
- Code passes but does not test the real workflow enough.
- A docs/code mismatch is found.
- A future Coder prompt should avoid repeating a mistake.

Small typo fixes and ordinary styling tweaks do not need entries unless they reveal a larger lesson.

## Entry Format

```text
### YYYY-MM-DD: Short Title

Context:

Tried:

Result:

Why:

Decision:

Verification:

Related Docs:
```

## Entries

### 2026-07-26: Docker D3.1 Native Transfer Regression Coverage

Context:

The platform needed synthetic proof that native PostgreSQL, released
attachments, and retained quarantine could be captured and restored into the
container package before any Mac mini or real-data rehearsal. MoldPilot's
existing native backup v1 did not include retained quarantine or source
migration metadata and was not sufficient as a cutover unit.

Tried:

The parent platform added a non-mutating sanitized inventory, encrypted native
cutover format v2, a production-only launch-agent capture wrapper, a
service-control-free capture core, a strict restore core, and a generated
`moldpilot-d3-rehearsal-*` restore runner. MoldPilot adds package regression
coverage for:

- mode-`0600` aggregate inventory with no database URL, password hash,
  attachment key, or business value in the report
- production capture confirmation, external-volume requirement, app-only
  freeze, and EXIT-trap service restoration
- custom PostgreSQL dump, uploads, retained quarantine, recovery config,
  source app/migration metadata, and SHA-256 manifests in v2
- explicit recognition but rejection of native backup v1 for D3 cutover
- unsafe archive/checksum paths, corrupt manifests, unsupported formats,
  non-empty targets, and production-like resource rejection
- one target migration invocation, private FreshClam/clamd, loopback-only app,
  inventory/hash parity, credential-silent login, and scoped cleanup

A pre-Docker safety pass found that archive entry validation alone did not
validate paths named inside checksum manifests, and that a retained cleanup
state file was being sourced as shell. The platform now validates every
manifest path and parses cleanup state as constrained data.

Result:

The focused production-package suite passes 19/19, including an executable
inventory test. The complete MoldPilot suite passes 671/671 across 133 suites;
Prisma validation, lint, strict typecheck, and production build also pass. The
first full-suite run exposed one existing local-scanner timing test at 1,004 ms
against a 1,000 ms threshold; it passed in isolation and the immediate complete
rerun passed 671/671.

The exact-commit Docker D3.1 smoke passed. The synthetic source and restored
target both reported 1 user, 1 role, 2 permissions, 1 customer, 1 machine,
1 project, 1 trial, 1 issue, and 1 attachment. The target migration command ran
once, login succeeded with the preserved password hash, and the attachment
remained byte-identical with SHA-256
`62bc93abf3cf35368458bf0c5b634c890eb0d7ad832aea2c023697813003486f`.
The retained quarantine hash remained
`9080c582d0d21bdf11aa0a64d93f701ac19a4ff9fe5f050d17af0993710d0e5e`.

Corrupt-manifest, unsafe-path, unsupported-format, non-empty-target,
production-like-name, and simulated-capture-failure cases were rejected.
Cleanup removed the generated source and restore resources, images, archives,
identities, and fixtures. No Prisma schema, application workflow, native
service, production data, or Caddy state changed.

Why:

MoldPilot owns the schema, migrations, login, permissions, attachment route,
and file layout whose preservation D3 must prove. The app test suite therefore
pins the parent platform package without moving production control into the app
repository.

Decision:

Keep native `scripts/backup.sh` v1 available for existing routine recovery, but
do not use v1 for a future container cutover. D3.1 remains synthetic and not
deployed. A real inventory/capture/restore rehearsal requires a separate
approved operator session.

Verification:

- focused platform package tests: 19/19 pass
- full MoldPilot tests: 671/671 pass across 133 suites
- Prisma validate, lint, typecheck, build: pass
- platform distribution and disposable D3.1 Docker smokes: pass
- restored sanitized inventory, attachment hash, and quarantine hash: exact
  match
- target migration invocations: 1; restored login: pass
- all six negative paths: rejected; generated cleanup inventory: empty
- Mac mini, native launchd/PostgreSQL/Caddy, and live data: untouched

Related Docs:

- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../ops/README.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-26: Docker D2.3.1 Release-Guard Regression Coverage

Context:

The shared D2.3 platform lifecycle worked from a distributable checkout, but
protected paths were not bounded against the complete platform and MoldPilot
Git trees. Current/previous app identities and release environment updates also
needed a single fail-before-mutation contract.

Tried:

The parent platform added canonical path rejection for existing paths,
symlinked aliases, and future outputs; normal and deployment-transition release
verification; explicit current/previous full Git SHAs with exact-SHA image
tags; running-image verification; and one atomic six-key environment
transition. MoldPilot's production-package tests now exercise those helpers
with disposable Git repositories and fake Docker commands.

Coverage proves:

- environment, Caddy, backup, scratch archive, and offline identity paths are
  rejected anywhere beneath either checkout
- symlink aliases cannot bypass the boundary
- stale backup and dirty rollback fail before Docker, backup, or replacement
- status and logs remain available for diagnosis
- normal and deployment-transition identity rules remain distinct
- app/migrator tags correspond to explicit current/previous SHAs
- a successful atomic update changes every release key together
- a simulated update failure leaves the environment byte-for-byte unchanged

The first real lifecycle run exposed a macOS Bash 3.2 behavior that the Node
test had missed. Under `set -u`, expanding the empty update array before its
first element produced `updates[@]: unbound variable`. The helper now guards
the first expansion and the regression executes with nounset enabled. The
lifecycle updater was also removed from an OR-list so a future shell-fatal
error cannot appear successful to its EXIT cleanup.

Result:

The focused platform package suite passes 16/16 and the complete MoldPilot
suite passes 668/668 across 132 suites. The corrected disposable lifecycle
started app `3b1fc87b014e84278857b1e9a35da06f8b805abf`, deployed
`85507c366dfebfeedb1524313ad7d8ac4c8605fe`, and rolled back to the first
image. PostgreSQL, clamd, and FreshClam IDs did not change. Login, attachments,
dual-SHA encrypted backup/scratch restore, and all 21 migration records
survived. Attachment SHA-256 remained
`a1cd25fb2d3a1ccfa539414f0b75ce41932a56c0c119820c9413d1f113d5bf1f`.
Disposable containers, images, volumes, networks, archives, bundles, and
fixtures were removed.

No Prisma schema, product workflow, native service, production environment, or
live data changed.

Why:

The app release must be provably tied to its clean source, explicit SHA, exact
image tag, and running container before an operational script mutates state.
During deploy only, the new source target and old running backup identity must
coexist without ambiguity.

Decision:

Keep D2.3.1 as the final local corrective rehearsal before D3. Do not deploy,
push, reload Caddy, use launchctl, stop native services, or modify live data.

Verification:

- D2.3.1 package tests: 16/16
- complete domain suite: 668/668, 132 suites
- Prisma validation, lint, typecheck, and build: pass
- distribution, production-shaped, and deploy/rollback rehearsals: pass
- exact disposable cleanup: pass

Related Docs:

- `../../../docs/platform/decision-log.md`
- `../../../docs/platform/architecture-and-roadmap.md`
- `../../../docs/platform/development.md`
- `../../../ops/README.md`

### 2026-07-26: Docker D2.3 Versioned Platform Lifecycle Foundation

Context:

MoldPilot D2.2.1 passed from app commit `e7caaa1`, but the parent `LJ_ERP`
operations package had no Git identity. A MoldPilot release could therefore not
prove which shared preflight, backup, restore, deploy, or Compose source governed
it.

Tried:

The parent was initialized as a platform-only repository before any D2.3 files
were staged. MoldPilot and the other independent app directories are ignored,
not tracked or added as submodules. The protected environment now carries both
the parent release SHA and MoldPilot release SHA. Platform preflight requires
both clean checkouts and exact configured identities; deploy preparation checks
an explicit app target SHA.

Backup metadata now records both release identities. Scratch restore reports
and can assert both. Parent distribution is exercised from a temporary Git
bundle checkout, while every MoldPilot, ClamAV, and backup-helper image context
comes from an exact committed archive.

A guarded disposable lifecycle script uses independent temporary MoldPilot
checkouts at `HEAD^` and `HEAD`, invokes the real app-control and deploy/rollback
scripts, and verifies encrypted backup, explicit migration, app-only replacement,
scratch restore, login, attachment persistence, unchanged PostgreSQL/clamd/
FreshClam identities, and the non-reversal of migrations on image rollback.

Result:

The source implementation and package guards passed 662/662 MoldPilot domain
tests across 132 suites. Prisma validation, lint, strict typecheck, production
build, parent distribution, D2.2 compatibility, and D2.3 lifecycle proofs all
passed from clean local checkpoints.

The lifecycle started from app `e7caaa1`, deployed app `e1c7f6d`, and restored
`e7caaa1`. Login and the released attachment survived both transitions;
attachment SHA-256 remained
`a1cd25fb2d3a1ccfa539414f0b75ce41932a56c0c119820c9413d1f113d5bf1f`.
PostgreSQL, clamd, and FreshClam container IDs did not change. The mandatory
pre-deploy backup, post-deploy scratch restore, and pre-rollback backup passed
with both platform and app release identities. All 21 migration records remained
after application rollback, as required. Generated containers, volumes,
networks, images, archives, bundles, and fixtures were removed.

No product workflow, Prisma schema, native service, production configuration,
or live data was changed.

Why:

The app and platform are independent release units. Recording both commits makes
an encrypted backup and deployment auditable without combining their Git
histories.

Decision:

Keep D2.3 as the final infrastructure rehearsal before D3. Do not deploy, push,
import live data, reload Caddy, or stop native services.

Verification:

- D2.3 package source tests: 10/10 pass
- complete MoldPilot domain suite: 662/662 pass, 132 suites
- shell syntax and `git diff --check`: pass before checkpoint
- platform distribution rehearsal: pass
- D2.2 production-shaped compatibility rehearsal: pass
- D2.3 actual deploy/rollback lifecycle rehearsal: pass
- dependency IDs, login, attachment hash, dual-SHA restore, migration retention,
  and exact cleanup: pass

Related Docs:

- `docs/08-rollout/docker-d2-production-package.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.2.1 FreshClam Initialization Correction

Context:

The first D2.2 production-shaped rehearsal failed before application startup.
The long-running FreshClam service started as root with only `CAP_CHOWN` and
then attempted to become UID/GID 1000 through `setpriv`. Linux rejected the
identity transition with:

```text
setpriv: setresuid failed: Operation not permitted
```

Static Compose tests had checked the intended final identity but had not
executed the runtime transition. Granting `SETUID`, `SETGID`, `SYS_ADMIN`, or
broad capabilities to a networked updater was not acceptable.

Tried:

Reused the initialization pattern already proved by the disposable D2 smoke.
The scanner image now contains two idempotent helpers. A root, networkless,
read-only one-shot job with only `CAP_CHOWN` normalizes the dedicated signature
volume and leaves it owned by `1000:1000`. A second networkless, capability-free
job runs as `1000:1000`, seeds bundled signatures only when the volume is empty,
and verifies that at least one non-empty signature database exists.

The long-running FreshClam service now starts directly as `1000:1000`, has all
capabilities dropped, a read-only root filesystem, and only its signature
volume and tmpfs writable. It performs no runtime identity transition. clamd
remains private, capability-free, and `1000:1000`, with read-only signature
access and automatic `SelfCheck` reload.

The parent production rehearsal now refuses a dirty MoldPilot worktree and
builds the app, migrator, and derived ClamAV image from one `git archive HEAD`
release context. It also verifies initializer exits, runtime identities,
FreshClam stop/start on an existing volume, clean/EICAR/outage behavior,
app-only replacement isolation, encrypted backup, scratch restore, and exact
disposable cleanup.

The first clean-source rerun passed both initializer jobs and reached the
directly unprivileged FreshClam process. It then exposed a second runtime-only
configuration mismatch: the bundled FreshClam configuration attempted to open
`/var/log/clamav/freshclam.log` on the read-only root filesystem. The CLI
`--stdout` flag changes console output but does not suppress that configured
file. The service now explicitly overrides the log path with
`--log=/tmp/freshclam.log`, keeping the log in its existing bounded tmpfs
without adding a writable root path or capability.

The next clean-source rerun reached a healthy application container but found
that Docker activated no host binding. Compose had configured
`127.0.0.1:3100 -> 3000`; however, the app was attached only to the
`internal: true` database and scanner networks, so the Docker host route had no
gateway network. A dedicated app-only edge bridge now carries only the
loopback-published HTTP path. Database and scanner networks remain internal,
and PostgreSQL 5432 and clamd 3310 remain unpublished.

The production workflow then exposed four script-contract defects that unit
tests had not exercised. Next server-action login returned a successful HTTP
200 response and required browser-style multipart fields, so the helper now
uses `--form-string`, requires the `moldpilot_session` cookie, and proves the
authenticated dashboard. The backup helper received Prisma's
`?schema=public` URL, which `pg_dump` rejects as an unknown libpq parameter, so
only that helper now uses the plain PostgreSQL URL. Scratch verification moved
psql variables from `--command` to stdin so substitution is applied. Finally,
the attachment verification query used nonexistent `created_at`; the actual
mapped column is `uploaded_at`. Source-level package tests now guard each
correction.

Result:

The corrected topology passes shell syntax, Compose rendering, Prisma
validation, 659/659 domain tests, lint, strict typecheck, production build, and
the isolated D2 scanner/storage smoke. In that smoke, the clean PDF and retained
quarantine file kept SHA-256
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
across app replacement. EICAR returned HTTP 422, scanner outage returned HTTP
503 while liveness stayed 200 and readiness became 503, and readiness recovered
after clamd restart. Cleanup removed the run-scoped containers, two private
networks, four volumes, and three temporary images.

The full production-shaped rehearsal passed from exact clean commit
`853f04e2e3e4aa53c50ff89e5e1e6d2614449730`. Both initializer jobs exited 0;
FreshClam and clamd ran as `1000:1000`; FreshClam survived stop/start on the
same signature volume; real login, clean upload/download, fragmented EICAR
rejection, scanner-outage 503/recovery, app-only restart/replacement, encrypted
backup, and isolated restore all passed.

The restored scratch stack contained one synthetic project and one attachment.
The attachment retained SHA-256
`171320f8998c508c92d99f78d87054bc793c1219e6dee56de29af0a40a94880a`
before app replacement and after scratch restore. The encrypted archive was
`175659064` bytes. The final app/migrator/ClamAV/backup-helper image sizes were
`112555635`, `366678214`, `185924421`, and `155897800` bytes. Cleanup removed
all uniquely named rehearsal and scratch containers, networks, volumes,
fixtures, archives, and temporary images; pre-existing
`lj-erp-postgres` remained healthy with container ID `98818de5d024`.

D2.2 is accepted as a production-shaped package and disposable rehearsal only.
It is not deployed, D3 has not started, and native production services and live
data remain untouched.

Why:

Privilege belongs in a short-lived, networkless initialization boundary, not in
a long-running network client. Building every app-owned image from one clean
commit also makes the rehearsal evidence attributable to exact source instead
of a mixture of committed and working-tree files.

Decision:

Use one-shot signature ownership and seed jobs. Run FreshClam and clamd directly
as `1000:1000` with no capabilities. Keep native Caddy and native MoldPilot as
the production path until D3 is separately approved. The unversioned parent
`LJ_ERP` platform package still needs an approved source-control and release
strategy before D3.

Verification:

- `bash -n ../ops/scripts/*.sh`: pass
- `bash -n ../ops/docker/backup/*.sh`: pass
- `bash -n ../ops/docker/postgres/*.sh`: pass
- `bash -n docker/clamav/*.sh`: pass
- `pnpm exec prisma validate`: pass
- `CI=true pnpm test`: 659/659 pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass
- `pnpm docker:d2:smoke`: pass
- first clean-source production rehearsal: initializer jobs passed; FreshClam
  log-path mismatch found; exact disposable cleanup passed
- second clean-source production rehearsal: FreshClam passed; missing active
  loopback binding on internal-only app networks found; exact cleanup passed
- subsequent rehearsals found and corrected server-action multipart login,
  backup-helper libpq URL, psql stdin-variable, and attachment timestamp-column
  probes; each failed run removed all disposable resources
- corrected `bash ../ops/scripts/moldpilot-production-smoke.sh`: pass from
  clean commit `853f04e2e3e4aa53c50ff89e5e1e6d2614449730`
- scratch restore: one project, one attachment, manifest verification pass,
  restored release SHA matched `853f04e2e3e4aa53c50ff89e5e1e6d2614449730`
- Docker cleanup audit: no rehearsal/scratch resources or temporary images;
  pre-existing `lj-erp-postgres` ID `98818de5d024` unchanged and healthy
- `git diff --check`: pass before checkpoint

Related Docs:

- `docs/03-build/acceptance-tests.md` (AT-035)
- `docs/08-rollout/docker-d2-production-package.md`
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `../ops/README.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.1.1 Crash-Safe Clamd Transport Lifecycle

Context:

Independent D2.1 review found that the connected clamd socket could have no
`error` listener between individual writes. Twelve of 30 injected resets
escaped as uncaught `ECONNRESET`, so an ordinary Node process could terminate
instead of returning the required scanner-unavailable result.

Tried:

Added a crash-observable child-process fixture before changing the client. The
old implementation consistently exited on an unhandled socket `ECONNRESET`
immediately after the fake daemon received `INSTREAM`.

Replaced per-write transport ownership with one operation-wide
`ClamdSocketLifecycle`. It installs `error`, `end`, and `close` listeners before
connect and keeps them until the socket actually closes. Connect, every framed
write, file-stream gaps, response reading, the post-response/pre-destroy window,
and total-timeout cancellation all race against the same controlled lifecycle
failure. Transport failures map to scanner unavailable; malformed/daemon-error/
oversized protocol or input failures remain scanner error. Cleanup of timers,
response listeners, file streams, operation waiters, and the socket is
idempotent.

Added deterministic tests for an idle connected-socket error, listener
continuity after response completion, reset immediately after `INSTREAM`, reset
after the first 64 KiB chunk, premature close, PING reset, and a strict
child-process stress run of 30 mid-stream resets. The child installs no
`uncaughtException` or `unhandledRejection` handler, so a process crash remains
observable.

Result:

Worked. The focused clamd suite passed 16/16. The child process completed all
30 resets with 30 controlled `unavailable` results, exit code 0, empty stderr,
and no uncaught exception, unhandled rejection, `ECONNRESET`, `EPIPE`, or
`MaxListeners` warning. The complete suite passed 652/652.

The real disposable Docker proof also passed. Clean PDF release, fragmented
runtime EICAR rejection, scanner-outage HTTP 503, liveness/readiness 200/503,
readiness recovery, and released/quarantined persistence across app replacement
were unchanged. Both persistence hashes remained
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`.
The app image was 112,559,287 bytes; pinned ClamAV base/runtime images were
185,922,220/185,921,137 bytes. The app and clamd ran as 10001:10001 and
1000:1000.

Why:

A connected EventEmitter socket must always have meaningful transport-failure
ownership. Temporary write listeners cannot cover failures while awaiting the
next disk chunk or moving from writes to response handling. A global process
handler or no-op socket listener would hide the defect instead of returning a
fail-closed upload result.

Decision:

Use the continuous socket lifecycle for both clamd scan and PING operations.
Keep D2.1 uncommitted and not deployed until review accepts this corrective
evidence. Do not start D2.2 or modify parent production Compose/Caddy, native
production services, the live database, or live data.

Verification:

- `pnpm exec prisma validate`: pass
- `CI=true pnpm test`: 652/652 pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass
- `bash -n scripts/docker-d2-smoke.sh`: pass
- `pnpm docker:d2:smoke`: pass
- reset stress child: 30/30 controlled unavailable; exit 0; no stderr
- post-smoke disposable containers, networks, volumes, and images: empty
- pre-existing `lj-erp-postgres`: still healthy

Related Docs:

- `docs/03-build/acceptance-tests.md` (AT-034)
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.1 Private Clamd And Persistent Attachment Proof

Context:

The independently verified D1 container foundation was still uncommitted, and
its upload scanner depended on a host executable. Before wider platform work,
MoldPilot needed an isolated proof that a container could scan through private
clamd, remain fail closed, and retain released/quarantined files when only the
application container was replaced. Native Homebrew/launchd compatibility and
all live infrastructure had to remain unchanged.

Tried:

First verified that every dirty file belonged to D1, then created the immutable
checkpoint
`f4af0e7 Docker D1: add standalone container runtime foundation`. D2.1 work was
kept uncommitted for review.

Extracted the existing local-command scanner and added an explicit `local` or
`clamd` backend. The clamd client implements null-framed `INSTREAM`, four-byte
big-endian 64 KiB chunks, socket backpressure, a zero-length terminator, bounded
connect/health/response/total timeouts, disk streaming, a response-size cap,
and exact response parsing. Only exact clean releases a file. Native mode still
finds the existing Homebrew commands; container startup requires `clamd` and
rejects fallback configuration.

Added scanner PING to readiness while preserving independent liveness, hardened
production session-secret validation, and added a disposable Compose proof with
private database/scanner networks, app-owned upload/quarantine volumes, and a
digest-pinned ClamAV 1.4.5 Debian 13 slim image using
`/init-unprivileged`. A networkless capability-limited initializer prepares the
disposable signature volume; the daemon itself runs as `clamav` with a
read-only root and no capabilities.

Several infrastructure attempts failed before the final topology worked:

- the first exact-image pull received a transient registry 502 and succeeded on
  retry
- Docker Desktop deadlocked while copying image data into a new named ClamAV
  volume; `nocopy` plus explicit signature initialization removed that copy-up
  path
- bind-mounted files/directories also stalled this Docker Desktop installation,
  so the smoke now builds temporary derived ClamAV and probe images instead
- an unprivileged daemon could not create its local socket in a mode-1770
  `/tmp`; sticky mode 1777 fixed the official entrypoint without adding
  privileges
- the normal demo seed depended on a RAW workbook excluded from the image;
  a narrowly scoped synthetic SQL fixture now proves authorization and uploads
  without importing business/demo data
- signature-volume initialization needed idempotent ownership ordering before
  scanner restart could be proved

Result:

Worked. A real disposable clamd returned PONG; a runtime-generated valid PDF was
released and recorded; runtime-assembled EICAR returned HTTP 422 with no
released file, quarantine residue, attachment row, or activity row. With clamd
stopped, upload returned HTTP 503, liveness remained 200, readiness became 503,
no release/record occurred, and one quarantined file was retained. Readiness
returned to 200 after restart.

Force-replacing only the app container preserved both files. The released PDF
and retained quarantine each had SHA-256
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
before and after replacement. The identical hashes reflect the deterministic
PDF fixture used for both clean and outage paths. The app ran as 10001:10001;
clamd ran as 1000:1000. The app smoke image was 112,555,490 bytes; pinned
ClamAV base/runtime images were 185,922,220/185,921,137 bytes. Cleanup removed
the run's containers, two internal networks, four volumes, and three temporary
images.

Why:

clamd TCP has no authentication or transport encryption, so private network
containment is part of the security boundary. Streaming from disk preserves the
300 MiB upload contract without allocating a 300 MiB application buffer. A
separate local backend avoids breaking the accepted native deployment while
container work remains a parallel proof.

Decision:

Use private clamd for the container contract and local-command scanning for
native deployment. Keep `pnpm docker:d1:smoke` as a compatibility alias to the
hardened proof. Do not integrate parent production Compose/Caddy or claim
production readiness in D2.1. D2.2 owns backup/restore, platform networking,
secrets, migrations, deploy, independent operations, and rollback.

Verification:

`CI=true pnpm test` passed 646/646, including protocol framing, backpressure,
clean/infected/error/malformed/timeout/oversized paths, local compatibility,
bounded readiness, and source-level topology guards. The real
`pnpm docker:d2:smoke` passed the clean/EICAR/outage/recovery/persistence proof
on arm64 Docker Desktop with 7.8 GiB RAM. Prisma validation, lint, typecheck,
build, both Docker smoke commands, and final whitespace/cleanup inspection are
the required completion gates for this change set.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md` (AT-033, AT-034)
- `docs/08-rollout/docker-d1-runtime-foundation.md`
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `../docs/platform/`

### 2026-07-25: Docker D1 Standalone Container Runtime Foundation

Context:

MoldPilot needed a secure, reproducible standalone container proof before any
shared LJ_ERP production integration. The working native Homebrew/launchd Mac
mini deployment, live database, parent Compose file, backup, and rollback path
had to remain untouched. Container upload scanning is intentionally deferred to
D2.

Tried:

Enabled Next standalone output, added a digest-pinned Node 24.18.0
bookworm-slim multi-stage image, generated Prisma before build, and copied only
the standalone/static/public runtime plus required startup helpers. The final
image runs as UID/GID 10001, uses a Node/fetch liveness health check, validates
production authentication and writable persistent directories, and `exec`s the
standalone server without migrating or seeding.

Added dynamic no-store liveness and readiness routes. Readiness runs a minimal
Prisma/PostgreSQL query plus write/delete probes for upload and quarantine
directories, returning only component states. Added a unique, internal-network
Compose smoke runner with random test credentials, a separate one-time
migrator target, non-published PostgreSQL 16, read-only app root, scoped cleanup,
secret/image inspection, and non-root verification.

Two first attempts exposed useful packaging problems. A broad explicit Prisma
trace glob pulled stale cached Prisma packages and made local standalone output
430 MiB. Removing that glob let Next trace the actual generated 7.8.0 runtime
while retaining the explicit CJK font; standalone fell to 73 MiB and the real
readiness query proved Prisma worked. The first Debian-slim build also warned
that OpenSSL was missing. Installing only Debian's `openssl`/`libssl3` in build
and runtime stages removed the warning; it was not ignored.

Result:

Worked. The final arm64 image is 112,530,778 bytes (107.3 MiB), runs as
10001:10001, reports Docker health `healthy`, and returns HTTP 200 for liveness,
readiness, and `/login`. The smoke migrator applied all 21 migrations only to
its disposable database. Both smoke runs removed their uniquely named
containers, networks, and volumes. Final image inspection found no `.env`, RAW,
storage, generated data, or baked runtime secret/configuration. The native
`scripts/run-production-macos.sh` file was unchanged.

Why:

A buildable image is not a production architecture. Keeping migrations in a
separate disposable target and requiring runtime configuration prevents normal
container startup from mutating data. Liveness must not depend on PostgreSQL;
readiness must fail without revealing dependency details. D1 stops before
production because uploaded files still need a container-compatible fail-closed
scanner and tested persistent backup/restore path.

Decision:

Keep D1 as a parallel development foundation. Do not modify parent LJ_ERP
infrastructure or cut over production. D2 owns ClamAV service integration,
quarantine/release persistence, storage backup/restore, and later platform
proxy/database/deploy/rollback design. Keep native launchd operational.

Verification:

`pnpm exec prisma validate`, `CI=true pnpm test` (632/632), `pnpm typecheck`,
and `pnpm build` passed. `docker build -t moldpilot:d1 .` passed from the pinned
multi-architecture digest without Prisma/OpenSSL warnings. The final
`pnpm docker:d1:smoke` passed all HTTP, PostgreSQL, health, identity, cleanup,
and image-content checks. Shell syntax and focused ESLint checks passed. No
Prisma schema/migration, live database, live service, shared Compose, or native
deployment file was changed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md` (AT-033)
- `docs/08-rollout/docker-d1-runtime-foundation.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-25: Security: Session Revocation On Password Change + Tamper-Evident KPI Snapshot

Context:

Two risks left over from the pre-deployment sweep. First, sessions are stateless
signed cookies (`{ v, userId, issuedAt }`, 12-hour lifetime) with no server-side
session table, so a password change did NOT invalidate cookies already in the
wild — the stolen-phone case. An admin resetting a password produced a new
password and a still-working thief. Second, the monthly KPI snapshot that the CEO
and both referees sign at the prize meeting was unverifiable paper: nothing tied
the printed page to the numbers actually stored that night.

Tried:

*Session revocation.* Extracted the decision as a pure function
`isSessionRevoked(issuedAtMs, passwordUpdatedAtMs, skewMs)` in
`src/domain/security/session-revocation.ts` and applied it at the one place that
already loads the actor row after parsing the cookie —
`getOptionalCurrentUser()` in `src/server/current-user.ts`. `parseSessionToken`
now returns `{ userId, issuedAtMs }` instead of just the id, and the cookie
reader is `getSessionClaims()`; `getSessionUserId()` was removed so no caller can
obtain a user id without the revocation check. A revoked cookie returns `null`
exactly like an expired one, so `getCurrentUser()` performs the existing bare
`redirect("/login")` — no new user-facing string, no new i18n key.

*Skew constant.* `SESSION_REVOCATION_SKEW_MS = 60_000`. It covers two things: the
token stores `issuedAt` in whole seconds (`Math.floor(Date.now() / 1000)`), so a
cookie re-issued in the same action as the password write can read up to 999 ms
"older" than `passwordUpdatedAt`; and application/database clocks are not
identical. The boundary is inclusive — `issuedAt == passwordUpdatedAt - skew`
survives.

*Password paths.* Audited every write of `passwordHash`. Both already stamped
`passwordUpdatedAt = new Date()`: `changeOwnCredentials` (which serves BOTH the
self change and the forced first-login change) and `resetUserPassword` (admin
reset). Nothing needed adding. Admin *user creation* deliberately leaves
`passwordUpdatedAt` null, matching `seededUserCreateCredentials` — a brand-new
account has no sessions to revoke, and null means "never revoked".

*Self-session-survives design decision (deployment-checklist item 17).*
`changeOwnCredentials` already called `setSessionCookie(updated.id)` after the
transaction; that call is now load-bearing rather than incidental and is
commented as such. The order matters: write `passwordUpdatedAt`, then re-issue
the cookie, then redirect. The alternative — carving out "the session that
performed the change" — would need session identity we do not have in a
stateless cookie. Re-issuing is simpler and strictly safer: every *other* cookie
for that user is now older than `passwordUpdatedAt` and dies on its next request.
Added one guard for a case the new check would otherwise regress: an admin
resetting their OWN password through the admin form gets a re-issued cookie too
(`if (updated.id === actor.id)`), so they keep working and still hit the forced
first-login gate instead of being bounced to `/login` mid-task. Resetting
somebody else never touches the admin's cookie.

*Tamper-evident snapshot.* `src/domain/security/snapshot-integrity.ts` is a
dependency-free pure module (SHA-256 is injected, so `src/domain` gains no Node
built-in import) providing `canonicalizeForIntegrity`, `snapshotIntegrityHash`,
`formatIntegrityCode`, `buildSnapshotFile`, and `verifySnapshotFile`.
Canonicalization: object keys sorted by code unit, array order preserved,
`undefined` members dropped, `-0` normalised to `0`, non-finite numbers and
`Date` values rejected (callers must pre-serialise to ISO strings so the hashed
bytes are exactly the stored bytes). `scripts/run-kpi-snapshot.mjs` now writes a
JSON archive alongside the `KpiSnapshot` rows. The hash covers the `data` section
only — `snapshotDate`, `months`, `rowCount`, and every snapshot row
(`month`/`scopeType`/`scopeId`/`metrics`, sorted by that key) — and deliberately
excludes `generatedAt` and the `integrity` block itself, so re-running over
unchanged data reproduces the same code. The run prints month, generated-at, row
counts by scope, archive path, and the first 12 hex characters as
`Integrity code / 校验码: XXXX-XXXX-XXXX`. `--verify <file>` recomputes and prints
PASS/FAIL; it is handled before the Prisma import, so verification needs no
database. Archive path defaults to `storage/kpi-snapshots/kpi-snapshot-<date>.json`
(override with `MOLDPILOT_KPI_SNAPSHOT_DIR` or `--out`), written mode `0600`.

Result:

Worked. `npx tsc --noEmit` clean; `node --test tests/domain/*.test.ts` 623/623
(was 594 — 29 new). `--verify` exercised for real on a synthetic archive: PASS,
then a one-character `sed` edit of a metric produced FAIL with exit 1 and both
"recomputed hash does not match" and "printed integrity code does not match".

No database, dev server, migration, seed, or Prisma client generation was
involved — the sandbox has none of those. Everything asserted here is either a
pure unit test, a source-level wiring assertion, or the DB-free `--verify` path.
The two-browser and admin-reset behaviours are reasoned from the code and still
need Harry's manual run (see `deployment-checklist.md` item 17).

Why:

A stateless cookie cannot be deleted server-side, but every authorising request
already fetches the user row for permissions — so the revocation check is free:
no extra query, no session table, no schema change (`passwordUpdatedAt` already
existed). Reusing the expired-session path means a revoked cookie needs zero new
UX.

For the snapshot, the honest claim is narrow: the chain is *signed paper ↔
integrity code ↔ archived JSON (nightly backup, off-machine)*. It EVIDENCES
tampering after the fact. It does not prevent anyone with database access from
editing rows, and it is not a signature — anyone who can rewrite the rows can
also rewrite the archive file, which is why the signed paper (held by three
people) is the leg that cannot be edited from a keyboard. Precise about the
off-machine leg: `scripts/backup.sh` tars the database dump plus
`MOLDPILOT_STORAGE_DIR`, so the `KpiSnapshot` rows behind the code do travel in
the nightly encrypted archive, but `storage/kpi-snapshots/*.json` does NOT unless
`MOLDPILOT_KPI_SNAPSHOT_DIR` is pointed inside the backed-up uploads tree.
`backup.sh` was deliberately left alone (active owner). Operationally the archive
file is filed with the signed page; the numbers are recoverable from the dump.

Decision:

One clock-skew constant, in the domain layer, at 60 s. Changing your own password
keeps the current device signed in and logs out every other device — do not
"improve" this by clearing the cookie in the change action. Never read the
session cookie without the revocation check; use `getSessionClaims()` and pass
`user.passwordUpdatedAt` to `isSessionRevoked`. The KPI snapshot's hash covers the
`data` section only; if a field is added to a snapshot row, the hash changes by
design and old archives keep verifying against their own recorded hash.

Verification:

Gates: `npx tsc --noEmit` clean, `node --test tests/domain/*.test.ts` 623/623,
`npx eslint` clean on every changed file. New tests:
`tests/domain/session-revocation.test.ts` (null `passwordUpdatedAt` never
revokes; before/after/boundary; explicit and degenerate skews; whole-second
re-issue flooring; fail-closed on an unreadable issue time; plus wiring
assertions on `auth-session.ts`, `current-user.ts`, `auth-actions.ts`, and
`admin-actions.ts`) and `tests/domain/snapshot-integrity.test.ts`
(canonicalization, insertion-order independence, rejected value types, code
grouping, `generatedAt` exclusion, PASS/tamper-FAIL, missing-hash reporting).
Worked example, recorded so a future change is visible: the synthetic
three-row payload in that test hashes to
`464c39815679d0f85db073d4911e65eea0e87e2867d2ef11172dc9d20e1fd8a9`, integrity code
`464C-3981-5679`.

E2E implications: `scripts/e2e-smoke.mjs` needed NO change. Its forged cookies
use `issuedAt = Math.floor(Date.now() / 1000)` (now), and seeded users — admin
included — are created with `passwordUpdatedAt: null` via
`seededUserCreateCredentials`, which `seedManagedUserUpdate` preserves on
reseed. Null never revokes, so the null direction is green. If a seeded account
has been given a real `passwordUpdatedAt` on a dev database, a fresh forged
cookie is still newer than it, so that direction is green too. The smoke script's
temporary `forcePasswordChange` flip touches neither `passwordHash` nor
`passwordUpdatedAt`; a regression test now asserts both facts.

Related Docs:

- `docs/08-rollout/deployment-checklist.md` (items 7 and 17)
- `docs/08-rollout/security-hardening-runbook.md` (§7a key escrow + restore drill)
- `docs/08-rollout/conversations-workbook.md` (prize-meeting signing line)

### 2026-07-25: Production Cookie Scheme And Credential-Safe Reseeding

Context:

The live Mac mini pilot used an HTTP `MOLDPILOT_BASE_URL`, but production
sessions inferred `Secure=true` from `NODE_ENV`. Browsers therefore withheld
the session cookie during forced password change. The demo seed's user-upsert
update branch also reset password and login lifecycle fields, and local pilot
launchers could reach migrations/seed when pointed at a production `.env`.

Tried:

Added a pure `auto|true|false` session-cookie resolver and a production
configuration validator. `auto` follows the configured HTTP/HTTPS scheme and
falls back to Secure in production when no base URL is available. Production
bootstrap, deploy, and runtime validate deployment mode, base URL, and cookie
compatibility; deploy validates before stopping the service. Temporary HTTP
prints a prominent plaintext warning and binds only to the configured LAN host,
while preferred HTTPS remains loopback-only behind Caddy.

Added independent production-mode guards to `local-pilot.mjs` and the
double-click launcher before migration/seed paths. Refactored seed user data so
existing-user updates contain only seed-managed profile/role fields, while
new-user creates still receive hashed temporary credentials and first-login
enforcement.

Result:

Worked. Focused and full regression tests pass. A disposable PostgreSQL proof
created seeded users, changed Bill's password hash plus all three lifecycle
values, reran the seed, and confirmed `passwordHash`, `forcePasswordChange`,
`passwordUpdatedAt`, and `lastLoginAt` were unchanged. Newly created Bill first
had a non-plaintext hash, forced password change, and null lifecycle dates. The
disposable database was dropped and no test databases remain.

The first disposable migration attempt failed before seed because its manually
constructed TCP URL omitted the protected local Docker password. The cleanup
trap removed that database. The successful proof rebuilt the throwaway URL in
memory from protected `.env`, copied schema only (no business rows), and never
printed the credential.

Why:

Cookie security must match the connection the browser actually uses; Secure
cookies over HTTP break authentication rather than harden it. Seed files may
own pilot profile defaults but must never become password-reset tools for
existing accounts. Production markers provide a second boundary against an
operator accidentally using a local launcher on the server.

Decision:

Require `MOLDPILOT_DEPLOYMENT_MODE=production` and
`MOLDPILOT_SESSION_COOKIE_SECURE=auto` for normal server configuration. Accept
direct HTTP only as a temporary isolated-LAN choice with explicit warning;
prefer HTTPS/Caddy. Never run local pilot or seed commands on production even
though seed upserts now preserve existing credentials.

Verification:

Shell syntax checks passed for bootstrap, deploy, production runner, local
runner, and double-click launcher. Prisma validation passed. The complete suite
passed 594/594 tests. ESLint, strict typecheck, and the Next.js 16.2.11
production build passed. The HTTP/auto production checker resolved
`Secure=false` and printed the required warning. No live Mac mini migration,
seed, environment edit, or service restart was performed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-25: Security Remediation And Fail-Closed Production Controls

Context:

A security review found a vulnerable Next.js runtime, unaudited production
dependencies, direct LAN HTTP/port-3000 exposure, no persistent login backoff,
globally oversized Server Actions, large uploads trusted by extension/MIME,
no malware-scanning release gate, an unreviewed legacy `.xls`, optional
unencrypted backup behavior, an inactive backup scheduler, and a bootstrap path
that could execute the mutable Homebrew `curl | bash` installer.

Tried:

Updated Next.js to the patched 16.2.11 release and pinned the compatible Prisma
toolchain. Added database-backed HMAC-keyed account/source login throttling with
temporary progressive backoff, generic failures, dummy password verification,
and serializable concurrency retries. Replaced large upload Server Actions with
an authenticated streaming endpoint and private
quarantine -> signature/archive validation -> local ClamAV scan -> release
pipeline. Added per-type limits, ZIP/Office abuse checks, opaque storage keys,
partial/abandoned cleanup, and protected `nosniff` downloads. Reduced the
Server Action limit to 12 MB for the remaining compressed issue-photo path.

Changed the production runner to loopback-only Next.js, Secure cookies, trusted
proxy mode, and mandatory scanner health. Added a CIDR-restricted, host-pinned
Caddy internal-TLS template without HSTS. Hardened bootstrap to reject missing
reviewed Homebrew/Caddy/ClamAV prerequisites rather than executing a remote
installer. Replaced backups with versioned `age`-encrypted off-machine archives
and a guarded scratch restore; normal deploys now require a successful backup.
Moved active machine seed input to a reviewed JSON fixture and added an
approval-gated local ClamAV + `olevba` workbook quarantine script.

Result:

Application controls work and fail closed. The production build uses Next.js
16.2.11 without broad output-tracing warnings. All 21 migrations are applied to
the local MoldPilot database, including the additive login-throttle table.
`pilot:check` now tolerates the valid automatic transition of overdue seeded T1
from Planned to Auto Missed while still enforcing T1 sequence 2.

The current development Mac is **not** production-ready yet. Its protected
`.env` has no session secret; the shared Docker PostgreSQL listener is
`*:5432`; Caddy, ClamAV, age, and `olevba` are absent; HTTPS/certificate trust
and the backup scheduler are not active; no encrypted backup/restore drill has
run; and the legacy workbook remains in `RAW`. These are intentionally
unclaimed approval/setup steps. `pnpm audit --prod` is also pending explicit
consent because it transmits the private dependency inventory to npm.

Why:

Files must never become downloadable based only on client metadata, scanner
outages must not become availability bypasses, login backoff must survive
restart, and LAN deployment must not expose application or database plaintext
listeners. Machine-level service, certificate, firewall, database recreation,
secret rotation, scheduler, and destructive workbook actions need an operator
who understands their access impact and rollback.

Decision:

Keep Next.js on `127.0.0.1:3000` behind approved Caddy HTTPS and keep PostgreSQL
loopback-only. Require a healthy local scanner before production startup and
explicit clean scans before attachment release. Require encrypted off-machine
backup before routine deployment. Keep initial HSTS disabled. Follow
`docs/08-rollout/security-hardening-runbook.md` for every approval-gated
machine action; never upload business files to public scanning services.

Verification:

Prisma validation, ESLint, strict TypeScript, and the clean Next.js 16.2.11
production build passed. The full domain suite passed with 583 tests. Focused
security tests covered progressive throttling, concurrent persistence,
signature spoofing, double extensions, streaming overflow, ZIP traversal/bomb
limits, origin/auth ordering, fail-closed scanning, loopback/TLS config,
encrypted backup design, and workbook quarantine. `pilot:check` passed;
`e2e:smoke` passed 40/40; pilot data E2E passed; and the full browser/server
action workflow passed including bilingual mobile tasks, department-inbox
claim, PDF download/re-download, permissions, Admin lifecycle, and reports.
The temporary production server was observed on `127.0.0.1:3000` only and was
stopped afterward.

Related Docs:

- `docs/02-schema/schema-v0.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `docs/08-rollout/security-hardening-runbook.md`

### 2026-07-24: Mac Mini Production Bootstrap And Deployment Path

Context:

The target Mac mini had only Git installed. The repository had local-pilot and
backup helpers but no repeatable production prerequisite installer, no
application launch agent, and no safe production-only initialization path.
The existing Prisma seed also creates acceptance fixtures and updates seeded
credentials, so it must not become a routine live-server command.

Tried:

Added a macOS bootstrap using official Homebrew installation, Homebrew Node.js
24, pnpm 11.5.3, and native PostgreSQL 16. Added a production runner and
repeatable deploy script with clean-checkout, fast-forward pull, optional backup,
production migrations, verification, build, launchd restart, and health check.
Added a fresh-database-only production seed mode that skips demo projects,
forces Admin through first-login password change, and rejects any database with
users, projects, or activity logs. Documented wired Ethernet, router DHCP
reservation, power, security, backup, and recovery requirements.

Result:

Worked after two dry-run corrections. The first disposable-database review found
that the bootstrap's user-count query used Prisma's model name instead of the
mapped PostgreSQL table name. A separate SQL-path check found that psql
variables are not expanded inside the selected `-c` form. Both were corrected
before release. Native-PostgreSQL backup discovery and protected `.env` upload
path loading were also added so the server backup does not depend on Docker or
miss external uploads.

Why:

Production should be reproducible from a private Git clone without requiring
Python or Docker Desktop. Initialization must be distinct from fixture seeding,
and future deploys must never reset credentials or operational data.

Decision:

Use `server-bootstrap-macos.sh` once and `server-deploy-macos.sh` for later
releases. Keep production Git credentials read-only and work from a stable
router-reserved LAN address.

Verification:

`bash -n` passed for bootstrap, deploy, runner, and backup scripts.
`plutil -lint` passed for the backup launchd template. Prisma validation,
typecheck, the production build, and all 549 domain tests passed. A disposable
PostgreSQL database received all 20 migrations and the production bootstrap;
it contained 19 users, 14 roles, 90 clients, 26 machines, zero projects, and
Admin first-login enforcement. Re-running production bootstrap failed with the
fresh-database guard as intended. The disposable database and SQL-test role
were removed afterward.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-23: Pre-Push Hygiene And Deployment Verification

Context:

The active repository had accumulated generated process-sheet PDFs, a tracked Python bytecode cache, a v1-to-v2 training-poster reorganization, and a large set of completed but uncommitted feature work. The repository needed a source-only, deployment-verifiable commit before adding a cloud remote.

Tried:

Added `generated/`, `__pycache__/`, and `*.pyc` to `.gitignore`; removed previously tracked generated exports and bytecode from Git tracking without deleting local files. Verified that all six deleted v1 posters were preserved byte-for-byte under `docs/07-training/archive-v1/`, reviewed the three v2 replacements, and repaired one stale development-log path. Ran Prisma validation, domain tests, typecheck, the migration-and-seed verifier, a production build, and the HTTP/DB smoke sweep. The first smoke attempt hit a stale dev server after its `.next` cache had been cleared; the server was restarted before rerunning. Because the interrupted smoke process could not reach its `finally` cleanup, the five affected seeded first-login flags were restored explicitly and verified.

Result:

Worked. Generated exports and runtime caches remain available locally but are excluded from future commits. The production build no longer traces the whole repository through attachment storage, and the fresh-server smoke sweep passed all 40 checks. The seeded users `bill`, `lin`, `viewer`, `wang`, and `yvonne` again require a password change on first login.

Why:

Git should contain reproducible source, migrations, tests, and documentation, not generated customer exports, bytecode, uploaded files, secrets, or database data. Next development and production commands share `.next`; deleting or rebuilding that directory beneath a running server invalidates the live process and produces misleading runtime failures.

Decision:

Keep `generated/`, Python caches, `.env`, `storage/`, uploads, and database backups outside Git. Stop the development server before clearing `.next` or running a production build, then start a fresh server for HTTP smoke verification. After any interrupted smoke run, verify that temporary fixture-state changes were restored before continuing.

Verification:

`pnpm exec prisma validate` passed. `python3 scripts/migrate-and-verify.py` completed migrations, seed verification, typecheck, and 546/546 domain tests. `pnpm build` passed without the attachment-storage NFT warning. A fresh-server `pnpm e2e:smoke` passed 40/40 checks, and a direct database read confirmed all five affected `forcePasswordChange` flags are `true`.

Related Docs:

- `docs/07-training/README.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `README.md`

### 2026-07-17: End-To-End Smoke Harness Handles Fresh-Seed Login Gates

Context:

`pnpm e2e:smoke` forged valid session cookies for its role page sweep, but fresh seeded employee accounts still correctly had `forcePasswordChange = true`. Their requests were redirected to `/change-password`, so 13 authorization/page checks failed before reaching the intended screens. Two Admin sentinels also failed because rendered `&amp;` text was compared without decoding HTML entities.

Tried:

Kept the application login policy and seed state unchanged. The smoke runner now snapshots the tested users that are behind the first-login gate, temporarily clears only `forcePasswordChange`, and restores every changed flag in `finally`. Visible-text matching now decodes common named and numeric HTML entities before checking sentinels. Added source-level regression coverage for the narrow bypass, guaranteed cleanup path, and entity decoding.

Result:

Worked. The role sweep now reaches the intended pages while real login, password hashes, roles, permissions, and seeded first-login behavior remain unchanged. Cleanup is reported explicitly, and a restoration failure makes the smoke run fail.

Why:

A forged test session proves route authorization but does not represent completion of the first-login password workflow. Isolating that one fixture flag inside the smoke runner tests the requested pages without weakening the production guard or changing seed expectations.

Decision:

Keep first-login enforcement authoritative in the app. Any future forged-cookie page sweep must isolate and restore account workflow state rather than modifying authentication behavior.

Verification:

`pnpm e2e:smoke` passed 40/40 checks and logged restoration for all five temporarily changed employee accounts. `pnpm test` passed 523/523 tests, and `pnpm typecheck` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-14: Management Reports Implemented And Browser-Verified

Context:

The Reports contract was documented, but Admin/GM still had no management surface for monthly mold-trial workload, approval flow, issue health, trial-limit pressure, data gaps, and the already-built KPI Scorecards. Admin/GM also still needed navigation that did not send non-scored managers to an empty personal score page.

Tried:

Added `reports.management.view` to the named permission policy and seeded it for Admin/GM only. Built pure `Asia/Shanghai` month/range and aggregation helpers in `management-reports.ts`, then a batched explicit-select Prisma read service with separate report and Scorecards permission gates. Added a bilingual read-only `/reports` route with URL-backed Overview, Issues, and Scorecards tabs, compact operational metrics, Management Attention source links, issue filters/current backlog, and deliberate table-only horizontal scrolling. Reused `computeMonthlyScores`, the shared KPI rule-label loader, and `KpiScoresPanel`; Reports does not contain scoring math or Admin configuration controls. Added deterministic June/July fixtures plus stricter pilot checks and real Chrome role/language/mobile coverage.

Result:

Worked. The locked workload, T0, uniqueness, on-time denominator, earliest approval, target eligibility, low-loop, current limit, Open Critical, issue event/aging, completeness, and attention definitions are covered by pure tests. Admin and GM see Reports without My Score; scored staff retain My Score when enabled; a report-only grant does not serialize or render individual Scorecards. Reports loads no customer CRM/contact fields and preserves user-entered issue text in both languages. No Report model, schema change, migration, mutation form, or second KPI engine was added.

Why:

A read model over operational records is enough for the Phase 1 management meeting and keeps source records auditable. Pure aggregation makes the locked definitions testable, while the separate Scorecards gate prevents a broad report grant from leaking individual score data.

Decision:

Use `/reports` as the Phase 1 Admin/GM management surface. Current-state measures remain explicitly labeled Current; issue owners remain fixers, not culprits; completed runs are mold-trial workload, never factory utilization. Historical month-end reconstruction and a generic BI/report store remain out of scope.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed 489/489. `pnpm exec prisma validate`, `pnpm exec next typegen`, `pnpm exec tsc --noEmit`, `pnpm prisma:seed`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed. `pnpm pilot:workflow:e2e` passed the real Chrome walkthrough as Admin, GM, Injection, and Viewer, including report-only/Scorecards denial, English/Chinese switching, preserved issue text, and Overview/Issues containment at 360 px. The browser test initially found the wide Issues table contributing page-level overflow; the table kept its inner scroller and the Reports shell now clips only propagated page overflow. A Viewer account-label assertion was also aligned with the existing deduplicated `Viewer` identity.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/05-feature-prompts/09-management-reports.md`
- `docs/06-kpi/kpi-system-design.md`

### 2026-07-14: Management Reports Contract Captured Before Implementation

Context:

Admin/GM were sent toward `My Score` even though those roles are intentionally not scored. Management also lacked one monthly surface for trial workload, issue resolution, trial-limit pressure, approvals, and the existing group/individual scorecard audits.

Tried:

Reviewed the current dashboard navigation, personal `/score` route, Admin Scores implementation, KPI design, permissions, operational schema, and acceptance coverage. Defined `/reports` as a read-only management surface with Overview, Issues, and reused Scorecards tabs. Locked month boundaries and workload/approval/issue definitions before asking Coder to aggregate them.

Result:

The product, permission, schema/read-model, UI, KPI, build-plan, acceptance, and pilot-checklist docs now agree on the Reports milestone. A standalone feature prompt records the implementation scope. No application code or database schema was changed in this documentation pass.

Why:

Operational counts are easy to mislabel: completed trials are trial workload, not factory utilization; issue owners are fixers, not culprits; current issue state cannot honestly reconstruct a historical month-end state. Defining those boundaries first prevents a polished dashboard from presenting misleading management conclusions.

Decision:

Implement `/reports` next for Admin/GM with `reports.management.view`. Keep staff `/score`; reuse `kpi.scores.view_all` for individual scorecards; use live operational aggregates plus existing KpiSnapshots; add no generic Report table in Phase 1.

Verification:

Documentation consistency review only. Code, migration, domain, typecheck, and browser verification remain for the Coder milestone.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/06-kpi/kpi-system-design.md`
- `docs/05-feature-prompts/09-management-reports.md`

### 2026-07-14: Process Sheet Export Now Downloads A Reusable Customer-Safe Attachment

Context:

`exportProcessSheetPdf` generated a valid PDF but wrote it directly under `generated/process-sheet-exports`, created an incomplete `RESTRICTED` FileAttachment, and redirected with a success message. The browser never requested the protected attachment route, so clicking Export Customer PDF did not download anything and Marketing could not reuse the export from Customer Files.

Tried:

Changed the action to generate the PDF buffer once, persist it through `writeAttachmentFile()` with a server-generated attachment UUID, and create complete `PROCESS_SHEET_EXPORT` / `PROCESS_SHEET_PDF` metadata with `application/pdf`, actual size, and `CUSTOMER_SAFE` visibility. Replaced the redirecting form with a focused client export button that receives a serializable action result, fetches the protected attachment route with the authenticated session, validates status/MIME/size/`%PDF-` signature, triggers a browser download, refreshes project data, and shows local progress/result feedback.

Result:

Marketing, PM, and Admin retain the existing server-side export permission. Download authorization remains independently enforced by `/api/attachments/{id}`; Marketing's customer-safe permission does not grant Internal, Technical, or Restricted access. The generated export appears in Customer Files for reuse, and invalid or empty responses are rejected before a browser download link is clicked.

Why:

An export is only useful in the pilot when Chrome receives the file and the same approved customer-safe artifact remains available for later sending. Routing generated files through the attachment subsystem also keeps storage paths, metadata, authorization, and audit history consistent with uploaded reports.

Decision:

This restores the already-approved customer-safe Process Sheet PDF behavior. No schema, permission, or product-direction change was required.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed with 477 tests. `pnpm exec prisma validate`, `pnpm typecheck`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed. `pnpm pilot:workflow:e2e` passed the real Marketing browser flow: Chrome emitted and completed the `.pdf` download, the saved file was non-empty with a `%PDF-` signature, attachment metadata/ActivityLog counts and protected-route headers were correct, Customer Files refreshed with the export, and re-download created no duplicate records.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-14: My Tasks Uses The Shared Bilingual Language Source

Context:

The dashboard already read the `moldpilot_language` cookie, but `/me` derived its language from `User.locale`. The shared My Tasks client component also rendered English labels prepared by the server for trial status, issue status, severity, reason/status options, requester type, and generated titles such as `T0 trial`.

Tried:

Changed `/me` to read `getCurrentLanguage()`, added the shared Language Switcher in a wrapping mobile-safe header, and made `MyPlateSections` react directly to `useI18n()`. Stable enum/form values remain unchanged while visible labels pass through the existing dictionaries and `translateLabel()`. Generated trial titles now use the active language; user-entered mold/client/issue/note/file data remains untouched. Common task-action success messages are translated centrally on both `/me` and the dashboard.

Result:

The standalone and dashboard-embedded task panels now follow one cookie/provider language and switch together. Focused i18n, countdown, and My Plate tests plus direct TypeScript compilation passed. The browser workflow now checks Chinese and English task titles on both surfaces and asserts no header overlap or horizontal overflow at 360 px.

Why:

A database user locale can drift from the cookie/local-storage preference and cannot make an already-mounted client task panel react. Translating at render time keeps audit/business data stable and lets one shared component serve both task surfaces correctly.

Decision:

Keep `moldpilot_language` through LanguageProvider/getCurrentLanguage as the only UI-language source. Server-generated validation details that are not in the centralized workflow-message map continue to display their original text until their action APIs return stable message codes.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed with 473 tests. `pnpm exec prisma validate`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e` passed. The browser run also repaired two stale test assumptions discovered during verification: it now sets an explicit desktop viewport before desktop-only checks, and it recognizes the intentionally collapsed `Admin` account identity instead of waiting for lowercase username text.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-12: Pilot Preflight Updated For Design And KPI Group Membership

Context:

`python3 scripts/migrate-and-verify.py` stopped after a successful Prisma seed because the seed preflight still expected the earlier eight-role, seventeen-user account model and required every seeded user to have no `departmentGroupId`. The KPI leader-designation layer intentionally added the active Design role, Lin and Mei accounts, and reused `departmentGroupId` for KPI membership.

Tried:

Updated `scripts/pilot-preflight.mjs` to verify the current seed contract directly: nine active pilot roles, nineteen hashed-password users with expected Chinese names, exact KPI membership for scored users, unassigned non-scored users, Assembly A/B child-group hierarchy, designated KPI leaders, and no leader on the PM or Assembly parent groups.

Result:

The preflight now guards the implemented KPI structure instead of rejecting it as stale account-department data. This fixes the seed-stage false failure while keeping the verification strict enough to detect missing Design onboarding, incorrect membership, or broken leader assignments.

Why:

Seed verification must evolve with documented schema semantics. Removing the old assertion without replacing it would have hidden KPI fixture regressions; checking the exact intended structure turns the migration wrapper back into a useful end-to-end gate.

### 2026-07-11: Rule — Agents Never Touch the Generated Prisma Client

Context:

Twice, the "patch the generated client .d.ts, prove tsc reaches 0, restore byte-for-byte" verification procedure used by sandbox agents raced the Mac's own `prisma generate` through the bidirectional file sync: once producing ` 2`/` 3` conflict-copy files with a stale canonical client, and once silently clobbering a freshly regenerated client with the restored old one (the seed then failed with "Unknown argument `parentGroupId`" — the tell was the error's available-options list missing the new `kpiLeaderId` field entirely).

Decision:

Sandbox agents must never write inside `node_modules` for any reason. After a schema change, agents run tsc, list the stale-client-only errors BY NAME (every one must reference only the new fields/models), and stop there. Regeneration happens exclusively on the owner's machine (`pnpm prisma:generate`, dev server stopped), verified by grepping the generated client for a new field name.

Diagnostic tell for this failure class:

A PrismaClientValidationError whose "available options" list is missing a field that exists in schema.prisma = stale generated client, not a code bug. Fix: stop dev server → delete the generated client dir → `pnpm prisma:generate` → grep for the new field → restart.

Related Docs:

Environment-lessons entry (2026-07-04) below.

### 2026-07-11: KPI Leader-Designation Layer (Group Bars, Split Assembly, PM Individuals)

Context:

The scoring engine produced per-user scorecards, but nothing connected them to the prize rules ("¥400 to each leader whose GROUP hits the 85% bar"). Owner decision: Zhong and Pei run SEPARATE assembly groups with separate bars.

Tried:

Reused the existing `DepartmentGroup` hierarchy (`parentGroupId` + `groupType`) instead of inventing a parallel table: added `DepartmentGroup.kpiLeaderId` (FK users, ON DELETE SET NULL, hand-authored migration `20260711120000_kpi_leader_designation`); seed splits the `assembly` DEPARTMENT parent into `assembly-a` (钟组/zhong) + `assembly-b` (裴组/pei) GROUP children and assigns every scored user to one KPI group via `departmentGroupId`. New pure domain `kpi-leader-bar.ts` (`aggregateGroupScorecard` + `leaderBoardEntries`) sums member scorecards with the SAME 85% + <5 floor applied to the aggregate; `kpi-scores.ts` builds leader entries from real membership and keys DEPARTMENT_GROUP snapshots on real group ids; the Scores tab gained a "Leaders 组长达标" section (7 award rows + 2 referee rows, expandable member breakdown, ¥400/¥250 captions from constants). Simulator gives pei her own 3-issue set so assembly-b shows a real bar.

Result:

Works. 440 domain tests (432 baseline + 8 new leader-bar tests: aggregation math, floor-on-aggregate, empty group, PM-individual passthrough, member attribution). The Leaders section renders above the untouched per-user grid.

Why:

The hierarchy already modeled department→group; a parallel table would have duplicated it and risked diverging from issue routing. Keeping leader bars on `kpiLeaderId` + membership (never on `code`) is what lets the assembly split coexist with unchanged routing.

Decision:

Reuse the `DepartmentGroup` hierarchy for KPI leader bars. Issue routing stays at the PARENT level (`ownerGroup.code === "assembly"`, the department inbox map) and is untouched — children and `kpiLeaderId` are KPI-only. PMs are award-tier INDIVIDUALS: the `pm` group carries NO `kpiLeaderId`, so each PM's "leader bar" is their own user scorecard. Referees (QC, Marketing) aggregate the same way; their entries are the ¥250 service bars. The <5 floor is applied to the group AGGREGATE, not per member, so a genuinely quiet group floats while a busy group's misses bite.

Verification:

`node --test tests/domain/*.test.ts` → 440 pass (domain tests import no Prisma client). tsc: after the schema field was added, the only errors were stale-generated-client "kpiLeaderId does not exist" errors in seed.ts + kpi-scores.ts — proven to clear once the client regenerates (patch-prove-restore on the generated `.d.ts`, restored byte-for-byte, md5 verified); the client regenerates for real via `pnpm prisma:migrate` on the Mac. `node --check` clean on the simulator + snapshot scripts.

Related Docs:

- `docs/06-kpi/kpi-system-design.md` section 9 (build status), §3 award/referee tiers, §4 group-bar rule.
- `docs/02-schema/schema-v0.md` DepartmentGroup (kpi_leader_id + parent/child vs routing).

### 2026-07-07: KPI Phase-1 Data Layer (Rules Registry, Scoring Engine, Scoreboard)

Context:

The KPI system design (`docs/06-kpi/`) needed its data machinery before the pilot baseline month could start. Owner also wanted admin-editable deadline rules and a staff scoreboard that stays hidden during data gathering.

Tried:

New `KpiRule` + `SystemSetting` tables (hand-authored migration); pure scoring engine (`kpi-scoring.ts`) + event extraction from real records (`kpi-events.ts`); admin Rules tab (hours editable, changes logged, mid-month-rescore warning); admin Scores tab with item-level audit drilldown; `/score` personal page matching the scorecard poster, gated by `scoreboard_enabled` (default off, admins preview); `scripts/run-kpi-snapshot.mjs` and `scripts/simulate-kpi-data.mjs` (persona test data).

Result:

Works after one fix round: ActivityLog `entity_id` is uuid — two call sites passed the setting KEY string (crash on toggle); boolean rules initially rendered nonsense "Due at pending" copy; Admin polluted scorecards because the simulator created issues as admin; some simulated timestamps preceded their anchors; Rules tab headings clipped and behavior names looked editable.

Why:

Event attribution and layout details matter as much as the engine. Non-scored roles must be excluded at the engine level, not hidden in UI.

Decision:

Deadlines are literal hours (weekends count). Rule changes re-score the current month (no versioning yet). ADMIN/GM/VIEWER are never scored. Exclude-over-guess for unreliable event timestamps — the <5-events floor makes undercounting safe. Never pass non-uuid strings as ActivityLog entity ids.

Verification:

tsc clean; 387 domain tests; simulator reproduces personas (zhong 92% hit, wang 75% miss, bill 92%, gong 100%); toggle round-trip logged.

Related Docs:

`docs/06-kpi/kpi-system-design.md` section 9, decision log 2026-07-07 entry, `docs/07-training/archive-v1/monthly-scorecard-example-poster.html` (archived UI spec for /score).

### 2026-07-05: Trial Date Confirmation Handshake And Trial Calendar

Context:

Owner workflow decision: PM proposes a trial date; Injection must confirm it with a machine or counter-propose; Marketing guards the customer target date on changes; rejections return to the PM. Injection also needed a machine-load view for planning.

Tried:

`TrialDateConfirmationStatus` state machine on TrialEvent (pure domain + five server actions); three new phone task sections (Confirm trial dates / Approve date changes / Returned dates — the Marketing card shows current date, proposed date, customer target, and the day gap); trial-panel badges; then `/calendar` month grid with per-day per-machine load warnings (amber at 3, red at 4+ on one machine), a day detail panel reusing the propose-change flow, and a 7-day phone agenda shared with the mobile dashboard.

Result:

Implemented. All PM date-set call sites reset the handshake (create, first T0, add trial, missed-record, auto-missed resolve, re-date).

Why:

Dates only become trustworthy when the machine owner confirms them, and the calendar is only useful over confirmed dates. The workflow must never block reality — results stay recordable in any confirmation state.

Decision:

Approval writes `proposed_date` into `planned_date` in the same transaction so the auto-missed cutoff follows automatically. No drag-and-drop on the calendar; phones get an agenda, never a month grid.

Verification:

360 domain tests at the time; full walkthrough bill to wang to yvonne to bill to wang.

Related Docs:

`docs/05-feature-prompts/06-trial-date-confirmation.md`, `07-trial-calendar.md`.

### 2026-07-04: Attachment Infrastructure, Issue Photos, Lightbox, Extended File Types, QC Reports

Context:

Phase 1 needed evidence: photos on issues, customer-facing QC measurement reports, and industry file types (CAD/video) with IP-safe visibility rules.

Tried:

Generic attachment layer (disk storage under `MOLDPILOT_STORAGE_DIR`, soft delete, per-type allowlists and size caps, streaming download route with visibility enforcement); photos riding the issue form with client-side canvas downscale; thumbnail grids plus one shared Lightbox; CAD (STEP/IGS/DWG/DXF), video (Range streaming, inline player), ppt/zip; measurement-report workflow (amber Missing until QC uploads; Marketing downloads customer-safe files named `project_trial_measurement-report.ext`; dashboard missing-report count).

Result:

Works. Two findings changed course: Next.js server actions default to a 1 MB body limit — uploads over ~1 MB were silently doomed until `bodySizeLimit: "320mb"`; and browsers send generic MIME types for CAD, so those validate by extension.

Why:

A defect without a photo is a story; with a photo it is evidence. Customer Safe must never be a default — native CAD leaking to a customer is the worst incident the file system could cause.

Decision:

Visibility defaults by type (CAD/video default Technical); photo failures never roll back the issue they ride on; measurement reports get their fixed filename at upload time.

Verification:

256 to 300 domain tests across the three builds; manual walkthroughs including Marketing receiving 403 on Technical files.

Related Docs:

`docs/05-feature-prompts/01-file-attachments.md`, `03-trial-photos.md`, `04-qc-measurement-report.md`; schema-v0 FileAttachment section.

### 2026-07-04: Environment Lessons — Turbopack Cache, Offline Store, Sync-Conflict Duplicates

Context:

Three environment incidents cost real debugging time and will recur if forgotten.

Tried:

Investigated a forever-hanging `/me` compile, repeated Prisma "Unknown argument" runtime errors, and mystery files named like `client 2.js`.

Result:

(1) The Turbopack persistent cache had bloated to 763 MB with 30-50 second compactions, largely because the 1.1 GB, 25k-file `.moldpilot-offline` store lived inside the watched project root. Fixed by deleting `.next` and relocating the offline cache to `~/.moldpilot-offline` (scripts now default there and refuse to write inside the repo). (2) The dev server holds the old generated Prisma client after migrations — always restart `pnpm dev` after `prisma generate`. (3) Files with a ` 2.` suffix appear when the Cowork sandbox and the Mac write the same path concurrently — the sync layer saves conflict copies and the canonical file may be stale; fix by stopping the dev server, deleting the affected generated directory, and regenerating on the Mac.

Why:

Build tooling treats the project root as its world; anything huge or externally mutated inside it becomes tooling pain.

Decision:

Keep multi-gigabyte artifacts out of the project root. Treat restart-after-generate as a rule. Treat any ` 2.` suffixed file as a sync-conflict smell worth investigating immediately.

Verification:

`/me` compiles in seconds after the fix; the KPI tabs loaded after clean regeneration.

Related Docs:

README offline dependency cache section.

### 2026-07-05: Trial Issue Owner Labels And Dashboard Action Group Polish

Context:

The trial issue owner dropdown was showing display name, Chinese name, and username, which made normal issue assignment harder to scan. On the dashboard, Admin and My tasks appeared as separate header rows for Admin users instead of a single action group.

Tried:

Added an issue-specific owner label helper that renders active users as `Role / Display Name / Chinese Name` and wired it into the Add Trial Issue form plus the Edit Trial Issue modal. Grouped the dashboard Admin and My tasks buttons in one flex nav action area without changing permission visibility, login behavior, or server-side workflow rules.

Result:

Implemented as UI polish only.

Why:

Issue assignment should quickly show who belongs to which role/department while keeping usernames out of normal labels. Header actions should feel like one compact nav cluster when both actions are available.

Decision:

Keep the existing bilingual user option helper for Admin/client/PM selectors that still need username clarity, and use the new owner-specific helper only for TrialIssue ownership selectors.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning outside the sandbox for localhost/PostgreSQL access.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-07-03: Bilingual UI Foundation

Context:

The pilot needs English and Simplified Chinese UI support without creating separate routes, duplicate screens, or translated business records.

Tried:

Added a lightweight typed translation dictionary, server cookie reader, client language provider, and visible language switcher. Wired high-priority screens and widgets: login, account/change-password, dashboard/intake, Mold Trial List, project overview/trial panels/Record Result/Add Issue/Add Planned Trial/Digital Process Sheet controls, and Admin tabs/users/clients/machines/roles/permission matrix.

Result:

- English remains the default.
- `zh-CN` can be selected from the header/login switcher.
- Selection is persisted with cookie and localStorage and refreshes server-rendered pages.
- Enum/status and permission/process display labels translate while stored enum values, permission codes, and business records remain unchanged.
- User-entered mold/client/part/issue/machine/report data is not translated.

Known gaps:

- Arbitrary server-action error strings passed through URL messages may still include English details. The UI headings are translated, but a later hardening pass should convert common server-action failures to stable error codes for full message translation.
- Some low-priority historical ActivityLog action/entity strings remain generated from stored technical names.

Verification:

- Added `tests/domain/i18n.test.ts`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Trial Issue Row Actions And Lightweight Closure

Context:

User reviewed the current Trial Issues area and found it too complicated. The page showed a large update issue panel with many lifecycle fields, while real Phase 1 use needs the issues to stay inside the trial panel where they were introduced.

Tried:

Reviewed the issue workflow after the Record Result simplification. The current UI still leaned toward a full quality-management form with root cause, corrective action, verification, Assembly dates, PM readiness, and closed date all visible in one large editor.

Result:

Product direction changed:

- Trial issues live inside the trial panel where they were found.
- Remove the large global Update Issue panel from normal Mold Trial Detail.
- Each issue row shows Edit and Close Issue actions.
- Edit opens a modal for the simple issue fields.
- Close Issue opens a focused modal with fix summary, approximate time spent, and closed date defaulting to today.
- Issue owner can close their own issue.
- PM and GM can close any issue because they oversee the project.
- If the closer is not the issue owner, the close flow requires a reason explaining why the owner did not close it.
- Closure stores closed by user, closed date, fix summary, fix time, and non-owner reason when applicable.
- Add Trial Issue must use the full available trial-panel width.
- Closed issues lock for normal users: Edit and Close Issue are gray/disabled for non-GM users.
- GM can edit a closed issue through an explicit override path with ActivityLog history.
- Add Next Planned Trial defaults design change source to No / None.
- Design-change fields are hidden/disabled unless the reason is design-change related.
- Reason detail and design change title are optional for new planned trials.

Why:

The pilot needs a fast follow-up loop more than a full QA lifecycle. Fix summary and time spent give useful later analytics without forcing PM or workers to fill root-cause/verification forms too early.

Decision:

Add lightweight issue row actions and closure fields, move issue edit/close into modals, remove/hide the global update panel, enforce owner/PM/GM closure permissions server-side, make non-owner closure auditable, lock closed issues for non-GM users, and simplify new-trial design-change fields.

Verification:

Passed:

- `CI=true node --test tests/domain/*.test.ts`
- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm pilot:check`

Notes:

- Added migration `20260702093000_trial_issue_simple_closure`.
- Local `pnpm pilot:check` initially failed because the running Next dev server had loaded the old generated Prisma client before the new `closedBy` relation existed. Restarting the dev server after `pnpm typecheck` / Prisma generate fixed the HTTP smoke.

2026-07-02 implementation update:

- Patched the closed-issue row actions so normal users see disabled Edit and Closed buttons.
- Added the GM-only closed-issue override modal path and `gm_edited_closed_trial_issue` ActivityLog action.
- Blocked non-GM server-side edits to closed issues, including the older lifecycle update action.
- Moved Add Next Planned Trial into a small client form so design-change fields appear only for design-change-related reasons.
- Added `No / None` as the default design-change source and made reason detail/design-change title optional.
- Updated validation so the new-planned-trial minimum fields are planned date, reason category, requester, and source area.
- `pnpm pilot:check` first hit sandbox `EPERM` for localhost checks; rerunning outside the sandbox passed PostgreSQL reachability and HTTP smoke.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Remove Digital Process Sheet Summary Duplication And Color Issue Rows

Context:

User reviewed the Digital Process Sheet and Trial Issues UI. The sheet still showed a Trial Summary section even though trial result and issue information now live in the Record Result panel and TrialIssue tables. Trial Issues also needed clearer visual scanning by status.

Tried:

Scoped the patch as a UI/workflow cleanup rather than a new module. Removed the generated issue-summary block from the Digital Process Sheet, filtered legacy Trial Summary parameters out of the editor/server save/PDF export paths, and deactivated legacy summary parameters during seed without deleting historical TrialProcessValue rows. Added subtle status row colors to trial-panel issue tables while keeping the visible status chip.

Result:

Implemented.

- Digital Process Sheet normal UI now shows machine/process parameters only.
- Trial Summary parameters are excluded from the editor, server-side process-sheet save, seed process values, and customer-safe PDF process rows.
- New default process-sheet templates no longer create Trial Summary parameters; seed deactivates any legacy default-template rows non-destructively.
- Customer-safe PDF keeps generated TrialEvent/TrialIssue summary content and ignores duplicated/manual process-sheet summary rows.
- TrialIssue rows inside trial panels now use warning/success row backgrounds by status and retain visible status text/chips.

Why:

This keeps Digital Process Sheet focused on process parameters and keeps the trial workflow source-of-truth clean: Trial Result for result, TrialIssue for issues and corrections, Process Sheet for process parameters.

Decision:

Proceed with a small patch plus tests/docs verification.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:seed` passed and refreshed local template rows.
- `pnpm pilot:check` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Same-Trial Issue Gate For Non-Approved Trial Results

Context:

Review found that non-approved trial results and next-trial planning could be satisfied by project-level issue counts. That allowed a failed T1 to move forward because an unrelated old T0 issue was still open.

Tried:

Moved the gate to same-trial accountability. Record Result now checks issues linked to the selected TrialEvent, and Add Next Planned Trial checks the previous completed actual trial for a linked issue when that previous result is not Approved. Also aligned Add Trial Issue creation so owner user and due date are required in both UI and domain/server validation.

Result:

Implemented.

- Non-approved, pending, conditional, or invalid actual results require at least one TrialIssue under the same trial panel before saving.
- Planning T1/T2/T3/etc. is blocked if the previous completed trial result was not approved and has no same-trial issue.
- Issues from other trials, project-level open issue counts, trial result notes, and new-trial reasons do not satisfy the gate.
- Add Trial Issue no longer defaults to Unassigned and requires Owner plus Due Date.
- The legacy `outcomeDisposition` field remains internal/backward-compatible; normal wording uses trial result and trial result note.

Why:

TrialIssue owns follow-up accountability. Keeping the issue linked to the same T-stage prevents project-level issue count drift and makes each failed trial panel auditable.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning with local PostgreSQL/localhost access.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Record Result And Add Issue Forms Simplified

Context:

User reviewed the Record Result and Add Trial Issue panels and found the visible workflow too crowded. `Outcome disposition` duplicated the `Result` decision, while Follow-up Owner and Follow-up Due Date on the trial record could not represent multiple issues owned by different people.

Tried:

Reviewed the current TrialEvent and TrialIssue model. TrialEvent had result, outcome disposition, follow-up owner/date, material, and legacy machine note. TrialIssue already had owner user, due date, issue type, source, severity, status, description, and optional affected part/cavity support.

Result:

Product direction changed:

- Record Result should keep only actual date, result, injection machine, sample quantity, main issue summary, and optional outcome note.
- Visible Result options should cover the needed direction: Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, and Invalid Trial.
- Outcome disposition is removed from the normal visible workflow and no longer required for completion.
- Trial-level follow-up owner/date are removed from Record Result; follow-up ownership belongs on TrialIssue rows.
- Legacy machine note and material are hidden from Record Result. Machine uses Injection Machine Master; material belongs in Digital Process Sheet.
- Simple Add Trial Issue becomes wider and shows only title, optional affected part, issue type, source, severity, status, owner, due date, and description.
- Advanced lifecycle fields remain for later edit/acknowledgement/verification/closure workflows, not the simple create form.

Why:

The trial result panel should answer what happened. Trial issues should answer what needs follow-up, who owns it, and when it is due. This better matches real mold-trial work where one trial can create multiple follow-up items for different people.

Decision:

Implemented the result-first trial completion patch. `outcomeDisposition`, follow-up owner/date, legacy machine note, and material stay in the schema only as legacy/backward-compatible data. The server derives legacy outcome disposition from the selected result so old report/status code can keep working while the normal UI uses one visible result field.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Added non-destructive migration `20260702083000_simplify_record_result` to add `PENDING_CUSTOMER_FEEDBACK` and `INVALID_TRIAL` to `TrialResult`.
- Remaining verification in the implementation turn: Prisma validate, typecheck, and pilot check.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Admin Undo Last Saved Action

Context:

The first attempt added reset/discard controls for unsaved edits, but the intended workflow was to recover from an already-saved Admin action, such as accidentally deleting an Injection Machine.

Result:

- Added one server-backed `Undo last saved action` control for Active Users, Active Clients, Injection Machines, and Roles.
- Undo is scoped by Admin area and uses existing `ActivityLog.beforeJson`/`afterJson` snapshots.
- Server-side permission checks remain authoritative:
  - Users require `admin.manage_users`.
  - Clients require `admin.manage_customers`.
  - Injection Machines require `admin.manage_machines`.
  - Roles and role permissions require `admin.manage_roles`.
- Deleted Injection Machines can be restored from the ActivityLog snapshot. Safe-deleted/historical machines are reactivated without breaking trial snapshots.
- Created rows are removed when safe; if references already exist, undo archives/hides instead of breaking history.

Verification:

- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`

### 2026-07-02: Digital Process Sheet Usability Patch Scoped

Context:

User tested the Digital Process Sheet after the machine-master work and found practical data-entry issues: saved values lacked clear in-panel feedback, Enter submitted/froze the sheet instead of moving to the next field, and PM needs a way to copy prior trial parameters into the next trial.

Tried:

Reviewed the current implementation in `src/app/projects/[projectCode]/page.tsx` and `src/server/mold-trial-actions.ts`. The sheet is currently rendered as a server form around a comparison table. It saves through `saveTrialProcessSheetValues`, writes structured `TrialProcessValue` rows, and redirects with a generic success message.

Result:

The current structure is correct for data storage, but too rough for PM data entry. Enter currently behaves like form submit because editable fields are normal inputs inside a form. Save feedback is not anchored inside the Digital Process Sheet panel. There is no Copy Previous Trial workflow yet.

Why:

PM will enter many process values during or after a trial. The sheet needs spreadsheet-like keyboard behavior and visible save confidence, otherwise it will feel slower than paper and invite duplicate/offline notes.

Decision:

Next Coder patch should convert the editable Digital Process Sheet area into a client-assisted editor while preserving server-side permission validation and structured `TrialProcessValue` storage. Add visible current-trial/editing state, unsaved-change count, save feedback, Enter/Shift+Enter field navigation, and Copy Previous Trial. Copying should fill blank current-trial machine/process values from the immediate previous trial and must not copy trial result, issues, summaries, next action, Assembly self-check, or accountability fields. Saving/copying process values must not create a new trial.

Verification:

- Passed: direct domain suite with `CI=true node --test tests/domain/*.test.ts` (119 tests).
- Blocked: `pnpm exec prisma validate` and `pnpm typecheck` because local `node_modules/.bin` is missing/corrupted in this environment; `pnpm install` reported already up to date but did not relink binaries.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`

### 2026-07-02: Digital Process Sheet Usability Patch Implemented

Context:

The scoped patch needed to make Digital Process Sheet entry usable during a pilot: avoid accidental Enter submits, show save confidence in the sheet, and let PM/Injection copy previous process setup values without copying trial results or accountability fields.

Tried:

Converted the editable process-sheet table into a client-assisted editor component while keeping `saveTrialProcessSheetValues` as the server-side permission and persistence boundary. Added domain helpers for keyboard navigation and Copy Previous Trial behavior.

Result:

- The sheet now shows `Editing: T0/T1/...`, unsaved-change count, saving state, and saved timestamp/count feedback inside the panel.
- Enter moves to the next editable process value and Shift+Enter moves to the previous value instead of submitting the form.
- Copy Previous Trial copies the previous trial machine and copyable process values into blank current fields, with explicit overwrite confirmation for existing values.
- Copy Previous Trial excludes trial-summary/accountability-style process rows such as trial result summary, major issues, correction summary, next action, and internal private note.
- Saving process-sheet values still writes `TrialProcessValue` rows and `saved_trial_process_sheet` ActivityLog, without creating a TrialEvent or advancing the visible stage.
- Admin management Undo now supports a bounded ten-action stack and uses the shorter `Undo` label. The Injection Machines action column was narrowed after removing the old reset control.
- `scripts/pilot-preflight.mjs` now selects `active` before filtering imported machines by active state.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Passed: `pnpm exec prisma validate`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check` after refreshing stale local seed data with `pnpm pilot:seed`

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Injection Machine Panel Narrowed

Context:

User asked to handle one issue at a time and simplify the Injection Machine Admin panel. The real pilot only needs machine No., clamping force, brand, and shot weight.

Tried:

Reviewed Coder's current implementation. The seed attempted to parse `RAW/Injection-Machines-2026.07.02.xls`, but the Admin Machines UI still exposed Display Name, Model, Tonnage, Nozzle, Notes, and Active/Archived status. The seed also mapped machine number from a remark/generated label path instead of using a numeric-only No. as the visible machine number.

Result:

Implemented the focused Injection Machine Master patch:

- Visible Admin columns: No., Clamping Force, Brand, Shot Weight, Actions.
- Row actions: Save and Delete.
- No. is numeric only, validated client-side and server-side, and sorted numerically.
- RAW import uses workbook No. as `machineNo`; generated `MACHINE-xx` and remark labels such as `12#` are not created.
- Delete hard-deletes unused rows and safe-deletes/hides referenced historical rows without breaking trial snapshots.
- Process-sheet machine labels/search now use numeric No. and clamping force wording.

Verification:

- Passed: `pnpm exec prisma validate`
- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check`

Why:

The machine master is support data for trial/process-sheet entry, not a full equipment-maintenance module. Extra columns make the Admin panel harder to use and distract from the trial tracker.

Decision:

Next Coder patch should narrow schema/server/UI/test behavior around the simplified machine fields while preserving historical trial snapshots.

Verification:

Pending Coder patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Intake Process Sheet, Client Privacy, Trial Stage, And Machine Seed Patch

Context:

Patch blockers from local pilot testing needed to be fixed before the next milestone: new projects missed process-sheet template snapshots, client country was still present in Customer Master/search, missed T0 replans created duplicate visible T0 rows, user-facing pages showed internal `#1/#2/#3` sequence suffixes, and the injection machine master still used three starter records.

Tried:

Removed `customers.country` from Prisma and normal code paths with a cleanup migration. Made `createMoldTrialProject` snapshot the selected customer default process-sheet template or global `default_process_setup`, and backfilled null project template snapshots. Changed missed/auto-missed replanning to update the same TrialEvent/stage instead of creating a new visible T0. Added domain gating so T1/T2/T3 cannot be planned until the prior stage is completed, skipped, cancelled, or aborted. Replaced display labels with generated `T0`, `T1`, `T2`, `T3` labels across detail, process sheet, summaries, and exports. Added a seed-only OLE/BIFF `.xls` reader for `RAW/Injection-Machines-2026.07.02.xls`.

Result:

Implemented. `MP-PILOT-001` now has one visible completed T0, a missed-trial audit row linked to that T0, and planned T1 as sequence 2. Client search no longer uses country and the selector no longer shows the no-match message while a selected customer id is set. The local pilot seed imports the real machine workbook and `pilot:check` fails if it falls back to a tiny starter list.

Why:

Phase 1 needs mold-level trial control, not event-row numbering as a user-facing stage model. Client country is not necessary for Mold Trial Tracker and creates avoidable customer-profile exposure. The process sheet must be available for real newly created projects, not only demo fixtures.

Decision:

Keep process-sheet template snapshots on MoldTrialProject. Keep Customer Master limited to code, short name/display name, owner, aliases, notes, and active state. Keep missed/replanned trial history auditable through MissedTrialEvent while the visible trial panel stage remains stable.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed: 116 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed outside sandbox after Turbopack needed local worker/port access.
- `pnpm prisma:migrate` applied `20260702072000_privacy_template_stage_patch`.
- `pnpm pilot:seed` passed and imported real machine workbook records.
- `pnpm pilot:check` passed; HTTP smoke was skipped because no dev server was left running.
- `pnpm pilot:workflow:e2e` passed and now verifies a browser-created intake shows Digital Process Sheet after T0 exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Pilot Intake And Trial Label Bugs Found

Context:

User tested new project intake and Digital Process Sheet locally and found several problems: client selector showed `No active clients match this search` after selecting a client, new user-created projects had no Digital Process Sheet, seeded pilot data showed `T0 #1`, `T0 #2`, `T1 #3`, and the app allowed the workflow to look like it jumped from unresolved T0 to T1. User also requested that customer country not be shown and noted that the injection machine master is still too small.

Tried:

Inspected current code, docs, and local database state. `pnpm exec prisma validate` and `pnpm test:domain` passed. `pnpm pilot:check` passed outside the sandbox and confirmed the local DB is reachable, but direct DB inspection showed newly created `MP-TRK-20260702-887WZ4` has `processSheetTemplateCode = null` while seed fixtures have `default_process_setup`. Local machine master contains only three starter machines.

Result:

The implementation is not ready for the next milestone until these patch blockers are fixed:

- Normal project creation must snapshot the selected customer/default process-sheet template.
- Client selector must preserve selected customer state without showing a contradictory no-match message.
- Country must be removed from normal client UI/search/export and should be nulled/dropped from Customer data when practical.
- Missed/replanned T0 must remain visible as T0; normal UI, process sheet, summaries, and exports must not show `T0 #1`, `T0 #2`, or `T1 #3`.
- The app must not advance to T1 until T0 has a real completion/closure disposition.
- Injection Machine Master must import the real `RAW/Injection-Machines-2026.07.02.xls` data instead of relying on starter records.

Why:

The earlier tests proved seed/demo readiness but did not cover a real new-intake workflow. The visible stage model also drifted toward internal event numbering instead of the business sequence PM expects.

Decision:

Patch docs and tests first, then have Coder fix server actions, selectors, trial panel/process-sheet labeling, missed-trial replanning, seed/import logic, and acceptance tests.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed.
- `pnpm pilot:check` passed outside sandbox.
- Remaining verification must be rerun after the patch with a newly created project, not only `MP-PILOT-001`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Digital Process Sheet MVP Captured

Context:

The user wants to move the mold trial report online so PM does not record issues/process data on paper and then re-enter them in MoldPilot. The user also provided the current injection machine list and a real process setup sheet.

Tried:

Implemented the staged Digital Process Sheet MVP: Injection Machine Master, machine search by number/tonnage, structured process-sheet values per trial, horizontal T0/T1/T2/extra comparison, Assembly self-check behavior, fixed customer/default process-sheet templates, and customer-safe Process Sheet PDF export.

Added Prisma models/fields for `InjectionMachine`, `ProcessSheetTemplate`, `ProcessSheetParameter`, `TrialProcessValue`, TrialEvent machine snapshots, Customer default template assignment, MoldTrialProject template snapshots, Process Sheet attachment enum values, and TrialIssue Assembly self-check fields.

Added Admin Machines management, process-sheet edit/export permissions, Digital Process Sheet UI on the Mold Trial Detail page, server actions for saving current-trial process values and exporting a customer-safe PDF, and seed data for `MP-PILOT-001` process values/machine snapshots.

Result:

Implementation is in place. The intended scope remains a practical fixed-template report-data module, not a full custom template designer.

`RAW/PROCESS SET UP SHEET.xlsx` was readable and used to shape the fixed template sections/rows. `RAW/Injection-Machines-2026.07.02.xls` is an old OLE `.xls`; local parsing was blocked because `xlrd` was not installed and LibreOffice conversion failed due a missing `little-cms2` dynamic library. The seed now includes a starter machine master, including `12# - LianChuang 408T` from the process setup sheet, and this blocker should be revisited if full workbook import becomes important.

Why:

This reduces duplicate PM entry and makes MoldPilot the source of truth for both internal trial control and customer-safe process-sheet export.

Decision:

Start with fixed templates based on `RAW/PROCESS SET UP SHEET.xlsx`, seed/import machines from `RAW/Injection-Machines-2026.07.02.xls` where practical, and export customer-safe PDFs from structured TrialEvent/TrialIssue/TrialProcessValue data.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed, including process-sheet helper tests.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after applying the new migrations and reseeding.
- `pnpm pilot:e2e` passed data workflow checks; optional HTTP check skipped because no dev server was already running.
- `pnpm pilot:workflow:e2e` passed browser/server-action workflow checks.
- `pnpm build` passed when rerun outside the sandbox; the sandboxed run failed with Turbopack EPERM while creating a process/binding a port for CSS processing.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Auto-Missed Resolution And In-Panel Trial Actions Captured

Context:

The user wanted the Mold Trial Detail page simplified further after moving to trial panels. Separate Record Missed Trial and Add Design Change panels still made the page feel heavier than necessary.

Tried:

Added the Prisma/TypeScript support for `Auto Missed - Reason Required`, including nullable auto-missed audit fields and a resolution enum on `TrialEvent`. Added a domain helper for the Asia/Shanghai next-day noon cutoff, wired project detail loading to idempotently apply the auto-missed state, and logged the automatic transition in `ActivityLog`.

Moved normal trial work into the Trial Panel area: result entry, late-result correction, auto-missed resolution, issue creation, and add-next-planned-trial now live inside the panel workflow. Removed the standalone normal UI blocks for Record Missed Trial and Add Design Change. Design-change extra-trial reasons can still create `DesignChangeEvent` and `TrialLimitAdjustment` records behind the scenes when selected as an extra-trial reason.

Result:

Implementation is in place. The old server actions remain available for compatibility, but the normal detail page no longer exposes separate page-level missed-trial or design-change panels.

Why:

The team should not have to choose among many page-level forms. The page should guide users through the specific trial panel they are working on, while the system detects overdue unreported trials automatically.

Decision:

Use `Auto Missed - Reason Required` as a cleanup state after 12:00 PM on the next calendar day when no trial result exists. Resolve it from the trial panel by entering missed reason/new date, marking blocked/paused, or entering a late completed-trial result with audit history.

Verification:

- Added domain/source tests for auto-missed cutoff behavior, blocked/paused resolution validation, confirmed missed resolution requirements, idempotent service guard, late-completion audit source, current-action selection, in-panel UI source checks, and design-change extra-trial reason counting.
- Remaining gap: this pass did not add a new browser workflow that fills the in-panel forms end to end; the existing pilot workflow should be rerun and adjusted only if selectors changed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Mold Trial Detail Simplified Around Trial Panels

Context:

The Mold Trial Detail page risked becoming cluttered because trial count, limit controls, history, missed trials, design changes, and trial records were spread across too many panels.

Tried:

Reworked the detail route around a Trial Panel model: compact trial-count badge, simplified overview, default T0/T1/T2 collapsible panels, prior issue verification inside later panels, and a single Planning & Change History section for missed trials, new-trial reasons, design changes, and limit adjustments.

Added pure domain helpers for trial-panel display behavior and extra-panel prerequisites. Hardened `addNewPlannedTrial` so sequence 4+ requires all prior panels completed and a visible reason before the server creates the next planned trial.

Result:

Implemented. The normal detail UI no longer shows the standalone Trial Limit Panel or Set PM Custom Limit form. Design-change allowance and extra-trial reasons remain visible through Planning & Change History. Existing PM custom-limit server/action support remains in code for audit/admin compatibility, but it is not exposed in normal detail workflow.

Why:

The team should work through the actual trial loop, not a limit-management screen. This keeps trial discipline visible while making the page easier for PM, Injection, QC, Marketing, and GM to understand.

Decision:

Use existing `TrialEvent.planReasonDetail`, approved design-change records, and `TrialLimitAdjustment` history as the visible extra-trial reason source for this milestone. Do not add a new extra-trial-reason table yet; revisit only if real pilot use needs richer reason linking.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:workflow:e2e`, `pnpm build`, and `pnpm pilot:e2e`. `pilot:check` initially found local seed drift because the `xie` GM account was missing; rerunning `pnpm pilot:seed` restored the expected pilot fixture before final verification.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Multi-Part And Multi-Cavity Support Added To Phase 1

Context:

Family molds and multi-cavity tools can include more than one tracked part/cavity under one mold-level trial loop.

Tried:

Added `MoldTrialPart` as a child of `MoldTrialProject`, kept project `part_code` as the primary display/migration mirror, and added optional affected scope/part/cavity fields on `TrialIssue`.

Result:

Implemented as an additive schema migration, shared domain helper, server-action validation, dashboard/detail display, project parts editor, issue affected-part selectors, seed backfill, and a multi-part seed fixture.

Why:

Trial events and trial limits remain mold-level in Phase 1, but issues need part/cavity context. Separate part rows avoid comma-separated part codes and avoid incorrectly splitting one mold into multiple projects.

Decision:

Use `MoldTrialPart` as the source of truth for multi-part/multi-cavity data. Keep `MoldTrialProject.part_code` mirrored to the first active part for now. Removed part rows become inactive rather than deleted, preserving issue history.

Verification:

Run Prisma validation, domain tests, typecheck, and relevant pilot checks after this patch. New domain tests cover single-part normalization, multi-part rows, comma-separated part-code rejection, affected-part validation, and dashboard `primary +N` display.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/01-domain/workflow-stages.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Archive UX Replaces Raw Status Editing

Context:

Admin user setup had a database-style Active/Inactive status field, but the user preferred an ERP-style Archive action and separate active/archived user lists.

Tried:

Updated docs and implementation to hide raw user status from normal Admin forms and define Archive/Restore actions backed by `User.status`.

Result:

Implemented. Active Users and Archived Users appear as separate sections. Archive sets users inactive; restore sets users active. Active assignment dropdowns now load active users from the database instead of static user lists.

Why:

Archive/Restore is clearer for Admin users than exposing a raw status dropdown. It preserves user history while preventing archived users from logging in or being selected for new workflow assignments.

Decision:

Implement archive after Reset Password in the Active Users table, add Restore in the Archived Users table, block archiving the last active Admin path, and write ActivityLog records for archive/restore.

Verification:

Run Prisma validation, domain tests, typecheck/build, and browser workflow E2E after this patch. Browser workflow E2E covers active/archived sections, archive login blocking, restore, assignment dropdown hiding, ActivityLog, and Admin-path guardrails.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Account Department Group Removed From Admin Setup

Context:

The real pilot role list already implies department for normal users: PM, Marketing, Assembly, Injection, QC, GM, Viewer, and Admin. Asking Admin to also assign a department group duplicated role meaning and made account setup heavier.

Tried:

Removed Department Group from `/admin` user create/edit forms and stopped writing `User.department_group_id` from Admin account saves or seeded pilot users. Kept DepartmentGroup as TrialIssue owner group / responsibility area.

Result:

Implemented as the lighter schema path. `User.department_group_id` remains nullable in the database for now, but it is deprecated and unused for Phase 1 account setup. TrialIssue owner-group behavior remains intact.

Why:

Role defines what the account can do. Responsibility area defines where an issue belongs. Keeping those concepts separate avoids duplicate account metadata while preserving issue routing for Assembly, QC, Injection, Marketing, PM, and other areas.

Decision:

Do not ask Admin to assign a department group when creating or editing users in Phase 1. Use Role for account permissions and TrialIssue owner group for issue responsibility.

Verification:

Run Prisma validation, domain tests, typecheck/build, seed/pilot checks, and browser workflow E2E after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Default Admin First Login Unblocked And Password Save Verified

Context:

The default Admin account was forced through first-login password change during local pilot setup. User testing showed that this added friction, and password-change success needed stronger verification.

Tried:

Kept the change-password flow for employees and normal account self-service, but removed the forced first-login change for the local default Admin. Added a post-update verification read in the password-change server action before returning success.

Result:

Implemented. Seed and pilot checks now expect default Admin to have a hashed password with `force_password_change = false`, while seeded employee accounts still require first-login password change.

Why:

The default Admin exists to unblock local setup and recovery. Employees still need the temporary-password control, and any real deployment must change or disable the local Admin default.

Decision:

Default Admin can log in locally with `admin` / `admin` without first-login password change. The password-change action verifies that the new hash and forced-change flag persisted before redirecting.

Verification:

Run Prisma validation, domain tests, typecheck/build, reseed, and pilot checks after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Real Login And Real Pilot User Seed Implemented

Context:

The earlier v0.1 account model used a local current-user selector and did not require passwords. The user provided the actual pilot employee list and asked to simplify roles for easier management.

Tried:

Implemented the real login MVP with minimal active roles: Admin, GM, PM, Marketing, Assembly, Injection, QC, and Viewer. Added the seeded pilot user list, temporary testing passwords, seeded employee first-login password change, Admin password reset, and account self-service username/password changes.

Result:

Worked. Normal pilot pages now require a signed HTTP-only login session. The old current-user selector is no longer used by dashboard/detail/admin pages and remains isolated behind an explicit dev flag path.

Why:

Real login makes pilot testing more realistic and makes activity accountability meaningful. A single PM role is easier to manage than separate Planning PM, Technical PM, and PM Assistant roles while permissions can still be tuned from Admin.

Decision:

Use the real login flow for browser/server-action tests. Seeded users start with temporary passwords (`admin` for default Admin and `123456` for employees), stored as scrypt hashes. Seeded employees must change password before normal app access; default Admin is a local setup exception. The real pilot uses one PM role instead of Planning PM / Technical PM / PM Assistant.

Verification:

Verified with domain tests, Prisma validation, TypeScript, production build, `pilot:check`, direct pilot E2E, and browser/server-action workflow E2E. In this sandbox, direct local binaries were used for package scripts because `pnpm test:domain` repeatedly triggered a dependency-status reinstall and tried to fetch npm packages; the equivalent `node --test tests/domain/*.test.ts` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-29: Narrowed Broad MoldPilot Vision To Phase 1 Mold Trial Tracker

Context:

The original MoldPilot vision was closer to a broad partial ERP and mold pilot system.

Tried:

Reduced Phase 1 to the mold trial control loop: intake, T0 schedule, trial result or missed reason, open issues, next trial date, and trial-limit visibility.

Result:

Worked as the project foundation.

Why:

The team can adopt one habit first instead of being asked to change the whole project-control process at once.

Decision:

Keep Phase 1 focused on Mold Trial Tracker. Treat wider ERP, purchasing, customer portal, readiness checklist, and task-board features as later expansion.

Verification:

Captured in `docs/00-product/decision-log.md`, `docs/00-product/mvp-definition.md`, and `docs/01-domain/workflow-stages.md`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-29: Added Marketing/Sales Intake Before T0 Scheduling

Context:

The user clarified that Marketing/Sales starts the real process because they receive the customer/project signal first.

Tried:

Added intake projects that can exist before the first planned trial date is known.

Result:

Worked, with a clear boundary: Marketing/Sales creates sanitized intake, while PM owns T0 scheduling.

Why:

This matches the business flow without giving Marketing/Sales control over trial scheduling or internal correction decisions.

Decision:

Allow Marketing/Sales intake creation using customer code and sanitized notes only. Customer names, contacts, emails, phone numbers, quote values, and sales pipeline fields remain outside Phase 1 core tables.

Verification:

Schema docs and seed scenarios include intake records.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-06-29: Hardcoded Role Checks Worked For Scaffold But Need Replacement

Context:

The early app needed server-side authorization quickly, before the full Admin permission-management model was implemented.

Tried:

Implemented role-based permission sets directly in server actions.

Result:

Partially worked for a scaffold, but is now the wrong long-term shape.

Why:

The user clarified that it is too hard to define every role upfront. Admin needs to manage users, roles, and permissions through checkboxes by role or process.

Decision:

Replace hardcoded role checks with named permission codes, role permissions, and user permission overrides. Keep business validation separate from permission checks.

Verification:

Current code still contains hardcoded role sets in `src/server/mold-trial-actions.ts`; this remains a next-milestone implementation item.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`

### 2026-06-29: Direct Database Pilot E2E Is Useful But Insufficient

Context:

The pilot E2E script creates realistic data and performs basic HTTP smoke checks.

Tried:

Used a Node script to create the pilot project, trial records, issues, and activity logs directly through Prisma.

Result:

Partially worked. It proves the data shape and page rendering, but not the real server-action workflow.

Why:

Direct database writes can bypass permissions, validation, redirects, and form behavior that users actually rely on.

Decision:

Keep the script as a seed/smoke tool, but add server-action integration tests or Playwright flows for real permission and workflow coverage.

Verification:

`scripts/pilot-e2e.mjs` still writes directly through Prisma.

Related Docs:

- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Documentation Sync Added To Project Skills

Context:

The user pointed out that the final product may become different from the original idea and that undocumented changes will confuse future coding work.

Tried:

Updated the MoldPilot project skills to require doc updates when accepted product, workflow, schema, permission, UI, or acceptance-rule changes are not already represented in `docs/`.

Result:

Worked as a project operating rule.

Why:

Future conversations and Coder prompts should follow the source-of-truth docs instead of stale memory or scattered chat context.

Decision:

Before implementing confirmed feature changes, update the relevant docs. Add decision-log entries when the change explains why the project moved away from an earlier assumption.

Verification:

Project skill files include a Documentation Sync Protocol.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`

### 2026-07-01: Customer Master For Intake Captured

Context:

The user confirmed that project creation should select an existing customer instead of letting users type customer codes or names freely.

Tried:

Reviewed the customer/privacy language across product, workflow, schema, permission, UI, acceptance, pilot checklist, and build-plan docs.

Result:

Updated docs to add an Admin-managed Customer Master and searchable customer selector for project intake. `MoldTrialProject` should reference Customer and keep a `customer_code` snapshot. Customer Master includes code, display name, short name, aliases, notes, and active/archive state.

Why:

This prevents duplicate customer spellings and invalid customer codes without turning Phase 1 into CRM.

Decision:

Admin manages Customer Master records from `/admin`. PM and Marketing select active customers during intake/project creation. Customer contact person, email, phone, quote value, sales stage, customer portal, and communication history remain out of Phase 1.

Verification:

Documentation-only update. Code, migrations, seed data, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-07-01: Client Table Simplified To Match Real Workbook

Context:

The user provided `RAW/Clients-info.xlsx` and clarified that the Admin customer tab was showing too much unnecessary information.

Tried:

Read the workbook sheet `客户简称`. It contains the practical client columns: 序号, 客户代码, 客户简称, 国籍, 负责人, and 备注/成交年份.

Result:

Updated docs so the Admin customer UI is a compact Clients table with English labels: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owner assignment uses current active users, not roles. User accounts now require support for English display name plus optional Chinese name.

Why:

The pilot needs a simple client lookup/ownership table, not a CRM-like customer profile. The bilingual user name field lets imported owner names map cleanly to active users while keeping current app labels in English.

Decision:

Keep `User.display_name` as the English/current app display name and add `User.chinese_name`. Add client country and owner-user relation. Import workbook owners using 刘婉霞 = Anna, 周娟娥 = Zoe, 彭利满 = Peng.

Verification:

Documentation-only update. Code, migrations, seed/import, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Customer Master Implemented For Intake

Context:

Project creation needed to stop accepting free-typed customer text and instead select from Admin-managed active Customer Master records.

Tried:

Added the Customer schema, backfill migration, seed data, Admin Customers tab, searchable intake selector, server-side active-customer enforcement, pilot seed checks, and Customer Master domain/browser workflow tests.

Result:

`MoldTrialProject` now references `Customer` through `customer_id` and still snapshots `customer_code`. `/admin?tab=customers` can create, edit, archive, and restore customers using `admin.manage_customers`. Project intake posts `customerId`, validates the selected Customer is active, and stores the code snapshot from Customer Master.

Why:

This keeps customer identity consistent while preserving the Phase 1 privacy boundary. Customer contacts, email, phone, quote values, sales stages, portal access, and communication history remain outside core Mold Trial Tracker tables and forms.

Verification:

Added Customer Master domain coverage and extended pilot/preflight/browser workflow checks. Commands to run for this implementation are `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Clients Workbook Import And Bilingual User Names Implemented

Context:

The Admin customer table still behaved like a generic Customer Master form, while the real pilot data comes from `RAW/Clients-info.xlsx` with client code, short name, country, owner, and notes/deal-year columns.

Tried:

Added `User.chinese_name`, client country, and client owner-user relation. Updated `/admin` to use a compact Clients tab, imported all workbook rows in seed, mapped workbook owners to active users, and updated project intake search/display.

Result:

Implemented. Admin Users can store English display name plus optional Chinese name. Admin Clients now uses workbook-style columns: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owners are selected from active users, not roles. Project creation searches active clients by code, short name, country, owner English name, and owner Chinese name.

Why:

The pilot needs a practical client master, not CRM fields. Chinese names are required to map workbook owner names while keeping the normal app display in English.

Decision:

Keep `Customer` as the internal model name for now, but label the Admin UI as Clients. Mirror `Customer.display_name` from required `short_name` when importing workbook data. Do not add contact person, email, phone, quote, sales-stage, or communication-history fields.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e` after applying the migration, reseeding, and restarting the local dev server for HTTP checks.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Optional Intake Identifiers And Admin Batch Save Implemented

Context:

Real intake can happen before Sales/Marketing knows the client project reference or the mold code. Admin Users and Clients also needed spreadsheet-like staged edits instead of per-row Save buttons.

Tried:

Added optional `client_project_ref` on MoldTrialProject while keeping `project_code` as the required internal route/tracking key. Loosened intake validation, added generated tracking codes for blank intake records, added a mold-code guard before trial scheduling/activity, and replaced existing Admin Users/Clients row saves with staged batch editors.

Result:

Implemented. Project creation can omit Project Code / Client Ref and Mold Code while the record remains Intake. PM/Admin can update identifiers on the detail page. Setting first T0, scheduling/rescheduling trials, recording missed/completed trials, and creating/updating trial issues now require Mold Code. Dashboard/list shows Mold Code first and optional Client Project Ref second. Admin Users and Clients show sticky Unsaved changes / Save changes / Discard changes bars and submit changed rows through server-side batch actions.

Why:

This keeps early intake lightweight without allowing real trial records against an unidentified mold. Batch saving makes Admin cleanup less repetitive while preserving server-side permission checks and ActivityLog entries per changed row.

Decision:

Do not make `project_code` nullable. Treat it as an internal unique tracking code. Store user-facing references in `client_project_ref`.

Verification:

Run Prisma validation, domain tests, typecheck, pilot checks, and browser workflow E2E after applying this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Multi-Part / Multi-Cavity Mold Support Captured

Context:

The user clarified that some mold projects contain multiple part codes or cavities inside the same mold, so the single project-level `part_code` assumption is not realistic enough.

Tried:

Reviewed the product, workflow, schema, UI, permissions, acceptance, and build-plan docs for single-part assumptions.

Result:

Updated docs to introduce `MoldTrialPart` as a child entity under `MoldTrialProject`. Trial events and trial-limit counting remain mold-level. Trial issues can optionally identify an affected part/cavity.

Why:

This avoids comma-separated part codes, prevents creating separate mold projects for parts inside the same mold, and keeps the Phase 1 tracker focused while allowing realistic family-mold and multi-cavity data.

Decision:

Next implementation should add the schema/model/UI support before deeper workflow polish: migrate existing project `partCode` into the first `MoldTrialPart`, show primary part plus count in lists, add a Parts / Cavities section on detail, and allow optional affected part/cavity on TrialIssue.

Verification:

Documentation-only update. Code, migrations, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-06-30: Permission-Aware UI And Real Browser Workflow E2E

Context:

The named permission foundation worked server-side, but the UI still showed action forms too broadly and the existing pilot E2E mostly verified data shape through Prisma instead of exercising browser-submitted server actions.

Tried:

Added effective-permission loading helpers, permission-aware dashboard/detail/Admin form states, Admin lockout guardrails, and a real browser workflow script using headless Chrome DevTools Protocol. The workflow switches current users, submits the project intake and trial scheduling forms, checks blocked UI states, acknowledges an Assembly issue, and proves an Admin role-permission toggle changes subsequent QC behavior.

Result:

Worked. The browser workflow exposed two useful implementation gaps: the test helper was selecting the wrong container for dashboard forms, and the issue-type option list omitted schema-supported Phase 1 issue types such as Assembly / Fitting Issue. Both were fixed.

Why:

The server remains the source of truth for authorization, but pilot users need clear “Current user cannot perform this action” states instead of discovering permission failures only after submitting. The real browser workflow gives better confidence that cookies, server actions, redirects, and forms work together.

Decision:

Keep `scripts/pilot-e2e.mjs` as the DB/data smoke test and use `pnpm pilot:workflow:e2e` for browser/server-action workflow coverage. Keep the local current-user selector for v0.1 pilot auth; full login remains out of scope.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:workflow:e2e` passed. `pilot:check` warned only that HTTP smoke was skipped because no dev server was listening on port 3000 during that command.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Permission-Aware Workflow Review Passed

Context:

The permission-aware UI and browser/server-action workflow milestone was reviewed after implementation.

Tried:

Inspected the project detail UI gates, Admin permission UI, admin lockout guard, effective-permission helpers, server-side permission checks, and the browser workflow E2E script.

Result:

Worked. No blocking code or documentation drift was found.

Why:

The UI now reflects effective permissions while server actions still enforce authorization. The browser workflow covers real current-user switching, form submission, server actions, redirects, role-permission toggling, and database outcome checks.

Decision:

Accept this milestone and move the next milestone toward photo-backed trial issue evidence and annotation-lite, matching the PM trial-photo workflow in the product vision.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:workflow:e2e`, `pnpm pilot:check` with a temporary dev server, and `pnpm pilot:e2e` with a temporary dev server passed.

Related Docs:

- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Admin Tabs And Safe Role Deletion Added To Scope

Context:

The Admin matrix milestone previously treated hard role deletion as out of scope and relied on role deactivation as the safe path.

Tried:

Updated the source-of-truth docs to split `/admin` into distinct Users and Roles & Permissions areas and to support a delete/remove role action.

Result:

Accepted as the next Admin UX refinement. Role removal should feel like deletion to Admin users, but the server must hard-delete only unused/no-history roles and deactivate/archive roles that have assigned users or preserved history.

Why:

User creation and role/permission design are distinct workflows. Keeping them in separate tabs reduces confusion, while safe deletion keeps the active matrix clean without breaking historical records.

Decision:

Implement Admin tabs plus safe role deletion/removal before continuing deeper workflow modules if Admin setup needs to be polished first. The protected Admin role remains undeletable and cannot lose the last active admin path.

Verification:

Pending implementation. Acceptance tests now define user-tab creation, matrix permission editing, safe role deletion, and protected Admin role behavior.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Process x Role Permission Matrix

Context:

The Admin role-permission editor worked by opening each role separately, but the preferred product direction is now a spreadsheet-like process x role matrix so Admin can review one workflow step across all roles at once.

Tried:

Updated the permission docs and decision log first, then replaced the `/admin` role-permission editor with a compact matrix grouped by process. Added role create/edit/deactivate support, protected the Admin role from deactivation, kept critical Admin management permissions locked, and made matrix saves write RolePermission and ActivityLog records through server actions that require `admin.manage_roles`.

Result:

Worked. The matrix-backed browser workflow can grant QC the reschedule permission, verify QC gains the Add New Planned Trial UI/action, revoke the permission from the matrix, and verify QC is blocked again. The pure domain tests now cover protected Admin role state and matrix-style lockout safety.

Why:

The matrix matches the source-of-truth permissions matrix better than role-by-role editing and makes cross-role permission drift easier to spot during pilot setup.

Decision:

Use the process x role matrix as the preferred Admin role-permission management view. Keep user-specific permission override UI out of scope for now. This entry originally kept hard delete for roles out of scope; that was superseded by the later safe role deletion/removal decision, where unused roles may be hard-deleted and roles with users/history should be deactivated or archived.

Verification:

Direct local equivalents passed from the restored offline dependency install: Prisma validate, domain tests with 65 passing tests, Prisma generate, Next typegen, `tsc --noEmit`, Next build, `pilot:check`, `pilot:e2e`, and `pilot:workflow:e2e`. Plain bundled `pnpm ...` commands attempted to recreate `node_modules` from the npm registry because the sandbox pnpm default store did not match the project offline store; direct local binaries were used for verification in this offline session.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Tabs And Safe Role Removal

Context:

The process x role permission matrix worked, but `/admin` still mixed account-management forms with role and permission configuration on one long page.

Tried:

Split `/admin` into server-rendered Users and Roles & Permissions tabs. Users initially supported department group assignment, which was later removed from Phase 1 account setup. Roles & Permissions keeps the process x role matrix, adds role create/edit/remove controls, protects the Admin role from rename/deactivation/removal, and routes role removal through a server action that hard-deletes unused roles or archives assigned roles.

Result:

Worked. The browser workflow now creates a user from the Users tab, creates and hard-deletes an unused role from the Roles & Permissions tab, then toggles QC reschedule permission through the matrix and verifies the changed UI/server-action behavior.

Why:

Admin setup is easier when account work and permission design are separated. Safe role removal gives Admin a cleanup path without risking user/history integrity.

Decision:

Use tab-separated Admin panels for v0.1. Keep role hard delete limited to roles with no assigned users; otherwise archive by setting inactive. Keep user-specific permission override UI out of scope.

Verification:

Domain tests passed with 69 tests, direct typecheck passed, and `pilot:workflow:e2e` passed with the new Admin tab/user/role paths.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Named Permission Foundation Implemented

Context:

Phase 1 had hardcoded role checks in server actions and trusted per-form acting-user fields. The docs called for Admin-assigned internal accounts, named permissions, role grants, and user override support.

Tried:

Added Prisma models for Permission, RolePermission, and UserPermissionOverride. Seed now creates the Phase 1 permission codes and default role grants from the permissions matrix. Server actions resolve the actor from a current-user cookie and check named permission codes. A compact `/admin` page manages users and role-permission assignments.

Result:

Worked for the v0.1 permission foundation at that time. QC and Marketing/Sales no longer inherited reschedule access by form choice; Technical PM, PM Assistant, Injection Manager, Planning PM, and Admin had default reschedule permission. This role split was later superseded by the real pilot PM/Injection/Admin default reschedule model on 2026-07-01. Permission changes write ActivityLog records.

Why:

Named permission checks let Admin change workflow authority without editing hardcoded server role sets, while business validators still enforce required dates, reasons, trial-limit rules, closure fields, and privacy boundaries.

Decision:

Use role permissions as the editable default policy. Keep UserPermissionOverride in schema/helpers for exceptions, but user-specific override UI is not built yet. The current-user selector and "password/email login out of v0.1 scope" note was superseded by the 2026-07-01 real login MVP.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, and `pnpm pilot:check` passed. `pilot:check` warned only that HTTP smoke was skipped because the dev server was not running.

Related Docs:

- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Permission Milestone Review Passed With Real-Workflow Test Gap

Context:

The named permission foundation was reviewed after implementation.

Tried:

Inspected schema, permission helpers, Admin actions, trial server actions, Admin UI, seed data, docs, and pilot scripts. Ran Prisma validation, domain tests, typecheck, production build, pilot preflight, HTTP smoke, and pilot E2E.

Result:

Worked after repairing a corrupted generated `node_modules` tree where pnpm dependency symlinks had been placed into duplicate `node_modules 2` folders. Source checks then passed.

Why:

The code now uses named permissions and a current-user cookie instead of per-form acting-user fields. However, the pilot E2E script still writes most workflow state directly through Prisma, so it proves data shape and page rendering more than real server-action behavior.

Decision:

Treat the permission foundation as accepted for v0.1. The next milestone should make the module more realistically interactive: permission-aware UI states and browser/server-action workflow tests.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed after dependency repair. HTTP smoke passed with a temporary dev server.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Development Log Created

Context:

The user approved creating a development log to track what was tried, failed, worked, removed, and why.

Tried:

Created `docs/03-build/development.md`.

Result:

Worked as the engineering companion to the product decision log.

Why:

The decision log should stay focused on product direction. The development log should capture implementation history, test gaps, and lessons for future Coder prompts.

Decision:

Use this file during progress reviews and after meaningful coding milestones.

Verification:

This entry exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`
