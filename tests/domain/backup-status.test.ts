import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyBackupStageUpdate,
  backupDrillSchedule,
  backupHealthThresholds,
  backupLockPolicy,
  BACKUP_STATUS_SCHEMA,
  decideLockRetry,
  emptyBackupStatus,
  evaluateBackupHealth,
  evaluateCloudDrillDue,
  parseBackupStatus,
  sanitizeStatusDetail,
  type BackupHealthFindingCode,
  type BackupStatusFile
} from "../../src/domain/security/backup-status.ts";
import {
  backupHealthFindingLabels,
  backupHealthLabels
} from "../../src/domain/mold-trial/labels.ts";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

/** Source with whole-line comments removed, so prose about a command cannot be
 *  mistaken for the command itself. */
function commands(relativePath: string): string {
  return source(relativePath)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const NOW = new Date("2026-07-29T06:00:00.000Z");

function hoursBefore(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function daysBefore(days: number): string {
  return hoursBefore(days * 24);
}

/** A chain where every leg has just succeeded. */
function healthyStatus(): BackupStatusFile {
  let status = emptyBackupStatus("moldpilot");
  status = applyBackupStageUpdate(status, {
    app: "moldpilot",
    stage: "localArchive",
    status: "ok",
    at: hoursBefore(3),
    facts: { archiveName: "moldpilot-backup-20260729T023000Z.tar.age", sizeBytes: 4096 }
  });
  status = applyBackupStageUpdate(status, {
    app: "moldpilot",
    stage: "cloudUpload",
    status: "ok",
    at: hoursBefore(3)
  });
  status = applyBackupStageUpdate(status, {
    app: "moldpilot",
    stage: "nightlyVerify",
    status: "ok",
    at: hoursBefore(2),
    facts: { userCount: 12, projectCount: 34 }
  });
  status = applyBackupStageUpdate(status, {
    app: "moldpilot",
    stage: "cloudDrill",
    status: "ok",
    at: daysBefore(9)
  });
  return status;
}

function codes(status: BackupStatusFile | null): BackupHealthFindingCode[] {
  return evaluateBackupHealth(status, NOW).findings.map((finding) => finding.code);
}

describe("backup status file", () => {
  it("degrades to no-status rather than throwing on anything unreadable", () => {
    assert.equal(parseBackupStatus(null), null);
    assert.equal(parseBackupStatus(undefined), null);
    assert.equal(parseBackupStatus(""), null);
    assert.equal(parseBackupStatus("   "), null);
    assert.equal(parseBackupStatus("{ this is not json"), null);
    assert.equal(parseBackupStatus("[1,2,3]"), null);
    assert.equal(parseBackupStatus('"a string"'), null);
  });

  it("normalises a half-written or hand-edited document field by field", () => {
    const parsed = parseBackupStatus(
      JSON.stringify({
        app: "moldpilot",
        updatedAt: "not a date",
        stages: {
          localArchive: { status: "ok", at: "2026-07-29T02:30:00Z", consecutiveFailures: -4 },
          cloudUpload: "nonsense",
          nightlyVerify: { status: "banana", facts: { userCount: 12, junk: { nested: true } } }
        }
      })
    );

    assert.ok(parsed != null);
    assert.equal(parsed.updatedAt, null);
    assert.equal(parsed.stages.localArchive.status, "ok");
    assert.equal(parsed.stages.localArchive.consecutiveFailures, 0);
    assert.equal(parsed.stages.cloudUpload.status, "never");
    // An unknown status word must not leak through as a verdict input.
    assert.equal(parsed.stages.nightlyVerify.status, "never");
    assert.deepEqual(parsed.stages.nightlyVerify.facts, { userCount: 12 });
    assert.equal(parsed.stages.cloudDrill.status, "never");
  });

  it("keeps secrets out of the detail string", () => {
    assert.equal(
      sanitizeStatusDetail("AccessDenied AccessKeySecret=SUPERSECRETVALUE retrying"),
      "AccessDenied AccessKeySecret=[redacted] retrying"
    );
    assert.equal(sanitizeStatusDetail("using LTAI5tAbCdEfGhIjKl now"), "using [redacted] now");
    assert.equal(
      sanitizeStatusDetail("postgresql://moldpilot:hunter2@127.0.0.1:5432/moldpilot"),
      "postgresql://[redacted]@127.0.0.1:5432/moldpilot"
    );
    assert.equal(sanitizeStatusDetail("identity AGE-SECRET-KEY-1QQQQQ failed"), "identity [redacted] failed");
    assert.equal(sanitizeStatusDetail("password: hunter2"), "password=[redacted]");
    assert.equal(sanitizeStatusDetail("Authorization Bearer abc.def"), "Authorization [redacted]");
    assert.equal(sanitizeStatusDetail("line one\nline two\t\tend"), "line one line two end");
    assert.equal(sanitizeStatusDetail("   "), null);
    assert.equal(sanitizeStatusDetail(42), null);
    const long = sanitizeStatusDetail("x".repeat(500));
    assert.ok(long != null && long.length === 200 && long.endsWith("…"));
  });

  it("merges one stage at a time and tracks the failure streak", () => {
    const at = "2026-07-29T02:30:00.000Z";
    let status = applyBackupStageUpdate(null, {
      app: "moldpilot",
      stage: "localArchive",
      status: "ok",
      at,
      facts: { sizeBytes: 1024 }
    });
    assert.equal(status.schema, BACKUP_STATUS_SCHEMA);
    assert.equal(status.stages.localArchive.lastSuccessAt, at);
    assert.equal(status.stages.cloudUpload.status, "never");

    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "offline",
      at: "2026-07-29T02:31:00.000Z"
    });
    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "failed",
      at: "2026-07-30T02:31:00.000Z"
    });
    assert.equal(status.stages.cloudUpload.consecutiveFailures, 2);
    assert.equal(status.stages.cloudUpload.lastSuccessAt, null);
    // The other legs are carried forward untouched — two scripts share this file.
    assert.equal(status.stages.localArchive.lastSuccessAt, at);
    assert.equal(status.stages.localArchive.facts.sizeBytes, 1024);

    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "ok",
      at: "2026-07-31T02:31:00.000Z"
    });
    assert.equal(status.stages.cloudUpload.consecutiveFailures, 0);

    // `unconfigured` is not an attempt: it must not inflate the streak.
    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "unconfigured",
      at: "2026-08-01T02:31:00.000Z"
    });
    assert.equal(status.stages.cloudUpload.consecutiveFailures, 0);
    assert.equal(status.stages.cloudUpload.lastSuccessAt, "2026-07-31T02:31:00.000Z");
  });

  it("never lets a failure erase the last known success", () => {
    const status = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "localArchive",
      status: "failed",
      at: hoursBefore(1),
      detail: "BACKUP_DIR is not reachable"
    });
    assert.equal(status.stages.localArchive.lastSuccessAt, hoursBefore(3));
  });
});

describe("backup health verdict", () => {
  it("shows the calm unknown state when there is no status file", () => {
    const health = evaluateBackupHealth(null, NOW);
    assert.equal(health.level, "unknown");
    assert.equal(health.missing, true);
    assert.deepEqual(health.findings, []);
    assert.equal(health.stages.length, 4);
  });

  it("is green when every leg is fresh", () => {
    const health = evaluateBackupHealth(healthyStatus(), NOW);
    assert.equal(health.level, "green");
    assert.deepEqual(health.findings, []);
    assert.equal(health.app, "moldpilot");
  });

  it("goes red when the local archive passes 26 hours", () => {
    const stale = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "localArchive",
      status: "ok",
      at: hoursBefore(27)
    });
    assert.deepEqual(codes(stale), ["localArchiveStale"]);
    assert.equal(evaluateBackupHealth(stale, NOW).level, "red");

    const fresh = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "localArchive",
      status: "ok",
      at: hoursBefore(25)
    });
    assert.equal(evaluateBackupHealth(fresh, NOW).level, "green");
  });

  it("goes red on a failed local archive even when a recent success exists", () => {
    const failed = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "localArchive",
      status: "failed",
      at: hoursBefore(1)
    });
    assert.deepEqual(codes(failed), ["localArchiveFailed"]);
  });

  it("goes red when the off-site copy passes 26 hours", () => {
    const stale = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "ok",
      at: hoursBefore(30)
    });
    assert.ok(codes(stale).includes("cloudUploadStale"));
    assert.equal(evaluateBackupHealth(stale, NOW).level, "red");
  });

  it("treats a short upload streak as amber and a long one as red", () => {
    let short = healthyStatus();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      short = applyBackupStageUpdate(short, {
        app: "moldpilot",
        stage: "cloudUpload",
        status: "offline",
        at: hoursBefore(2)
      });
    }
    assert.deepEqual(codes(short), ["cloudUploadRetrying"]);
    assert.equal(evaluateBackupHealth(short, NOW).level, "amber");

    let long = healthyStatus();
    for (let attempt = 0; attempt < backupHealthThresholds.cloudUploadFailureStreak + 1; attempt += 1) {
      long = applyBackupStageUpdate(long, {
        app: "moldpilot",
        stage: "cloudUpload",
        status: "offline",
        at: hoursBefore(2)
      });
    }
    assert.ok(codes(long).includes("cloudUploadFailureStreak"));
    assert.equal(evaluateBackupHealth(long, NOW).level, "red");
  });

  it("goes red when the nightly restore proof fails", () => {
    const failed = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "nightlyVerify",
      status: "failed",
      at: hoursBefore(1),
      detail: "table users restored with zero rows"
    });
    assert.deepEqual(codes(failed), ["verifyFailed"]);
    assert.equal(evaluateBackupHealth(failed, NOW).level, "red");
  });

  it("goes red when the cloud drill passes 35 days", () => {
    const stale = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(36)
    });
    assert.deepEqual(codes(stale), ["drillStale"]);
    assert.equal(evaluateBackupHealth(stale, NOW).level, "red");

    const withinGrace = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(34)
    });
    assert.equal(evaluateBackupHealth(withinGrace, NOW).level, "green");
  });

  it("is amber, not red, for a chain that has simply never run a leg", () => {
    const fresh = emptyBackupStatus("moldpilot");
    const health = evaluateBackupHealth(fresh, NOW);
    assert.equal(health.level, "amber");
    assert.deepEqual(health.findings.map((finding) => finding.code).sort(), [
      "cloudUploadNever",
      "drillNever",
      "localArchiveNever",
      "verifyNever"
    ]);
  });

  it("calls an unset cloud leg unconfigured rather than pretending it is fine", () => {
    const unconfigured = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "unconfigured",
      at: hoursBefore(1),
      detail: "rclone is not installed on this machine"
    });
    // A previously successful upload is still recorded, so only the
    // unconfigured note fires — the freshness clock keeps running underneath.
    assert.deepEqual(codes(unconfigured), ["cloudUploadUnconfigured"]);
    assert.equal(evaluateBackupHealth(unconfigured, NOW).level, "amber");
  });

  it("commissions the chain only once all three nightly legs have succeeded", () => {
    let status = emptyBackupStatus("moldpilot");
    assert.equal(status.commissioned, false);

    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "localArchive",
      status: "ok",
      at: hoursBefore(3)
    });
    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "ok",
      at: hoursBefore(3)
    });
    assert.equal(status.commissioned, false, "two of three legs is not commissioned");

    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "nightlyVerify",
      status: "ok",
      at: hoursBefore(2)
    });
    assert.equal(status.commissioned, true);
    assert.equal(evaluateBackupHealth(status, NOW).commissioned, true);

    // The marker is sticky: a later failure cannot un-commission the chain.
    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudUpload",
      status: "failed",
      at: hoursBefore(1)
    });
    assert.equal(status.commissioned, true);

    // And it survives a round trip through the file, including a hand edit
    // that deleted the marker while the successes are still there.
    const reparsed = parseBackupStatus(JSON.stringify({ ...status, commissioned: false }));
    assert.equal(reparsed?.commissioned, true);
  });

  it("is red, not amber, when a COMMISSIONED leg loses its success record", () => {
    const commissioned = healthyStatus();
    assert.equal(commissioned.commissioned, true);

    const erased: BackupStatusFile = {
      ...commissioned,
      stages: {
        ...commissioned.stages,
        cloudUpload: { ...commissioned.stages.cloudUpload, lastSuccessAt: null, status: "never" }
      }
    };

    const health = evaluateBackupHealth(erased, NOW);
    assert.equal(health.level, "red");
    assert.deepEqual(
      health.findings.filter((finding) => finding.stage === "cloudUpload"),
      [{ code: "cloudUploadNever", stage: "cloudUpload", level: "red" }]
    );

    // The same absence on a chain that was never commissioned stays amber.
    const fresh = emptyBackupStatus("moldpilot");
    assert.equal(evaluateBackupHealth(fresh, NOW).level, "amber");
    assert.ok(
      evaluateBackupHealth(fresh, NOW).findings.every((finding) => finding.level === "amber")
    );
  });

  it("goes red when the nightly proof stops passing, not just when it errors", () => {
    const stale = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "nightlyVerify",
      status: "ok",
      at: hoursBefore(backupHealthThresholds.verifyMaxAgeHours + 1)
    });
    assert.deepEqual(codes(stale), ["verifyStale"]);
    assert.equal(evaluateBackupHealth(stale, NOW).level, "red");

    const withinGrace = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "nightlyVerify",
      status: "ok",
      at: hoursBefore(backupHealthThresholds.verifyMaxAgeHours - 1)
    });
    assert.equal(evaluateBackupHealth(withinGrace, NOW).level, "green");
  });

  it("reads a missing status file as red where backups are expected, unknown elsewhere", () => {
    const production = evaluateBackupHealth(null, NOW, { expected: true });
    assert.equal(production.level, "red");
    assert.equal(production.missing, true);
    assert.deepEqual(
      production.findings.map((finding) => finding.code),
      ["statusFileMissing"]
    );

    const laptop = evaluateBackupHealth(null, NOW, { expected: false });
    assert.equal(laptop.level, "unknown");
    assert.deepEqual(laptop.findings, []);
    // Unset behaves exactly like an explicit false — dev machines stay calm.
    assert.equal(evaluateBackupHealth(null, NOW).level, "unknown");
    // A corrupt file parses to null and takes the same path.
    assert.equal(
      evaluateBackupHealth(parseBackupStatus("{ not json"), NOW, { expected: true }).level,
      "red"
    );
  });

  it("labels every finding code in both languages", () => {
    const declared = source("src/domain/security/backup-status.ts")
      .split("export type BackupHealthFindingCode =")[1]
      .split(";")[0]
      .match(/"([a-zA-Z]+)"/g)!
      .map((quoted) => quoted.replaceAll('"', ""));

    assert.ok(declared.length > 0);
    assert.deepEqual([...declared].sort(), Object.keys(backupHealthFindingLabels).sort());
    for (const label of Object.values(backupHealthFindingLabels)) {
      assert.ok(label.en.length > 0);
      assert.ok(label.zh.length > 0);
    }
    for (const label of Object.values(backupHealthLabels)) {
      assert.ok(label.en.length > 0);
      assert.ok(label.zh.length > 0);
    }
  });
});

describe("cloud drill scheduling", () => {
  it("runs when the drill has never succeeded", () => {
    const decision = evaluateCloudDrillDue(emptyBackupStatus("moldpilot"), NOW);
    assert.deepEqual(decision, { run: true, reason: "never", ageDays: null });
    // No status file at all is the same answer: prove it, then record it.
    assert.equal(evaluateCloudDrillDue(null, NOW).run, true);
  });

  it("skips while the last successful drill is inside the window", () => {
    const fresh = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(29)
    });
    const decision = evaluateCloudDrillDue(fresh, NOW);
    assert.equal(decision.run, false);
    assert.equal(decision.reason, "fresh");
    assert.ok(decision.ageDays != null && Math.round(decision.ageDays) === 29);
  });

  it("runs again once the last successful drill is older than the window", () => {
    const stale = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(backupDrillSchedule.maxAgeDays + 1)
    });
    assert.equal(evaluateCloudDrillDue(stale, NOW).reason, "stale");
    assert.equal(evaluateCloudDrillDue(stale, NOW).run, true);
  });

  it("retries the next night after a failed or offline drill", () => {
    // A failure never advances lastSuccessAt, so the drill stays due — this is
    // what the old day-of-month trigger got wrong: one bad night cost a month.
    let status = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(40)
    });
    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "offline",
      at: hoursBefore(1)
    });
    assert.equal(evaluateCloudDrillDue(status, NOW).run, true);

    status = applyBackupStageUpdate(status, {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "failed",
      at: hoursBefore(0.5)
    });
    assert.equal(evaluateCloudDrillDue(status, NOW).run, true);
  });

  it("honours a custom window and refuses a nonsense one", () => {
    const status = applyBackupStageUpdate(healthyStatus(), {
      app: "moldpilot",
      stage: "cloudDrill",
      status: "ok",
      at: daysBefore(3)
    });
    assert.equal(evaluateCloudDrillDue(status, NOW, 2).run, true);
    assert.equal(evaluateCloudDrillDue(status, NOW, 7).run, false);
    // Zero/NaN would make every night a drill night; fall back to the default.
    assert.equal(evaluateCloudDrillDue(status, NOW, 0).run, false);
    assert.equal(evaluateCloudDrillDue(status, NOW, Number.NaN).run, false);
  });
});

describe("status file mutex policy", () => {
  it("backs off while a live lock is held", () => {
    const first = decideLockRetry({ waitedMs: 0, lockAgeMs: 10, attempt: 0 });
    assert.equal(first.action, "retry");
    assert.equal(first.delayMs, backupLockPolicy.firstDelayMs);

    const later = decideLockRetry({ waitedMs: 500, lockAgeMs: 500, attempt: 4 });
    assert.equal(later.action, "retry");
    assert.equal(later.delayMs, backupLockPolicy.firstDelayMs * 2 ** 4);

    // The backoff is capped, and never sleeps past the acquire deadline.
    const capped = decideLockRetry({ waitedMs: 1_000, lockAgeMs: 1_000, attempt: 20 });
    assert.equal(capped.delayMs, backupLockPolicy.maxDelayMs);
    const nearDeadline = decideLockRetry({
      waitedMs: backupLockPolicy.acquireTimeoutMs - 5,
      lockAgeMs: 1_000,
      attempt: 20
    });
    assert.equal(nearDeadline.delayMs, 5);
  });

  it("breaks a lock left behind by a dead run", () => {
    assert.equal(
      decideLockRetry({ waitedMs: 0, lockAgeMs: backupLockPolicy.staleAfterMs, attempt: 0 }).action,
      "break"
    );
    assert.equal(
      decideLockRetry({ waitedMs: 0, lockAgeMs: backupLockPolicy.staleAfterMs + 1, attempt: 9 })
        .action,
      "break"
    );
    // Staleness outranks the deadline: break it rather than write unlocked.
    assert.equal(
      decideLockRetry({
        waitedMs: backupLockPolicy.acquireTimeoutMs * 2,
        lockAgeMs: backupLockPolicy.staleAfterMs,
        attempt: 3
      }).action,
      "break"
    );
  });

  it("gives up after the bounded wait rather than abandoning the status", () => {
    const decision = decideLockRetry({
      waitedMs: backupLockPolicy.acquireTimeoutMs,
      lockAgeMs: 1_000,
      attempt: 30
    });
    assert.equal(decision.action, "proceedUnlocked");
    assert.equal(decision.delayMs, 0);

    // A lock that vanished between EEXIST and stat: retry immediately.
    assert.equal(decideLockRetry({ waitedMs: 10, lockAgeMs: null, attempt: 0 }).action, "retry");
  });
});

describe("backup v2 pipeline", () => {
  it("copies to the bucket and never syncs it", () => {
    const backup = commands("scripts/backup.sh");
    assert.match(backup, /rclone "\$\{RCLONE_ARGS\[@\]\}"/);
    assert.match(backup, /RCLONE_ARGS=\(copy /);
    // `sync` would propagate a local deletion into the immutable off-site copy.
    assert.doesNotMatch(backup, /\bsync\b/);
    assert.doesNotMatch(commands("scripts/backup-verify.sh"), /\bsync\b/);
    // The mini never holds delete rights, and never asks for them either.
    assert.doesNotMatch(backup, /rclone (?:delete|deletefile|purge|rmdirs)/);
    // And the reason is written down where the next engineer will read it.
    assert.match(source("scripts/backup.sh"), /NEVER `rclone sync`/);
  });

  it("refuses any scratch database name without the _verify marker", () => {
    const lib = source("scripts/backup-lib.sh");
    const verify = source("scripts/backup-verify.sh");
    assert.match(lib, /require_verify_database_name/);
    assert.match(lib, /\*_verify \| \*_verify_scratch\) ;;/);
    assert.match(lib, /must end in _verify or _verify_scratch/);
    // Guarded on entry AND immediately before the only destructive statement.
    assert.match(verify, /require_verify_database_name "\$BACKUP_VERIFY_DB_NAME" \|\| exit 2/);
    assert.match(verify, /drop_scratch_database\(\) \{\n\s+#[\s\S]*?require_verify_database_name/);
    assert.match(verify, /DROP DATABASE IF EXISTS/);
    assert.doesNotMatch(verify, /DROP DATABASE(?! IF EXISTS \\"\$BACKUP_VERIFY_DB_NAME)/);
  });

  it("keeps the app identity in one config block and out of the logic", () => {
    // ESTATE RULE. The next app copies the config block; it never edits logic.
    for (const logicFile of ["scripts/backup.sh", "scripts/backup-verify.sh", "scripts/backup-lib.sh"]) {
      assert.doesNotMatch(source(logicFile), /moldpilot/i, `${logicFile} names an application`);
    }
    const config = source("scripts/backup-app-config.sh");
    for (const setting of [
      "BACKUP_APP_NAME",
      "BACKUP_APP_DB_NAME",
      "BACKUP_APP_STORAGE_DIR",
      "BACKUP_OSS_PREFIX",
      "BACKUP_STATUS_FILE",
      "BACKUP_VERIFY_DB_NAME"
    ]) {
      assert.match(config, new RegExp(`^${setting}="\\$\\{${setting}:-`, "m"));
    }
    assert.match(config, /BACKUP_OSS_BUCKET:-lj-erp-backups/);
  });

  it("records a status for every stage the pipeline can reach", () => {
    const backup = source("scripts/backup.sh");
    const verify = source("scripts/backup-verify.sh");
    assert.match(backup, /record_status localArchive ok/);
    assert.match(backup, /record_status "\$CURRENT_STAGE" failed/);
    for (const state of ["ok", "offline", "failed", "unconfigured", "skipped"]) {
      assert.match(backup, new RegExp(`record_status cloudUpload ${state}`));
    }
    assert.match(verify, /record_verify nightlyVerify ok/);
    assert.match(verify, /record_verify nightlyVerify failed/);
    assert.match(verify, /record_verify cloudDrill ok/);
    assert.match(verify, /record_status cloudDrill (?:offline|failed|unconfigured)/);
  });

  it("writes the status file atomically, privately and under a mutex", () => {
    const writer = source("scripts/backup-status.mjs");
    assert.match(writer, /renameSync\(temporary, file\)/);
    assert.match(writer, /mode: 0o600/);
    assert.match(writer, /mode: 0o700/);
    // The read and the merge must be inside the lock, not just the write.
    assert.match(writer, /const lock = acquireStatusLock\(options\.file\);\ntry \{\n\s+const current = parseBackupStatus/);
    assert.match(writer, /\} finally \{\n\s+releaseStatusLock\(lock\);/);
  });

  it("schedules the cloud drill by age, never by calendar day", () => {
    const verify = source("scripts/backup-verify.sh");
    const lib = source("scripts/backup-lib.sh");
    // The old trigger compared a UTC day-of-month with BACKUP_DRILL_DAY, which
    // on a Beijing-time machine is the wrong day, and an offline night skipped
    // the whole month.
    assert.doesNotMatch(verify, /BACKUP_DRILL_DAY/);
    assert.doesNotMatch(verify, /date -u \+%d/);
    assert.match(verify, /cloud_drill_due/);
    assert.match(lib, /BACKUP_DRILL_MAX_AGE_DAYS/);
    assert.match(lib, /--drill-due/);
  });

  it("keeps the rehearsal inside its own temp root", () => {
    const rehearsal = source("scripts/backup-rehearsal.sh");
    // Every path that defaults outside the temp tree must be overridden — the
    // legacy breadcrumb defaults into ~/Library/Application Support.
    for (const override of [
      "export HOME=",
      "export TMPDIR=",
      "export BACKUP_ENV_FILE=",
      "export BACKUP_LEGACY_STATUS_DIR="
    ]) {
      assert.ok(rehearsal.includes(override), `rehearsal does not override ${override}`);
    }
    assert.match(rehearsal, /touched nothing outside its temp root/);
  });

  it("shows the health line on the admin page only", () => {
    const panel = source("src/app/admin/backup-health-panel.tsx");
    const adminPage = source("src/app/admin/page.tsx");
    assert.match(adminPage, /import \{ BackupHealthPanel \}/);
    assert.match(adminPage, /<BackupHealthPanel locale=\{locale\} \/>/);
    assert.match(panel, /loadBackupHealth/);
    assert.match(panel, /hidden md:block/);
    // No database work: the widget reads one JSON file and nothing else.
    assert.doesNotMatch(panel, /prisma/i);
    assert.doesNotMatch(source("src/server/backup-health.ts"), /prisma/i);
  });
});
