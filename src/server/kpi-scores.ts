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
  isKpiRefereeGroupCode,
  isScoredRole,
  kpiLeaderGroupLabels,
  roleScopeDepartmentGroupCode,
  type KpiRoleScope
} from "@/domain/mold-trial/kpi-rules";
import {
  computeDepartmentRollup,
  computeScorecard,
  type KpiHabitEvent,
  type KpiPointsEvent,
  type Scorecard
} from "@/domain/mold-trial/kpi-scoring";
import {
  leaderBoardEntries,
  type LeaderBoardEntry,
  type LeaderGroupInput,
  type LeaderMemberScorecard
} from "@/domain/mold-trial/kpi-leader-bar";
import type { BilingualLabel } from "@/domain/mold-trial/labels";
import { roleCodeLabels } from "@/server/mold-trial-codecs";
import { extractKpiEvents, loadRuleConfig, monthWindow } from "@/server/kpi-events";
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

/**
 * One row on the Scores tab's Leaders section: a domain leader-board entry plus
 * the display fields the panel needs — the prize `tier` (award ¥400 vs referee
 * ¥250) and the leader's own name. `kind` distinguishes a real group aggregate
 * from an award-tier individual (a PM whose bar is their own card).
 */
export type LeaderEntry = LeaderBoardEntry & {
  tier: "award" | "referee";
  leaderDisplayName: string;
  leaderChineseName: string | null;
};

export type MonthlyScores = {
  month: string;
  users: ScoredUser[];
  departments: DepartmentRollup[];
  /** Per-leader group bars (award tier + referee tier) from real membership. */
  leaders: LeaderEntry[];
};

export async function loadKpiRuleLabels(): Promise<Record<string, { en: string; zh: string }>> {
  const rows = await prisma.kpiRule.findMany({
    select: { code: true, labelEn: true, labelZh: true }
  });

  return {
    ...Object.fromEntries(defaultKpiRules.map((rule) => [rule.code, { en: rule.labelEn, zh: rule.labelZh }])),
    ...Object.fromEntries(rows.map((rule) => [rule.code, { en: rule.labelEn, zh: rule.labelZh }]))
  };
}

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

  // ── Leader-designation layer ──────────────────────────────────────────────
  // Turn per-user scorecards into per-leader GROUP bars from real membership:
  // each scored user's card feeds exactly one KPI group via departmentGroupId,
  // and each group's designated leader (DepartmentGroup.kpiLeaderId) owns the
  // aggregate. The `pm` group has NO leader by design — its members are award-
  // tier individuals whose bar is their own card. Referees (qc, marketing)
  // aggregate the same way; their entries are the referee service bars.
  const groupRows = await prisma.departmentGroup.findMany({
    select: { id: true, code: true, name: true, kpiLeaderId: true }
  });
  const groupByCode = new Map(groupRows.map((group) => [group.code, group]));
  const userById = new Map(users.map((user) => [user.id, user]));

  const memberIdsByGroupId = new Map<string, string[]>();
  for (const user of users) {
    if (user.departmentGroupId == null) {
      continue;
    }
    const list = memberIdsByGroupId.get(user.departmentGroupId) ?? [];
    list.push(user.id);
    memberIdsByGroupId.set(user.departmentGroupId, list);
  }

  const userScorecards: LeaderMemberScorecard[] = scoredUsers.map((scored) => ({
    userId: scored.userId,
    username: scored.username,
    displayName: scored.displayName,
    chineseName: scored.chineseName,
    scorecard: scored.scorecard
  }));

  const groupLabel = (code: string, fallbackName: string): BilingualLabel =>
    kpiLeaderGroupLabels[code] ?? { en: fallbackName, zh: fallbackName };

  const ledGroupInput = (code: string): LeaderGroupInput | null => {
    const group = groupByCode.get(code);
    if (group == null || group.kpiLeaderId == null) {
      return null;
    }
    return {
      leaderUserId: group.kpiLeaderId,
      groupId: group.id,
      groupCode: group.code,
      label: groupLabel(group.code, group.name),
      kind: "group",
      memberUserIds: memberIdsByGroupId.get(group.id) ?? []
    };
  };

  // PMs: the pm group carries no leader, so each member is their own individual
  // (their "leader bar" is their own user scorecard, by design).
  const pmGroup = groupByCode.get("pm");
  const pmIndividualInputs: LeaderGroupInput[] =
    pmGroup == null || pmGroup.kpiLeaderId != null
      ? []
      : (memberIdsByGroupId.get(pmGroup.id) ?? [])
          .map((id) => userById.get(id))
          .filter((user): user is (typeof users)[number] => user != null)
          .sort((left, right) => left.username.localeCompare(right.username))
          .map((user) => ({
            leaderUserId: user.id,
            groupId: null,
            groupCode: null,
            label: groupLabel("pm", "PM"),
            kind: "individual" as const,
            memberUserIds: [user.id]
          }));

  // Display order: award tier (Design, PMs, Assembly A/B, Injection) then the
  // referee pair (QC, Marketing).
  const leaderInputs: LeaderGroupInput[] = [];
  const designInput = ledGroupInput("design");
  if (designInput != null) {
    leaderInputs.push(designInput);
  }
  leaderInputs.push(...pmIndividualInputs);
  for (const code of ["assembly-a", "assembly-b", "injection", "qc", "marketing"]) {
    const input = ledGroupInput(code);
    if (input != null) {
      leaderInputs.push(input);
    }
  }

  const leaders: LeaderEntry[] = leaderBoardEntries(leaderInputs, userScorecards).map((entry) => {
    const leader = userById.get(entry.leaderUserId);
    return {
      ...entry,
      tier: entry.groupCode != null && isKpiRefereeGroupCode(entry.groupCode) ? "referee" : "award",
      leaderDisplayName: leader?.displayName ?? entry.leaderUserId,
      leaderChineseName: leader?.chineseName ?? null
    };
  });

  return { month, users: scoredUsers, departments, leaders };
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

    // DEPARTMENT_GROUP scope — one row per real KPI group (leader bar), keyed on
    // the DepartmentGroup id. Award-tier PM individuals (kind "individual") carry
    // no backing group and are captured in USER scope, not here.
    for (const leader of scores.leaders) {
      if (leader.kind !== "group" || leader.groupId == null) {
        continue;
      }
      await tx.kpiSnapshot.deleteMany({
        where: { snapshotDate: dateOnly, scopeType: "DEPARTMENT_GROUP", scopeId: leader.groupId }
      });
      await tx.kpiSnapshot.create({
        data: {
          snapshotDate: dateOnly,
          scopeType: "DEPARTMENT_GROUP",
          scopeId: leader.groupId,
          metricsJson: {
            month,
            groupCode: leader.groupCode,
            tier: leader.tier,
            leaderUserId: leader.leaderUserId,
            memberCount: leader.members.length,
            applicable: leader.applicable,
            onTime: leader.onTime,
            percent: leader.percent,
            barHit: leader.barHit,
            barHitByFloor: leader.barHitByFloor
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
