import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  aggregateGroupScorecard,
  leaderBoardEntries,
  type LeaderGroupInput,
  type LeaderMemberScorecard
} from "../../src/domain/mold-trial/kpi-leader-bar.ts";
import {
  computeScorecard,
  type KpiHabitEvent,
  type Scorecard,
  type ScoringRule
} from "../../src/domain/mold-trial/kpi-scoring.ts";
import { barHitPercent, minApplicableForBar } from "../../src/domain/mold-trial/kpi-rules.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const clockRule: ScoringRule = { code: "pm.result_recorded", hours: 24, active: true };
const DUE = new Date("2026-10-10T00:00:00.000Z");
const ON_TIME = new Date("2026-10-09T00:00:00.000Z");
const LATE = new Date("2026-10-20T00:00:00.000Z");

/** A member scorecard with `total` applicable events, `onTimeCount` done on time. */
function cardFor(userId: string, onTimeCount: number, total: number): Scorecard {
  const habitEvents: KpiHabitEvent[] = Array.from({ length: total }, (_unused, index) => ({
    ruleCode: "pm.result_recorded",
    userId,
    ref: `${userId}-${index}`,
    dueAt: DUE,
    doneAt: index < onTimeCount ? ON_TIME : LATE
  }));
  return computeScorecard({ userId, habitEvents, pointsEvents: [], rules: [clockRule], now: NOW });
}

function member(userId: string, onTimeCount: number, total: number): LeaderMemberScorecard {
  return {
    userId,
    username: userId,
    displayName: userId.toUpperCase(),
    chineseName: null,
    scorecard: cardFor(userId, onTimeCount, total)
  };
}

describe("aggregateGroupScorecard — sums members, verdicts the aggregate", () => {
  test("combines applicable/on-time and rounds the group percent", () => {
    const agg = aggregateGroupScorecard([cardFor("a", 8, 10), cardFor("b", 9, 10)]);
    assert.equal(agg.applicable, 20);
    assert.equal(agg.onTime, 17);
    assert.equal(agg.percent, barHitPercent); // 17/20 = 85%
    assert.equal(agg.barHit, true);
    assert.equal(agg.barHitByFloor, false);
  });

  test("the <5 floor is applied to the AGGREGATE, not per member", () => {
    // Each member alone floats (3 < 5, 0%); together they reach 6 applicable and
    // the floor no longer applies, so the group MISSES at 0%.
    const a = cardFor("a", 0, 3);
    const b = cardFor("b", 0, 3);
    assert.equal(a.barHitByFloor, true);
    assert.equal(b.barHitByFloor, true);
    const agg = aggregateGroupScorecard([a, b]);
    assert.equal(agg.applicable, minApplicableForBar + 1); // 6
    assert.equal(agg.percent, 0);
    assert.equal(agg.barHitByFloor, false);
    assert.equal(agg.barHit, false);
  });

  test("an empty group is applicable 0 → 100% → floor hit", () => {
    const agg = aggregateGroupScorecard([]);
    assert.equal(agg.applicable, 0);
    assert.equal(agg.onTime, 0);
    assert.equal(agg.percent, 100);
    assert.equal(agg.barHitByFloor, true);
    assert.equal(agg.barHit, true);
  });
});

describe("leaderBoardEntries — per-leader group bars", () => {
  const scorecards: LeaderMemberScorecard[] = [
    member("zhong", 22, 24), // assembly-a leader + only member (92%)
    member("lin", 9, 10), //     design leader (90%)
    member("mei", 2, 2), //      design crew (100%, floor)
    member("bill", 34, 37), //   PM individual (92%)
    member("orphan", 1, 10) //   in no group → only their own /score card
  ];

  test("a group entry aggregates exactly its listed members (attribution)", () => {
    const groups: LeaderGroupInput[] = [
      {
        leaderUserId: "lin",
        groupId: "g-design",
        groupCode: "design",
        label: { en: "Design", zh: "设计" },
        kind: "group",
        memberUserIds: ["lin", "mei"]
      }
    ];
    const [entry] = leaderBoardEntries(groups, scorecards);
    assert.ok(entry != null);
    assert.equal(entry.kind, "group");
    assert.equal(entry.applicable, 12); // 10 + 2
    assert.equal(entry.onTime, 11); // 9 + 2
    assert.equal(entry.percent, 92);
    assert.equal(entry.barHit, true);
    assert.equal(entry.members.length, 2);
    // The orphan is not a listed member → never folded into this group.
    assert.equal(entry.members.some((m) => m.userId === "orphan"), false);
    // Member breakdown carries each member's own percent (whose data is dragging).
    assert.equal(entry.members.find((m) => m.userId === "mei")?.percent, 100);
    assert.equal(entry.members.find((m) => m.userId === "lin")?.percent, 90);
  });

  test("a PM individual entry passes its own card through unchanged", () => {
    const groups: LeaderGroupInput[] = [
      {
        leaderUserId: "bill",
        groupId: null,
        groupCode: null,
        label: { en: "PM", zh: "PM" },
        kind: "individual",
        memberUserIds: ["bill"]
      }
    ];
    const [entry] = leaderBoardEntries(groups, scorecards);
    assert.ok(entry != null);
    assert.equal(entry.kind, "individual");
    assert.equal(entry.applicable, 37);
    assert.equal(entry.onTime, 34);
    assert.equal(entry.percent, 92);
    assert.equal(entry.members.length, 1);
    assert.equal(entry.members[0]?.userId, "bill");
  });

  test("a single-member group bar equals that member's card (zhong 22/24 = 92%)", () => {
    const groups: LeaderGroupInput[] = [
      {
        leaderUserId: "zhong",
        groupId: "g-asm-a",
        groupCode: "assembly-a",
        label: { en: "Assembly · Zhong", zh: "装配 · 钟组" },
        kind: "group",
        memberUserIds: ["zhong"]
      }
    ];
    const [entry] = leaderBoardEntries(groups, scorecards);
    assert.ok(entry != null);
    assert.equal(entry.applicable, 24);
    assert.equal(entry.onTime, 22);
    assert.equal(entry.percent, 92);
    assert.equal(entry.barHit, true);
  });

  test("orphan users (null group) never surface in any leader entry", () => {
    const groups: LeaderGroupInput[] = [
      { leaderUserId: "lin", groupId: "g-design", groupCode: "design", label: { en: "Design", zh: "设计" }, kind: "group", memberUserIds: ["lin", "mei"] },
      { leaderUserId: "bill", groupId: null, groupCode: null, label: { en: "PM", zh: "PM" }, kind: "individual", memberUserIds: ["bill"] }
    ];
    const allMembers = leaderBoardEntries(groups, scorecards).flatMap((entry) => entry.members.map((m) => m.userId));
    assert.equal(allMembers.includes("orphan"), false);
  });

  test("preserves input group order and drops member ids with no scorecard", () => {
    const groups: LeaderGroupInput[] = [
      { leaderUserId: "bill", groupId: null, groupCode: null, label: { en: "PM", zh: "PM" }, kind: "individual", memberUserIds: ["bill"] },
      { leaderUserId: "lin", groupId: "g-design", groupCode: "design", label: { en: "Design", zh: "设计" }, kind: "group", memberUserIds: ["lin", "mei", "ghost"] }
    ];
    const entries = leaderBoardEntries(groups, scorecards);
    assert.equal(entries[0]?.leaderUserId, "bill");
    assert.equal(entries[1]?.leaderUserId, "lin");
    // "ghost" has no scorecard → dropped; only lin + mei counted.
    assert.equal(entries[1]?.members.length, 2);
    assert.equal(entries[1]?.applicable, 12);
  });
});
