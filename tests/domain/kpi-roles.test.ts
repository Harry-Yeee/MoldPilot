import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isScoredRole,
  scoredRoleCodes
} from "../../src/domain/mold-trial/kpi-rules.ts";

describe("isScoredRole — who gets a monthly scorecard", () => {
  test("scored roles (PM / Injection / Assembly / QC / Marketing) return true", () => {
    assert.equal(isScoredRole("pm"), true);
    assert.equal(isScoredRole("injection"), true);
    assert.equal(isScoredRole("assembly"), true);
    assert.equal(isScoredRole("qc"), true);
    assert.equal(isScoredRole("marketing"), true);
  });

  test("design is scored (rules registered dormant; turns on with the role)", () => {
    assert.equal(isScoredRole("design"), true);
  });

  test("ADMIN / GM / VIEWER are never scored", () => {
    assert.equal(isScoredRole("admin"), false);
    assert.equal(isScoredRole("gm"), false);
    assert.equal(isScoredRole("viewer"), false);
  });

  test("case-insensitive: display labels resolve like DB codes", () => {
    assert.equal(isScoredRole("PM"), true);
    assert.equal(isScoredRole("ADMIN"), false);
    assert.equal(isScoredRole("Injection"), true);
  });

  test("unknown role codes are not scored", () => {
    assert.equal(isScoredRole("robot"), false);
    assert.equal(isScoredRole(""), false);
  });

  test("scoredRoleCodes excludes the three non-scored roles", () => {
    assert.equal(scoredRoleCodes.includes("admin"), false);
    assert.equal(scoredRoleCodes.includes("gm"), false);
    assert.equal(scoredRoleCodes.includes("viewer"), false);
  });
});
