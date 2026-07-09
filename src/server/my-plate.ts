import type { RoleCode } from "@/domain/mold-trial/types";
import { countPhotosByIssue } from "@/domain/mold-trial/issue-photos";
import { measurementReportState } from "@/domain/mold-trial/measurement-report";
import {
  belongsToApproveDateChangesSection,
  belongsToAssemblyAcknowledgeSection,
  belongsToAssemblySelfCheckSection,
  belongsToComingUpSection,
  belongsToConfirmTrialDatesSection,
  belongsToDepartmentInboxSection,
  belongsToMyOpenIssuesSection,
  belongsToNeedsReasonSection,
  belongsToPmConfirmReadySection,
  belongsToQcReportsToUploadSection,
  belongsToReturnedDatesSection,
  comparePlateItemsByDate,
  directDepartmentInboxGroupByRole,
  isOverdue,
  type PlateIssueRecord,
  type PlateTrialRecord,
  type PlateViewer,
  type TrialStatusDbValue
} from "@/domain/mold-trial/my-plate";
import { daysBetweenProposedAndTarget, isProposedDateAfterTarget, type DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
import { compareInjectionMachineNo, formatInjectionMachineLabel } from "@/domain/mold-trial/process-sheet";
import { prisma } from "@/lib/prisma";
import { applyAutoMissedTrialsForAllProjects } from "@/server/auto-missed-trials";
import {
  issueStatusLabels,
  missedTrialReasonLabels,
  responsibleAreaLabels,
  severityLabels,
  trialCodeLabels,
  trialStatusLabels
} from "@/server/mold-trial-codecs";

const COMING_UP_WINDOW_DAYS = 7;
const QC_REPORT_WINDOW_DAYS = 14;

export type PlateOption = {
  value: string;
  label: string;
};

/** Shared identity + display fields present on every plate row. */
type PlateRowBase = {
  key: string;
  projectCode: string;
  customerShortName: string;
  moldCode: string;
  title: string;
};

export type NeedsReasonRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  statusLabel: string;
  plannedDate: string | null;
  plannedDateInput: string | null;
  overdue: boolean;
};

/** One issue photo shaped for the read-only /me gallery. */
export type MyPlatePhoto = {
  id: string;
  fileName: string;
  uploaderName: string;
  uploadedAt: string;
};

export type MyOpenIssueRow = PlateRowBase & {
  issueId: string;
  statusValue: string;
  statusLabel: string;
  severityLabel: string;
  dueDate: string | null;
  overdue: boolean;
  description: string | null;
  partCavity: string | null;
  /** Photo count for the collapsed-header chip. */
  photoCount: number;
  /** Read-only photos for the expanded card (viewing is allowed on phone). */
  photos: MyPlatePhoto[];
};

/**
 * An issue row that round-trips through the existing `updateTrialIssue` action.
 * Every current field the action re-validates is carried so the phone sheet can
 * change only the one field it owns (ack / self-check / pm-ready) and submit the
 * rest unchanged — reusing the action verbatim, no forked logic.
 */
export type IssueLifecycleRow = PlateRowBase & {
  issueId: string;
  statusValue: string;
  statusLabel: string;
  severityLabel: string;
  dueDate: string | null;
  dueDateInput: string | null;
  overdue: boolean;
  description: string | null;
  partCavity: string | null;
  // Round-trip fields for updateTrialIssue.
  ownerUsername: string | null;
  ownerGroupCode: string | null;
  affectedScope: string;
  affectedPartId: string | null;
  affectedCavityNote: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  verificationMethod: string | null;
  verificationResult: string | null;
  assemblyAcknowledgedAtInput: string | null;
  assemblyEstimatedFinishDateInput: string | null;
  assemblySelfCheckedAtInput: string | null;
  assemblySelfCheckNote: string | null;
  pmReadyConfirmedAtInput: string | null;
};

export type ComingUpRow = PlateRowBase & {
  trialCode: string;
  statusValue: TrialStatusDbValue;
  statusLabel: string;
  plannedDate: string | null;
  overdue: boolean;
  /** Small confirmation badge on the coming-up card. */
  dateConfirmationStatus: DateConfirmationStatus;
};

/** An active injection machine, shaped for the confirm-trial-date sheet select. */
export type MachineOption = {
  value: string;
  label: string;
};

/** Injection "Confirm trial dates": a planned trial awaiting confirmation. */
export type ConfirmTrialDateRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  statusValue: TrialStatusDbValue;
  statusLabel: string;
  plannedDate: string | null;
  overdue: boolean;
};

/** Marketing "Approve date changes": a trial with a proposed date awaiting a decision. */
export type ApproveDateChangeRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  plannedDate: string | null;
  proposedDate: string | null;
  customerTargetDate: string | null;
  proposedReason: string | null;
  /** Whole days from the proposed date to the customer target (target − proposed). */
  targetGapDays: number | null;
  /** True when the proposed date lands after the customer target (red styling). */
  proposedAfterTarget: boolean;
};

/** PM "Returned dates": a trial Marketing returned to the PM to re-date. */
export type ReturnedDateRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  plannedDate: string | null;
  rejectReason: string | null;
};

/** A recently completed trial that still needs its QC measurement report. */
export type QcReportToUploadRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  statusLabel: string;
  /** Actual completion date (drives sort + display). */
  actualDate: string | null;
};

export type MyPlateData = {
  needsReason: NeedsReasonRow[];
  confirmTrialDates: ConfirmTrialDateRow[];
  approveDateChanges: ApproveDateChangeRow[];
  returnedDates: ReturnedDateRow[];
  myOpenIssues: MyOpenIssueRow[];
  departmentInbox: IssueLifecycleRow[];
  assemblyAcknowledge: IssueLifecycleRow[];
  assemblySelfCheck: IssueLifecycleRow[];
  pmConfirmReady: IssueLifecycleRow[];
  comingUp: ComingUpRow[];
  qcReportsToUpload: QcReportToUploadRow[];
  totalCount: number;
  options: {
    missedTrialReasons: PlateOption[];
    responsibleAreas: PlateOption[];
    issueStatuses: PlateOption[];
    activeMachines: MachineOption[];
  };
};

function formatDate(date: Date | null): string | null {
  return date == null ? null : date.toISOString().slice(0, 10);
}

/** Midnight UTC for the day of `date` — the lower bound of the QC recency window. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Last millisecond of the day (UTC) — the upper bound of the QC recency window. */
function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function optionsFromLabels(labels: Record<string, string>): PlateOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

function partCavityLabel(part: { partCode: string; cavityLabel: string | null } | null, cavityNote: string | null): string | null {
  if (part == null) {
    return cavityNote;
  }

  const base = part.cavityLabel == null ? part.partCode : `${part.partCode} · ${part.cavityLabel}`;
  return cavityNote == null ? base : `${base} — ${cavityNote}`;
}

/**
 * Load everything on the logged-in user's plate. Runs the throttled global
 * auto-missed sweep first (same as the dashboard) so the page reflects reality,
 * then queries and maps rows through the pure section-membership functions.
 */
export async function getMyPlateData(
  viewerInput: { userId: string; roleCode: RoleCode },
  now: Date = new Date()
): Promise<MyPlateData> {
  await applyAutoMissedTrialsForAllProjects(viewerInput.userId, now);

  const viewer: PlateViewer = { userId: viewerInput.userId, roleCode: viewerInput.roleCode };

  // Owned issues are relevant for everyone; assembly/PM roles additionally need
  // the workflow-stage issues their sections act on. Each OR branch mirrors a
  // section predicate so the DB fetch stays narrow; the pure functions re-apply
  // the exact same rules for the final membership decision.
  const issueOwnershipFilters: Array<Record<string, unknown>> = [{ ownerUserId: viewer.userId }];
  const directDepartmentGroupCode = directDepartmentInboxGroupByRole[viewer.roleCode];

  if (directDepartmentGroupCode != null) {
    issueOwnershipFilters.push({
      ownerUserId: null,
      ownerGroup: { code: directDepartmentGroupCode }
    });
  }

  if (viewer.roleCode === "ASSEMBLY") {
    // Assembly acts only on issues relevant to it (assigned to me, owned by the
    // assembly group, or an assembly/fitting issue) — mirrors the action guard.
    const assemblyRelevant = {
      OR: [
        { ownerUserId: viewer.userId },
        { ownerGroup: { code: "assembly" } },
        { issueType: "ASSEMBLY_FITTING_ISSUE" as const }
      ]
    };
    // Acknowledge: not yet acknowledged.
    issueOwnershipFilters.push({ ...assemblyRelevant, assemblyAcknowledgedAt: null });
    // Self-check: acknowledged but not yet self-checked.
    issueOwnershipFilters.push({ ...assemblyRelevant, assemblyAcknowledgedAt: { not: null }, assemblySelfCheckedAt: null });
  }

  if (viewer.roleCode === "PM") {
    // Confirm-ready: self-checked but not yet confirmed ready.
    issueOwnershipFilters.push({ assemblySelfCheckedAt: { not: null }, pmReadyConfirmedAt: null });
    issueOwnershipFilters.push({
      ownerUserId: null,
      ownerGroup: { code: { in: ["pm", "planning", "technical"] } },
      moldTrialProject: {
        OR: [{ planningPmId: viewer.userId }, { technicalPmId: viewer.userId }]
      }
    });
  }

  const [trials, issues] = await Promise.all([
    prisma.trialEvent.findMany({
      where: {
        status: { in: ["PLANNED", "AT_RISK", "AUTO_MISSED_REASON_REQUIRED"] },
        moldTrialProject: {
          OR: [{ planningPmId: viewer.userId }, { technicalPmId: viewer.userId }]
        }
      },
      select: {
        id: true,
        trialCode: true,
        status: true,
        plannedDate: true,
        dateConfirmationStatus: true,
        rescheduleRejectReason: true,
        moldTrialProject: {
          select: {
            projectCode: true,
            moldCode: true,
            planningPmId: true,
            technicalPmId: true,
            customer: { select: { shortName: true } }
          }
        }
      },
      orderBy: [{ plannedDate: "asc" }]
    }),
    prisma.trialIssue.findMany({
      where: {
        status: { notIn: ["VERIFIED", "CLOSED"] },
        OR: issueOwnershipFilters
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        severity: true,
        issueType: true,
        ownerUserId: true,
        dueDate: true,
        affectedScope: true,
        affectedPartId: true,
        affectedCavityNote: true,
        rootCause: true,
        correctiveAction: true,
        verificationMethod: true,
        verificationResult: true,
        assemblyAcknowledgedAt: true,
        assemblyEstimatedFinishDate: true,
        assemblySelfCheckedAt: true,
        assemblySelfCheckNote: true,
        pmReadyConfirmedAt: true,
        ownerUser: { select: { username: true } },
        ownerGroup: { select: { code: true } },
        affectedPart: { select: { partCode: true, cavityLabel: true } },
        moldTrialProject: {
          select: {
            projectCode: true,
            moldCode: true,
            planningPmId: true,
            technicalPmId: true,
            customer: { select: { shortName: true } }
          }
        }
      },
      orderBy: [{ dueDate: "asc" }]
    })
  ]);

  // Photos for the fetched issues (read-only /me gallery + collapsed-header chip).
  const fetchedIssueIds = issues.map((issue) => issue.id);
  const issuePhotoRows =
    fetchedIssueIds.length === 0
      ? []
      : await prisma.fileAttachment.findMany({
          where: {
            entityType: "TRIAL_ISSUE",
            entityId: { in: fetchedIssueIds },
            fileType: "TRIAL_PHOTO",
            deletedAt: null
          },
          select: {
            id: true,
            entityId: true,
            fileName: true,
            uploadedAt: true,
            uploadedBy: { select: { displayName: true } }
          },
          orderBy: [{ uploadedAt: "asc" }]
        });

  const photoCountsByIssue = countPhotosByIssue(issuePhotoRows.map((photo) => ({ issueId: photo.entityId })));
  const photosByIssue = new Map<string, MyPlatePhoto[]>();
  for (const photo of issuePhotoRows) {
    const list = photosByIssue.get(photo.entityId) ?? [];
    list.push({
      id: photo.id,
      fileName: photo.fileName,
      uploaderName: photo.uploadedBy.displayName,
      uploadedAt: photo.uploadedAt.toISOString()
    });
    photosByIssue.set(photo.entityId, list);
  }

  const needsReason: NeedsReasonRow[] = [];
  const comingUp: ComingUpRow[] = [];
  const returnedDates: ReturnedDateRow[] = [];

  for (const trial of trials) {
    const project = trial.moldTrialProject;
    const record: PlateTrialRecord = {
      status: trial.status,
      plannedDate: trial.plannedDate,
      dateConfirmationStatus: trial.dateConfirmationStatus,
      projectPlanningPmId: project.planningPmId,
      projectTechnicalPmId: project.technicalPmId
    };
    const base: PlateRowBase = {
      key: trial.id,
      projectCode: project.projectCode,
      customerShortName: project.customer.shortName,
      moldCode: project.moldCode,
      title: `${trialCodeLabels[trial.trialCode]} trial`
    };

    if (belongsToNeedsReasonSection(viewer, record)) {
      needsReason.push({
        ...base,
        trialEventId: trial.id,
        trialCode: trialCodeLabels[trial.trialCode],
        statusLabel: trialStatusLabels[trial.status],
        plannedDate: formatDate(trial.plannedDate),
        plannedDateInput: formatDate(trial.plannedDate),
        overdue: isOverdue(trial.plannedDate, now)
      });
    }

    if (belongsToReturnedDatesSection(viewer, record)) {
      returnedDates.push({
        ...base,
        trialEventId: trial.id,
        trialCode: trialCodeLabels[trial.trialCode],
        plannedDate: formatDate(trial.plannedDate),
        rejectReason: trial.rescheduleRejectReason
      });
    }

    if (belongsToComingUpSection(viewer, record, now, COMING_UP_WINDOW_DAYS)) {
      comingUp.push({
        ...base,
        trialCode: trialCodeLabels[trial.trialCode],
        statusValue: trial.status as TrialStatusDbValue,
        statusLabel: trialStatusLabels[trial.status],
        plannedDate: formatDate(trial.plannedDate),
        overdue: isOverdue(trial.plannedDate, now),
        dateConfirmationStatus: trial.dateConfirmationStatus
      });
    }
  }

  // Injection "Confirm trial dates" and Marketing "Approve date changes" are not
  // PM-scoped (Injection serves every project's machines; Marketing owns the
  // customer target date), so they use a separate cross-project fetch narrowed to
  // planned/at-risk trials in the relevant handshake state. Active machines feed
  // the confirm sheet's machine select.
  const confirmTrialDates: ConfirmTrialDateRow[] = [];
  const approveDateChanges: ApproveDateChangeRow[] = [];
  let activeMachines: MachineOption[] = [];

  if (viewer.roleCode === "INJECTION" || viewer.roleCode === "MARKETING") {
    const confirmationStatus: DateConfirmationStatus =
      viewer.roleCode === "INJECTION" ? "PENDING_CONFIRMATION" : "RESCHEDULE_PROPOSED";

    const [confirmationTrials, machines] = await Promise.all([
      prisma.trialEvent.findMany({
        where: {
          status: { in: ["PLANNED", "AT_RISK"] },
          dateConfirmationStatus: confirmationStatus
        },
        select: {
          id: true,
          trialCode: true,
          status: true,
          plannedDate: true,
          dateConfirmationStatus: true,
          proposedDate: true,
          proposedReason: true,
          moldTrialProject: {
            select: {
              projectCode: true,
              moldCode: true,
              planningPmId: true,
              technicalPmId: true,
              customerTargetDate: true,
              customer: { select: { shortName: true } }
            }
          }
        },
        orderBy: [{ plannedDate: "asc" }]
      }),
      viewer.roleCode === "INJECTION"
        ? prisma.injectionMachine.findMany({
            where: { active: true },
            select: { id: true, machineNo: true, displayName: true, model: true, brand: true, tonnage: true }
          })
        : Promise.resolve([])
    ]);

    activeMachines = [...machines]
      .sort(compareInjectionMachineNo)
      .map((machine) => ({ value: machine.id, label: formatInjectionMachineLabel(machine) }));

    for (const trial of confirmationTrials) {
      const project = trial.moldTrialProject;
      const record: PlateTrialRecord = {
        status: trial.status,
        plannedDate: trial.plannedDate,
        dateConfirmationStatus: trial.dateConfirmationStatus,
        projectPlanningPmId: project.planningPmId,
        projectTechnicalPmId: project.technicalPmId
      };
      const base: PlateRowBase = {
        key: trial.id,
        projectCode: project.projectCode,
        customerShortName: project.customer.shortName,
        moldCode: project.moldCode,
        title: `${trialCodeLabels[trial.trialCode]} trial`
      };

      if (belongsToConfirmTrialDatesSection(viewer, record)) {
        confirmTrialDates.push({
          ...base,
          trialEventId: trial.id,
          trialCode: trialCodeLabels[trial.trialCode],
          statusValue: trial.status as TrialStatusDbValue,
          statusLabel: trialStatusLabels[trial.status],
          plannedDate: formatDate(trial.plannedDate),
          overdue: isOverdue(trial.plannedDate, now)
        });
      }

      if (belongsToApproveDateChangesSection(viewer, record)) {
        approveDateChanges.push({
          ...base,
          trialEventId: trial.id,
          trialCode: trialCodeLabels[trial.trialCode],
          plannedDate: formatDate(trial.plannedDate),
          proposedDate: formatDate(trial.proposedDate),
          customerTargetDate: formatDate(project.customerTargetDate),
          proposedReason: trial.proposedReason,
          targetGapDays: daysBetweenProposedAndTarget(trial.proposedDate, project.customerTargetDate),
          proposedAfterTarget: isProposedDateAfterTarget(trial.proposedDate, project.customerTargetDate)
        });
      }
    }
  }

  const myOpenIssues: MyOpenIssueRow[] = [];
  const departmentInbox: IssueLifecycleRow[] = [];
  const assemblyAcknowledge: IssueLifecycleRow[] = [];
  const assemblySelfCheck: IssueLifecycleRow[] = [];
  const pmConfirmReady: IssueLifecycleRow[] = [];

  for (const issue of issues) {
    const project = issue.moldTrialProject;
    const record: PlateIssueRecord = {
      status: issue.status,
      ownerUserId: issue.ownerUserId,
      issueType: issue.issueType,
      ownerGroupCode: issue.ownerGroup?.code ?? null,
      assemblyAcknowledgedAt: issue.assemblyAcknowledgedAt,
      assemblySelfCheckedAt: issue.assemblySelfCheckedAt,
      pmReadyConfirmedAt: issue.pmReadyConfirmedAt,
      projectPlanningPmId: project.planningPmId,
      projectTechnicalPmId: project.technicalPmId
    };
    const base: PlateRowBase = {
      key: issue.id,
      projectCode: project.projectCode,
      customerShortName: project.customer.shortName,
      moldCode: project.moldCode,
      title: issue.title
    };
    const cavity = partCavityLabel(issue.affectedPart, issue.affectedCavityNote);

    if (belongsToMyOpenIssuesSection(viewer, record)) {
      myOpenIssues.push({
        ...base,
        issueId: issue.id,
        statusValue: issue.status,
        statusLabel: issueStatusLabels[issue.status],
        severityLabel: severityLabels[issue.severity],
        dueDate: formatDate(issue.dueDate),
        overdue: isOverdue(issue.dueDate, now),
        description: issue.description,
        partCavity: cavity,
        photoCount: photoCountsByIssue.get(issue.id) ?? 0,
        photos: photosByIssue.get(issue.id) ?? []
      });
    }

    const lifecycleRow: IssueLifecycleRow = {
      ...base,
      issueId: issue.id,
      statusValue: issue.status,
      statusLabel: issueStatusLabels[issue.status],
      severityLabel: severityLabels[issue.severity],
      dueDate: formatDate(issue.dueDate),
      dueDateInput: formatDate(issue.dueDate),
      overdue: isOverdue(issue.dueDate, now),
      description: issue.description,
      partCavity: cavity,
      ownerUsername: issue.ownerUser?.username ?? null,
      ownerGroupCode: issue.ownerGroup?.code ?? null,
      affectedScope: issue.affectedScope,
      affectedPartId: issue.affectedPartId,
      affectedCavityNote: issue.affectedCavityNote,
      rootCause: issue.rootCause,
      correctiveAction: issue.correctiveAction,
      verificationMethod: issue.verificationMethod,
      verificationResult: issue.verificationResult,
      assemblyAcknowledgedAtInput: formatDate(issue.assemblyAcknowledgedAt),
      assemblyEstimatedFinishDateInput: formatDate(issue.assemblyEstimatedFinishDate),
      assemblySelfCheckedAtInput: formatDate(issue.assemblySelfCheckedAt),
      assemblySelfCheckNote: issue.assemblySelfCheckNote,
      pmReadyConfirmedAtInput: formatDate(issue.pmReadyConfirmedAt)
    };

    if (belongsToDepartmentInboxSection(viewer, record)) {
      departmentInbox.push(lifecycleRow);
    }

    if (belongsToAssemblyAcknowledgeSection(viewer, record)) {
      assemblyAcknowledge.push(lifecycleRow);
    }

    if (belongsToAssemblySelfCheckSection(viewer, record)) {
      assemblySelfCheck.push(lifecycleRow);
    }

    if (belongsToPmConfirmReadySection(viewer, record)) {
      pmConfirmReady.push(lifecycleRow);
    }
  }

  // "QC: reports to upload" — only QC users see it. Recently completed (or
  // pending-follow-up) trials from the last 14 days that still have no live
  // measurement report. The DB filter narrows to eligible statuses + the recency
  // window (mirroring the pure predicate); the report-state join then drops any
  // trial that already has a report.
  const qcReportsToUpload: QcReportToUploadRow[] = [];

  if (viewer.roleCode === "QC") {
    const windowStart = new Date(startOfUtcDay(now));
    windowStart.setUTCDate(windowStart.getUTCDate() - QC_REPORT_WINDOW_DAYS);

    const completedTrials = await prisma.trialEvent.findMany({
      where: {
        status: { in: ["COMPLETED", "PENDING_FOLLOW_UP"] },
        actualDate: { gte: windowStart, lte: endOfUtcDay(now) }
      },
      select: {
        id: true,
        trialCode: true,
        sequenceNumber: true,
        status: true,
        plannedDate: true,
        actualDate: true,
        moldTrialProject: {
          select: {
            id: true,
            projectCode: true,
            moldCode: true,
            planningPmId: true,
            technicalPmId: true,
            customer: { select: { shortName: true } }
          }
        }
      },
      orderBy: [{ actualDate: "asc" }]
    });

    const completedTrialIds = completedTrials.map((trial) => trial.id);
    const reportRows =
      completedTrialIds.length === 0
        ? []
        : await prisma.fileAttachment.findMany({
            where: {
              entityType: "TRIAL_EVENT",
              entityId: { in: completedTrialIds },
              fileType: "QC_REPORT",
              deletedAt: null
            },
            select: {
              id: true,
              entityType: true,
              entityId: true,
              fileType: true,
              deletedAt: true,
              uploadedAt: true
            }
          });

    const reportsByTrial = new Map<string, typeof reportRows>();
    for (const report of reportRows) {
      const list = reportsByTrial.get(report.entityId) ?? [];
      list.push(report);
      reportsByTrial.set(report.entityId, list);
    }

    for (const trial of completedTrials) {
      const project = trial.moldTrialProject;
      const record: PlateTrialRecord = {
        status: trial.status,
        plannedDate: trial.plannedDate,
        actualDate: trial.actualDate,
        projectPlanningPmId: project.planningPmId,
        projectTechnicalPmId: project.technicalPmId
      };

      if (!belongsToQcReportsToUploadSection(viewer, record, now, QC_REPORT_WINDOW_DAYS)) {
        continue;
      }

      const state = measurementReportState(
        { status: trial.status },
        trial.id,
        (reportsByTrial.get(trial.id) ?? []).map((report) => ({
          id: report.id,
          entityType: report.entityType,
          entityId: report.entityId,
          fileType: report.fileType,
          deletedAt: report.deletedAt,
          uploadedAt: report.uploadedAt,
          uploaderName: "",
          visibility: ""
        }))
      );

      if (state.kind !== "MISSING") {
        continue;
      }

      qcReportsToUpload.push({
        key: trial.id,
        projectCode: project.projectCode,
        customerShortName: project.customer.shortName,
        moldCode: project.moldCode,
        title: `${trialCodeLabels[trial.trialCode]} trial`,
        trialEventId: trial.id,
        trialCode: trialCodeLabels[trial.trialCode],
        statusLabel: trialStatusLabels[trial.status],
        actualDate: formatDate(trial.actualDate)
      });
    }
  }

  // "Recent to future": sort every section explicitly (oldest / most overdue
  // first, null dates last) so the rule is testable and not reliant on SQL
  // orderBy. Trial sections sort by plannedDate; issue sections by dueDate.
  needsReason.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  confirmTrialDates.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  approveDateChanges.sort((a, b) => comparePlateItemsByDate({ date: a.proposedDate }, { date: b.proposedDate }));
  returnedDates.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  comingUp.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  myOpenIssues.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  departmentInbox.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  assemblyAcknowledge.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  assemblySelfCheck.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  pmConfirmReady.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  qcReportsToUpload.sort((a, b) => comparePlateItemsByDate({ date: a.actualDate }, { date: b.actualDate }));

  const totalCount =
    needsReason.length +
    confirmTrialDates.length +
    approveDateChanges.length +
    returnedDates.length +
    myOpenIssues.length +
    departmentInbox.length +
    assemblyAcknowledge.length +
    assemblySelfCheck.length +
    pmConfirmReady.length +
    comingUp.length +
    qcReportsToUpload.length;

  return {
    needsReason,
    confirmTrialDates,
    approveDateChanges,
    returnedDates,
    myOpenIssues,
    departmentInbox,
    assemblyAcknowledge,
    assemblySelfCheck,
    pmConfirmReady,
    comingUp,
    qcReportsToUpload,
    totalCount,
    options: {
      missedTrialReasons: optionsFromLabels(missedTrialReasonLabels),
      responsibleAreas: optionsFromLabels(responsibleAreaLabels),
      issueStatuses: optionsFromLabels(issueStatusLabels),
      activeMachines
    }
  };
}
