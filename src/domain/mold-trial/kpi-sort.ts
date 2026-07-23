/**
 * KPI scores sorting — PURE domain logic (no Prisma, no React, no I/O).
 *
 * The admin "Scores" tab lets an admin/GM re-order the per-user rows by any
 * column via URL params (`?scoreSort=<key>&scoreDir=asc|desc`). This module owns
 * the comparator so the ordering is unit-testable in isolation and the panel
 * stays a thin server component that just maps its rows through `sortKpiRows`.
 *
 * Invariants (mirrors src/domain/mold-trial/dashboard-sort.ts conventions):
 *  - "No data this month" rows (hasData === false) always sort LAST, regardless
 *    of key or direction. Among themselves they hold a stable name-asc order.
 *  - percent: a row with no rate (applicable === 0, shown as "—") sorts after
 *    rows that have a rate; floor rows (applicable 1–4) sort by their raw
 *    percent like any other scored row.
 *  - bar verdict rank (best → worst): Hit > Not-enough-data(floor hit) > Miss.
 *  - numeric desc puts the highest value first.
 *  - ties break by name asc (locale-aware) then original index, for stability.
 */

export type KpiSortKey =
  | "name"
  | "role"
  | "applicable"
  | "ontime"
  | "percent"
  | "bar"
  | "points";

export type KpiSortDirection = "asc" | "desc";

export type KpiSortState = {
  key: KpiSortKey;
  direction: KpiSortDirection;
};

/**
 * The minimal, display-resolved projection of a scored user the comparator
 * needs. The panel maps each `ScoredUser` to this (with `name` already resolved
 * for the active locale) and may carry extra fields alongside — `sortKpiRows`
 * is generic so the enriched row type flows straight back out.
 */
export type KpiSortRow = {
  /** Locale-resolved display name (also the tie-break key). */
  name: string;
  /** Display role label. */
  role: string;
  applicable: number;
  onTime: number;
  /** Whole-number on-time percent (engine placeholder 100 when applicable 0). */
  percent: number;
  totalPoints: number;
  /** False => "No data this month" (always sorts last). */
  hasData: boolean;
  barHit: boolean;
  barHitByFloor: boolean;
};

export const kpiSortKeys: readonly KpiSortKey[] = [
  "name",
  "role",
  "applicable",
  "ontime",
  "percent",
  "bar",
  "points"
];

/** Default ordering when no (or invalid) sort params are present. */
export const defaultKpiSort: KpiSortState = { key: "name", direction: "asc" };

export function isKpiSortKey(value: string): value is KpiSortKey {
  return (kpiSortKeys as readonly string[]).includes(value);
}

/**
 * The direction a column adopts on its FIRST click (before toggling): text
 * columns read best ascending (A→Z); the numeric/verdict score columns read
 * best descending (highest / strongest verdict first).
 */
export function defaultKpiSortDirection(key: KpiSortKey): KpiSortDirection {
  return key === "name" || key === "role" ? "asc" : "desc";
}

/** Parse raw URL param values into a validated sort state (defaults on junk). */
export function parseKpiSortState(
  key: string | null | undefined,
  direction: string | null | undefined
): KpiSortState {
  const resolvedKey = typeof key === "string" && isKpiSortKey(key) ? key : defaultKpiSort.key;
  const resolvedDirection =
    direction === "asc" || direction === "desc" ? direction : defaultKpiSortDirection(resolvedKey);
  return { key: resolvedKey, direction: resolvedDirection };
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

function directionMultiplier(direction: KpiSortDirection): number {
  return direction === "asc" ? 1 : -1;
}

/**
 * Verdict rank, high = better: a real Hit outranks a "not enough data" floor
 * hit, which outranks a Miss. (No-data rows never reach here — they are pulled
 * to the end before the key comparator runs.)
 */
function barRank(row: KpiSortRow): number {
  if (row.barHit && !row.barHitByFloor) {
    return 2;
  }
  if (row.barHitByFloor) {
    return 1;
  }
  return 0;
}

/** Effective percent for sorting: null (sorts last) when there is no rate. */
function percentValue(row: KpiSortRow): number | null {
  return row.applicable > 0 ? row.percent : null;
}

function compareByKey(left: KpiSortRow, right: KpiSortRow, sort: KpiSortState): number {
  const dir = directionMultiplier(sort.direction);
  switch (sort.key) {
    case "name":
      return nameCollator.compare(left.name, right.name) * dir;
    case "role":
      return nameCollator.compare(left.role, right.role) * dir;
    case "applicable":
      return (left.applicable - right.applicable) * dir;
    case "ontime":
      return (left.onTime - right.onTime) * dir;
    case "points":
      return (left.totalPoints - right.totalPoints) * dir;
    case "bar":
      return (barRank(left) - barRank(right)) * dir;
    case "percent": {
      const leftValue = percentValue(left);
      const rightValue = percentValue(right);
      // A missing rate always sinks below a real rate, in either direction.
      if (leftValue == null && rightValue == null) {
        return 0;
      }
      if (leftValue == null) {
        return 1;
      }
      if (rightValue == null) {
        return -1;
      }
      return (leftValue - rightValue) * dir;
    }
  }
}

/**
 * Order KPI rows for the Scores tab. Generic so callers can carry the original
 * user record on each row and read it back after sorting.
 */
export function sortKpiRows<T extends KpiSortRow>(rows: readonly T[], sort: KpiSortState): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      // No-data rows always last, regardless of key/direction.
      if (left.row.hasData !== right.row.hasData) {
        return left.row.hasData ? -1 : 1;
      }

      // Two no-data rows keep a stable, direction-independent name-asc order.
      const primary = left.row.hasData ? compareByKey(left.row, right.row, sort) : 0;
      if (primary !== 0) {
        return primary;
      }

      const nameTie = nameCollator.compare(left.row.name, right.row.name);
      if (nameTie !== 0) {
        return nameTie;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
