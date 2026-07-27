#!/usr/bin/env node
/**
 * Dev slice export — Phase 1.
 *
 * Writes a sanitized, windowed, binary-light extract of the production database
 * so a developer can later recreate a working shape of the system on a laptop.
 *
 *   node scripts/export-slice.mjs --months 3 --out /Volumes/Transfer/slices
 *   node scripts/export-slice.mjs --from 2026-04-01 --to 2026-06-30 --out ~/slices
 *   pnpm slice:export -- --months 1 --out /Volumes/Transfer/slices
 *
 * A SLICE IS NOT A BACKUP. It has no password hashes, no login-throttle state,
 * no attachment bytes except small trial photos, and no projects that were quiet
 * during the window. Never restore production from one. The real recovery path
 * is `scripts/backup.sh` plus a verified scratch restore.
 *
 * CLI ONLY — NEVER A WEB ENDPOINT. There is deliberately no route, no server
 * action, and no admin button behind this. A web path would mean one stolen
 * admin cookie could exfiltrate the operational database over the LAN; a
 * server-side CLI requires shell access on the Mac mini. If slices ever surface
 * in the admin UI it will be a read-only listing panel — the export itself stays
 * here. (Design note: docs/03-build/development.md, entry 2026-07-27.)
 *
 * READ-ONLY: this script only ever calls `findMany` and one `$queryRaw` against
 * `_prisma_migrations`. No create/update/delete/upsert/executeRaw appears
 * anywhere in it, and `tests/domain/slice-export.test.ts` asserts that.
 *
 * What travels is decided by data, not by this file:
 *   src/domain/slice/classification.ts   master / windowed / excluded + scrubs
 *   src/domain/slice/window.ts           Asia/Shanghai window math
 *   src/domain/slice/project-window.ts   the project IN/OUT verdict
 *   src/domain/slice/sanitize.ts         applies the scrubs to a row
 *
 * Phase 2 (ingest) is NOT built. It will read `manifest.json`, replay the
 * `.ndjson` files in `exportOrder`, patch the deferred nullable FKs, and copy
 * `blobs/<storageKey>` back under MOLDPILOT_STORAGE_DIR.
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStoragePath } from "../src/domain/mold-trial/attachments.ts";
import { formatIntegrityCode, snapshotIntegrityHash } from "../src/domain/security/snapshot-integrity.ts";
import {
  SLICE_BLOB_FILE_TYPE,
  SLICE_BLOB_MAX_BYTES,
  SLICE_CLASSIFICATION,
  SLICE_EXPORT_ORDER,
  SLICE_FORMAT,
  SLICE_FORMAT_VERSION,
  SLICE_SANITIZATION_RULES,
  sliceClassificationFor
} from "../src/domain/slice/classification.ts";
import {
  decideProjectWindowMemberships,
  includedProjectIds
} from "../src/domain/slice/project-window.ts";
import { sanitizeSliceRow } from "../src/domain/slice/sanitize.ts";
import {
  SLICE_MAX_MONTHS,
  SLICE_MIN_MONTHS,
  sliceDirectoryName,
  sliceWindowFromDates,
  sliceWindowFromMonths
} from "../src/domain/slice/window.ts";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ID_CHUNK_SIZE = 500;

const usage = `MoldPilot dev slice export (Phase 1) — CLI only, never a web endpoint.

Usage:
  node scripts/export-slice.mjs --months N --out DIR
  node scripts/export-slice.mjs --from YYYY-MM-DD --to YYYY-MM-DD --out DIR

Window (pick one):
  --months N        ${SLICE_MIN_MONTHS}-${SLICE_MAX_MONTHS} calendar months back, Asia/Shanghai:
                    from the 1st of the month (N-1) months ago through today.
  --from / --to     Explicit inclusive business dates.

Required:
  --out DIR         Destination directory. Must NOT be inside the repository —
                    a slice is confidential and must never land in Git.

A project is exported when any of its activity falls inside the window; an
included project then exports its COMPLETE history. A slice carries no password
hashes and no attachment bytes except trial photos <= ${SLICE_BLOB_MAX_BYTES} bytes.

Slice != backup. Never restore production from a slice.`;

function fail(message) {
  console.error(`[slice FAIL] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { months: null, from: null, to: null, out: null };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === "--help" || flag === "-h") {
      console.log(usage);
      process.exit(0);
    }

    if (flag === "--months" || flag === "--from" || flag === "--to" || flag === "--out") {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        fail(`${flag} requires a value.`);
      }
      options[flag.slice(2)] = value;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${flag}\n\n${usage}`);
  }

  return options;
}

function buildWindow(options) {
  const usesMonths = options.months != null;
  const usesDates = options.from != null || options.to != null;

  if (usesMonths && usesDates) {
    fail("Use either --months or --from/--to, not both.");
  }

  if (usesMonths) {
    const raw = options.months.trim();
    if (!/^\d+$/.test(raw)) {
      fail(`--months must be a whole number (got "${options.months}").`);
    }
    return sliceWindowFromMonths(Number.parseInt(raw, 10), new Date());
  }

  if (options.from == null || options.to == null) {
    fail(`A window is required.\n\n${usage}`);
  }

  return sliceWindowFromDates(options.from, options.to);
}

/**
 * Absolute path for a target that may not exist yet, with every EXISTING
 * ancestor's symlinks resolved. Mirrors what `cd "$DIR" && pwd -P` does in
 * scripts/backup.sh, without creating anything first — an --out that the guard
 * is about to reject must not leave a stray directory behind.
 */
async function resolveWithoutCreating(target) {
  const absolute = path.resolve(process.cwd(), target);
  const tail = [];
  let probe = absolute;

  for (;;) {
    try {
      const real = await realpath(probe);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(probe);
    if (parent === probe) {
      return absolute;
    }

    tail.push(path.basename(probe));
    probe = parent;
  }
}

/**
 * REPO GUARD. Reimplemented here rather than shared with scripts/backup.sh —
 * that is a bash script and this is node; a wrong-looking duplicate is safer
 * than a clever import. Same rule: the destination must not resolve inside the
 * project folder, so a slice can never be committed by accident.
 */
async function resolveOutDirectory(out) {
  if (out == null) {
    fail(`--out DIR is required.\n\n${usage}`);
  }

  const resolvedOut = await resolveWithoutCreating(out);
  const resolvedRoot = await realpath(PROJECT_ROOT);

  if (resolvedOut === resolvedRoot || resolvedOut.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(
      `--out resolves inside the project folder (${resolvedOut}).\n` +
        "             A slice is confidential and must never land in Git. Write it to an\n" +
        "             external volume or a folder outside the repository."
    );
  }

  return resolvedOut;
}

async function assertEmptyTarget(directory) {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      fail(`Refusing to overwrite an existing slice: ${directory}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * JSON-safe form of a Prisma value. Dates become ISO strings (the integrity
 * canonicalizer rejects Date objects on purpose), Decimals and BigInts become
 * strings so no precision is lost, Buffers become base64.
 */
function toJsonSafe(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return { $base64: value.toString("base64") };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafe(entry));
  }

  if (typeof value === "object") {
    // Prisma Decimal (decimal.js): keep full precision as a string.
    if (typeof value.toFixed === "function" && typeof value.toString === "function") {
      return value.toString();
    }

    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = toJsonSafe(value[key]);
    }
    return result;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }

  return value;
}

/** Writes rows as NDJSON (0600) and returns the row count. */
async function writeNdjson(file, rows) {
  const stream = createWriteStream(file, { encoding: "utf8", mode: 0o600 });

  try {
    for (const row of rows) {
      if (!stream.write(`${JSON.stringify(row)}\n`)) {
        await new Promise((resolve) => stream.once("drain", resolve));
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.once("error", reject);
    });
  }

  return rows.length;
}

/** Latest non-null timestamp per project for one (table, field) pair. */
function foldLatest(rows, projectIdOf, field, target) {
  for (const row of rows) {
    const projectId = projectIdOf(row);
    const at = row[field];
    if (projectId == null || at == null) {
      continue;
    }
    const current = target.get(projectId);
    if (current == null || at.getTime() > current.getTime()) {
      target.set(projectId, at);
    }
  }
}

/**
 * Where attachment bytes live. Same resolution as `src/server/attachment-storage.ts`
 * with one deliberate difference: a RELATIVE fallback resolves against the project
 * root rather than the current working directory, because this CLI is run from
 * wherever the operator happens to be standing. Production sets an absolute
 * MOLDPILOT_STORAGE_DIR, so the two agree there.
 */
function attachmentStorageRoot() {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root =
    configured != null && configured.trim().length > 0 ? configured.trim() : path.join("storage", "uploads");
  return path.isAbsolute(root) ? root : path.resolve(PROJECT_ROOT, root);
}

// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));

let window;
try {
  window = buildWindow(options);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const outDirectory = await resolveOutDirectory(options.out);
const sliceDirectory = path.join(outDirectory, sliceDirectoryName(window));
await assertEmptyTarget(sliceDirectory);

let PrismaClient;
let PrismaPg;
try {
  ({ PrismaClient } = await import("@prisma/client"));
  ({ PrismaPg } = await import("@prisma/adapter-pg"));
} catch (error) {
  fail(
    `Prisma client is not available (${error instanceof Error ? error.message : String(error)}).\n` +
      "             Run `pnpm prisma:generate` on the machine that holds the database."
  );
}

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const startedAt = new Date();
  console.log(`[slice] window ${window.fromDateKey} .. ${window.toDateKey} (${window.timeZone}, ${window.mode})`);

  // -- Pass 1: light index over the whole database, to decide IN/OUT ---------
  // Only ids, project ids, and timestamps are read here — never payloads.
  const [
    projectIndex,
    partIndex,
    trialIndex,
    missedIndex,
    issueIndex,
    processValueIndex,
    designChangeIndex,
    limitAdjustmentIndex,
    attachmentIndex,
    activityIndex
  ] = await Promise.all([
    prisma.moldTrialProject.findMany({ select: { id: true, createdAt: true, updatedAt: true } }),
    prisma.moldTrialPart.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true, updatedAt: true }
    }),
    prisma.trialEvent.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true, updatedAt: true }
    }),
    prisma.missedTrialEvent.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true }
    }),
    prisma.trialIssue.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true, updatedAt: true }
    }),
    prisma.trialProcessValue.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true, updatedAt: true }
    }),
    prisma.designChangeEvent.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true, updatedAt: true }
    }),
    prisma.trialLimitAdjustment.findMany({
      select: { id: true, moldTrialProjectId: true, createdAt: true }
    }),
    prisma.fileAttachment.findMany({
      select: { id: true, moldTrialProjectId: true, uploadedAt: true, deletedAt: true }
    }),
    prisma.activityLog.findMany({ select: { id: true, entityId: true, createdAt: true } })
  ]);

  // entityId -> projectId for the PROJECT LINEAGE only. Master-entity ids
  // (User, Role, Customer, InjectionMachine, SystemSetting) are deliberately
  // absent, which is what drops admin-lineage activity rows from the slice.
  const lineageProjectByEntityId = new Map();
  const addLineage = (rows, projectIdOf) => {
    for (const row of rows) {
      const projectId = projectIdOf(row);
      if (projectId != null) {
        lineageProjectByEntityId.set(row.id, projectId);
      }
    }
  };
  addLineage(projectIndex, (row) => row.id);
  for (const rows of [
    partIndex,
    trialIndex,
    missedIndex,
    issueIndex,
    processValueIndex,
    designChangeIndex,
    limitAdjustmentIndex,
    attachmentIndex
  ]) {
    addLineage(rows, (row) => row.moldTrialProjectId);
  }

  const activityLogsByProject = new Map();
  for (const log of activityIndex) {
    const projectId = lineageProjectByEntityId.get(log.entityId);
    if (projectId == null) {
      continue;
    }
    const bucket = activityLogsByProject.get(projectId);
    if (bucket == null) {
      activityLogsByProject.set(projectId, [log]);
    } else {
      bucket.push(log);
    }
  }

  // One signal per (table, timestamp field). The verdict is "any signal inside
  // the window"; the newest matching one is reported as the reason.
  const signalSources = [
    ["MoldTrialProject.createdAt", projectIndex, (row) => row.id, "createdAt"],
    ["MoldTrialProject.updatedAt", projectIndex, (row) => row.id, "updatedAt"],
    ["MoldTrialPart.createdAt", partIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["MoldTrialPart.updatedAt", partIndex, (row) => row.moldTrialProjectId, "updatedAt"],
    ["TrialEvent.createdAt", trialIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["TrialEvent.updatedAt", trialIndex, (row) => row.moldTrialProjectId, "updatedAt"],
    ["MissedTrialEvent.createdAt", missedIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["TrialIssue.createdAt", issueIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["TrialIssue.updatedAt", issueIndex, (row) => row.moldTrialProjectId, "updatedAt"],
    ["TrialProcessValue.createdAt", processValueIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["TrialProcessValue.updatedAt", processValueIndex, (row) => row.moldTrialProjectId, "updatedAt"],
    ["DesignChangeEvent.createdAt", designChangeIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["DesignChangeEvent.updatedAt", designChangeIndex, (row) => row.moldTrialProjectId, "updatedAt"],
    ["TrialLimitAdjustment.createdAt", limitAdjustmentIndex, (row) => row.moldTrialProjectId, "createdAt"],
    ["FileAttachment.uploadedAt", attachmentIndex, (row) => row.moldTrialProjectId, "uploadedAt"],
    ["FileAttachment.deletedAt", attachmentIndex, (row) => row.moldTrialProjectId, "deletedAt"]
  ];

  const latestBySource = new Map();
  for (const [source, rows, projectIdOf, field] of signalSources) {
    const target = new Map();
    foldLatest(rows, projectIdOf, field, target);
    latestBySource.set(source, target);
  }

  const activityLatest = new Map();
  for (const [projectId, logs] of activityLogsByProject) {
    for (const log of logs) {
      const current = activityLatest.get(projectId);
      if (current == null || log.createdAt.getTime() > current.getTime()) {
        activityLatest.set(projectId, log.createdAt);
      }
    }
  }
  latestBySource.set("ActivityLog.createdAt", activityLatest);

  const summaries = projectIndex.map((project) => ({
    projectId: project.id,
    signals: [...latestBySource.entries()].map(([source, byProject]) => ({
      source,
      at: byProject.get(project.id) ?? null
    }))
  }));

  const verdicts = decideProjectWindowMemberships(summaries, window);
  const includedIds = includedProjectIds(verdicts);
  const includedIdSet = new Set(includedIds);
  console.log(
    `[slice] projects: ${includedIds.length} in window / ${projectIndex.length} total (${projectIndex.length - includedIds.length} skipped)`
  );

  if (includedIds.length === 0) {
    console.log("[slice] Nothing was active in that window. Widen it with --months or --from/--to.");
  }

  const exportedActivityLogIds = [];
  for (const [projectId, logs] of activityLogsByProject) {
    if (!includedIdSet.has(projectId)) {
      continue;
    }
    for (const log of logs) {
      exportedActivityLogIds.push(log.id);
    }
  }

  // -- Pass 2: full rows, written in FK-safe order --------------------------
  const projectScoped = (delegate) => async () => {
    if (includedIds.length === 0) {
      return [];
    }
    const rows = [];
    for (const ids of chunk(includedIds, ID_CHUNK_SIZE)) {
      rows.push(
        ...(await delegate.findMany({ where: { moldTrialProjectId: { in: ids } }, orderBy: { id: "asc" } }))
      );
    }
    return rows;
  };

  const windowStartDate = new Date(`${window.fromDateKey}T00:00:00.000Z`);
  const windowEndDate = new Date(`${window.toDateKey}T00:00:00.000Z`);
  windowEndDate.setUTCDate(windowEndDate.getUTCDate() + 1);

  const loaders = {
    // master — whole tables
    Role: () => prisma.role.findMany({ orderBy: { id: "asc" } }),
    Permission: () => prisma.permission.findMany({ orderBy: { id: "asc" } }),
    User: () => prisma.user.findMany({ orderBy: { id: "asc" } }),
    DepartmentGroup: () => prisma.departmentGroup.findMany({ orderBy: { id: "asc" } }),
    RolePermission: () => prisma.rolePermission.findMany({ orderBy: { id: "asc" } }),
    UserPermissionOverride: () => prisma.userPermissionOverride.findMany({ orderBy: { id: "asc" } }),
    InjectionMachine: () => prisma.injectionMachine.findMany({ orderBy: { id: "asc" } }),
    Customer: () => prisma.customer.findMany({ orderBy: { id: "asc" } }),
    ProcessSheetTemplate: () => prisma.processSheetTemplate.findMany({ orderBy: { id: "asc" } }),
    ProcessSheetParameter: () => prisma.processSheetParameter.findMany({ orderBy: { id: "asc" } }),
    KpiRule: () => prisma.kpiRule.findMany({ orderBy: { id: "asc" } }),
    SystemSetting: () => prisma.systemSetting.findMany({ orderBy: { id: "asc" } }),

    // windowed — complete history of the IN projects
    MoldTrialProject: async () => {
      if (includedIds.length === 0) {
        return [];
      }
      const rows = [];
      for (const ids of chunk(includedIds, ID_CHUNK_SIZE)) {
        rows.push(...(await prisma.moldTrialProject.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })));
      }
      return rows;
    },
    MoldTrialPart: projectScoped(prisma.moldTrialPart),
    TrialEvent: projectScoped(prisma.trialEvent),
    MissedTrialEvent: projectScoped(prisma.missedTrialEvent),
    TrialIssue: projectScoped(prisma.trialIssue),
    TrialProcessValue: projectScoped(prisma.trialProcessValue),
    DesignChangeEvent: projectScoped(prisma.designChangeEvent),
    TrialLimitAdjustment: projectScoped(prisma.trialLimitAdjustment),
    FileAttachment: projectScoped(prisma.fileAttachment),
    ActivityLog: async () => {
      if (exportedActivityLogIds.length === 0) {
        return [];
      }
      const rows = [];
      for (const ids of chunk(exportedActivityLogIds, ID_CHUNK_SIZE)) {
        rows.push(...(await prisma.activityLog.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })));
      }
      return rows;
    },
    KpiSnapshot: async () => {
      const rows = await prisma.kpiSnapshot.findMany({
        where: { snapshotDate: { gte: windowStartDate, lt: windowEndDate } },
        orderBy: { id: "asc" }
      });
      // Project-scoped snapshots follow their project; company/group/user rows
      // are aggregates and travel on their date alone.
      return rows.filter((row) => row.scopeType !== "MOLD_TRIAL_PROJECT" || includedIdSet.has(row.scopeId ?? ""));
    }
  };

  await mkdir(sliceDirectory, { recursive: true, mode: 0o700 });
  const blobDirectory = path.join(sliceDirectory, "blobs");
  await mkdir(blobDirectory, { recursive: true, mode: 0o700 });

  const storageRoot = attachmentStorageRoot();
  const blobReport = {
    fileType: SLICE_BLOB_FILE_TYPE,
    maxBytes: SLICE_BLOB_MAX_BYTES,
    copied: 0,
    copiedBytes: 0,
    omitted: 0,
    omittedByReason: {
      "not-a-trial-photo": 0,
      "over-size-cap": 0,
      "soft-deleted": 0,
      "unsafe-storage-key": 0
    },
    missingOnDisk: []
  };

  const modelReports = [];
  const sanitizationCounts = {};
  let totalRows = 0;

  async function copyAttachmentBlob(row) {
    if (row.deletedAt != null) {
      blobReport.omitted += 1;
      blobReport.omittedByReason["soft-deleted"] += 1;
      return;
    }

    if (row.fileType !== SLICE_BLOB_FILE_TYPE) {
      blobReport.omitted += 1;
      blobReport.omittedByReason["not-a-trial-photo"] += 1;
      return;
    }

    if (typeof row.sizeBytes !== "number" || row.sizeBytes > SLICE_BLOB_MAX_BYTES) {
      blobReport.omitted += 1;
      blobReport.omittedByReason["over-size-cap"] += 1;
      return;
    }

    // Same traversal guard the download route uses: a storage key that escapes
    // the root is refused rather than followed.
    const sourcePath = resolveStoragePath(storageRoot, row.storageKey);
    const targetPath = resolveStoragePath(blobDirectory, row.storageKey);

    if (sourcePath == null || targetPath == null) {
      blobReport.omitted += 1;
      blobReport.omittedByReason["unsafe-storage-key"] += 1;
      return;
    }

    try {
      const stats = await stat(sourcePath);
      await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      await copyFile(sourcePath, targetPath);
      blobReport.copied += 1;
      blobReport.copiedBytes += stats.size;
    } catch (error) {
      // A file that vanished from disk is recorded, never fatal: the row's
      // metadata still travels and Phase 2 can see exactly what is missing.
      if (error?.code === "ENOENT") {
        blobReport.missingOnDisk.push({ attachmentId: row.id, storageKey: row.storageKey });
        return;
      }
      throw error;
    }
  }

  for (const model of SLICE_EXPORT_ORDER) {
    const classification = sliceClassificationFor(model);
    const loader = loaders[model];

    if (loader == null) {
      fail(`No loader for ${model}. SLICE_EXPORT_ORDER and this script disagree.`);
    }

    const rows = await loader();
    const serialized = [];

    for (const row of rows) {
      const { row: sanitized, applied } = sanitizeSliceRow(model, row);
      for (const field of applied) {
        sanitizationCounts[field] = (sanitizationCounts[field] ?? 0) + 1;
      }
      serialized.push(toJsonSafe(sanitized));

      if (model === "FileAttachment") {
        await copyAttachmentBlob(row);
      }
    }

    const file = `${model}.ndjson`;
    const count = await writeNdjson(path.join(sliceDirectory, file), serialized);
    totalRows += count;
    modelReports.push({ model, category: classification?.category ?? "unclassified", file, rowCount: count });
    console.log(`[slice] ${model.padEnd(24)} ${String(count).padStart(7)} rows`);
  }

  // -- Schema identity -------------------------------------------------------
  const migrationsDirectory = path.join(PROJECT_ROOT, "prisma", "migrations");
  let latestMigrationFolder = null;
  try {
    const entries = await readdir(migrationsDirectory, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    latestMigrationFolder = folders.at(-1) ?? null;
  } catch {
    latestMigrationFolder = null;
  }

  let appliedMigration = null;
  let appliedMigrationCount = null;
  try {
    const applied = await prisma.$queryRaw`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    appliedMigration = applied?.[0]?.migration_name ?? null;
    const counted = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    appliedMigrationCount = counted?.[0]?.applied ?? null;
  } catch (error) {
    console.warn(
      `[slice] _prisma_migrations not readable (${error instanceof Error ? error.message : String(error)}); manifest records the folder name only.`
    );
  }

  // -- Manifest --------------------------------------------------------------
  // `data` is what the SHA-256 covers. `generatedAt` and `integrity` sit outside
  // it, exactly like the KPI snapshot archive. `sliceFormatVersion`/`notABackup`
  // appear both at the top level (easy to read) and inside `data` (hashed), so
  // editing the convenient copy is detectable.
  const data = {
    sliceFormatVersion: SLICE_FORMAT_VERSION,
    notABackup: true,
    window: {
      mode: window.mode,
      months: window.months,
      from: window.fromDateKey,
      to: window.toDateKey,
      startUtc: window.start.toISOString(),
      endUtcExclusive: window.end.toISOString(),
      timeZone: window.timeZone
    },
    schema: {
      latestMigrationFolder,
      appliedLatestMigration: appliedMigration,
      appliedMigrationCount,
      migrationsMatch:
        latestMigrationFolder != null && appliedMigration != null
          ? latestMigrationFolder === appliedMigration
          : null
    },
    projects: {
      evaluated: projectIndex.length,
      included: includedIds.length,
      excluded: projectIndex.length - includedIds.length,
      includedProjectIds: includedIds,
      reasons: verdicts
        .filter((verdict) => verdict.included)
        .map((verdict) => ({
          projectId: verdict.projectId,
          matchedSource: verdict.matchedSource,
          matchedAt: verdict.matchedAt?.toISOString() ?? null
        }))
    },
    exportOrder: [...SLICE_EXPORT_ORDER],
    models: modelReports,
    rowCountTotal: totalRows,
    blobs: blobReport,
    sanitization: {
      rules: SLICE_SANITIZATION_RULES.map((rule) => ({
        model: rule.model,
        field: rule.field,
        action: rule.action
      })),
      appliedCounts: sanitizationCounts
    },
    excludedModels: SLICE_CLASSIFICATION.filter((entry) => entry.category === "excluded").map(
      (entry) => entry.model
    ),
    storage: { storageDirConfigured: (process.env.MOLDPILOT_STORAGE_DIR ?? "").trim().length > 0 }
  };

  const hash = snapshotIntegrityHash(data, sha256Hex);
  const manifest = {
    format: SLICE_FORMAT,
    sliceFormatVersion: SLICE_FORMAT_VERSION,
    notABackup: true,
    generatedAt: startedAt.toISOString(),
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-keys-json/data-only",
      code: formatIntegrityCode(hash),
      hash
    },
    data
  };

  await writeFile(path.join(sliceDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  console.log("");
  console.log("  MoldPilot dev slice 开发切片");
  console.log(`  Window 窗口        : ${window.fromDateKey} .. ${window.toDateKey} (${window.timeZone})`);
  console.log(`  Projects 项目      : ${includedIds.length} of ${projectIndex.length}`);
  console.log(`  Rows 行数          : ${totalRows} across ${modelReports.length} models`);
  console.log(
    `  Blobs 附件         : ${blobReport.copied} copied · ${blobReport.omitted} metadata-only · ${blobReport.missingOnDisk.length} missing on disk`
  );
  console.log(`  Schema 迁移        : ${appliedMigration ?? latestMigrationFolder ?? "unknown"}`);
  console.log(`  Slice 切片         : ${sliceDirectory}`);
  console.log("");
  console.log(`  Integrity code / 校验码: ${manifest.integrity.code}`);
  console.log("");
  console.log("  This is NOT a backup. No password hashes, windowed projects only.");
  console.log("  这不是备份：无密码散列，仅窗口内项目。");
  console.log("  Still confidential — real customer, project, and staff names travel with it.");
} catch (error) {
  // Fail loudly but readably: a Prisma stack through the minified runtime tells
  // an operator nothing, and a half-written slice must be reported as such.
  console.error(`[slice FAIL] ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    `[slice FAIL] Anything already written to ${sliceDirectory} is INCOMPLETE. Delete it before retrying.`
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
