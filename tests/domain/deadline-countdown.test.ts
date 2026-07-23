import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareByCountdownUrgency,
  computeDeadline,
  countdownAmberHours,
  countdownTone,
  formatCountdown,
  formatOverdueDays,
  overdueDays,
  remainingHours
} from "../../src/domain/mold-trial/deadline-countdown.ts";

const NOW = new Date("2026-07-10T12:00:00.000Z");

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

describe("computeDeadline", () => {
  test("adds the literal-hours window to the anchor", () => {
    const anchor = new Date("2026-07-10T00:00:00.000Z");
    assert.equal(computeDeadline(anchor, 24).toISOString(), "2026-07-11T00:00:00.000Z");
    assert.equal(computeDeadline(anchor, 48).toISOString(), "2026-07-12T00:00:00.000Z");
  });

  test("weekends count — 8h is 8 clock hours, not a workday", () => {
    const saturdayEvening = new Date("2026-07-11T20:00:00.000Z");
    assert.equal(computeDeadline(saturdayEvening, 8).toISOString(), "2026-07-12T04:00:00.000Z");
  });

  test("shares the scorer's math: remaining of a fresh deadline equals the window", () => {
    const anchor = new Date("2026-07-10T12:00:00.000Z");
    assert.equal(remainingHours(computeDeadline(anchor, 24), anchor), 24);
  });
});

describe("remainingHours", () => {
  test("positive when the deadline is ahead", () => {
    assert.equal(remainingHours(hoursFromNow(5), NOW), 5);
  });

  test("negative when overdue", () => {
    assert.equal(remainingHours(hoursFromNow(-3), NOW), -3);
  });

  test("exactly zero at the deadline instant (boundary)", () => {
    assert.equal(remainingHours(NOW, NOW), 0);
  });

  test("is fractional, not rounded", () => {
    assert.equal(remainingHours(hoursFromNow(1.5), NOW), 1.5);
  });
});

describe("formatCountdown (English)", () => {
  test("≥ 1h rounds DOWN to whole hours", () => {
    assert.equal(formatCountdown(8, "EN_US"), "8h left");
    assert.equal(formatCountdown(8.9, "EN_US"), "8h left");
    assert.equal(formatCountdown(1, "EN_US"), "1h left");
    assert.equal(formatCountdown(23.99, "EN_US"), "23h left");
  });

  test("exactly 0 and any sub-hour remaining reads '<1h left'", () => {
    assert.equal(formatCountdown(0, "EN_US"), "<1h left");
    assert.equal(formatCountdown(0.5, "EN_US"), "<1h left");
    assert.equal(formatCountdown(0.99, "EN_US"), "<1h left");
  });

  test("overdue rounds UP to whole hours", () => {
    assert.equal(formatCountdown(-0.1, "EN_US"), "1h overdue");
    assert.equal(formatCountdown(-1, "EN_US"), "1h overdue");
    assert.equal(formatCountdown(-2, "EN_US"), "2h overdue");
    assert.equal(formatCountdown(-2.5, "EN_US"), "3h overdue");
  });
});

describe("formatCountdown (Chinese)", () => {
  test("mirrors the English bands in Chinese", () => {
    assert.equal(formatCountdown(8, "ZH_CN"), "剩8小时");
    assert.equal(formatCountdown(0, "ZH_CN"), "不足1小时");
    assert.equal(formatCountdown(0.5, "ZH_CN"), "不足1小时");
    assert.equal(formatCountdown(-0.1, "ZH_CN"), "超时1小时");
    assert.equal(formatCountdown(-2.5, "ZH_CN"), "超时3小时");
  });
});

describe("overdueDays", () => {
  const asOf = new Date("2026-07-17T09:00:00.000Z");

  test("0 when due later today (still not past)", () => {
    assert.equal(overdueDays(new Date("2026-07-17T23:00:00.000Z"), asOf), 0);
  });

  test("0 when the due date is in the future", () => {
    assert.equal(overdueDays(new Date("2026-07-20T00:00:00.000Z"), asOf), 0);
  });

  test("counts whole calendar days past, floored by UTC day", () => {
    assert.equal(overdueDays(new Date("2026-07-16T00:00:00.000Z"), asOf), 1);
    assert.equal(overdueDays(new Date("2026-07-02T00:00:00.000Z"), asOf), 15);
  });

  test("intra-day time never rounds a same-day gap up to a day", () => {
    // Due late yesterday, now early today: exactly one calendar day, not two.
    assert.equal(overdueDays(new Date("2026-07-16T23:59:00.000Z"), new Date("2026-07-17T00:01:00.000Z")), 1);
  });
});

describe("formatOverdueDays", () => {
  test("null below one day, so the caller appends nothing", () => {
    assert.equal(formatOverdueDays(0, "EN_US"), null);
    assert.equal(formatOverdueDays(0, "ZH_CN"), null);
  });

  test("English pluralises", () => {
    assert.equal(formatOverdueDays(1, "EN_US"), "overdue 1 day");
    assert.equal(formatOverdueDays(5, "EN_US"), "overdue 5 days");
  });

  test("Chinese", () => {
    assert.equal(formatOverdueDays(1, "ZH_CN"), "已超期1天");
    assert.equal(formatOverdueDays(15, "ZH_CN"), "已超期15天");
  });
});

describe("countdownTone", () => {
  test("neutral gray above the amber threshold", () => {
    assert.equal(countdownTone(20), "neutral");
    assert.equal(countdownTone(countdownAmberHours + 0.01), "neutral");
  });

  test("amber at or under 8h remaining (boundary)", () => {
    assert.equal(countdownTone(countdownAmberHours), "amber");
    assert.equal(countdownTone(8), "amber");
    assert.equal(countdownTone(0), "amber");
  });

  test("red once overdue", () => {
    assert.equal(countdownTone(-0.001), "red");
    assert.equal(countdownTone(-5), "red");
  });
});

describe("compareByCountdownUrgency", () => {
  test("orders most urgent first, overdue at the very top", () => {
    const rows = [
      { id: "far", remainingHours: 40 },
      { id: "overdue", remainingHours: -6 },
      { id: "soon", remainingHours: 3 }
    ];
    assert.deepEqual([...rows].sort(compareByCountdownUrgency).map((row) => row.id), ["overdue", "soon", "far"]);
  });

  test("rows with no chip (null remaining — inactive rule / missing anchor) sink last", () => {
    const rows = [
      { id: "no-chip-a", remainingHours: null },
      { id: "overdue", remainingHours: -2 },
      { id: "no-chip-b", remainingHours: null },
      { id: "soon", remainingHours: 5 }
    ];
    assert.deepEqual(
      [...rows].sort(compareByCountdownUrgency).map((row) => row.id),
      ["overdue", "soon", "no-chip-a", "no-chip-b"]
    );
  });

  test("equal remaining and two nulls compare as 0 (stable, keeps input order)", () => {
    assert.equal(compareByCountdownUrgency({ remainingHours: 4 }, { remainingHours: 4 }), 0);
    assert.equal(compareByCountdownUrgency({ remainingHours: null }, { remainingHours: null }), 0);
  });

  test("a null remaining sorts after a real remaining regardless of order", () => {
    assert.equal(compareByCountdownUrgency({ remainingHours: null }, { remainingHours: -10 }), 1);
    assert.equal(compareByCountdownUrgency({ remainingHours: -10 }, { remainingHours: null }), -1);
  });
});
