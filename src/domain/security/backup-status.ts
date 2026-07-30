/**
 * Backup v2 status file — pure parsing, merging and health evaluation.
 *
 * The backup pipeline (scripts/backup.sh + scripts/backup-verify.sh, through
 * scripts/backup-status.mjs) writes ONE JSON document per app describing the
 * four stages of the chain. The admin health widget reads the same document.
 * Both sides share the functions below so a shape change cannot drift.
 *
 * ESTATE RULE: nothing in this module names an application. The app identity
 * (name, database, storage dir, OSS prefix, status-file path) is configuration
 * supplied by the caller — see scripts/backup-app-config.sh and
 * src/server/backup-health.ts. Adding SupplyDesk/ClientView/Warehouse must be
 * "copy the config block", never "edit the logic".
 *
 * The file is written by a background job and read by a server component, so
 * every reader here is defensive: an absent, truncated, or hand-edited file
 * must degrade to "no status yet", never throw.
 */

export const BACKUP_STATUS_SCHEMA = "lj-erp-backup-status-v1";

/** The four stages of the chain, in the order the pipeline runs them. */
export const backupStageNames = ["localArchive", "cloudUpload", "nightlyVerify", "cloudDrill"] as const;

export type BackupStageName = (typeof backupStageNames)[number];

/**
 * `offline` is a tolerated upload outcome (the mini lost the network); it is
 * recorded, counts toward the failure streak, and goes red on the age
 * threshold like any other missed upload. `unconfigured` means the cloud leg
 * has not been set up yet (runbook §7b) — honest, and visibly not green.
 */
export type BackupStageStatus = "ok" | "failed" | "offline" | "skipped" | "unconfigured" | "never";

export type BackupStageRecord = {
  /** Outcome of the most recent attempt. */
  status: BackupStageStatus;
  /** When that attempt finished (ISO-8601 Z), or null if the stage never ran. */
  at: string | null;
  /** When the stage last succeeded (ISO-8601 Z). Never cleared by a failure. */
  lastSuccessAt: string | null;
  /** Short sanitized reason. Never a secret, never a full command line. */
  detail: string | null;
  /** Consecutive non-ok attempts. Reset to 0 by a success. */
  consecutiveFailures: number;
  /** Small scalar evidence (archive name, byte size, row counts). */
  facts: Record<string, string | number>;
};

export type BackupStatusFile = {
  schema: string;
  app: string;
  updatedAt: string | null;
  /**
   * COMMISSIONING MARKER. Set once — and never cleared — the first time
   * `localArchive`, `cloudUpload` and `nightlyVerify` have each succeeded at
   * least once. Before it, this is a fresh install and a leg that has never run
   * is amber ("not armed yet"). After it, the chain has proven it works on this
   * machine, so absence, staleness or failure is a regression and reads RED.
   */
  commissioned: boolean;
  stages: Record<BackupStageName, BackupStageRecord>;
};

/** The legs whose first success commissions the chain. The cloud drill is
 *  monthly, so waiting for it would leave a working install amber for weeks. */
export const backupCommissioningStages: readonly BackupStageName[] = [
  "localArchive",
  "cloudUpload",
  "nightlyVerify"
];

export const backupHealthThresholds = {
  /** Nightly cadence + a 2h grace for a slow dump or a late login. */
  localArchiveMaxAgeHours: 26,
  cloudUploadMaxAgeHours: 26,
  /** The nightly proof runs on the same cadence as the archive it proves. */
  verifyMaxAgeHours: 26,
  /** Above this many consecutive misses the upload leg is red on its own. */
  cloudUploadFailureStreak: 3,
  /** Monthly cadence + a 5-day grace. */
  cloudDrillMaxAgeDays: 35
} as const;

export type BackupHealthThresholds = typeof backupHealthThresholds;

export type BackupHealthLevel = "green" | "amber" | "red" | "unknown";

export type BackupHealthFindingCode =
  | "statusFileMissing"
  | "localArchiveNever"
  | "localArchiveFailed"
  | "localArchiveStale"
  | "cloudUploadUnconfigured"
  | "cloudUploadNever"
  | "cloudUploadStale"
  | "cloudUploadFailureStreak"
  | "cloudUploadRetrying"
  | "verifyNever"
  | "verifyFailed"
  | "verifyStale"
  | "drillNever"
  | "drillFailed"
  | "drillStale";

export type BackupHealthFinding = {
  code: BackupHealthFindingCode;
  stage: BackupStageName;
  level: "red" | "amber";
};

export type BackupHealthStage = {
  name: BackupStageName;
  status: BackupStageStatus;
  at: string | null;
  lastSuccessAt: string | null;
  detail: string | null;
  consecutiveFailures: number;
  facts: Record<string, string | number>;
  /** Hours since the last SUCCESS, or null when the stage never succeeded. */
  successAgeHours: number | null;
};

export type BackupHealth = {
  level: BackupHealthLevel;
  /** True when there is no readable status file at all. */
  missing: boolean;
  /** True once the chain has proven itself on this machine (see the marker). */
  commissioned: boolean;
  app: string | null;
  updatedAt: string | null;
  findings: BackupHealthFinding[];
  stages: BackupHealthStage[];
};

export type BackupHealthOptions = {
  thresholds?: BackupHealthThresholds;
  /**
   * True on a machine where backups are EXPECTED to be running — production.
   * Solves the bootstrap paradox of the commissioning marker: the marker lives
   * inside the status file, so a deleted or corrupt file cannot be judged by
   * it. The server sets this from `BACKUP_EXPECTED=1` in the production `.env`;
   * a developer laptop leaves it unset and keeps the calm "no status yet" line.
   */
  expected?: boolean;
};

const MAX_DETAIL_LENGTH = 200;

/**
 * Redaction net for anything that reaches `detail`. The pipeline already
 * classifies failures into short codes; this is the belt to that braces, so a
 * stray rclone/psql line can never park a credential in a file the admin page
 * renders.
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // key=..., secret: ..., password ..., token=..., access_key_id=...
  {
    pattern:
      /\b([A-Za-z_-]*(?:key|secret|password|passwd|token|credential)[A-Za-z_-]*)\s*[=:]\s*\S+/gi,
    replacement: "$1=[redacted]"
  },
  // Aliyun access key ids are LTAI + base62.
  { pattern: /\bLTAI[A-Za-z0-9]{6,}/g, replacement: "[redacted]" },
  // Credentials embedded in a URL: scheme://user:pass@host
  { pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]*@/gi, replacement: "$1[redacted]@" },
  // age identities and private key blocks.
  { pattern: /\bAGE-SECRET-KEY-[A-Z0-9]+/gi, replacement: "[redacted]" },
  { pattern: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*/gi, replacement: "[redacted]" },
  // Bearer/authorization headers, including the "Authorization: Bearer x" form.
  { pattern: /\b(authorization|bearer)\b\s*:?\s*(?:bearer\b\s*)?\S+/gi, replacement: "$1 [redacted]" }
];

/**
 * One-line, secret-free, length-capped detail string. Returns null for empty
 * input so the JSON carries `null` rather than `""`.
 */
export function sanitizeStatusDetail(input: unknown, maxLength: number = MAX_DETAIL_LENGTH): string | null {
  if (typeof input !== "string") {
    return null;
  }

  let value = input.replace(/[\r\n\t]+/g, " ");
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    value = value.replace(pattern, replacement);
  }
  value = value.replace(/\s{2,}/g, " ").trim();

  if (value.length === 0) {
    return null;
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function emptyStage(): BackupStageRecord {
  return {
    status: "never",
    at: null,
    lastSuccessAt: null,
    detail: null,
    consecutiveFailures: 0,
    facts: {}
  };
}

export function emptyBackupStatus(app: string): BackupStatusFile {
  return {
    schema: BACKUP_STATUS_SCHEMA,
    app,
    updatedAt: null,
    commissioned: false,
    stages: {
      localArchive: emptyStage(),
      cloudUpload: emptyStage(),
      nightlyVerify: emptyStage(),
      cloudDrill: emptyStage()
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

function coerceStatus(value: unknown): BackupStageStatus {
  return value === "ok" ||
    value === "failed" ||
    value === "offline" ||
    value === "skipped" ||
    value === "unconfigured"
    ? value
    : "never";
}

function coerceFacts(value: unknown): Record<string, string | number> {
  if (!isRecord(value)) {
    return {};
  }

  const facts: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry))) {
      facts[key] = entry;
    }
  }
  return facts;
}

function coerceStage(value: unknown): BackupStageRecord {
  if (!isRecord(value)) {
    return emptyStage();
  }

  const consecutiveFailures =
    typeof value.consecutiveFailures === "number" && Number.isFinite(value.consecutiveFailures)
      ? Math.max(0, Math.trunc(value.consecutiveFailures))
      : 0;

  return {
    status: coerceStatus(value.status),
    at: coerceTimestamp(value.at),
    lastSuccessAt: coerceTimestamp(value.lastSuccessAt),
    detail: sanitizeStatusDetail(value.detail),
    consecutiveFailures,
    facts: coerceFacts(value.facts)
  };
}

/**
 * Defensive parse. Returns null when there is nothing usable to show — the
 * caller renders "no status yet". Any recognisable object is normalised field
 * by field, so a half-written or hand-edited file still yields the stages it
 * does contain instead of blowing up the admin page.
 */
export function parseBackupStatus(raw: string | null | undefined): BackupStatusFile | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const stages = isRecord(parsed.stages) ? parsed.stages : {};

  const document: BackupStatusFile = {
    schema: typeof parsed.schema === "string" ? parsed.schema : BACKUP_STATUS_SCHEMA,
    app: typeof parsed.app === "string" ? parsed.app : "",
    updatedAt: coerceTimestamp(parsed.updatedAt),
    commissioned: parsed.commissioned === true,
    stages: {
      localArchive: coerceStage(stages.localArchive),
      cloudUpload: coerceStage(stages.cloudUpload),
      nightlyVerify: coerceStage(stages.nightlyVerify),
      cloudDrill: coerceStage(stages.cloudDrill)
    }
  };

  // A hand-edited file that dropped the marker while still carrying three
  // successes is still a commissioned install: recompute, never downgrade.
  return { ...document, commissioned: isCommissioned(document) };
}

/**
 * The commissioning test: has every commissioning leg succeeded at least once?
 * Sticky — a caller must OR this with the existing marker, never replace it,
 * so an operator who turns the cloud leg off later cannot un-commission a
 * chain that has already proven itself.
 */
export function isCommissioned(status: BackupStatusFile): boolean {
  return (
    status.commissioned ||
    backupCommissioningStages.every((stage) => status.stages[stage]?.lastSuccessAt != null)
  );
}

export type BackupStageUpdate = {
  app: string;
  stage: BackupStageName;
  status: Exclude<BackupStageStatus, "never">;
  at: string;
  detail?: unknown;
  facts?: Record<string, string | number>;
};

/**
 * Merge one stage result into the existing document. Only the named stage
 * moves; the other three are carried forward untouched, which is what lets two
 * independent scripts (backup + verify) share one file without a lock.
 */
export function applyBackupStageUpdate(
  current: BackupStatusFile | null,
  update: BackupStageUpdate
): BackupStatusFile {
  const base = current ?? emptyBackupStatus(update.app);
  const previous = base.stages[update.stage] ?? emptyStage();
  const succeeded = update.status === "ok";

  const next: BackupStageRecord = {
    status: update.status,
    at: coerceTimestamp(update.at) ?? previous.at,
    lastSuccessAt: succeeded ? (coerceTimestamp(update.at) ?? previous.lastSuccessAt) : previous.lastSuccessAt,
    detail: sanitizeStatusDetail(update.detail),
    // `skipped`/`unconfigured` are not attempts, so they neither advance nor
    // clear the streak — only real misses do.
    consecutiveFailures: succeeded
      ? 0
      : update.status === "failed" || update.status === "offline"
        ? previous.consecutiveFailures + 1
        : previous.consecutiveFailures,
    facts: coerceFacts(update.facts)
  };

  const merged: BackupStatusFile = {
    schema: BACKUP_STATUS_SCHEMA,
    app: update.app.length > 0 ? update.app : base.app,
    updatedAt: coerceTimestamp(update.at) ?? base.updatedAt,
    commissioned: base.commissioned,
    stages: { ...base.stages, [update.stage]: next }
  };

  return { ...merged, commissioned: isCommissioned(merged) };
}

function ageHours(timestamp: string | null, now: Date): number | null {
  if (timestamp == null) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return (now.getTime() - parsed) / 3_600_000;
}

function toHealthStage(name: BackupStageName, record: BackupStageRecord, now: Date): BackupHealthStage {
  return {
    name,
    status: record.status,
    at: record.at,
    lastSuccessAt: record.lastSuccessAt,
    detail: record.detail,
    consecutiveFailures: record.consecutiveFailures,
    facts: record.facts,
    successAgeHours: ageHours(record.lastSuccessAt, now)
  };
}

/**
 * Status → verdict, governed by the COMMISSIONING boundary.
 *
 * Before commissioning (a fresh install that has never completed the chain) a
 * leg that has never run is AMBER — a mini would otherwise be red before it has
 * had a chance to run once, and an alarm that is always on is not an alarm.
 *
 * After commissioning the chain has demonstrably worked on this machine, so the
 * spec's production list applies without softening: local archive age > 26h,
 * upload age > 26h (a streak above 3 is red on its own), verify failed OR older
 * than 26h, cloud drill older than 35 days — and, for a commissioned leg, the
 * disappearance of its success record is red too.
 *
 * A missing or corrupt status file is `unknown` on a dev machine and RED when
 * the caller passes `expected: true` (production `BACKUP_EXPECTED=1`): on a
 * commissioned install "the file the backup writes every night is gone" is one
 * of the failure modes worth waking up for, not an absence of news.
 */
export function evaluateBackupHealth(
  status: BackupStatusFile | null,
  now: Date,
  options: BackupHealthOptions = {}
): BackupHealth {
  const thresholds = options.thresholds ?? backupHealthThresholds;
  const expected = options.expected === true;

  if (status == null) {
    return {
      level: expected ? "red" : "unknown",
      missing: true,
      commissioned: false,
      app: null,
      updatedAt: null,
      findings: expected
        ? [{ code: "statusFileMissing", stage: "localArchive", level: "red" }]
        : [],
      stages: backupStageNames.map((name) => toHealthStage(name, emptyStage(), now))
    };
  }

  const commissioned = isCommissioned(status);
  const stages = backupStageNames.map((name) => toHealthStage(name, status.stages[name], now));
  const byName = new Map(stages.map((stage) => [stage.name, stage]));
  const findings: BackupHealthFinding[] = [];

  const push = (code: BackupHealthFindingCode, stage: BackupStageName, level: "red" | "amber") => {
    findings.push({ code, stage, level });
  };

  /** A commissioning leg with no success record: amber before commissioning,
   *  red after — the record cannot vanish on its own. */
  const absenceLevel: "red" | "amber" = commissioned ? "red" : "amber";

  const local = byName.get("localArchive")!;
  if (local.status === "failed") {
    push("localArchiveFailed", "localArchive", "red");
  }
  if (local.successAgeHours == null) {
    push("localArchiveNever", "localArchive", absenceLevel);
  } else if (local.successAgeHours > thresholds.localArchiveMaxAgeHours) {
    push("localArchiveStale", "localArchive", "red");
  }

  const upload = byName.get("cloudUpload")!;
  if (upload.status === "unconfigured") {
    push("cloudUploadUnconfigured", "cloudUpload", "amber");
  }
  if (upload.successAgeHours == null) {
    if (upload.status !== "unconfigured") {
      push("cloudUploadNever", "cloudUpload", absenceLevel);
    }
  } else if (upload.successAgeHours > thresholds.cloudUploadMaxAgeHours) {
    push("cloudUploadStale", "cloudUpload", "red");
  }
  if (upload.consecutiveFailures > thresholds.cloudUploadFailureStreak) {
    push("cloudUploadFailureStreak", "cloudUpload", "red");
  } else if (upload.consecutiveFailures > 0) {
    push("cloudUploadRetrying", "cloudUpload", "amber");
  }

  const verify = byName.get("nightlyVerify")!;
  if (verify.status === "failed") {
    push("verifyFailed", "nightlyVerify", "red");
  }
  if (verify.successAgeHours == null) {
    push("verifyNever", "nightlyVerify", absenceLevel);
  } else if (verify.successAgeHours > thresholds.verifyMaxAgeHours) {
    // A proof that stopped passing is the whole point of the proof: red.
    push("verifyStale", "nightlyVerify", "red");
  }

  const drill = byName.get("cloudDrill")!;
  if (drill.status === "failed") {
    push("drillFailed", "cloudDrill", "red");
  }
  if (drill.successAgeHours == null) {
    // The drill commissions itself: monthly cadence means a commissioned chain
    // can legitimately be waiting for its first drill.
    push("drillNever", "cloudDrill", "amber");
  } else if (drill.successAgeHours > thresholds.cloudDrillMaxAgeDays * 24) {
    push("drillStale", "cloudDrill", "red");
  }

  const level: BackupHealthLevel = findings.some((finding) => finding.level === "red")
    ? "red"
    : findings.some((finding) => finding.level === "amber")
      ? "amber"
      : "green";

  return {
    level,
    missing: false,
    commissioned,
    app: status.app.length > 0 ? status.app : null,
    updatedAt: status.updatedAt,
    findings,
    stages
  };
}

// ── Cloud drill scheduling (F4) ──────────────────────────────────────────────

export const backupDrillSchedule = {
  /**
   * The drill is due when the last SUCCESSFUL drill is older than this. Not a
   * calendar day: a day-of-month trigger evaluated in UTC on a Beijing-time
   * machine fires on the wrong local day, and one offline night at 03:30 would
   * skip the whole month. Age-based scheduling retries every night until it
   * succeeds, which is the behaviour the runbook promises.
   */
  maxAgeDays: 30
} as const;

export type CloudDrillDecision = {
  run: boolean;
  reason: "never" | "stale" | "fresh";
  /** Days since the last successful drill, or null when it has never run. */
  ageDays: number | null;
};

/**
 * Should tonight's verify also run the cloud drill? Pure so the rehearsal and
 * the unit tests can pin every branch without a clock or a bucket.
 */
export function evaluateCloudDrillDue(
  status: BackupStatusFile | null,
  now: Date,
  maxAgeDays: number = backupDrillSchedule.maxAgeDays
): CloudDrillDecision {
  const limit = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays : backupDrillSchedule.maxAgeDays;
  const lastSuccess = status?.stages?.cloudDrill?.lastSuccessAt ?? null;
  const age = ageHours(lastSuccess, now);

  if (age == null) {
    return { run: true, reason: "never", ageDays: null };
  }

  const ageDays = age / 24;
  return ageDays > limit
    ? { run: true, reason: "stale", ageDays }
    : { run: false, reason: "fresh", ageDays };
}

// ── Status-file mutex policy (F7) ────────────────────────────────────────────

export const backupLockPolicy = {
  /** Total time a writer will wait for the lock before writing unlocked. */
  acquireTimeoutMs: 10_000,
  /** A lock directory older than this belongs to a dead run and is broken. */
  staleAfterMs: 60_000,
  firstDelayMs: 20,
  maxDelayMs: 400
} as const;

export type BackupLockPolicy = typeof backupLockPolicy;

export type BackupLockDecision =
  | { action: "retry"; delayMs: number }
  | { action: "break"; delayMs: 0 }
  | { action: "proceedUnlocked"; delayMs: 0 };

/**
 * What a writer that just lost the `mkdir` race should do next, given how long
 * it has been waiting and how old the existing lock is.
 *
 * `proceedUnlocked` is deliberate: a status file we could not lock must not
 * abandon an otherwise good archive. Writing unlocked is exactly the old
 * read-merge-rename race — no worse than before the mutex existed — and the
 * caller warns on stderr so the compromise is visible rather than silent.
 */
export function decideLockRetry(
  input: { waitedMs: number; lockAgeMs: number | null; attempt: number },
  policy: BackupLockPolicy = backupLockPolicy
): BackupLockDecision {
  if (input.lockAgeMs != null && input.lockAgeMs >= policy.staleAfterMs) {
    return { action: "break", delayMs: 0 };
  }

  if (input.waitedMs >= policy.acquireTimeoutMs) {
    return { action: "proceedUnlocked", delayMs: 0 };
  }

  const attempt = Number.isFinite(input.attempt) ? Math.max(0, Math.trunc(input.attempt)) : 0;
  const backoff = Math.min(policy.firstDelayMs * 2 ** attempt, policy.maxDelayMs);
  const remaining = Math.max(1, policy.acquireTimeoutMs - input.waitedMs);
  return { action: "retry", delayMs: Math.min(backoff, remaining) };
}
