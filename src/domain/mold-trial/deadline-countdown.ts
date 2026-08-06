/**
 * Pure deadline-countdown math for the phone task list (/me "My Plate").
 *
 * A task card's countdown chip and the monthly scoring engine's on-time verdict
 * share ONE source of truth: the per-rule anchor (clock start) comes from the
 * exported helpers in `src/server/kpi-events.ts`, and the anchor + the rule's
 * literal-hours window is turned into a `dueAt` by {@link computeDeadline} here —
 * the same function `kpi-events.ts` uses for its scoring windows. This module is
 * PURE (no Prisma, no I/O): it only turns (anchor, hours, now) into the signed
 * hours-remaining and the small display/tone/sort primitives the chip renders.
 *
 * Display rules (bilingual, per the owner's spec):
 *  - remaining ≥ 1h  → "Nh left / 剩N小时"      (round DOWN)
 *  - 0 ≤ remaining <1h → "<1h left / 不足1小时"
 *  - overdue (<0)     → "Nh overdue / 超时N小时" (round UP)
 * Tone: neutral gray normally; amber when ≤ 8h remaining; red when overdue.
 */

import type { Locale } from "./labels.ts";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Amber threshold: at or under this many hours remaining the chip turns amber. */
export const countdownAmberHours = 8;

export type CountdownTone = "neutral" | "amber" | "red";

/**
 * The rule's clock-start anchor plus its literal-hours window → the deadline
 * instant. Identical math to the scoring engine's window (weekends count), so a
 * chip's `dueAt` and the scorer's `dueAt` for the same event always agree.
 */
export function computeDeadline(anchor: Date, hours: number): Date {
  return new Date(anchor.getTime() + hours * MS_PER_HOUR);
}

/**
 * Signed hours remaining until `dueAt`, measured from `now`. Positive = time
 * left; negative = overdue. Unrounded — callers round at display time so the
 * boundary rules (floor when counting down, ceil when overdue) stay in one place.
 */
export function remainingHours(dueAt: Date, now: Date): number {
  return (dueAt.getTime() - now.getTime()) / MS_PER_HOUR;
}

/**
 * The compact chip text. `remaining` is the signed hours from
 * {@link remainingHours}. Round-down while counting down, round-up when overdue,
 * and a dedicated "<1h" band so a nearly-due task never reads "0h left".
 */
export function formatCountdown(remaining: number, locale: Locale): string {
  const zh = locale === "ZH_CN";

  if (remaining < 0) {
    const hours = Math.ceil(-remaining);
    return zh ? `超时${hours}小时` : `${hours}h overdue`;
  }

  if (remaining < 1) {
    return zh ? "不足1小时" : "<1h left";
  }

  const hours = Math.floor(remaining);
  return zh ? `剩${hours}小时` : `${hours}h left`;
}

/**
 * Whole calendar days a `dueDate` is past `now`, each reduced to its UTC calendar
 * day so a few hours either side of midnight never rounds a same-day item up to
 * "1 day". Returns 0 when the due date is today or still in the future. Pure —
 * the caller captures a single request-time `now` (V10 desktop overdue chips).
 */
export function overdueDays(dueDate: Date, now: Date): number {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - due) / MS_PER_DAY));
}

/**
 * The compact bilingual overdue suffix — "overdue N days" / "已超期N天" — for a
 * server-rendered management date, or null when the item is not actually overdue
 * (N < 1) so the caller appends nothing. Mirrors {@link formatCountdown}'s
 * locale-literal style (English pluralises; Chinese does not).
 */
export function formatOverdueDays(days: number, locale: Locale): string | null {
  if (days < 1) {
    return null;
  }
  if (locale === "ZH_CN") {
    return `已超期${days}天`;
  }
  return `overdue ${days} ${days === 1 ? "day" : "days"}`;
}

/* ------------------------- Trial-deadline countdown ------------------------- */

/**
 * Amber threshold for the trial-deadline chip: three days. The trial date is a
 * calendar wall, not an hours SLA, so it warns far earlier than the 8h rule
 * chips above — 72h is the same window the assembly self-check chip already
 * uses, kept identical on purpose so the two never disagree on a card.
 */
export const trialCountdownAmberHours = 72;

/** Which date set a trial chip's urgency. */
export type TrialUrgencySource = "ISSUE_DUE" | "NEXT_TRIAL";

export type TrialCountdown = {
  /** Signed hours until the next planned trial. Drives the chip TEXT. */
  trialHours: number;
  /**
   * Signed hours until whichever comes first, the issue's own due date or the
   * trial. Drives the chip TONE and the card stripe.
   */
  urgencyHours: number;
  /** Which of the two dates won. */
  urgencySource: TrialUrgencySource;
};

/**
 * The trial-deadline countdown for one open issue.
 *
 * The chip always speaks about the trial ("距试模 3天 · Aug 8") because that is
 * the fact the handler needs — a fix that lands after the mold is on the machine
 * is worthless. But the URGENCY is the earlier of the two dates: an issue due
 * tomorrow on a project trialling next week is already urgent, and colouring it
 * by the trial alone would under-report that.
 *
 * Returns null when there is no upcoming trial date — the chip is a trial chip;
 * with no trial there is nothing to count down to. A missing issue due date is
 * fine and simply leaves the trial as the only candidate.
 *
 * Pure: the caller passes one request-time `now`.
 */
export function trialCountdown(
  input: { dueDate: Date | null | undefined; nextTrialDate: Date | null | undefined },
  now: Date
): TrialCountdown | null {
  if (input.nextTrialDate == null) {
    return null;
  }

  const trialHours = remainingHours(input.nextTrialDate, now);

  if (input.dueDate == null) {
    return { trialHours, urgencyHours: trialHours, urgencySource: "NEXT_TRIAL" };
  }

  const dueHours = remainingHours(input.dueDate, now);

  // Strictly-earlier wins; a tie reports the trial, because the trial is the
  // date the whole shop is scheduled around.
  return dueHours < trialHours
    ? { trialHours, urgencyHours: dueHours, urgencySource: "ISSUE_DUE" }
    : { trialHours, urgencyHours: trialHours, urgencySource: "NEXT_TRIAL" };
}

/**
 * Tone for a trial-deadline chip: red once the effective deadline has passed
 * (overdue issue OR the trial date is behind us), amber inside 72h, otherwise
 * neutral. Same three-tone palette as {@link countdownTone}, wider window.
 */
export function trialCountdownTone(urgencyHours: number): CountdownTone {
  if (urgencyHours < 0) {
    return "red";
  }
  if (urgencyHours <= trialCountdownAmberHours) {
    return "amber";
  }
  return "neutral";
}

/**
 * The chip text for hours-to-trial: days once a day or more remains, hours
 * inside the last day, and a past-trial form when the date has gone by. Mirrors
 * {@link formatCountdown}'s rounding contract — floor while counting down, ceil
 * when past — so a chip never reads "0".
 */
export function formatTrialCountdown(trialHours: number, locale: Locale): string {
  const zh = locale === "ZH_CN";

  if (trialHours < 0) {
    const elapsed = -trialHours;

    // Inside the first day past the trial, hours still read as hours — "1d past
    // trial" for a trial that started ten minutes ago would be a lie.
    if (elapsed < 24) {
      const hours = Math.max(1, Math.ceil(elapsed));
      return zh ? `试模已过${hours}小时` : `${hours}h past trial`;
    }

    const days = Math.ceil(elapsed / 24);
    return zh ? `试模已过${days}天` : `${days}d past trial`;
  }

  if (trialHours < 1) {
    return zh ? "距试模不足1小时" : "<1h to trial";
  }

  if (trialHours < 24) {
    const hours = Math.floor(trialHours);
    return zh ? `距试模${hours}小时` : `${hours}h to trial`;
  }

  const days = Math.floor(trialHours / 24);
  return zh ? `距试模${days}天` : `${days}d to trial`;
}

const shortMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
] as const;

/**
 * "MMM d" / "M月D日" for a `YYYY-MM-DD` string. Deliberately string math, not
 * `Intl` or `Date`: the input is already a calendar date the server picked, and
 * re-parsing it into a Date would reintroduce the timezone shift that turns
 * Aug 8 into Aug 7 for anyone west of UTC. Returns the input unchanged if it is
 * not a well-formed date string.
 */
export function formatTrialDateShort(isoDate: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);

  if (match == null) {
    return isoDate;
  }

  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    return isoDate;
  }

  return locale === "ZH_CN" ? `${month}月${day}日` : `${shortMonthNames[month - 1]} ${day}`;
}

/** Tone for a chip given its signed hours-remaining. */
export function countdownTone(remaining: number): CountdownTone {
  if (remaining < 0) {
    return "red";
  }
  if (remaining <= countdownAmberHours) {
    return "amber";
  }
  return "neutral";
}

/**
 * Urgency comparator for a countdown-bearing plate section: most urgent first,
 * overdue (most negative remaining) at the very top, and rows without a chip
 * (`remainingHours == null` — inactive rule or missing anchor) sink to the end.
 * Returns 0 on ties so a stable pre-sort (e.g. by date) survives as the
 * tiebreaker.
 */
export function compareByCountdownUrgency(
  a: { remainingHours: number | null },
  b: { remainingHours: number | null }
): number {
  if (a.remainingHours == null && b.remainingHours == null) {
    return 0;
  }
  if (a.remainingHours == null) {
    return 1;
  }
  if (b.remainingHours == null) {
    return -1;
  }
  if (a.remainingHours === b.remainingHours) {
    return 0;
  }
  return a.remainingHours < b.remainingHours ? -1 : 1;
}
