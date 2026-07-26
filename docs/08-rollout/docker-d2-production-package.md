# Docker D2.2 Production Package Through D2.3 Versioned Lifecycle Proof

## Status

D2.2 is a production-shaped package and disposable rehearsal. It is not a
deployment, live-data migration, native Caddy activation, or production
cutover.

D2.3 versions the parent platform package separately from MoldPilot, binds
protected operations and backup metadata to both commits, and adds a guarded
disposable proof of the real app deploy/rollback lifecycle. It remains a
rehearsal only.

D2.1 is preserved in commit:

```text
8680d63 Docker D2.1: finalize crash-safe private scanner and persistent storage proof
```

The first D2.2 rehearsal failed before application startup because the
long-running FreshClam container started as root with only `CAP_CHOWN`, then
attempted to call `setpriv`:

```text
setpriv: setresuid failed: Operation not permitted
```

That result is expected under the configured capability boundary. D2.2.1 must
not fix it by granting `SETUID`, `SETGID`, `SYS_ADMIN`, or broad capabilities.

The first clean-source rerun proved both one-shot jobs exited successfully and
then exposed a second configuration mismatch: FreshClam still tried to open its
configured `/var/log/clamav/freshclam.log` on the read-only root filesystem.
`--stdout` does not disable that file. The runtime now explicitly uses
`--log=/tmp/freshclam.log`; `/tmp` is the service's existing bounded tmpfs, so
the correction adds no writable root path or capability.

The corrected complete rehearsal passed on 2026-07-26 from clean commit
`853f04e2e3e4aa53c50ff89e5e1e6d2614449730`. D2.2 is accepted as a
production-shaped package and disposable proof only. It remains undeployed.

## Accepted Transitional Topology

```text
Factory LAN
    |
native Caddy :443
    |
127.0.0.1:<configurable port>
    |
MoldPilot container :3000
    +--- internal database network ---> PostgreSQL 16 :5432
    +--- internal scanner network ----> clamd :3310

FreshClam ---> outbound signature-update network
FreshClam + clamd ---> named signature volume
```

- Native Caddy remains the LAN/TLS front door through D3.
- MoldPilot is the only container with a host-published port, and it binds only
  to `127.0.0.1`.
- A dedicated app-only edge bridge supplies the Docker gateway for that
  loopback publication. The database and scanner networks remain
  `internal: true`.
- PostgreSQL and clamd publish no host ports.
- PostgreSQL uses a separate MoldPilot database and non-superuser login.
- Database, uploads, quarantine, signatures, and backup work use explicit named
  volumes.
- Native MoldPilot remains the rollback path through D3.

## D2.2.1 Signature Initialization

The scanner image contains two short-lived helpers:

1. `moldpilot-signature-volume-init`
   - starts as root only for dedicated-volume ownership initialization
   - uses `network_mode: none`
   - has a read-only root filesystem
   - drops all capabilities and adds only `CHOWN`
   - rejects symlinks/unexpected nested entries, normalizes flat database-file
     ownership/modes, leaves `/signatures` owned by `1000:1000`, and exits
2. `moldpilot-signature-seed`
   - runs as `1000:1000`
   - has no network or capabilities
   - copies bundled `.cvd`/`.cld` files only when the volume is empty
   - verifies at least one non-empty signature database and exits

Long-running FreshClam starts directly as `1000:1000`. It has a read-only root,
all capabilities dropped, a writable `/tmp`, and the signature volume. It does
not call `setpriv` or perform any identity transition. Its configured log is
explicitly redirected to `/tmp/freshclam.log` so the bundled
`/var/log/clamav` path is never required.

Long-running clamd remains `1000:1000`, capability-free, private, and mounts the
signature volume read-only. `SelfCheck 600` preserves automatic definition
reload.

The two one-shot jobs support an empty volume, an existing updater-owned
volume, and a scratch-restored volume. Backup restore already rejects symlinks
and restores scanner files as UID/GID 1000.

## Production Package

The shared package lives under `../ops/` and does not modify the parent
development `docker-compose.yml`.

It provides:

- `compose.production.yml`
- protected environment example with no real credentials
- native Caddy recovery-route template
- preflight and app-only lifecycle controls
- clean-commit app/migrator build and explicit migration deploy
- encrypted helper-container backup
- isolated manifest-verified scratch restore
- disposable production-shaped rehearsal

Normal application startup never migrates, resets, or seeds.

Production scripts do not use global Compose teardown or remove production
volumes. Scratch/rehearsal cleanup removes only generated names that include the
unique disposable project identifier.

## Clean Source And Dual Release Contract

The rehearsals refuse any tracked or untracked parent or MoldPilot worktree
change. They export exact commits and build all owned contexts from those
exports:

- application production image
- migrator image
- derived ClamAV image
- parent backup-helper image

The app and migrator tags include the full MoldPilot commit SHA. The protected
environment also includes `LJ_ERP_PLATFORM_RELEASE_SHA`; encrypted backup v3
metadata carries both platform and app SHAs, and isolated restore reports both.
The platform-only repository ignores every nested app plus real environments,
credentials, backups, identities, dumps, rendered state, and release artifacts.

An early clean-source run configured the loopback port but attached MoldPilot
only to internal database/scanner networks. Docker retained the requested
binding in `HostConfig` but activated no host route. The dedicated edge bridge
corrects that topology without exposing or relaxing the private dependencies.

## Required Rehearsal

Run only from a clean local checkpoint:

```bash
bash ../ops/scripts/moldpilot-production-smoke.sh
```

From the parent root, D2.3 additionally requires:

```bash
bash ops/scripts/platform-distribution-smoke.sh
bash ops/scripts/moldpilot-release-lifecycle-smoke.sh
```

The first command proves the exact parent commit is distributable without app
repositories or sensitive/runtime material. The second starts from a recorded
previous app image, uses the actual app stop/start and deploy implementation,
creates the mandatory encrypted pre-deploy backup, explicitly migrates, replaces
only MoldPilot, restores a post-deploy backup in scratch, and executes the real
image rollback. PostgreSQL, clamd, and FreshClam IDs must remain unchanged.
Application rollback must leave migration records in place; it never reverses
database migrations.

Acceptance is defined by AT-035. The rehearsal must verify:

- one-shot initializer and seed jobs exit 0
- FreshClam and clamd run as `1000:1000`
- FreshClam survives stop/start with the existing signature volume
- explicit migrations and real synthetic-account login
- clean PDF scan/release/download
- runtime-fragmented EICAR rejection with no record or residue
- scanner outage liveness 200/readiness 503/upload 503 with retained quarantine
- app-only restart/replacement does not replace PostgreSQL or scanner services
- released and quarantined storage persists
- encrypted backup and isolated manifest-verified scratch restore
- restored login/project/attachment SHA-256
- no LAN-facing app, database, or scanner port
- exact disposable cleanup on success, failure, interruption, and termination

## Verified Rehearsal Evidence

The final corrected run passed:

- initializer and seed jobs exited 0
- FreshClam and clamd ran as `1000:1000`
- FreshClam stop/start on the existing signature volume passed
- real login, clean PDF release/download, fragmented EICAR rejection, scanner
  outage 503/recovery, and app-only restart/replacement passed
- PostgreSQL and scanner container IDs remained unchanged during app-only
  operations
- encrypted backup size: `175659064` bytes
- scratch restore: one synthetic project and one attachment
- restored release SHA:
  `853f04e2e3e4aa53c50ff89e5e1e6d2614449730`
- attachment SHA-256 before replacement and after restore:
  `171320f8998c508c92d99f78d87054bc793c1219e6dee56de29af0a40a94880a`
- app/migrator/ClamAV/backup-helper image sizes:
  `112555635` / `366678214` / `185924421` / `155897800` bytes
- cleanup audit found no uniquely named rehearsal/scratch containers,
  networks, volumes, archives, fixtures, or temporary images
- pre-existing native/development PostgreSQL container
  `98818de5d024` remained healthy and untouched

Failed precursor runs also cleaned their unique resources. They exposed, in
order, the invalid runtime `setpriv` transition, FreshClam's read-only-root log
path, an internal-only app network with no active loopback binding,
server-action multipart login semantics, a Prisma-only database URL parameter
passed to libpq, psql variable substitution through `--command`, and an
incorrect attachment timestamp column. The final rehearsal includes guards for
those corrected boundaries.

## D2.3 Versioned Lifecycle Evidence

The clean platform distribution and lifecycle rehearsals passed on 2026-07-26:

- platform implementation commit:
  `e247362c09faa351b7e7caa0e3ffc0b3fd48f92a`
- MoldPilot previous/target commits:
  `e7caaa1f375e2e4ad4dff5244bde57ce61aba701` /
  `e1c7f6d75de4f0a5c0fc632fc66b4dfc265f0285`
- platform archive: 26 tracked ordinary files, 235,520 bytes, no app repo,
  gitlink, secret, backup, identity, real environment, or Git metadata
- actual app-control stop/start: pass with dependencies unchanged
- actual deploy: encrypted pre-deploy backup, explicit migrate deploy, and only
  MoldPilot replacement passed
- scratch restore: one synthetic project, one attachment, and both exact
  platform/app release identities passed
- actual image rollback restored the previous image; all 21 migrations remained
- attachment SHA-256 before deploy, after deploy, and after rollback:
  `a1cd25fb2d3a1ccfa539414f0b75ce41932a56c0c119820c9413d1f113d5bf1f`
- all lifecycle/scratch containers, volumes, networks, images, archives,
  bundles, and fixtures were removed

This accepts only D2.3 infrastructure rehearsal evidence. It does not deploy or
authorize D3.

## Production Boundary

D2.2.1 completion accepts only the package and rehearsal evidence for
independent review. It does not:

- stop or replace native MoldPilot/PostgreSQL
- load or alter live data
- activate or reload native Caddy
- deploy a container production stack
- start D3
- push a commit

Production remains native until D3 is separately approved and completed.
