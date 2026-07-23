import type { MoldTrialDashboardRow } from "./dashboard.ts";

export type DashboardSortKey =
  | "urgency"
  | "projectCode"
  | "workingIdentifier"
  | "clientProjectRef"
  | "customerCode"
  | "partCode"
  | "moldCode"
  | "status"
  | "nextTrial"
  | "nextPlannedDate"
  | "assemblyReadyDate"
  | "trialCountLabel"
  | "openIssueCount"
  | "criticalOpenIssueCount"
  | "lastTrialResult"
  | "limitNote"
  | "lastUpdate"
  | "warningState";

export type DashboardSortDirection = "asc" | "desc";

export type DashboardSortState = {
  key: DashboardSortKey;
  direction: DashboardSortDirection;
};

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

const warningStateRank: Record<MoldTrialDashboardRow["warningState"], number> = {
  Healthy: 0,
  "Near Limit": 1,
  "At Limit": 2,
  "Over Limit": 3
};

const projectStatusUrgencyRank: Record<string, number> = {
  Approved: 0,
  Closed: 0,
  Cancelled: 0,
  Active: 1,
  "Waiting Trial": 1,
  Intake: 2,
  "Waiting Verification": 2,
  "In Correction": 3,
  Paused: 4,
  "Trial Delayed": 5,
  Blocked: 5,
  "Over Limit": 6
};

function directionMultiplier(direction: DashboardSortDirection): number {
  return direction === "asc" ? 1 : -1;
}

function compareText(left: string, right: string, direction: DashboardSortDirection): number {
  return textCollator.compare(left, right) * directionMultiplier(direction);
}

function parseDateValue(value: string): number | null {
  if (value === "Not planned") {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function compareDates(left: string, right: string, direction: DashboardSortDirection): number {
  const leftTime = parseDateValue(left);
  const rightTime = parseDateValue(right);

  if (leftTime == null && rightTime == null) {
    return 0;
  }

  if (leftTime == null) {
    return 1;
  }

  if (rightTime == null) {
    return -1;
  }

  return (leftTime - rightTime) * directionMultiplier(direction);
}

function compareNumbers(left: number, right: number, direction: DashboardSortDirection): number {
  return (left - right) * directionMultiplier(direction);
}

function parseTrialCount(value: string): { completed: number; limit: number } {
  const [completed, limit] = value.split("/").map((part) => Number.parseInt(part.trim(), 10));

  return {
    completed: Number.isFinite(completed) ? completed : 0,
    limit: Number.isFinite(limit) ? limit : 0
  };
}

function compareTrialCounts(left: string, right: string, direction: DashboardSortDirection): number {
  const leftCount = parseTrialCount(left);
  const rightCount = parseTrialCount(right);

  return (
    compareNumbers(leftCount.completed, rightCount.completed, direction) ||
    compareNumbers(leftCount.limit, rightCount.limit, direction)
  );
}

function compareRanks(leftRank: number, rightRank: number, direction: DashboardSortDirection): number {
  return (leftRank - rightRank) * directionMultiplier(direction);
}

function projectCodeTieBreak(left: MoldTrialDashboardRow, right: MoldTrialDashboardRow): number {
  return textCollator.compare(left.projectCode, right.projectCode);
}

/**
 * Urgency tier for the default dashboard order. Mirrors the status/limit -> tone
 * mapping in `src/components/ui/status-colors.ts` (the single source used for the
 * table's urgency stripe): a row is "missed" (tier 0) when its project status or
 * trial-limit state maps to the missed tone, "at-risk" (tier 1) when either maps
 * to the at-risk tone, and otherwise tier 2. Kept local (no cross-layer import)
 * so this stays a pure, dependency-free domain helper the tests can run directly.
 */
const MISSED_STATUS_LABELS = new Set(["Trial Delayed", "Delayed", "Blocked", "Over Limit"]);
const AT_RISK_STATUS_LABELS = new Set(["At Risk", "Auto Missed - Reason Required"]);
const MISSED_WARNING_STATES = new Set<MoldTrialDashboardRow["warningState"]>(["Over Limit"]);
const AT_RISK_WARNING_STATES = new Set<MoldTrialDashboardRow["warningState"]>(["Near Limit", "At Limit"]);

export function urgencyTier(row: MoldTrialDashboardRow): 0 | 1 | 2 {
  if (MISSED_STATUS_LABELS.has(row.status) || MISSED_WARNING_STATES.has(row.warningState)) {
    return 0;
  }
  if (AT_RISK_STATUS_LABELS.has(row.status) || AT_RISK_WARNING_STATES.has(row.warningState)) {
    return 1;
  }
  return 2;
}

/**
 * Default "urgency" ordering: tone-missed rows first, then at-risk, then the rest;
 * within each tier by next planned trial date ascending (undated rows last), then
 * a stable project-code tie-break. Pure + direction-independent (this is the
 * initial order, not a clickable column).
 */
export function compareByUrgency(left: MoldTrialDashboardRow, right: MoldTrialDashboardRow): number {
  return (
    urgencyTier(left) - urgencyTier(right) ||
    compareDates(left.nextPlannedDate, right.nextPlannedDate, "asc") ||
    textCollator.compare(left.projectCode, right.projectCode)
  );
}

function compareRows(
  left: MoldTrialDashboardRow,
  right: MoldTrialDashboardRow,
  sort: DashboardSortState
): number {
  switch (sort.key) {
    case "urgency":
      return compareByUrgency(left, right);
    case "projectCode":
    case "workingIdentifier":
    case "clientProjectRef":
    case "customerCode":
    case "partCode":
    case "moldCode":
    case "nextTrial":
    case "lastTrialResult":
    case "limitNote":
      return compareText(left[sort.key], right[sort.key], sort.direction);
    case "status":
      return (
        compareRanks(
          projectStatusUrgencyRank[left.status] ?? 1,
          projectStatusUrgencyRank[right.status] ?? 1,
          sort.direction
        ) || compareText(left.status, right.status, sort.direction)
      );
    case "nextPlannedDate":
    case "assemblyReadyDate":
    case "lastUpdate":
      return compareDates(left[sort.key], right[sort.key], sort.direction);
    case "trialCountLabel":
      return compareTrialCounts(left.trialCountLabel, right.trialCountLabel, sort.direction);
    case "openIssueCount":
    case "criticalOpenIssueCount":
      return compareNumbers(left[sort.key], right[sort.key], sort.direction);
    case "warningState":
      return (
        compareRanks(
          warningStateRank[left.warningState],
          warningStateRank[right.warningState],
          sort.direction
        ) || compareText(left.warningState, right.warningState, sort.direction)
      );
  }
}

export function sortDashboardRows(
  rows: readonly MoldTrialDashboardRow[],
  sort: DashboardSortState
): MoldTrialDashboardRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const valueSort = compareRows(left.row, right.row, sort);

      return valueSort || projectCodeTieBreak(left.row, right.row) || left.index - right.index;
    })
    .map(({ row }) => row);
}
