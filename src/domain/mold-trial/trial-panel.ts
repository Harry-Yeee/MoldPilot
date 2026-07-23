import type {
  DateLike,
  DesignChangeEvent,
  NewTrialReasonCategory,
  Severity,
  TrialCode,
  TrialIssueStatus,
  TrialLimitSummary,
  TrialOutcomeDisposition,
  TrialResult,
  TrialStatus,
  ValidationResult
} from "./types.ts";

export const DEFAULT_TRIAL_PANEL_COUNT = 3;

export const trialVerificationStatusOptions = ["Addressed", "Pending", "Not Verified", "Closed"] as const;

export type TrialVerificationStatus = (typeof trialVerificationStatusOptions)[number];

export type TrialPanelTrial = {
  id?: string;
  trialCode: TrialCode;
  sequenceNumber: number;
  plannedDate?: DateLike | null;
  actualDate?: DateLike | null;
  status: TrialStatus;
  result?: TrialResult | null;
  outcomeDisposition?: TrialOutcomeDisposition | null;
  countsAgainstLimit?: boolean | null;
  planReasonCategory?: NewTrialReasonCategory | null;
  planReasonDetail?: string | null;
  relatedDesignChangeEventId?: string | null;
  injectionMachineId?: string | null;
  machine?: string | null;
};

export type TrialPanelIssue = {
  id?: string;
  title: string;
  status: TrialIssueStatus;
  /** Domain severity label (e.g. "Medium"); drives the V6 severity chip. */
  severity?: Severity | null;
  foundAtTrialSequenceNumber?: number | null;
  verificationResult?: string | null;
};

export type TrialPanelLimitAdjustment = {
  adjustmentType?: string | null;
  deltaTrials?: number | null;
  reason?: string | null;
};

export type TrialPanelModel = {
  sequenceNumber: number;
  trialCode: TrialCode;
  title: string;
  trial: TrialPanelTrial | null;
  relatedIssues: TrialPanelIssue[];
  priorVerificationIssues: TrialPanelIssue[];
  canAddIssue: boolean;
  isNextActionPanel: boolean;
};

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function validationResult(issues: ValidationResult["issues"]): ValidationResult {
  return {
    ok: issues.length === 0,
    issues
  };
}

function dateParts(value: DateLike): { year: number; month: number; day: number } | null {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match != null) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
      };
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function dayNumber(value: DateLike): number | null {
  const parts = dateParts(value);
  if (parts == null) {
    return null;
  }

  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / millisecondsPerDay);
}

export function daysAwayFromDate(plannedDate: DateLike | null | undefined, today: DateLike = new Date()): number | null {
  if (plannedDate == null) {
    return null;
  }

  const plannedDay = dayNumber(plannedDate);
  const todayDay = dayNumber(today);

  if (plannedDay == null || todayDay == null) {
    return null;
  }

  return plannedDay - todayDay;
}

export function formatDaysAway(plannedDate: DateLike | null | undefined, today: DateLike = new Date()): string {
  const delta = daysAwayFromDate(plannedDate, today);

  if (delta == null) {
    return "Not set";
  }

  if (delta < 0) {
    return `${delta} days overdue`;
  }

  return `${delta === 0 ? "0" : `+${delta}`} days`;
}

export function formatTrialCountBadge(
  summary: Pick<
    TrialLimitSummary,
    "baseTrialLimit" | "completedTrialCount" | "currentTrialLimit" | "designChangeExtraTrialCount" | "warningState"
  >
): string {
  const base = `${summary.completedTrialCount} / ${summary.currentTrialLimit}`;

  if (summary.designChangeExtraTrialCount > 0 && summary.currentTrialLimit > summary.baseTrialLimit) {
    return `${base} Design Change Allowance`;
  }

  if (summary.completedTrialCount > summary.baseTrialLimit) {
    return `${base} Extra Trial`;
  }

  if (summary.warningState === "Healthy") {
    return base;
  }

  return `${base} ${summary.warningState}`;
}

export function countVisibleExtraTrialReasons(input: {
  trialEvents?: readonly Pick<
    TrialPanelTrial,
    "sequenceNumber" | "planReasonCategory" | "planReasonDetail" | "relatedDesignChangeEventId"
  >[];
  designChanges?: readonly DesignChangeEvent[];
  trialLimitAdjustments?: readonly TrialPanelLimitAdjustment[];
}): number {
  const plannedExtraReasons =
    input.trialEvents?.filter(
      (trial) =>
        trial.sequenceNumber > DEFAULT_TRIAL_PANEL_COUNT &&
        (trial.planReasonCategory != null || !isBlank(trial.planReasonDetail)) &&
        isBlank(trial.relatedDesignChangeEventId)
    ).length ?? 0;

  const designChangeReasons =
    input.designChanges?.reduce((total, change) => {
      if (!change.grantsExtraTrial || isBlank(change.approvalReason)) {
        return total;
      }

      return total + Math.max(1, change.extraTrialCount ?? 1);
    }, 0) ?? 0;

  const adjustmentReasons =
    input.trialLimitAdjustments?.reduce((total, adjustment) => {
      if (adjustment.adjustmentType === "PM_CUSTOM_LIMIT" || isBlank(adjustment.reason)) {
        return total;
      }

      return total + Math.max(0, adjustment.deltaTrials ?? 0);
    }, 0) ?? 0;

  return plannedExtraReasons + Math.max(designChangeReasons, adjustmentReasons);
}

function trialBySequence(trialEvents: readonly TrialPanelTrial[]): Map<number, TrialPanelTrial> {
  return new Map<number, TrialPanelTrial>(
    [...trialEvents]
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map((trial): [number, TrialPanelTrial] => [trial.sequenceNumber, trial])
  );
}

export function trialCodeForSequence(sequenceNumber: number): TrialCode {
  if (sequenceNumber === 1) {
    return "T0";
  }

  if (sequenceNumber === 2) {
    return "T1";
  }

  if (sequenceNumber === 3) {
    return "T2";
  }

  return "Extra";
}

export function trialStageLabel(sequenceNumber: number): string {
  return `T${Math.max(0, sequenceNumber - 1)}`;
}

function trialPanelTitle(sequenceNumber: number): string {
  return trialStageLabel(sequenceNumber);
}

export function isTrialClosedForNextStage(trial: TrialPanelTrial | undefined): boolean {
  if (trial == null) {
    return false;
  }

  return ["Completed", "Skipped", "Cancelled", "Aborted"].includes(trial.status);
}

function completedTrialNeedsLinkedIssue(trial: TrialPanelTrial | undefined): boolean {
  return trial?.status === "Completed" && trial.result !== "Approved";
}

function issueCountBySequence(issues: readonly TrialPanelIssue[] = []): Map<number, number> {
  const counts = new Map<number, number>();

  for (const issue of issues) {
    if (issue.foundAtTrialSequenceNumber == null) {
      continue;
    }

    counts.set(issue.foundAtTrialSequenceNumber, (counts.get(issue.foundAtTrialSequenceNumber) ?? 0) + 1);
  }

  return counts;
}

export function validateNextTrialStageCreation(input: {
  nextSequenceNumber: number;
  trialEvents: readonly TrialPanelTrial[];
  issues?: readonly TrialPanelIssue[];
}): ValidationResult {
  if (input.nextSequenceNumber <= 1) {
    return validationResult([]);
  }

  const issues: ValidationResult["issues"] = [];
  const bySequence = trialBySequence(input.trialEvents);
  const linkedIssueCountBySequence = issueCountBySequence(input.issues);

  for (let sequenceNumber = 1; sequenceNumber < input.nextSequenceNumber; sequenceNumber += 1) {
    const trial = bySequence.get(sequenceNumber);

    if (!isTrialClosedForNextStage(trial)) {
      issues.push({
        field: "trialEvents",
        message: `${trialStageLabel(sequenceNumber)} must be completed, skipped, cancelled, or aborted before planning ${trialStageLabel(
          input.nextSequenceNumber
        )}.`
      });
      break;
    }

    if (completedTrialNeedsLinkedIssue(trial) && (linkedIssueCountBySequence.get(sequenceNumber) ?? 0) === 0) {
      issues.push({
        field: "trialIssues",
        message: `Add at least one issue under ${trialStageLabel(sequenceNumber)} before planning ${trialStageLabel(
          input.nextSequenceNumber
        )} because ${trialStageLabel(sequenceNumber)} result was not approved.`
      });
      break;
    }
  }

  return validationResult(issues);
}

export function canShowExtraTrialPanel(input: {
  sequenceNumber: number;
  trialEvents: readonly TrialPanelTrial[];
  visibleExtraTrialReasonCount: number;
}): boolean {
  if (input.sequenceNumber <= DEFAULT_TRIAL_PANEL_COUNT) {
    return true;
  }

  if (input.visibleExtraTrialReasonCount < input.sequenceNumber - DEFAULT_TRIAL_PANEL_COUNT) {
    return false;
  }

  const bySequence = trialBySequence(input.trialEvents);

  for (let sequenceNumber = 1; sequenceNumber < input.sequenceNumber; sequenceNumber += 1) {
    if (!isTrialClosedForNextStage(bySequence.get(sequenceNumber))) {
      return false;
    }
  }

  return true;
}

export function validateExtraTrialPanelCreation(input: {
  nextSequenceNumber: number;
  trialEvents: readonly TrialPanelTrial[];
  designChanges?: readonly DesignChangeEvent[];
  trialLimitAdjustments?: readonly TrialPanelLimitAdjustment[];
  candidateReasonCategory?: NewTrialReasonCategory | null;
  candidateReasonDetail?: string | null;
}): ValidationResult {
  if (input.nextSequenceNumber <= DEFAULT_TRIAL_PANEL_COUNT) {
    return validationResult([]);
  }

  const visibleExtraTrialReasonCount =
    countVisibleExtraTrialReasons(input) +
    (input.candidateReasonCategory != null || !isBlank(input.candidateReasonDetail) ? 1 : 0);
  const issues: ValidationResult["issues"] = [];

  if (visibleExtraTrialReasonCount < input.nextSequenceNumber - DEFAULT_TRIAL_PANEL_COUNT) {
    issues.push({
      field: "planReasonCategory",
      message: "Extra trial requires a visible reason before the panel can be added."
    });
  }

  const bySequence = trialBySequence(input.trialEvents);

  for (let sequenceNumber = 1; sequenceNumber < input.nextSequenceNumber; sequenceNumber += 1) {
    if (!isTrialClosedForNextStage(bySequence.get(sequenceNumber))) {
      issues.push({
        field: "trialEvents",
        message: "Extra trial requires all prior trial panels to be completed, skipped, cancelled, or aborted."
      });
      break;
    }
  }

  return validationResult(issues);
}

export function buildTrialPanels(input: {
  trialEvents: readonly TrialPanelTrial[];
  issues?: readonly TrialPanelIssue[];
  designChanges?: readonly DesignChangeEvent[];
  trialLimitAdjustments?: readonly TrialPanelLimitAdjustment[];
  currentTrialId?: string | null;
}): TrialPanelModel[] {
  const visibleExtraTrialReasonCount = countVisibleExtraTrialReasons(input);
  const bySequence = trialBySequence(input.trialEvents);
  const maxExistingSequence = Math.max(0, ...input.trialEvents.map((trial) => trial.sequenceNumber));
  const maxPotentialSequence = Math.max(
    DEFAULT_TRIAL_PANEL_COUNT,
    maxExistingSequence,
    DEFAULT_TRIAL_PANEL_COUNT + visibleExtraTrialReasonCount
  );
  let maxVisibleSequence = DEFAULT_TRIAL_PANEL_COUNT;

  for (let sequenceNumber = DEFAULT_TRIAL_PANEL_COUNT + 1; sequenceNumber <= maxPotentialSequence; sequenceNumber += 1) {
    if (
      !canShowExtraTrialPanel({
        sequenceNumber,
        trialEvents: input.trialEvents,
        visibleExtraTrialReasonCount
      })
    ) {
      break;
    }

    maxVisibleSequence = sequenceNumber;
  }

  const panels: TrialPanelModel[] = [];

  for (let sequenceNumber = 1; sequenceNumber <= maxVisibleSequence; sequenceNumber += 1) {
    const trial = bySequence.get(sequenceNumber) ?? null;
    const relatedIssues =
      input.issues?.filter((issue) => issue.foundAtTrialSequenceNumber === sequenceNumber) ?? [];
    const priorVerificationIssues =
      sequenceNumber <= 1
        ? []
        : input.issues?.filter(
            (issue) =>
              issue.status !== "Closed" &&
              issue.foundAtTrialSequenceNumber != null &&
              issue.foundAtTrialSequenceNumber < sequenceNumber
          ) ?? [];

    panels.push({
      sequenceNumber,
      trialCode: trial?.trialCode ?? trialCodeForSequence(sequenceNumber),
      title: trialPanelTitle(sequenceNumber),
      trial,
      relatedIssues,
      priorVerificationIssues,
      canAddIssue: trial?.id != null,
      isNextActionPanel: trial?.id != null && trial.id === input.currentTrialId
    });
  }

  return panels;
}
