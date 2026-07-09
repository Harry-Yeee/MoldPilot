/**
 * Pure calendar domain for Feature 7 (trial calendar).
 *
 * No Prisma, no React, no clock: every function here is a total function over
 * plain values so the month-matrix layout, per-day grouping, and per-machine
 * load warnings stay unit-testable in isolation. Dates are handled as
 * `YYYY-MM-DD` strings in UTC — the same canonical day key the rest of the
 * codebase uses — so there is never a timezone-drift surprise at a month edge.
 *
 * Machine-load rule (owner decision): a soft warning only, never a hard block.
 * Amber when any single machine has >= 3 trials on one day, red at >= 4. Trials
 * with no machine assigned go to a "no machine" bucket that NEVER warns.
 */

/** Amber threshold: >= this many trials on ONE machine in ONE day. */
export const MACHINE_LOAD_AMBER_THRESHOLD = 3;
/** Red threshold: >= this many trials on ONE machine in ONE day. */
export const MACHINE_LOAD_RED_THRESHOLD = 4;

/** Warning severity for a single day's machine load. */
export type MachineLoadLevel = "none" | "amber" | "red";

/** One day cell in the month matrix. */
export type CalendarDay = {
  /** Canonical `YYYY-MM-DD` day key (UTC). */
  date: string;
  /** Day-of-month number (1..31). */
  dayOfMonth: number;
  /** True for leading/trailing days that belong to an adjacent month. */
  outsideMonth: boolean;
};

/** A full month laid out as Monday-start weeks. */
export type MonthMatrix = {
  /** The requested month, normalised to `YYYY-MM`. */
  month: string;
  /** Weeks, each exactly 7 days, Monday-first. */
  weeks: CalendarDay[][];
};

/** The minimal shape the calendar reasons about for one trial. */
export type CalendarTrialLike = {
  /** Canonical planned-date day key, `YYYY-MM-DD`. */
  plannedDate: string;
  /** Injection machine id, or null when none is assigned yet. */
  injectionMachineId: string | null;
};

/** Per-machine tally for one day (a real machine, never the no-machine bucket). */
export type MachineLoadEntry = {
  injectionMachineId: string;
  count: number;
};

/** The machine-load summary for a single day. */
export type MachineLoadForDay = {
  /** Per-machine counts, sorted by count desc then id asc (stable, testable). */
  perMachine: MachineLoadEntry[];
  /** Trials with no machine assigned — counted, but never drives a warning. */
  noMachineCount: number;
  /** Highest single-machine count on the day (0 when only no-machine trials). */
  maxOnOneMachine: number;
  /** Overall warning level derived from `maxOnOneMachine`. */
  level: MachineLoadLevel;
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function isValidMonthParts(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
}

/**
 * Parse a `YYYY-MM` string into `{ year, month }` (month 1..12). Throws on a
 * malformed value so a bad `?month=` param surfaces loudly rather than silently
 * rendering the wrong month.
 */
export function parseMonthKey(yyyyMm: string): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(yyyyMm);
  if (match == null) {
    throw new Error(`Invalid month key: ${yyyyMm}`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);

  if (!isValidMonthParts(year, month)) {
    throw new Error(`Invalid month key: ${yyyyMm}`);
  }

  return { year, month };
}

/** Zero-pad a positive integer to two digits. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Canonical `YYYY-MM` for a year + month (1..12). */
export function formatMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}`;
}

/** Canonical `YYYY-MM-DD` for a UTC date. */
function dayKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The `YYYY-MM` one month before or after `yyyyMm`. Handles the year rollover
 * (Jan -> prev Dec, Dec -> next Jan). Used for the prev/next controls.
 */
export function shiftMonth(yyyyMm: string, deltaMonths: number): string {
  const { year, month } = parseMonthKey(yyyyMm);
  // month is 1..12; convert to a 0-based absolute index, shift, convert back.
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = zeroBased - newYear * 12 + 1;
  return formatMonthKey(newYear, newMonth);
}

/**
 * Monday-based weekday index for a UTC date: Monday = 0 .. Sunday = 6.
 * (JS `getUTCDay` is Sunday = 0 .. Saturday = 6.)
 */
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Build the month grid for `yyyyMm` as Monday-start weeks of `CalendarDay`.
 * Leading days from the previous month and trailing days from the next month
 * fill the first and last weeks so every week has 7 cells; those carry
 * `outsideMonth: true`. The grid always spans whole weeks (so a month starting
 * on Sunday, Monday-start, gets a full leading week from the previous month).
 */
export function buildMonthMatrix(yyyyMm: string): MonthMatrix {
  const { year, month } = parseMonthKey(yyyyMm);

  // First day of the requested month (UTC) and how many leading days precede it
  // back to the most recent Monday.
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leading = mondayIndex(firstOfMonth);

  // Start iterating from that Monday.
  const start = new Date(firstOfMonth);
  start.setUTCDate(start.getUTCDate() - leading);

  // Number of days in the requested month.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);

  for (let cell = 0; cell < totalCells; cell += 1) {
    if (cell % 7 === 0) {
      weeks.push([]);
    }

    weeks[weeks.length - 1].push({
      date: dayKeyFromDate(cursor),
      dayOfMonth: cursor.getUTCDate(),
      outsideMonth: cursor.getUTCMonth() !== month - 1 || cursor.getUTCFullYear() !== year
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { month: formatMonthKey(year, month), weeks };
}

/** The `YYYY-MM-DD` of the first and last cell of a matrix (inclusive range). */
export function monthMatrixRange(matrix: MonthMatrix): { start: string; end: string } {
  const firstWeek = matrix.weeks[0];
  const lastWeek = matrix.weeks[matrix.weeks.length - 1];
  return {
    start: firstWeek[0].date,
    end: lastWeek[lastWeek.length - 1].date
  };
}

/**
 * Group trials by their planned-date day key. Returns a Map keyed by
 * `YYYY-MM-DD`; a day with no trials is simply absent. Input order is preserved
 * within each day so the caller controls display ordering.
 */
export function groupTrialsByDay<T extends { plannedDate: string }>(trials: readonly T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();

  for (const trial of trials) {
    const list = byDay.get(trial.plannedDate);
    if (list == null) {
      byDay.set(trial.plannedDate, [trial]);
    } else {
      list.push(trial);
    }
  }

  return byDay;
}

/**
 * Whole days from `plannedDate` to `targetDate` (target − planned), both
 * `YYYY-MM-DD`: positive when the trial is planned before the customer target,
 * negative when after (a slip), zero on the target day. Null when either date is
 * missing or unparseable. Pure and UTC-day based — feeds the day-panel
 * planned-vs-target hint without a clock.
 */
export function daysFromPlannedToTarget(
  plannedDate: string | null | undefined,
  targetDate: string | null | undefined
): number | null {
  if (plannedDate == null || targetDate == null) {
    return null;
  }

  const planned = Date.parse(`${plannedDate}T00:00:00.000Z`);
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(planned) || Number.isNaN(target)) {
    return null;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target - planned) / millisecondsPerDay);
}

/** Map a highest single-machine count to a warning level. */
export function machineLoadLevel(maxOnOneMachine: number): MachineLoadLevel {
  if (maxOnOneMachine >= MACHINE_LOAD_RED_THRESHOLD) {
    return "red";
  }
  if (maxOnOneMachine >= MACHINE_LOAD_AMBER_THRESHOLD) {
    return "amber";
  }
  return "none";
}

/**
 * Tally one day's trials per injection machine and derive the warning level.
 *
 * Only real machines count toward the warning: the highest single-machine count
 * drives amber (>= 3) / red (>= 4). Trials with no machine assigned are counted
 * into `noMachineCount` for display but NEVER raise a warning — an unassigned
 * pile-up is not a machine-capacity problem.
 */
export function machineLoadForDay(trials: readonly CalendarTrialLike[]): MachineLoadForDay {
  const counts = new Map<string, number>();
  let noMachineCount = 0;

  for (const trial of trials) {
    if (trial.injectionMachineId == null) {
      noMachineCount += 1;
      continue;
    }
    counts.set(trial.injectionMachineId, (counts.get(trial.injectionMachineId) ?? 0) + 1);
  }

  const perMachine: MachineLoadEntry[] = [...counts.entries()]
    .map(([injectionMachineId, count]) => ({ injectionMachineId, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.injectionMachineId.localeCompare(b.injectionMachineId)));

  const maxOnOneMachine = perMachine.length === 0 ? 0 : perMachine[0].count;

  return {
    perMachine,
    noMachineCount,
    maxOnOneMachine,
    level: machineLoadLevel(maxOnOneMachine)
  };
}
