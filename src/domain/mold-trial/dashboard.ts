import { evaluateTrialLimit } from "./trial-limit.ts";
import { formatPartSummary } from "./parts.ts";
import { formatMoldWorkingIdentifier, formatOptionalIdentifier } from "./identifiers.ts";
import { trialStageLabel } from "./trial-panel.ts";
import type { DesignChangeEvent, TrialEvent, TrialLimitState } from "./types.ts";

type DatabaseProjectStatus =
  | "INTAKE"
  | "ACTIVE"
  | "WAITING_TRIAL"
  | "TRIAL_DELAYED"
  | "IN_CORRECTION"
  | "WAITING_VERIFICATION"
  | "APPROVED"
  | "OVER_LIMIT"
  | "BLOCKED"
  | "PAUSED"
  | "CANCELLED"
  | "CLOSED";

type DatabasePriority = "NORMAL" | "HIGH" | "CRITICAL";
type DatabaseTrialCode = "T0" | "T1" | "T2" | "EXTRA" | "OTHER";
type DatabaseTrialStatus =
  | "PLANNED"
  | "AT_RISK"
  | "AUTO_MISSED_REASON_REQUIRED"
  | "DELAYED"
  | "COMPLETED"
  | "PENDING_FOLLOW_UP"
  | "ABORTED"
  | "CANCELLED"
  | "SKIPPED";
type DatabaseTrialResult =
  | "APPROVED"
  | "NOT_APPROVED"
  | "CONDITIONAL"
  | "PENDING_QC"
  | "PENDING_CUSTOMER_FEEDBACK"
  | "INVALID_TRIAL";
type DatabaseTrialOutcomeDisposition =
  | "APPROVED_COMPLETE"
  | "APPROVED_WITH_MINOR_ITEMS"
  | "REWORK_REQUIRED"
  | "PENDING_QC"
  | "PENDING_CUSTOMER_FEEDBACK"
  | "ABORTED_INVALID_TRIAL";
type DatabaseSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DatabaseIssueStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_INTERNAL"
  | "WAITING_CUSTOMER"
  | "WAITING_SUPPLIER"
  | "WAITING_VERIFICATION"
  | "VERIFIED"
  | "CLOSED";

type DateValue = Date | string | null;

export type MoldTrialDashboardProject = {
  projectCode: string;
  clientProjectRef: string | null;
  customerCode: string;
  partCode: string;
  moldCode: string;
  status: DatabaseProjectStatus;
  priority: DatabasePriority;
  baseTrialLimit: number;
  customTrialLimit: number | null;
  customTrialLimitReason: string | null;
  nextPlannedTrialDate: DateValue;
  updatedAt: DateValue;
  planningPm: {
    displayName: string;
  } | null;
  technicalPm: {
    displayName: string;
  } | null;
  parts?: Array<{
    partCode: string;
    sortOrder: number;
    active: boolean;
  }>;
  trialEvents: Array<{
    trialCode: DatabaseTrialCode;
    sequenceNumber: number;
    plannedDate: DateValue;
    actualDate: DateValue;
    status: DatabaseTrialStatus;
    result: DatabaseTrialResult | null;
    outcomeDisposition: DatabaseTrialOutcomeDisposition | null;
    countsAgainstLimit: boolean;
  }>;
  trialIssues: Array<{
    severity: DatabaseSeverity;
    status: DatabaseIssueStatus;
    assemblyEstimatedFinishDate: DateValue;
    assemblyAcknowledgedAt: DateValue;
    pmReadyConfirmedAt: DateValue;
  }>;
  designChanges: Array<{
    firstCompletedTrialAlreadyDone: boolean;
    grantsExtraTrial: boolean;
    extraTrialCount: number | null;
    approvedById: string | null;
    approvalReason: string | null;
  }>;
  missedTrialEvents: Array<{
    id: string;
  }>;
};

export type MoldTrialDashboardRow = {
  projectCode: string;
  workingIdentifier: string;
  clientProjectRef: string;
  customerCode: string;
  partCode: string;
  moldCode: string;
  status: string;
  priority: string;
  planningPm: string;
  technicalPm: string;
  nextTrial: string;
  nextPlannedDate: string;
  assemblyReadyDate: string;
  trialCountLabel: string;
  warningState: TrialLimitState;
  openIssueCount: number;
  criticalOpenIssueCount: number;
  lastTrialResult: string;
  lastUpdate: string;
  limitNote: string;
};

export type MoldTrialDashboardSummary = {
  intakeProjectCount: number;
  activeMoldCount: number;
  upcomingTrialCount: number;
  delayedTrialCount: number;
  completedTrialCount: number;
  nearLimitCount: number;
  atLimitCount: number;
  overLimitCount: number;
  openCriticalIssueCount: number;
  pendingFollowUpCount: number;
};

export type MoldTrialDashboardData = {
  rows: MoldTrialDashboardRow[];
  summary: MoldTrialDashboardSummary;
};

const projectStatusLabels: Record<DatabaseProjectStatus, string> = {
  INTAKE: "Intake",
  ACTIVE: "Active",
  WAITING_TRIAL: "Waiting Trial",
  TRIAL_DELAYED: "Trial Delayed",
  IN_CORRECTION: "In Correction",
  WAITING_VERIFICATION: "Waiting Verification",
  APPROVED: "Approved",
  OVER_LIMIT: "Over Limit",
  BLOCKED: "Blocked",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
  CLOSED: "Closed"
};

const priorityLabels: Record<DatabasePriority, string> = {
  NORMAL: "Normal",
  HIGH: "High",
  CRITICAL: "Critical"
};

const trialCodeLabels: Record<DatabaseTrialCode, TrialEvent["trialCode"]> = {
  T0: "T0",
  T1: "T1",
  T2: "T2",
  EXTRA: "Extra",
  OTHER: "Other"
};

const trialStatusLabels: Record<DatabaseTrialStatus, TrialEvent["status"]> = {
  PLANNED: "Planned",
  AT_RISK: "At Risk",
  AUTO_MISSED_REASON_REQUIRED: "Auto Missed - Reason Required",
  DELAYED: "Delayed",
  COMPLETED: "Completed",
  PENDING_FOLLOW_UP: "Pending Follow-Up",
  ABORTED: "Aborted",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped"
};

const trialResultLabels: Record<DatabaseTrialResult, string> = {
  APPROVED: "Approved",
  CONDITIONAL: "Conditional",
  NOT_APPROVED: "Not Approved / Rework Required",
  PENDING_QC: "Pending QC",
  PENDING_CUSTOMER_FEEDBACK: "Pending Customer Feedback",
  INVALID_TRIAL: "Invalid Trial"
};

function formatDate(value: DateValue): string {
  if (value == null) {
    return "Not planned";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not planned";
  }

  return date.toISOString().slice(0, 10);
}

function isOpenIssue(status: DatabaseIssueStatus): boolean {
  return status !== "CLOSED";
}

function isCriticalIssue(severity: DatabaseSeverity): boolean {
  return severity === "HIGH" || severity === "CRITICAL";
}

function mapTrialEvent(trialEvent: MoldTrialDashboardProject["trialEvents"][number]): TrialEvent {
  return {
    trialCode: trialCodeLabels[trialEvent.trialCode],
    plannedDate: trialEvent.plannedDate,
    actualDate: trialEvent.actualDate,
    status: trialStatusLabels[trialEvent.status],
    result: trialEvent.result == null ? null : trialResultLabels[trialEvent.result] as TrialEvent["result"],
    countsAgainstLimit: trialEvent.countsAgainstLimit
  };
}

function mapDesignChange(change: MoldTrialDashboardProject["designChanges"][number]): DesignChangeEvent {
  return {
    firstCompletedTrialAlreadyDone: change.firstCompletedTrialAlreadyDone,
    grantsExtraTrial: change.grantsExtraTrial,
    extraTrialCount: change.extraTrialCount,
    approvedById: change.approvedById,
    approvalReason: change.approvalReason
  };
}

function comparePlannedTrials(
  left: MoldTrialDashboardProject["trialEvents"][number],
  right: MoldTrialDashboardProject["trialEvents"][number]
): number {
  const leftDate = left.plannedDate == null ? Number.MAX_SAFE_INTEGER : new Date(left.plannedDate).getTime();
  const rightDate = right.plannedDate == null ? Number.MAX_SAFE_INTEGER : new Date(right.plannedDate).getTime();

  return leftDate - rightDate || left.sequenceNumber - right.sequenceNumber;
}

function compareCompletedTrials(
  left: MoldTrialDashboardProject["trialEvents"][number],
  right: MoldTrialDashboardProject["trialEvents"][number]
): number {
  const leftDate = left.actualDate == null ? 0 : new Date(left.actualDate).getTime();
  const rightDate = right.actualDate == null ? 0 : new Date(right.actualDate).getTime();

  return rightDate - leftDate || right.sequenceNumber - left.sequenceNumber;
}

export function buildMoldTrialDashboard(projects: readonly MoldTrialDashboardProject[]): MoldTrialDashboardData {
  const rows = projects.map((project) => {
    const trialEvents = project.trialEvents.map(mapTrialEvent);
    const designChanges = project.designChanges.map(mapDesignChange);
    const limit = evaluateTrialLimit({
      baseTrialLimit: project.baseTrialLimit,
      customTrialLimit: project.customTrialLimit,
      customTrialLimitReason: project.customTrialLimitReason,
      trialEvents,
      designChanges
    });
    const openIssueCount = project.trialIssues.filter((issue) => isOpenIssue(issue.status)).length;
    const criticalOpenIssueCount = project.trialIssues.filter(
      (issue) => isOpenIssue(issue.status) && isCriticalIssue(issue.severity)
    ).length;
    const nextPlannedTrial = project.trialEvents
      .filter((trial) => trial.status === "PLANNED" || trial.status === "AT_RISK")
      .sort(comparePlannedTrials)[0];
    const lastCompletedTrial = project.trialEvents
      .filter((trial) => trial.status === "COMPLETED")
      .sort(compareCompletedTrials)[0];
    const limitNote = project.customTrialLimit != null
      ? "Custom PM Limit"
      : limit.designChangeExtraTrialCount > 0
        ? "Design Change Allowance"
        : "Default Limit";
    const assemblyReadyDate = project.trialIssues
      .filter((issue) => isOpenIssue(issue.status) && issue.pmReadyConfirmedAt == null)
      .map((issue) => issue.assemblyEstimatedFinishDate)
      .filter((date): date is Date | string => date != null)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;

    return {
      projectCode: project.projectCode,
      workingIdentifier: formatMoldWorkingIdentifier({
        projectCode: project.projectCode,
        clientProjectRef: project.clientProjectRef,
        moldCode: project.moldCode
      }),
      clientProjectRef: formatOptionalIdentifier(project.clientProjectRef),
      customerCode: project.customerCode,
      partCode: formatPartSummary(project.parts ?? [], project.partCode),
      moldCode: formatOptionalIdentifier(project.moldCode),
      status: projectStatusLabels[project.status],
      priority: priorityLabels[project.priority],
      planningPm: project.planningPm?.displayName ?? "Unassigned",
      technicalPm: project.technicalPm?.displayName ?? "Unassigned",
      nextTrial: project.status === "INTAKE"
        ? "Waiting T0 schedule"
        : nextPlannedTrial == null
        ? lastCompletedTrial == null
          ? "No trial planned"
          : `${trialStageLabel(lastCompletedTrial.sequenceNumber)} completed`
        : `${trialStageLabel(nextPlannedTrial.sequenceNumber)} planned`,
      nextPlannedDate: formatDate(project.nextPlannedTrialDate ?? nextPlannedTrial?.plannedDate ?? null),
      assemblyReadyDate: formatDate(assemblyReadyDate),
      trialCountLabel: `${limit.completedTrialCount} / ${limit.currentTrialLimit}`,
      warningState: limit.warningState,
      openIssueCount,
      criticalOpenIssueCount,
      lastTrialResult: lastCompletedTrial?.result == null ? "Not recorded" : trialResultLabels[lastCompletedTrial.result],
      lastUpdate: formatDate(project.updatedAt),
      limitNote
    };
  });

  return {
    rows,
    summary: {
      intakeProjectCount: projects.filter((project) => project.status === "INTAKE").length,
      activeMoldCount: projects.filter((project) => project.status !== "CANCELLED" && project.status !== "CLOSED").length,
      upcomingTrialCount: rows.filter((row) => row.nextPlannedDate !== "Not planned").length,
      delayedTrialCount: projects.filter((project) =>
        project.status === "TRIAL_DELAYED" ||
        project.missedTrialEvents.length > 0 ||
        project.trialEvents.some((trial) => trial.status === "DELAYED" || trial.status === "AUTO_MISSED_REASON_REQUIRED")
      ).length,
      completedTrialCount: projects.reduce(
        (count, project) => count + project.trialEvents.filter((trial) => trial.status === "COMPLETED").length,
        0
      ),
      nearLimitCount: rows.filter((row) => row.warningState === "Near Limit").length,
      atLimitCount: rows.filter((row) => row.warningState === "At Limit").length,
      overLimitCount: rows.filter((row) => row.warningState === "Over Limit").length,
      openCriticalIssueCount: rows.reduce((count, row) => count + row.criticalOpenIssueCount, 0),
      pendingFollowUpCount: projects.reduce(
        (count, project) =>
          count +
          project.trialEvents.filter(
            (trial) =>
              trial.status === "PENDING_FOLLOW_UP" ||
              trial.outcomeDisposition === "PENDING_QC" ||
              trial.outcomeDisposition === "PENDING_CUSTOMER_FEEDBACK"
          ).length,
        0
      )
    }
  };
}
