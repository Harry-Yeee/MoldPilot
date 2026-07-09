import { ConfirmationBadge, EmptyState } from "@/components/ui";
import { calendarLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import type { TrialAgendaData } from "@/server/calendar";

/**
 * Read-only 7-day agenda of planned trials (all projects), grouped by day with
 * empty days skipped. Server-rendered so it can be embedded in both the phone
 * `/calendar` route and the mobile dashboard section — one component, never
 * forked. Each row shows the project code, trial code, machine (or "no machine
 * yet"), and the date-confirmation badge.
 */
export type TrialAgendaProps = {
  agenda: TrialAgendaData;
  locale: Locale;
  /** `YYYY-MM-DD` of today, for the "Today"/"Tomorrow" day tags. */
  todayKey: string;
};

const WEEKDAY_LABELS: Record<Locale, readonly string[]> = {
  EN_US: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ZH_CN: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
};

/** `YYYY-MM-DD` one day after `dayKey` (UTC). */
function nextDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** A short bilingual day header: "Today · Mon, 07-06" style context. */
function dayHeading(dayKey: string, todayKey: string, locale: Locale): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const weekday = WEEKDAY_LABELS[locale][date.getUTCDay()];
  const monthDay = dayKey.slice(5); // MM-DD
  const base = `${weekday}, ${monthDay}`;

  if (dayKey === todayKey) {
    return `${pickLabel(calendarLabels.todayTag, locale)} · ${base}`;
  }
  if (dayKey === nextDayKey(todayKey)) {
    return `${pickLabel(calendarLabels.tomorrowTag, locale)} · ${base}`;
  }
  return base;
}

export function TrialAgenda({ agenda, locale, todayKey }: TrialAgendaProps) {
  if (agenda.days.length === 0) {
    return <EmptyState message={pickLabel(calendarLabels.agendaEmpty, locale)} />;
  }

  return (
    <div className="grid gap-4">
      {agenda.days.map((day) => (
        <section key={day.date} className="grid gap-2">
          <h3 className="m-0 text-[0.8125rem] font-bold uppercase tracking-wide text-neutral-500">
            {dayHeading(day.date, todayKey, locale)}
          </h3>
          <div className="grid gap-2">
            {day.trials.map((trial) => (
              <div
                key={trial.trialEventId}
                className="grid gap-1 rounded-lg border border-neutral-300 bg-white p-3 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.9375rem] font-bold text-neutral-900 [overflow-wrap:anywhere]">
                    {trial.projectCode} · {trial.trialCode}
                  </span>
                  <ConfirmationBadge status={trial.dateConfirmationStatus} locale={locale} />
                </div>
                <span className="text-sm text-neutral-600 [overflow-wrap:anywhere]">
                  {trial.customerShortName}
                  {" · "}
                  {trial.machineLabel ?? pickLabel(calendarLabels.noMachineYet, locale)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
