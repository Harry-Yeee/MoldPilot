import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildMonthMatrix,
  daysFromPlannedToTarget,
  formatMonthKey,
  groupTrialsByDay,
  machineLoadForDay,
  machineLoadLevel,
  monthMatrixRange,
  parseMonthKey,
  shiftMonth,
  type CalendarTrialLike
} from "../../src/domain/mold-trial/calendar.ts";

/** Flatten a matrix to its in-month day keys only. */
function inMonthDates(month: string): string[] {
  return buildMonthMatrix(month)
    .weeks.flat()
    .filter((day) => !day.outsideMonth)
    .map((day) => day.date);
}

describe("parseMonthKey / formatMonthKey", () => {
  test("round-trips a valid month", () => {
    const parsed = parseMonthKey("2026-07");
    assert.deepEqual(parsed, { year: 2026, month: 7 });
    assert.equal(formatMonthKey(parsed.year, parsed.month), "2026-07");
  });

  test("rejects malformed or out-of-range months", () => {
    for (const bad of ["2026-7", "2026-13", "2026-00", "not-a-month", "202607", ""]) {
      assert.throws(() => parseMonthKey(bad), /Invalid month key/);
    }
  });
});

describe("buildMonthMatrix — structure", () => {
  test("every week has exactly 7 days, Monday-first", () => {
    const matrix = buildMonthMatrix("2026-07");
    for (const week of matrix.weeks) {
      assert.equal(week.length, 7);
    }
    // First cell of the grid is a Monday (UTC getUTCDay === 1).
    const firstDate = new Date(`${matrix.weeks[0][0].date}T00:00:00.000Z`);
    assert.equal(firstDate.getUTCDay(), 1);
    // Last cell of the grid is a Sunday.
    const lastWeek = matrix.weeks[matrix.weeks.length - 1];
    const lastDate = new Date(`${lastWeek[6].date}T00:00:00.000Z`);
    assert.equal(lastDate.getUTCDay(), 0);
  });

  test("in-month days are contiguous and complete for the month", () => {
    // July 2026 has 31 days, 1..31.
    const dates = inMonthDates("2026-07");
    assert.equal(dates.length, 31);
    assert.equal(dates[0], "2026-07-01");
    assert.equal(dates[30], "2026-07-31");
  });

  test("leading and trailing cells are flagged outsideMonth", () => {
    const matrix = buildMonthMatrix("2026-07");
    const flat = matrix.weeks.flat();
    // 2026-07-01 is a Wednesday, so Mon 06-29 and Tue 06-30 lead.
    assert.equal(flat[0].date, "2026-06-29");
    assert.equal(flat[0].outsideMonth, true);
    assert.equal(flat[1].date, "2026-06-30");
    assert.equal(flat[1].outsideMonth, true);
    assert.equal(flat[2].date, "2026-07-01");
    assert.equal(flat[2].outsideMonth, false);
    // Trailing cells spill into August.
    const last = flat[flat.length - 1];
    assert.equal(last.outsideMonth, true);
    assert.ok(last.date.startsWith("2026-08"));
  });

  test("monthMatrixRange returns the first and last grid cell", () => {
    const matrix = buildMonthMatrix("2026-07");
    const range = monthMatrixRange(matrix);
    assert.equal(range.start, matrix.weeks[0][0].date);
    assert.equal(range.end, matrix.weeks[matrix.weeks.length - 1][6].date);
    assert.equal(range.start, "2026-06-29");
  });
});

describe("buildMonthMatrix — month edges", () => {
  test("February in a leap year has 29 days (Feb 2024)", () => {
    const dates = inMonthDates("2024-02");
    assert.equal(dates.length, 29);
    assert.equal(dates[28], "2024-02-29");
  });

  test("February in a non-leap year has 28 days (Feb 2026)", () => {
    const dates = inMonthDates("2026-02");
    assert.equal(dates.length, 28);
    assert.equal(dates[dates.length - 1], "2026-02-28");
    // Sanity: 2026-02-29 must never appear.
    assert.ok(!dates.includes("2026-02-29"));
  });

  test("a month starting on Sunday gets a full leading week (Monday-start)", () => {
    // 2026-03-01 is a Sunday. Monday-start means the whole preceding week
    // (Mon 2026-02-23 .. Sun 2026-03-01) is the first row, with March 1 last.
    const matrix = buildMonthMatrix("2026-03");
    const firstWeek = matrix.weeks[0];
    assert.equal(firstWeek[0].date, "2026-02-23");
    assert.equal(firstWeek[0].outsideMonth, true);
    // Six leading outside-month days, then Sunday March 1 in-month.
    assert.equal(firstWeek[6].date, "2026-03-01");
    assert.equal(firstWeek[6].outsideMonth, false);
    assert.equal(new Date(`${firstWeek[6].date}T00:00:00.000Z`).getUTCDay(), 0);
  });

  test("December grid trails into the next January (year rollover)", () => {
    // 2026-12-31 is a Thursday, so the last row trails into 2027-01.
    const matrix = buildMonthMatrix("2026-12");
    const dates = matrix.weeks.flat().map((day) => day.date);
    assert.ok(dates.includes("2026-12-31"));
    assert.ok(dates.some((date) => date.startsWith("2027-01")));
    const inMonth = inMonthDates("2026-12");
    assert.equal(inMonth.length, 31);
  });
});

describe("shiftMonth", () => {
  test("steps forward and backward within a year", () => {
    assert.equal(shiftMonth("2026-07", 1), "2026-08");
    assert.equal(shiftMonth("2026-07", -1), "2026-06");
  });

  test("rolls over the year boundary in both directions", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
  });

  test("handles multi-month jumps", () => {
    assert.equal(shiftMonth("2026-11", 3), "2027-02");
    assert.equal(shiftMonth("2026-02", -3), "2025-11");
  });
});

describe("groupTrialsByDay", () => {
  test("buckets trials by planned-date day key, preserving input order", () => {
    const trials = [
      { plannedDate: "2026-07-10", id: "a" },
      { plannedDate: "2026-07-11", id: "b" },
      { plannedDate: "2026-07-10", id: "c" }
    ];
    const grouped = groupTrialsByDay(trials);
    assert.deepEqual(
      grouped.get("2026-07-10")?.map((t) => t.id),
      ["a", "c"]
    );
    assert.deepEqual(
      grouped.get("2026-07-11")?.map((t) => t.id),
      ["b"]
    );
    // A day with no trials is absent, not an empty array.
    assert.equal(grouped.has("2026-07-12"), false);
  });
});

describe("daysFromPlannedToTarget", () => {
  test("positive when planned before target, negative when after, zero on target", () => {
    assert.equal(daysFromPlannedToTarget("2026-07-10", "2026-07-15"), 5);
    assert.equal(daysFromPlannedToTarget("2026-07-20", "2026-07-15"), -5);
    assert.equal(daysFromPlannedToTarget("2026-07-15", "2026-07-15"), 0);
  });

  test("null when either date is missing or unparseable", () => {
    assert.equal(daysFromPlannedToTarget(null, "2026-07-15"), null);
    assert.equal(daysFromPlannedToTarget("2026-07-10", null), null);
    assert.equal(daysFromPlannedToTarget("nonsense", "2026-07-15"), null);
  });
});

describe("machineLoadLevel", () => {
  test("thresholds: none < 3, amber at 3, red at 4+", () => {
    assert.equal(machineLoadLevel(0), "none");
    assert.equal(machineLoadLevel(2), "none");
    assert.equal(machineLoadLevel(3), "amber");
    assert.equal(machineLoadLevel(4), "red");
    assert.equal(machineLoadLevel(9), "red");
  });
});

describe("machineLoadForDay", () => {
  function trial(injectionMachineId: string | null): CalendarTrialLike {
    return { plannedDate: "2026-07-10", injectionMachineId };
  }

  test("two on one machine is below the warning threshold (none)", () => {
    const load = machineLoadForDay([trial("m1"), trial("m1"), trial("m2")]);
    assert.equal(load.maxOnOneMachine, 2);
    assert.equal(load.level, "none");
  });

  test("three on ONE machine is amber", () => {
    const load = machineLoadForDay([trial("m1"), trial("m1"), trial("m1"), trial("m2")]);
    assert.equal(load.maxOnOneMachine, 3);
    assert.equal(load.level, "amber");
  });

  test("four on ONE machine is red", () => {
    const load = machineLoadForDay([trial("m1"), trial("m1"), trial("m1"), trial("m1")]);
    assert.equal(load.maxOnOneMachine, 4);
    assert.equal(load.level, "red");
  });

  test("load spread across machines never warns even when the day is busy", () => {
    // Six trials total, but no single machine reaches 3.
    const load = machineLoadForDay([
      trial("m1"),
      trial("m1"),
      trial("m2"),
      trial("m2"),
      trial("m3"),
      trial("m3")
    ]);
    assert.equal(load.maxOnOneMachine, 2);
    assert.equal(load.level, "none");
  });

  test("the no-machine bucket is counted but NEVER warns", () => {
    // Five unassigned trials on one day — a big pile-up, but not a machine
    // capacity problem, so the level stays none.
    const load = machineLoadForDay([trial(null), trial(null), trial(null), trial(null), trial(null)]);
    assert.equal(load.noMachineCount, 5);
    assert.equal(load.maxOnOneMachine, 0);
    assert.equal(load.level, "none");
    assert.deepEqual(load.perMachine, []);
  });

  test("no-machine trials do not add to any machine's count", () => {
    // m1 has 3 real trials (amber); the 2 unassigned are tracked separately.
    const load = machineLoadForDay([
      trial("m1"),
      trial("m1"),
      trial("m1"),
      trial(null),
      trial(null)
    ]);
    assert.equal(load.level, "amber");
    assert.equal(load.noMachineCount, 2);
    assert.equal(load.perMachine.find((entry) => entry.injectionMachineId === "m1")?.count, 3);
  });

  test("perMachine is sorted by count desc then id asc", () => {
    const load = machineLoadForDay([trial("m2"), trial("m1"), trial("m1"), trial("m3")]);
    assert.deepEqual(load.perMachine, [
      { injectionMachineId: "m1", count: 2 },
      { injectionMachineId: "m2", count: 1 },
      { injectionMachineId: "m3", count: 1 }
    ]);
  });
});
