import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildMoldTrialDashboard, type MoldTrialDashboardProject } from "../../src/domain/mold-trial/dashboard.ts";
import {
  formatPartSummary,
  normalizeMoldTrialParts,
  validateIssueAffectedPart
} from "../../src/domain/mold-trial/parts.ts";

function dashboardProject(overrides: Partial<MoldTrialDashboardProject> = {}): MoldTrialDashboardProject {
  return {
    projectCode: "MP-MULTI-001",
    clientProjectRef: "MP-MULTI-001",
    customerCode: "C-001",
    partCode: "P-001-A",
    moldCode: "M-001-01",
    status: "WAITING_TRIAL",
    priority: "NORMAL",
    baseTrialLimit: 3,
    customTrialLimit: null,
    customTrialLimitReason: null,
    nextPlannedTrialDate: "2026-07-10",
    updatedAt: "2026-07-01",
    planningPm: { displayName: "Bill" },
    technicalPm: null,
    parts: [{ partCode: "P-001-A", sortOrder: 0, active: true }],
    trialEvents: [],
    trialIssues: [],
    designChanges: [],
    missedTrialEvents: [],
    ...overrides
  };
}

describe("multi-part and cavity domain rules", () => {
  test("single-part project creation still normalizes one active part row", () => {
    const result = normalizeMoldTrialParts([{ partCode: "P-014-A" }]);

    assert.equal(result.ok, true);
    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0].partCode, "P-014-A");
    assert.equal(result.parts[0].active, true);
  });

  test("multi-part project creation preserves separate part rows", () => {
    const result = normalizeMoldTrialParts([
      { partCode: "P-014-A", cavityLabel: "A", cavityCount: "1" },
      { partCode: "P-014-B", cavityLabel: "B", cavityCount: "1" }
    ]);

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.parts.map((part) => [part.partCode, part.cavityLabel, part.sortOrder]),
      [
        ["P-014-A", "A", 0],
        ["P-014-B", "B", 1]
      ]
    );
  });

  test("rejects comma-separated part-code behavior", () => {
    const result = normalizeMoldTrialParts([{ partCode: "P-014-A, P-014-B" }]);

    assert.equal(result.ok, false);
    assert.match(result.issues[0].message, /comma-separated/i);
  });

  test("TrialIssue part scope requires an affected MoldTrialPart", () => {
    const result = validateIssueAffectedPart({
      affectedScope: "Part",
      affectedPartId: null
    });

    assert.equal(result.ok, false);
    assert.equal(result.issues[0].field, "affectedPartId");
  });

  test("Mold and Multiple Parts scopes do not require a single affected part", () => {
    assert.equal(validateIssueAffectedPart({ affectedScope: "Mold" }).ok, true);
    assert.equal(
      validateIssueAffectedPart({
        affectedScope: "Multiple Parts",
        affectedCavityNote: "P-014-A cavity A and P-014-B cavity B"
      }).ok,
      true
    );
  });

  test("part summary shows primary part plus active additional count", () => {
    const summary = formatPartSummary(
      [
        { partCode: "P-014-A", sortOrder: 0, active: true },
        { partCode: "P-014-B", sortOrder: 1, active: true },
        { partCode: "P-014-C", sortOrder: 2, active: false }
      ],
      "P-014-A"
    );

    assert.equal(summary, "P-014-A +1");
  });

  test("dashboard row shows one mold-level row with primary part plus count", () => {
    const data = buildMoldTrialDashboard([
      dashboardProject({
        parts: [
          { partCode: "P-014-A", sortOrder: 0, active: true },
          { partCode: "P-014-B", sortOrder: 1, active: true },
          { partCode: "P-014-C", sortOrder: 2, active: true }
        ]
      })
    ]);

    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].partCode, "P-014-A +2");
  });
});
