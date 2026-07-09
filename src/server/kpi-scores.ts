/**
 * KPI scores assembly — loads the current rule config + active users, extracts
 * this-month events, and runs the pure engine to produce every user's monthly
 * scorecard plus per-department rollups. Also persists KpiSnapshot rows (the
 * nightly job + the admin "Recompute now" button share `writeKpiSnapshots`).
 *
 * The current month is always live-computed with the CURRENT rules (so a
 * mid-month rule edit re-scores the whole month). Trend history reads snapshots
 * later; this phase writes them but the surfaces still compute live.
 */

import {
  defaultKpiRules,
  isKpiRuleCode,
  isScoredRole,
  roleScopeDepartmentGroupCode,
  type KpiRoleScope
} from "@/domain/mold-trial/kpi-rules";
import {
  computeDepartmentRollup,
  computeScorecard,
  type KpiHabitEvent,
  type KpiPointsEvent,
  type Scorecard,
  type ScoringRule
} from "@/domain/mold-trial/kpi-scoring";
import { roleCodeLabels } from "@/server/mold-trial-codecs";
import { extractKpiEvents, monthWindow, type RuleHoursByCode } from "@/server/kpi-events";
import { prisma } from "@/lib/prisma";

export type ScoredUser = {
  userId: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  roleCode: string;
  roleName: string;
  /** The role scope this user's events feed (pm/injection/... or "all"). */
  roleScope: KpiRoleScope | null;
  scorecard: Scorecard;
};

export type DepartmentRollup = {
  roleScope: KpiRoleScope;
  groupCode: string;
  applicable: number;
  onTime: number;
  percent: number;
  barHit: boolean;
  barHitByFloor: boolean;
};

export type MonthlyScores = {
  month: string;
  users: ScoredUser[];
  departments: DepartmentRollup[];
};

/** Map a DB role code to the role scope whose bar that role's events feed. */
function roleScopeForRole(dbRoleCode: string): KpiRoleScope | null {
  switch (dbRoleCode) {
    case "pm":
      return "pm";
    case "injection":
      return "injection";
    case "assembly":
      return "assembly";
    case "marketing":
      return "marketing";
    case "qc":
      return "qc";
    default:
      return null;
  }
}

/** Load the active rule config projected for the engine + an hours lookup. */
async function loadRuleConfig(): Promise<{ rules: ScoringRule[]; ruleHours: RuleHoursByCode }> {
  const rows = await prisma.kpiRule.findMany();
  const rules: ScoringRule[] = [];
  const ruleHours: RuleHoursByCode = {};

  const source =
    rows.length > 0
      ? rows.map((row) => ({ code: row.code, hours: row.hours, active: row.active }))
      : // Fall back to defaults if the registry has not been seeded yet, so the
        // engine still runs in a fresh environment.
        defaultKpiRules.map((rule) => ({ code: rule.code, hours: rule.hours, active: rule.active }));

  for (const row of source) {
    if (!isKpiRuleCode(row.code)) {
      continue;
    }
    rules.push({ code: row.code, hours: row.hours, active: row.active });
    ruleHours[row.code] = row.hours;
  }

  return { rules, ruleHours };
}

/**
 * Compute every active user's scorecard for a month plus department rollups.
 * `now` decides the pending/late boundary (defaults to the real clock).
 */
export async function computeMonthlyScores(month: string, now: Date = new Date()): Promise<MonthlyScores> {
  const window = monthWindow(month);
  const { rules, ruleHours } = await loadRuleConfig();

  const [allUsers, extraction] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      include: { role: { select: { code: true, name: true } } },
      orderBy: [{ username: "asc" }]
    }),
    extractKpiEvents(window, ruleHours)
  ]);

  // Only scored roles (PM / INJECTION / ASSEMBLY / QC / MARKETING / DESIGN) get
  // a scorecard. ADMIN / GM / VIEWER are excluded here so they never appear in
  // the Scores tab, never get a persisted snapshot, and never resolve on /score.
  const users = allUsers.filter((user) => isScoredRole(user.role.code));

  const habitByUser = new Map<string, KpiHabitEvent[]>();
  for (const event of extraction.habitEvents) {
    const list = habitByUser.get(event.userId) ?? [];
    list.push(event);
    habitByUser.set(event.userId, list);
  }
  const pointsByUser = new Map<string, KpiPointsEvent[]>();
  for (const event of extraction.pointsEvents) {
    const list = pointsByUser.get(event.userId) ?? [];
    list.push(event);
    pointsByUser.set(event.userId, list);
  }

  const scoredUsers: ScoredUser[] = users.map((user) => {
    const scorecard = computeScorecard({
      userId: user.id,
      habitEvents: habitByUser.get(user.id) ?? [],
      pointsEvents: pointsByUser.get(user.id) ?? [],
      rules,
      now
    });
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      chineseName: user.chineseName,
      roleCode: user.role.code,
      roleName: roleCodeLabels[user.role.code] ?? user.role.name,
      roleScope: roleScopeForRole(user.role.code),
      scorecard
    };
  });

  // Department rollups: group scorecards by the owning group's role scope.
  const departments: DepartmentRollup[] = [];
  const scopeToUsers = new Map<KpiRoleScope, Scorecard[]>();
  for (const scored of scoredUsers) {
    if (scored.roleScope == null) {
      continue;
    }
    const list = scopeToUsers.get(scored.roleScope) ?? [];
    list.push(scored.scorecard);
    scopeToUsers.set(scored.roleScope, list);
  }
  for (const [roleScope, cards] of scopeToUsers) {
    const groupCode = roleScopeDepartmentGroupCode[roleScope];
    if (groupCode == null) {
      continue;
    }
    const rollup = computeDepartmentRollup(cards);
    departments.push({ roleScope, groupCode, ...rollup });
  }

  return { month, users: scoredUsers, departments };
}

/** JSON-safe scorecard (dates as ISO strings) for KpiSnapshot.metricsJson. */
function serializeScorecard(card: Scorecard) {
  return {
    applicable: card.applicable,
    onTime: card.onTime,
    percent: card.percent,
    barHit: card.barHit,
    barHitByFloor: card.barHitByFloor,
    totalPoints: card.totalPoints,
    lines: card.lines.map((line) => ({
      ruleCode: line.ruleCode,
      applicable: line.applicable,
      onTime: line.onTime,
      items: line.items.map((item) => ({
        ref: item.ref,
        dueAt: item.dueAt?.toISOString() ?? null,
        doneAt: item.doneAt?.toISOString() ?? null,
        onTime: item.onTime
      }))
    })),
    points: card.points.map((line) => ({
      issueRef: line.issueRef,
      severity: line.severity,
      weight: line.weight,
      verified: line.verified,
      counted: line.counted
    }))
  };
}

/**
 * Persist one snapshot row per scope (USER + DEPARTMENT_GROUP + COMPANY) for a
 * month, dated `snapshotDate`. Replaces any existing rows with the same
 * (snapshotDate, scopeType, scopeId) so re-running a day is idempotent.
 */
export async function writeKpiSnapshots(month: string, snapshotDate: Date, now: Date = new Date()): Promise<number> {
  const scores = await computeMonthlyScores(month, now);
  const dateOnly = new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth(), snapshotDate.getUTCDate()));

  const groupByCode = new Map(
    (await prisma.departmentGroup.findMany({ select: { id: true, code: true } })).map((group) => [group.code, group.id])
  );

  let written = 0;

  await prisma.$transaction(async (tx) => {
    // USER scope
    for (const user of scores.users) {
      await tx.kpiSnapshot.deleteMany({
        where: { snapshotDate: dateOnly, scopeType: "USER", scopeId: user.userId }
      });
      await tx.kpiSnapshot.create({
        data: {
          snapshotDate: dateOnly,
          scopeType: "USER",
          scopeId: user.userId,
          metricsJson: {
            month,
            username: user.username,
            roleCode: user.roleCode,
            roleScope: user.roleScope,
            scorecard: serializeScorecard(user.scorecard)
          }
        }
      });
      written += 1;
    }

    // DEPARTMENT_GROUP scope
    for (const department of scores.departments) {
      const groupId = groupByCode.get(department.groupCode) ?? null;
      await tx.kpiSnapshot.deleteMany({
        where: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: groupId }
      });
      await tx.kpiSnapshot.create({
        data: {
          snapshotDate: dateOnly,
          scopeType: "DEPARTMENT_GROUP",
          scopeId: groupId,
          metricsJson: {
            month,
            roleScope: department.roleScope,
            groupCode: department.groupCode,
            applicable: department.applicable,
            onTime: department.onTime,
            percent: department.percent,
            barHit: department.barHit,
            barHitByFloor: department.barHitByFloor
          }
        }
      });
      written += 1;
    }

    // COMPANY scope
    const companyApplicable = scores.users.reduce((sum, user) => sum + user.scorecard.applicable, 0);
    const companyOnTime = scores.users.reduce((sum, user) => sum + user.scorecard.onTime, 0);
    await tx.kpiSnapshot.deleteMany({
      where: { snapshotDate: dateOnly, scopeType: "COMPANY", scopeId: null }
    });
    await tx.kpiSnapshot.create({
      data: {
        snapshotDate: dateOnly,
        scopeType: "COMPANY",
        scopeId: null,
        metricsJson: {
          month,
          applicable: companyApplicable,
          onTime: companyOnTime,
          percent: companyApplicable === 0 ? 100 : Math.round((companyOnTime / companyApplicable) * 100),
          userCount: scores.users.length
        }
      }
    });
    written += 1;
  });

  return written;
}
