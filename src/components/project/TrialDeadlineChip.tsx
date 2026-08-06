import {
  formatTrialCountdown,
  formatTrialDateShort,
  trialCountdown,
  trialCountdownTone,
  type CountdownTone
} from "@/domain/mold-trial/deadline-countdown";
import { myPlateLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";

/**
 * The trial-deadline chip: "距试模 3天 · Aug 8".
 *
 * One issue the pilot raised twice: an open issue's own due date says nothing
 * about the date the whole shop is scheduled around. A correction that lands the
 * morning after the mold is already on the machine costs a whole trial. So every
 * open-issue card that a handler works from now states the next planned trial
 * and how far away it is.
 *
 * Tone follows the EARLIER of the issue's due date and the trial (amber inside
 * 72h, red once either has passed), while the text always names the trial — the
 * colour tells you how urgent, the words tell you what for.
 *
 * Deliberately NOT a client component: it has no state and no hooks, so the same
 * file renders inside the server-rendered project page and inside the "use
 * client" phone plate sections.
 *
 * Display only. Nothing here feeds KPI scoring — `asm.self_check` already
 * encodes "before next trial" as the assembly rule, and that rule is untouched.
 */

const toneClass: Record<CountdownTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800"
};

export type TrialDeadlineChipProps = {
  /** Signed hours until the trial; drives the chip text. */
  trialHours: number;
  /** Signed hours until the earlier of the issue due date and the trial; drives tone. */
  urgencyHours: number;
  /** The trial date as `YYYY-MM-DD`; rendered as "MMM d" / "M月D日". */
  trialDate: string;
  locale: Locale;
};

export function TrialDeadlineChip({ trialHours, urgencyHours, trialDate, locale }: TrialDeadlineChipProps) {
  const tone = trialCountdownTone(urgencyHours);
  // Tooltip carries the unambiguous ISO date; the chip itself stays compact.
  const title = `${pickLabel(myPlateLabels.nextPlannedTrial, locale)} ${trialDate}`;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.75rem] font-bold ${toneClass[tone]}`}
      title={title}
    >
      {formatTrialCountdown(trialHours, locale)} · {formatTrialDateShort(trialDate, locale)}
    </span>
  );
}

export type IssueTrialDeadlineChipProps = {
  /** The issue's own due date; only affects the tone. */
  dueDate: Date | null;
  /** The project's next planned trial date; no chip without one. */
  nextTrialDate: Date | null;
  /** Request-time clock, captured once by the caller. */
  now: Date;
  locale: Locale;
};

/**
 * The same chip for server surfaces that hold raw `Date`s (the desktop trial
 * issue table) instead of a prepared plate row. Renders nothing when the project
 * has no upcoming planned trial.
 */
export function IssueTrialDeadlineChip({ dueDate, nextTrialDate, now, locale }: IssueTrialDeadlineChipProps) {
  const countdown = trialCountdown({ dueDate, nextTrialDate }, now);

  if (countdown == null || nextTrialDate == null) {
    return null;
  }

  return (
    <TrialDeadlineChip
      trialHours={countdown.trialHours}
      urgencyHours={countdown.urgencyHours}
      trialDate={nextTrialDate.toISOString().slice(0, 10)}
      locale={locale}
    />
  );
}
