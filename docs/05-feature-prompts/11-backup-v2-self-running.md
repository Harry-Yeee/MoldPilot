# Prompt 11 — Backup v2: the self-running, self-verifying, immutable backup system

One Codex session. Owner decisions already made (2026-07-29, Harry):
**Aliyun OSS** off-site leg · **30-day WORM** immutability · **full restore verify nightly** · tooling **rclone**.
The owner authorizes edits to `scripts/backup.sh` and the backup LaunchAgent for this build.

> **CORRECTED 2026-07-30** (cross-review, findings 1–8). This prompt shipped with two errors that
> the built system no longer follows; the runbook §7b is authoritative:
>
> 1. **Lifecycle (item 2 below).** "Expire noncurrent versions >90 days" expires *nothing*: every
>    archive is uniquely named, so no object ever becomes noncurrent and the bucket grows without
>    bound. The real policy is four rules — expire **current** versions after
>    `BACKUP_CLOUD_RETENTION_DAYS` = 180 days (deliberately longer than the 30-day WORM lock, or the
>    deletion is refused and the rule never converges), expire noncurrent versions 30 days after
>    they become noncurrent, clean expired-object delete markers, and abort incomplete multipart
>    uploads after 7 days.
> 2. **"Put-only" credential (item 3 below).** The key is **prefix-scoped and no-delete
>    (Put/Get/List)**. It can read back everything it has uploaded — the cloud drill requires that.
>    Calling it "put-only" overstated the containment.
>
> Also changed in the build: the cloud drill is scheduled by **age** (retry until it succeeds), not
> on the 1st of the month; acceptance gained **G0** (owner-laptop proof that WORM is *Locked*) and
> **G2** (prove the exact rclone operations against the real RAM policy).

## Goal

The mini backs itself up, ships an immutable off-site copy, proves its own restores, and surfaces
one health light on the admin page. No recurring human steps. Manual USB rotation is retired once
the first monthly cloud drill passes.

## Architecture (already agreed — do not redesign)

1. Local leg (exists): nightly launchd → age-encrypted archive to `BACKUP_DIR` (mounted drive).
2. Cloud leg (new): after a successful local archive, `rclone copy` (NEVER `sync` — sync propagates
   deletions) the archive to **one estate-wide Aliyun OSS bucket `lj-erp-backups`** under the app's
   prefix (`moldpilot/`). Bucket has: versioning ON, a **compliance retention (WORM) policy of
   30 days, locked**, and a lifecycle rule (set from the owner's laptop, never the mini) expiring
   noncurrent versions >90 days. One bucket, one WORM policy, one lifecycle serve every future app.
3. Credentials on the mini: a RAM sub-user access key **per app**, whose policy allows ONLY
   `oss:PutObject`, `oss:GetObject`, `oss:ListObjects` scoped to `lj-erp-backups/moldpilot/*` (RAM
   policies support object-prefix resources). No Delete*, no bucket admin, no lifecycle rights, no
   access to other apps' prefixes. Document the exact policy JSON as a TEMPLATE with the app prefix
   as the variable. rclone config file mode 0600. Root Aliyun credentials never touch the mini.
4. Verify leg (new): nightly after backup — restore the newest LOCAL archive into a scratch
   database (`createdb moldpilot_verify` → restore → assert key tables nonzero + manifest counts →
   drop). Monthly (1st) — pull the newest archive FROM OSS via rclone and run the same verify
   ("cloud drill"). All results recorded.
5. Health surface (new): the backup pipeline writes `backup-status.json` (inside
   `MOLDPILOT_STORAGE_DIR`, atomic write) with timestamps + results of: last local archive, last
   cloud upload, last nightly verify, last cloud drill. The MoldPilot ADMIN page renders a compact
   bilingual health line from it — green normally, red if local backup age >26h, upload age >26h
   (>3 consecutive failures noted), verify failed, or cloud drill >35 days old. Admin-only;
   graceful "no status yet" state; server component reading the file defensively.

## Deliverables

- `scripts/backup.sh`: cloud-upload step (failure = nonzero + status recorded; offline tolerated,
  alert via status thresholds), status-file writes at each stage.
- `scripts/backup-verify.sh` (or .mjs, match repo conventions): nightly scratch-restore verify +
  monthly cloud drill; never touches the production database; drops its scratch DB even on failure.
- LaunchAgent(s): extend `com.moldpilot.backup` or add a sibling for verify; keep the documented
  "runs while the dedicated account is logged in" caveat.
- Admin page: the health widget (bilingual labels via the labels pattern; no new queries beyond
  reading the JSON; hidden below md is fine).
- Docs: runbook **§7b "Cloud leg setup 云端备份配置"** — step-by-step from the owner's laptop:
  bucket creation, versioning, WORM 合规保留策略 30d + LOCK, lifecycle, RAM user + policy JSON,
  key handover to the mini's `.env` (`BACKUP_OSS_*` names documented in
  `ops/config/production.env.example` style), `brew install rclone`, rclone config. Plus:
  deployment-checklist item 7 gains the cloud leg + the rotation-retirement rule; development.md
  TOP entry.

## Estate convention — leave space for SupplyDesk, ClientView, Warehouse

This build ships inside MoldPilot (the only production app today), but nothing app-specific may be
hardcoded inside the logic:

- `backup-verify.sh` and the cloud-upload step read their identity from configuration at the top /
  env: app name, database name, storage dir, OSS prefix, status-file path. Adding the next app must
  be "copy the config block, create its prefix + RAM key," never "edit the logic."
- The runbook §7b documents this as the ESTATE convention: same bucket, per-app prefix, per-app
  prefix-scoped no-delete (Put/Get/List) key, per-app status file, per-app admin health widget. Include a short
  "onboarding the next app" subsection (5 steps).
- When a second app reaches production, the parameterized core lifts into the platform repo's
  `ops/` (where backup infrastructure already lives) and apps consume it — note this as the planned
  migration in the runbook, aligned with the platform's D-milestone versioning. Do not move it now.
- Estate-wide health (all apps on one screen) is a platform/D3 concern — out of scope; each app
  shows its own light.

## Non-negotiable acceptance tests

1. **Immutability proof:** from the mini, a deliberate `rclone delete` / `deletefile` attempt on an
   uploaded archive MUST FAIL (key lacks delete; WORM as second wall). Record the exact error in
   the runbook as the expected output. If the delete succeeds, the build is wrong — stop.
2. Nightly verify proves a restore: scratch DB contains >0 users and >0 projects from the archive,
   manifest verification passes, scratch dropped.
3. Cloud drill restores from OSS bytes, not local cache.
4. Kill-switch honesty: unplug the drive → next run records local failure in status → admin page
   goes red. Disconnect network → upload failure recorded → red after threshold.
5. Existing gates stay green: `bash -n` on all shell, `pnpm typecheck`, `pnpm test`, e2e sentinels
   untouched.

## Hard rules

No new npm dependencies (rclone is a brew dependency — document it in the runbook and the deploy
preflight if there is a prerequisites list). No schema changes. Never store delete-capable or root
credentials on the mini. Status JSON must never contain secrets. The verify scratch DB name must be
unmistakable (`moldpilot_verify_scratch`) and the script must refuse to run against any DB whose
name lacks the `_verify` suffix — belt and braces against ever touching production.
