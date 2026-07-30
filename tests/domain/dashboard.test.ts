import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildMoldTrialDashboard } from "../../src/domain/mold-trial/dashboard.ts";
import type { MoldTrialDashboardProject } from "../../src/domain/mold-trial/dashboard.ts";

const baseProject = {
  clientProjectRef: "MP-REF-001",
  customerCode: "C-027",
  partCode: "P-001-A",
  moldCode: "M-001-01",
  priority: "NORMAL",
  baseTrialLimit: 3,
  customTrialLimit: null,
  customTrialLimitReason: null,
  nextPlannedTrialDate: null,
  updatedAt: "2026-06-24T08:00:00.000Z",
  planningPm: { displayName: "Planning PM" },
  technicalPm: { displayName: "Technical PM" },
  trialIssues: [],
  designChanges: [],
  missedTrialEvents: []
} satisfies Omit<MoldTrialDashboardProject, "projectCode" | "status" | "trialEvents">;

function completedTrial(sequenceNumber: number): MoldTrialDashboardProject["trialEvents"][number] {
  const code = sequenceNumber === 1 ? "T0" : sequenceNumber === 2 ? "T1" : sequenceNumber === 3 ? "T2" : "EXTRA";

  return {
    trialCode: code,
    sequenceNumber,
    plannedDate: `2026-06-${String(sequenceNumber).padStart(2, "0")}`,
    actualDate: `2026-06-${String(sequenceNumber).padStart(2, "0")}`,
    status: "COMPLETED",
    result: "APPROVED",
    outcomeDisposition: "APPROVED_COMPLETE",
    countsAgainstLimit: true
  };
}

describe("dashboard summary", () => {
  test("AT-020 dashboard counts match project records", () => {
    const data = buildMoldTrialDashboard([
      {
        ...baseProject,
        projectCode: "MP-SEED-001",
        status: "WAITING_TRIAL",
        nextPlannedTrialDate: "2026-07-03",
        trialEvents: [
          {
            trialCode: "T0",
            sequenceNumber: 1,
            plannedDate: "2026-07-03",
            actualDate: null,
            status: "PLANNED",
            result: null,
            outcomeDisposition: null,
            countsAgainstLimit: false
          }
        ]
      },
      {
        ...baseProject,
        projectCode: "MP-SEED-002",
        status: "TRIAL_DELAYED",
        trialEvents: [
          {
            trialCode: "T0",
            sequenceNumber: 1,
            plannedDate: "2026-06-10",
            actualDate: null,
            status: "DELAYED",
            result: null,
            outcomeDisposition: null,
            countsAgainstLimit: false
          }
        ],
        missedTrialEvents: [{ id: "missed-1" }]
      },
      {
        ...baseProject,
        projectCode: "MP-SEED-006",
        status: "WAITING_TRIAL",
        trialEvents: [completedTrial(1), completedTrial(2)]
      },
      {
        ...baseProject,
        projectCode: "MP-SEED-007",
        status: "WAITING_VERIFICATION",
        trialEvents: [completedTrial(1), completedTrial(2), completedTrial(3)]
      },
      {
        ...baseProject,
        projectCode: "MP-SEED-008",
        status: "OVER_LIMIT",
        trialEvents: [completedTrial(1), completedTrial(2), completedTrial(3), completedTrial(4)],
        trialIssues: [
          {
            severity: "CRITICAL",
            status: "WAITING_VERIFICATION",
            assemblyAcknowledgedAt: "2026-06-10",
            assemblyEstimatedFinishDate: "2026-06-16",
            pmReadyConfirmedAt: null
          }
        ]
      },
      {
        ...baseProject,
        projectCode: "MP-INTAKE-001",
        status: "INTAKE",
        planningPm: null,
        trialEvents: []
      },
      {
        ...baseProject,
        projectCode: "MP-SEED-005",
        status: "ACTIVE",
        trialEvents: [
          {
            ...completedTrial(1),
            status: "PENDING_FOLLOW_UP",
            outcomeDisposition: "PENDING_CUSTOMER_FEEDBACK"
          }
        ]
      }
    ]);

    assert.equal(data.summary.intakeProjectCount, 1);
    assert.equal(data.summary.upcomingTrialCount, 1);
    assert.equal(data.summary.delayedTrialCount, 1);
    assert.equal(data.summary.nearLimitCount, 1);
    assert.equal(data.summary.atLimitCount, 1);
    assert.equal(data.summary.overLimitCount, 1);
    assert.equal(data.summary.openCriticalIssueCount, 1);
    assert.equal(data.summary.pendingFollowUpCount, 1);
    assert.deepEqual(data.rows.find((row) => row.projectCode === "MP-INTAKE-001")?.nextTrial, {
      kind: "WAITING_T0_SCHEDULE",
      sequenceNumber: null
    });
    assert.equal(data.rows.find((row) => row.projectCode === "MP-SEED-005")?.trialCountLabel, "1 / 3");
    assert.equal(data.rows.find((row) => row.projectCode === "MP-SEED-008")?.assemblyReadyDate, "2026-06-16");
  });

  test("counts completed trials missing a measurement report", () => {
    const data = buildMoldTrialDashboard([
      {
        ...baseProject,
        projectCode: "MP-REPORT-001",
        status: "WAITING_VERIFICATION",
        // Two completed trials; only trial "t1" has a live report.
        trialEvents: [
          { ...completedTrial(1), id: "t1" },
          { ...completedTrial(2), id: "t2" }
        ],
        measurementReports: [
          {
            id: "rep-1",
            entityType: "TRIAL_EVENT",
            entityId: "t1",
            fileType: "QC_REPORT",
            deletedAt: null,
            uploadedAt: new Date("2026-06-05T00:00:00.000Z"),
            uploaderName: "Gong",
            visibility: "CUSTOMER_SAFE"
          }
        ]
      },
      {
        ...baseProject,
        projectCode: "MP-REPORT-002",
        status: "ACTIVE",
        // Pending-follow-up is eligible and has no report -> missing.
        trialEvents: [
          {
            ...completedTrial(1),
            id: "t3",
            status: "PENDING_FOLLOW_UP",
            outcomeDisposition: "PENDING_CUSTOMER_FEEDBACK"
          }
        ]
      },
      {
        ...baseProject,
        projectCode: "MP-REPORT-003",
        status: "WAITING_TRIAL",
        // A planned trial never needs a report.
        trialEvents: [
          {
            trialCode: "T0",
            sequenceNumber: 1,
            plannedDate: "2026-07-03",
            actualDate: null,
            status: "PLANNED",
            result: null,
            outcomeDisposition: null,
            countsAgainstLimit: false
          }
        ]
      }
    ]);

    // t2 (no report) + t3 (pending-follow-up, no report) = 2; t1 has a report; planned ignored.
    assert.equal(data.summary.completedTrialsMissingReportCount, 2);
  });

  test("a soft-deleted report leaves its completed trial counted as missing", () => {
    const data = buildMoldTrialDashboard([
      {
        ...baseProject,
        projectCode: "MP-REPORT-004",
        status: "WAITING_VERIFICATION",
        trialEvents: [{ ...completedTrial(1), id: "t9" }],
        measurementReports: [
          {
            id: "rep-9",
            entityType: "TRIAL_EVENT",
            entityId: "t9",
            fileType: "QC_REPORT",
            deletedAt: new Date("2026-06-06T00:00:00.000Z"),
            uploadedAt: new Date("2026-06-05T00:00:00.000Z"),
            uploaderName: "Gong",
            visibility: "CUSTOMER_SAFE"
          }
        ]
      }
    ]);

    assert.equal(data.summary.completedTrialsMissingReportCount, 1);
  });

  test("uses mold code as primary identifier once present and falls back to tracking id for blank intake", () => {
    const data = buildMoldTrialDashboard([
      {
        ...baseProject,
        projectCode: "MP-TRK-20260701-ABC123",
        clientProjectRef: null,
        moldCode: "",
        status: "INTAKE",
        trialEvents: []
      },
      {
        ...baseProject,
        projectCode: "MP-TRK-20260701-DEF456",
        clientProjectRef: "CLIENT-42",
        moldCode: "M-CLIENT-42",
        status: "WAITING_TRIAL",
        trialEvents: []
      }
    ]);

    assert.equal(data.rows[0].workingIdentifier, "MP-TRK-20260701-ABC123");
    assert.equal(data.rows[0].moldCode, null);
    assert.equal(data.rows[0].clientProjectRef, null);
    assert.equal(data.rows[1].workingIdentifier, "M-CLIENT-42");
    assert.equal(data.rows[1].clientProjectRef, "CLIENT-42");
  });
});
