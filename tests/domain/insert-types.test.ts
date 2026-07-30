import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  insertTypeCodes,
  insertTypeFieldLabels,
  insertTypeLabel,
  insertTypeLabels,
  isInsertTypeCode,
  parseInsertTypes,
  projectInsertTypes
} from "../../src/domain/mold-trial/insert-types.ts";

describe("insert-type vocabulary", () => {
  test("every code carries both languages", () => {
    for (const code of insertTypeCodes) {
      const label = insertTypeLabels[code];
      assert.ok(label.en.length > 0, `${code} has no English label`);
      assert.ok(label.zh.length > 0, `${code} has no Chinese label`);
    }

    assert.ok(insertTypeFieldLabels.title.zh.length > 0);
    assert.ok(insertTypeFieldLabels.selectAll.zh.length > 0);
  });

  test("the code list has no duplicates and includes the shop-floor vocabulary", () => {
    assert.equal(new Set(insertTypeCodes).size, insertTypeCodes.length);
    assert.deepEqual(
      [...insertTypeCodes],
      ["IML", "IMD", "THREADED_NUT", "MAGNET", "METAL_TERMINAL", "STAMPED_METAL", "GLASS_LENS", "OTHER"]
    );
  });

  test("labels resolve for canonical codes only", () => {
    assert.equal(insertTypeLabel("MAGNET")?.zh, "磁铁");
    assert.equal(insertTypeLabel("magnet"), null);
    assert.equal(insertTypeLabel("SPRING"), null);
    assert.equal(isInsertTypeCode("OTHER"), true);
    assert.equal(isInsertTypeCode("OTHERS"), false);
  });
});

describe("parseInsertTypes", () => {
  test("keeps only allowlisted values", () => {
    assert.deepEqual(parseInsertTypes(["IML", "SPRING", "", "magnet"]), ["IML"]);
    assert.deepEqual(parseInsertTypes(["<script>", "DROP TABLE"]), []);
  });

  test("de-duplicates repeated selections", () => {
    assert.deepEqual(parseInsertTypes(["MAGNET", "MAGNET", "MAGNET"]), ["MAGNET"]);
  });

  test("returns canonical order regardless of submitted order", () => {
    assert.deepEqual(parseInsertTypes(["OTHER", "MAGNET", "IML"]), ["IML", "MAGNET", "OTHER"]);
    assert.deepEqual(parseInsertTypes([...insertTypeCodes].reverse()), [...insertTypeCodes]);
  });

  test("trims stray whitespace from posted values", () => {
    assert.deepEqual(parseInsertTypes([" THREADED_NUT ", "\tIMD"]), ["IMD", "THREADED_NUT"]);
  });

  test("no selection is an empty list, never a placeholder", () => {
    assert.deepEqual(parseInsertTypes([]), []);
    assert.deepEqual(parseInsertTypes(["", "   "]), []);
  });
});

describe("projectInsertTypes", () => {
  test("normalizes whatever the column holds", () => {
    assert.deepEqual(projectInsertTypes({ id: "p1", insertTypes: ["OTHER", "IML", "IML", "LEGACY"] }), [
      "IML",
      "OTHER"
    ]);
  });

  test("a project with no stored value reads as empty", () => {
    assert.deepEqual(projectInsertTypes({ id: "p1", insertTypes: [] }), []);
    assert.deepEqual(projectInsertTypes({ id: "p1", insertTypes: null }), []);
    // A row loaded through a Prisma client generated before the column existed.
    assert.deepEqual(projectInsertTypes({ id: "p1" }), []);
  });
});
