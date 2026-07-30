#!/usr/bin/env node
/**
 * Atomic writer for the Backup v2 status file.
 *
 * The shell legs of the pipeline (scripts/backup.sh, scripts/backup-verify.sh)
 * call this once per stage. It reads the existing document defensively, merges
 * ONE stage, and replaces the file with a temp-file + rename so a reader (the
 * admin health widget) never observes a half-written JSON.
 *
 * Two scripts share this file, so the read-merge-write section runs under a
 * `mkdir` mutex (portable to macOS, where flock(1) does not exist): without it
 * a backup.sh upload update and a backup-verify.sh verify update landing in the
 * same second could each read the pre-update document and the later rename
 * would silently drop the earlier stage.
 *
 * All shape, merge, redaction, health, drill-scheduling and lock-policy logic
 * lives in the shared pure module src/domain/security/backup-status.ts — this
 * file is only argv + filesystem. No npm dependencies: Node's own type
 * stripping loads the .ts module directly, the same way
 * scripts/run-kpi-snapshot.mjs does.
 *
 *   node scripts/backup-status.mjs --file PATH --app NAME --stage STAGE \
 *     --status ok|failed|offline|skipped|unconfigured \
 *     [--at ISO8601] [--detail TEXT] [--fact key=value ...]
 *   node scripts/backup-status.mjs --file PATH --print
 *   node scripts/backup-status.mjs --file PATH --drill-due [--max-age-days 30]
 *
 * ESTATE RULE: no application is named here. `--app`, `--file` and the stage
 * facts come from the caller's config block (scripts/backup-app-config.sh).
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  applyBackupStageUpdate,
  backupDrillSchedule,
  backupStageNames,
  decideLockRetry,
  evaluateCloudDrillDue,
  parseBackupStatus
} from "../src/domain/security/backup-status.ts";

const VALID_STATUSES = new Set(["ok", "failed", "offline", "skipped", "unconfigured"]);

function fail(message) {
  process.stderr.write(`[backup-status FAIL] ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    file: null,
    app: "",
    stage: null,
    status: null,
    at: null,
    detail: null,
    facts: {},
    print: false,
    drillDue: false,
    maxAgeDays: backupDrillSchedule.maxAgeDays
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const takesValue = ["--file", "--app", "--stage", "--status", "--at", "--detail", "--fact", "--max-age-days"].includes(
      flag
    );
    const value = takesValue ? argv[index + 1] : null;

    if (takesValue && (value == null || value.startsWith("--"))) {
      fail(`${flag} requires a value.`);
    }

    switch (flag) {
      case "--file":
        options.file = value;
        index += 1;
        break;
      case "--app":
        options.app = value;
        index += 1;
        break;
      case "--stage":
        options.stage = value;
        index += 1;
        break;
      case "--status":
        options.status = value;
        index += 1;
        break;
      case "--at":
        options.at = value;
        index += 1;
        break;
      case "--detail":
        options.detail = value;
        index += 1;
        break;
      case "--fact": {
        const separator = value.indexOf("=");
        if (separator <= 0) {
          fail("--fact expects key=value.");
        }
        const key = value.slice(0, separator);
        const raw = value.slice(separator + 1);
        const numeric = Number(raw);
        options.facts[key] = raw.length > 0 && Number.isFinite(numeric) ? numeric : raw;
        index += 1;
        break;
      }
      case "--print":
        options.print = true;
        break;
      case "--drill-due":
        options.drillDue = true;
        break;
      case "--max-age-days": {
        const days = Number(value);
        if (!Number.isFinite(days) || days <= 0) {
          fail("--max-age-days expects a positive number of days.");
        }
        options.maxAgeDays = days;
        index += 1;
        break;
      }
      default:
        fail(`Unknown argument: ${flag}`);
    }
  }

  return options;
}

function readExisting(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error != null && error.code === "ENOENT") {
      return null;
    }
    // An unreadable file must not stop the backup chain: treat it as absent and
    // rewrite it. The pipeline losing history is far cheaper than the pipeline
    // stopping.
    process.stderr.write(`[backup-status] existing status unreadable (${error?.code ?? "error"}); rewriting.\n`);
    return null;
  }
}

/** Sleep without a dependency and without going async — the critical section
 *  must stay a straight line so the lock is always released on the way out. */
function sleepSync(milliseconds) {
  if (!(milliseconds > 0)) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockDirectoryFor(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.lock`);
}

/** Age of an existing lock directory, or null if it vanished under us. */
function lockAgeMs(lockDir) {
  try {
    return Math.max(0, Date.now() - statSync(lockDir).mtimeMs);
  } catch {
    return null;
  }
}

/**
 * Acquire the read-merge-write mutex. `mkdir` is the primitive because it is
 * atomic on every filesystem this runs on and needs no flock(1) (absent on
 * macOS). Returns `{ held }` — a false `held` means we are writing without the
 * lock, which is the pre-mutex race and strictly better than dropping the
 * archive's status on the floor. It is always warned about, never silent.
 */
function acquireStatusLock(file) {
  const lockDir = lockDirectoryFor(file);
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      return { lockDir, held: true };
    } catch (error) {
      if (error == null || error.code !== "EEXIST") {
        process.stderr.write(
          `[backup-status] could not create the status lock (${error?.code ?? "error"}); writing unlocked.\n`
        );
        return { lockDir, held: false };
      }
    }

    const decision = decideLockRetry({
      waitedMs: Date.now() - startedAt,
      lockAgeMs: lockAgeMs(lockDir),
      attempt
    });

    if (decision.action === "break") {
      process.stderr.write(
        `[backup-status] breaking a stale status lock (older than 60s): ${lockDir}\n`
      );
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Another writer may have cleared it first; the next mkdir decides.
      }
      continue;
    }

    if (decision.action === "proceedUnlocked") {
      process.stderr.write(
        `[backup-status] status lock still held after 10s; writing unlocked (a concurrent stage update may be lost).\n`
      );
      return { lockDir, held: false };
    }

    sleepSync(decision.delayMs);
  }
}

function releaseStatusLock(lock) {
  if (!lock.held) {
    return;
  }
  try {
    rmSync(lock.lockDir, { recursive: true, force: true });
  } catch {
    // A broken-then-recreated lock is not ours to remove; the staleness rule
    // clears it within a minute either way.
  }
}

function writeAtomic(file, contents) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.tmp.${process.pid}`);
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw error;
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.file == null || options.file.length === 0) {
  fail("--file is required.");
}

// ── Read-only modes: no lock. The writer renames into place, so any single
//    read either sees the whole previous document or the whole new one.
if (options.print) {
  process.stdout.write(`${JSON.stringify(parseBackupStatus(readExisting(options.file)), null, 2)}\n`);
  process.exit(0);
}

if (options.drillDue) {
  // "run|skip <reason> <ageDays>" — backup-verify.sh reads the first field.
  const decision = evaluateCloudDrillDue(
    parseBackupStatus(readExisting(options.file)),
    new Date(),
    options.maxAgeDays
  );
  const age = decision.ageDays == null ? "never" : decision.ageDays.toFixed(1);
  process.stdout.write(`${decision.run ? "run" : "skip"} ${decision.reason} ${age}\n`);
  process.exit(0);
}

if (options.stage == null || !backupStageNames.includes(options.stage)) {
  fail(`--stage must be one of: ${backupStageNames.join(", ")}`);
}
if (options.status == null || !VALID_STATUSES.has(options.status)) {
  fail(`--status must be one of: ${[...VALID_STATUSES].join(", ")}`);
}
if (options.app.length === 0) {
  fail("--app is required (it comes from the caller's app identity block).");
}

const at = options.at != null && !Number.isNaN(Date.parse(options.at)) ? options.at : new Date().toISOString();

// The lock directory has to live somewhere, so make the parent first.
mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 });

// ── Critical section: read → merge → atomic rename, one writer at a time ─────
const lock = acquireStatusLock(options.file);
try {
  const current = parseBackupStatus(readExisting(options.file));

  const next = applyBackupStageUpdate(current, {
    app: options.app,
    stage: options.stage,
    status: options.status,
    at,
    detail: options.detail,
    facts: options.facts
  });

  writeAtomic(options.file, `${JSON.stringify(next, null, 2)}\n`);
} finally {
  releaseStatusLock(lock);
}

process.stdout.write(`[backup-status] ${options.stage}=${options.status} -> ${options.file}\n`);
