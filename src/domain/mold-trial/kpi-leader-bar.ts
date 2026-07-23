/**
 * KPI leader-designation layer — PURE domain logic (no Prisma, no I/O). Turns
 * per-user monthly scorecards into per-leader "group bars": the missing link
 * between the scoring engine and the prize rules ("¥400 to each leader whose
 * GROUP hits the 85% bar", docs/06-kpi/kpi-system-design.md v2 §4 + §6).
 *
 * A leader's bar covers THEIR GROUP's events, not just their own — personally
 * doing everything right is not enough; the crew's data must be complete too.
 * The aggregate uses the SAME 85% threshold + <5-events floor as an individual
 * card, applied to the SUMMED applicable/on-time counts, so a genuinely quiet
 * group still floats while a busy group's misses actually bite.
 *
 * PMs are award-tier INDIVIDUALS (no crew): the caller emits one "individual"
 * group per PM whose members list is just that PM, so their group bar collapses
 * to their own user scorecard by design.
 *
 * Member attribution is the caller's job — a user's events count toward exactly
 * ONE group via `User.departmentGroupId`; this module only sums the member
 * scorecards it is handed. A user handed to no group contributes only to their
 * own card, never to an aggregate.
 */

import { computeDepartmentRollup, type Scorecard } from "./kpi-scoring.ts";
import type { BilingualLabel } from "./labels.ts";

/** A group bar: member applicable/on-time summed, with the 85% + <5-floor verdict. */
export type GroupAggregate = {
  applicable: number;
  onTime: number;
  /** Whole-number percent (rounded); 100 when nothing is applicable. */
  percent: number;
  barHit: boolean;
  /** True when the bar is granted by the <5-events floor rather than the rate. */
  barHitByFloor: boolean;
};

/**
 * Aggregate several member scorecards into one group bar. Sums applicable and
 * on-time across members, then applies the SAME 85% threshold and <5-events
 * floor to the AGGREGATE (not per member): the floor protects a genuinely quiet
 * group, but two small members that each floated alone can sink together once
 * their combined applicable count reaches 5. An empty group (no members) is
 * applicable 0 → 100% → floor hit. This is `computeDepartmentRollup` under a
 * leader-facing name so the group-bar semantics live in one place.
 */
export function aggregateGroupScorecard(memberScorecards: readonly Scorecard[]): GroupAggregate {
  return computeDepartmentRollup(memberScorecards);
}

/** Whether a leader row is a real group aggregate or a single award-tier individual (a PM). */
export type LeaderKind = "group" | "individual";

/**
 * One leader designation the caller resolved from real membership: the group's
 * leader, its label, whether it is a group or a lone individual, and the member
 * user ids whose scorecards form the bar. For an "individual" (PM), pass the
 * leader's own id as the single member.
 */
export type LeaderGroupInput = {
  leaderUserId: string;
  /** DepartmentGroup id, or null for a pure individual with no backing group row. */
  groupId: string | null;
  /** DepartmentGroup code (e.g. "assembly-a"), or null for a pure individual. */
  groupCode: string | null;
  label: BilingualLabel;
  kind: LeaderKind;
  /** Member user ids (already resolved from departmentGroupId). Individuals: [leaderUserId]. */
  memberUserIds: readonly string[];
};

/** A user's scorecard plus the display fields the leader board shows per member. */
export type LeaderMemberScorecard = {
  userId: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  scorecard: Scorecard;
};

/** One member row inside a leader entry (the drilldown "whose data is dragging"). */
export type LeaderBoardMember = {
  userId: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  applicable: number;
  onTime: number;
  percent: number;
  barHit: boolean;
  barHitByFloor: boolean;
};

/** One leader row: the group bar plus its member breakdown. */
export type LeaderBoardEntry = {
  leaderUserId: string;
  groupId: string | null;
  groupCode: string | null;
  label: BilingualLabel;
  kind: LeaderKind;
  members: LeaderBoardMember[];
  applicable: number;
  onTime: number;
  percent: number;
  barHit: boolean;
  barHitByFloor: boolean;
};

/**
 * Build one leader-board entry per group. Members are looked up by id from
 * `userScorecards`; ids with no matching scorecard are dropped (a member with no
 * card this month contributes nothing, exactly like an absent event stream). The
 * entry's bar is the aggregate of the resolved member cards. Input `groups`
 * order is preserved so the caller controls display order.
 */
export function leaderBoardEntries(
  groups: readonly LeaderGroupInput[],
  userScorecards: readonly LeaderMemberScorecard[]
): LeaderBoardEntry[] {
  const cardByUser = new Map(userScorecards.map((entry) => [entry.userId, entry]));

  return groups.map((group) => {
    const memberCards = group.memberUserIds
      .map((userId) => cardByUser.get(userId))
      .filter((card): card is LeaderMemberScorecard => card != null);

    const aggregate = aggregateGroupScorecard(memberCards.map((card) => card.scorecard));

    const members: LeaderBoardMember[] = memberCards.map((card) => ({
      userId: card.userId,
      username: card.username,
      displayName: card.displayName,
      chineseName: card.chineseName,
      applicable: card.scorecard.applicable,
      onTime: card.scorecard.onTime,
      percent: card.scorecard.percent,
      barHit: card.scorecard.barHit,
      barHitByFloor: card.scorecard.barHitByFloor
    }));

    return {
      leaderUserId: group.leaderUserId,
      groupId: group.groupId,
      groupCode: group.groupCode,
      label: group.label,
      kind: group.kind,
      members,
      applicable: aggregate.applicable,
      onTime: aggregate.onTime,
      percent: aggregate.percent,
      barHit: aggregate.barHit,
      barHitByFloor: aggregate.barHitByFloor
    };
  });
}
