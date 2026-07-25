import type { DateLike, MissedTrialReasonCategory, ResponsibleArea, TrialStatus, ValidationResult } from "./types.ts";

export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Shanghai";
export const AUTO_MISSED_SWEEP_THROTTLE_MS = 5 * 60 * 1000;

const shanghaiNoonUtcHour = 4;

export type AutoMissedResolutionMode = "MISSED" | "BLOCKED" | "PAUSED";

export type AutoMissedResolutionInput = {
  mode?: AutoMissedResolutionMode | null;
  plannedDate?: DateLike | null;
  newPlannedDate?: DateLike | null;
  reasonCategory?: MissedTrialReasonCategory | null;
  responsibleArea?: ResponsibleArea | null;
  explanation?: string | null;
};

export type AutoMissedTrialCandidate = {
  plannedDate?: DateLike | null;
  actualDate?: DateLike | null;
  status: TrialStatus;
  result?: string | null;
  outcomeDisposition?: string | null;
};

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

function dateOnlyParts(value: DateLike): { year: number; monthIndex: number; day: number } | null {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match != null) {
      return {
        year: Number(match[1]),
        monthIndex: Number(match[2]) - 1,
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
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate()
  };
}

export function autoMissedCutoffUtc(
  plannedDate: DateLike | null | undefined,
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE
): Date | null {
  if (plannedDate == null || businessTimezone !== DEFAULT_BUSINESS_TIMEZONE) {
    return null;
  }

  const parts = dateOnlyParts(plannedDate);
  if (parts == null) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.monthIndex, parts.day + 1, shanghaiNoonUtcHour, 0, 0, 0));
}

export function shouldAutoMissTrial(
  trial: AutoMissedTrialCandidate,
  now: DateLike = new Date(),
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE
): boolean {
  if (trial.status !== "Planned" && trial.status !== "At Risk") {
    return false;
  }

  if (!isMissing(trial.actualDate) || !isMissing(trial.result) || !isMissing(trial.outcomeDisposition)) {
    return false;
  }

  const cutoff = autoMissedCutoffUtc(trial.plannedDate, businessTimezone);
  if (cutoff == null) {
    return false;
  }

  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    return false;
  }

  return nowDate.getTime() >= cutoff.getTime();
}

export function shouldRunAutoMissedSweep(input: {
  lastRunAt: number | null;
  now: Date | number;
  throttleMs?: number;
}): boolean {
  if (input.lastRunAt == null) {
    return true;
  }

  const nowMs = input.now instanceof Date ? input.now.getTime() : input.now;
  return nowMs - input.lastRunAt >= (input.throttleMs ?? AUTO_MISSED_SWEEP_THROTTLE_MS);
}

export function validateAutoMissedResolution(input: AutoMissedResolutionInput): ValidationResult {
  const issues: ValidationResult["issues"] = [];

  if (input.mode == null) {
    issues.push({
      field: "mode",
      message: "Auto-missed resolution type is required."
    });
    return { ok: false, issues };
  }

  if (input.mode === "MISSED") {
    if (isMissing(input.reasonCategory)) {
      issues.push({
        field: "reasonCategory",
        message: "Confirmed missed trial requires reason category."
      });
    }

    if (isMissing(input.responsibleArea)) {
      issues.push({
        field: "responsibleArea",
        message: "Confirmed missed trial requires responsible area."
      });
    }

    if (isMissing(input.newPlannedDate)) {
      issues.push({
        field: "newPlannedDate",
        message: "Confirmed missed trial requires new planned date."
      });
    }
  }

  if (isMissing(input.explanation)) {
    issues.push({
      field: "explanation",
      message:
        input.mode === "MISSED"
          ? "Confirmed missed trial requires explanation."
          : "Blocked or paused resolution requires explanation."
    });
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
