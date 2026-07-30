import Link from "next/link";

import { AccountMenu } from "@/app/account-menu";
import { AppHeader } from "@/components/layout/AppHeader";
import { KpiScoresPanel } from "@/app/admin/kpi-scores-panel";
import { StatusBadge } from "@/components/ui";
import { formatOverdueDays, overdueDays } from "@/domain/mold-trial/deadline-countdown";
import { localeFromLanguage } from "@/domain/mold-trial/labels";
import {
  adjacentReportMonth,
  currentReportMonth,
  isReportMonth,
  type CountComparison,
  type ManagementIssueRow,
  type ManagementReportData,
  type ReportAttentionItem,
  type ReportBreakdown
} from "@/domain/mold-trial/management-reports";
import { parseKpiSortState } from "@/domain/mold-trial/kpi-sort";
import { formatIssueOwnerUserOption } from "@/domain/mold-trial/users";
import { createTranslator, translateLabel, type Dictionary, type TranslationKey } from "@/i18n";
import { getCurrentLanguage, getDictionary } from "@/i18n/server";
import {
  issueStatusLabels,
  issueTypeLabels,
  severityLabels,
  trialResultLabels
} from "@/server/mold-trial-codecs";
import { getCurrentUser } from "@/server/current-user";
import {
  getManagementReportData,
  getManagementReportScorecards
} from "@/server/management-reports";
import { getEffectivePermissionCodes } from "@/server/permissions";
import { getNavVisibility } from "@/server/nav";
import { translateSystemGroup, translateSystemRole } from "@/i18n/display";

export const dynamic = "force-dynamic";

type ReportTab = "overview" | "issues" | "scorecards";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const attentionTranslationKey: Record<ReportAttentionItem["kind"], TranslationKey> = {
  OVERDUE_ISSUE: "reports.attention.OVERDUE_ISSUE",
  OVER_LIMIT: "reports.attention.OVER_LIMIT",
  MISSING_ISSUE_ACCOUNTABILITY: "reports.attention.MISSING_ISSUE_ACCOUNTABILITY",
  MISSING_NEXT_TRIAL: "reports.attention.MISSING_NEXT_TRIAL",
  AUTO_MISSED: "reports.attention.AUTO_MISSED",
  MISSING_RESULT: "reports.attention.MISSING_RESULT",
  MISSING_PROCESS_SHEET: "reports.attention.MISSING_PROCESS_SHEET",
  MISSING_QC_REPORT: "reports.attention.MISSING_QC_REPORT"
};

function parameter(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function requestedTab(value: string | null): ReportTab {
  return value === "issues" || value === "scorecards" ? value : "overview";
}

function formatDateOnly(value: Date | null, language: "en" | "zh-CN"): string {
  if (value == null) return "-";
  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function formatTimestamp(value: Date, language: "en" | "zh-CN"): string {
  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function percent(value: number | null): string {
  return value == null ? "-" : `${Math.round(value * 10) / 10}%`;
}

function comparisonText(comparison: CountComparison, t: ReturnType<typeof createTranslator>): string {
  if (!comparison.hasPriorBaseline) {
    return t("reports.noPriorBaseline");
  }
  const delta = `${comparison.delta >= 0 ? "+" : ""}${comparison.delta}`;
  return `${delta} (${percent(comparison.percentChange)}) ${t("reports.vsPrevious")}`;
}

function resultLabel(value: string | null, dictionary: Dictionary, t: ReturnType<typeof createTranslator>): string {
  if (value == null || value === "NOT_RECORDED") return t("reports.notRecorded");
  return translateLabel(dictionary, "trialResult", trialResultLabels[value] ?? value);
}

function statusLabel(value: string, dictionary: Dictionary): string {
  return translateLabel(dictionary, "issueStatus", issueStatusLabels[value] ?? value);
}

function severityLabel(value: string, dictionary: Dictionary): string {
  return translateLabel(dictionary, "severity", severityLabels[value] ?? value);
}

function issueTypeLabel(value: string, dictionary: Dictionary): string {
  return translateLabel(dictionary, "issueType", issueTypeLabels[value] ?? value);
}

function fixOwnerLabel(
  issue: ManagementIssueRow,
  dictionary: Dictionary,
  t: ReturnType<typeof createTranslator>
): string {
  if (issue.ownerUser != null) {
    return formatIssueOwnerUserOption({
      displayName: issue.ownerUser.displayName,
      chineseName: issue.ownerUser.chineseName,
      role: {
        name: translateSystemRole(dictionary, issue.ownerUser.roleCode, issue.ownerUser.roleName)
      }
    });
  }
  if (issue.ownerGroup != null) {
    const suffix = t("reports.ownerGroupSuffix");
    const groupName = translateSystemGroup(dictionary, issue.ownerGroup.code, issue.ownerGroup.name);
    return suffix === "组" ? `${groupName}${suffix}` : `${groupName} ${suffix}`;
  }
  return t("common.unassigned");
}

function SourceIdentity({ projectCode, moldCode, trialLabel }: { projectCode: string; moldCode: string; trialLabel: string | null }) {
  return (
    <span className="reportSourceIdentity">
      <strong>{moldCode || projectCode}</strong>
      {moldCode && projectCode !== moldCode ? <small>{projectCode}</small> : null}
      {trialLabel == null ? null : <small>{trialLabel}</small>}
    </span>
  );
}

function BreakdownBars({
  rows,
  label
}: {
  rows: readonly ReportBreakdown[];
  label: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.length === 0 ? (
    <p className="reportEmptyLine">-</p>
  ) : (
    <div className="reportBars">
      {rows.map((row) => (
        <div className="reportBarRow" key={row.key}>
          <span title={label(row.key)}>{label(row.key)}</span>
          <div className="reportBarTrack" aria-hidden="true">
            <span style={{ width: `${Math.max(5, (row.count / max) * 100)}%` }} />
          </div>
          <strong>{row.count}</strong>
        </div>
      ))}
    </div>
  );
}

function ManagementAttention({
  rows,
  dictionary,
  t,
  language,
  now
}: {
  rows: readonly ReportAttentionItem[];
  dictionary: Dictionary;
  t: ReturnType<typeof createTranslator>;
  language: "en" | "zh-CN";
  /** Single request-time clock for the overdue-days append (V10). */
  now: Date;
}) {
  const locale = localeFromLanguage(language);
  return (
    <section className="workSurface reportAttention" aria-labelledby="management-attention-heading">
      <div className="surfaceHeader">
        <h2 id="management-attention-heading">{t("reports.managementAttention")}</h2>
        <span className="reportCurrentLabel">{t("reports.current")}</span>
      </div>
      {rows.length === 0 ? (
        <p className="reportEmptyState">{t("reports.noAttention")}</p>
      ) : (
        <div className="reportAttentionList">
          {rows.map((row) => {
            // V10: only overdue high/critical issues carry a real deadline that has
            // passed — append "· overdue N days" to their due date. Other kinds show
            // a planned/actual date (not a deadline), so they get no overdue suffix.
            const overdueText =
              row.kind === "OVERDUE_ISSUE" && row.dueDate != null
                ? formatOverdueDays(overdueDays(row.dueDate, now), locale)
                : null;
            return (
              <Link className="reportAttentionRow" href={row.sourceHref} key={row.key}>
                <SourceIdentity projectCode={row.projectCode} moldCode={row.moldCode} trialLabel={row.trialLabel} />
                <span className="reportAttentionText">
                  <strong>{t(attentionTranslationKey[row.kind])}</strong>
                  {row.issueTitle == null ? null : <small>{row.issueTitle}</small>}
                  {row.result == null ? null : <small>{resultLabel(row.result, dictionary, t)}</small>}
                </span>
                <span className="reportAttentionMeta">
                  {row.severity == null ? null : <StatusBadge tone="at-risk">{severityLabel(row.severity, dictionary)}</StatusBadge>}
                  {row.dueDate == null ? null : (
                    <small>
                      {formatDateOnly(row.dueDate, language)}
                      {overdueText == null ? null : ` · ${overdueText}`}
                    </small>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Overview({
  data,
  dictionary,
  language,
  t,
  now
}: {
  data: ManagementReportData;
  dictionary: Dictionary;
  language: "en" | "zh-CN";
  t: ReturnType<typeof createTranslator>;
  now: Date;
}) {
  return (
    <>
      <section className="reportPulse" aria-label={t("reports.overview")}>
        <div className="reportMetric reportMetricPrimary">
          <span>{t("reports.completedRuns")}</span>
          <strong>{data.completedTrialRuns.current}</strong>
          <small>{comparisonText(data.completedTrialRuns, t)}</small>
        </div>
        <div className="reportMetric">
          <span>{t("reports.newT0")}</span>
          <strong>{data.newMoldsAtT0.current}</strong>
          <small>{comparisonText(data.newMoldsAtT0, t)}</small>
        </div>
        <div className="reportMetric">
          <span>{t("reports.uniqueMolds")}</span>
          <strong>{data.uniqueMoldsTrialed}</strong>
          <small>{data.periods.selected.month}</small>
        </div>
        <div className="reportMetric">
          <span>{t("reports.onTimeRate")}</span>
          <strong>{percent(data.onTimeTrials.percent)}</strong>
          <small>{data.onTimeTrials.numerator} / {data.onTimeTrials.denominator}</small>
        </div>
        <div className="reportMetric">
          <span>{t("reports.firstApprovals")}</span>
          <strong>{data.firstApprovals}</strong>
          <small>{data.periods.selected.month}</small>
        </div>
        <div className="reportMetric reportMetricWarning">
          <span>{t("reports.openCritical")}</span>
          <strong>{data.currentOpenCriticalIssues}</strong>
          <small>{t("reports.current")}</small>
        </div>
      </section>

      <ManagementAttention rows={data.attention} dictionary={dictionary} t={t} language={language} now={now} />

      <div className="reportSectionGrid">
        <section className="workSurface reportSection" aria-labelledby="workload-heading">
          <div className="surfaceHeader">
            <div>
              <h2 id="workload-heading">{t("reports.moldTrialWorkload")}</h2>
              <p>{t("reports.completedByWeek")}</p>
            </div>
            <div className="reportForwardMetric">
              <strong>{data.plannedNext30Days}</strong>
              <span>{t("reports.next30Days")}</span>
              <small>{t("reports.forwardLooking")}</small>
            </div>
          </div>
          <div className="reportWeekGrid">
            {data.workloadByWeek.map((week) => (
              <div key={week.week}>
                <span>{t("reports.week", { week: week.week })}</span>
                <strong>{week.count}</strong>
                <small>{week.startDay}-{week.endDay}</small>
              </div>
            ))}
          </div>
          <h3>{t("reports.resultDistribution")}</h3>
          <BreakdownBars rows={data.resultDistribution} label={(key) => resultLabel(key, dictionary, t)} />
        </section>

        <section className="workSurface reportSection" aria-labelledby="approval-heading">
          <div className="surfaceHeader">
            <h2 id="approval-heading">{t("reports.approvalEfficiency")}</h2>
          </div>
          <dl className="reportFactList">
            <div>
              <dt>{t("reports.targetApprovals")}</dt>
              <dd>{data.targetApprovals.onOrBefore} / {data.targetApprovals.eligible}</dd>
            </div>
            <div>
              <dt>{t("reports.missingTarget")}</dt>
              <dd>{data.targetApprovals.missingTarget}</dd>
            </div>
            <div>
              <dt>{t("reports.lowLoop")}</dt>
              <dd>{data.lowLoopApprovals}</dd>
            </div>
          </dl>
        </section>

        <section className="workSurface reportSection" aria-labelledby="limit-heading">
          <div className="surfaceHeader">
            <div>
              <h2 id="limit-heading">{t("reports.limitPressure")}</h2>
              <p>{t("reports.current")}</p>
            </div>
            <div className="reportLimitSummary">
              <span>{t("reports.nearLimit")} <strong>{data.limitPressure.near}</strong></span>
              <span>{t("reports.atLimit")} <strong>{data.limitPressure.at}</strong></span>
              <span>{t("reports.overLimit")} <strong>{data.limitPressure.over}</strong></span>
            </div>
          </div>
          {data.limitPressure.projects.length === 0 ? (
            <p className="reportEmptyState">{t("reports.noLimitPressure")}</p>
          ) : (
            <div className="reportCompactRows">
              {data.limitPressure.projects.map((row) => (
                <Link href={row.sourceHref} key={row.projectId}>
                  <SourceIdentity projectCode={row.projectCode} moldCode={row.moldCode} trialLabel={null} />
                  <StatusBadge tone={row.state === "OVER" ? "missed" : "at-risk"}>
                    {row.state === "NEAR" ? t("reports.nearLimit") : row.state === "AT" ? t("reports.atLimit") : t("reports.overLimit")}
                  </StatusBadge>
                  <strong>{t("reports.countedLimit", { counted: row.countedTrials, limit: row.currentTrialLimit })}</strong>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="workSurface reportSection" aria-labelledby="issue-health-heading">
          <div className="surfaceHeader">
            <h2 id="issue-health-heading">{t("reports.issueHealth")}</h2>
          </div>
          <dl className="reportFactList reportFactListThree">
            <div><dt>{t("reports.createdInMonth")}</dt><dd>{data.issueHealth.createdInMonth}</dd></div>
            <div><dt>{t("reports.closedInMonth")}</dt><dd>{data.issueHealth.closedInMonth}</dd></div>
            <div><dt>{t("reports.currentOpen")}</dt><dd>{data.issueHealth.currentOpenCount}</dd></div>
          </dl>
          <div className="reportAgeGrid">
            <span>{t("reports.age0To7")} <strong>{data.issueHealth.aging.days0To7}</strong></span>
            <span>{t("reports.age8To14")} <strong>{data.issueHealth.aging.days8To14}</strong></span>
            <span>{t("reports.age15To30")} <strong>{data.issueHealth.aging.days15To30}</strong></span>
            <span>{t("reports.age31Plus")} <strong>{data.issueHealth.aging.days31Plus}</strong></span>
          </div>
          <div className="reportBreakdownGrid">
            <div>
              <h3>{t("reports.severityBreakdown")}</h3>
              <BreakdownBars rows={data.issueHealth.severity} label={(key) => severityLabel(key, dictionary)} />
            </div>
            <div>
              <h3>{t("reports.typeBreakdown")}</h3>
              <BreakdownBars rows={data.issueHealth.issueTypes} label={(key) => issueTypeLabel(key, dictionary)} />
            </div>
          </div>
        </section>

        <section className="workSurface reportSection" aria-labelledby="completeness-heading">
          <div className="surfaceHeader">
            <h2 id="completeness-heading">{t("reports.workflowCompleteness")}</h2>
          </div>
          <dl className="reportFactList reportFactListFour">
            <div><dt>{t("reports.missingResult")}</dt><dd>{data.completeness.missingTrialResult}</dd></div>
            <div><dt>{t("reports.missingProcessSheet")}</dt><dd>{data.completeness.missingProcessSheet}</dd></div>
            <div><dt>{t("reports.missingQcReport")}</dt><dd>{data.completeness.missingQcReport}</dd></div>
            <div><dt>{t("reports.unresolvedAutoMissed")}</dt><dd>{data.completeness.unresolvedAutoMissed}</dd></div>
          </dl>
        </section>
      </div>
    </>
  );
}

function IssuesTable({
  data,
  dictionary,
  language,
  month,
  params,
  t
}: {
  data: ManagementReportData;
  dictionary: Dictionary;
  language: "en" | "zh-CN";
  month: string;
  params: Record<string, string | string[] | undefined>;
  t: ReturnType<typeof createTranslator>;
}) {
  const selected = (key: string) => parameter(params, key) ?? "";
  const backlog = parameter(params, "backlog") === "1";
  return (
    <>
      <section className="workSurface reportFilters" aria-labelledby="issue-filters-heading">
        <div className="surfaceHeader"><h2 id="issue-filters-heading">{t("reports.filters")}</h2></div>
        <form method="get" action="/reports" className="reportFilterGrid">
          <input type="hidden" name="tab" value="issues" />
          <input type="hidden" name="month" value={month} />
          <label>{t("field.severity")}
            <select name="severity" defaultValue={selected("severity")}>
              <option value="">{t("reports.all")}</option>
              {data.issueFilterOptions.severities.map((value) => <option value={value} key={value}>{severityLabel(value, dictionary)}</option>)}
            </select>
          </label>
          <label>{t("field.status")}
            <select name="status" defaultValue={selected("status")}>
              <option value="">{t("reports.all")}</option>
              {data.issueFilterOptions.statuses.map((value) => <option value={value} key={value}>{statusLabel(value, dictionary)}</option>)}
            </select>
          </label>
          <label>{t("field.issueType")}
            <select name="issueType" defaultValue={selected("issueType")}>
              <option value="">{t("reports.all")}</option>
              {data.issueFilterOptions.issueTypes.map((value) => <option value={value} key={value}>{issueTypeLabel(value, dictionary)}</option>)}
            </select>
          </label>
          <label>{t("reports.ownerRole")}
            <select name="ownerRole" defaultValue={selected("ownerRole")}>
              <option value="">{t("reports.all")}</option>
              {data.issueFilterOptions.ownerRoles.map((value) => (
                <option value={value.code} key={value.code}>
                  {translateSystemRole(dictionary, value.code, value.name)}
                </option>
              ))}
            </select>
          </label>
          <label>{t("reports.ownerGroup")}
            <select name="ownerGroup" defaultValue={selected("ownerGroup")}>
              <option value="">{t("reports.all")}</option>
              {data.issueFilterOptions.ownerGroups.map((value) => (
                <option value={value.code} key={value.code}>
                  {translateSystemGroup(dictionary, value.code, value.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="reportBacklogToggle">
            <input type="checkbox" name="backlog" value="1" defaultChecked={backlog} />
            {t("reports.currentBacklogToggle")}
          </label>
          <div className="reportFilterActions">
            <button type="submit">{t("reports.applyFilters")}</button>
            <Link className="buttonLink secondaryButtonLink" href={`/reports?tab=issues&month=${month}`}>{t("reports.clearFilters")}</Link>
          </div>
        </form>
      </section>

      <section className="workSurface reportIssuesSurface" aria-labelledby="report-issues-heading">
        <div className="surfaceHeader">
          <div><h2 id="report-issues-heading">{t("reports.issues")}</h2><p>{backlog ? t("reports.currentOpen") : month}</p></div>
          <strong>{data.issues.length}</strong>
        </div>
        {data.issues.length === 0 ? (
          <p className="reportEmptyState">{t("reports.noIssues")}</p>
        ) : (
          <div className="reportTableWrap">
            <table className="reportIssuesTable">
              <thead><tr>
                <th>{t("reports.createdDate")}</th><th>{t("reports.moldTrial")}</th><th>{t("reports.titleType")}</th>
                <th>{t("reports.severityStatus")}</th><th>{t("reports.fixOwner")}</th><th>{t("reports.due")}</th>
                <th>{t("reports.resolution")}</th><th>{t("reports.closureVerification")}</th><th>{t("reports.source")}</th>
              </tr></thead>
              <tbody>
                {data.issues.map((row) => (
                  <tr key={row.id} data-issue-status={row.status}>
                    <td>{formatTimestamp(row.createdAt, language)}</td>
                    <td><SourceIdentity projectCode={row.projectCode} moldCode={row.moldCode} trialLabel={row.trialLabel} /></td>
                    <td><strong>{row.title}</strong><small>{issueTypeLabel(row.issueType, dictionary)}</small></td>
                    <td><StatusBadge tone={row.severity === "CRITICAL" || row.severity === "HIGH" ? "at-risk" : "paused"}>{severityLabel(row.severity, dictionary)}</StatusBadge><small>{statusLabel(row.status, dictionary)}</small></td>
                    <td>{fixOwnerLabel(row, dictionary, t)}</td>
                    <td>{formatDateOnly(row.dueDate, language)}{row.overdue ? <strong className="reportOverdue">{t("reports.overdue")}</strong> : null}<small>{t("reports.daysOpen", { days: row.ageDays })}</small></td>
                    <td>{row.status === "CLOSED" || row.status === "VERIFIED" ? <>{row.fixSummary ?? "-"}{row.fixTimeMinutes == null ? null : <small>{t("reports.fixTime", { minutes: row.fixTimeMinutes })}</small>}</> : <span className="reportUnresolved">{t("reports.notResolved")}</span>}</td>
                    <td>{row.closedAt == null ? "-" : <>{formatTimestamp(row.closedAt, language)}{row.closedByName == null ? null : <small>{t("reports.closedBy")}: {row.closedByName}</small>}{row.verificationResult == null ? null : <small>{t("reports.verification")}: {row.verificationResult}</small>}</>}</td>
                    <td><Link className="buttonLink secondaryButtonLink" href={row.sourceHref}>{t("reports.openSource")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const requestedMonth = parameter(params, "month");
  const month = isReportMonth(requestedMonth) ? requestedMonth : currentReportMonth(now);
  const tab = requestedTab(parameter(params, "tab"));
  const currentUser = await getCurrentUser();
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const canViewReports = permissionCodes.has("reports.management.view");
  const canViewScorecards = permissionCodes.has("kpi.scores.view_all");
  const language = await getCurrentLanguage();
  const dictionary = await getDictionary();
  const t = createTranslator(dictionary);
  const nav = await getNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code
  });

  if (!canViewReports) {
    return (
      <main className="shell reportsShell">
        <AppHeader current="reports" nav={nav} currentUser={currentUser} />
        <header className="pageHeader reportPageHeader">
          <div><Link className="backLink" href="/">{t("common.backToDashboard")}</Link><h1>{t("reports.title")}</h1></div>
          <div className="md:hidden"><AccountMenu currentUser={currentUser} /></div>
        </header>
        <section className="notice noticeError" role="alert">
          <strong>{t("reports.accessDenied")}</strong><span>{t("reports.accessDeniedHint")}</span>
        </section>
      </main>
    );
  }

  const issueFilters = {
    severity: parameter(params, "severity"),
    status: parameter(params, "status"),
    issueType: parameter(params, "issueType"),
    ownerRoleCode: parameter(params, "ownerRole"),
    ownerGroupCode: parameter(params, "ownerGroup"),
    currentOpenBacklog: parameter(params, "backlog") === "1"
  };
  let data: ManagementReportData | null = null;
  let loadError: string | null = null;
  try {
    data = await getManagementReportData(currentUser.id, { month, asOf: now, issueFilters });
  } catch {
    loadError = t("reports.loadFailed");
  }

  const scoresSort = parseKpiSortState(parameter(params, "scoreSort"), parameter(params, "scoreDir"));
  let scorecards: Awaited<ReturnType<typeof getManagementReportScorecards>> | null = null;
  if (tab === "scorecards" && canViewScorecards) {
    try {
      scorecards = await getManagementReportScorecards(currentUser.id, { month, asOf: now });
    } catch {
      loadError ??= t("reports.loadFailed");
    }
  }

  const previousMonth = adjacentReportMonth(month, -1);
  const nextMonth = adjacentReportMonth(month, 1);
  const completenessTotal =
    data == null
      ? 0
      : data.completeness.missingTrialResult +
        data.completeness.missingProcessSheet +
        data.completeness.missingQcReport +
        data.completeness.unresolvedAutoMissed;

  return (
    <main className="shell reportsShell">
      <AppHeader current="reports" nav={nav} currentUser={currentUser} />
      <header className="pageHeader reportPageHeader">
        <div>
          <Link className="backLink" href="/">{t("common.backToDashboard")}</Link>
          <p className="eyebrow">MoldPilot</p>
          <h1>{t("reports.title")}</h1>
          <p>{t("reports.subtitle")}</p>
        </div>
        <div className="md:hidden"><AccountMenu currentUser={currentUser} /></div>
      </header>

      <section className="reportControlBar" aria-label={t("reports.period")}>
        <form method="get" action="/reports" className="reportMonthForm">
          <input type="hidden" name="tab" value={tab} />
          <label>{t("reports.month")}<input type="month" name="month" defaultValue={month} required /></label>
          <button type="submit">{t("reports.view")}</button>
        </form>
        <dl className="reportPeriodFacts">
          <div><dt>{t("reports.period")}</dt><dd>{month}</dd></div>
          <div><dt>{t("reports.previousPeriod")}</dt><dd>{previousMonth}</dd></div>
          <div><dt>{t("reports.asOf")}</dt><dd>{data == null ? formatTimestamp(now, language) : formatTimestamp(data.periods.asOf, language)}</dd></div>
        </dl>
      </section>

      <nav className="reportTabs" aria-label={t("reports.title")}>
        <Link className={tab === "overview" ? "reportTab reportTabActive" : "reportTab"} href={`/reports?tab=overview&month=${month}`}>{t("reports.overview")}</Link>
        <Link className={tab === "issues" ? "reportTab reportTabActive" : "reportTab"} href={`/reports?tab=issues&month=${month}`}>{t("reports.issues")}</Link>
        {canViewScorecards ? (
          <Link className={tab === "scorecards" ? "reportTab reportTabActive" : "reportTab"} href={`/reports?tab=scorecards&month=${month}`}>{t("reports.scorecards")}</Link>
        ) : (
          <span className="reportTab reportTabDisabled" title={t("reports.scorecardsDenied")}>{t("reports.scorecards")}</span>
        )}
      </nav>

      {loadError == null ? null : <section className="notice noticeError" role="alert"><strong>{t("reports.loadFailed")}</strong><span>{loadError}</span></section>}
      {completenessTotal === 0 ? null : <section className="notice reportDataWarning" role="note"><strong>{t("reports.dataWarning")}: {completenessTotal}</strong><span>{t("reports.dataWarningHint")}</span></section>}

      {data == null ? null : tab === "overview" ? (
        <Overview data={data} dictionary={dictionary} language={language} t={t} now={now} />
      ) : tab === "issues" ? (
        <IssuesTable data={data} dictionary={dictionary} language={language} month={month} params={params} t={t} />
      ) : !canViewScorecards ? (
        <section className="notice noticeError" role="alert"><strong>{t("reports.scorecardsDenied")}</strong></section>
      ) : scorecards == null ? null : (
        <KpiScoresPanel
          scores={scorecards.scores}
          ruleLabels={scorecards.ruleLabels}
          scoreboardEnabled={false}
          locale={language === "zh-CN" ? "ZH_CN" : "EN_US"}
          prevMonth={previousMonth}
          nextMonth={nextMonth}
          sort={scoresSort}
          navigationBasePath="/reports?tab=scorecards"
          showScoreboardControls={false}
        />
      )}
    </main>
  );
}
