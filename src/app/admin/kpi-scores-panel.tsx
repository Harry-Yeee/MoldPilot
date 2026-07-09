import { StatusBadge } from "@/components/ui";
import { isBooleanKpiRuleCode, kpiLabels } from "@/domain/mold-trial/kpi-rules";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";
import type { ScorecardItem, ScorecardRuleLine } from "@/domain/mold-trial/kpi-scoring";
import type { MonthlyScores } from "@/server/kpi-scores";
import { setScoreboardEnabled } from "@/server/kpi-actions";

/** How many audit item rows to show before collapsing the rest behind "+N more". */
const ITEM_CAP = 6;

export type KpiScoresPanelProps = {
  scores: MonthlyScores;
  ruleLabels: Record<string, { en: string; zh: string }>;
  scoreboardEnabled: boolean;
  locale: Locale;
  redirectTo: string;
  /** Adjacent months for the picker, as YYYY-MM. */
  prevMonth: string;
  nextMonth: string;
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
    return <StatusBadge tone="paused">{pickLabel(kpiLabels.notEnough, locale)}</StatusBadge>;
  }
  return barHit ? (
    <StatusBadge tone="completed">{pickLabel(kpiLabels.hit, locale)}</StatusBadge>
  ) : (
    <StatusBadge tone="missed">{pickLabel(kpiLabels.miss, locale)}</StatusBadge>
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

/** Admin "Scores" tab: month picker, visibility toggle, per-user audit rows. */
export function KpiScoresPanel({
  scores,
  ruleLabels,
  scoreboardEnabled,
  locale,
  redirectTo,
  prevMonth,
  nextMonth
}: KpiScoresPanelProps) {
  const departmentByScope = new Map(scores.departments.map((department) => [department.roleScope, department]));

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
          <a className="buttonLink" href={`/admin?tab=scores&month=${prevMonth}`}>
            ‹ {prevMonth}
          </a>
          <a className="buttonLink" href={`/admin?tab=scores&month=${nextMonth}`}>
            {nextMonth} ›
          </a>
        </div>
      </div>

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
          <input type="hidden" name="redirectTo" value={redirectTo} />
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

      <div className="adminList">
        {scores.users.map((user) => {
          const card = user.scorecard;
          const name = locale === "ZH_CN" && user.chineseName != null ? user.chineseName : user.displayName;
          const department = user.roleScope == null ? null : departmentByScope.get(user.roleScope) ?? null;
          const hasData = card.applicable > 0 || card.points.length > 0;
          return (
            <details key={user.userId} className="kpiScoreRow">
              <summary className="kpiScoreSummary">
                <span className="kpiSummaryName" title={name}>
                  {name}
                </span>
                <span className="kpiSummaryMuted" title={user.roleName}>
                  {user.roleName}
                </span>
                {hasData ? (
                  <>
                    <span className="kpiSummaryStat">
                      {pickLabel(kpiLabels.applicable, locale)} <b>{card.applicable}</b>
                    </span>
                    <span className="kpiSummaryStat">
                      {pickLabel(kpiLabels.onTime, locale)} <b>{card.onTime}</b>
                    </span>
                    <span className="kpiSummaryPct">{card.percent}%</span>
                    <span>{verdictBadge(card.barHit, card.barHitByFloor, locale)}</span>
                    <span className="kpiSummaryStat">
                      {pickLabel(kpiLabels.points, locale)} <b>{card.totalPoints}</b>
                    </span>
                  </>
                ) : (
                  <span className="kpiSummaryMuted" style={{ gridColumn: "3 / -1" }}>
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
