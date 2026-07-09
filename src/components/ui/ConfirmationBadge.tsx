import type { DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
import { myPlateLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";

/**
 * A small pill rendering a trial's date-confirmation status (Feature 6). Extracted
 * from the /me plate sections so the calendar's day panel and phone agenda reuse
 * one component. Tone follows the owner's colour intent: confirmed = green,
 * pending / awaiting-Marketing = amber, returned = red, reschedule-proposed =
 * violet.
 */
export type ConfirmationTone = "amber" | "green" | "red" | "violet";

/** Short bilingual label + tone for a trial's date-confirmation status. */
export function dateConfirmationBadge(
  status: DateConfirmationStatus,
  locale: Locale
): { text: string; tone: ConfirmationTone } {
  switch (status) {
    case "CONFIRMED":
      return { text: pickLabel(myPlateLabels.dateConfirmed, locale), tone: "green" };
    case "RESCHEDULE_PROPOSED":
      return { text: pickLabel(myPlateLabels.changeAwaitingMarketing, locale), tone: "violet" };
    case "RETURNED_TO_PM":
      return { text: pickLabel(myPlateLabels.returnedToPm, locale), tone: "red" };
    case "PENDING_CONFIRMATION":
    default:
      return { text: pickLabel(myPlateLabels.datePendingConfirmation, locale), tone: "amber" };
  }
}

const toneClass: Record<ConfirmationTone, string> = {
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  violet: "bg-violet-100 text-violet-800"
};

export type ConfirmationBadgeProps = {
  status: DateConfirmationStatus;
  locale: Locale;
  className?: string;
};

export function ConfirmationBadge({ status, locale, className }: ConfirmationBadgeProps) {
  const badge = dateConfirmationBadge(status, locale);
  const classes = [
    "inline-flex items-center rounded-full px-2 py-0.5 text-[0.75rem] font-bold",
    toneClass[badge.tone],
    className
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{badge.text}</span>;
}
