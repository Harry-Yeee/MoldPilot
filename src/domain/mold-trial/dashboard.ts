import { evaluateTrialLimit } from "./trial-limit.ts";
import { formatPartSummary } from "./parts.ts";
import { formatMoldWorkingIdentifier } from "./identifiers.ts";
import {
  canUploadMeasurementReport,
  newestMeasurementReport,
  type MeasurementReportAttachment
} from "./measurement-report.ts";
import type { TrialStatusDbValue } from "./my-plate.ts";
import type { DesignChangeEvent, TrialEvent, TrialLimitState } from "./types.ts";

export type DatabaseProjectStatus =
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

export type DatabasePriority = "NORMAL" | "HIGH" | "CRITICAL";
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
export type DatabaseTrialResult =
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
    /** Trial event id, used to match measurement-report attachments to the trial. */
    id?: string;
    trialCode: DatabaseTrialCode;
    sequenceNumber: number;
    plannedDate: DateValue;
    actualDate: DateValue;
    status: DatabaseTrialStatus;
    result: DatabaseTrialResult | null;
    outcomeDisposition: DatabaseTrialOutcomeDisposition | null;
    countsAgainstLimit: boolean;
  }>;
  /**
   * Non-deleted QC_REPORT attachments filed against this project's trial events
   * (entityType TRIAL_EVENT), used to flag completed trials still missing their
   * measurement report. Optional so callers/tests that do not care about report
   * tracking can omit it (treated as "no reports uploaded").
   */
  measurementReports?: MeasurementReportAttachment[];
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
  clientProjectRef: string | null;
  customerCode: string;
  partCode: string;
  moldCode: string | null;
  statusCode: DatabaseProjectStatus;
  status: string;
  priorityCode: DatabasePriority;
  priority: string;
  planningPm: string | null;
  technicalPm: string | null;
  nextTrial:
    | { kind: "WAITING_T0_SCHEDULE"; sequenceNumber: null }
    | { kind: "NO_TRIAL_PLANNED"; sequenceNumber: null }
    | { kind: "COMPLETED"; sequenceNumber: number }
    | { kind: "PLANNED"; sequenceNumber: number };
  nextPlannedDate: string | null;
  assemblyReadyDate: string | null;
  completedTrialCount: number;
  currentTrialLimit: number;
  trialCountLabel: string;
  warningState: TrialLimitState;
  openIssueCount: number;
  criticalOpenIssueCount: number;
  lastTrialResult: DatabaseTrialResult | null;
  lastUpdate: string | null;
  limitBasis: "DEFAULT" | "CUSTOM_PM" | "DESIGN_CHANGE";
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
  completedTrialsMissingReportCount: number;
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

function formatDate(value: DateValue): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
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
    const limitBasis: MoldTrialDashboardRow["limitBasis"] = project.customTrialLimit != null
      ? "CUSTOM_PM"
      : limit.designChangeExtraTrialCount > 0
        ? "DESIGN_CHANGE"
        : "DEFAULT";
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
      clientProjectRef: project.clientProjectRef,
      customerCode: project.customerCode,
      partCode: formatPartSummary(project.parts ?? [], project.partCode),
      moldCode: project.moldCode.trim().length === 0 ? null : project.moldCode,
      statusCode: project.status,
      status: projectStatusLabels[project.status],
      priorityCode: project.priority,
      priority: priorityLabels[project.priority],
      planningPm: project.planningPm?.displayName ?? null,
      technicalPm: project.technicalPm?.displayName ?? null,
      nextTrial: project.status === "INTAKE"
        ? { kind: "WAITING_T0_SCHEDULE" as const, sequenceNumber: null }
        : nextPlannedTrial == null
        ? lastCompletedTrial == null
          ? { kind: "NO_TRIAL_PLANNED" as const, sequenceNumber: null }
          : { kind: "COMPLETED" as const, sequenceNumber: lastCompletedTrial.sequenceNumber }
        : { kind: "PLANNED" as const, sequenceNumber: nextPlannedTrial.sequenceNumber },
      nextPlannedDate: formatDate(project.nextPlannedTrialDate ?? nextPlannedTrial?.plannedDate ?? null),
      assemblyReadyDate: formatDate(assemblyReadyDate),
      completedTrialCount: limit.completedTrialCount,
      currentTrialLimit: limit.currentTrialLimit,
      trialCountLabel: `${limit.completedTrialCount} / ${limit.currentTrialLimit}`,
      warningState: limit.warningState,
      openIssueCount,
      criticalOpenIssueCount,
      lastTrialResult: lastCompletedTrial?.result ?? null,
      lastUpdate: formatDate(project.updatedAt),
      limitBasis
    };
  });

  return {
    rows,
    summary: {
      intakeProjectCount: projects.filter((project) => project.status === "INTAKE").length,
      activeMoldCount: projects.filter((project) => project.status !== "CANCELLED" && project.status !== "CLOSED").length,
      upcomingTrialCount: rows.filter((row) => row.nextPlannedDate != null).length,
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
      ),
      completedTrialsMissingReportCount: projects.reduce(
        (count, project) => count + countCompletedTrialsMissingReport(project),
        0
      )
    }
  };
}

/**
 * Completed (or pending-follow-up) trials on a project that still have no
 * non-deleted measurement report. A trial without an id can never be matched to
 * a report, so it is conservatively counted as missing. Trials in other statuses
 * do not require a report and are ignored.
 */
function countCompletedTrialsMissingReport(project: MoldTrialDashboardProject): number {
  const reports = project.measurementReports ?? [];

  return project.trialEvents.filter((trial) => {
    if (!canUploadMeasurementReport(trial.status as TrialStatusDbValue)) {
      return false;
    }
    if (trial.id == null) {
      return true;
    }
    return newestMeasurementReport(reports, trial.id) == null;
  }).length;
}
