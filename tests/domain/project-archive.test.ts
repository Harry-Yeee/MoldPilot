import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  archiveReasonMaxLength,
  archivedCodeMarker,
  archivedProjectWriteMessage,
  assertProjectNotArchived,
  isArchivedProjectCode,
  isKpiScorableProject,
  isProjectArchived,
  nextArchivedProjectCode,
  originalProjectCode,
  parseArchiveReason,
  projectArchiveLabels,
  projectArchiveState
} from "../../src/domain/mold-trial/project-archive.ts";

describe("nextArchivedProjectCode (the rename helper)", () => {
  test("first archive of a code gets suffix 1", () => {
    assert.equal(nextArchivedProjectCode("MP-TRK-20260806-AB12CD", []), "MP-TRK-20260806-AB12CD-ARCHIVED-1");
  });

  test("collides with an already-archived project of the same code and counts up", () => {
    // The exact pilot case: the same mold code was mis-entered, archived, typed
    // again, and archived again. The second archive must not fight the UNIQUE
    // index on project_code.
    assert.equal(
      nextArchivedProjectCode("MP-2026-001", ["MP-2026-001-ARCHIVED-1"]),
      "MP-2026-001-ARCHIVED-2"
    );
    assert.equal(
      nextArchivedProjectCode("MP-2026-001", [
        "MP-2026-001-ARCHIVED-1",
        "MP-2026-001-ARCHIVED-2",
        "MP-2026-001-ARCHIVED-3"
      ]),
      "MP-2026-001-ARCHIVED-4"
    );
  });

  test("fills the lowest free number, not the highest plus one", () => {
    assert.equal(
      nextArchivedProjectCode("MP-2026-001", ["MP-2026-001-ARCHIVED-1", "MP-2026-001-ARCHIVED-3"]),
      "MP-2026-001-ARCHIVED-2"
    );
  });

  test("ignores codes that merely start the same way", () => {
    assert.equal(
      nextArchivedProjectCode("MP-1", ["MP-10-ARCHIVED-1", "MP-1-ARCHIVED-1x", "MP-1x-ARCHIVED-1"]),
      "MP-1-ARCHIVED-1"
    );
  });

  test("never stacks a second suffix on an already-archived code", () => {
    assert.equal(
      nextArchivedProjectCode("MP-2026-001-ARCHIVED-1", ["MP-2026-001-ARCHIVED-1"]),
      "MP-2026-001-ARCHIVED-2"
    );
  });

  test("is case-sensitive, like project_code itself", () => {
    assert.equal(
      nextArchivedProjectCode("MP-A", ["mp-a-ARCHIVED-1"]),
      "MP-A-ARCHIVED-1"
    );
  });

  test("uses the documented marker", () => {
    assert.equal(archivedCodeMarker, "-ARCHIVED-");
    assert.ok(nextArchivedProjectCode("X", []).includes(archivedCodeMarker));
  });
});

describe("originalProjectCode / isArchivedProjectCode", () => {
  test("recovers the code the project was archived from", () => {
    assert.equal(originalProjectCode("MP-2026-001-ARCHIVED-7"), "MP-2026-001");
    assert.equal(originalProjectCode("MP-2026-001"), "MP-2026-001");
  });

  test("only a trailing -ARCHIVED-<n> counts", () => {
    assert.equal(isArchivedProjectCode("MP-1-ARCHIVED-2"), true);
    assert.equal(isArchivedProjectCode("MP-1-ARCHIVED-2-STILL-LIVE"), false);
    assert.equal(isArchivedProjectCode("MP-ARCHIVED-PARTS-01"), false);
    assert.equal(originalProjectCode("MP-1-ARCHIVED-2-STILL-LIVE"), "MP-1-ARCHIVED-2-STILL-LIVE");
  });

  test("round-trips with the rename", () => {
    const archived = nextArchivedProjectCode("MP-2026-042", ["MP-2026-042-ARCHIVED-1"]);
    assert.equal(originalProjectCode(archived), "MP-2026-042");
  });
});

describe("parseArchiveReason", () => {
  test("trims a real reason", () => {
    assert.equal(parseArchiveReason("  wrong client  "), "wrong client");
    assert.equal(parseArchiveReason("客户填错"), "客户填错");
  });

  test("blank, whitespace, null and undefined all read as not given", () => {
    assert.equal(parseArchiveReason(""), null);
    assert.equal(parseArchiveReason("   "), null);
    assert.equal(parseArchiveReason(null), null);
    assert.equal(parseArchiveReason(undefined), null);
  });

  test("caps the length", () => {
    const long = "A".repeat(archiveReasonMaxLength + 40);
    assert.equal(parseArchiveReason(long)?.length, archiveReasonMaxLength);
  });
});

describe("isProjectArchived / projectArchiveState (stale-client read seam)", () => {
  const archivedAt = new Date("2026-08-06T02:00:00.000Z");

  test("reads a stamped row", () => {
    assert.equal(
      isProjectArchived({ id: "p1", archivedAt }),
      true
    );
    assert.deepEqual(
      projectArchiveState({
        id: "p1",
        archivedAt,
        archivedById: "user-1",
        archiveReason: "  duplicate intake  "
      }),
      { archived: true, archivedAt, archivedById: "user-1", archiveReason: "duplicate intake" }
    );
  });

  test("a row from a generated client that predates the migration reads as live", () => {
    // No archivedAt / archivedById / archiveReason keys at all: exactly the shape
    // a stale Prisma client returns. This seam is what keeps `tsc --noEmit`
    // clean before Harry regenerates.
    assert.equal(isProjectArchived({ id: "p1" }), false);
    assert.deepEqual(projectArchiveState({ id: "p1" }), {
      archived: false,
      archivedAt: null,
      archivedById: null,
      archiveReason: null
    });
  });

  test("explicit nulls behave the same as absent fields", () => {
    assert.equal(isProjectArchived({ id: "p1", archivedAt: null }), false);
    assert.deepEqual(
      projectArchiveState({ id: "p1", archivedAt: null, archivedById: null, archiveReason: null }),
      { archived: false, archivedAt: null, archivedById: null, archiveReason: null }
    );
  });
});

describe("isKpiScorableProject (the KPI exclusion decision)", () => {
  test("a live project's events are scored", () => {
    assert.equal(isKpiScorableProject({ id: "p1" }), true);
    assert.equal(isKpiScorableProject({ id: "p1", archivedAt: null }), true);
  });

  test("an archived project's events are NOT scored", () => {
    // A mis-entered project must never cost anyone a habit event: nobody really
    // had to confirm that date or upload that report.
    assert.equal(isKpiScorableProject({ id: "p1", archivedAt: new Date("2026-08-06T02:00:00.000Z") }), false);
  });

  test("is exactly the negation of isProjectArchived", () => {
    for (const project of [
      { id: "p1" },
      { id: "p1", archivedAt: null },
      { id: "p1", archivedAt: new Date() }
    ]) {
      assert.equal(isKpiScorableProject(project), !isProjectArchived(project));
    }
  });
});

describe("assertProjectNotArchived (the shared write guard)", () => {
  test("lets a live project through", () => {
    assert.doesNotThrow(() => assertProjectNotArchived({ id: "p1" }));
    assert.doesNotThrow(() => assertProjectNotArchived({ id: "p1", archivedAt: null }));
  });

  test("refuses an archived project with the shared message", () => {
    assert.throws(
      () => assertProjectNotArchived({ id: "p1", archivedAt: new Date() }),
      new RegExp(archivedProjectWriteMessage.replace(/[.()]/g, "\\$&"))
    );
  });
});

describe("labels", () => {
  test("every label carries both languages", () => {
    for (const [key, label] of Object.entries(projectArchiveLabels)) {
      assert.equal(typeof label.en, "string", `${key} is missing an English label`);
      assert.equal(typeof label.zh, "string", `${key} is missing a Chinese label`);
      assert.ok(label.en.length > 0 && label.zh.length > 0, `${key} has an empty label`);
    }

    assert.equal(projectArchiveLabels.archived.zh, "已归档");
    assert.equal(projectArchiveLabels.listTitle.zh, "已归档项目");
  });
});
