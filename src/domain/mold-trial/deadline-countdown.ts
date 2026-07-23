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
