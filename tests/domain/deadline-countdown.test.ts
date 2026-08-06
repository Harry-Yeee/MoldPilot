import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareByCountdownUrgency,
  computeDeadline,
  countdownAmberHours,
  countdownTone,
  formatCountdown,
  formatOverdueDays,
  formatTrialCountdown,
  formatTrialDateShort,
  overdueDays,
  remainingHours,
  trialCountdown,
  trialCountdownAmberHours,
  trialCountdownTone
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

/* --------------------- Trial-deadline countdown (F2, V11) -------------------- */

describe("trialCountdown", () => {
  test("no upcoming trial means no chip, whatever the due date says", () => {
    assert.equal(trialCountdown({ dueDate: hoursFromNow(5), nextTrialDate: null }, NOW), null);
    assert.equal(trialCountdown({ dueDate: null, nextTrialDate: null }, NOW), null);
    assert.equal(trialCountdown({ dueDate: undefined, nextTrialDate: undefined }, NOW), null);
  });

  test("with no issue due date the trial is the only urgency", () => {
    const countdown = trialCountdown({ dueDate: null, nextTrialDate: hoursFromNow(50) }, NOW);

    assert.equal(countdown?.trialHours, 50);
    assert.equal(countdown?.urgencyHours, 50);
    assert.equal(countdown?.urgencySource, "NEXT_TRIAL");
  });

  test("an EARLIER issue due date sets the urgency; the text still counts the trial", () => {
    const countdown = trialCountdown({ dueDate: hoursFromNow(10), nextTrialDate: hoursFromNow(100) }, NOW);

    assert.equal(countdown?.trialHours, 100);
    assert.equal(countdown?.urgencyHours, 10);
    assert.equal(countdown?.urgencySource, "ISSUE_DUE");
  });

  test("a LATER issue due date leaves the trial in charge (the reverse order)", () => {
    const countdown = trialCountdown({ dueDate: hoursFromNow(100), nextTrialDate: hoursFromNow(10) }, NOW);

    assert.equal(countdown?.trialHours, 10);
    assert.equal(countdown?.urgencyHours, 10);
    assert.equal(countdown?.urgencySource, "NEXT_TRIAL");
  });

  test("a tie reports the trial — the date the whole shop is scheduled around", () => {
    const countdown = trialCountdown({ dueDate: hoursFromNow(30), nextTrialDate: hoursFromNow(30) }, NOW);

    assert.equal(countdown?.urgencyHours, 30);
    assert.equal(countdown?.urgencySource, "NEXT_TRIAL");
  });

  test("an overdue issue on a future trial is urgent by its own due date", () => {
    const countdown = trialCountdown({ dueDate: hoursFromNow(-6), nextTrialDate: hoursFromNow(200) }, NOW);

    assert.equal(countdown?.trialHours, 200);
    assert.equal(countdown?.urgencyHours, -6);
    assert.equal(countdown?.urgencySource, "ISSUE_DUE");
    assert.equal(trialCountdownTone(countdown?.urgencyHours ?? 0), "red");
  });

  test("a trial that already happened is red even with a comfortable due date", () => {
    const countdown = trialCountdown({ dueDate: hoursFromNow(400), nextTrialDate: hoursFromNow(-3) }, NOW);

    assert.equal(countdown?.urgencyHours, -3);
    assert.equal(trialCountdownTone(countdown?.urgencyHours ?? 0), "red");
  });
});

describe("trialCountdownTone", () => {
  test("red past the deadline, amber inside 72h, neutral beyond", () => {
    assert.equal(trialCountdownAmberHours, 72);
    assert.equal(trialCountdownTone(-0.5), "red");
    assert.equal(trialCountdownTone(0), "amber");
    assert.equal(trialCountdownTone(71.9), "amber");
    assert.equal(trialCountdownTone(72), "amber");
    assert.equal(trialCountdownTone(72.1), "neutral");
    assert.equal(trialCountdownTone(500), "neutral");
  });
});

describe("formatTrialCountdown", () => {
  test("days once a day or more remains (rounded down)", () => {
    assert.equal(formatTrialCountdown(72, "EN_US"), "3d to trial");
    assert.equal(formatTrialCountdown(72, "ZH_CN"), "距试模3天");
    assert.equal(formatTrialCountdown(47.9, "EN_US"), "1d to trial");
  });

  test("hours inside the last day, with a dedicated sub-hour band", () => {
    assert.equal(formatTrialCountdown(23.9, "EN_US"), "23h to trial");
    assert.equal(formatTrialCountdown(23.9, "ZH_CN"), "距试模23小时");
    assert.equal(formatTrialCountdown(0.4, "EN_US"), "<1h to trial");
    assert.equal(formatTrialCountdown(0.4, "ZH_CN"), "距试模不足1小时");
  });

  test("past the trial it rounds up, and never reads zero", () => {
    assert.equal(formatTrialCountdown(-0.1, "EN_US"), "1h past trial");
    assert.equal(formatTrialCountdown(-0.1, "ZH_CN"), "试模已过1小时");
    assert.equal(formatTrialCountdown(-25, "EN_US"), "2d past trial");
    assert.equal(formatTrialCountdown(-25, "ZH_CN"), "试模已过2天");
  });
});

describe("formatTrialDateShort", () => {
  test("MMM d in English, M月D日 in Chinese", () => {
    assert.equal(formatTrialDateShort("2026-08-08", "EN_US"), "Aug 8");
    assert.equal(formatTrialDateShort("2026-08-08", "ZH_CN"), "8月8日");
    assert.equal(formatTrialDateShort("2026-01-01", "EN_US"), "Jan 1");
    assert.equal(formatTrialDateShort("2026-12-31", "ZH_CN"), "12月31日");
  });

  test("no timezone shift — the calendar date is echoed exactly", () => {
    // A Date-based formatter west of UTC would print Aug 7 here.
    assert.equal(formatTrialDateShort("2026-08-08", "EN_US"), "Aug 8");
  });

  test("a malformed date is returned unchanged rather than guessed at", () => {
    assert.equal(formatTrialDateShort("not-a-date", "EN_US"), "not-a-date");
    assert.equal(formatTrialDateShort("2026-13-01", "EN_US"), "2026-13-01");
    assert.equal(formatTrialDateShort("", "ZH_CN"), "");
  });
});
