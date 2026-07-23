import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultKpiSort,
  defaultKpiSortDirection,
  isKpiSortKey,
  parseKpiSortState,
  sortKpiRows,
  type KpiSortRow
} from "../../src/domain/mold-trial/kpi-sort.ts";

const baseRow = {
  name: "Row",
  role: "PM",
  applicable: 10,
  onTime: 8,
  percent: 80,
  totalPoints: 5,
  hasData: true,
  barHit: false,
  barHitByFloor: false
} satisfies KpiSortRow;

/** A named row carrying an `id` so we can assert stable ordering by identity. */
function row(id: string, overrides: Partial<KpiSortRow> = {}): KpiSortRow & { id: string } {
  return { ...baseRow, name: id, id, ...overrides };
}

function ids(rows: ReadonlyArray<{ id: string }>): string[] {
  return rows.map((entry) => entry.id);
}

describe("kpi-sort: name", () => {
  const rows = [row("Charlie"), row("alice"), row("Bob"), row("Item 10"), row("Item 2")];

  test("ascending is locale-aware and case-insensitive with natural numbers", () => {
    assert.deepEqual(
      ids(sortKpiRows(rows, { key: "name", direction: "asc" })),
      ["alice", "Bob", "Charlie", "Item 2", "Item 10"]
    );
  });

  test("descending reverses the ascending order", () => {
    assert.deepEqual(
      ids(sortKpiRows(rows, { key: "name", direction: "desc" })),
      ["Item 10", "Item 2", "Charlie", "Bob", "alice"]
    );
  });
});

describe("kpi-sort: role", () => {
  const rows = [
    row("a", { role: "QC" }),
    row("b", { role: "Assembly" }),
    row("c", { role: "Injection" })
  ];

  test("ascending sorts role labels A→Z", () => {
    assert.deepEqual(ids(sortKpiRows(rows, { key: "role", direction: "asc" })), ["b", "c", "a"]);
  });

  test("descending sorts role labels Z→A", () => {
    assert.deepEqual(ids(sortKpiRows(rows, { key: "role", direction: "desc" })), ["a", "c", "b"]);
  });
});

describe("kpi-sort: numeric columns", () => {
  test("applicable: desc puts the highest first, asc the lowest", () => {
    const rows = [row("a", { applicable: 2 }), row("b", { applicable: 10 }), row("c", { applicable: 1 })];
    assert.deepEqual(ids(sortKpiRows(rows, { key: "applicable", direction: "desc" })), ["b", "a", "c"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "applicable", direction: "asc" })), ["c", "a", "b"]);
  });

  test("ontime: desc puts the highest first, asc the lowest", () => {
    const rows = [row("a", { onTime: 5 }), row("b", { onTime: 12 }), row("c", { onTime: 0 })];
    assert.deepEqual(ids(sortKpiRows(rows, { key: "ontime", direction: "desc" })), ["b", "a", "c"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "ontime", direction: "asc" })), ["c", "a", "b"]);
  });

  test("points: desc puts the highest first, asc the lowest", () => {
    const rows = [row("a", { totalPoints: 3 }), row("b", { totalPoints: 30 }), row("c", { totalPoints: 3 })];
    // Tie between a and c breaks by name asc (a before c) in both directions.
    assert.deepEqual(ids(sortKpiRows(rows, { key: "points", direction: "desc" })), ["b", "a", "c"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "points", direction: "asc" })), ["a", "c", "b"]);
  });
});

describe("kpi-sort: percent", () => {
  test("desc ranks by rate; floor rows sort by their raw percent", () => {
    const rows = [
      row("floorLow", { applicable: 3, onTime: 0, percent: 0, barHit: true, barHitByFloor: true }),
      row("mid", { applicable: 10, percent: 60 }),
      row("high", { applicable: 10, percent: 95 }),
      row("floorHigh", { applicable: 4, onTime: 4, percent: 100, barHit: true, barHitByFloor: true })
    ];
    assert.deepEqual(
      ids(sortKpiRows(rows, { key: "percent", direction: "desc" })),
      ["floorHigh", "high", "mid", "floorLow"]
    );
    assert.deepEqual(
      ids(sortKpiRows(rows, { key: "percent", direction: "asc" })),
      ["floorLow", "mid", "high", "floorHigh"]
    );
  });

  test("a scored row with no rate (applicable 0) sorts last in either direction", () => {
    // hasData stays true via points; applicable 0 => percent shows '—' => last.
    const rows = [
      row("noRate", { applicable: 0, onTime: 0, percent: 100, totalPoints: 4 }),
      row("low", { applicable: 10, percent: 40 }),
      row("high", { applicable: 10, percent: 90 })
    ];
    assert.deepEqual(ids(sortKpiRows(rows, { key: "percent", direction: "desc" })), ["high", "low", "noRate"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "percent", direction: "asc" })), ["low", "high", "noRate"]);
  });
});

describe("kpi-sort: bar verdict", () => {
  const rows = [
    row("miss", { barHit: false, barHitByFloor: false }),
    row("hit", { barHit: true, barHitByFloor: false }),
    row("floor", { barHit: true, barHitByFloor: true })
  ];

  test("desc orders Hit > Not-enough-data(floor) > Miss", () => {
    assert.deepEqual(ids(sortKpiRows(rows, { key: "bar", direction: "desc" })), ["hit", "floor", "miss"]);
  });

  test("asc orders Miss > Not-enough-data(floor) > Hit", () => {
    assert.deepEqual(ids(sortKpiRows(rows, { key: "bar", direction: "asc" })), ["miss", "floor", "hit"]);
  });
});

describe("kpi-sort: no-data-last invariant", () => {
  test("no-data rows sink to the end for every key and both directions", () => {
    const rows = [
      row("nodata1", { hasData: false, applicable: 0, onTime: 0, percent: 100 }),
      row("scoredB", { name: "scoredB", applicable: 9, onTime: 9, percent: 100, totalPoints: 20, barHit: true }),
      row("nodata2", { hasData: false, applicable: 0, onTime: 0, percent: 100 }),
      row("scoredA", { name: "scoredA", applicable: 4, onTime: 1, percent: 25, totalPoints: 1 })
    ];

    for (const key of ["name", "role", "applicable", "ontime", "percent", "bar", "points"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        const sorted = ids(sortKpiRows(rows, { key, direction }));
        const tail = sorted.slice(-2);
        assert.deepEqual(
          [...tail].sort(),
          ["nodata1", "nodata2"],
          `no-data rows must be last for ${key}/${direction} (got ${sorted.join(",")})`
        );
      }
    }
  });

  test("no-data rows hold a stable name-asc order regardless of direction", () => {
    const rows = [
      row("Zed", { hasData: false }),
      row("scored", { name: "scored" }),
      row("amy", { hasData: false })
    ];
    assert.deepEqual(ids(sortKpiRows(rows, { key: "name", direction: "asc" })).slice(-2), ["amy", "Zed"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "name", direction: "desc" })).slice(-2), ["amy", "Zed"]);
  });
});

describe("kpi-sort: tie-break", () => {
  test("equal primary values break by name ascending", () => {
    const rows = [
      row("z", { name: "Zoe", applicable: 5 }),
      row("a", { name: "Ann", applicable: 5 }),
      row("m", { name: "Mia", applicable: 5 })
    ];
    // All share applicable=5, so name-asc decides in both directions.
    assert.deepEqual(ids(sortKpiRows(rows, { key: "applicable", direction: "desc" })), ["a", "m", "z"]);
    assert.deepEqual(ids(sortKpiRows(rows, { key: "applicable", direction: "asc" })), ["a", "m", "z"]);
  });

  test("equal name and primary keep original input order (stable)", () => {
    const rows = [
      row("first", { name: "Same", totalPoints: 7 }),
      row("second", { name: "Same", totalPoints: 7 }),
      row("third", { name: "Same", totalPoints: 7 })
    ];
    assert.deepEqual(ids(sortKpiRows(rows, { key: "points", direction: "desc" })), ["first", "second", "third"]);
  });
});

describe("kpi-sort: param parsing", () => {
  test("defaults to name asc on missing or invalid input", () => {
    assert.deepEqual(parseKpiSortState(null, null), defaultKpiSort);
    assert.deepEqual(parseKpiSortState("bogus", "sideways"), { key: "name", direction: "asc" });
  });

  test("a valid key with no direction adopts that key's default direction", () => {
    assert.deepEqual(parseKpiSortState("points", null), { key: "points", direction: "desc" });
    assert.deepEqual(parseKpiSortState("role", undefined), { key: "role", direction: "asc" });
  });

  test("explicit direction is honored", () => {
    assert.deepEqual(parseKpiSortState("percent", "asc"), { key: "percent", direction: "asc" });
  });

  test("key + direction guards agree with defaults", () => {
    assert.equal(isKpiSortKey("bar"), true);
    assert.equal(isKpiSortKey("nope"), false);
    assert.equal(defaultKpiSortDirection("name"), "asc");
    assert.equal(defaultKpiSortDirection("points"), "desc");
  });
});
