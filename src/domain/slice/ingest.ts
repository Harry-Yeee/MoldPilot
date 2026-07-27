/**
 * Dev-slice ingest — the pure half of Phase 2 (`scripts/import-slice.mjs`).
 *
 * Phase 1 wrote a slice: one `<Model>.ndjson` per exported model in
 * `SLICE_EXPORT_ORDER`, a `blobs/` tree, and a hashed `manifest.json`. Phase 2
 * reads that back into an EMPTY development database. Everything in this file is
 * a decision Phase 2 has to make and a test has to be able to check without a
 * database:
 *
 *   planSliceDeferrals()      which FK columns cannot be satisfied at insert time
 *   buildSlicePatchPlan()     the UPDATEs that repair them afterwards
 *   reviveSliceRow()          JSON text  ->  Prisma values (the inverse of
 *                             `toJsonSafe()` in scripts/export-slice.mjs)
 *   decideSliceEmptyTarget()  is this database safe to write into
 *   compareSliceCounts()      did every row that left production arrive
 *
 * The CLI keeps the I/O — Prisma, the filesystem, the environment — and calls
 * these. Pure module: no Prisma, no filesystem, no environment, no clock.
 *
 * WHY THE DEFERRAL PLAN IS COMPUTED AND NOT WRITTEN DOWN: the three reference
 * cycles are already documented in `classification.ts`, but a hand-copied list of
 * "columns to null out" in the ingest script would be a fourth place to forget.
 * `planSliceDeferrals()` derives the list from the schema's own foreign keys plus
 * `SLICE_EXPORT_ORDER`, so a migration that adds a fourth cycle is either handled
 * automatically (nullable column -> deferred) or reported as a hard problem
 * (NOT NULL column pointing forward -> the order is wrong and ingest must stop).
 */

import { SLICE_EXPORT_ORDER } from "./classification.ts";
import type { PrismaForeignKey, SliceColumnType, SliceColumnTypeMap } from "./schema-map.ts";

/**
 * Prisma delegate for a model name: `MoldTrialProject` -> `moldTrialProject`.
 * Prisma lower-cases the first character and nothing else, which is why this is
 * one line rather than a hand-written table (a table would be a second source of
 * truth next to `SLICE_EXPORT_ORDER`).
 */
export function sliceDelegateName(model: string): string {
  if (model.length === 0) {
    return model;
  }

  return `${model.charAt(0).toLowerCase()}${model.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Deferred foreign keys
// ---------------------------------------------------------------------------

export type SliceDeferralReason = "self-reference" | "forward-reference";

export type SliceDeferredColumn = {
  model: string;
  column: string;
  targetModel: string;
  reason: SliceDeferralReason;
};

export type SliceOrderProblem = {
  model: string;
  column: string;
  targetModel: string;
  message: string;
};

export type SliceDeferralPlan = {
  /** Nullable FK columns that must be inserted as null and patched afterwards. */
  deferred: SliceDeferredColumn[];
  /** Unsatisfiable FKs — a NOT NULL column whose parent is written later, or not at all. */
  problems: SliceOrderProblem[];
};

/**
 * Splits every foreign key into "insertable now", "deferred", and "impossible".
 *
 * A FK is satisfiable at insert time when its target model is written EARLIER in
 * the order. Same position means a self-reference (parents and children live in
 * one file, and nothing guarantees parents come first inside it); a later
 * position means a reference cycle. Both are fine when the scalar column is
 * nullable — insert null, patch after — and fatal when it is not.
 *
 * Models absent from the order are not written by the slice at all: a FK
 * declared ON such a model is irrelevant, but a FK POINTING AT one can never be
 * satisfied and is reported.
 */
export function planSliceDeferrals(
  foreignKeys: readonly PrismaForeignKey[],
  order: readonly string[] = SLICE_EXPORT_ORDER
): SliceDeferralPlan {
  const position = new Map(order.map((model, index) => [model, index]));
  const deferred: SliceDeferredColumn[] = [];
  const problems: SliceOrderProblem[] = [];

  for (const foreignKey of foreignKeys) {
    const modelIndex = position.get(foreignKey.model);

    if (modelIndex === undefined) {
      // The model itself never travels (excluded); its FKs impose nothing.
      continue;
    }

    const targetIndex = position.get(foreignKey.targetModel);

    if (targetIndex === undefined) {
      problems.push({
        model: foreignKey.model,
        column: foreignKey.column,
        targetModel: foreignKey.targetModel,
        message: `${foreignKey.model}.${foreignKey.column} references ${foreignKey.targetModel}, which the slice never writes.`
      });
      continue;
    }

    if (targetIndex < modelIndex) {
      continue;
    }

    const reason: SliceDeferralReason = targetIndex === modelIndex ? "self-reference" : "forward-reference";

    if (!foreignKey.optional) {
      problems.push({
        model: foreignKey.model,
        column: foreignKey.column,
        targetModel: foreignKey.targetModel,
        message:
          `${foreignKey.model}.${foreignKey.column} is NOT NULL and references ${foreignKey.targetModel}, ` +
          `which is written ${reason === "self-reference" ? "in the same file" : "later"}. ` +
          "SLICE_EXPORT_ORDER cannot satisfy it — fix the order, not the ingest."
      });
      continue;
    }

    deferred.push({
      model: foreignKey.model,
      column: foreignKey.column,
      targetModel: foreignKey.targetModel,
      reason
    });
  }

  return { deferred, problems };
}

/** Deferred column names for one model, in declaration order. */
export function deferredSliceColumnsFor(
  deferred: readonly SliceDeferredColumn[],
  model: string
): string[] {
  return deferred.filter((entry) => entry.model === model).map((entry) => entry.column);
}

/**
 * Copy of `row` with every deferred column forced to null — what actually gets
 * inserted. A column absent from the row stays absent: the slice decides which
 * columns exist, not this function.
 */
export function withDeferredColumnsNulled(
  row: Readonly<Record<string, unknown>>,
  columns: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };

  for (const column of columns) {
    if (Object.hasOwn(result, column)) {
      result[column] = null;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Patch plan
// ---------------------------------------------------------------------------

export type SlicePatchOperation = {
  model: string;
  id: string;
  /** Deferred columns for this row that carried a value, and what it was. */
  values: Record<string, unknown>;
};

export type SlicePatchPlan = {
  /** One UPDATE per row that needs one, in export order then id order. */
  operations: SlicePatchOperation[];
  /** `Model.column` -> number of rows whose value has to be restored. */
  columnCounts: Record<string, number>;
  /** Rows that need a patch but carry no usable id — a corrupt slice. */
  problems: string[];
  totalRows: number;
};

/**
 * Turns "these columns were nulled on insert" into the exact list of updates
 * that puts the values back.
 *
 * One operation per ROW, not per column, so a row with two deferred columns
 * costs one UPDATE. Rows whose deferred columns were all null to begin with
 * produce nothing: an UPDATE setting null to null is pure noise in the log and
 * pure load on the database.
 *
 * `rowsByModel` holds the rows AS EXPORTED (deferred columns still populated),
 * which is why the CLI keeps the parsed rows around instead of streaming them
 * straight into `createMany`.
 */
export function buildSlicePatchPlan(
  deferred: readonly SliceDeferredColumn[],
  rowsByModel: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
  order: readonly string[] = SLICE_EXPORT_ORDER
): SlicePatchPlan {
  const operations: SlicePatchOperation[] = [];
  const columnCounts: Record<string, number> = {};
  const problems: string[] = [];
  let totalRows = 0;

  const models = order.filter((model) => deferred.some((entry) => entry.model === model));

  for (const model of models) {
    const columns = deferredSliceColumnsFor(deferred, model);
    const rows = rowsByModel[model] ?? [];

    for (const row of rows) {
      const values: Record<string, unknown> = {};

      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined) {
          continue;
        }
        values[column] = value;
        columnCounts[`${model}.${column}`] = (columnCounts[`${model}.${column}`] ?? 0) + 1;
      }

      if (Object.keys(values).length === 0) {
        continue;
      }

      const id = row.id;

      if (typeof id !== "string" || id.length === 0) {
        problems.push(
          `${model}: a row needs ${Object.keys(values).join(", ")} patched but has no id — the slice is corrupt.`
        );
        continue;
      }

      operations.push({ model, id, values });
      totalRows += 1;
    }
  }

  // Deterministic order: export order first (already the outer loop), then id,
  // so two runs over the same slice issue the same statements in the same order.
  operations.sort((left, right) => {
    const byModel = order.indexOf(left.model) - order.indexOf(right.model);
    if (byModel !== 0) {
      return byModel;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return { operations, columnCounts, problems, totalRows };
}

// ---------------------------------------------------------------------------
// Type revival — the inverse of `toJsonSafe()` in scripts/export-slice.mjs
// ---------------------------------------------------------------------------

/**
 * How the CLI wants JSON nulls and binary columns handled.
 *
 * `jsonNull` exists because Prisma refuses a bare `null` for a nullable `Json`
 * column — it wants `Prisma.DbNull` (SQL NULL) or `Prisma.JsonNull` (the JSON
 * value `null`). That sentinel is a Prisma runtime object, so it cannot appear
 * in a pure module; the CLI injects it and a test can inject a marker string.
 * `undefined` is a legitimate value here: Prisma reads it as "column omitted",
 * which for a nullable column with no default is also SQL NULL.
 */
export type SliceReviveOptions = {
  /** Value to use for a null in a nullable `Json` column. Default: `null`. */
  jsonNull?: unknown;
  /** base64 -> bytes. Default: `Buffer.from(value, "base64")` is NOT assumed; supply one. */
  decodeBase64?: (base64: string) => unknown;
};

const DECIMAL_TEXT = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

function reviveScalar(
  model: string,
  column: string,
  type: SliceColumnType,
  value: unknown,
  options: SliceReviveOptions
): unknown {
  const where = `${model}.${column}`;

  switch (type.kind) {
    case "DateTime": {
      // Export wrote `value.toISOString()`.
      if (typeof value !== "string") {
        throw new Error(`${where}: expected an ISO date string, got ${typeof value}.`);
      }
      const revived = new Date(value);
      if (Number.isNaN(revived.getTime())) {
        throw new Error(`${where}: "${value}" is not a valid ISO date.`);
      }
      return revived;
    }

    case "Decimal": {
      // Export wrote `decimal.toString()` to keep full precision. Prisma accepts
      // a decimal STRING for a Decimal column, so the string is the value —
      // parsing it into a float here is exactly the precision loss the export
      // went out of its way to avoid.
      if (typeof value === "number") {
        return String(value);
      }
      if (typeof value !== "string" || !DECIMAL_TEXT.test(value)) {
        throw new Error(`${where}: expected a decimal string, got ${JSON.stringify(value)}.`);
      }
      return value;
    }

    case "BigInt": {
      if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
        throw new Error(`${where}: expected a whole-number string, got ${JSON.stringify(value)}.`);
      }
      return BigInt(value);
    }

    case "Bytes": {
      const base64 =
        value !== null && typeof value === "object" && "$base64" in (value as Record<string, unknown>)
          ? (value as Record<string, unknown>).$base64
          : null;

      if (typeof base64 !== "string") {
        throw new Error(`${where}: expected { "$base64": "..." }, got ${JSON.stringify(value)}.`);
      }

      if (options.decodeBase64 == null) {
        throw new Error(`${where}: the slice carries bytes but no decodeBase64 was supplied.`);
      }

      return options.decodeBase64(base64);
    }

    case "Json":
      // Json survived JSON.parse as itself. Nested Dates are impossible: the
      // column is text in the database and was text in the export.
      return value;

    default:
      return value;
  }
}

/**
 * One NDJSON row -> one Prisma `create` payload.
 *
 * Mirrors `toJsonSafe()` in `scripts/export-slice.mjs` (the `Date`/`Decimal`/
 * `BigInt`/`Buffer`/`Json` branches) using the column map parsed out of
 * `prisma/schema.prisma`, so the two halves cannot drift: a `DateTime?` added by
 * a migration is revived without anybody editing this file.
 *
 * Columns the schema does not list as revivable — String, Int, Boolean, enums —
 * survive `JSON.parse` unchanged and are copied as they are. A column present in
 * the row but absent from the schema is copied too: deciding it is unknown is
 * `createMany`'s job, and its error names the column better than a guess here.
 */
export function reviveSliceRow(
  model: string,
  row: Readonly<Record<string, unknown>>,
  columnTypes: SliceColumnTypeMap,
  options: SliceReviveOptions = {}
): Record<string, unknown> {
  const types = columnTypes[model] ?? {};
  const result: Record<string, unknown> = {};

  for (const column of Object.keys(row)) {
    const value = row[column];
    const type = types[column];

    if (type === undefined) {
      result[column] = value;
      continue;
    }

    if (value === null || value === undefined) {
      if (type.kind === "Json") {
        if (!type.optional) {
          throw new Error(`${model}.${column}: NOT NULL Json column is null in the slice.`);
        }
        result[column] = "jsonNull" in options ? options.jsonNull : null;
        continue;
      }

      if (!type.optional) {
        throw new Error(`${model}.${column}: NOT NULL column is null in the slice.`);
      }

      result[column] = null;
      continue;
    }

    if (type.list) {
      if (!Array.isArray(value)) {
        throw new Error(`${model}.${column}: expected a list, got ${typeof value}.`);
      }
      result[column] = value.map((entry) => reviveScalar(model, column, type, entry, options));
      continue;
    }

    result[column] = reviveScalar(model, column, type, value, options);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Gate 4 — is the target database empty
// ---------------------------------------------------------------------------

export type SliceTableCount = { model: string; count: number };

export type SliceEmptyTargetVerdict = {
  /** True only when every table the slice writes is provably empty. */
  empty: boolean;
  nonEmpty: SliceTableCount[];
  /** Models whose count could not be read — treated as "not proven empty". */
  unknown: string[];
  totalRows: number;
};

/**
 * Refuses a target that already holds data in ANY table the slice writes.
 *
 * Not "refuse when the rows collide": a slice carries production ids, and mixing
 * them with seeded demo rows produces a database that looks fine and is quietly
 * neither. Fresh database, migrations, then ingest — that is the only supported
 * shape, and it is the one the failure message prints.
 *
 * A count that could not be read is never treated as zero.
 */
export function decideSliceEmptyTarget(
  counts: Readonly<Record<string, number | null | undefined>>,
  order: readonly string[] = SLICE_EXPORT_ORDER
): SliceEmptyTargetVerdict {
  const nonEmpty: SliceTableCount[] = [];
  const unknown: string[] = [];
  let totalRows = 0;

  for (const model of order) {
    const count = counts[model];

    if (count === null || count === undefined || !Number.isFinite(count)) {
      unknown.push(model);
      continue;
    }

    if (count > 0) {
      nonEmpty.push({ model, count });
      totalRows += count;
    }
  }

  return { empty: nonEmpty.length === 0 && unknown.length === 0, nonEmpty, unknown, totalRows };
}

// ---------------------------------------------------------------------------
// Post-load verification
// ---------------------------------------------------------------------------

export type SliceCountComparison = {
  model: string;
  expected: number;
  actual: number;
  /** actual - expected. Negative means rows went missing. */
  delta: number;
  ok: boolean;
};

export type SliceCountReport = {
  ok: boolean;
  rows: SliceCountComparison[];
  mismatches: SliceCountComparison[];
  expectedTotal: number;
  actualTotal: number;
};

/**
 * Manifest counts vs. what the database actually holds afterwards.
 *
 * A model the manifest never mentions counts as expected 0; a count that could
 * not be read counts as actual -1 and always mismatches, because "I could not
 * check" must never read as "it matched".
 */
export function compareSliceCounts(
  expected: Readonly<Record<string, number | null | undefined>>,
  actual: Readonly<Record<string, number | null | undefined>>,
  order: readonly string[] = SLICE_EXPORT_ORDER
): SliceCountReport {
  const rows: SliceCountComparison[] = [];
  let expectedTotal = 0;
  let actualTotal = 0;

  for (const model of order) {
    const expectedCount = numberOr(expected[model], 0);
    const actualCount = numberOr(actual[model], -1);

    expectedTotal += expectedCount;
    actualTotal += Math.max(actualCount, 0);

    rows.push({
      model,
      expected: expectedCount,
      actual: actualCount,
      delta: actualCount - expectedCount,
      ok: actualCount === expectedCount
    });
  }

  const mismatches = rows.filter((row) => !row.ok);

  return { ok: mismatches.length === 0, rows, mismatches, expectedTotal, actualTotal };
}

function numberOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** `{ Model: rowCount }` from the manifest's `data.models` array. */
export function sliceManifestModelCounts(
  entries: readonly Readonly<{ model?: unknown; rowCount?: unknown }>[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of entries) {
    if (typeof entry.model !== "string" || typeof entry.rowCount !== "number") {
      continue;
    }
    counts[entry.model] = entry.rowCount;
  }

  return counts;
}

/**
 * The slice's own `exportOrder` against the order this build compiles with.
 *
 * Both halves import `SLICE_EXPORT_ORDER` from `classification.ts`, so this can
 * only fail across VERSIONS — a slice exported before a model was added, read by
 * a checkout after. That is a schema-mismatch symptom and gets the same
 * treatment: name every difference, refuse to guess.
 */
export function compareSliceExportOrder(
  manifestOrder: readonly unknown[],
  expected: readonly string[] = SLICE_EXPORT_ORDER
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const actual = manifestOrder.filter((entry): entry is string => typeof entry === "string");

  if (actual.length !== manifestOrder.length) {
    problems.push("manifest exportOrder contains a non-string entry.");
  }

  for (const model of actual) {
    if (!expected.includes(model)) {
      problems.push(`${model} is in the slice but not in this checkout's SLICE_EXPORT_ORDER.`);
    }
  }

  for (const model of expected) {
    if (!actual.includes(model)) {
      problems.push(`${model} is in this checkout's SLICE_EXPORT_ORDER but not in the slice.`);
    }
  }

  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    if (actual[index] !== expected[index]) {
      problems.push(
        `position ${index}: slice writes ${actual[index]}, this checkout expects ${expected[index]}.`
      );
      break;
    }
  }

  return { ok: problems.length === 0, problems };
}
