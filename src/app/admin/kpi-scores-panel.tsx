import { StatusBadge } from "@/components/ui";
import {
  isBooleanKpiRuleCode,
  kpiLabels,
  leaderHabitPrizeYuan,
  refereeAllowanceYuan
} from "@/domain/mold-trial/kpi-rules";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { formatScorePercent } from "@/domain/mold-trial/kpi-scoring";
import type { ScorecardItem, ScorecardRuleLine } from "@/domain/mold-trial/kpi-scoring";
import {
  defaultKpiSortDirection,
  sortKpiRows,
  type KpiSortKey,
  type KpiSortState
} from "@/domain/mold-trial/kpi-sort";
import type { LeaderEntry, MonthlyScores } from "@/server/kpi-scores";
import { setScoreboardEnabled } from "@/server/kpi-actions";

/** How many audit item rows to show before collapsing the rest behind "+N more". */
const ITEM_CAP = 6;

export type KpiScoresPanelProps = {
  scores: MonthlyScores;
  ruleLabels: Record<string, { en: string; zh: string }>;
  scoreboardEnabled: boolean;
  locale: Locale;
  redirectTo?: string;
  /** Adjacent months for the picker, as YYYY-MM. */
  prevMonth: string;
  nextMonth: string;
  /** Active column sort (from ?scoreSort/?scoreDir), applied to the rows. */
  sort: KpiSortState;
  navigationBasePath?: string;
  showScoreboardControls?: boolean;
};

function formatWhen(value: Date | null, locale: Locale): string {
  if (value == null) {
    return pickLabel(kpiLabels.pending, locale);
  }
  return value.toLocaleString(locale === "ZH_CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function verdictBadge(barHit: boolean, barHitByFloor: boolean, locale: Locale) {
  if (barHitByFloor) {
    // The floor badge shows a short label; the full "fewer than 5 applicable
    // events — counts as hit" explanation rides along in title + aria-label so
    // the visible chip stays inside its fixed verdict track (wrapping to two
    // lines if needed) instead of stretching the row's columns.
    const hint = pickLabel(kpiLabels.notEnoughHint, locale);
    return (
      <StatusBadge tone="paused" wrap title={hint} ariaLabel={hint}>
        {pickLabel(kpiLabels.notEnoughShort, locale)}
      </StatusBadge>
    );
  }
  return barHit ? (
    <StatusBadge tone="completed">{pickLabel(kpiLabels.hit, locale)}</StatusBadge>
  ) : (
    <StatusBadge tone="missed">{pickLabel(kpiLabels.miss, locale)}</StatusBadge>
  );
}

/**
 * The money caption a leader row shows ON A HIT: ¥400 for an award-tier leader,
 * ¥250 for a referee. Composed from the prize constants (single source of truth)
 * so no bare "¥400" string is sprinkled through the JSX. Null on a miss.
 */
function prizeCaption(entry: LeaderEntry, locale: Locale): string | null {
  if (!entry.barHit) {
    return null;
  }
  return entry.tier === "referee"
    ? `= ¥${refereeAllowanceYuan} (${pickLabel(kpiLabels.refereeSuffix, locale)})`
    : `= ¥${leaderHabitPrizeYuan}`;
}

/**
 * One Leaders-section row: the leader's GROUP bar as a summary, expanding to the
 * per-member breakdown so the leader sees whose data is dragging. PM rows are
 * marked "individual"; referee rows carry the ¥250 caption.
 */
function LeaderRow({ entry, locale }: { entry: LeaderEntry; locale: Locale }) {
  const leaderName =
    locale === "ZH_CN" && entry.leaderChineseName != null ? entry.leaderChineseName : entry.leaderDisplayName;
  const groupLabel = pickLabel(entry.label, locale);
  const caption = prizeCaption(entry, locale);
  const percentText = formatScorePercent({ percent: entry.percent, applicable: entry.applicable });

  return (
    <details className="kpiLeaderRow">
      <summary className="kpiLeaderSummary kpiLeaderGrid">
        <span className="kpiSummaryName" title={leaderName}>
          {leaderName}
        </span>
        <span className="kpiLeaderGroup">
          <span className="kpiLeaderGroupLabel" title={groupLabel}>
            {groupLabel}
          </span>
          {entry.kind === "individual" ? (
            <span className="kpiLeaderTag">{pickLabel(kpiLabels.individualTag, locale)}</span>
          ) : null}
        </span>
        <span
          className="kpiSummaryNum"
          data-label={pickLabel(kpiLabels.membersColumn, locale)}
          aria-label={`${pickLabel(kpiLabels.membersColumn, locale)}: ${entry.members.length}`}
        >
          {entry.members.length}
        </span>
        <span
          className="kpiSummaryNum"
          data-label={pickLabel(kpiLabels.applicable, locale)}
          aria-label={`${pickLabel(kpiLabels.applicable, locale)}: ${entry.applicable}`}
        >
          {entry.applicable}
        </span>
        <span
          className="kpiSummaryNum"
          data-label={pickLabel(kpiLabels.onTime, locale)}
          aria-label={`${pickLabel(kpiLabels.onTime, locale)}: ${entry.onTime}`}
        >
          {entry.onTime}
        </span>
        <span
          className={`kpiSummaryNum kpiSummaryPct${entry.barHitByFloor ? " kpiSummaryPctFloor" : ""}`}
          data-label={pickLabel(kpiLabels.percent, locale)}
          aria-label={`${pickLabel(kpiLabels.percent, locale)}: ${percentText}`}
        >
          {percentText}
        </span>
        <span className="kpiLeaderVerdict">
          {verdictBadge(entry.barHit, entry.barHitByFloor, locale)}
          {caption != null ? <span className="kpiLeaderPrize">{caption}</span> : null}
        </span>
      </summary>

      <div className="kpiAudit">
        <div className="kpiAuditRule">
          <div className="kpiAuditRuleHead">
            <span className="kpiAuditRuleName">{pickLabel(kpiLabels.memberBreakdown, locale)}</span>
            <span className="kpiAuditRuleCounts">
              {pickLabel(kpiLabels.onTime, locale)} {entry.onTime}/{entry.applicable}
            </span>
          </div>
          <div className="kpiItemList">
            {entry.members.length === 0 ? (
              <div className="kpiItemRow">
                <span className="kpiSummaryMuted">{pickLabel(kpiLabels.noData, locale)}</span>
              </div>
            ) : (
              entry.members.map((member) => {
                const memberName =
                  locale === "ZH_CN" && member.chineseName != null ? member.chineseName : member.displayName;
                return (
                  <div className="kpiItemRow kpiLeaderMemberRow" key={member.userId}>
                    <span className="kpiItemRef" title={member.username}>
                      {memberName} · {member.username}
                    </span>
                    <span className="kpiLeaderMemberStats">
                      <span className="kpiSummaryNum">
                        {member.onTime}/{member.applicable}
                      </span>
                      <span className={`kpiSummaryNum kpiSummaryPct${member.barHitByFloor ? " kpiSummaryPctFloor" : ""}`}>
                        {formatScorePercent({ percent: member.percent, applicable: member.applicable })}
                      </span>
                      {verdictBadge(member.barHit, member.barHitByFloor, locale)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

/**
 * The "Leaders 组长达标" section that sits ABOVE the per-user grid: one row per
 * award-tier entry (Design, PMs, Assembly A/B, Injection) then a visually
 * separated referee pair (QC, Marketing). Each row's bar is the leader's GROUP
 * aggregate; hits show the money caption.
 */
function LeadersSection({ leaders, locale }: { leaders: LeaderEntry[]; locale: Locale }) {
  if (leaders.length === 0) {
    return null;
  }
  const award = leaders.filter((entry) => entry.tier === "award");
  const referees = leaders.filter((entry) => entry.tier === "referee");

  return (
    <div className="kpiLeadersSection" aria-labelledby="kpi-leaders-heading">
      <h3 id="kpi-leaders-heading" className="kpiLeadersTitle">
        {pickLabel(kpiLabels.leaders, locale)}
      </h3>
      <p className="kpiLeadersHint">{pickLabel(kpiLabels.leadersHint, locale)}</p>
      <div className="adminList">
        <div className="kpiScoreHeader kpiLeaderGrid">
          <span>{pickLabel(kpiLabels.leaderColumn, locale)}</span>
          <span>{pickLabel(kpiLabels.groupColumn, locale)}</span>
          <span className="kpiColNum">{pickLabel(kpiLabels.membersColumn, locale)}</span>
          <span className="kpiColNum">{pickLabel(kpiLabels.applicable, locale)}</span>
          <span className="kpiColNum">{pickLabel(kpiLabels.onTime, locale)}</span>
          <span className="kpiColNum">%</span>
          <span className="kpiColVerdict">{pickLabel(kpiLabels.verdict, locale)}</span>
        </div>
        {award.map((entry) => (
          <LeaderRow key={`${entry.leaderUserId}-${entry.groupCode ?? "individual"}`} entry={entry} locale={locale} />
        ))}
        {referees.length > 0 ? (
          <>
            <div className="kpiRefereeHeading">{pickLabel(kpiLabels.refereeHeading, locale)}</div>
            {referees.map((entry) => (
              <LeaderRow key={`${entry.leaderUserId}-${entry.groupCode ?? "referee"}`} entry={entry} locale={locale} />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Render a single audit item row. Boolean rules show a pass/fail chip
 * ("completed ✓ / not completed ✗"); timed rules show "Due … · Done … ✓/✗", or
 * for a not-yet-done past-due item "Due … · not done ✗". (Pending items — not
 * done, not yet due — are excluded upstream by the engine, so they never reach
 * this list; the neutral-gray branch is kept only as a defensive fallback.)
 */
function AuditItemRow({
  item,
  isBoolean,
  locale
}: {
  item: ScorecardItem;
  isBoolean: boolean;
  locale: Locale;
}) {
  return (
    <div className="kpiItemRow">
      <span className="kpiItemRef" title={item.ref}>
        {item.ref}
      </span>
      {isBoolean ? (
        <span className={`kpiChip ${item.onTime ? "kpiChipPass" : "kpiChipFail"}`}>
          {item.onTime
            ? `${pickLabel(kpiLabels.completed, locale)} ✓`
            : `${pickLabel(kpiLabels.notCompleted, locale)} ✗`}
        </span>
      ) : item.doneAt != null ? (
        <span className={`kpiItemStatus ${item.onTime ? "kpiItemOk" : "kpiItemLate"}`}>
          {pickLabel(kpiLabels.dueAt, locale)} {formatWhen(item.dueAt, locale)} ·{" "}
          {pickLabel(kpiLabels.doneAt, locale)} {formatWhen(item.doneAt, locale)} {item.onTime ? "✓" : "✗"}
        </span>
      ) : item.dueAt != null && !item.onTime ? (
        // Not done and past due => late.
        <span className="kpiItemStatus kpiItemLate">
          {pickLabel(kpiLabels.dueAt, locale)} {formatWhen(item.dueAt, locale)} · {pickLabel(kpiLabels.notDone, locale)} ✗
        </span>
      ) : (
        // Defensive: not done, not yet due (engine excludes these) => neutral gray.
        <span className="kpiItemStatus kpiItemPending">
          {pickLabel(kpiLabels.pending, locale)} · {pickLabel(kpiLabels.due, locale)} {formatWhen(item.dueAt, locale)}
        </span>
      )}
    </div>
  );
}

/** One rule subsection inside a user's audit: heading + counts + capped item list. */
function AuditRuleSection({
  line,
  ruleLabels,
  locale
}: {
  line: ScorecardRuleLine;
  ruleLabels: Record<string, { en: string; zh: string }>;
  locale: Locale;
}) {
  const label = ruleLabels[line.ruleCode] ?? { en: line.ruleCode, zh: line.ruleCode };
  const isBoolean = isBooleanKpiRuleCode(line.ruleCode);
  const visible = line.items.slice(0, ITEM_CAP);
  const overflow = line.items.slice(ITEM_CAP);

  return (
    <div className="kpiAuditRule">
      <div className="kpiAuditRuleHead">
        <span className="kpiAuditRuleName">{pickLabel(label, locale)}</span>
        <span className="kpiAuditRuleCounts">
          {pickLabel(kpiLabels.onTime, locale)} {line.onTime}/{line.applicable}
        </span>
      </div>
      <div className="kpiItemList">
        {visible.map((item, index) => (
          <AuditItemRow key={`${line.ruleCode}-${index}`} item={item} isBoolean={isBoolean} locale={locale} />
        ))}
        {overflow.length > 0 ? (
          <details className="kpiMoreDetails">
            <summary>
              +{overflow.length} {pickLabel(kpiLabels.showMore, locale)}
            </summary>
            <div className="kpiItemList">
              {overflow.map((item, index) => (
                <AuditItemRow
                  key={`${line.ruleCode}-more-${index}`}
                  item={item}
                  isBoolean={isBoolean}
                  locale={locale}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One sortable column header: an <a> that round-trips to the server with the
 * new sort params while preserving the month. Reuses the .sortButton/.sortIcon
 * chrome from the dashboard table — the active column shows ▲/▼, the rest a
 * muted ↕ affordance. `label` is already locale-resolved by the caller.
 */
function SortHeader({
  columnKey,
  label,
  sort,
  month,
  locale,
  className,
  navigationBasePath
}: {
  columnKey: KpiSortKey;
  label: string;
  sort: KpiSortState;
  month: string;
  locale: Locale;
  className?: string;
  navigationBasePath: string;
}) {
  const active = sort.key === columnKey;
  // Active column toggles; an inactive column adopts its own default direction.
  const nextDirection = active
    ? sort.direction === "asc"
      ? "desc"
      : "asc"
    : defaultKpiSortDirection(columnKey);
  const href = `${navigationBasePath}&month=${month}&scoreSort=${columnKey}&scoreDir=${nextDirection}`;
  const directionLabel = pickLabel(
    sort.direction === "asc" ? kpiLabels.ascending : kpiLabels.descending,
    locale
  );
  const hint = active
    ? `${label} · ${directionLabel}`
    : `${pickLabel(kpiLabels.sortBy, locale)} ${label}`;

  return (
    <a
      className={`sortButton kpiSortHeader${className ? ` ${className}` : ""}${active ? " sortButtonActive" : ""}`}
      href={href}
      title={hint}
      aria-label={hint}
    >
      <span>{label}</span>
      <span className="sortIcon" aria-hidden="true">
        {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </a>
  );
}

/** Shared Admin/Reports scorecards: one scorer, leader bars, rows, sorting, and audit drilldowns. */
export function KpiScoresPanel({
  scores,
  ruleLabels,
  scoreboardEnabled,
  locale,
  redirectTo,
  prevMonth,
  nextMonth,
  sort,
  navigationBasePath = "/admin?tab=scores",
  showScoreboardControls = true
}: KpiScoresPanelProps) {
  const departmentByScope = new Map(scores.departments.map((department) => [department.roleScope, department]));

  // Sort params ride along with the month so switching months keeps the order.
  const sortQuery = `scoreSort=${sort.key}&scoreDir=${sort.direction}`;

  // Enrich each user with the display-resolved fields the comparator needs,
  // then sort; the original ScoredUser flows back through on `.user`.
  const sortedUsers = sortKpiRows(
    scores.users.map((user) => {
      const card = user.scorecard;
      const name = locale === "ZH_CN" && user.chineseName != null ? user.chineseName : user.displayName;
      return {
        user,
        name,
        role: user.roleName,
        applicable: card.applicable,
        onTime: card.onTime,
        percent: card.percent,
        totalPoints: card.totalPoints,
        hasData: card.applicable > 0 || card.points.length > 0,
        barHit: card.barHit,
        barHitByFloor: card.barHitByFloor
      };
    }),
    sort
  );

  return (
    <section className="workSurface" aria-labelledby="kpi-scores-heading">
      <div className="surfaceHeader">
        <div>
          <h2 id="kpi-scores-heading">{pickLabel(kpiLabels.scoresTitle, locale)}</h2>
          <p className="text-sm text-neutral-600">
            {pickLabel(kpiLabels.month, locale)}: <strong>{scores.month}</strong>
          </p>
        </div>
        <div className="roleActions">
          <a className="buttonLink" href={`${navigationBasePath}&month=${prevMonth}&${sortQuery}`}>
            ‹ {prevMonth}
          </a>
          <a className="buttonLink" href={`${navigationBasePath}&month=${nextMonth}&${sortQuery}`}>
            {nextMonth} ›
          </a>
        </div>
      </div>

      {showScoreboardControls ? (
      <div className={`notice mb-3 ${scoreboardEnabled ? "noticeSuccess" : ""}`} role="note">
        <strong>
          {pickLabel(kpiLabels.scoreboardVisibility, locale)}:{" "}
          <StatusBadge tone={scoreboardEnabled ? "completed" : "paused"}>
            {scoreboardEnabled ? "On" : "Off"}
          </StatusBadge>
        </strong>
        <span>
          {scoreboardEnabled
            ? pickLabel(kpiLabels.scoreboardOn, locale)
            : pickLabel(kpiLabels.scoreboardOff, locale)}
        </span>
        <form action={setScoreboardEnabled} className="mt-2">
          <input type="hidden" name="redirectTo" value={redirectTo ?? navigationBasePath} />
          <input type="hidden" name="enabled" value={scoreboardEnabled ? "false" : "true"} />
          {/* On => the action is "turn off" (quiet secondary); Off => "turn on"
              (filled primary, the bare button default). */}
          <button type="submit" className={scoreboardEnabled ? "secondaryButton" : ""}>
            {scoreboardEnabled
              ? pickLabel(kpiLabels.scoreboardOff, locale)
              : pickLabel(kpiLabels.scoreboardOn, locale)}
          </button>
        </form>
      </div>
      ) : null}

      <LeadersSection leaders={scores.leaders} locale={locale} />

      <div className="adminList">
        {/* Column header — same grid class as every row, so the tracks line up.
            Each cell is now a sort link (server round-trip via ?scoreSort/
            ?scoreDir); the whole header is hidden once rows stack below 840px. */}
        <div className="kpiScoreHeader kpiScoreGrid">
          <SortHeader columnKey="name" label={pickLabel(kpiLabels.name, locale)} sort={sort} month={scores.month} locale={locale} navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="role" label={pickLabel(kpiLabels.role, locale)} sort={sort} month={scores.month} locale={locale} navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="applicable" label={pickLabel(kpiLabels.applicable, locale)} sort={sort} month={scores.month} locale={locale} className="kpiColNum" navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="ontime" label={pickLabel(kpiLabels.onTime, locale)} sort={sort} month={scores.month} locale={locale} className="kpiColNum" navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="percent" label="%" sort={sort} month={scores.month} locale={locale} className="kpiColNum" navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="bar" label={pickLabel(kpiLabels.verdict, locale)} sort={sort} month={scores.month} locale={locale} className="kpiColVerdict" navigationBasePath={navigationBasePath} />
          <SortHeader columnKey="points" label={pickLabel(kpiLabels.points, locale)} sort={sort} month={scores.month} locale={locale} className="kpiColNum" navigationBasePath={navigationBasePath} />
        </div>
        {sortedUsers.map(({ user, name, hasData }) => {
          const card = user.scorecard;
          const department = user.roleScope == null ? null : departmentByScope.get(user.roleScope) ?? null;
          return (
            <details key={user.userId} className="kpiScoreRow">
              <summary className="kpiScoreSummary kpiScoreGrid">
                <span className="kpiSummaryName" title={name}>
                  {name}
                </span>
                <span className="kpiSummaryMuted" title={user.roleName}>
                  {user.roleName}
                </span>
                {hasData ? (
                  <>
                    {/* Bare values only (labels live in the header row above, and
                        return via ::before when stacked); aria-label keeps each
                        cell self-describing for assistive tech. */}
                    <span
                      className="kpiSummaryNum"
                      data-label={pickLabel(kpiLabels.applicable, locale)}
                      aria-label={`${pickLabel(kpiLabels.applicable, locale)}: ${card.applicable}`}
                    >
                      {card.applicable}
                    </span>
                    <span
                      className="kpiSummaryNum"
                      data-label={pickLabel(kpiLabels.onTime, locale)}
                      aria-label={`${pickLabel(kpiLabels.onTime, locale)}: ${card.onTime}`}
                    >
                      {card.onTime}
                    </span>
                    <span
                      className={`kpiSummaryNum kpiSummaryPct${card.barHitByFloor ? " kpiSummaryPctFloor" : ""}`}
                      data-label={pickLabel(kpiLabels.percent, locale)}
                      aria-label={`${pickLabel(kpiLabels.percent, locale)}: ${formatScorePercent({ percent: card.percent, applicable: card.applicable })}`}
                    >
                      {formatScorePercent({ percent: card.percent, applicable: card.applicable })}
                    </span>
                    <span className="kpiSummaryVerdict">
                      {verdictBadge(card.barHit, card.barHitByFloor, locale)}
                    </span>
                    <span
                      className="kpiSummaryNum"
                      data-label={pickLabel(kpiLabels.points, locale)}
                      aria-label={`${pickLabel(kpiLabels.points, locale)}: ${card.totalPoints}`}
                    >
                      {card.totalPoints}
                    </span>
                  </>
                ) : (
                  <span className="kpiSummaryMuted kpiSummaryNoData">
                    {pickLabel(kpiLabels.noData, locale)}
                  </span>
                )}
              </summary>

              {hasData ? (
                <div className="kpiAudit">
                  {department != null ? (
                    <p className="kpiSummaryMuted" style={{ whiteSpace: "normal" }}>
                      {pickLabel(kpiLabels.department, locale)} {department.percent}%
                    </p>
                  ) : null}

                  {card.lines.map((line) => (
                    <AuditRuleSection key={line.ruleCode} line={line} ruleLabels={ruleLabels} locale={locale} />
                  ))}

                  {card.points.length > 0 ? (
                    <div className="kpiAuditRule">
                      <div className="kpiAuditRuleHead">
                        <span className="kpiAuditRuleName">{pickLabel(kpiLabels.pointsBreakdown, locale)}</span>
                        <span className="kpiAuditRuleCounts">
                          {pickLabel(kpiLabels.total, locale)} {card.totalPoints}
                        </span>
                      </div>
                      <div className="kpiPointsList">
                        {card.points.map((point, index) => (
                          <div className="kpiItemRow" key={`${point.issueRef}-${index}`}>
                            <span className="kpiItemRef" title={point.issueRef}>
                              {point.issueRef}
                            </span>
                            <span className={`kpiItemStatus ${point.verified ? "kpiItemOk" : "kpiItemLate"}`}>
                              {point.severity} {point.weight} ·{" "}
                              {point.verified ? point.counted : pickLabel(kpiLabels.provisionalZero, locale)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </section>
  );
}
