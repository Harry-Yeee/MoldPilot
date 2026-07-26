# Docker D2.2 Production Package And D2.2.1 FreshClam Correction

## Status

D2.2 is a production-shaped package and disposable rehearsal. It is not a
deployment, live-data migration, native Caddy activation, or production
cutover.

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

The package remains unaccepted until the complete corrected rehearsal passes.

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

## Clean Source Contract

The rehearsal refuses any tracked or untracked MoldPilot working-tree change.
It exports `HEAD` with `git archive` and builds all MoldPilot-owned contexts from
that one export:

- application production image
- migrator image
- derived ClamAV image

The app and migrator tags include the full commit SHA. The parent backup-helper
context remains under `ops/`; the parent `LJ_ERP` directory therefore needs its
own approved version-control/release strategy before D3.

## Required Rehearsal

Run only from a clean local checkpoint:

```bash
bash ../ops/scripts/moldpilot-production-smoke.sh
```

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
