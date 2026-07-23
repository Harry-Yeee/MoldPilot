import { MessageBanner } from "@/components/ui";
import { formatMonthKey, parseMonthKey, shiftMonth } from "@/domain/mold-trial/calendar";
import { calendarLabels, navLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { createTranslator } from "@/i18n";
import { getCurrentLanguage, getDictionary } from "@/i18n/server";
import { DayPanel } from "@/app/calendar/day-panel";
import { MachineLoadLegend, MonthGrid } from "@/app/calendar/month-grid";
import { TrialAgenda } from "@/app/calendar/trial-agenda";
import {
  getCalendarMonthData,
  getTrialAgendaData,
  type CalendarMonthData,
  type TrialAgendaData
} from "@/server/calendar";
import { getCurrentUser } from "@/server/current-user";
import { getEffectivePermissionCodes } from "@/server/permissions";
import { getNavVisibility } from "@/server/nav";
import { AppHeader } from "@/components/layout/AppHeader";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function stringParam(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

/** The current month `YYYY-MM` from a Date (UTC). */
function currentMonthKey(now: Date): string {
  return formatMonthKey(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/** A `YYYY-MM-DD` day key belongs to the visible month grid range? (cheap guard). */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Build the calendar URL for a given month, optionally selecting a day. */
function calendarHref(month: string, day: string | null): string {
  const query = new URLSearchParams({ month });
  if (day != null) {
    query.set("day", day);
  }
  return `/calendar?${query.toString()}`;
}

export default async function CalendarPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todayInput = todayKey;

  const currentUser = await getCurrentUser();
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const canProposeChange = permissionCodes.has("trial.date.propose_change");
  const nav = await getNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code
  });

  const t = createTranslator(await getDictionary());
  const locale: Locale = (await getCurrentLanguage()) === "zh-CN" ? "ZH_CN" : "EN_US";

  // Resolve the requested month (default: current). A malformed ?month= falls
  // back to the current month rather than throwing a 500.
  const requestedMonth = stringParam(params, "month");
  let month = currentMonthKey(now);
  if (requestedMonth != null) {
    try {
      parseMonthKey(requestedMonth);
      month = requestedMonth;
    } catch {
      month = currentMonthKey(now);
    }
  }

  const dayParam = stringParam(params, "day");
  const selectedDay = dayParam != null && DAY_PATTERN.test(dayParam) ? dayParam : null;

  const error = stringParam(params, "error");
  const success = stringParam(params, "success");

  // One month query for the desktop grid; one 7-day query for the phone agenda.
  // Both are cheap and the route is force-dynamic, so fetch concurrently.
  const [monthData, agenda]: [CalendarMonthData, TrialAgendaData] = await Promise.all([
    getCalendarMonthData(month, selectedDay),
    getTrialAgendaData(now)
  ]);

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const currentUrl = calendarHref(month, selectedDay);

  return (
    <main className="shell">
      <AppHeader current="calendar" nav={nav} currentUser={currentUser} />
      <section className="pageHeader">
        <div>
          <p className="eyebrow">{pickLabel(calendarLabels.pageSubtitle, locale)}</p>
          <h1>{pickLabel(calendarLabels.pageTitle, locale)}</h1>
        </div>
        {/* Phone-only back-to-dashboard link; desktop uses the AppHeader bar above. */}
        <div className="pageHeaderActions md:hidden">
          <nav className="dashboardNavActions" aria-label={pickLabel(navLabels.dashboard, locale)}>
            <a className="buttonLink" href="/">
              {pickLabel(navLabels.dashboard, locale)}
            </a>
          </nav>
        </div>
      </section>

      {error == null ? null : (
        <div className="mb-4">
          <MessageBanner variant="error" title={t("common.actionFailed")}>
            {error}
          </MessageBanner>
        </div>
      )}

      {success == null ? null : (
        <div className="mb-4">
          <MessageBanner variant="success" title={t("common.saved")}>
            {success}
          </MessageBanner>
        </div>
      )}

      {/* Desktop: month grid + day panel. Hidden below md. */}
      <div className="hidden md:grid md:gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-bold text-neutral-900">{month}</h2>
          <nav className="flex items-center gap-2" aria-label={pickLabel(calendarLabels.pageTitle, locale)}>
            <a className="buttonLink" href={calendarHref(prevMonth, null)}>
              ‹ {pickLabel(calendarLabels.previous, locale)}
            </a>
            <a className="buttonLink" href={calendarHref(currentMonthKey(now), null)}>
              {pickLabel(calendarLabels.today, locale)}
            </a>
            <a className="buttonLink" href={calendarHref(nextMonth, null)}>
              {pickLabel(calendarLabels.next, locale)} ›
            </a>
          </nav>
        </div>

        <MonthGrid
          data={monthData}
          hrefForDay={(dayKey) => calendarHref(month, dayKey)}
          locale={locale}
          todayKey={todayKey}
        />

        <MachineLoadLegend locale={locale} />

        {selectedDay == null ? null : (
          <DayPanel
            day={selectedDay}
            trials={monthData.selectedDayTrials}
            locale={locale}
            canProposeChange={canProposeChange}
            todayInput={todayInput}
            redirectTo={currentUrl}
          />
        )}
      </div>

      {/* Phone: the same 7-day agenda as the dashboard section, never the grid. */}
      <section className="grid gap-3 md:hidden" aria-label={pickLabel(calendarLabels.thisWeekTitle, locale)}>
        <h2 className="m-0 text-lg font-bold text-neutral-900">{pickLabel(calendarLabels.thisWeekTitle, locale)}</h2>
        <TrialAgenda agenda={agenda} locale={locale} todayKey={todayKey} />
      </section>
    </main>
  );
}
