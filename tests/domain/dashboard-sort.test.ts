import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sortDashboardRows } from "../../src/domain/mold-trial/dashboard-sort.ts";
import type { MoldTrialDashboardRow } from "../../src/domain/mold-trial/dashboard.ts";

const baseRow = {
  workingIdentifier: "M-001",
  clientProjectRef: "MP-001",
  customerCode: "C-001",
  partCode: "P-001",
  moldCode: "M-001",
  status: "Waiting Trial",
  priority: "Normal",
  planningPm: "Planning PM",
  technicalPm: "Technical PM",
  nextTrial: "T0 planned",
  nextPlannedDate: "2026-07-01",
  assemblyReadyDate: "Not planned",
  trialCountLabel: "0 / 3",
  warningState: "Healthy",
  openIssueCount: 0,
  criticalOpenIssueCount: 0,
  lastTrialResult: "Not recorded",
  lastUpdate: "2026-06-24",
  limitNote: "Default Limit"
} satisfies Omit<MoldTrialDashboardRow, "projectCode">;

function row(
  projectCode: string,
  overrides: Partial<Omit<MoldTrialDashboardRow, "projectCode">> = {}
): MoldTrialDashboardRow {
  return {
    ...baseRow,
    ...overrides,
    projectCode
  };
}

describe("dashboard row sorting", () => {
  test("sorts project codes with natural alphanumeric order", () => {
    const rows = [
      row("MP-10"),
      row("MP-2"),
      row("MP-1")
    ];

    assert.deepEqual(
      sortDashboardRows(rows, { key: "projectCode", direction: "asc" }).map((item) => item.projectCode),
      ["MP-1", "MP-2", "MP-10"]
    );
    assert.deepEqual(
      sortDashboardRows(rows, { key: "projectCode", direction: "desc" }).map((item) => item.projectCode),
      ["MP-10", "MP-2", "MP-1"]
    );
  });

  test("sorts client project refs with natural alphanumeric order", () => {
    const rows = [
      row("TRK-1", { clientProjectRef: "REF-10" }),
      row("TRK-2", { clientProjectRef: "REF-2" }),
      row("TRK-3", { clientProjectRef: "REF-1" })
    ];

    assert.deepEqual(
      sortDashboardRows(rows, { key: "clientProjectRef", direction: "asc" }).map((item) => item.clientProjectRef),
      ["REF-1", "REF-2", "REF-10"]
    );
  });

  test("sorts warning state by workflow urgency", () => {
    const rows = [
      row("MP-001", { warningState: "Healthy" }),
      row("MP-002", { warningState: "At Limit" }),
      row("MP-003", { warningState: "Near Limit" }),
      row("MP-004", { warningState: "Over Limit" })
    ];

    assert.deepEqual(
      sortDashboardRows(rows, { key: "warningState", direction: "desc" }).map((item) => item.warningState),
      ["Over Limit", "At Limit", "Near Limit", "Healthy"]
    );
    assert.deepEqual(
      sortDashboardRows(rows, { key: "warningState", direction: "asc" }).map((item) => item.warningState),
      ["Healthy", "Near Limit", "At Limit", "Over Limit"]
    );
  });

  test("sorts numeric issue columns without text ordering drift", () => {
    const rows = [
      row("MP-001", { openIssueCount: 2 }),
      row("MP-002", { openIssueCount: 10 }),
      row("MP-003", { openIssueCount: 1 })
    ];

    assert.deepEqual(
      sortDashboardRows(rows, { key: "openIssueCount", direction: "desc" }).map((item) => item.projectCode),
      ["MP-002", "MP-001", "MP-003"]
    );
  });
});
