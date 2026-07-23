import { dateConfirmationBadge } from "@/components/ui";
import type { DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
import { calendarLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import type { CalendarDayCell, CalendarMonthData } from "@/server/calendar";

/** Max compact trial entries shown in a day cell before the "+N more" chip. */
const MAX_CELL_ENTRIES = 3;

const WEEKDAY_HEADERS: Record<Locale, readonly string[]> = {
  // Monday-first, matching the Monday-start matrix.
  EN_US: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  ZH_CN: ["一", "二", "三", "四", "五", "六", "日"]
};

/** Text tone for a compact entry, keyed by confirmation status (owner colours). */
const entryToneClass: Record<DateConfirmationStatus, string> = {
  CONFIRMED: "text-green-700",
  PENDING_CONFIRMATION: "text-amber-700",
  RESCHEDULE_PROPOSED: "text-violet-700",
  RETURNED_TO_PM: "text-red-700"
};

/** The small machine-load dot for a day, or null when there is no warning. */
function LoadDot({ level, locale }: { level: CalendarDayCell["loadLevel"]; locale: Locale }) {
  if (level === "none") {
    return null;
  }
  const dotClass = level === "red" ? "bg-status-missed" : "bg-status-at-risk";
  const title = level === "red" ? pickLabel(calendarLabels.legendRed, locale) : pickLabel(calendarLabels.legendAmber, locale);
  return <span aria-label={title} title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />;
}

type MonthGridProps = {
  data: CalendarMonthData;
  /** Base path with query string builder — links keep the month, set/clear day. */
  hrefForDay: (dayKey: string) => string;
  locale: Locale;
  /** `YYYY-MM-DD` of today, for the outlined-today cell. */
  todayKey: string;
};

/**
 * Desktop month grid (hidden below md by the caller). Mon–Sun columns with
 * weekday headers; each day cell shows the day number, a trial-count chip, up to
 * three compact "PROJECT · TRIAL" entries coloured by confirmation status, a
 * "+N more" overflow, and an amber/red machine-load dot. Today is outlined,
 * outside-month days dimmed. Clicking a day is a server round-trip via the link.
 */
export function MonthGrid({ data, hrefForDay, locale, todayKey }: MonthGridProps) {
  const headers = WEEKDAY_HEADERS[locale];

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-card">
      <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50">
        {headers.map((header) => (
          <div key={header} className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-neutral-500">
            {header}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {data.weeks.flatMap((week) =>
          week.map((cell) => {
            const isToday = cell.date === todayKey;
            const isSelected = cell.date === data.selectedDay;
            const overflow = cell.trials.length - MAX_CELL_ENTRIES;
            const cellClasses = [
              "flex min-h-[7rem] flex-col gap-1 border-b border-r border-neutral-200 p-1.5 text-left align-top",
              cell.outsideMonth ? "bg-neutral-50 text-neutral-400" : "bg-white",
              isSelected ? "ring-2 ring-inset ring-brand-500" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <a key={cell.date} href={hrefForDay(cell.date)} className={cellClasses}>
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={[
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-bold",
                      isToday ? "bg-brand-600 text-white" : cell.outsideMonth ? "text-neutral-400" : "text-neutral-800"
                    ].join(" ")}
                  >
                    {cell.dayOfMonth}
                  </span>
                  <span className="flex items-center gap-1">
                    <LoadDot level={cell.loadLevel} locale={locale} />
                    {cell.trials.length === 0 ? null : (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-neutral-100 px-1.5 text-xs font-bold text-neutral-600">
                        {cell.trials.length}
                      </span>
                    )}
                  </span>
                </div>
                <div className="grid gap-0.5">
                  {cell.trials.slice(0, MAX_CELL_ENTRIES).map((trial) => (
                    <span
                      key={trial.trialEventId}
                      className={`truncate text-xs font-bold ${entryToneClass[trial.dateConfirmationStatus]}`}
                      title={`${trial.projectCode} · ${trial.trialCode} — ${dateConfirmationBadge(trial.dateConfirmationStatus, locale).text}`}
                    >
                      {trial.projectCode} · {trial.trialCode}
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span className="text-xs font-bold text-neutral-500">
                      +{overflow} {pickLabel(calendarLabels.more, locale)}
                    </span>
                  ) : null}
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Order the date-confirmation swatches appear in the legend. These are the SAME
 * four statuses `entryToneClass` colours the compact day-cell entries by, so the
 * swatch colours are read straight from that map (single source of truth) and the
 * legend can never drift from the grid.
 */
const CONFIRMATION_LEGEND: readonly DateConfirmationStatus[] = [
  "CONFIRMED",
  "PENDING_CONFIRMATION",
  "RESCHEDULE_PROPOSED",
  "RETURNED_TO_PM"
];

/**
 * Legend rendered under the grid: the amber/red machine-load dots plus what the
 * coloured day-cell entries mean. The entries are coloured by date-confirmation
 * status (NOT trial-code type), so the swatches reuse `entryToneClass` verbatim
 * (`bg-current` inherits that exact text colour) and the labels reuse the shared
 * `dateConfirmationBadge` text — truthful and bilingual by construction.
 */
export function MachineLoadLegend({ locale }: { locale: Locale }) {
  return (
    <div className="flex flex-col gap-2 px-1 text-sm text-neutral-600">
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-bold text-neutral-700">{pickLabel(calendarLabels.legendTitle, locale)}:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-at-risk" />
          {pickLabel(calendarLabels.legendAmber, locale)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-missed" />
          {pickLabel(calendarLabels.legendRed, locale)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-bold text-neutral-700">{pickLabel(calendarLabels.legendDateStatusTitle, locale)}:</span>
        {CONFIRMATION_LEGEND.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full bg-current ${entryToneClass[status]}`} />
            {dateConfirmationBadge(status, locale).text}
          </span>
        ))}
      </div>
    </div>
  );
}
