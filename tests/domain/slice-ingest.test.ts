import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { SLICE_EXPORT_ORDER } from "../../src/domain/slice/classification.ts";
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
  withDeferredColumnsNulled,
  type SliceDeferredColumn
} from "../../src/domain/slice/ingest.ts";
import {
  parsePrismaForeignKeys,
  parsePrismaSchema,
  parseSliceColumnTypes,
  type PrismaForeignKey
} from "../../src/domain/slice/schema-map.ts";

/**
 * Phase 2 (ingest) pure coverage, plus the structural guard that keeps the FK
 * order a single source of truth shared with the export.
 *
 * Everything here runs without a database: the schema is parsed from
 * `prisma/schema.prisma` at test time (same idea as
 * `slice-classification.test.ts`), and the revival round-trip is checked against
 * a copy of the export's own serializer.
 */

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function schemaSource(): string {
  return repoFile("prisma/schema.prisma");
}

/**
 * EXACT copy of `toJsonSafe()` from `scripts/export-slice.mjs` (lines 236-275 at
 * the time of writing), typed for this file and otherwise unchanged.
 *
 * Copied rather than imported because the export is a program, not a module —
 * importing it would run an export. The round-trip tests below are only
 * meaningful because this is the real serializer: if Phase 1 ever changes how it
 * writes a value, this copy is what has to be updated, and the round-trip is
 * what fails first.
 */
function toJsonSafe(value: unknown): unknown {
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
    const candidate = value as { toFixed?: unknown; toString: () => string };
    // Prisma Decimal (decimal.js): keep full precision as a string.
    if (typeof candidate.toFixed === "function" && typeof candidate.toString === "function") {
      return candidate.toString();
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      result[key] = toJsonSafe(source[key]);
    }
    return result;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }

  return value;
}

/** Stand-in for Prisma's decimal.js value: `toFixed` + `toString`, nothing else. */
function fakeDecimal(text: string): { toFixed: (digits: number) => string; toString: () => string } {
  return {
    toFixed: (digits: number) => Number.parseFloat(text).toFixed(digits),
    toString: () => text
  };
}

/** One NDJSON round trip: Prisma value -> export JSON -> Prisma value. */
function roundTrip(
  model: string,
  row: Record<string, unknown>,
  options?: Parameters<typeof reviveSliceRow>[3]
): Record<string, unknown> {
  const serialized = JSON.parse(JSON.stringify(toJsonSafe(row))) as Record<string, unknown>;
  return reviveSliceRow(model, serialized, parseSliceColumnTypes(schemaSource()), options);
}

describe("schema map reads prisma/schema.prisma", () => {
  test("every line inside every model block parses", () => {
    const parsed = parsePrismaSchema(schemaSource());

    assert.deepEqual(parsed.unparsedLines, [], "the schema grew a shape the parser does not understand");
    assert.ok(parsed.models.length >= 20, `parsed only ${parsed.models.length} models`);
    assert.ok(parsed.fields.length > 100, `parsed only ${parsed.fields.length} fields`);
  });

  test("revivable columns are found with the right kind and nullability", () => {
    const columns = parseSliceColumnTypes(schemaSource());

    assert.deepEqual(columns.User?.passwordUpdatedAt, { kind: "DateTime", optional: true, list: false });
    assert.deepEqual(columns.User?.createdAt, { kind: "DateTime", optional: false, list: false });
    assert.deepEqual(columns.TrialProcessValue?.valueNumber, { kind: "Decimal", optional: true, list: false });
    assert.deepEqual(columns.ActivityLog?.beforeJson, { kind: "Json", optional: true, list: false });
    assert.deepEqual(columns.KpiSnapshot?.metricsJson, { kind: "Json", optional: false, list: false });

    // Plain scalars are deliberately absent — they survive JSON.parse unchanged.
    assert.equal(columns.User?.username, undefined);
    assert.equal(columns.FileAttachment?.storageKey, undefined);
  });

  test("foreign keys carry the scalar column's nullability, not the relation's", () => {
    const foreignKeys = parsePrismaForeignKeys(schemaSource());
    const find = (model: string, column: string): PrismaForeignKey | undefined =>
      foreignKeys.find((entry) => entry.model === model && entry.column === column);

    assert.deepEqual(find("User", "roleId"), {
      model: "User",
      column: "roleId",
      targetModel: "Role",
      optional: false
    });
    assert.deepEqual(find("User", "departmentGroupId"), {
      model: "User",
      column: "departmentGroupId",
      targetModel: "DepartmentGroup",
      optional: true
    });
    assert.deepEqual(find("DepartmentGroup", "parentGroupId"), {
      model: "DepartmentGroup",
      column: "parentGroupId",
      targetModel: "DepartmentGroup",
      optional: true
    });
  });
});

describe("deferred foreign keys", () => {
  const plan = planSliceDeferrals(parsePrismaForeignKeys(schemaSource()), SLICE_EXPORT_ORDER);

  test("the real schema needs exactly the three documented deferrals", () => {
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(
      plan.deferred.map((entry) => `${entry.model}.${entry.column}`).sort(),
      ["Customer.defaultProcessSheetTemplateId", "DepartmentGroup.parentGroupId", "User.departmentGroupId"]
    );

    const selfReference = plan.deferred.find((entry) => entry.column === "parentGroupId");
    assert.equal(selfReference?.reason, "self-reference");
    assert.equal(
      plan.deferred.find((entry) => entry.column === "departmentGroupId")?.reason,
      "forward-reference"
    );
  });

  test("columns are grouped per model", () => {
    assert.deepEqual(deferredSliceColumnsFor(plan.deferred, "User"), ["departmentGroupId"]);
    assert.deepEqual(deferredSliceColumnsFor(plan.deferred, "Role"), []);
  });

  test("a NOT NULL forward reference is a problem, not a deferral", () => {
    const broken = planSliceDeferrals(
      [{ model: "Customer", column: "ownerUserId", targetModel: "User", optional: false }],
      ["Customer", "User"]
    );

    assert.deepEqual(broken.deferred, []);
    assert.equal(broken.problems.length, 1);
    assert.match(broken.problems[0]?.message ?? "", /NOT NULL/);
    assert.match(broken.problems[0]?.message ?? "", /SLICE_EXPORT_ORDER cannot satisfy it/);
  });

  test("a reference to a model the slice never writes is a problem", () => {
    const orphan = planSliceDeferrals(
      [{ model: "User", column: "throttleId", targetModel: "LoginThrottleBucket", optional: true }],
      ["User"]
    );

    assert.equal(orphan.deferred.length, 0);
    assert.match(orphan.problems[0]?.message ?? "", /which the slice never writes/);
  });

  test("a foreign key ON an unwritten model imposes nothing", () => {
    const ignored = planSliceDeferrals(
      [{ model: "LoginThrottleBucket", column: "userId", targetModel: "User", optional: false }],
      ["User"]
    );

    assert.deepEqual(ignored.deferred, []);
    assert.deepEqual(ignored.problems, []);
  });

  test("insertable rows have the deferred columns nulled and nothing else touched", () => {
    const row = { id: "u1", username: "zhong", roleId: "r1", departmentGroupId: "g1" };
    const insertable = withDeferredColumnsNulled(row, ["departmentGroupId"]);

    assert.deepEqual(insertable, { id: "u1", username: "zhong", roleId: "r1", departmentGroupId: null });
    assert.equal(row.departmentGroupId, "g1", "the caller's row was mutated");
  });

  test("a deferred column absent from the row is not invented", () => {
    assert.deepEqual(withDeferredColumnsNulled({ id: "u1" }, ["departmentGroupId"]), { id: "u1" });
  });
});

describe("patch plan", () => {
  const deferred: SliceDeferredColumn[] = [
    { model: "User", column: "departmentGroupId", targetModel: "DepartmentGroup", reason: "forward-reference" },
    { model: "DepartmentGroup", column: "parentGroupId", targetModel: "DepartmentGroup", reason: "self-reference" },
    {
      model: "Customer",
      column: "defaultProcessSheetTemplateId",
      targetModel: "ProcessSheetTemplate",
      reason: "forward-reference"
    }
  ];

  test("only rows that actually carry a value are patched", () => {
    const plan = buildSlicePatchPlan(deferred, {
      User: [
        { id: "u1", departmentGroupId: "g1" },
        { id: "u2", departmentGroupId: null },
        { id: "u3" }
      ],
      DepartmentGroup: [
        { id: "g1", parentGroupId: null },
        { id: "g2", parentGroupId: "g1" }
      ],
      Customer: [{ id: "c1", defaultProcessSheetTemplateId: "t1" }]
    });

    assert.deepEqual(plan.problems, []);
    assert.equal(plan.totalRows, 3);
    assert.deepEqual(plan.columnCounts, {
      "User.departmentGroupId": 1,
      "DepartmentGroup.parentGroupId": 1,
      "Customer.defaultProcessSheetTemplateId": 1
    });
    assert.deepEqual(plan.operations, [
      { model: "User", id: "u1", values: { departmentGroupId: "g1" } },
      { model: "DepartmentGroup", id: "g2", values: { parentGroupId: "g1" } },
      { model: "Customer", id: "c1", values: { defaultProcessSheetTemplateId: "t1" } }
    ]);
  });

  test("a row with two deferred columns costs one update", () => {
    const twoColumns: SliceDeferredColumn[] = [
      { model: "User", column: "departmentGroupId", targetModel: "DepartmentGroup", reason: "forward-reference" },
      { model: "User", column: "managerId", targetModel: "User", reason: "self-reference" }
    ];

    const plan = buildSlicePatchPlan(twoColumns, {
      User: [{ id: "u1", departmentGroupId: "g1", managerId: "u2" }]
    });

    assert.deepEqual(plan.operations, [
      { model: "User", id: "u1", values: { departmentGroupId: "g1", managerId: "u2" } }
    ]);
    assert.equal(plan.totalRows, 1);
  });

  test("nothing to patch is a valid, empty plan", () => {
    const plan = buildSlicePatchPlan(deferred, {
      User: [{ id: "u1", departmentGroupId: null }],
      DepartmentGroup: [],
      Customer: []
    });

    assert.deepEqual(plan.operations, []);
    assert.deepEqual(plan.columnCounts, {});
    assert.equal(plan.totalRows, 0);
  });

  test("a model with no rows in the slice is skipped, not assumed", () => {
    const plan = buildSlicePatchPlan(deferred, {});
    assert.deepEqual(plan.operations, []);
    assert.deepEqual(plan.problems, []);
  });

  test("updates are ordered by export order, then id, so two runs agree", () => {
    const plan = buildSlicePatchPlan(deferred, {
      User: [
        { id: "u9", departmentGroupId: "g1" },
        { id: "u1", departmentGroupId: "g2" }
      ],
      DepartmentGroup: [{ id: "g5", parentGroupId: "g1" }]
    });

    assert.deepEqual(
      plan.operations.map((operation) => `${operation.model}:${operation.id}`),
      ["User:u1", "User:u9", "DepartmentGroup:g5"]
    );
    assert.ok(
      SLICE_EXPORT_ORDER.indexOf("User") < SLICE_EXPORT_ORDER.indexOf("DepartmentGroup"),
      "this assertion assumes the real export order"
    );
  });

  test("a row that needs a patch but has no id is reported, never guessed", () => {
    const plan = buildSlicePatchPlan(deferred, {
      User: [{ departmentGroupId: "g1" }, { id: "", departmentGroupId: "g2" }]
    });

    assert.deepEqual(plan.operations, []);
    assert.equal(plan.problems.length, 2);
    assert.match(plan.problems[0] ?? "", /no id — the slice is corrupt/);
  });
});

describe("type revival mirrors the export serializer", () => {
  test("a trial process value round-trips date and decimal columns", () => {
    const original = {
      id: "pv1",
      trialEventId: "t1",
      valueNumber: fakeDecimal("123.4567"),
      valueText: "hot",
      createdAt: new Date("2026-05-14T03:00:00.000Z"),
      updatedAt: new Date("2026-05-14T03:00:00.000Z")
    };

    const revived = roundTrip("TrialProcessValue", original);

    assert.equal(revived.id, "pv1");
    assert.equal(revived.valueText, "hot");
    // Decimal stays a STRING: Prisma accepts decimal strings, and parsing to a
    // float is exactly the precision loss the export avoided.
    assert.equal(revived.valueNumber, "123.4567");
    assert.ok(revived.createdAt instanceof Date);
    assert.equal((revived.createdAt as Date).toISOString(), "2026-05-14T03:00:00.000Z");
    assert.deepEqual(revived.updatedAt, original.updatedAt);
  });

  test("nulls survive as nulls and enums/booleans/ints are untouched", () => {
    const revived = roundTrip("User", {
      id: "u1",
      username: "zhong",
      email: null,
      passwordHash: null,
      passwordUpdatedAt: null,
      lastLoginAt: null,
      forcePasswordChange: true,
      status: "ACTIVE",
      locale: "ZH_CN",
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      updatedAt: new Date("2026-01-02T03:04:05.678Z")
    });

    assert.equal(revived.email, null);
    assert.equal(revived.passwordHash, null);
    assert.equal(revived.passwordUpdatedAt, null);
    assert.equal(revived.forcePasswordChange, true);
    assert.equal(revived.status, "ACTIVE");
    assert.equal(revived.locale, "ZH_CN");
    assert.equal((revived.createdAt as Date).toISOString(), "2026-01-02T03:04:05.678Z");
  });

  test("Json columns come back as structures, not strings", () => {
    const payload = { username: "zhong", nested: { note: "keep me", count: 2 }, list: [1, "two", null] };
    const revived = roundTrip("ActivityLog", {
      id: "a1",
      action: "trial_created",
      beforeJson: null,
      afterJson: payload,
      createdAt: new Date("2026-05-14T03:00:00.000Z")
    });

    assert.deepEqual(revived.afterJson, payload);
    assert.equal(revived.beforeJson, null, "the default json-null is a plain null");
  });

  test("a null in a nullable Json column becomes the caller's sentinel", () => {
    const revived = roundTrip("ActivityLog", { id: "a1", beforeJson: null, afterJson: { a: 1 } }, {
      jsonNull: "PRISMA_DB_NULL"
    });

    assert.equal(revived.beforeJson, "PRISMA_DB_NULL");
    assert.deepEqual(revived.afterJson, { a: 1 });
  });

  test("an omitted-column sentinel is honoured too (undefined means 'do not send')", () => {
    const revived = roundTrip("ActivityLog", { id: "a1", beforeJson: null }, { jsonNull: undefined });

    assert.ok("beforeJson" in revived);
    assert.equal(revived.beforeJson, undefined);
  });

  test("a KpiSnapshot keeps its NOT NULL metricsJson and its date", () => {
    const metrics = { habitBar: 0.85, items: [{ code: "TRIAL_ON_TIME", points: 3 }] };
    const revived = roundTrip("KpiSnapshot", {
      id: "k1",
      scopeType: "COMPANY",
      scopeId: null,
      snapshotDate: new Date("2026-05-31T16:00:00.000Z"),
      metricsJson: metrics
    });

    assert.deepEqual(revived.metricsJson, metrics);
    assert.ok(revived.snapshotDate instanceof Date);
    assert.equal(revived.scopeId, null);
  });

  test("columns the schema does not know are copied through untouched", () => {
    const revived = reviveSliceRow("TrialEvent", { id: "t1", futureColumn: "value" }, {});
    assert.deepEqual(revived, { id: "t1", futureColumn: "value" });
  });

  test("a corrupt value names its column instead of landing in the database", () => {
    const columns = parseSliceColumnTypes(schemaSource());

    assert.throws(
      () => reviveSliceRow("User", { createdAt: "not-a-date" }, columns),
      /User\.createdAt: "not-a-date" is not a valid ISO date/
    );
    assert.throws(
      () => reviveSliceRow("User", { createdAt: 1_760_000_000 }, columns),
      /User\.createdAt: expected an ISO date string, got number/
    );
    assert.throws(
      () => reviveSliceRow("TrialProcessValue", { valueNumber: "12,34" }, columns),
      /TrialProcessValue\.valueNumber: expected a decimal string/
    );
    assert.throws(
      () => reviveSliceRow("KpiSnapshot", { metricsJson: null }, columns),
      /KpiSnapshot\.metricsJson: NOT NULL Json column is null/
    );
    assert.throws(
      () => reviveSliceRow("User", { createdAt: null }, columns),
      /User\.createdAt: NOT NULL column is null/
    );
  });

  test("bigint and bytes are handled if a migration ever introduces them", () => {
    const columns = {
      Synthetic: {
        counter: { kind: "BigInt" as const, optional: false, list: false },
        payload: { kind: "Bytes" as const, optional: false, list: false }
      }
    };

    const serialized = JSON.parse(
      JSON.stringify(toJsonSafe({ counter: 9_007_199_254_740_993n, payload: Buffer.from("hi", "utf8") }))
    ) as Record<string, unknown>;

    const revived = reviveSliceRow("Synthetic", serialized, columns, {
      decodeBase64: (base64) => Buffer.from(base64, "base64")
    });

    assert.equal(revived.counter, 9_007_199_254_740_993n);
    assert.equal((revived.payload as Buffer).toString("utf8"), "hi");

    assert.throws(
      () => reviveSliceRow("Synthetic", serialized, columns),
      /no decodeBase64 was supplied/
    );
  });
});

describe("gate 4 — empty target verdict", () => {
  const allZero = Object.fromEntries(SLICE_EXPORT_ORDER.map((model) => [model, 0]));

  test("all zero is the only way in", () => {
    const verdict = decideSliceEmptyTarget(allZero);

    assert.equal(verdict.empty, true);
    assert.deepEqual(verdict.nonEmpty, []);
    assert.deepEqual(verdict.unknown, []);
    assert.equal(verdict.totalRows, 0);
  });

  test("one seeded table is enough to refuse, and it is named", () => {
    const verdict = decideSliceEmptyTarget({ ...allZero, Role: 9, User: 19 });

    assert.equal(verdict.empty, false);
    assert.deepEqual(verdict.nonEmpty, [
      { model: "Role", count: 9 },
      { model: "User", count: 19 }
    ]);
    assert.equal(verdict.totalRows, 28);
  });

  test("a count that could not be read never reads as zero", () => {
    const unreadable = decideSliceEmptyTarget({ ...allZero, KpiSnapshot: null });

    assert.equal(unreadable.empty, false);
    assert.deepEqual(unreadable.unknown, ["KpiSnapshot"]);
    assert.deepEqual(unreadable.nonEmpty, []);

    const missing = decideSliceEmptyTarget({});
    assert.equal(missing.empty, false);
    assert.deepEqual(missing.unknown, [...SLICE_EXPORT_ORDER]);
  });

  test("tables outside the export order are none of this gate's business", () => {
    const verdict = decideSliceEmptyTarget({ ...allZero, LoginThrottleBucket: 400 });
    assert.equal(verdict.empty, true);
  });
});

describe("post-load count comparison", () => {
  // A real manifest lists every exported model, and the CLI counts every one of
  // them afterwards, so both maps are complete.
  const zeros: Record<string, number> = Object.fromEntries(SLICE_EXPORT_ORDER.map((model) => [model, 0]));
  const manifestCounts = { ...zeros, Role: 9, User: 19, MoldTrialProject: 3 };

  test("equal counts pass and total up", () => {
    const report = compareSliceCounts(manifestCounts, { ...manifestCounts });

    assert.equal(report.ok, true);
    assert.deepEqual(report.mismatches, []);
    assert.equal(report.expectedTotal, 31);
    assert.equal(report.actualTotal, 31);
    assert.equal(report.rows.length, SLICE_EXPORT_ORDER.length);
  });

  test("a short table is reported with its delta", () => {
    const report = compareSliceCounts(manifestCounts, { ...manifestCounts, User: 18 });

    assert.equal(report.ok, false);
    assert.deepEqual(report.mismatches, [{ model: "User", expected: 19, actual: 18, delta: -1, ok: false }]);
  });

  test("a model the manifest never counted is expected to be empty", () => {
    const report = compareSliceCounts({ Role: 9 }, { ...zeros, Role: 9 });

    assert.equal(report.ok, true);
    assert.equal(report.expectedTotal, 9);
  });

  test("extra rows are a failure too — the target was supposed to be empty", () => {
    const report = compareSliceCounts(manifestCounts, { ...manifestCounts, Role: 10 });

    assert.equal(report.ok, false);
    assert.equal(report.mismatches[0]?.delta, 1);
  });

  test("an unreadable count can never pass", () => {
    const report = compareSliceCounts(manifestCounts, { ...manifestCounts, Role: null });

    assert.equal(report.ok, false);
    assert.equal(report.mismatches[0]?.actual, -1);
  });

  test("manifest model entries become a count map", () => {
    assert.deepEqual(
      sliceManifestModelCounts([
        { model: "Role", rowCount: 9, category: "master", file: "Role.ndjson" },
        { model: "User", rowCount: 19 },
        { model: "Broken" },
        { rowCount: 5 }
      ] as { model?: unknown; rowCount?: unknown }[]),
      { Role: 9, User: 19 }
    );
  });
});

describe("delegate names", () => {
  test("every exported model maps to a lower-camel Prisma delegate", () => {
    assert.equal(sliceDelegateName("MoldTrialProject"), "moldTrialProject");
    assert.equal(sliceDelegateName("User"), "user");
    assert.equal(sliceDelegateName("KpiSnapshot"), "kpiSnapshot");

    for (const model of SLICE_EXPORT_ORDER) {
      const delegate = sliceDelegateName(model);
      assert.match(delegate, /^[a-z]/, `${model} -> ${delegate}`);
      assert.equal(delegate.slice(1), model.slice(1), `${model} -> ${delegate} changed more than the first letter`);
    }
  });
});

describe("the FK order has ONE source, shared by export and import", () => {
  const exportScript = repoFile("scripts/export-slice.mjs");
  const importScript = repoFile("scripts/import-slice.mjs");

  /** The module each script imports `SLICE_EXPORT_ORDER` from. */
  function orderSource(script: string): string {
    const match = /import\s*\{[^}]*\bSLICE_EXPORT_ORDER\b[^}]*\}\s*from\s*"([^"]+)"/s.exec(script);
    assert.ok(match != null, "the script does not import SLICE_EXPORT_ORDER at all");
    return match[1] ?? "";
  }

  test("both CLIs import the order from the same module", () => {
    const fromExport = orderSource(exportScript);
    const fromImport = orderSource(importScript);

    assert.equal(fromImport, fromExport);
    assert.equal(fromExport, "../src/domain/slice/classification.ts");

    const resolved = path.resolve(fileURLToPath(new URL("../../scripts/", import.meta.url)), fromExport);
    assert.ok(existsSync(resolved), `${fromExport} does not resolve to a file`);
  });

  test("neither CLI carries its own list of model names", () => {
    const models = SLICE_EXPORT_ORDER.join("|");
    const literalList = new RegExp(`"(?:${models})"\\s*,\\s*"(?:${models})"`);

    assert.doesNotMatch(exportScript, literalList, "export-slice.mjs hardcodes a model list");
    assert.doesNotMatch(importScript, literalList, "import-slice.mjs hardcodes a model list");

    // Negative control: the pattern does catch a hardcoded list.
    assert.match('const order = ["Role", "Permission"];', literalList);
  });

  test("the import walks SLICE_EXPORT_ORDER and checks the slice's copy of it", () => {
    assert.match(importScript, /for \(const model of SLICE_EXPORT_ORDER\)/);
    assert.match(importScript, /compareSliceExportOrder\(manifestExportOrder\)/);
  });

  test("a slice from another build is refused with every difference named", () => {
    assert.deepEqual(compareSliceExportOrder([...SLICE_EXPORT_ORDER]), { ok: true, problems: [] });

    const missingModel = compareSliceExportOrder(SLICE_EXPORT_ORDER.filter((model) => model !== "KpiRule"));
    assert.equal(missingModel.ok, false);
    assert.ok(missingModel.problems.some((problem) => problem.includes("KpiRule")));

    const extraModel = compareSliceExportOrder([...SLICE_EXPORT_ORDER, "FutureModel"]);
    assert.equal(extraModel.ok, false);
    assert.ok(extraModel.problems.some((problem) => problem.includes("FutureModel")));

    const swapped = [...SLICE_EXPORT_ORDER];
    [swapped[0], swapped[1]] = [swapped[1] ?? "", swapped[0] ?? ""];
    const reordered = compareSliceExportOrder(swapped);
    assert.equal(reordered.ok, false);
    assert.ok(reordered.problems.some((problem) => problem.startsWith("position 0:")));

    assert.equal(compareSliceExportOrder([1, 2] as unknown[]).ok, false);
  });
});

describe("the import CLI stays a guarded, server-side tool", () => {
  const script = repoFile("scripts/import-slice.mjs");

  test("all four gates are present, numbered, and reuse the shared guards", () => {
    assert.match(script, /assertLocalPilotDeploymentAllowed\(process\.env, environmentFile\)/);
    assert.match(script, /gate 1\/4 not production/);
    assert.match(script, /snapshotIntegrityHash\(manifest\.data, sha256Hex\)/);
    assert.match(script, /formatIntegrityCode\(actualHash\)/);
    assert.match(script, /gate 2\/4 manifest integrity/);
    assert.match(script, /_prisma_migrations/);
    assert.match(script, /gate 3\/4 schema match/);
    assert.match(script, /decideSliceEmptyTarget\(beforeCounts\)/);
    assert.match(script, /gate 4\/4 empty target/);
  });

  test("the empty-target refusal prints the fresh-database recipe", () => {
    assert.match(script, /createdb moldpilot_slice/);
    assert.match(script, /prisma migrate deploy/);
  });

  test("the dev password policy is applied through the real hasher", () => {
    assert.match(script, /from "\.\.\/src\/server\/passwords\.ts"/);
    assert.match(script, /row\.passwordHash = hashPassword\(DEV_PASSWORD\)/);
    assert.match(script, /row\.forcePasswordChange = true/);
    assert.match(script, /row\.passwordUpdatedAt = null/);
    assert.match(script, /const DEV_PASSWORD = "slice-dev-login"/);
    // Printed loudly, not buried in a comment.
    assert.match(script, /ALL \$\{passwordsSet\} USERS NOW SHARE THE PASSWORD/);
  });

  test("rows are inserted in chunks and the counts are verified afterwards", () => {
    assert.match(script, /const INSERT_CHUNK_SIZE = 500/);
    assert.match(script, /createMany\(\{ data: batch \}\)/);
    assert.match(script, /compareSliceCounts\(manifestCounts, afterCounts\)/);
    assert.match(script, /next: pnpm dev, then \/api\/health\/ready/);
  });

  test("no route or server action reaches the ingest", () => {
    const roots = ["src/app", "src/server"];
    const offenders: string[] = [];

    for (const root of roots) {
      const directory = new URL(`../../${root}/`, import.meta.url);
      const entries = readdirSync(directory, { recursive: true, encoding: "utf8" });

      for (const entry of entries) {
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
          continue;
        }
        if (/import-slice|domain\/slice/.test(readFileSync(new URL(entry, directory), "utf8"))) {
          offenders.push(path.posix.join(root, entry));
        }
      }
    }

    assert.deepEqual(offenders, [], `the ingest must stay CLI-only: ${offenders.join(", ")}`);
  });

  test("package.json exposes the documented entry point", () => {
    const packageJson = JSON.parse(repoFile("package.json")) as { scripts: Record<string, string> };
    assert.equal(packageJson.scripts["slice:import"], "node scripts/import-slice.mjs");
  });
});
