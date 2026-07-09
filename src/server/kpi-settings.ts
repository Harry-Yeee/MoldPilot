/**
 * System-setting accessors for the KPI feature. Currently just the staff
 * scoreboard visibility flag; kept isolated so page/server code never touches
 * the raw table shape.
 */

import { defaultKpiRules, scoreboardEnabledSettingKey } from "@/domain/mold-trial/kpi-rules";
import { prisma } from "@/lib/prisma";

/** Whether the staff-facing personal scoreboard is enabled (default false). */
export async function isScoreboardEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: scoreboardEnabledSettingKey }
  });
  return setting?.value === "true";
}

/**
 * Make sure the KPI rule registry is populated. The scoring engine already
 * falls back to `defaultKpiRules` when the table is empty, but the admin Rules
 * panel and the Scores label lookup read the table directly — so an unseeded
 * table shows an empty registry ("no deadlines to set") and raw rule codes on
 * the scoreboard. This idempotently inserts any MISSING default rules and never
 * touches existing rows, so admin-edited hours / active toggles are preserved.
 * Cheap (a single findMany + at most one createMany) and safe to call on load.
 */
export async function ensureDefaultKpiRules(): Promise<void> {
  const existing = await prisma.kpiRule.findMany({ select: { code: true } });
  const present = new Set(existing.map((rule) => rule.code));
  const missing = defaultKpiRules.filter((rule) => !present.has(rule.code));
  if (missing.length === 0) {
    return;
  }

  await prisma.kpiRule.createMany({
    data: missing.map((rule) => ({
      code: rule.code,
      labelEn: rule.labelEn,
      labelZh: rule.labelZh,
      hours: rule.hours,
      roleScope: rule.roleScope,
      active: rule.active,
      sortOrder: rule.sortOrder
    })),
    skipDuplicates: true
  });
}
