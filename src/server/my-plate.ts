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
  belongsToDesignRevisionsSection,
  belongsToMyOpenIssuesSection,
  belongsToNeedsReasonSection,
  belongsToPmConfirmReadySection,
  belongsToQcReportsToUploadSection,
  belongsToReturnedDatesSection,
  assemblyGroupCodesForViewer,
  comparePlateItemsByDate,
  departmentInboxGroupCodesForViewer,
  isOverdue,
  type PlateDesignChangeRecord,
  type PlateIssueRecord,
  type PlateTrialRecord,
  type PlateViewer,
  type TrialStatusDbValue
} from "@/domain/mold-trial/my-plate";
import { daysBetweenProposedAndTarget, isProposedDateAfterTarget, type DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
import {
  compareByCountdownUrgency,
  computeDeadline,
  remainingHours,
  trialCountdown,
  type TrialUrgencySource
} from "@/domain/mold-trial/deadline-countdown";
import type { KpiRuleCode } from "@/domain/mold-trial/kpi-rules";
import type { ScoringRule } from "@/domain/mold-trial/kpi-scoring";
import { compareInjectionMachineNo, formatInjectionMachineLabel } from "@/domain/mold-trial/process-sheet";
import { trialStageLabel } from "@/domain/mold-trial/trial-panel";
import { prisma } from "@/lib/prisma";
import { applyAutoMissedTrialsForAllProjects } from "@/server/auto-missed-trials";
import {
  anchorForAcknowledge,
  anchorForDateConfirmation,
  anchorForDateDecision,
  anchorForDesignRevision,
  anchorForInboxClaim,
  anchorForMissedReason,
  anchorForReportUpload,
  anchorForReturnedRedate,
  loadRuleConfig
} from "@/server/kpi-events";
import {
  changeRequesterLabels,
  issueStatusLabels,
  missedTrialReasonLabels,
  responsibleAreaLabels,
  severityLabels,
  trialStatusLabels
} from "@/server/mold-trial-codecs";

const COMING_UP_WINDOW_DAYS = 7;
const QC_REPORT_WINDOW_DAYS = 14;
/**
 * Assembly self-check has no hours rule; its soft deadline is the NEXT planned
 * trial. The chip only appears once that trial falls inside this window.
 */
const SELF_CHECK_WINDOW_HOURS = 72;

/**
 * A precomputed deadline countdown for a task card, frozen at request time
 * (pages are force-dynamic; the client only formats — it never ticks). The rule
 * hours come from the live KpiRule table, so admin edits show up on next load.
 * A row with no `deadline` shows no chip (rule inactive or anchor unavailable —
 * never a guessed deadline).
 */
export type PlateDeadline = {
  /** The timed rule this deadline enforces (drives the tooltip label). */
  ruleCode: KpiRuleCode;
  /** The live hours window from the KpiRule table (tooltip "<H>h"). */
  ruleHours: number;
  /** Signed hours remaining until due; negative = overdue. Drives text/tone/sort. */
  remainingHours: number;
};

/**
 * The Assembly self-check chip: no hours rule, so the "deadline" is the next
 * planned trial's date. Rendered as "before next trial · <date>".
 */
export type SelfCheckDeadline = {
  /** The next planned trial's date (YYYY-MM-DD). */
  nextTrialDate: string;
  /** Signed hours remaining until that date; negative = overdue. Drives tone/sort. */
  remainingHours: number;
};

/**
 * The trial-deadline chip on an OPEN issue card: "距试模 X天 · MMM d".
 *
 * Display-only urgency — nothing here touches KPI scoring. It exists because an
 * issue's own due date says nothing about the wall everybody actually works to,
 * which is the next trial: a fix that lands the morning after the mold is on the
 * machine is a wasted trial. Present only when the project HAS an upcoming
 * planned trial.
 */
export type TrialDeadline = {
  /** The next planned trial's date (YYYY-MM-DD) — the chip's suffix. */
  trialDate: string;
  /** Signed hours until that trial; drives the chip text. */
  trialHours: number;
  /** Signed hours until the earlier of the issue due date and the trial; drives tone. */
  urgencyHours: number;
  /** Which date set the urgency. */
  urgencySource: TrialUrgencySource;
};

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
  /** pm.missed_reason countdown (anchor: autoMissedAt); null when no chip. */
  deadline: PlateDeadline | null;
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
  /** "距试模 X天 · MMM d" chip; null when the project has no upcoming trial. */
  trialDeadline: TrialDeadline | null;
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
  /**
   * Timed-rule countdown for this row's section (all.inbox_claim for the
   * department inbox, asm.acknowledge for acknowledge); null when no chip.
   */
  deadline: PlateDeadline | null;
  /** Assembly self-check "before next trial" chip; null except in that section. */
  selfCheckDeadline: SelfCheckDeadline | null;
  /**
   * "距试模 X天 · MMM d" chip; null when the project has no upcoming trial. Not
   * set on the self-check section, which already carries `selfCheckDeadline`
   * saying the same thing — one trial statement per card.
   */
  trialDeadline: TrialDeadline | null;
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
  /** inj.date_confirm countdown (anchor: trial createdAt); null when no chip. */
  deadline: PlateDeadline | null;
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
  /** mkt.date_decision countdown (anchor: proposal ActivityLog); null when no chip. */
  deadline: PlateDeadline | null;
};

/** PM "Returned dates": a trial Marketing returned to the PM to re-date. */
export type ReturnedDateRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  plannedDate: string | null;
  rejectReason: string | null;
  /** pm.returned_redate countdown (anchor: rescheduleDecisionAt); null when no chip. */
  deadline: PlateDeadline | null;
};

/** A recently completed trial that still needs its QC measurement report. */
export type QcReportToUploadRow = PlateRowBase & {
  trialEventId: string;
  trialCode: string;
  statusLabel: string;
  /** Actual completion date (drives sort + display). */
  actualDate: string | null;
  /** qc.report_upload countdown (anchor: result-recorded ActivityLog); null when no chip. */
  deadline: PlateDeadline | null;
};

/**
 * Design "revisions": a design-change event still awaiting its first DRAWING.
 * The primary action uploads a DRAWING straight onto the DESIGN_CHANGE_EVENT
 * (reusing the generic `uploadAttachment` action), which clears the card.
 */
export type DesignRevisionRow = PlateRowBase & {
  designChangeEventId: string;
  /** Project UUID for the upload form's projectId field (not the display code). */
  projectId: string;
  requesterLabel: string;
  changeDate: string | null;
  createdDate: string | null;
  /** design.change_revision countdown (anchor: event createdAt); null when no chip. */
  deadline: PlateDeadline | null;
};

export type MyPlateData = {
  needsReason: NeedsReasonRow[];
  confirmTrialDates: ConfirmTrialDateRow[];
  approveDateChanges: ApproveDateChangeRow[];
  returnedDates: ReturnedDateRow[];
  myOpenIssues: MyOpenIssueRow[];
  departmentInbox: IssueLifecycleRow[];
  designRevisions: DesignRevisionRow[];
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
 * Turn a rule anchor into a card countdown using the LIVE rule config. Returns
 * null (no chip) when the rule is inactive, boolean (no hours), or the anchor is
 * unavailable — matching the scoring engine's "exclude rather than guess" rule.
 * `dueAt` is `computeDeadline(anchor, hours)`, the SAME math the scorer uses, so
 * the chip and the on-time verdict can never diverge.
 */
function ruleCountdown(
  ruleCode: KpiRuleCode,
  anchor: Date | null,
  ruleByCode: Map<KpiRuleCode, ScoringRule>,
  now: Date
): PlateDeadline | null {
  const rule = ruleByCode.get(ruleCode);
  if (rule == null || !rule.active || rule.hours == null || anchor == null) {
    return null;
  }
  return {
    ruleCode,
    ruleHours: rule.hours,
    remainingHours: remainingHours(computeDeadline(anchor, rule.hours), now)
  };
}

/**
 * The Assembly self-check chip: no hours rule, so measure against the next
 * planned trial's date. Shown only once that trial is inside the 72h window
 * (overdue included); null otherwise (or when there is no upcoming trial).
 */
function selfCheckCountdown(nextTrialDate: Date | null | undefined, now: Date): SelfCheckDeadline | null {
  if (nextTrialDate == null) {
    return null;
  }
  const remaining = remainingHours(nextTrialDate, now);
  if (remaining >= SELF_CHECK_WINDOW_HOURS) {
    return null;
  }
  return { nextTrialDate: nextTrialDate.toISOString().slice(0, 10), remainingHours: remaining };
}

/**
 * The trial-deadline chip for an open issue: hours to the project's next planned
 * trial, toned by whichever comes first — that trial or the issue's own due
 * date. Unlike the self-check chip there is NO window: an issue is measured
 * against its trial from the day the trial is planned, because "close it before
 * the mold goes on the machine" is true the whole time, not only in the last
 * 72 hours. Null when the project has no upcoming planned trial.
 */
function trialDeadlineFor(
  dueDate: Date | null,
  nextTrialDate: Date | null | undefined,
  now: Date
): TrialDeadline | null {
  const countdown = trialCountdown({ dueDate, nextTrialDate: nextTrialDate ?? null }, now);

  if (countdown == null || nextTrialDate == null) {
    return null;
  }

  return {
    trialDate: nextTrialDate.toISOString().slice(0, 10),
    trialHours: countdown.trialHours,
    urgencyHours: countdown.urgencyHours,
    urgencySource: countdown.urgencySource
  };
}

/** Sort key for a standard-countdown row (most urgent first, no-chip rows last). */
function urgencyOf(row: { deadline: PlateDeadline | null }): { remainingHours: number | null } {
  return { remainingHours: row.deadline?.remainingHours ?? null };
}

/**
 * Load everything on the logged-in user's plate. Runs the throttled global
 * auto-missed sweep first (same as the dashboard) so the page reflects reality,
 * then queries and maps rows through the pure section-membership functions.
 */
export async function getMyPlateData(
  viewerInput: { userId: string; roleCode: RoleCode; departmentGroupId?: string | null },
  now: Date = new Date()
): Promise<MyPlateData> {
  await applyAutoMissedTrialsForAllProjects(viewerInput.userId, now);

  // The viewer's own department group + its parent. Assembly members sit in the
  // working CHILD groups (assembly-a 钟组 / assembly-b 裴组), and since
  // 2026-08-05 an assembly issue can be routed to one of those instead of the
  // `assembly` parent, so the inbox has to match on both. One tiny lookup, only
  // when the account actually has a group.
  const viewerGroup =
    viewerInput.departmentGroupId == null
      ? null
      : await prisma.departmentGroup.findUnique({
          where: { id: viewerInput.departmentGroupId },
          select: { code: true, parentGroup: { select: { code: true } } }
        });

  const viewer: PlateViewer = {
    userId: viewerInput.userId,
    roleCode: viewerInput.roleCode,
    departmentGroupCode: viewerGroup?.code ?? null,
    departmentGroupParentCode: viewerGroup?.parentGroup?.code ?? null
  };

  // Owned issues are relevant for everyone; assembly/PM roles additionally need
  // the workflow-stage issues their sections act on. Each OR branch mirrors a
  // section predicate so the DB fetch stays narrow; the pure functions re-apply
  // the exact same rules for the final membership decision.
  const issueOwnershipFilters: Array<Record<string, unknown>> = [{ ownerUserId: viewer.userId }];
  const departmentInboxGroupCodes = [...departmentInboxGroupCodesForViewer(viewer)];

  if (departmentInboxGroupCodes.length > 0) {
    issueOwnershipFilters.push({
      ownerUserId: null,
      ownerGroup: { code: { in: departmentInboxGroupCodes } }
    });
  }

  if (viewer.roleCode === "ASSEMBLY") {
    // Assembly acts only on issues relevant to it (assigned to me, owned by an
    // assembly group I watch, or an assembly/fitting issue) — mirrors the action
    // guard. The group list is the `assembly` parent plus my own working group.
    const assemblyRelevant = {
      OR: [
        { ownerUserId: viewer.userId },
        { ownerGroup: { code: { in: [...assemblyGroupCodesForViewer(viewer)] } } },
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

  const [trials, issues, ruleConfig] = await Promise.all([
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
        sequenceNumber: true,
        status: true,
        plannedDate: true,
        dateConfirmationStatus: true,
        rescheduleRejectReason: true,
        // Deadline anchors: autoMissedAt (needs-a-reason), rescheduleDecisionAt
        // (returned dates). Shared with the scorer via kpi-events anchor helpers.
        autoMissedAt: true,
        rescheduleDecisionAt: true,
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
        // Deadline anchor for all.inbox_claim + asm.acknowledge (issue createdAt).
        createdAt: true,
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
            id: true,
            projectCode: true,
            moldCode: true,
            planningPmId: true,
            technicalPmId: true,
            customer: { select: { shortName: true } }
          }
        }
      },
      orderBy: [{ dueDate: "asc" }]
    }),
    // Load the live rule config ONCE per request (hours + active flag), so an
    // admin's Rules-tab edit shows up on next load and no row re-queries it.
    loadRuleConfig()
  ]);

  const ruleByCode = new Map<KpiRuleCode, ScoringRule>(ruleConfig.rules.map((rule) => [rule.code, rule]));

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

  // The next planned trial per project, for BOTH trial-facing chips: the
  // assembly self-check chip (no hours rule — its soft deadline is that trial)
  // and the trial-deadline chip every open-issue card now carries. Batched for
  // every fetched issue's project (one query, grouped in memory), so neither
  // adds an N+1. Previously assembly-only; widened because a handler in any
  // department needs the same "before the mold goes on the machine" wall.
  const nextPlannedTrialByProject = new Map<string, Date>();
  if (issues.length > 0) {
    const projectIds = [...new Set(issues.map((issue) => issue.moldTrialProject.id))];
    const upcomingTrials = await prisma.trialEvent.findMany({
      where: {
        status: { in: ["PLANNED", "AT_RISK"] },
        plannedDate: { gte: startOfUtcDay(now) },
        moldTrialProjectId: { in: projectIds }
      },
      select: { moldTrialProjectId: true, plannedDate: true },
      orderBy: [{ plannedDate: "asc" }]
    });
    for (const upcoming of upcomingTrials) {
      if (!nextPlannedTrialByProject.has(upcoming.moldTrialProjectId)) {
        nextPlannedTrialByProject.set(upcoming.moldTrialProjectId, upcoming.plannedDate);
      }
    }
  }

  const needsReason: NeedsReasonRow[] = [];
  const comingUp: ComingUpRow[] = [];
  const returnedDates: ReturnedDateRow[] = [];

  for (const trial of trials) {
    const project = trial.moldTrialProject;
    const trialLabel = trialStageLabel(trial.sequenceNumber);
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
      title: `${trialLabel} trial`
    };

    if (belongsToNeedsReasonSection(viewer, record)) {
      needsReason.push({
        ...base,
        trialEventId: trial.id,
        trialCode: trialLabel,
        statusLabel: trialStatusLabels[trial.status],
        plannedDate: formatDate(trial.plannedDate),
        plannedDateInput: formatDate(trial.plannedDate),
        overdue: isOverdue(trial.plannedDate, now),
        deadline: ruleCountdown("pm.missed_reason", anchorForMissedReason(trial), ruleByCode, now)
      });
    }

    if (belongsToReturnedDatesSection(viewer, record)) {
      returnedDates.push({
        ...base,
        trialEventId: trial.id,
        trialCode: trialLabel,
        plannedDate: formatDate(trial.plannedDate),
        rejectReason: trial.rescheduleRejectReason,
        deadline: ruleCountdown("pm.returned_redate", anchorForReturnedRedate(trial), ruleByCode, now)
      });
    }

    if (belongsToComingUpSection(viewer, record, now, COMING_UP_WINDOW_DAYS)) {
      comingUp.push({
        ...base,
        trialCode: trialLabel,
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
          sequenceNumber: true,
          status: true,
          plannedDate: true,
          dateConfirmationStatus: true,
          proposedDate: true,
          proposedReason: true,
          // inj.date_confirm anchor: the PENDING_CONFIRMATION window opens at createdAt.
          createdAt: true,
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

    // mkt.date_decision anchor: the Injection counter-proposal ActivityLog. One
    // batched query for every proposed trial (Marketing view only) — no per-row
    // lookup — matching kpi-events' proposal-timestamp source.
    const proposalLogByTrialId = new Map<string, { createdAt: Date }>();
    if (viewer.roleCode === "MARKETING" && confirmationTrials.length > 0) {
      const proposalLogs = await prisma.activityLog.findMany({
        where: {
          action: "proposed_trial_date_change",
          entityId: { in: confirmationTrials.map((trial) => trial.id) }
        },
        orderBy: [{ createdAt: "asc" }],
        select: { entityId: true, createdAt: true }
      });
      for (const log of proposalLogs) {
        if (!proposalLogByTrialId.has(log.entityId)) {
          proposalLogByTrialId.set(log.entityId, { createdAt: log.createdAt });
        }
      }
    }

    for (const trial of confirmationTrials) {
      const project = trial.moldTrialProject;
      const trialLabel = trialStageLabel(trial.sequenceNumber);
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
        title: `${trialLabel} trial`
      };

      if (belongsToConfirmTrialDatesSection(viewer, record)) {
        confirmTrialDates.push({
          ...base,
          trialEventId: trial.id,
          trialCode: trialLabel,
          statusValue: trial.status as TrialStatusDbValue,
          statusLabel: trialStatusLabels[trial.status],
          plannedDate: formatDate(trial.plannedDate),
          overdue: isOverdue(trial.plannedDate, now),
          deadline: ruleCountdown("inj.date_confirm", anchorForDateConfirmation(trial), ruleByCode, now)
        });
      }

      if (belongsToApproveDateChangesSection(viewer, record)) {
        approveDateChanges.push({
          ...base,
          trialEventId: trial.id,
          trialCode: trialLabel,
          plannedDate: formatDate(trial.plannedDate),
          proposedDate: formatDate(trial.proposedDate),
          customerTargetDate: formatDate(project.customerTargetDate),
          proposedReason: trial.proposedReason,
          targetGapDays: daysBetweenProposedAndTarget(trial.proposedDate, project.customerTargetDate),
          proposedAfterTarget: isProposedDateAfterTarget(trial.proposedDate, project.customerTargetDate),
          deadline: ruleCountdown(
            "mkt.date_decision",
            anchorForDateDecision(proposalLogByTrialId.get(trial.id)),
            ruleByCode,
            now
          )
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
    // Display-only urgency shared by every open-issue card on this plate.
    const trialDeadline = trialDeadlineFor(issue.dueDate, nextPlannedTrialByProject.get(project.id), now);

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
        photos: photosByIssue.get(issue.id) ?? [],
        trialDeadline
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
      pmReadyConfirmedAtInput: formatDate(issue.pmReadyConfirmedAt),
      // Filled per-section below; PM-confirm-ready has no hours rule → no chip.
      deadline: null,
      selfCheckDeadline: null,
      trialDeadline
    };

    if (belongsToDepartmentInboxSection(viewer, record)) {
      // A DESIGN viewer's inbox is the design group, so its claim chip is the
      // design-scoped rule (same 48h anchor as all.inbox_claim); every other role
      // uses the shared line.
      departmentInbox.push({
        ...lifecycleRow,
        deadline: ruleCountdown(
          viewer.roleCode === "DESIGN" ? "design.inbox_claim" : "all.inbox_claim",
          anchorForInboxClaim(issue),
          ruleByCode,
          now
        )
      });
    }

    if (belongsToAssemblyAcknowledgeSection(viewer, record)) {
      assemblyAcknowledge.push({
        ...lifecycleRow,
        deadline: ruleCountdown("asm.acknowledge", anchorForAcknowledge(issue), ruleByCode, now)
      });
    }

    if (belongsToAssemblySelfCheckSection(viewer, record)) {
      // The self-check chip IS this section's trial statement ("before next
      // trial · date"), so the generic trial chip is suppressed here rather than
      // printing the same trial twice on one card.
      assemblySelfCheck.push({
        ...lifecycleRow,
        selfCheckDeadline: selfCheckCountdown(nextPlannedTrialByProject.get(project.id), now),
        trialDeadline: null
      });
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

    // qc.report_upload anchor: the result-recorded ActivityLog per trial. One
    // batched query (QC view only) — matches kpi-events' record-result source.
    const recordLogByTrialId = new Map<string, { createdAt: Date }>();
    if (completedTrialIds.length > 0) {
      const recordLogs = await prisma.activityLog.findMany({
        where: { action: "recorded_completed_trial", entityId: { in: completedTrialIds } },
        orderBy: [{ createdAt: "asc" }],
        select: { entityId: true, createdAt: true }
      });
      for (const log of recordLogs) {
        if (!recordLogByTrialId.has(log.entityId)) {
          recordLogByTrialId.set(log.entityId, { createdAt: log.createdAt });
        }
      }
    }

    for (const trial of completedTrials) {
      const project = trial.moldTrialProject;
      const trialLabel = trialStageLabel(trial.sequenceNumber);
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
        title: `${trialLabel} trial`,
        trialEventId: trial.id,
        trialCode: trialLabel,
        statusLabel: trialStatusLabels[trial.status],
        actualDate: formatDate(trial.actualDate),
        deadline: ruleCountdown(
          "qc.report_upload",
          anchorForReportUpload(recordLogByTrialId.get(trial.id)),
          ruleByCode,
          now
        )
      });
    }
  }

  // "Design: revisions" — only DESIGN users see it. Design-change events on live
  // (non-terminal) projects that have no DRAWING attached yet. The DB filter
  // narrows to live projects; the drawing-presence join then drops any event that
  // already has a drawing (the pure predicate re-applies both gates).
  const designRevisions: DesignRevisionRow[] = [];

  if (viewer.roleCode === "DESIGN") {
    const changeEvents = await prisma.designChangeEvent.findMany({
      where: { moldTrialProject: { status: { notIn: ["CANCELLED", "CLOSED"] } } },
      select: {
        id: true,
        title: true,
        changeDate: true,
        requestedBy: true,
        // design.change_revision anchor: the event's creation opens the clock.
        createdAt: true,
        moldTrialProject: {
          select: {
            id: true,
            projectCode: true,
            moldCode: true,
            status: true,
            customer: { select: { shortName: true } }
          }
        }
      },
      orderBy: [{ createdAt: "asc" }]
    });

    const changeEventIds = changeEvents.map((event) => event.id);
    const drawingRows =
      changeEventIds.length === 0
        ? []
        : await prisma.fileAttachment.findMany({
            where: {
              entityType: "DESIGN_CHANGE_EVENT",
              entityId: { in: changeEventIds },
              fileType: "DRAWING",
              deletedAt: null
            },
            select: { entityId: true }
          });
    const eventsWithDrawing = new Set(drawingRows.map((row) => row.entityId));

    for (const event of changeEvents) {
      const project = event.moldTrialProject;
      const record: PlateDesignChangeRecord = {
        projectStatus: project.status,
        hasDrawing: eventsWithDrawing.has(event.id)
      };

      if (!belongsToDesignRevisionsSection(viewer, record)) {
        continue;
      }

      designRevisions.push({
        key: event.id,
        projectCode: project.projectCode,
        customerShortName: project.customer.shortName,
        moldCode: project.moldCode,
        title: event.title,
        designChangeEventId: event.id,
        projectId: project.id,
        requesterLabel: changeRequesterLabels[event.requestedBy] ?? event.requestedBy,
        changeDate: formatDate(event.changeDate),
        createdDate: formatDate(event.createdAt),
        deadline: ruleCountdown("design.change_revision", anchorForDesignRevision(event), ruleByCode, now)
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
  designRevisions.sort((a, b) => comparePlateItemsByDate({ date: a.createdDate }, { date: b.createdDate }));
  assemblyAcknowledge.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  assemblySelfCheck.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  pmConfirmReady.sort((a, b) => comparePlateItemsByDate({ date: a.dueDate }, { date: b.dueDate }));
  qcReportsToUpload.sort((a, b) => comparePlateItemsByDate({ date: a.actualDate }, { date: b.actualDate }));

  // Sections that carry a deadline countdown re-sort by urgency (most urgent
  // first, overdue at the very top, no-chip rows last). The date sort above
  // survives as a stable tiebreaker for equal / absent remaining times.
  // Coming up, My open issues and PM confirm-ready have no hours rule and keep
  // their date order.
  needsReason.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  confirmTrialDates.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  approveDateChanges.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  returnedDates.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  departmentInbox.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  designRevisions.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  assemblyAcknowledge.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));
  assemblySelfCheck.sort((a, b) =>
    compareByCountdownUrgency(
      { remainingHours: a.selfCheckDeadline?.remainingHours ?? null },
      { remainingHours: b.selfCheckDeadline?.remainingHours ?? null }
    )
  );
  qcReportsToUpload.sort((a, b) => compareByCountdownUrgency(urgencyOf(a), urgencyOf(b)));

  const totalCount =
    needsReason.length +
    confirmTrialDates.length +
    approveDateChanges.length +
    returnedDates.length +
    myOpenIssues.length +
    departmentInbox.length +
    designRevisions.length +
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
    designRevisions,
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
