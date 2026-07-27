/**
 * Dev-slice window math — Asia/Shanghai calendar boundaries.
 *
 * Two ways to ask for a window, one shape out:
 *   --months N            N calendar months back, ending with today.
 *   --from A --to B       explicit inclusive business dates.
 *
 * Both produce a half-open instant range [start, end) where `start` is 00:00 on
 * the `from` day and `end` is 00:00 on the day AFTER the `to` day, both in the
 * Asia/Shanghai business timezone. Everything downstream compares timestamps
 * against that range, so "did anything happen on the last day of the window"
 * has one answer instead of two.
 *
 * Fixed +08:00 offset, matching `src/domain/mold-trial/management-reports.ts`:
 * China has observed no daylight saving since 1991, so a fixed offset is exact
 * for every date this system can hold and avoids a timezone database lookup in
 * arithmetic. `Intl` is still used to read "what day is it in Shanghai" from an
 * instant, because that question depends on the current offset rather than on
 * arithmetic over a known date.
 *
 * Pure module: no Prisma, no filesystem, no environment.
 */

export const SLICE_TIME_ZONE = "Asia/Shanghai";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lowest and highest accepted `--months N`. */
export const SLICE_MIN_MONTHS = 1;
export const SLICE_MAX_MONTHS = 12;

/**
 * Longest accepted explicit `--from/--to` span, in days. A slice is a window by
 * definition; an operator who needs "everything" wants `scripts/backup.sh`, not
 * this tool. 366 days keeps a full year (leap years included) reachable.
 */
export const SLICE_MAX_RANGE_DAYS = 366;

export type SliceWindowMode = "months" | "explicit";

export type SliceWindow = {
  mode: SliceWindowMode;
  /** Present only for `mode: "months"`. */
  months: number | null;
  /** Inclusive first business day, `YYYY-MM-DD`. */
  fromDateKey: string;
  /** Inclusive last business day, `YYYY-MM-DD`. */
  toDateKey: string;
  /** Inclusive lower bound instant (00:00 Asia/Shanghai on `fromDateKey`). */
  start: Date;
  /** EXCLUSIVE upper bound instant (00:00 Asia/Shanghai the day after `toDateKey`). */
  end: Date;
  timeZone: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` for an instant, read in the business timezone. */
export function shanghaiDateKey(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SLICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (year == null || month == null || day == null) {
    throw new Error("Unable to resolve the Asia/Shanghai business date.");
  }

  return `${year}-${month}-${day}`;
}

export function isSliceDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match == null) {
    return false;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

/** 00:00 Asia/Shanghai on a business date, as an instant. */
export function shanghaiDayStart(dateKey: string): Date {
  if (!isSliceDateKey(dateKey)) {
    throw new Error(`Invalid date "${dateKey}" (expected YYYY-MM-DD).`);
  }

  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) - SHANGHAI_OFFSET_MS);
}

/** Business date `dateKey` shifted by whole days, still `YYYY-MM-DD`. */
export function addBusinessDays(dateKey: string, days: number): string {
  const base = shanghaiDayStart(dateKey).getTime() + SHANGHAI_OFFSET_MS + days * DAY_MS;
  const shifted = new Date(base);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Whole days from `fromDateKey` to `toDateKey`, inclusive of both ends. */
export function inclusiveDaySpan(fromDateKey: string, toDateKey: string): number {
  const from = shanghaiDayStart(fromDateKey).getTime();
  const to = shanghaiDayStart(toDateKey).getTime();
  return Math.round((to - from) / DAY_MS) + 1;
}

function buildWindow(
  mode: SliceWindowMode,
  months: number | null,
  fromDateKey: string,
  toDateKey: string
): SliceWindow {
  return {
    mode,
    months,
    fromDateKey,
    toDateKey,
    start: shanghaiDayStart(fromDateKey),
    end: shanghaiDayStart(addBusinessDays(toDateKey, 1)),
    timeZone: SLICE_TIME_ZONE
  };
}

/**
 * `--months N`: N calendar months back from now, Asia/Shanghai.
 *
 * The window STARTS on the 1st of the month that is (N - 1) months before the
 * current Shanghai month and ENDS at the end of today. So `--months 1` is "this
 * month so far" and `--months 3` is "the 1st of the month before last, through
 * tonight". Whole-month starts keep two runs a week apart comparable; ending at
 * today (rather than at the end of this month) keeps the folder name honest —
 * it never claims to cover days that have not happened.
 */
export function sliceWindowFromMonths(months: number, now: Date): SliceWindow {
  if (!Number.isInteger(months) || months < SLICE_MIN_MONTHS || months > SLICE_MAX_MONTHS) {
    throw new Error(
      `--months must be a whole number between ${SLICE_MIN_MONTHS} and ${SLICE_MAX_MONTHS} (got ${months}).`
    );
  }

  const today = shanghaiDateKey(now);
  const year = Number.parseInt(today.slice(0, 4), 10);
  const monthIndex = Number.parseInt(today.slice(5, 7), 10) - 1;
  const firstMonth = new Date(Date.UTC(year, monthIndex - (months - 1), 1));
  const fromDateKey = `${firstMonth.getUTCFullYear()}-${pad2(firstMonth.getUTCMonth() + 1)}-01`;

  return buildWindow("months", months, fromDateKey, today);
}

/** `--from A --to B`: explicit inclusive business dates. */
export function sliceWindowFromDates(fromDateKey: string, toDateKey: string): SliceWindow {
  if (!isSliceDateKey(fromDateKey)) {
    throw new Error(`--from must be a real calendar date as YYYY-MM-DD (got "${fromDateKey}").`);
  }

  if (!isSliceDateKey(toDateKey)) {
    throw new Error(`--to must be a real calendar date as YYYY-MM-DD (got "${toDateKey}").`);
  }

  if (fromDateKey > toDateKey) {
    throw new Error(`--from ${fromDateKey} is after --to ${toDateKey}.`);
  }

  const span = inclusiveDaySpan(fromDateKey, toDateKey);
  if (span > SLICE_MAX_RANGE_DAYS) {
    throw new Error(
      `Window is ${span} days; a slice is capped at ${SLICE_MAX_RANGE_DAYS}. Use a shorter range — a whole-database copy is scripts/backup.sh, not a slice.`
    );
  }

  return buildWindow("explicit", null, fromDateKey, toDateKey);
}

/** Half-open membership test: `start <= at < end`. */
export function isWithinSliceWindow(window: SliceWindow, at: Date | null | undefined): boolean {
  if (at == null || Number.isNaN(at.getTime())) {
    return false;
  }

  return at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime();
}

/** Directory name for a slice, e.g. `moldpilot-slice-2026-05-01_2026-07-27`. */
export function sliceDirectoryName(window: SliceWindow): string {
  return `moldpilot-slice-${window.fromDateKey}_${window.toDateKey}`;
}
