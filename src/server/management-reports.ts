import {
  buildManagementReport,
  currentReportMonth,
  isReportMonth,
  type ManagementIssueFilters,
  type ManagementReportData
} from "@/domain/mold-trial/management-reports";
import { prisma } from "@/lib/prisma";
import { computeMonthlyScores, loadKpiRuleLabels, type MonthlyScores } from "@/server/kpi-scores";
import { requirePermission } from "@/server/permissions";

export type ManagementReportQuery = {
  month?: string | null;
  asOf?: Date;
  issueFilters?: ManagementIssueFilters;
};

export type ManagementReportScorecards = {
  scores: MonthlyScores;
  ruleLabels: Record<string, { en: string; zh: string }>;
};

function selectedReportMonth(month: string | null | undefined, asOf: Date): string {
  if (month == null || month.length === 0) {
    return currentReportMonth(asOf);
  }
  if (!isReportMonth(month)) {
    throw new Error("Invalid report month. Use YYYY-MM.");
  }
  return month;
}

export async function getManagementReportData(
  actorUserId: string,
  query: ManagementReportQuery = {}
): Promise<ManagementReportData> {
  await requirePermission(actorUserId, "reports.management.view");

  const asOf = query.asOf ?? new Date();
  const month = selectedReportMonth(query.month, asOf);
  const [projects, trials, issues, qcReports] = await Promise.all([
    prisma.moldTrialProject.findMany({
      select: {
        id: true,
        projectCode: true,
        moldCode: true,
        customerCode: true,
        status: true,
        customerTargetDate: true,
        currentTrialLimit: true
      }
    }),
    prisma.trialEvent.findMany({
      select: {
        id: true,
        moldTrialProjectId: true,
        trialCode: true,
        sequenceNumber: true,
        plannedDate: true,
        actualDate: true,
        status: true,
        result: true,
        countsAgainstLimit: true,
        autoMissedAt: true,
        autoMissedResolvedAt: true,
        _count: {
          select: {
            processValues: true,
            issuesFound: true
          }
        }
      }
    }),
    prisma.trialIssue.findMany({
      select: {
        id: true,
        moldTrialProjectId: true,
        foundAtTrialEventId: true,
        title: true,
        issueType: true,
        severity: true,
        status: true,
        dueDate: true,
        fixSummary: true,
        fixTimeMinutes: true,
        verificationResult: true,
        closedAt: true,
        createdAt: true,
        ownerUser: {
          select: {
            id: true,
            username: true,
            displayName: true,
            chineseName: true,
            role: {
              select: {
                code: true,
                name: true
              }
            }
          }
        },
        ownerGroup: {
          select: {
            id: true,
            code: true,
            name: true
          }
        },
        closedBy: {
          select: {
            displayName: true,
            chineseName: true
          }
        }
      }
    }),
    prisma.fileAttachment.findMany({
      where: {
        entityType: "TRIAL_EVENT",
        fileType: "QC_REPORT",
        deletedAt: null
      },
      select: { entityId: true }
    })
  ]);

  const trialsWithQcReports = new Set(qcReports.map((report) => report.entityId));

  return buildManagementReport({
    month,
    asOf,
    projects: projects.map((project) => ({
      ...project,
      status: project.status
    })),
    trials: trials.map((trial) => ({
      id: trial.id,
      moldTrialProjectId: trial.moldTrialProjectId,
      trialCode: trial.trialCode,
      sequenceNumber: trial.sequenceNumber,
      plannedDate: trial.plannedDate,
      actualDate: trial.actualDate,
      status: trial.status,
      result: trial.result,
      countsAgainstLimit: trial.countsAgainstLimit,
      autoMissedAt: trial.autoMissedAt,
      autoMissedResolvedAt: trial.autoMissedResolvedAt,
      processValueCount: trial._count.processValues,
      issueCount: trial._count.issuesFound,
      hasQcReport: trialsWithQcReports.has(trial.id)
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      moldTrialProjectId: issue.moldTrialProjectId,
      foundAtTrialEventId: issue.foundAtTrialEventId,
      title: issue.title,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      dueDate: issue.dueDate,
      fixSummary: issue.fixSummary,
      fixTimeMinutes: issue.fixTimeMinutes,
      verificationResult: issue.verificationResult,
      closedAt: issue.closedAt,
      createdAt: issue.createdAt,
      ownerUser:
        issue.ownerUser == null
          ? null
          : {
              id: issue.ownerUser.id,
              username: issue.ownerUser.username,
              displayName: issue.ownerUser.displayName,
              chineseName: issue.ownerUser.chineseName,
              roleCode: issue.ownerUser.role.code,
              roleName: issue.ownerUser.role.name
            },
      ownerGroup: issue.ownerGroup,
      closedByName:
        issue.closedBy == null
          ? null
          : issue.closedBy.chineseName == null
            ? issue.closedBy.displayName
            : `${issue.closedBy.displayName} / ${issue.closedBy.chineseName}`
    })),
    issueFilters: query.issueFilters
  });
}

export async function getManagementReportScorecards(
  actorUserId: string,
  query: { month?: string | null; asOf?: Date } = {}
): Promise<ManagementReportScorecards> {
  await requirePermission(actorUserId, "reports.management.view");
  await requirePermission(actorUserId, "kpi.scores.view_all");

  const asOf = query.asOf ?? new Date();
  const month = selectedReportMonth(query.month, asOf);
  const [scores, ruleLabels] = await Promise.all([
    computeMonthlyScores(month, asOf),
    loadKpiRuleLabels()
  ]);
  return { scores, ruleLabels };
}
