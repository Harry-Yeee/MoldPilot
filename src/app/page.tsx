import type { MoldTrialDashboardData } from "@/domain/mold-trial/dashboard";
import { AccountMenu } from "@/app/account-menu";
import { AppHeader } from "@/components/layout/AppHeader";
import { CustomerSelector } from "@/app/customer-selector";
import { MoldTrialListTable } from "@/app/mold-trial-list-table";
import { MyPlateSections } from "@/app/me/my-plate-sections";
import { PartsCavitiesEditor } from "@/app/parts-cavities-editor";
import { BlockedAction, hasPermissionCode } from "@/app/permission-ui";
import { EmptyState, HeadlineCard, MessageBanner, SectionHeading } from "@/components/ui";
import { TrialAgenda } from "@/app/calendar/trial-agenda";
import {
  calendarLabels,
  dashboardSummaryLabels,
  localeFromLanguage,
  myPlateLabels,
  navLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { formatBilingualUserOption } from "@/domain/mold-trial/users";
import { buildNavVisibility } from "@/server/nav";
import { createTranslator, dictionaries, translateWorkflowMessage } from "@/i18n";
import { getCurrentLanguage } from "@/i18n/server";
import { createMoldTrialProject } from "@/server/mold-trial-actions";
import { getMoldTrialDashboardData } from "@/server/mold-trial-dashboard";
import { getTrialAgendaData, type TrialAgendaData } from "@/server/calendar";
import { getMyPlateData, type MyPlateData } from "@/server/my-plate";
import { priorityOptions } from "@/server/dev-options";
import { getCurrentUser } from "@/server/current-user";
import { getActiveCustomerOptions } from "@/server/customer-options";
import { getEffectivePermissionCodes } from "@/server/permissions";
import { getActivePmUserOptions } from "@/server/user-options";
import { isScoreboardEnabled } from "@/server/kpi-settings";

export const dynamic = "force-dynamic";

function emptyPlate(): MyPlateData {
  return {
    needsReason: [],
    confirmTrialDates: [],
    approveDateChanges: [],
    returnedDates: [],
    myOpenIssues: [],
    departmentInbox: [],
    designRevisions: [],
    assemblyAcknowledge: [],
    assemblySelfCheck: [],
    pmConfirmReady: [],
    comingUp: [],
    qcReportsToUpload: [],
    totalCount: 0,
    options: { missedTrialReasons: [], responsibleAreas: [], issueStatuses: [], activeMachines: [] }
  };
}

/** The 7-day agenda for the mobile "This week's trials" section; empty on failure. */
function emptyAgenda(now: Date): TrialAgendaData {
  return { fromDate: now.toISOString().slice(0, 10), days: [] };
}

async function loadDashboard(now: Date): Promise<{
  activePmUsers: Awaited<ReturnType<typeof getActivePmUserOptions>>;
  activeCustomers: Awaited<ReturnType<typeof getActiveCustomerOptions>>;
  currentUser: Awaited<ReturnType<typeof getCurrentUser>>;
  data: MoldTrialDashboardData;
  databaseError: string | null;
  myPlate: MyPlateData;
  myPlateError: string | null;
  agenda: TrialAgendaData;
}> {
  // Resolve the user first, then load dashboard data and the personal task list
  // concurrently. A my-plate failure is isolated (it resolves to an error string
  // instead of throwing) so it can never blank the rest of the dashboard.
  const currentUser = await getCurrentUser();

  const myPlatePromise: Promise<{ myPlate: MyPlateData; myPlateError: string | null }> = getMyPlateData(
    { userId: currentUser.id, roleCode: currentUser.roleCode },
    now
  )
    .then((myPlate) => ({ myPlate, myPlateError: null }))
    .catch((error: unknown) => ({
      myPlate: emptyPlate(),
      myPlateError: error instanceof Error ? error.message : "Unable to load your tasks."
    }));

  // The mobile "This week's trials" agenda is non-critical: a failure resolves to
  // an empty agenda rather than blanking the dashboard.
  const agendaPromise: Promise<TrialAgendaData> = getTrialAgendaData(now).catch(() => emptyAgenda(now));

  try {
    const [[data, activePmUsers, activeCustomers], myPlateResult, agenda] = await Promise.all([
      Promise.all([getMoldTrialDashboardData(currentUser.id), getActivePmUserOptions(), getActiveCustomerOptions()]),
      myPlatePromise,
      agendaPromise
    ]);

    return {
      activePmUsers,
      activeCustomers,
      currentUser,
      data,
      databaseError: null,
      myPlate: myPlateResult.myPlate,
      myPlateError: myPlateResult.myPlateError,
      agenda
    };
  } catch (error) {
    const [myPlateResult, agenda] = await Promise.all([myPlatePromise, agendaPromise]);

    return {
      activePmUsers: [],
      activeCustomers: [],
      currentUser,
      data: {
        rows: [],
        summary: {
          intakeProjectCount: 0,
          activeMoldCount: 0,
          upcomingTrialCount: 0,
          delayedTrialCount: 0,
          completedTrialCount: 0,
          nearLimitCount: 0,
          atLimitCount: 0,
          overLimitCount: 0,
          openCriticalIssueCount: 0,
          pendingFollowUpCount: 0,
          completedTrialsMissingReportCount: 0
        }
      },
      databaseError: error instanceof Error ? error.message : "Unable to load database records.",
      myPlate: myPlateResult.myPlate,
      myPlateError: myPlateResult.myPlateError,
      agenda
    };
  }
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function messageValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const now = new Date();
  const todayInput = now.toISOString().slice(0, 10);
  const { activePmUsers, activeCustomers, currentUser, data, databaseError, myPlate, myPlateError, agenda } =
    await loadDashboard(now);
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const language = await getCurrentLanguage();
  const dictionary = dictionaries[language];
  const t = createTranslator(dictionary);
  // Derive bilingual-label language from the same source as the rest of the page
  // (the i18n cookie via getCurrentLanguage) rather than the DB `User.locale`, so
  // labels like "My tasks" match the language the user actually switched to.
  const locale: Locale = localeFromLanguage(language);
  const { rows, summary } = data;
  const error = params == null ? null : translateWorkflowMessage(dictionary, messageValue(params, "error"));
  const success = params == null ? null : translateWorkflowMessage(dictionary, messageValue(params, "success"));
  const canCreateIntake = hasPermissionCode(permissionCodes, "project.intake.create");
  const canSetFirstT0 = hasPermissionCode(permissionCodes, "trial.schedule.first_t0");
  const scoreboardEnabled = await isScoreboardEnabled().catch(() => false);
  // Shared app-shell nav visibility (Bundle D): the SAME rules the desktop
  // AppHeader uses, computed once here from data already loaded, then consumed by
  // both the header and this page's own (phone) nav so the two never diverge.
  const nav = buildNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code,
    scoreboardEnabled
  });
  // "Trials this week" headline count reuses the same 7-day agenda the phone
  // "This week's trials" section renders (getTrialAgendaData), summed across days.
  const trialsThisWeekCount = agenda.days.reduce((total, day) => total + day.trials.length, 0);

  return (
    <main className="shell">
      <AppHeader current="dashboard" nav={nav} currentUser={currentUser} />
      <section className="pageHeader">
        <div>
          <p className="eyebrow">{t("dashboard.trackerVersion")}</p>
          <h1>{t("dashboard.title")}</h1>
        </div>
        {/* Phone-only nav + account cluster; desktop uses the AppHeader bar above. */}
        <div className="pageHeaderActions md:hidden">
          <AccountMenu currentUser={currentUser} />
          <nav
            className="dashboardNavActions"
            aria-label={`${pickLabel(navLabels.admin, locale)} / ${pickLabel(navLabels.reports, locale)} / ${pickLabel(navLabels.myTasks, locale)}`}
          >
            {nav.showAdmin ? (
              <a className="buttonLink" href="/admin">
                {pickLabel(navLabels.admin, locale)}
              </a>
            ) : null}
            {nav.showCalendar ? (
              <a className="buttonLink hidden md:inline-flex" href="/calendar">
                {pickLabel(navLabels.calendar, locale)}
              </a>
            ) : null}
            {nav.showReports ? (
              <a className="buttonLink" href="/reports">
                {pickLabel(navLabels.reports, locale)}
              </a>
            ) : null}
            {nav.showMyScore ? (
              <a className="buttonLink hidden md:inline-flex" href="/score">
                {pickLabel(navLabels.myScore, locale)}
              </a>
            ) : null}
            <a className="buttonLink hidden md:inline-flex" href="/me">
              {pickLabel(navLabels.myTasks, locale)}
            </a>
          </nav>
        </div>
      </section>

      {databaseError == null ? null : (
        <div className="mb-4">
          <MessageBanner variant="info" title={t("dashboard.databaseUnavailable")}>
            {databaseError}
          </MessageBanner>
        </div>
      )}

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

      {/*
        Four headline cards (V1+R2): each judges itself. Delayed / Over limit and
        High/critical tint red/critical only when > 0 (a green zero = good news);
        "Trials this week" is informational (calm brand tint). The removed metrics
        (active molds, waiting T0, near/at limit, completed, pending follow-up,
        missing QC report) still live in /reports.
      */}
      <section className="mb-4 grid grid-cols-4 gap-3" aria-label={t("dashboard.metricLabel")}>
        <HeadlineCard
          tone="missed"
          count={summary.delayedTrialCount}
          label={pickLabel(dashboardSummaryLabels.delayed, locale)}
          href="#upcoming-trials-heading"
        />
        <HeadlineCard
          tone="critical"
          count={summary.openCriticalIssueCount}
          label={pickLabel(dashboardSummaryLabels.highCriticalOpen, locale)}
          href="/reports?tab=issues"
        />
        <HeadlineCard
          tone="missed"
          count={summary.overLimitCount}
          label={pickLabel(dashboardSummaryLabels.overLimit, locale)}
          href="#upcoming-trials-heading"
        />
        <HeadlineCard
          tone="info"
          count={trialsThisWeekCount}
          label={pickLabel(dashboardSummaryLabels.trialsThisWeek, locale)}
        />
      </section>

      {/*
        Phone-only: the personal task list renders directly beneath the KPI
        numbers — one page, numbers for context and tasks to act on, so there is
        no separate "My tasks" button on mobile. Kept after all the numbers per
        the owner's instruction. Desktop keeps its header /me link instead.
      */}
      <section className="mb-6 grid gap-3 md:hidden" aria-labelledby="my-tasks-heading">
        <SectionHeading id="my-tasks-heading">
          {pickLabel(myPlateLabels.pageTitle, locale)} · {myPlate.totalCount}
        </SectionHeading>
        {myPlateError == null ? null : (
          <MessageBanner variant="info" title={t("dashboard.databaseUnavailable")}>
            {myPlateError}
          </MessageBanner>
        )}
        {myPlateError == null && myPlate.totalCount === 0 ? (
          <div className="pt-2">
            <EmptyState message={pickLabel(myPlateLabels.allCaughtUp, locale)} />
            <p className="pt-1 text-center text-sm text-neutral-500">
              {pickLabel(myPlateLabels.allCaughtUpHint, locale)}
            </p>
          </div>
        ) : (
          <MyPlateSections
            data={myPlate}
            todayInput={todayInput}
            viewerUsername={currentUser.username}
            redirectTo="/"
          />
        )}
      </section>

      {/*
        Phone-only: a compact "This week's trials" agenda below the task sections.
        Shows all projects' planned trials for today + next 7 days (read-only). The
        title links to /calendar, which on a phone renders the full agenda. Reuses
        the same server-rendered TrialAgenda as the /calendar phone view.
      */}
      <section className="mb-6 grid gap-3 md:hidden" aria-labelledby="this-week-heading">
        <SectionHeading id="this-week-heading">
          <a href="/calendar" className="underline">
            {pickLabel(calendarLabels.thisWeekTitle, locale)}
          </a>
        </SectionHeading>
        <TrialAgenda agenda={agenda} locale={locale} todayKey={todayInput} />
      </section>

      <div className="hidden md:block">
      {/*
        V3: the Mold Trial List sits above the fold — the large intake form is
        collapsed behind a single native <details> toggle below it (closed by
        default, no JS). The old duplicate "Create Intake" header button is gone.
      */}
      <section className="workSurface" aria-labelledby="upcoming-trials-heading">
        <div className="surfaceHeader">
          <h2 id="upcoming-trials-heading">{t("dashboard.moldTrialList")}</h2>
        </div>
        <MoldTrialListTable rows={rows} />
      </section>

      {canCreateIntake ? (
        <details className="intakeDetails">
          <summary>{`+ ${pickLabel(navLabels.newIntake, locale)}`}</summary>
        <section className="workSurface formSurface" aria-labelledby="create-project-heading">
          <div className="surfaceHeader">
            <h2 id="create-project-heading">{t("dashboard.createProjectIntake")}</h2>
          </div>
          <form action={createMoldTrialProject} className="formGrid">
            <input type="hidden" name="redirectTo" value="/" />
            <label>
              {t("field.moldCode")}
              <input name="moldCode" placeholder={t("common.optional")} />
            </label>
            <CustomerSelector customers={activeCustomers} />
            <label>
              {t("field.clientProjectRef")}
              <input name="clientProjectRef" placeholder={t("common.optional")} />
            </label>
            <PartsCavitiesEditor />
            <label>
              {t("field.assignedPm")}
              <select name="planningPmUsername" defaultValue="">
                <option value="">{t("common.unassigned")}</option>
                {activePmUsers.map((user) => (
                  <option key={user.username} value={user.username}>
                    {formatBilingualUserOption(user)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("dashboard.customerTargetDate")}
              <input name="customerTargetDate" type="date" />
            </label>
            {canSetFirstT0 ? (
              <label>
                {t("dashboard.firstT0Date")}
                <input name="firstPlannedTrialDate" type="date" />
              </label>
            ) : null}
            <label>
              {t("field.priority")}
              <select name="priority" defaultValue="NORMAL">
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fullSpan">
              {t("dashboard.projectSourceNote")}
              <textarea name="intakeNote" rows={3} />
            </label>
            <label className="fullSpan">
              {t("dashboard.initialFeedbackNote")}
              <textarea name="initialCustomerNote" rows={2} />
            </label>
            <div className="formActions">
              <button type="submit">{t("dashboard.createIntake")}</button>
            </div>
          </form>
        </section>
        </details>
      ) : (
        <BlockedAction headingId="create-project-heading" title={t("dashboard.createProjectIntake")} />
      )}
      </div>
    </main>
  );
}
