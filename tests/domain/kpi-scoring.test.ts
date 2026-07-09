import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeDepartmentRollup,
  computeScorecard,
  evaluateEventOnTime,
  type KpiHabitEvent,
  type ScoringRule
} from "../../src/domain/mold-trial/kpi-scoring.ts";
import {
  barHitPercent,
  isBooleanKpiRuleCode,
  minApplicableForBar,
  severityWeight
} from "../../src/domain/mold-trial/kpi-rules.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");

const clockRule: ScoringRule = { code: "pm.result_recorded", hours: 24, active: true };
const boolRule: ScoringRule = { code: "asm.self_check", hours: null, active: true };

function habit(overrides: Partial<KpiHabitEvent>): KpiHabitEvent {
  return {
    ruleCode: "pm.result_recorded",
    userId: "u1",
    ref: "MP-1",
    dueAt: new Date("2026-10-10T00:00:00.000Z"),
    doneAt: new Date("2026-10-09T00:00:00.000Z"),
    ...overrides
  };
}

describe("evaluateEventOnTime", () => {
  test("clock rule: done exactly at the deadline is on-time (boundary)", () => {
    const due = new Date("2026-10-10T00:00:00.000Z");
    const event = habit({ dueAt: due, doneAt: new Date(due.getTime()) });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), true);
  });

  test("clock rule: done one millisecond after the deadline is late", () => {
    const due = new Date("2026-10-10T00:00:00.000Z");
    const event = habit({ dueAt: due, doneAt: new Date(due.getTime() + 1) });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), false);
  });

  test("clock rule: not done, past due => late", () => {
    const event = habit({ dueAt: new Date("2026-10-10T00:00:00.000Z"), doneAt: null });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), false);
  });

  test("clock rule: not done, due in the future => pending (excluded)", () => {
    const event = habit({ dueAt: new Date("2026-11-15T00:00:00.000Z"), doneAt: null });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), null);
  });

  test("clock rule: done but no known dueAt => on-time (never penalize unprovable lateness)", () => {
    const event = habit({ dueAt: null, doneAt: new Date("2026-10-09T00:00:00.000Z") });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), true);
  });

  test("clock rule: not done and no dueAt => excluded", () => {
    const event = habit({ dueAt: null, doneAt: null });
    assert.equal(evaluateEventOnTime(event, clockRule, NOW), null);
  });

  test("boolean rule: passed=true on-time, passed=false late, undefined => late", () => {
    assert.equal(evaluateEventOnTime(habit({ passed: true }), boolRule, NOW), true);
    assert.equal(evaluateEventOnTime(habit({ passed: false }), boolRule, NOW), false);
    assert.equal(evaluateEventOnTime(habit({ passed: undefined }), boolRule, NOW), false);
  });
});

describe("computeScorecard — protections", () => {
  test("fewer than 5 applicable events counts as hitting the bar even at 0%", () => {
    const habitEvents: KpiHabitEvent[] = Array.from({ length: minApplicableForBar - 1 }, (_unused, index) =>
      habit({ ref: `MP-${index}`, doneAt: new Date("2026-10-20T00:00:00.000Z") })
    );
    const card = computeScorecard({ userId: "u1", habitEvents, pointsEvents: [], rules: [clockRule], now: NOW });
    assert.equal(card.applicable, minApplicableForBar - 1);
    assert.equal(card.onTime, 0);
    assert.equal(card.percent, 0);
    assert.equal(card.barHit, true);
    assert.equal(card.barHitByFloor, true);
  });

  test("exactly 5 applicable events removes the floor protection", () => {
    const habitEvents: KpiHabitEvent[] = Array.from({ length: minApplicableForBar }, (_unused, index) =>
      habit({ ref: `MP-${index}`, doneAt: new Date("2026-10-20T00:00:00.000Z") })
    );
    const card = computeScorecard({ userId: "u1", habitEvents, pointsEvents: [], rules: [clockRule], now: NOW });
    assert.equal(card.barHitByFloor, false);
    assert.equal(card.barHit, false);
  });
});

describe("computeScorecard — 85% boundary", () => {
  function ratedCard(onTimeCount: number, total: number) {
    const habitEvents: KpiHabitEvent[] = Array.from({ length: total }, (_unused, index) =>
      habit({
        ref: `MP-${index}`,
        doneAt: index < onTimeCount ? new Date("2026-10-09T00:00:00.000Z") : new Date("2026-10-20T00:00:00.000Z")
      })
    );
    return computeScorecard({ userId: "u1", habitEvents, pointsEvents: [], rules: [clockRule], now: NOW });
  }

  test("exactly 85% hits the bar", () => {
    const card = ratedCard(17, 20); // 85%
    assert.equal(card.percent, barHitPercent);
    assert.equal(card.barHit, true);
    assert.equal(card.barHitByFloor, false);
  });

  test("just under 85% misses the bar", () => {
    const card = ratedCard(16, 20); // 80%
    assert.equal(card.percent, 80);
    assert.equal(card.barHit, false);
  });

  test("poster injection persona: 9/12 = 75% misses", () => {
    const card = ratedCard(9, 12);
    assert.equal(card.percent, 75);
    assert.equal(card.barHit, false);
  });

  test("poster assembly persona: 22/24 = 92% hits", () => {
    const card = ratedCard(22, 24);
    assert.equal(card.percent, 92);
    assert.equal(card.barHit, true);
  });
});

describe("computeScorecard — line grouping and pending exclusion", () => {
  test("groups events by rule and excludes pending from applicable but keeps late", () => {
    const habitEvents: KpiHabitEvent[] = [
      habit({ ruleCode: "pm.result_recorded", ref: "A", doneAt: new Date("2026-10-09T00:00:00.000Z") }),
      habit({ ruleCode: "pm.result_recorded", ref: "B", dueAt: new Date("2026-10-01T00:00:00.000Z"), doneAt: null }), // late
      habit({ ruleCode: "pm.result_recorded", ref: "C", dueAt: new Date("2026-11-20T00:00:00.000Z"), doneAt: null }), // pending
      { ruleCode: "asm.self_check", userId: "u1", ref: "D", dueAt: null, doneAt: null, passed: true }
    ];
    const card = computeScorecard({
      userId: "u1",
      habitEvents,
      pointsEvents: [],
      rules: [clockRule, boolRule],
      now: NOW
    });
    const resultLine = card.lines.find((line) => line.ruleCode === "pm.result_recorded");
    const selfCheckLine = card.lines.find((line) => line.ruleCode === "asm.self_check");
    assert.equal(resultLine?.applicable, 2); // A on-time + B late; C excluded
    assert.equal(resultLine?.onTime, 1);
    assert.equal(selfCheckLine?.applicable, 1);
    assert.equal(selfCheckLine?.onTime, 1);
    assert.equal(card.applicable, 3);
    assert.equal(card.onTime, 2);
  });

  test("ignores events for inactive rules and events for other users", () => {
    const habitEvents: KpiHabitEvent[] = [
      habit({ ref: "A", doneAt: new Date("2026-10-09T00:00:00.000Z") }),
      habit({ ref: "OTHER", userId: "u2", doneAt: new Date("2026-10-09T00:00:00.000Z") })
    ];
    const card = computeScorecard({
      userId: "u1",
      habitEvents,
      pointsEvents: [],
      rules: [{ ...clockRule, active: false }],
      now: NOW
    });
    assert.equal(card.applicable, 0);
    assert.equal(card.percent, 100); // nothing applicable -> 100
    assert.equal(card.barHit, true);
  });
});

describe("computeScorecard — points", () => {
  test("verified issues count severity-weighted; pending show provisional zero", () => {
    const card = computeScorecard({
      userId: "u1",
      habitEvents: [],
      pointsEvents: [
        { userId: "u1", issueRef: "I-HIGH", severity: "HIGH", verified: true },
        { userId: "u1", issueRef: "I-MED", severity: "MEDIUM", verified: true },
        { userId: "u1", issueRef: "I-LOW", severity: "LOW", verified: true },
        { userId: "u1", issueRef: "I-PENDING", severity: "HIGH", verified: false },
        { userId: "u2", issueRef: "I-OTHER", severity: "CRITICAL", verified: true }
      ],
      rules: [clockRule],
      now: NOW
    });
    assert.equal(card.totalPoints, severityWeight("HIGH") + severityWeight("MEDIUM") + severityWeight("LOW"));
    const pending = card.points.find((line) => line.issueRef === "I-PENDING");
    assert.equal(pending?.counted, 0);
    assert.equal(pending?.weight, severityWeight("HIGH"));
    assert.equal(card.points.some((line) => line.issueRef === "I-OTHER"), false);
  });
});

describe("computeDepartmentRollup", () => {
  test("sums members and applies the <5 floor to the group total", () => {
    const cardA = computeScorecard({
      userId: "a",
      habitEvents: [habit({ userId: "a", ref: "A1", doneAt: new Date("2026-10-09T00:00:00.000Z") })],
      pointsEvents: [],
      rules: [clockRule],
      now: NOW
    });
    const cardB = computeScorecard({
      userId: "b",
      habitEvents: [habit({ userId: "b", ref: "B1", doneAt: new Date("2026-10-20T00:00:00.000Z") })],
      pointsEvents: [],
      rules: [clockRule],
      now: NOW
    });
    const rollup = computeDepartmentRollup([cardA, cardB]);
    assert.equal(rollup.applicable, 2);
    assert.equal(rollup.onTime, 1);
    assert.equal(rollup.percent, 50);
    assert.equal(rollup.barHitByFloor, true); // 2 < 5
    assert.equal(rollup.barHit, true);
  });
});

describe("Scores audit UI shape — boolean classification", () => {
  test("the three no-clock rules classify as boolean (pass/fail chip)", () => {
    assert.equal(isBooleanKpiRuleCode("inj.process_values"), true);
    assert.equal(isBooleanKpiRuleCode("asm.self_check"), true);
    assert.equal(isBooleanKpiRuleCode("all.photo_on_defect"), true);
  });

  test("timed rules are NOT boolean (render Due/Done, never a pass chip)", () => {
    assert.equal(isBooleanKpiRuleCode("pm.result_recorded"), false);
    assert.equal(isBooleanKpiRuleCode("inj.date_confirm"), false);
    assert.equal(isBooleanKpiRuleCode("qc.report_upload"), false);
    assert.equal(isBooleanKpiRuleCode("not.a.rule"), false);
  });
});

describe("Scores audit UI shape — no pending items reach the audit list", () => {
  // The panel renders each item; the engine must never hand it a timed item
  // that is both not-done AND not-yet-due (which would show as the bogus
  // "Due pending · Done pending"). Such items are pending and excluded upstream.
  test("timed line items are always done, or a past-due miss — never both-null", () => {
    const habitEvents: KpiHabitEvent[] = [
      habit({ ruleCode: "pm.result_recorded", ref: "DONE", doneAt: new Date("2026-10-09T00:00:00.000Z") }),
      habit({ ruleCode: "pm.result_recorded", ref: "LATE", dueAt: new Date("2026-10-01T00:00:00.000Z"), doneAt: null }),
      habit({ ruleCode: "pm.result_recorded", ref: "PENDING", dueAt: new Date("2026-11-20T00:00:00.000Z"), doneAt: null })
    ];
    const card = computeScorecard({ userId: "u1", habitEvents, pointsEvents: [], rules: [clockRule], now: NOW });
    const line = card.lines.find((l) => l.ruleCode === "pm.result_recorded");
    assert.ok(line != null);
    // PENDING is excluded, so only DONE + LATE remain.
    assert.equal(line.items.length, 2);
    for (const item of line.items) {
      const isDone = item.doneAt != null;
      const isPastDueMiss = item.doneAt == null && item.dueAt != null && !item.onTime;
      assert.ok(isDone || isPastDueMiss, `item ${item.ref} must be done or a past-due miss, not pending`);
    }
    assert.equal(line.items.some((item) => item.ref === "PENDING"), false);
  });

  test("boolean line items carry the pass/fail flag as onTime and null clocks", () => {
    const habitEvents: KpiHabitEvent[] = [
      { ruleCode: "asm.self_check", userId: "u1", ref: "PASS", dueAt: null, doneAt: null, passed: true },
      { ruleCode: "asm.self_check", userId: "u1", ref: "FAIL", dueAt: null, doneAt: null, passed: false }
    ];
    const card = computeScorecard({ userId: "u1", habitEvents, pointsEvents: [], rules: [boolRule], now: NOW });
    const line = card.lines.find((l) => l.ruleCode === "asm.self_check");
    assert.ok(line != null);
    assert.equal(line.items.length, 2);
    for (const item of line.items) {
      assert.equal(item.dueAt, null);
      assert.equal(item.doneAt, null);
    }
    assert.equal(line.items.find((i) => i.ref === "PASS")?.onTime, true);
    assert.equal(line.items.find((i) => i.ref === "FAIL")?.onTime, false);
  });
});
