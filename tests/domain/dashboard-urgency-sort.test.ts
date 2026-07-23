import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareByUrgency,
  sortDashboardRows,
  urgencyTier
} from "../../src/domain/mold-trial/dashboard-sort.ts";
import type { MoldTrialDashboardRow } from "../../src/domain/mold-trial/dashboard.ts";

function row(overrides: Partial<MoldTrialDashboardRow>): MoldTrialDashboardRow {
  return {
    projectCode: "MP-000",
    workingIdentifier: "M-000",
    clientProjectRef: "Not set",
    customerCode: "C-000",
    partCode: "P-000",
    moldCode: "M-000",
    status: "Active",
    priority: "Normal",
    planningPm: "PM",
    technicalPm: "PM",
    nextTrial: "T1 planned",
    nextPlannedDate: "2026-07-10",
    assemblyReadyDate: "Not planned",
    trialCountLabel: "1 / 3",
    warningState: "Healthy",
    openIssueCount: 0,
    criticalOpenIssueCount: 0,
    lastTrialResult: "Not recorded",
    lastUpdate: "2026-07-01",
    limitNote: "Default Limit",
    ...overrides
  };
}

describe("urgencyTier", () => {
  test("missed tone (tier 0) from project status", () => {
    assert.equal(urgencyTier(row({ status: "Trial Delayed" })), 0);
    assert.equal(urgencyTier(row({ status: "Blocked" })), 0);
  });

  test("missed tone (tier 0) from trial-limit warning state", () => {
    assert.equal(urgencyTier(row({ status: "Active", warningState: "Over Limit" })), 0);
  });

  test("at-risk tone (tier 1) from status or warning state", () => {
    assert.equal(urgencyTier(row({ status: "At Risk" })), 1);
    assert.equal(urgencyTier(row({ status: "Active", warningState: "Near Limit" })), 1);
    assert.equal(urgencyTier(row({ status: "Active", warningState: "At Limit" })), 1);
  });

  test("everything else is tier 2", () => {
    assert.equal(urgencyTier(row({ status: "Active", warningState: "Healthy" })), 2);
    assert.equal(urgencyTier(row({ status: "Completed" })), 2);
  });
});

describe("compareByUrgency / sortDashboardRows urgency default", () => {
  test("missed first, then at-risk, then rest; date ascending within tier", () => {
    const missedLate = row({ projectCode: "A", status: "Trial Delayed", nextPlannedDate: "2026-07-05" });
    const missedEarly = row({ projectCode: "B", status: "Delayed", nextPlannedDate: "2026-07-02" });
    const atRisk = row({ projectCode: "C", status: "At Risk", nextPlannedDate: "2026-07-01" });
    const healthy = row({ projectCode: "D", status: "Active", nextPlannedDate: "2026-06-30" });

    const sorted = sortDashboardRows([healthy, atRisk, missedLate, missedEarly], {
      key: "urgency",
      direction: "desc"
    });

    assert.deepEqual(
      sorted.map((r) => r.projectCode),
      ["B", "A", "C", "D"]
    );
  });

  test("comparator is a pure total order (undated rows sort last within tier)", () => {
    const dated = row({ projectCode: "X", status: "Active", nextPlannedDate: "2026-07-01" });
    const undated = row({ projectCode: "Y", status: "Active", nextPlannedDate: "Not planned" });

    assert.ok(compareByUrgency(dated, undated) < 0);
    assert.ok(compareByUrgency(undated, dated) > 0);
    assert.equal(compareByUrgency(dated, dated), 0);
  });
});
