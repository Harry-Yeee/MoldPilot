/**
 * KPI event extraction — the thin server layer that reads real MoldPilot
 * records and projects them into the plain event shapes the pure scoring
 * engine consumes (`KpiHabitEvent`, `KpiPointsEvent`).
 *
 * Attribution rule: every event belongs to exactly ONE user (the acting user).
 * Where a timestamp source is unreliable we EXCLUDE the event rather than
 * guess — undercounting applicable events is safe (the <5-events floor
 * protects the bar). `dueAt` is computed from the rule's literal-hours window
 * off the clock-start timestamp; boolean rules pass a `passed` flag instead.
 *
 * See docs/06-kpi/kpi-system-design.md v2 §4 and the owner's timestamp-source
 * table for each rule.
 */

import { computeDeadline } from "@/domain/mold-trial/deadline-countdown";
import { defaultKpiRules, isKpiRuleCode, type KpiRuleCode } from "@/domain/mold-trial/kpi-rules";
import type { KpiHabitEvent, KpiPointsEvent, ScoringRule } from "@/domain/mold-trial/kpi-scoring";
import { prisma } from "@/lib/prisma";

/** A rule's editable hours window, keyed by code (null => boolean rule). */
export type RuleHoursByCode = Partial<Record<KpiRuleCode, number | null>>;

export type KpiMonthWindow = {
  /** Inclusive start of the scored month (UTC midnight of day 1). */
  start: Date;
  /** Exclusive end (UTC midnight of day 1 of the next month). */
  end: Date;
};

/** Build the [start, end) window for a YYYY-MM string in UTC. */
export function monthWindow(month: string): KpiMonthWindow {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const monthIndex = Number.parseInt(monthRaw ?? "", 10) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid month "${month}" (expected YYYY-MM).`);
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end };
}

/** A rule's clock start + its literal-hours window → the deadline instant. */
function addHours(base: Date, hours: number): Date {
  return computeDeadline(base, hours);
}

/** End-of-day (UTC) for a @db.Date value; the result-recording clock target. */
function endOfDay(date: Date): Date {
  const eod = new Date(date.getTime());
  eod.setUTCHours(23, 59, 59, 999);
  return eod;
}

function within(window: KpiMonthWindow, at: Date | null | undefined): boolean {
  return at != null && at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime();
}

function hoursFor(rules: RuleHoursByCode, code: KpiRuleCode, fallback: number): number {
  const value = rules[code];
  return typeof value === "number" ? value : fallback;
}

/* --------------------------------------------------------------------------
 * Per-entity anchor helpers — the ONE place that decides "which timestamp is
 * the clock start" for each timed rule. Both the monthly extractor below and
 * the /me deadline-countdown computation (`src/server/my-plate.ts`) call these,
 * so a task card's countdown and the scorer's on-time verdict never diverge.
 * The due instant is always `computeDeadline(anchor, ruleHours)`; a null anchor
 * means no clock (and, on the plate, no chip — never a guessed deadline).
 * ------------------------------------------------------------------------ */

/** pm.missed_reason: the auto-missed timestamp starts the resolve-with-reason clock. */
export function anchorForMissedReason(trial: { autoMissedAt: Date | null }): Date | null {
  return trial.autoMissedAt;
}

/** inj.date_confirm: the PENDING_CONFIRMATION window opens at the trial's creation. */
export function anchorForDateConfirmation(trial: { createdAt: Date }): Date {
  return trial.createdAt;
}

/** pm.returned_redate: Marketing's return (reschedule) decision starts the re-date clock. */
export function anchorForReturnedRedate(trial: { rescheduleDecisionAt: Date | null }): Date | null {
  return trial.rescheduleDecisionAt;
}

/**
 * mkt.date_decision: the Injection counter-proposal ActivityLog
 * (`proposed_trial_date_change`) starts the decision clock. The proposal time is
 * not stored on the trial, so callers pass that log row (or null when absent).
 */
export function anchorForDateDecision(proposal: { createdAt: Date } | null | undefined): Date | null {
  return proposal?.createdAt ?? null;
}

/** all.inbox_claim: the group-owned issue's creation starts the claim clock. */
export function anchorForInboxClaim(issue: { createdAt: Date }): Date {
  return issue.createdAt;
}

/** asm.acknowledge: the issue's creation starts the acknowledge clock. */
export function anchorForAcknowledge(issue: { createdAt: Date }): Date {
  return issue.createdAt;
}

/**
 * qc.report_upload: the result-recorded ActivityLog (`recorded_completed_trial`)
 * starts the upload clock; callers pass that log row (or null when absent).
 */
export function anchorForReportUpload(recordLog: { createdAt: Date } | null | undefined): Date | null {
  return recordLog?.createdAt ?? null;
}

/**
 * design.change_revision: the design-change event's creation starts the
 * turn-around clock; the first DRAWING attached to it is the "done" moment. Both
 * the monthly extractor and the /me "Design: revisions" chip use this anchor so
 * the countdown and the on-time verdict agree.
 */
export function anchorForDesignRevision(event: { createdAt: Date }): Date {
  return event.createdAt;
}

/**
 * Load the active KPI rule config from the registry, projected for the scoring
 * engine (`rules`, carrying `active` + `hours`) plus a code→hours lookup
 * (`ruleHours`) for the deadline windows. Falls back to `defaultKpiRules` when
 * the table has not been seeded so a fresh environment still scores. Read ONCE
 * per request by both the monthly scorer and the /me plate, so an admin's Rules
 * tab edit is reflected on the next page load.
 */
export async function loadRuleConfig(): Promise<{ rules: ScoringRule[]; ruleHours: RuleHoursByCode }> {
  const rows = await prisma.kpiRule.findMany();
  const rules: ScoringRule[] = [];
  const ruleHours: RuleHoursByCode = {};

  const source =
    rows.length > 0
      ? rows.map((row) => ({ code: row.code, hours: row.hours, active: row.active }))
      : defaultKpiRules.map((rule) => ({ code: rule.code, hours: rule.hours, active: rule.active }));

  for (const row of source) {
    if (!isKpiRuleCode(row.code)) {
      continue;
    }
    rules.push({ code: row.code, hours: row.hours, active: row.active });
    ruleHours[row.code] = row.hours;
  }

  return { rules, ruleHours };
}

export type KpiExtraction = {
  habitEvents: KpiHabitEvent[];
  pointsEvents: KpiPointsEvent[];
};

/**
 * Extract all habit + points events whose "applicable" timestamp falls inside
 * the given month. `ruleHours` overrides the deadline windows so mid-month rule
 * edits re-score correctly (the caller passes the CURRENT rule config).
 */
export async function extractKpiEvents(
  window: KpiMonthWindow,
  ruleHours: RuleHoursByCode
): Promise<KpiExtraction> {
  const habitEvents: KpiHabitEvent[] = [];
  const pointsEvents: KpiPointsEvent[] = [];

  const [trials, issues, activityLogs] = await Promise.all([
    prisma.trialEvent.findMany({
      include: {
        moldTrialProject: { select: { projectCode: true, planningPmId: true, technicalPmId: true } },
        processValues: { select: { id: true }, take: 1 },
        issuesFound: { select: { id: true } }
      }
    }),
    prisma.trialIssue.findMany({
      include: {
        moldTrialProject: { select: { projectCode: true } }
      }
    }),
    // Only the action types the extractor keys on, ordered oldest-first so the
    // "first owner-set" entry per issue is easy to find.
    prisma.activityLog.findMany({
      where: {
        action: {
          in: ["recorded_completed_trial", "redated_returned_trial", "claimed_department_inbox_issue"]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })
  ]);

  const recordResultLogByTrialId = new Map<string, { createdAt: Date; actorUserId: string }>();
  const redateLogByTrialId = new Map<string, { createdAt: Date; actorUserId: string }>();
  const inboxClaimLogByIssueId = new Map<string, { createdAt: Date; actorUserId: string }>();
  for (const log of activityLogs) {
    if (log.action === "recorded_completed_trial" && !recordResultLogByTrialId.has(log.entityId)) {
      recordResultLogByTrialId.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
    } else if (log.action === "redated_returned_trial" && !redateLogByTrialId.has(log.entityId)) {
      redateLogByTrialId.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
    } else if (log.action === "claimed_department_inbox_issue" && !inboxClaimLogByIssueId.has(log.entityId)) {
      inboxClaimLogByIssueId.set(log.entityId, { createdAt: log.createdAt, actorUserId: log.actorUserId });
    }
  }

  // QC report uploads keyed by trial event (the completed-trial clock target).
  const qcReports = await prisma.fileAttachment.findMany({
    where: { entityType: "TRIAL_EVENT", fileType: "QC_REPORT", deletedAt: null },
    orderBy: [{ uploadedAt: "asc" }],
    select: { entityId: true, uploadedAt: true }
  });
  const qcReportByTrialId = new Map<string, Date>();
  for (const report of qcReports) {
    if (!qcReportByTrialId.has(report.entityId)) {
      qcReportByTrialId.set(report.entityId, report.uploadedAt);
    }
  }

  // TRIAL_PHOTO presence per issue (the photo-on-defect boolean).
  const photoAttachments = await prisma.fileAttachment.findMany({
    where: { entityType: "TRIAL_ISSUE", fileType: "TRIAL_PHOTO", deletedAt: null },
    select: { entityId: true }
  });
  const issueHasPhoto = new Set(photoAttachments.map((attachment) => attachment.entityId));

  // design.inbox_claim is scoped to design-group-owned issues; resolve the group
  // id once (null when the Design role/group is not seeded → no design events).
  const designGroup = await prisma.departmentGroup.findUnique({ where: { code: "design" }, select: { id: true } });
  const designGroupId = designGroup?.id ?? null;

  // design.change_revision: design-change events + their first DRAWING attachment
  // (entityType DESIGN_CHANGE_EVENT). The first drawing's uploadedAt is the "done"
  // moment and its uploader is the attributed (design) user; an event with no
  // drawing yet is EXCLUDED (no reliable design attribution — pending, not late).
  const [designChanges, designDrawings] = await Promise.all([
    prisma.designChangeEvent.findMany({
      select: { id: true, title: true, createdAt: true, moldTrialProject: { select: { projectCode: true } } }
    }),
    prisma.fileAttachment.findMany({
      where: { entityType: "DESIGN_CHANGE_EVENT", fileType: "DRAWING", deletedAt: null },
      orderBy: [{ uploadedAt: "asc" }],
      select: { entityId: true, uploadedAt: true, uploadedById: true }
    })
  ]);
  const firstDrawingByEvent = new Map<string, { uploadedAt: Date; uploadedById: string }>();
  for (const drawing of designDrawings) {
    if (!firstDrawingByEvent.has(drawing.entityId)) {
      firstDrawingByEvent.set(drawing.entityId, { uploadedAt: drawing.uploadedAt, uploadedById: drawing.uploadedById });
    }
  }

  for (const event of designChanges) {
    const revisionAnchor = anchorForDesignRevision(event);
    if (!within(window, revisionAnchor)) {
      continue;
    }
    const drawing = firstDrawingByEvent.get(event.id);
    if (drawing == null) {
      // No drawing yet — no reliable design attribution; exclude (pending).
      continue;
    }
    habitEvents.push({
      ruleCode: "design.change_revision",
      userId: drawing.uploadedById,
      ref: `${event.moldTrialProject.projectCode} · ${event.title}`,
      dueAt: addHours(revisionAnchor, hoursFor(ruleHours, "design.change_revision", 48)),
      doneAt: drawing.uploadedAt
    });
  }

  for (const trial of trials) {
    const projectCode = trial.moldTrialProject.projectCode;
    const pmId = trial.moldTrialProject.planningPmId ?? trial.moldTrialProject.technicalPmId ?? null;
    const ref = `${projectCode} · ${trial.trialCode}`;

    // pm.missed_reason: autoMissedAt (clock start) -> autoMissedResolvedAt.
    // Attribute to the resolver, else the project PM.
    const missedAnchor = anchorForMissedReason(trial);
    if (within(window, missedAnchor)) {
      const start = missedAnchor as Date;
      const resolverId = trial.autoMissedResolvedById ?? pmId;
      if (resolverId != null) {
        habitEvents.push({
          ruleCode: "pm.missed_reason",
          userId: resolverId,
          ref,
          dueAt: addHours(start, hoursFor(ruleHours, "pm.missed_reason", 24)),
          doneAt: trial.autoMissedResolvedAt ?? null
        });
      }
    }

    // pm.result_recorded: the record-result ActivityLog createdAt vs the
    // actual trial date end-of-day. Attribute to the recording PM. Only when
    // we have both the log (reliable timestamp) and an actualDate.
    const recordLog = recordResultLogByTrialId.get(trial.id);
    if (recordLog != null && trial.actualDate != null && within(window, recordLog.createdAt)) {
      habitEvents.push({
        ruleCode: "pm.result_recorded",
        userId: recordLog.actorUserId,
        ref,
        dueAt: endOfDay(trial.actualDate),
        doneAt: recordLog.createdAt
      });
    }

    // pm.returned_redate: rescheduleDecisionAt (rejection, clock start) -> the
    // subsequent re-date ActivityLog entry. Attribute to the re-dating PM.
    const returnedAnchor = anchorForReturnedRedate(trial);
    if (trial.dateConfirmationStatus === "RETURNED_TO_PM" && within(window, returnedAnchor)) {
      const start = returnedAnchor as Date;
      const redate = redateLogByTrialId.get(trial.id);
      const userId = redate?.actorUserId ?? pmId;
      if (userId != null) {
        habitEvents.push({
          ruleCode: "pm.returned_redate",
          userId,
          ref,
          dueAt: addHours(start, hoursFor(ruleHours, "pm.returned_redate", 24)),
          doneAt: redate?.createdAt ?? null
        });
      }
    }

    // inj.date_confirm: PENDING_CONFIRMATION start (trial createdAt) -> the
    // first response: dateConfirmedAt OR a counter-proposal (proposedById set +
    // rescheduleDecisionAt as the proposal time is not stored, so we treat a
    // confirmation OR a returned/reschedule status as "answered"). Attribute to
    // the confirmer; if a counter-proposal, to the proposer.
    const dateConfirmAnchor = anchorForDateConfirmation(trial);
    if (within(window, dateConfirmAnchor)) {
      const answeredAt =
        trial.dateConfirmedAt ??
        (trial.dateConfirmationStatus === "RESCHEDULE_PROPOSED" || trial.dateConfirmationStatus === "RETURNED_TO_PM"
          ? trial.rescheduleDecisionAt ?? null
          : null);
      const userId = trial.dateConfirmedById ?? trial.proposedById ?? null;
      if (userId != null) {
        habitEvents.push({
          ruleCode: "inj.date_confirm",
          userId,
          ref,
          dueAt: addHours(dateConfirmAnchor, hoursFor(ruleHours, "inj.date_confirm", 24)),
          doneAt: answeredAt
        });
      }
    }

    // inj.process_values (boolean): a completed trial has >=1 process value
    // row. Attribute to the confirmer/proposer (the injection actor), else PM.
    if (
      (trial.status === "COMPLETED" || trial.status === "PENDING_FOLLOW_UP") &&
      trial.actualDate != null &&
      within(window, endOfDay(trial.actualDate))
    ) {
      const injectionUserId = trial.dateConfirmedById ?? trial.proposedById ?? null;
      if (injectionUserId != null) {
        habitEvents.push({
          ruleCode: "inj.process_values",
          userId: injectionUserId,
          ref,
          dueAt: null,
          doneAt: null,
          passed: trial.processValues.length > 0
        });
      }

      // qc.report_upload: result-recorded timestamp -> QC_REPORT uploadedAt.
      // Attribute to the recording actor (QC/PM) since QC ownership is not
      // stored on the trial; the recording actor is the reliable stand-in.
      if (recordLog != null) {
        const reportAnchor = anchorForReportUpload(recordLog) as Date;
        if (within(window, reportAnchor)) {
          habitEvents.push({
            ruleCode: "qc.report_upload",
            userId: recordLog.actorUserId,
            ref,
            dueAt: addHours(reportAnchor, hoursFor(ruleHours, "qc.report_upload", 48)),
            doneAt: qcReportByTrialId.get(trial.id) ?? null
          });
        }
      }
    }
  }

  // mkt.date_decision: a counter-proposal in play (RESCHEDULE_PROPOSED) whose
  // decision (rescheduleDecisionAt) lands in the month. Clock start is the
  // proposal; the proposal timestamp is not stored, so we EXCLUDE unless the
  // decision exists — and use trial.updatedAt is unreliable. Instead attribute
  // to the reschedule decider and measure against the trial createdAt window is
  // wrong; the reliable pair is (proposal exists) -> rescheduleDecisionAt. We
  // approximate the proposal clock with a dedicated ActivityLog lookup.
  const proposalLogs = await prisma.activityLog.findMany({
    where: { action: "proposed_trial_date_change" },
    orderBy: [{ createdAt: "asc" }],
    select: { entityId: true, createdAt: true }
  });
  const proposalLogByTrialId = new Map<string, { createdAt: Date }>();
  for (const log of proposalLogs) {
    if (!proposalLogByTrialId.has(log.entityId)) {
      proposalLogByTrialId.set(log.entityId, { createdAt: log.createdAt });
    }
  }
  for (const trial of trials) {
    const proposalAt = anchorForDateDecision(proposalLogByTrialId.get(trial.id));
    if (proposalAt == null || !within(window, proposalAt)) {
      continue;
    }
    if (trial.rescheduleDecisionById == null && trial.rescheduleDecisionAt == null) {
      // Proposal answered by nobody yet — decider unknown, skip attribution.
      continue;
    }
    const deciderId = trial.rescheduleDecisionById;
    if (deciderId == null) {
      continue;
    }
    habitEvents.push({
      ruleCode: "mkt.date_decision",
      userId: deciderId,
      ref: `${trial.moldTrialProject.projectCode} · ${trial.trialCode}`,
      dueAt: addHours(proposalAt, hoursFor(ruleHours, "mkt.date_decision", 24)),
      doneAt: trial.rescheduleDecisionAt ?? null
    });
  }

  for (const issue of issues) {
    const ref = `${issue.moldTrialProject.projectCode} · ${issue.title}`;

    // asm.acknowledge: the issue's clock starts when Assembly work is assigned
    // (createdAt for an assembly-relevant issue) -> assemblyAcknowledgedAt.
    // Attribute to the acknowledger, else the owner user.
    const acknowledgeAnchor = anchorForAcknowledge(issue);
    if (within(window, acknowledgeAnchor) && (issue.assemblyAcknowledgedAt != null || issue.assemblyAcknowledgedById != null || issue.assemblySelfCheckedAt != null)) {
      const userId = issue.assemblyAcknowledgedById ?? issue.ownerUserId ?? null;
      if (userId != null) {
        habitEvents.push({
          ruleCode: "asm.acknowledge",
          userId,
          ref,
          dueAt: addHours(acknowledgeAnchor, hoursFor(ruleHours, "asm.acknowledge", 24)),
          doneAt: issue.assemblyAcknowledgedAt ?? null
        });
      }
    }

    // asm.self_check (boolean): self-check completed. Applicable when the issue
    // was acknowledged this month; passed when assemblySelfCheckedAt is set.
    if (issue.assemblyAcknowledgedById != null && within(window, issue.assemblyAcknowledgedAt)) {
      const userId = issue.assemblySelfCheckedById ?? issue.assemblyAcknowledgedById;
      habitEvents.push({
        ruleCode: "asm.self_check",
        userId,
        ref,
        dueAt: null,
        doneAt: null,
        passed: issue.assemblySelfCheckedAt != null
      });
    }

    // all.inbox_claim: issue created group-owned (ownerGroupId set, no user) ->
    // first owner-set ActivityLog entry. Attribute to the claimer.
    const inboxAnchor = anchorForInboxClaim(issue);
    if (issue.ownerGroupId != null && within(window, inboxAnchor)) {
      const claim = inboxClaimLogByIssueId.get(issue.id);
      const claimerId = claim?.actorUserId ?? issue.ownerUserId ?? null;
      const doneAt = claim?.createdAt ?? (issue.ownerUserId != null ? issue.updatedAt : null);
      if (claimerId != null) {
        habitEvents.push({
          ruleCode: "all.inbox_claim",
          userId: claimerId,
          ref,
          dueAt: addHours(inboxAnchor, hoursFor(ruleHours, "all.inbox_claim", 48)),
          doneAt
        });

        // design.inbox_claim: same mechanics, scoped to design-group issues. The
        // design leader's bar tracks these separately from everyone's shared line.
        if (designGroupId != null && issue.ownerGroupId === designGroupId) {
          habitEvents.push({
            ruleCode: "design.inbox_claim",
            userId: claimerId,
            ref,
            dueAt: addHours(inboxAnchor, hoursFor(ruleHours, "design.inbox_claim", 48)),
            doneAt
          });
        }
      }
    }

    // all.photo_on_defect (boolean): the issue has >=1 TRIAL_PHOTO. Attribute
    // to the issue creator.
    if (within(window, issue.createdAt)) {
      habitEvents.push({
        ruleCode: "all.photo_on_defect",
        userId: issue.createdById,
        ref,
        dueAt: null,
        doneAt: null,
        passed: issueHasPhoto.has(issue.id)
      });
    }

    // Points: only issues with a verification trial count. The fix credit goes
    // to the owner user (the fixer); pending-verification issues carry a
    // provisional-zero row. Applicable in the month the issue was verified
    // (verifiedAtTrialEventId set + closedAt/updatedAt in window) or, while
    // pending, the month it was created.
    const fixerId = issue.ownerUserId ?? issue.createdById;
    const verified = issue.verifiedAtTrialEventId != null;
    const at = verified ? issue.closedAt ?? issue.updatedAt : issue.createdAt;
    if (within(window, at)) {
      pointsEvents.push({
        userId: fixerId,
        issueRef: ref,
        severity: issue.severity,
        verified
      });
    }
  }

  return { habitEvents, pointsEvents };
}
