/**
 * KPI scoring engine — PURE domain logic (no Prisma, no I/O). Takes plain event
 * records plus the active rule config and produces a per-user monthly
 * scorecard: the habit bar (item-by-item, like the poster's 适用/按时/结果
 * table), the bar verdict, and the severity-weighted verified-issue points.
 *
 * Semantics (docs/06-kpi/kpi-system-design.md v2):
 *  - An event is "applicable" if it happened in the scored month.
 *  - On-time = the action completed within the rule's deadline. Deadlines are
 *    literal hours from `dueAt` (weekends count); boolean rules pass/fail with
 *    no clock.
 *  - A not-yet-done event with `dueAt` in the future is EXCLUDED (pending), not
 *    counted late. A not-yet-done event already past its due is counted late.
 *  - The bar is hit when on-time/applicable >= 85% OR fewer than 5 events are
 *    applicable (the "quiet month" protection).
 *  - Points: only issues with a verification trial count; severity-weighted;
 *    pending-verification issues show a provisional-zero row.
 */

import {
  barHitPercent,
  HOT_3_MULTIPLIER,
  minApplicableForBar,
  severityWeight,
  type KpiRuleCode,
  type SeverityDbValue
} from "./kpi-rules.ts";

/** Rule config as the engine needs it (a thin projection of a KpiRule row). */
export type ScoringRule = {
  code: KpiRuleCode;
  /** Literal hours deadline; null => boolean rule (pass/fail, no clock). */
  hours: number | null;
  active: boolean;
};

/**
 * One applicable habit event attributed to a single user. `dueAt` is when the
 * clock started + the rule window; `doneAt` is when the action completed (null
 * = not done yet). For boolean rules, `passed` decides on-time and dueAt/doneAt
 * are ignored.
 */
export type KpiHabitEvent = {
  ruleCode: KpiRuleCode;
  userId: string;
  /** Stable reference shown in the drilldown (e.g. project code + trial). */
  ref: string;
  dueAt: Date | null;
  doneAt: Date | null;
  /** Only meaningful for boolean rules. */
  passed?: boolean;
};

/** One verified-issue points candidate attributed to a single user. */
export type KpiPointsEvent = {
  userId: string;
  issueRef: string;
  severity: SeverityDbValue;
  /** True once the issue has a verification trial (verifiedAtTrialEventId set). */
  verified: boolean;
};

/** Per-item audit row (the drilldown behind every bar line). */
export type ScorecardItem = {
  ref: string;
  dueAt: Date | null;
  doneAt: Date | null;
  onTime: boolean;
};

/** One behavior row in the bar table (poster's 适用/按时/结果 line). */
export type ScorecardRuleLine = {
  ruleCode: KpiRuleCode;
  applicable: number;
  onTime: number;
  items: ScorecardItem[];
};

/** One row in the points table (poster's fix-by-fix line). */
export type ScorecardPointsLine = {
  issueRef: string;
  severity: SeverityDbValue;
  weight: number;
  verified: boolean;
  /** Points actually counted this month (0 while pending verification). */
  counted: number;
};

export type Scorecard = {
  userId: string;
  lines: ScorecardRuleLine[];
  applicable: number;
  onTime: number;
  /** Whole-number percent (rounded); 100 when nothing applicable. */
  percent: number;
  barHit: boolean;
  /** True when barHit is granted by the <5-events floor rather than the rate. */
  barHitByFloor: boolean;
  points: ScorecardPointsLine[];
  totalPoints: number;
};

/**
 * Decide whether a single event is on-time. Returns `null` when the event is
 * PENDING and must be excluded from the applicable count entirely (not done,
 * clock-based rule, due still in the future relative to `now`).
 */
export function evaluateEventOnTime(
  event: KpiHabitEvent,
  rule: ScoringRule,
  now: Date
): boolean | null {
  // Boolean rule: no clock; the explicit pass/fail flag decides.
  if (rule.hours == null) {
    return event.passed === true;
  }

  // Clock-based rule.
  if (event.doneAt != null) {
    if (event.dueAt == null) {
      // No known deadline but the action happened — treat as on-time (we never
      // penalize when we cannot prove lateness).
      return true;
    }
    return event.doneAt.getTime() <= event.dueAt.getTime();
  }

  // Not done yet.
  if (event.dueAt == null) {
    // Cannot prove lateness and nothing to measure against — exclude.
    return null;
  }

  if (now.getTime() > event.dueAt.getTime()) {
    // Past due and still not done => late.
    return false;
  }

  // Still within the window and not done => pending, exclude from applicable.
  return null;
}

function roundPercent(onTime: number, applicable: number): number {
  if (applicable === 0) {
    return 100;
  }
  return Math.round((onTime / applicable) * 100);
}

/**
 * Build a single user's monthly scorecard from their attributed events and the
 * points candidates. Events for inactive rules are ignored. `now` decides the
 * pending/late boundary for not-yet-done clock events.
 */
export function computeScorecard(input: {
  userId: string;
  habitEvents: readonly KpiHabitEvent[];
  pointsEvents: readonly KpiPointsEvent[];
  rules: readonly ScoringRule[];
  now: Date;
}): Scorecard {
  const ruleByCode = new Map<KpiRuleCode, ScoringRule>();
  for (const rule of input.rules) {
    if (rule.active) {
      ruleByCode.set(rule.code, rule);
    }
  }

  const linesByCode = new Map<KpiRuleCode, ScorecardRuleLine>();

  for (const event of input.habitEvents) {
    if (event.userId !== input.userId) {
      continue;
    }
    const rule = ruleByCode.get(event.ruleCode);
    if (rule == null) {
      continue;
    }

    const onTime = evaluateEventOnTime(event, rule, input.now);
    if (onTime == null) {
      // Pending — excluded from applicable entirely.
      continue;
    }

    let line = linesByCode.get(event.ruleCode);
    if (line == null) {
      line = { ruleCode: event.ruleCode, applicable: 0, onTime: 0, items: [] };
      linesByCode.set(event.ruleCode, line);
    }
    line.applicable += 1;
    if (onTime) {
      line.onTime += 1;
    }
    line.items.push({ ref: event.ref, dueAt: event.dueAt, doneAt: event.doneAt, onTime });
  }

  const lines = [...linesByCode.values()];
  const applicable = lines.reduce((sum, line) => sum + line.applicable, 0);
  const onTime = lines.reduce((sum, line) => sum + line.onTime, 0);
  const percent = roundPercent(onTime, applicable);
  const barHitByFloor = applicable < minApplicableForBar;
  const barHit = barHitByFloor || percent >= barHitPercent;

  const points: ScorecardPointsLine[] = [];
  let totalPoints = 0;
  for (const pointsEvent of input.pointsEvents) {
    if (pointsEvent.userId !== input.userId) {
      continue;
    }
    const weight = severityWeight(pointsEvent.severity);
    const counted = pointsEvent.verified ? weight * HOT_3_MULTIPLIER : 0;
    totalPoints += counted;
    points.push({
      issueRef: pointsEvent.issueRef,
      severity: pointsEvent.severity,
      weight,
      verified: pointsEvent.verified,
      counted
    });
  }

  return {
    userId: input.userId,
    lines,
    applicable,
    onTime,
    percent,
    barHit,
    barHitByFloor,
    points,
    totalPoints
  };
}

/**
 * Aggregate several users' scorecards into a department rollup percent (a
 * leader's card additionally shows their group's aggregate — v2 "group data").
 * Sums applicable/on-time across members; the <5 floor applies to the group
 * total too.
 */
export function computeDepartmentRollup(scorecards: readonly Scorecard[]): {
  applicable: number;
  onTime: number;
  percent: number;
  barHit: boolean;
  barHitByFloor: boolean;
} {
  const applicable = scorecards.reduce((sum, card) => sum + card.applicable, 0);
  const onTime = scorecards.reduce((sum, card) => sum + card.onTime, 0);
  const percent = roundPercent(onTime, applicable);
  const barHitByFloor = applicable < minApplicableForBar;
  const barHit = barHitByFloor || percent >= barHitPercent;
  return { applicable, onTime, percent, barHit, barHitByFloor };
}
