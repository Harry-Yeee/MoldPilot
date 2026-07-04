import type { RoleCode } from "@/domain/mold-trial/types";
import {
  belongsToAssemblyAcknowledgeSection,
  belongsToAssemblySelfCheckSection,
  belongsToComingUpSection,
  belongsToDepartmentInboxSection,
  belongsToMyOpenIssuesSection,
  belongsToNeedsReasonSection,
  belongsToPmConfirmReadySection,
  comparePlateItemsByDate,
  isOverdue,
  type PlateIssueRecord,
  type PlateTrialRecord,
  type PlateViewer,
  type TrialStatusDbValue
} from "@/domain/mold-trial/my-plate";
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

export type MyOpenIssueRow = PlateRowBase & {
  issueId: string;
  statusValue: string;
  statusLabel: string;
  severityLabel: string;
  dueDate: string | null;
  overdue: boolean;
  description: string | null;
  partCavity: string | null;
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
};

export type MyPlateData = {
  needsReason: NeedsReasonRow[];
  myOpenIssues: MyOpenIssueRow[];
  departmentInbox: IssueLifecycleRow[];
  assemblyAcknowledge: IssueLifecycleRow[];
  assemblySelfCheck: IssueLifecycleRow[];
  pmConfirmReady: IssueLifecycleRow[];
  comingUp: ComingUpRow[];
  totalCount: number;
  options: {
    missedTrialReasons: PlateOption[];
    responsibleAreas: PlateOption[];
    issueStatuses: PlateOption[];
  };
};

function formatDate(date: Date | null): string | null {
  return date == null ? null : date.toISOString().slice(0, 10);
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
  const directDepartmentGroupCodeByRole: Partial<Record<RoleCode, string>> = {
    ASSEMBLY: "assembly",
    INJECTION: "injection",
    MARKETING: "marketing",
    QC: "qc"
  };

  // Owned issues are relevant for everyone; assembly/PM roles additionally need
  // the workflow-stage issues their sections act on. Each OR branch mirrors a
  // section predicate so the DB fetch stays narrow; the pure functions re-apply
  // the exact same rules for the final membership decision.
  const issueOwnershipFilters: Array<Record<string, unknown>> = [{ ownerUserId: viewer.userId }];
  const directDepartmentGroupCode = directDepartmentGroupCodeByRole[viewer.roleCode];

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

  const needsReason: NeedsReasonRow[] = [];
  const comingUp: ComingUpRow[] = [];

  for (const trial of trials) {
    const project = trial.moldTrialProject;
    const record: PlateTrialRecord = {
      status: trial.status,
      plannedDate: trial.plannedDate,
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

    if (belongsToComingUpSection(viewer, record, now, COMING_UP_WINDOW_DAYS)) {
      comingUp.push({
        ...base,
        trialCode: trialCodeLabels[trial.trialCode],
        statusValue: trial.status as TrialStatusDbValue,
        statusLabel: trialStatusLabels[trial.status],
        plannedDate: formatDate(trial.plannedDate),
        overdue: isOverdue(trial.plannedDate, now)
      });
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
        partCavity: cavity
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

  // "Recent to future": sort every section explicitly (oldest / most overdue
  // first, null dates last) so the rule is testable and not reliant on SQL
  // orderBy. Trial sections sort by plannedDate; issue sections by dueDate.
  needsReason.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  comingUp.sort((a, b) => comparePlateItemsByDate({ date: a.plannedDate }, { date: b.plannedDate }));
  myOpenIssues.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  departmentInbox.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  assemblyAcknowledge.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  assemblySelfCheck.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  pmConfirmReady.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));

  const totalCount =
    needsReason.length +
    myOpenIssues.length +
    departmentInbox.length +
    assemblyAcknowledge.length +
    assemblySelfCheck.length +
    pmConfirmReady.length +
    comingUp.length;

  return {
    needsReason,
    myOpenIssues,
    departmentInbox,
    assemblyAcknowledge,
    assemblySelfCheck,
    pmConfirmReady,
    comingUp,
    totalCount,
    options: {
      missedTrialReasons: optionsFromLabels(missedTrialReasonLabels),
      responsibleAreas: optionsFromLabels(responsibleAreaLabels),
      issueStatuses: optionsFromLabels(issueStatusLabels)
    }
  };
}
