import { isScoredRole } from "./kpi-rules.ts";

export const REPORT_TIME_ZONE = "Asia/Shanghai";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const terminalProjectStatuses = new Set(["APPROVED", "CANCELLED", "CLOSED"]);
const terminalIssueStatuses = new Set(["CLOSED", "VERIFIED"]);
const excludedOnTimeStatuses = new Set(["CANCELLED", "SKIPPED"]);
const forwardTrialStatuses = new Set(["PLANNED", "AT_RISK"]);
const nonApprovedResults = new Set([
  "CONDITIONAL",
  "NOT_APPROVED",
  "PENDING_QC",
  "PENDING_CUSTOMER_FEEDBACK",
  "INVALID_TRIAL"
]);

export type ReportMonthRange = {
  month: string;
  start: Date;
  end: Date;
  dateStart: Date;
  dateEnd: Date;
  dateStartKey: string;
  dateEndKey: string;
};

export type ReportPeriods = {
  selected: ReportMonthRange;
  previous: ReportMonthRange;
  asOf: Date;
  asOfDateKey: string;
};

export type ReportProjectRecord = {
  id: string;
  projectCode: string;
  moldCode: string;
  customerCode: string;
  status: string;
  customerTargetDate: Date | null;
  currentTrialLimit: number;
};

export type ReportTrialRecord = {
  id: string;
  moldTrialProjectId: string;
  trialCode: string;
  sequenceNumber: number;
  plannedDate: Date;
  actualDate: Date | null;
  status: string;
  result: string | null;
  countsAgainstLimit: boolean;
  autoMissedAt: Date | null;
  autoMissedResolvedAt: Date | null;
  processValueCount: number;
  issueCount: number;
  hasQcReport: boolean;
};

export type ReportIssueOwnerUser = {
  id: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  roleCode: string;
  roleName: string;
};

export type ReportIssueOwnerGroup = {
  id: string;
  code: string;
  name: string;
};

export type ReportIssueRecord = {
  id: string;
  moldTrialProjectId: string;
  foundAtTrialEventId: string | null;
  title: string;
  issueType: string;
  severity: string;
  status: string;
  dueDate: Date | null;
  fixSummary: string | null;
  fixTimeMinutes: number | null;
  verificationResult: string | null;
  closedAt: Date | null;
  createdAt: Date;
  ownerUser: ReportIssueOwnerUser | null;
  ownerGroup: ReportIssueOwnerGroup | null;
  closedByName: string | null;
};

export type CountComparison = {
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  hasPriorBaseline: boolean;
};

export type ReportBreakdown = {
  key: string;
  count: number;
};

export type ReportWeekCount = {
  week: number;
  startDay: number;
  endDay: number;
  count: number;
};

export type ReportLimitProject = {
  projectId: string;
  projectCode: string;
  moldCode: string;
  countedTrials: number;
  currentTrialLimit: number;
  state: "NEAR" | "AT" | "OVER";
  sourceHref: string;
};

export type ReportAttentionKind =
  | "OVERDUE_ISSUE"
  | "OVER_LIMIT"
  | "MISSING_ISSUE_ACCOUNTABILITY"
  | "MISSING_NEXT_TRIAL"
  | "AUTO_MISSED"
  | "MISSING_RESULT"
  | "MISSING_PROCESS_SHEET"
  | "MISSING_QC_REPORT";

export type ReportAttentionItem = {
  key: string;
  kind: ReportAttentionKind;
  projectCode: string;
  moldCode: string;
  trialLabel: string | null;
  issueTitle: string | null;
  severity: string | null;
  result: string | null;
  dueDate: Date | null;
  sourceHref: string;
};

export type ManagementIssueRow = ReportIssueRecord & {
  projectCode: string;
  moldCode: string;
  trialLabel: string | null;
  overdue: boolean;
  ageDays: number;
  sourceHref: string;
};

export type ManagementIssueFilters = {
  severity?: string | null;
  status?: string | null;
  issueType?: string | null;
  ownerRoleCode?: string | null;
  ownerGroupCode?: string | null;
  currentOpenBacklog?: boolean;
};

export type ManagementReportData = {
  periods: ReportPeriods;
  completedTrialRuns: CountComparison;
  newMoldsAtT0: CountComparison;
  uniqueMoldsTrialed: number;
  onTimeTrials: { numerator: number; denominator: number; percent: number | null };
  firstApprovals: number;
  currentOpenCriticalIssues: number;
  workloadByWeek: ReportWeekCount[];
  resultDistribution: ReportBreakdown[];
  plannedNext30Days: number;
  targetApprovals: { onOrBefore: number; eligible: number; missingTarget: number };
  lowLoopApprovals: number;
  limitPressure: { near: number; at: number; over: number; projects: ReportLimitProject[] };
  issueHealth: {
    createdInMonth: number;
    closedInMonth: number;
    currentOpenCount: number;
    aging: { days0To7: number; days8To14: number; days15To30: number; days31Plus: number };
    severity: ReportBreakdown[];
    issueTypes: ReportBreakdown[];
  };
  completeness: {
    missingTrialResult: number;
    missingProcessSheet: number;
    missingQcReport: number;
    unresolvedAutoMissed: number;
  };
  attention: ReportAttentionItem[];
  issues: ManagementIssueRow[];
  issueFilterOptions: {
    severities: string[];
    statuses: string[];
    issueTypes: string[];
    ownerRoles: Array<{ code: string; name: string }>;
    ownerGroups: Array<{ code: string; name: string }>;
  };
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match == null) {
    throw new Error(`Invalid report month "${month}" (expected YYYY-MM).`);
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const monthIndex = Number.parseInt(match[2] ?? "", 10) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid report month "${month}" (expected YYYY-MM).`);
  }

  return { year, monthIndex };
}

export function isReportMonth(value: string | null | undefined): value is string {
  if (value == null) {
    return false;
  }

  try {
    monthParts(value);
    return true;
  } catch {
    return false;
  }
}

export function shanghaiDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (year == null || month == null || day == null) {
    throw new Error("Unable to resolve the Asia/Shanghai business date.");
  }

  return `${year}-${month}-${day}`;
}

export function currentReportMonth(asOf: Date): string {
  return shanghaiDateKey(asOf).slice(0, 7);
}

export function reportMonthRange(month: string): ReportMonthRange {
  const { year, monthIndex } = monthParts(month);
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonthIndex = (monthIndex + 1) % 12;
  const dateStart = new Date(Date.UTC(year, monthIndex, 1));
  const dateEnd = new Date(Date.UTC(nextYear, nextMonthIndex, 1));

  return {
    month,
    start: new Date(dateStart.getTime() - SHANGHAI_OFFSET_MS),
    end: new Date(dateEnd.getTime() - SHANGHAI_OFFSET_MS),
    dateStart,
    dateEnd,
    dateStartKey: `${year}-${pad(monthIndex + 1)}-01`,
    dateEndKey: `${nextYear}-${pad(nextMonthIndex + 1)}-01`
  };
}

export function adjacentReportMonth(month: string, offset: -1 | 1): string {
  const { year, monthIndex } = monthParts(month);
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export function buildReportPeriods(month: string, asOf: Date): ReportPeriods {
  return {
    selected: reportMonthRange(month),
    previous: reportMonthRange(adjacentReportMonth(month, -1)),
    asOf,
    asOfDateKey: shanghaiDateKey(asOf)
  };
}

export function buildCountComparison(current: number, previous: number): CountComparison {
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    percentChange: previous === 0 ? null : (delta / previous) * 100,
    hasPriorBaseline: previous !== 0
  };
}

export function managementNavigationVisibility(input: {
  permissionCodes: ReadonlySet<string>;
  dbRoleCode: string;
  scoreboardEnabled: boolean;
}): { showReports: boolean; showMyScore: boolean } {
  return {
    showReports: input.permissionCodes.has("reports.management.view"),
    showMyScore: input.scoreboardEnabled && isScoredRole(input.dbRoleCode)
  };
}

function dateOnlyKey(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function dateIsInMonth(value: Date | null, range: ReportMonthRange): value is Date {
  if (value == null) {
    return false;
  }
  const key = dateOnlyKey(value);
  return key >= range.dateStartKey && key < range.dateEndKey;
}

function instantIsInMonth(value: Date | null, range: ReportMonthRange): value is Date {
  return value != null && value.getTime() >= range.start.getTime() && value.getTime() < range.end.getTime();
}

function isCompletedRun(trial: ReportTrialRecord): boolean {
  return trial.status === "COMPLETED" && trial.actualDate != null;
}

function isOpenIssue(issue: ReportIssueRecord): boolean {
  return !terminalIssueStatuses.has(issue.status);
}

function trialLabel(trial: ReportTrialRecord): string {
  if (trial.trialCode === "EXTRA" || trial.trialCode === "OTHER") {
    return `T${Math.max(0, trial.sequenceNumber - 1)}`;
  }
  return trial.trialCode;
}

function trialSourceHref(projectCode: string, trial: ReportTrialRecord): string {
  return `/projects/${encodeURIComponent(projectCode)}#trial-panel-${trial.sequenceNumber}`;
}

function incrementBreakdown(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function breakdownRows(map: Map<string, number>): ReportBreakdown[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function compareActualTrials(left: ReportTrialRecord, right: ReportTrialRecord): number {
  const leftTime = left.actualDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right.actualDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.sequenceNumber - right.sequenceNumber || left.id.localeCompare(right.id);
}

function calendarAgeDays(createdAt: Date, asOfDateKey: string): number {
  const createdKey = shanghaiDateKey(createdAt);
  const created = Date.parse(`${createdKey}T00:00:00.000Z`);
  const current = Date.parse(`${asOfDateKey}T00:00:00.000Z`);
  return Math.max(0, Math.floor((current - created) / 86_400_000));
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnlyKey(date);
}

export function filterManagementIssues(
  issues: readonly ManagementIssueRow[],
  periods: ReportPeriods,
  filters: ManagementIssueFilters
): ManagementIssueRow[] {
  return issues
    .filter((issue) =>
      filters.currentOpenBacklog === true
        ? isOpenIssue(issue)
        : instantIsInMonth(issue.createdAt, periods.selected)
    )
    .filter((issue) => filters.severity == null || issue.severity === filters.severity)
    .filter((issue) => filters.status == null || issue.status === filters.status)
    .filter((issue) => filters.issueType == null || issue.issueType === filters.issueType)
    .filter((issue) => filters.ownerRoleCode == null || issue.ownerUser?.roleCode === filters.ownerRoleCode)
    .filter((issue) => filters.ownerGroupCode == null || issue.ownerGroup?.code === filters.ownerGroupCode)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));
}

export function buildManagementReport(input: {
  month: string;
  asOf: Date;
  projects: readonly ReportProjectRecord[];
  trials: readonly ReportTrialRecord[];
  issues: readonly ReportIssueRecord[];
  issueFilters?: ManagementIssueFilters;
}): ManagementReportData {
  const periods = buildReportPeriods(input.month, input.asOf);
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const trialsByProject = new Map<string, ReportTrialRecord[]>();
  const trialById = new Map(input.trials.map((trial) => [trial.id, trial]));
  for (const trial of input.trials) {
    const rows = trialsByProject.get(trial.moldTrialProjectId) ?? [];
    rows.push(trial);
    trialsByProject.set(trial.moldTrialProjectId, rows);
  }

  const completedSelected = input.trials.filter(
    (trial) => isCompletedRun(trial) && dateIsInMonth(trial.actualDate, periods.selected)
  );
  const completedPrevious = input.trials.filter(
    (trial) => isCompletedRun(trial) && dateIsInMonth(trial.actualDate, periods.previous)
  );

  const firstCompletedByProject = new Map<string, ReportTrialRecord>();
  const firstApprovalByProject = new Map<string, ReportTrialRecord>();
  for (const [projectId, trials] of trialsByProject) {
    const completed = trials.filter(isCompletedRun).sort(compareActualTrials);
    if (completed[0] != null) {
      firstCompletedByProject.set(projectId, completed[0]);
    }
    const firstApproval = completed.find((trial) => trial.result === "APPROVED");
    if (firstApproval != null) {
      firstApprovalByProject.set(projectId, firstApproval);
    }
  }

  const countNewT0 = (range: ReportMonthRange): number =>
    [...firstCompletedByProject.values()].filter(
      (trial) => trial.trialCode === "T0" && dateIsInMonth(trial.actualDate, range)
    ).length;

  const onTimeDenominator = input.trials.filter(
    (trial) =>
      !excludedOnTimeStatuses.has(trial.status) &&
      dateIsInMonth(trial.plannedDate, periods.selected) &&
      dateOnlyKey(trial.plannedDate) <= periods.asOfDateKey
  );
  const onTimeNumerator = onTimeDenominator.filter(
    (trial) =>
      trial.status === "COMPLETED" &&
      trial.actualDate != null &&
      dateOnlyKey(trial.actualDate) <= dateOnlyKey(trial.plannedDate)
  ).length;

  const selectedApprovals = [...firstApprovalByProject.values()].filter((trial) =>
    dateIsInMonth(trial.actualDate, periods.selected)
  );
  let approvedOnOrBeforeTarget = 0;
  let approvedWithTargetEligible = 0;
  let approvedMissingTarget = 0;
  let lowLoopApprovals = 0;
  for (const approval of selectedApprovals) {
    const project = projectById.get(approval.moldTrialProjectId);
    if (project == null || approval.actualDate == null) {
      continue;
    }
    if (project.customerTargetDate == null) {
      approvedMissingTarget += 1;
    } else {
      approvedWithTargetEligible += 1;
      if (dateOnlyKey(approval.actualDate) <= dateOnlyKey(project.customerTargetDate)) {
        approvedOnOrBeforeTarget += 1;
      }
    }

    const counted = (trialsByProject.get(project.id) ?? [])
      .filter((trial) => isCompletedRun(trial) && trial.countsAgainstLimit)
      .sort(compareActualTrials);
    const approvalIndex = counted.findIndex((trial) => trial.id === approval.id);
    if (approvalIndex >= 0 && approvalIndex < 2 && (approval.trialCode === "T0" || approval.trialCode === "T1")) {
      lowLoopApprovals += 1;
    }
  }

  const limitProjects: ReportLimitProject[] = [];
  for (const project of input.projects) {
    if (terminalProjectStatuses.has(project.status)) {
      continue;
    }
    const countedTrials = (trialsByProject.get(project.id) ?? []).filter(
      (trial) => isCompletedRun(trial) && trial.countsAgainstLimit
    ).length;
    const state =
      countedTrials > project.currentTrialLimit
        ? "OVER"
        : countedTrials === project.currentTrialLimit
          ? "AT"
          : project.currentTrialLimit > 1 && countedTrials === project.currentTrialLimit - 1
            ? "NEAR"
            : null;
    if (state != null) {
      limitProjects.push({
        projectId: project.id,
        projectCode: project.projectCode,
        moldCode: project.moldCode,
        countedTrials,
        currentTrialLimit: project.currentTrialLimit,
        state,
        sourceHref: `/projects/${encodeURIComponent(project.projectCode)}`
      });
    }
  }
  limitProjects.sort(
    (left, right) =>
      right.countedTrials - right.currentTrialLimit - (left.countedTrials - left.currentTrialLimit) ||
      left.moldCode.localeCompare(right.moldCode)
  );

  const selectedIssueRows = input.issues.filter((issue) => instantIsInMonth(issue.createdAt, periods.selected));
  const currentOpenIssues = input.issues.filter(isOpenIssue);
  const aging = { days0To7: 0, days8To14: 0, days15To30: 0, days31Plus: 0 };
  for (const issue of currentOpenIssues) {
    const age = calendarAgeDays(issue.createdAt, periods.asOfDateKey);
    if (age <= 7) aging.days0To7 += 1;
    else if (age <= 14) aging.days8To14 += 1;
    else if (age <= 30) aging.days15To30 += 1;
    else aging.days31Plus += 1;
  }

  const issueSeverity = new Map<string, number>();
  const issueTypes = new Map<string, number>();
  for (const issue of selectedIssueRows) {
    incrementBreakdown(issueSeverity, issue.severity);
    incrementBreakdown(issueTypes, issue.issueType);
  }

  const resultDistribution = new Map<string, number>();
  for (const trial of completedSelected) {
    incrementBreakdown(resultDistribution, trial.result ?? "NOT_RECORDED");
  }

  const { year, monthIndex } = monthParts(periods.selected.month);
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const workloadByWeek: ReportWeekCount[] = Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, index) => ({
    week: index + 1,
    startDay: index * 7 + 1,
    endDay: Math.min(daysInMonth, index * 7 + 7),
    count: 0
  }));
  for (const trial of completedSelected) {
    if (trial.actualDate == null) continue;
    const weekIndex = Math.floor((trial.actualDate.getUTCDate() - 1) / 7);
    const week = workloadByWeek[weekIndex];
    if (week != null) week.count += 1;
  }

  const forwardEndKey = addCalendarDays(periods.asOfDateKey, 30);
  const plannedNext30Days = input.trials.filter((trial) => {
    const key = dateOnlyKey(trial.plannedDate);
    return forwardTrialStatuses.has(trial.status) && key >= periods.asOfDateKey && key < forwardEndKey;
  }).length;

  const unresolvedAutoMissed = input.trials.filter(
    (trial) => trial.status === "AUTO_MISSED_REASON_REQUIRED" && trial.autoMissedResolvedAt == null
  );
  const missingTrialResult = completedSelected.filter((trial) => trial.result == null);
  const missingProcessSheet = completedSelected.filter((trial) => trial.processValueCount === 0);
  const missingQcReport = completedSelected.filter((trial) => !trial.hasQcReport);

  const managementIssues: ManagementIssueRow[] = input.issues.map((issue) => {
    const project = projectById.get(issue.moldTrialProjectId);
    const foundAtTrial = issue.foundAtTrialEventId == null ? null : trialById.get(issue.foundAtTrialEventId) ?? null;
    const sourceHref =
      project == null
        ? "/"
        : foundAtTrial == null
          ? `/projects/${encodeURIComponent(project.projectCode)}`
          : trialSourceHref(project.projectCode, foundAtTrial);
    return {
      ...issue,
      projectCode: project?.projectCode ?? "",
      moldCode: project?.moldCode ?? "",
      trialLabel: foundAtTrial == null ? null : trialLabel(foundAtTrial),
      overdue:
        isOpenIssue(issue) && issue.dueDate != null && dateOnlyKey(issue.dueDate) < periods.asOfDateKey,
      ageDays: calendarAgeDays(issue.createdAt, periods.asOfDateKey),
      sourceHref
    };
  });

  const attention: ReportAttentionItem[] = [];
  for (const issue of managementIssues) {
    if (issue.overdue && (issue.severity === "HIGH" || issue.severity === "CRITICAL")) {
      attention.push({
        key: `overdue-issue:${issue.id}`,
        kind: "OVERDUE_ISSUE",
        projectCode: issue.projectCode,
        moldCode: issue.moldCode,
        trialLabel: issue.trialLabel,
        issueTitle: issue.title,
        severity: issue.severity,
        result: null,
        dueDate: issue.dueDate,
        sourceHref: issue.sourceHref
      });
    }
  }
  for (const project of limitProjects.filter((row) => row.state === "OVER")) {
    attention.push({
      key: `over-limit:${project.projectId}`,
      kind: "OVER_LIMIT",
      projectCode: project.projectCode,
      moldCode: project.moldCode,
      trialLabel: null,
      issueTitle: null,
      severity: null,
      result: null,
      dueDate: null,
      sourceHref: project.sourceHref
    });
  }

  for (const trial of input.trials.filter((row) => isCompletedRun(row) && nonApprovedResults.has(row.result ?? ""))) {
    const project = projectById.get(trial.moldTrialProjectId);
    if (project == null || terminalProjectStatuses.has(project.status)) continue;
    if (trial.issueCount === 0) {
      attention.push({
        key: `missing-accountability:${trial.id}`,
        kind: "MISSING_ISSUE_ACCOUNTABILITY",
        projectCode: project.projectCode,
        moldCode: project.moldCode,
        trialLabel: trialLabel(trial),
        issueTitle: null,
        severity: null,
        result: trial.result,
        dueDate: null,
        sourceHref: trialSourceHref(project.projectCode, trial)
      });
    }
  }

  for (const project of input.projects.filter((row) => !terminalProjectStatuses.has(row.status))) {
    const projectTrials = trialsByProject.get(project.id) ?? [];
    const latestCompleted = projectTrials.filter(isCompletedRun).sort(compareActualTrials).at(-1);
    if (latestCompleted == null || !nonApprovedResults.has(latestCompleted.result ?? "")) continue;
    const hasNextPlan = projectTrials.some(
      (trial) =>
        forwardTrialStatuses.has(trial.status) && trial.sequenceNumber > latestCompleted.sequenceNumber
    );
    if (!hasNextPlan) {
      attention.push({
        key: `missing-next-trial:${latestCompleted.id}`,
        kind: "MISSING_NEXT_TRIAL",
        projectCode: project.projectCode,
        moldCode: project.moldCode,
        trialLabel: trialLabel(latestCompleted),
        issueTitle: null,
        severity: null,
        result: latestCompleted.result,
        dueDate: null,
        sourceHref: trialSourceHref(project.projectCode, latestCompleted)
      });
    }
  }

  for (const trial of unresolvedAutoMissed) {
    const project = projectById.get(trial.moldTrialProjectId);
    if (project == null) continue;
    attention.push({
      key: `auto-missed:${trial.id}`,
      kind: "AUTO_MISSED",
      projectCode: project.projectCode,
      moldCode: project.moldCode,
      trialLabel: trialLabel(trial),
      issueTitle: null,
      severity: null,
      result: null,
      dueDate: trial.plannedDate,
      sourceHref: trialSourceHref(project.projectCode, trial)
    });
  }

  const addMissingAttention = (trial: ReportTrialRecord, kind: ReportAttentionKind): void => {
    const project = projectById.get(trial.moldTrialProjectId);
    if (project == null) return;
    attention.push({
      key: `${kind.toLowerCase()}:${trial.id}`,
      kind,
      projectCode: project.projectCode,
      moldCode: project.moldCode,
      trialLabel: trialLabel(trial),
      issueTitle: null,
      severity: null,
      result: trial.result,
      dueDate: trial.actualDate,
      sourceHref: trialSourceHref(project.projectCode, trial)
    });
  };
  for (const trial of missingTrialResult) addMissingAttention(trial, "MISSING_RESULT");
  for (const trial of missingProcessSheet) addMissingAttention(trial, "MISSING_PROCESS_SHEET");
  for (const trial of missingQcReport) addMissingAttention(trial, "MISSING_QC_REPORT");

  const ownerRoles = new Map<string, string>();
  const ownerGroups = new Map<string, string>();
  for (const issue of input.issues) {
    if (issue.ownerUser != null) ownerRoles.set(issue.ownerUser.roleCode, issue.ownerUser.roleName);
    if (issue.ownerGroup != null) ownerGroups.set(issue.ownerGroup.code, issue.ownerGroup.name);
  }

  return {
    periods,
    completedTrialRuns: buildCountComparison(completedSelected.length, completedPrevious.length),
    newMoldsAtT0: buildCountComparison(countNewT0(periods.selected), countNewT0(periods.previous)),
    uniqueMoldsTrialed: new Set(completedSelected.map((trial) => trial.moldTrialProjectId)).size,
    onTimeTrials: {
      numerator: onTimeNumerator,
      denominator: onTimeDenominator.length,
      percent: onTimeDenominator.length === 0 ? null : (onTimeNumerator / onTimeDenominator.length) * 100
    },
    firstApprovals: selectedApprovals.length,
    currentOpenCriticalIssues: currentOpenIssues.filter((issue) => issue.severity === "CRITICAL").length,
    workloadByWeek,
    resultDistribution: breakdownRows(resultDistribution),
    plannedNext30Days,
    targetApprovals: {
      onOrBefore: approvedOnOrBeforeTarget,
      eligible: approvedWithTargetEligible,
      missingTarget: approvedMissingTarget
    },
    lowLoopApprovals,
    limitPressure: {
      near: limitProjects.filter((row) => row.state === "NEAR").length,
      at: limitProjects.filter((row) => row.state === "AT").length,
      over: limitProjects.filter((row) => row.state === "OVER").length,
      projects: limitProjects
    },
    issueHealth: {
      createdInMonth: selectedIssueRows.length,
      closedInMonth: input.issues.filter((issue) => instantIsInMonth(issue.closedAt, periods.selected)).length,
      currentOpenCount: currentOpenIssues.length,
      aging,
      severity: breakdownRows(issueSeverity),
      issueTypes: breakdownRows(issueTypes)
    },
    completeness: {
      missingTrialResult: missingTrialResult.length,
      missingProcessSheet: missingProcessSheet.length,
      missingQcReport: missingQcReport.length,
      unresolvedAutoMissed: unresolvedAutoMissed.length
    },
    attention,
    issues: filterManagementIssues(managementIssues, periods, input.issueFilters ?? {}),
    issueFilterOptions: {
      severities: [...new Set(input.issues.map((issue) => issue.severity))].sort(),
      statuses: [...new Set(input.issues.map((issue) => issue.status))].sort(),
      issueTypes: [...new Set(input.issues.map((issue) => issue.issueType))].sort(),
      ownerRoles: [...ownerRoles.entries()]
        .map(([code, name]) => ({ code, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      ownerGroups: [...ownerGroups.entries()]
        .map(([code, name]) => ({ code, name }))
        .sort((left, right) => left.name.localeCompare(right.name))
    }
  };
}
