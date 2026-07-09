import {
  isDormantRoleScope,
  kpiLabels,
  kpiRoleScopeLabels,
  kpiRoleScopeOrder,
  kpiRuleMaxHours,
  kpiRuleMinHours,
  type KpiRoleScope
} from "@/domain/mold-trial/kpi-rules";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { recomputeKpiSnapshotsNow, updateKpiRule } from "@/server/kpi-actions";

export type KpiRulePanelRow = {
  id: string;
  code: string;
  labelEn: string;
  labelZh: string;
  hours: number | null;
  roleScope: string;
  active: boolean;
  sortOrder: number;
  updatedByName: string | null;
  /** True only after a real admin edit (updatedAt bumped past createdAt). */
  everEdited: boolean;
  updatedAt: string | null;
};

export type KpiRulesPanelProps = {
  rules: KpiRulePanelRow[];
  locale: Locale;
  redirectTo: string;
};

function formatWhen(value: string | null, locale: Locale): string {
  if (value == null) {
    return pickLabel(kpiLabels.never, locale);
  }
  return new Date(value).toLocaleString(locale === "ZH_CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Admin "Rules" tab: the KPI habit-rule registry, grouped by role scope. */
export function KpiRulesPanel({ rules, locale, redirectTo }: KpiRulesPanelProps) {
  const byScope = new Map<string, KpiRulePanelRow[]>();
  for (const rule of rules) {
    const list = byScope.get(rule.roleScope) ?? [];
    list.push(rule);
    byScope.set(rule.roleScope, list);
  }
  for (const list of byScope.values()) {
    list.sort((left, right) => left.sortOrder - right.sortOrder);
  }
  const orderedScopes = kpiRoleScopeOrder.filter((scope) => byScope.has(scope));

  return (
    <section className="workSurface" aria-labelledby="kpi-rules-heading">
      <div className="surfaceHeader">
        <h2 id="kpi-rules-heading">{pickLabel(kpiLabels.rulesTitle, locale)}</h2>
        <form action={recomputeKpiSnapshotsNow}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button type="submit" className="secondaryButton">
            {pickLabel(kpiLabels.recomputeNow, locale)}
          </button>
        </form>
      </div>

      <div className="kpiRulesBody">
        {/* One combined warning banner: mid-month rescore + literal-hours note. */}
        <div className="notice noticeWarning" role="note">
          <strong>{pickLabel(kpiLabels.rescoreWarning, locale)}</strong>
          <span>{pickLabel(kpiLabels.weekendsNote, locale)}</span>
        </div>

        {orderedScopes.map((scope) => {
          const dormant = isDormantRoleScope(scope);
          const rows = byScope.get(scope) ?? [];
          const scopeLabel = kpiRoleScopeLabels[scope as KpiRoleScope];
          return (
            <div key={scope} className="kpiRulesGroup">
              <div className="kpiRulesGroupHead">
                <span className="kpiRulesGroupTitle">{pickLabel(scopeLabel, locale)}</span>
                <span className="kpiRulesGroupTitleZh">
                  {locale === "ZH_CN" ? scopeLabel.en : scopeLabel.zh}
                </span>
                {dormant ? (
                  <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                    {pickLabel(kpiLabels.rolePendingZh, locale)}
                  </span>
                ) : null}
              </div>
              <div className="adminList">
                {rows.map((rule) => {
                  const isBoolean = rule.hours == null;
                  const changed =
                    rule.everEdited && rule.updatedByName != null
                      ? `${pickLabel(kpiLabels.changedBy, locale)} ${rule.updatedByName} · ${formatWhen(rule.updatedAt, locale)}`
                      : pickLabel(kpiLabels.neverChanged, locale);
                  return (
                    <form
                      key={rule.id}
                      action={updateKpiRule}
                      className={`kpiRuleRow${dormant ? " kpiRuleRowDormant" : ""}`}
                    >
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <input type="hidden" name="ruleId" value={rule.id} />

                      {/* Behavior name is PLAIN TEXT (not an editable input); the
                          rule code sits beneath in small muted mono. */}
                      <div className="kpiRuleName">
                        <span className="kpiRuleNameText">
                          {pickLabel({ en: rule.labelEn, zh: rule.labelZh }, locale)}
                        </span>
                        <span className="kpiRuleCode">{rule.code}</span>
                      </div>

                      {isBoolean ? (
                        <span className="kpiRuleHoursBoolean">{pickLabel(kpiLabels.boolean, locale)}</span>
                      ) : (
                        <label className="kpiRuleHours">
                          <input
                            name="hours"
                            type="number"
                            min={kpiRuleMinHours}
                            max={kpiRuleMaxHours}
                            step={1}
                            defaultValue={rule.hours ?? undefined}
                            disabled={dormant}
                            required
                            aria-label={pickLabel(kpiLabels.deadlineHours, locale)}
                          />
                          <span>{pickLabel(kpiLabels.hourSuffix, locale)}</span>
                        </label>
                      )}

                      <label className="kpiRuleActive">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={rule.active}
                          disabled={dormant}
                          aria-label={pickLabel(kpiLabels.active, locale)}
                        />
                        <span>{pickLabel(kpiLabels.active, locale)}</span>
                      </label>

                      <div className="kpiRuleSave">
                        <button type="submit" disabled={dormant}>
                          {pickLabel(kpiLabels.save, locale)}
                        </button>
                        <small className="kpiRuleChanged">
                          {pickLabel(kpiLabels.lastChanged, locale)}: {changed}
                        </small>
                      </div>
                    </form>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
