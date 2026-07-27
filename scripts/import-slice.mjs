#!/usr/bin/env node
/**
 * Dev slice import (ingest) — Phase 2.
 *
 * Recreates a development database from a Phase 1 export
 * (`scripts/export-slice.mjs`), so a laptop can hold a working *shape* of the
 * system instead of hand-written fixtures.
 *
 *   node scripts/import-slice.mjs --slice /Volumes/Transfer/slices/moldpilot-slice-2026-05-01_2026-07-27
 *   pnpm slice:import -- --slice ~/slices/moldpilot-slice-2026-05-01_2026-07-27
 *   pnpm slice:import -- --slice DIR --dry-run     # run every gate, write nothing
 *
 * THIS WRITES TO A DATABASE. Everything above it in the toolchain is read-only;
 * this is not. Four gates run first, in this order, and each one exits non-zero
 * with a message that says what to do instead:
 *
 *   1. NOT PRODUCTION  — `assertLocalPilotDeploymentAllowed()`, the same guard
 *                        `scripts/local-pilot.mjs` uses, over process.env AND .env.
 *   2. INTEGRITY       — the manifest's SHA-256 is recomputed with
 *                        `snapshot-integrity.ts` and the XXXX-XXXX-XXXX code is
 *                        printed. A slice edited in transit stops here.
 *   3. SAME SCHEMA     — the migration recorded in the slice, the newest folder in
 *                        prisma/migrations, and the newest row in this database's
 *                        _prisma_migrations must be the same name.
 *   4. EMPTY TARGET    — every table this tool writes must hold zero rows. A slice
 *                        carries production ids; mixing them into a seeded demo
 *                        database produces something that looks fine and is
 *                        quietly neither.
 *
 * A SLICE IS NOT A BACKUP AND NOT A CUTOVER SOURCE. It has no password hashes, no
 * login-throttle state, no out-of-window projects, and almost no attachment
 * bytes. Never point this at production; never treat the result as recovery.
 *
 * PASSWORDS. Every imported user is given the same development password
 * (`slice-dev-login`) hashed with the real `hashPassword()`, with
 * forcePasswordChange = true and passwordUpdatedAt = null. The export nulls
 * `passwordHash`, so without this nobody could log in at all; with it, the whole
 * dev directory shares one obviously-worthless password. That is a development
 * convenience and nothing else — a database loaded by this tool must never be
 * reachable from anywhere but the laptop that loaded it.
 *
 * CLI ONLY — NEVER A WEB ENDPOINT, for the same reason as the export: a web path
 * would put "overwrite the database from a file" behind a cookie.
 *
 * NOT ATOMIC. Loading is chunked `createMany` per model, not one giant
 * transaction: a slice can be large, and a failed 40 MB transaction tells an
 * operator less than a failed model name does. Recovery is trivial by design —
 * the target was empty, so drop the database and start again.
 *
 * What happens is decided by data, not by this file:
 *   src/domain/slice/classification.ts   SLICE_EXPORT_ORDER (the SAME export uses)
 *   src/domain/slice/schema-map.ts       revivable columns + foreign keys, parsed
 *                                        out of prisma/schema.prisma
 *   src/domain/slice/ingest.ts           deferral plan, patch plan, revival,
 *                                        empty-target verdict, count comparison
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStoragePath } from "../src/domain/mold-trial/attachments.ts";
import { assertLocalPilotDeploymentAllowed } from "../src/domain/security/deployment-mode.ts";
import { formatIntegrityCode, snapshotIntegrityHash } from "../src/domain/security/snapshot-integrity.ts";
import {
  SLICE_BLOB_FILE_TYPE,
  SLICE_BLOB_MAX_BYTES,
  SLICE_EXPORT_ORDER,
  SLICE_FORMAT,
  SLICE_FORMAT_VERSION
} from "../src/domain/slice/classification.ts";
import {
  buildSlicePatchPlan,
  compareSliceCounts,
  compareSliceExportOrder,
  decideSliceEmptyTarget,
  deferredSliceColumnsFor,
  planSliceDeferrals,
  reviveSliceRow,
  sliceDelegateName,
  sliceManifestModelCounts,
  withDeferredColumnsNulled
} from "../src/domain/slice/ingest.ts";
import { parsePrismaForeignKeys, parseSliceColumnTypes } from "../src/domain/slice/schema-map.ts";
import { hashPassword } from "../src/server/passwords.ts";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSERT_CHUNK_SIZE = 500;

/**
 * The one password every imported account gets. Deliberately a constant, printed
 * on every run and written in the docs: a per-run random password would have to
 * be stored somewhere, and a slice database is worth exactly as much protection
 * as the laptop it sits on.
 */
const DEV_PASSWORD = "slice-dev-login";

const usage = `MoldPilot dev slice import (Phase 2) — CLI only, never a web endpoint.

Usage:
  node scripts/import-slice.mjs --slice DIR [--dry-run]

Required:
  --slice DIR       A directory written by \`pnpm slice:export\`, containing
                    manifest.json, <Model>.ndjson, and blobs/.

Options:
  --dry-run         Run all four gates and print the plan. Writes nothing.

Four gates run before anything is written: not production, manifest integrity,
same migration as this checkout AND this database, and an empty target database.

The target must be a FRESH database:
  createdb moldpilot_slice
  DATABASE_URL=postgresql://.../moldpilot_slice pnpm exec prisma migrate deploy
  DATABASE_URL=postgresql://.../moldpilot_slice pnpm slice:import -- --slice DIR

Every imported user's password becomes "${DEV_PASSWORD}" with a forced change on
first login. Slice != backup. Never point this at production.`;

function fail(message) {
  console.error(`[slice-import FAIL] ${message}`);
  process.exit(1);
}

function gateFailure(number, title, lines) {
  console.error("");
  console.error(`[slice-import FAIL] Gate ${number}/4 — ${title}`);
  for (const line of lines) {
    console.error(`                    ${line}`);
  }
  console.error("");
  console.error("[slice-import FAIL] Nothing was written to the database.");
  process.exit(1);
}

function parseArgs(argv) {
  const options = { slice: null, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === "--help" || flag === "-h") {
      console.log(usage);
      process.exit(0);
    }

    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (flag === "--slice") {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        fail(`${flag} requires a value.`);
      }
      options.slice = value;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${flag}\n\n${usage}`);
  }

  if (options.slice == null) {
    fail(`--slice DIR is required.\n\n${usage}`);
  }

  return options;
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
 * Where attachment bytes go. Same resolution as `scripts/export-slice.mjs`
 * (itself the same as `src/server/attachment-storage.ts`, with a relative
 * fallback resolved against the project root rather than the current directory).
 * Duplicated rather than shared because the export script is a program, not a
 * module — importing it would run an export.
 */
function attachmentStorageRoot() {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root =
    configured != null && configured.trim().length > 0 ? configured.trim() : path.join("storage", "uploads");
  return path.isAbsolute(root) ? root : path.resolve(PROJECT_ROOT, root);
}

/** Every file under `directory`, as paths relative to it, sorted. */
async function walkFiles(directory) {
  const found = [];

  async function walk(current, prefix) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relative);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  }

  await walk(directory, "");
  return found.sort();
}

/** Parses one `<Model>.ndjson`, naming the file and line of a bad row. */
async function readNdjson(file, model) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`${model}.ndjson is missing from the slice. The slice is incomplete; re-export it.`);
    }
    throw error;
  }

  const rows = [];
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      fail(`${model}.ndjson line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${model}.ndjson line ${index + 1} is not a JSON object.`);
    }

    rows.push(parsed);
  }

  return rows;
}

// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));
const sliceDirectory = path.resolve(process.cwd(), options.slice);

console.log("MoldPilot dev slice import (Phase 2)");
console.log(`[slice-import] slice: ${sliceDirectory}`);
if (options.dryRun) {
  console.log("[slice-import] --dry-run: every gate runs, nothing is written.");
}

// -- Gate 1: not production ---------------------------------------------------
// The same guard `scripts/local-pilot.mjs` calls, over the same two inputs:
// process.env and the .env file. A production Mac mini refuses here, before the
// manifest is even read.
{
  let environmentFile = "";
  try {
    environmentFile = await readFile(path.join(PROJECT_ROOT, ".env"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    assertLocalPilotDeploymentAllowed(process.env, environmentFile);
  } catch (error) {
    gateFailure(1, "production refusal 拒绝在生产环境导入", [
      "MOLDPILOT_DEPLOYMENT_MODE=production is set in the environment or in .env.",
      "A dev slice must never be loaded into the production database: it has no",
      "password hashes, only in-window projects, and it would overwrite nothing —",
      "it would MIX production ids into whatever is already there.",
      "",
      `Guard: ${error instanceof Error ? error.message : String(error)}`,
      "",
      "Run this on a development machine, against a fresh development database."
    ]);
  }

  console.log("[slice-import] gate 1/4 not production: ok");
}

// -- Manifest + Gate 2: integrity ---------------------------------------------
const manifestPath = path.join(sliceDirectory, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    fail(
      `No manifest.json in ${sliceDirectory}.\n` +
        "             --slice must point at the slice directory itself\n" +
        "             (…/moldpilot-slice-<from>_<to>), not at the folder holding it."
    );
  }
  fail(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (manifest?.format !== SLICE_FORMAT) {
  gateFailure(2, "manifest integrity 清单校验", [
    `This is not a MoldPilot dev slice: format is ${JSON.stringify(manifest?.format ?? null)},`,
    `expected ${JSON.stringify(SLICE_FORMAT)}.`
  ]);
}

if (manifest?.data?.sliceFormatVersion !== SLICE_FORMAT_VERSION) {
  gateFailure(2, "manifest integrity 清单校验", [
    `Slice format version ${String(manifest?.data?.sliceFormatVersion)} was written by a different`,
    `build; this checkout reads version ${SLICE_FORMAT_VERSION}. Export the slice again from a`,
    "checkout that matches this one."
  ]);
}

{
  let actualHash;
  try {
    actualHash = snapshotIntegrityHash(manifest.data, sha256Hex);
  } catch (error) {
    gateFailure(2, "manifest integrity 清单校验", [
      `The manifest's data section cannot be canonicalized: ${error instanceof Error ? error.message : String(error)}`
    ]);
  }

  const recordedHash =
    typeof manifest?.integrity?.hash === "string" ? manifest.integrity.hash.trim().toLowerCase() : null;
  const actualCode = formatIntegrityCode(actualHash);

  console.log(`[slice-import] integrity code 校验码: ${actualCode}`);

  if (recordedHash == null) {
    gateFailure(2, "manifest integrity 清单校验", [
      "The manifest carries no integrity hash. It was not written by",
      "`pnpm slice:export`, or it was edited. Refusing to load it."
    ]);
  }

  if (recordedHash !== actualHash) {
    gateFailure(2, "manifest integrity 清单校验", [
      "The manifest does not match its own contents — the slice changed after export.",
      `  recorded : ${manifest?.integrity?.code ?? "(none)"}  (${recordedHash})`,
      `  recomputed: ${actualCode}  (${actualHash})`,
      "",
      "Copy the slice again from the machine that exported it. If both copies",
      "disagree with the manifest, the export machine is the one to check."
    ]);
  }

  if (typeof manifest?.integrity?.code === "string" && manifest.integrity.code !== actualCode) {
    gateFailure(2, "manifest integrity 清单校验", [
      `The printed code ${manifest.integrity.code} does not match the recomputed ${actualCode}.`
    ]);
  }

  console.log("[slice-import] gate 2/4 manifest integrity: ok");
}

const manifestModels = Array.isArray(manifest.data?.models) ? manifest.data.models : [];
const manifestCounts = sliceManifestModelCounts(manifestModels);
const manifestExportOrder = Array.isArray(manifest.data?.exportOrder) ? manifest.data.exportOrder : [];

// -- Prisma -------------------------------------------------------------------
let PrismaClient;
let PrismaPg;
let PrismaNamespace;
try {
  ({ PrismaClient, Prisma: PrismaNamespace } = await import("@prisma/client"));
  ({ PrismaPg } = await import("@prisma/adapter-pg"));
} catch (error) {
  fail(
    `Prisma client is not available (${error instanceof Error ? error.message : String(error)}).\n` +
      "             Run `pnpm prisma:generate` first."
  );
}

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Prisma refuses a bare `null` for a nullable `Json` column: it wants
 * `Prisma.DbNull` (SQL NULL) or `Prisma.JsonNull` (the JSON value `null`). The
 * export wrote SQL NULL as `null`, so `DbNull` is the faithful inverse. If a
 * future client stops exporting the sentinel, `undefined` is the safe fallback —
 * Prisma reads it as "column omitted", and no nullable column in this schema has
 * a default, so the row still lands with SQL NULL.
 */
const jsonNullSentinel = PrismaNamespace?.DbNull ?? undefined;

const databaseName = (() => {
  try {
    return `${new URL(connectionString).pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
})();

console.log(`[slice-import] database: ${databaseName}`);

let exitCode = 0;

try {
  // -- Gate 3: same schema ----------------------------------------------------
  const sliceMigration =
    manifest.data?.schema?.appliedLatestMigration ?? manifest.data?.schema?.latestMigrationFolder ?? null;

  const migrationsDirectory = path.join(PROJECT_ROOT, "prisma", "migrations");
  let localMigration = null;
  try {
    const entries = await readdir(migrationsDirectory, { withFileTypes: true });
    localMigration =
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .at(-1) ?? null;
  } catch {
    localMigration = null;
  }

  let databaseMigration = null;
  let migrationReadError = null;
  try {
    const applied = await prisma.$queryRaw`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    databaseMigration = applied?.[0]?.migration_name ?? null;
  } catch (error) {
    migrationReadError = error instanceof Error ? error.message : String(error);
  }

  const orderCheck = compareSliceExportOrder(manifestExportOrder);
  const names = [
    `  slice manifest      : ${sliceMigration ?? "(none recorded)"}`,
    `  prisma/migrations   : ${localMigration ?? "(no migration folders)"}`,
    `  target database     : ${databaseMigration ?? `(unreadable: ${migrationReadError ?? "no applied rows"})`}`
  ];

  if (sliceMigration == null || localMigration == null || databaseMigration == null) {
    gateFailure(3, "schema match 迁移版本不一致", [
      "One of the three migration names could not be read.",
      ...names,
      "",
      "If the database name is missing, the target has no applied migrations:",
      "  createdb moldpilot_slice",
      "  DATABASE_URL=postgresql://…/moldpilot_slice pnpm exec prisma migrate deploy"
    ]);
  }

  if (sliceMigration !== localMigration || localMigration !== databaseMigration) {
    gateFailure(3, "schema match 迁移版本不一致", [
      "The slice, this checkout, and the target database are not on the same migration.",
      ...names,
      "",
      "A slice only fits the schema it was taken from. Check out the commit whose",
      "prisma/migrations ends with the slice's migration, run",
      "`pnpm exec prisma migrate deploy` against a fresh database, and retry."
    ]);
  }

  if (!orderCheck.ok) {
    gateFailure(3, "schema match 模型顺序不一致", [
      "The slice was written with a different SLICE_EXPORT_ORDER than this checkout has:",
      ...orderCheck.problems.map((problem) => `  ${problem}`),
      "",
      "Same cause as a migration mismatch: the slice and the code disagree about",
      "which models exist. Check out the matching commit and retry."
    ]);
  }

  console.log(`[slice-import] gate 3/4 schema match: ok (${localMigration})`);

  // -- Gate 4: empty target ---------------------------------------------------
  const delegates = new Map();
  for (const model of SLICE_EXPORT_ORDER) {
    const delegate = prisma[sliceDelegateName(model)];
    if (delegate == null || typeof delegate.createMany !== "function") {
      fail(
        `No Prisma delegate for ${model} (looked for prisma.${sliceDelegateName(model)}).\n` +
          "             SLICE_EXPORT_ORDER and the generated client disagree — run `pnpm prisma:generate`."
      );
    }
    delegates.set(model, delegate);
  }

  const beforeCounts = {};
  for (const model of SLICE_EXPORT_ORDER) {
    try {
      beforeCounts[model] = await delegates.get(model).count();
    } catch (error) {
      beforeCounts[model] = null;
      console.error(
        `[slice-import] could not count ${model}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const emptyTarget = decideSliceEmptyTarget(beforeCounts);

  if (!emptyTarget.empty) {
    gateFailure(4, "empty target 目标库必须为空", [
      "The target database already holds data. A slice carries production ids;",
      "loading it on top of seeded or previously imported rows produces a database",
      "that looks fine and is quietly neither.",
      "",
      ...emptyTarget.nonEmpty.map((entry) => `  ${entry.model.padEnd(24)} ${String(entry.count).padStart(7)} rows`),
      ...emptyTarget.unknown.map((model) => `  ${model.padEnd(24)}       ? (count unreadable)`),
      "",
      `  ${String(emptyTarget.totalRows)} rows in ${emptyTarget.nonEmpty.length} table(s).`,
      "",
      "Start from a fresh database instead:",
      "  createdb moldpilot_slice",
      "  DATABASE_URL=postgresql://…/moldpilot_slice pnpm exec prisma migrate deploy",
      "  DATABASE_URL=postgresql://…/moldpilot_slice pnpm slice:import -- --slice <slice dir>",
      "",
      "(`prisma migrate reset` also works, and re-seeds demo data — which this gate",
      " would then refuse. Use `migrate deploy` on a new database.)"
    ]);
  }

  console.log("[slice-import] gate 4/4 empty target: ok (every table is empty)");

  // -- Plan -------------------------------------------------------------------
  // The revivable-column map and the FK graph both come from prisma/schema.prisma
  // itself, so a migration cannot leave this script behind.
  const schemaSource = await readFile(path.join(PROJECT_ROOT, "prisma", "schema.prisma"), "utf8");
  const columnTypes = parseSliceColumnTypes(schemaSource);
  const foreignKeys = parsePrismaForeignKeys(schemaSource);
  const deferral = planSliceDeferrals(foreignKeys, SLICE_EXPORT_ORDER);

  if (deferral.problems.length > 0) {
    fail(
      "SLICE_EXPORT_ORDER cannot satisfy every foreign key:\n" +
        deferral.problems.map((problem) => `             - ${problem.message}`).join("\n")
    );
  }

  console.log(
    `[slice-import] deferred FK columns: ${
      deferral.deferred.map((entry) => `${entry.model}.${entry.column}`).join(", ") || "none"
    } (inserted null, patched after)`
  );

  if (options.dryRun) {
    console.log("");
    console.log("[slice-import] --dry-run: all four gates passed. Planned load:");
    for (const model of SLICE_EXPORT_ORDER) {
      console.log(`  ${model.padEnd(24)} ${String(manifestCounts[model] ?? 0).padStart(7)} rows`);
    }
    console.log("");
    console.log(`  Total 总行数: ${manifest.data?.rowCountTotal ?? "?"}`);
    console.log("  Nothing was written. Drop --dry-run to load.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // -- Load -------------------------------------------------------------------
  const startedAt = Date.now();
  // Only models that own a deferred column need their rows kept in memory; for
  // everything else the rows are handed to createMany and forgotten.
  const retainedRows = {};
  let attachmentRawRows = [];
  let passwordsSet = 0;

  for (const model of SLICE_EXPORT_ORDER) {
    const rawRows = await readNdjson(path.join(sliceDirectory, `${model}.ndjson`), model);

    if (model === "FileAttachment") {
      // Kept for the blob cross-check below, in their exported (JSON) form.
      attachmentRawRows = rawRows;
    }

    const deferredColumns = deferredSliceColumnsFor(deferral.deferred, model);
    const revived = [];

    for (let index = 0; index < rawRows.length; index += 1) {
      let row;
      try {
        row = reviveSliceRow(model, rawRows[index], columnTypes, {
          jsonNull: jsonNullSentinel,
          // No `Bytes` column exists today; the export writes `{ $base64 }` for
          // one, so a future migration is handled instead of refused.
          decodeBase64: (base64) => Buffer.from(base64, "base64")
        });
      } catch (error) {
        fail(
          `${model}.ndjson line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (model === "User") {
        // The export nulled passwordHash. Give every account the same throwaway
        // development password through the real hasher (one salt per user, same
        // scrypt-v1 verifier the app checks), and force a change on first login.
        row.passwordHash = hashPassword(DEV_PASSWORD);
        row.forcePasswordChange = true;
        row.passwordUpdatedAt = null;
        passwordsSet += 1;
      }

      revived.push(row);
    }

    if (deferredColumns.length > 0) {
      retainedRows[model] = revived;
    }

    const insertable = revived.map((row) => withDeferredColumnsNulled(row, deferredColumns));
    let inserted = 0;

    for (const batch of chunk(insertable, INSERT_CHUNK_SIZE)) {
      try {
        const result = await delegates.get(model).createMany({ data: batch });
        inserted += typeof result?.count === "number" ? result.count : batch.length;
      } catch (error) {
        fail(
          `${model}: createMany failed after ${inserted} of ${insertable.length} rows.\n` +
            `             ${error instanceof Error ? error.message : String(error)}\n` +
            "             The database is now half-loaded. Drop it and start again from a fresh\n" +
            "             database (createdb + `pnpm exec prisma migrate deploy`)."
        );
      }
    }

    console.log(`[slice-import] ${model.padEnd(24)} ${String(inserted).padStart(7)} rows`);
  }

  // -- Patch the deferred foreign keys ----------------------------------------
  const patchPlan = buildSlicePatchPlan(deferral.deferred, retainedRows, SLICE_EXPORT_ORDER);

  if (patchPlan.problems.length > 0) {
    fail(`The slice cannot be patched:\n${patchPlan.problems.map((problem) => `             - ${problem}`).join("\n")}`);
  }

  for (const operation of patchPlan.operations) {
    try {
      await delegates.get(operation.model).update({ where: { id: operation.id }, data: operation.values });
    } catch (error) {
      fail(
        `Patching ${operation.model} ${operation.id} (${Object.keys(operation.values).join(", ")}) failed:\n` +
          `             ${error instanceof Error ? error.message : String(error)}\n` +
          "             The rows are loaded but the deferred foreign keys are incomplete. Drop the\n" +
          "             database and start again."
      );
    }
  }

  console.log(
    `[slice-import] patched ${patchPlan.totalRows} row(s): ${
      Object.entries(patchPlan.columnCounts)
        .map(([column, count]) => `${column} ×${count}`)
        .join(", ") || "nothing to patch"
    }`
  );

  // -- Blobs ------------------------------------------------------------------
  // Every file under blobs/ is copied to <storage root>/<same relative path>,
  // which is exactly `storageKey`. A traversal-unsafe key is refused, not
  // followed — the same rule the download route and the export use.
  const blobDirectory = path.join(sliceDirectory, "blobs");
  const storageRoot = attachmentStorageRoot();
  const blobFiles = await walkFiles(blobDirectory);
  const copiedKeys = new Set();
  let copiedBytes = 0;
  let unsafeKeys = 0;

  for (const relative of blobFiles) {
    const sourcePath = resolveStoragePath(blobDirectory, relative);
    const targetPath = resolveStoragePath(storageRoot, relative);

    if (sourcePath == null || targetPath == null) {
      unsafeKeys += 1;
      console.error(`[slice-import] refusing unsafe blob path: ${relative}`);
      continue;
    }

    const stats = await stat(sourcePath);
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, targetPath);
    copiedKeys.add(relative);
    copiedBytes += stats.size;
  }

  // Attachments whose bytes SHOULD have travelled (Phase 1's policy: live
  // TRIAL_PHOTO rows at or below the cap) but did not. Never fatal: the metadata
  // row is there, the app shows a missing file, and the manifest already records
  // what vanished on the export side.
  const missingBlobs = [];
  for (const row of attachmentRawRows) {
    const expected =
      row.deletedAt == null &&
      row.fileType === SLICE_BLOB_FILE_TYPE &&
      typeof row.sizeBytes === "number" &&
      row.sizeBytes <= SLICE_BLOB_MAX_BYTES;

    if (expected && typeof row.storageKey === "string" && !copiedKeys.has(row.storageKey)) {
      missingBlobs.push(row.storageKey);
    }
  }

  console.log(
    `[slice-import] blobs: ${copiedKeys.size} copied (${copiedBytes} bytes) into ${storageRoot}` +
      `${missingBlobs.length > 0 ? ` · ${missingBlobs.length} expected file(s) not in the slice` : ""}` +
      `${unsafeKeys > 0 ? ` · ${unsafeKeys} refused` : ""}`
  );

  // -- Post-load verification -------------------------------------------------
  const afterCounts = {};
  for (const model of SLICE_EXPORT_ORDER) {
    try {
      afterCounts[model] = await delegates.get(model).count();
    } catch {
      afterCounts[model] = null;
    }
  }

  const countReport = compareSliceCounts(manifestCounts, afterCounts);

  if (!countReport.ok) {
    console.error("");
    console.error("[slice-import FAIL] The database does not hold what the manifest promised:");
    console.error(`  ${"Model".padEnd(24)} ${"manifest".padStart(9)} ${"database".padStart(9)} ${"delta".padStart(7)}`);
    for (const row of countReport.mismatches) {
      console.error(
        `  ${row.model.padEnd(24)} ${String(row.expected).padStart(9)} ${String(
          row.actual < 0 ? "unreadable" : row.actual
        ).padStart(9)} ${String(row.delta).padStart(7)}`
      );
    }
    console.error("");
    console.error("[slice-import FAIL] This database is INCOMPLETE. Drop it and start again.");
    exitCode = 1;
  } else {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log("");
    console.log("  MoldPilot dev slice imported 开发切片已导入");
    console.log(`  Window 窗口        : ${manifest.data?.window?.from ?? "?"} .. ${manifest.data?.window?.to ?? "?"}`);
    console.log(`  Projects 项目      : ${manifest.data?.projects?.included ?? "?"}`);
    console.log(`  Rows 行数          : ${countReport.actualTotal} across ${SLICE_EXPORT_ORDER.length} models (manifest: ${countReport.expectedTotal})`);
    console.log(`  Patched FKs 补写   : ${patchPlan.totalRows} row(s)`);
    console.log(`  Blobs 附件         : ${copiedKeys.size} copied · ${missingBlobs.length} expected but absent`);
    console.log(`  Schema 迁移        : ${localMigration}`);
    console.log(`  Database 数据库    : ${databaseName}  (${seconds}s)`);
    console.log(`  Integrity code 校验码: ${manifest.integrity.code}`);
    console.log("");
    console.log(`  ALL ${passwordsSet} USERS NOW SHARE THE PASSWORD "${DEV_PASSWORD}".`);
    console.log(`  所有 ${passwordsSet} 个账号的密码均为 "${DEV_PASSWORD}"，首次登录必须修改。`);
    console.log("  Every account is flagged forcePasswordChange. This database is a development");
    console.log("  toy: never expose it beyond this laptop, and never treat it as a backup.");
    console.log("");
    console.log("  next: pnpm dev, then /api/health/ready");
  }
} catch (error) {
  console.error(`[slice-import FAIL] ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    "[slice-import FAIL] The target database may be half-loaded. Drop it and start again from a\n" +
      "                    fresh database (createdb + `pnpm exec prisma migrate deploy`)."
  );
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}

// Not process.exit(): the summary is the point of this tool, and exiting hard
// can truncate it when stdout is a pipe.
process.exitCode = exitCode;
