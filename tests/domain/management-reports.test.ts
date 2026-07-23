import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import {
  adjacentReportMonth,
  buildCountComparison,
  buildManagementReport,
  buildReportPeriods,
  managementNavigationVisibility,
  reportMonthRange,
  type ReportIssueRecord,
  type ReportProjectRecord,
  type ReportTrialRecord
} from "../../src/domain/mold-trial/management-reports.ts";
import {
  permissionDefinitions,
  roleCodes,
  roleHasDefaultPermission
} from "../../src/domain/mold-trial/permission-policy.ts";

const AS_OF = new Date("2026-07-15T04:00:00.000Z");

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function project(overrides: Partial<ReportProjectRecord> & Pick<ReportProjectRecord, "id">): ReportProjectRecord {
  return {
    id: overrides.id,
    projectCode: overrides.projectCode ?? `MP-${overrides.id}`,
    moldCode: overrides.moldCode ?? `M-${overrides.id}`,
    customerCode: overrides.customerCode ?? "C-001",
    status: overrides.status ?? "ACTIVE",
    customerTargetDate: overrides.customerTargetDate ?? null,
    currentTrialLimit: overrides.currentTrialLimit ?? 3
  };
}

function trial(
  overrides: Partial<ReportTrialRecord> & Pick<ReportTrialRecord, "id" | "moldTrialProjectId">
): ReportTrialRecord {
  return {
    id: overrides.id,
    moldTrialProjectId: overrides.moldTrialProjectId,
    trialCode: overrides.trialCode ?? "T0",
    sequenceNumber: overrides.sequenceNumber ?? 1,
    plannedDate: overrides.plannedDate ?? date("2026-07-01"),
    actualDate: overrides.actualDate ?? null,
    status: overrides.status ?? "PLANNED",
    result: overrides.result ?? null,
    countsAgainstLimit: overrides.countsAgainstLimit ?? false,
    autoMissedAt: overrides.autoMissedAt ?? null,
    autoMissedResolvedAt: overrides.autoMissedResolvedAt ?? null,
    processValueCount: overrides.processValueCount ?? 1,
    issueCount: overrides.issueCount ?? 1,
    hasQcReport: overrides.hasQcReport ?? true
  };
}

function issue(overrides: Partial<ReportIssueRecord> & Pick<ReportIssueRecord, "id" | "moldTrialProjectId">): ReportIssueRecord {
  return {
    id: overrides.id,
    moldTrialProjectId: overrides.moldTrialProjectId,
    foundAtTrialEventId: overrides.foundAtTrialEventId ?? null,
    title: overrides.title ?? `Issue ${overrides.id}`,
    issueType: overrides.issueType ?? "MOLD_DESIGN_ISSUE",
    severity: overrides.severity ?? "MEDIUM",
    status: overrides.status ?? "OPEN",
    dueDate: overrides.dueDate ?? null,
    fixSummary: overrides.fixSummary ?? null,
    fixTimeMinutes: overrides.fixTimeMinutes ?? null,
    verificationResult: overrides.verificationResult ?? null,
    closedAt: overrides.closedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    ownerUser: overrides.ownerUser ?? null,
    ownerGroup: overrides.ownerGroup ?? null,
    closedByName: overrides.closedByName ?? null
  };
}

describe("Management Reports locked metric rules", () => {
  test("builds half-open Asia/Shanghai month ranges and handles year rollover", () => {
    const july = reportMonthRange("2026-07");
    assert.equal(july.start.toISOString(), "2026-06-30T16:00:00.000Z");
    assert.equal(july.end.toISOString(), "2026-07-31T16:00:00.000Z");
    assert.equal(july.dateStart.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(july.dateEnd.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(adjacentReportMonth("2026-01", -1), "2025-12");
    assert.equal(adjacentReportMonth("2026-12", 1), "2027-01");
    assert.throws(() => reportMonthRange("2026-13"), /Invalid report month/);
  });

  test("zero previous denominator produces no prior baseline instead of Infinity", () => {
    const comparison = buildCountComparison(4, 0);
    assert.deepEqual(comparison, {
      current: 4,
      previous: 0,
      delta: 4,
      percentChange: null,
      hasPriorBaseline: false
    });
    assert.equal(Number.isFinite(buildCountComparison(8, 4).percentChange ?? Number.NaN), true);
  });

  test("completed workload includes invalid runs and de-duplicates unique molds and first T0", () => {
    const data = buildManagementReport({
      month: "2026-07",
      asOf: AS_OF,
      projects: [project({ id: "p1" }), project({ id: "p2" })],
      trials: [
        trial({
          id: "p1-t0",
          moldTrialProjectId: "p1",
          actualDate: date("2026-07-01"),
          status: "COMPLETED",
          result: "INVALID_TRIAL",
          countsAgainstLimit: false
        }),
        trial({
          id: "p1-t1",
          moldTrialProjectId: "p1",
          trialCode: "T1",
          sequenceNumber: 2,
          plannedDate: date("2026-07-02"),
          actualDate: date("2026-07-02"),
          status: "COMPLETED",
          result: "APPROVED",
          countsAgainstLimit: true
        }),
        trial({
          id: "p2-t0",
          moldTrialProjectId: "p2",
          plannedDate: date("2026-06-30"),
          actualDate: date("2026-06-30"),
          status: "COMPLETED",
          result: "APPROVED",
          countsAgainstLimit: true
        }),
        trial({ id: "planned", moldTrialProjectId: "p2", plannedDate: date("2026-07-03") }),
        trial({
          id: "cancelled",
          moldTrialProjectId: "p2",
          plannedDate: date("2026-07-04"),
          status: "CANCELLED"
        })
      ],
      issues: []
    });

    assert.equal(data.completedTrialRuns.current, 2);
    assert.equal(data.completedTrialRuns.previous, 1);
    assert.equal(data.uniqueMoldsTrialed, 1);
    assert.equal(data.newMoldsAtT0.current, 1);
    assert.equal(data.newMoldsAtT0.previous, 1);
    assert.equal(data.resultDistribution.find((row) => row.key === "INVALID_TRIAL")?.count, 1);
  });

  test("on-time rate keeps due delayed trials and excludes future, cancelled, and skipped stages", () => {
    const data = buildManagementReport({
      month: "2026-07",
      asOf: new Date("2026-07-05T04:00:00.000Z"),
      projects: [project({ id: "p1" })],
      trials: [
        trial({
          id: "ontime",
          moldTrialProjectId: "p1",
          plannedDate: date("2026-07-01"),
          actualDate: date("2026-07-01"),
          status: "COMPLETED"
        }),
        trial({ id: "delayed", moldTrialProjectId: "p1", plannedDate: date("2026-07-02"), status: "DELAYED" }),
        trial({
          id: "late",
          moldTrialProjectId: "p1",
          plannedDate: date("2026-07-04"),
          actualDate: date("2026-07-05"),
          status: "COMPLETED"
        }),
        trial({ id: "future", moldTrialProjectId: "p1", plannedDate: date("2026-07-10") }),
        trial({ id: "cancelled", moldTrialProjectId: "p1", plannedDate: date("2026-07-03"), status: "CANCELLED" }),
        trial({ id: "skipped", moldTrialProjectId: "p1", plannedDate: date("2026-07-03"), status: "SKIPPED" })
      ],
      issues: []
    });

    assert.equal(data.onTimeTrials.numerator, 1);
    assert.equal(data.onTimeTrials.denominator, 3);
    assert.ok(Math.abs((data.onTimeTrials.percent ?? 0) - 100 / 3) < 0.000001);
  });

  test("uses earliest approval for target eligibility and low-loop T0/T1 approval", () => {
    const projects = [
      project({ id: "p1", customerTargetDate: date("2026-07-03") }),
      project({ id: "p2", customerTargetDate: date("2026-07-03") }),
      project({ id: "p3" })
    ];
    const trials = [
      trial({ id: "p1-t0", moldTrialProjectId: "p1", actualDate: date("2026-07-02"), status: "COMPLETED", result: "APPROVED", countsAgainstLimit: true }),
      trial({ id: "p1-t1", moldTrialProjectId: "p1", trialCode: "T1", sequenceNumber: 2, plannedDate: date("2026-07-05"), actualDate: date("2026-07-05"), status: "COMPLETED", result: "APPROVED", countsAgainstLimit: true }),
      trial({ id: "p2-t0", moldTrialProjectId: "p2", plannedDate: date("2026-06-20"), actualDate: date("2026-06-20"), status: "COMPLETED", result: "NOT_APPROVED", countsAgainstLimit: true }),
      trial({ id: "p2-t1", moldTrialProjectId: "p2", trialCode: "T1", sequenceNumber: 2, plannedDate: date("2026-07-04"), actualDate: date("2026-07-04"), status: "COMPLETED", result: "APPROVED", countsAgainstLimit: true }),
      trial({ id: "p3-t0", moldTrialProjectId: "p3", plannedDate: date("2026-05-01"), actualDate: date("2026-05-01"), status: "COMPLETED", result: "NOT_APPROVED", countsAgainstLimit: true }),
      trial({ id: "p3-t1", moldTrialProjectId: "p3", trialCode: "T1", sequenceNumber: 2, plannedDate: date("2026-06-01"), actualDate: date("2026-06-01"), status: "COMPLETED", result: "NOT_APPROVED", countsAgainstLimit: true }),
      trial({ id: "p3-t2", moldTrialProjectId: "p3", trialCode: "T2", sequenceNumber: 3, plannedDate: date("2026-07-06"), actualDate: date("2026-07-06"), status: "COMPLETED", result: "APPROVED", countsAgainstLimit: true })
    ];
    const data = buildManagementReport({ month: "2026-07", asOf: AS_OF, projects, trials, issues: [] });

    assert.equal(data.firstApprovals, 3);
    assert.deepEqual(data.targetApprovals, { onOrBefore: 1, eligible: 2, missingTarget: 1 });
    assert.equal(data.lowLoopApprovals, 2);
  });

  test("current limit pressure excludes terminal projects and Open Critical excludes Verified/Closed", () => {
    const projects = [
      project({ id: "near", currentTrialLimit: 3 }),
      project({ id: "at", currentTrialLimit: 3 }),
      project({ id: "over", currentTrialLimit: 3 }),
      project({ id: "terminal", currentTrialLimit: 3, status: "APPROVED" })
    ];
    const trials = projects.flatMap((row) => {
      const count = row.id === "near" ? 2 : row.id === "at" ? 3 : 4;
      return Array.from({ length: count }, (_, index) =>
        trial({
          id: `${row.id}-${index}`,
          moldTrialProjectId: row.id,
          trialCode: index === 0 ? "T0" : index === 1 ? "T1" : index === 2 ? "T2" : "EXTRA",
          sequenceNumber: index + 1,
          plannedDate: date(`2026-06-${padDay(index + 1)}`),
          actualDate: date(`2026-06-${padDay(index + 1)}`),
          status: "COMPLETED",
          result: "CONDITIONAL",
          countsAgainstLimit: true
        })
      );
    });
    const issues = [
      issue({ id: "critical-open", moldTrialProjectId: "near", severity: "CRITICAL", status: "OPEN" }),
      issue({ id: "critical-verified", moldTrialProjectId: "near", severity: "CRITICAL", status: "VERIFIED" }),
      issue({ id: "critical-closed", moldTrialProjectId: "near", severity: "CRITICAL", status: "CLOSED" })
    ];
    const data = buildManagementReport({ month: "2026-07", asOf: AS_OF, projects, trials, issues });

    assert.deepEqual(
      { near: data.limitPressure.near, at: data.limitPressure.at, over: data.limitPressure.over },
      { near: 1, at: 1, over: 1 }
    );
    assert.equal(data.limitPressure.projects.some((row) => row.projectId === "terminal"), false);
    assert.equal(data.currentOpenCriticalIssues, 1);
  });

  test("issue month edges, current aging, filters, and unresolved text inputs remain auditable", () => {
    const projects = [project({ id: "p1" })];
    const issues = [
      issue({ id: "june-edge", moldTrialProjectId: "p1", createdAt: new Date("2026-06-30T15:59:59.999Z") }),
      issue({
        id: "july-edge",
        moldTrialProjectId: "p1",
        createdAt: new Date("2026-06-30T16:00:00.000Z"),
        severity: "HIGH",
        status: "IN_PROGRESS",
        issueType: "QC_DIMENSION_ISSUE",
        dueDate: date("2026-07-10"),
        ownerUser: {
          id: "u1",
          username: "gong",
          displayName: "Gong",
          chineseName: "龚工",
          roleCode: "qc",
          roleName: "QC"
        },
        ownerGroup: { id: "g1", code: "qc", name: "QC" }
      }),
      issue({
        id: "closed",
        moldTrialProjectId: "p1",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        closedAt: new Date("2026-07-02T01:00:00.000Z"),
        status: "CLOSED",
        fixSummary: "User-entered fix remains unchanged."
      })
    ];
    const data = buildManagementReport({
      month: "2026-07",
      asOf: AS_OF,
      projects,
      trials: [],
      issues,
      issueFilters: { severity: "HIGH", ownerRoleCode: "qc" }
    });

    assert.equal(data.issueHealth.createdInMonth, 1);
    assert.equal(data.issueHealth.closedInMonth, 1);
    assert.equal(data.issueHealth.currentOpenCount, 2);
    assert.equal(data.issues.length, 1);
    assert.equal(data.issues[0]?.id, "july-edge");
    assert.equal(data.issues[0]?.overdue, true);
    assert.equal(data.issues[0]?.title, "Issue july-edge");
    assert.equal(data.issues[0]?.sourceHref, "/projects/MP-p1");
    assert.equal(data.issueFilterOptions.ownerRoles[0]?.code, "qc");
  });

  test("attention includes overdue, over-limit, broken accountability, next-plan, auto-missed, and missing data", () => {
    const projects = [project({ id: "p1", currentTrialLimit: 1 })];
    const trials = [
      trial({
        id: "t0",
        moldTrialProjectId: "p1",
        actualDate: date("2026-07-01"),
        status: "COMPLETED",
        result: "NOT_APPROVED",
        countsAgainstLimit: true,
        issueCount: 0,
        processValueCount: 0,
        hasQcReport: false
      }),
      trial({
        id: "t1-auto",
        moldTrialProjectId: "p1",
        trialCode: "T1",
        sequenceNumber: 2,
        plannedDate: date("2026-07-02"),
        status: "AUTO_MISSED_REASON_REQUIRED",
        autoMissedAt: new Date("2026-07-03T04:00:00.000Z")
      })
    ];
    const issues = [
      issue({
        id: "overdue",
        moldTrialProjectId: "p1",
        severity: "HIGH",
        dueDate: date("2026-07-01")
      })
    ];
    const data = buildManagementReport({ month: "2026-07", asOf: AS_OF, projects, trials, issues });
    const kinds = new Set(data.attention.map((row) => row.kind));

    assert.equal(kinds.has("OVERDUE_ISSUE"), true);
    assert.equal(kinds.has("MISSING_ISSUE_ACCOUNTABILITY"), true);
    assert.equal(kinds.has("AUTO_MISSED"), true);
    assert.equal(kinds.has("MISSING_PROCESS_SHEET"), true);
    assert.equal(kinds.has("MISSING_QC_REPORT"), true);
    assert.equal(data.completeness.unresolvedAutoMissed, 1);
  });
});

describe("Management Reports access and navigation", () => {
  test("permission is defined under Reports and defaults only to Admin and GM", () => {
    const definition = permissionDefinitions.find((permission) => permission.code === "reports.management.view");
    assert.equal(definition?.processGroup, "Reports");
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "reports.management.view")),
      ["GM", "ADMIN"]
    );
  });

  test("non-scored managers see Reports without My Score while scored staff retain My Score", () => {
    assert.deepEqual(
      managementNavigationVisibility({
        permissionCodes: new Set(["reports.management.view", "kpi.scores.view_all"]),
        dbRoleCode: "admin",
        scoreboardEnabled: true
      }),
      { showReports: true, showMyScore: false }
    );
    assert.deepEqual(
      managementNavigationVisibility({
        permissionCodes: new Set(["reports.management.view"]),
        dbRoleCode: "pm",
        scoreboardEnabled: true
      }),
      { showReports: true, showMyScore: true }
    );
    assert.deepEqual(
      managementNavigationVisibility({
        permissionCodes: new Set(),
        dbRoleCode: "injection",
        scoreboardEnabled: true
      }),
      { showReports: false, showMyScore: true }
    );
  });

  test("report server enforces both permission gates and schema has no Report table", async () => {
    const [serverSource, schemaSource] = await Promise.all([
      readFile("src/server/management-reports.ts", "utf8"),
      readFile("prisma/schema.prisma", "utf8")
    ]);
    assert.match(serverSource, /requirePermission\(actorUserId, "reports\.management\.view"\)/);
    assert.match(serverSource, /requirePermission\(actorUserId, "kpi\.scores\.view_all"\)/);
    assert.doesNotMatch(schemaSource, /^model Report\s*\{/m);
  });

  test("route gates score loading, owns bilingual labels, preserves privacy, and contains mobile layout", async () => {
    const [pageSource, serverSource, cssSource, englishSource, chineseSource] = await Promise.all([
      readFile("src/app/reports/page.tsx", "utf8"),
      readFile("src/server/management-reports.ts", "utf8"),
      readFile("src/app/globals.css", "utf8"),
      readFile("src/i18n/locales/en.ts", "utf8"),
      readFile("src/i18n/locales/zh-CN.ts", "utf8")
    ]);

    assert.match(pageSource, /tab === "scorecards" && canViewScorecards/);
    assert.match(pageSource, /getManagementReportScorecards\(currentUser\.id/);
    assert.match(pageSource, /t\("reports\.notResolved"\)/);
    assert.match(pageSource, /href=\{row\.sourceHref\}/);
    assert.doesNotMatch(`${pageSource}\n${serverSource}`, /customerCountry|contactPerson|quoteValue|salesPipeline|communicationHistory/);
    assert.doesNotMatch(`${englishSource}\n${chineseSource}`, /Factory utilization|工厂利用率/);
    assert.match(englishSource, /"reports\.moldTrialWorkload": "Mold-trial workload"/);
    assert.match(chineseSource, /"reports\.moldTrialWorkload": "试模工作量"/);
    assert.match(chineseSource, /"reports\.notResolved": "尚未解决"/);
    assert.match(cssSource, /\.reportTableWrap\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(cssSource, /@media \(max-width:\s*430px\)[\s\S]*\.reportsShell/);
  });
});

function padDay(value: number): string {
  return String(value).padStart(2, "0");
}
